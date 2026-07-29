/**
 * 资金面数据获取 v3
 * 数据源：腾讯财经完整版行情（成交额在字段37，单位：万元）
 */
const axios = require('axios');
const iconv = require('iconv-lite');

const Tencent = axios.create({
  baseURL: 'https://qt.gtimg.cn',
  timeout: 10000, responseType: 'arraybuffer',
  headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://gu.qq.com/' }
});

function decodeGBK(buf) { return iconv.decode(Buffer.from(buf), 'gbk'); }

function parseFull(text) {
  const results = [];
  const lines = text.trim().split(';').filter(l => l.trim() && l.includes('~'));
  for (const line of lines) {
    const m = line.match(/v_(sh|sz|bj)([a-z0-9]+)="([^"]*)"/i);
    if (!m) continue;
    const market = m[1].toUpperCase();
    const code = m[2];
    const data = m[3];
    const parts = data.split('~');
    if (parts.length < 45) continue;
    results.push({
      code, market,
      name: parts[1],
      close: parseFloat(parts[3]),
      pre_close: parseFloat(parts[4]),
      open: parseFloat(parts[5]),
      // 字段6:成交量(手) 字段37:成交额(万元)
      volume: parseFloat(parts[6]),
      amount_wan: parseFloat(parts[37]),
      high: parseFloat(parts[33]) || parseFloat(parts[4]) * 1.1,
      low: parseFloat(parts[34]) || parseFloat(parts[4]) * 0.9,
      pct_chg: parseFloat(parts[32]),
      chg: parseFloat(parts[31]),
      amplitude: 0,
      turnover: parseFloat(parts[38]) || 0,
      pe: parseFloat(parts[39]) || null,
    });
  }
  return results;
}

/**
 * 获取全市场成交额
 * 上证(sh000001)字段37 + 深证成指(sz399001)字段37，单位：万元
 * 注意：简版接口s_sh000001字段7是成交量(手)不是金额，必须用完整版
 */
async function getMarketOverview() {
  try {
    // 完整版行情拿成交额
    const res = await Tencent.get('/q=sh000001,sz399001,sz399006,sh000300,sh000016,sh000905,sh000688');
    const text = decodeGBK(res.data);
    const quotes = parseFull(text);
    
    // 全市场成交额（上证+深证），单位：亿元
    const sh = quotes.find(q => q.code === '000001');
    const sz = quotes.find(q => q.code === '399001');
    const totalWan = (sh?.amount_wan || 0) + (sz?.amount_wan || 0);
    const totalYi = Math.round(totalWan / 10000); // 万元→亿元
    
    return { indices: quotes, total_amount_wan: totalWan, total_amount_yi: totalYi };
  } catch (e) {
    console.error('getMarketOverview error:', e.message);
    return { indices: [], total_amount_wan: 0, total_amount_yi: 0 };
  }
}

/**
 * 个股资金流向信号（用K线量价计算）
 */
function getStockFlowSignals(db, code) {
  const klines = db.prepare(`
    SELECT trade_date, close, volume, pct_chg, high, low FROM daily_kline
    WHERE code = ? ORDER BY trade_date DESC LIMIT 10
  `).all(code);
  
  if (klines.length < 7) return { flow_score: 50, direction: 'neutral', days_inflow: 0, days_outflow: 0, concentration: 0, signals: [] };
  
  const vols = klines.map(k => k.volume);
  const avgVol = vols.slice(3).reduce((a,b)=>a+b,0) / vols.slice(3).length;
  
  let inflowDays = 0, outflowDays = 0;
  let inflowStrength = 0;
  const signals = [];
  
  for (let i = 0; i < 5; i++) {
    const k = klines[i];
    const volRatio = k.volume / avgVol;
    if (k.pct_chg > 0.5 && volRatio > 1.2) {
      inflowDays++;
      inflowStrength += (k.pct_chg * volRatio);
      if (i === 0 && volRatio > 1.5) signals.push('放量上涨');
    } else if (k.pct_chg < -0.5 && volRatio > 1.2) {
      outflowDays++;
      if (i === 0 && volRatio > 1.5) signals.push('放量下跌');
    }
  }
  
  // 缩量回调（良性调整）信号
  if (klines[0].pct_chg < 0 && klines[0].pct_chg > -2 && klines[0].volume < avgVol * 0.8) {
    signals.push('缩量调整');
  }
  
  const recentVol = vols.slice(0,5).reduce((a,b)=>a+b,0);
  const totalVol = vols.reduce((a,b)=>a+b,0);
  const concentration = Math.round(recentVol / totalVol * 100);
  
  let direction = 'neutral', flowScore = 50;
  if (inflowDays >= 3 && inflowStrength > 15) { direction = 'inflow'; flowScore = 75; }
  else if (inflowDays >= 2) { direction = 'slight_inflow'; flowScore = 60; }
  else if (outflowDays >= 3) { direction = 'outflow'; flowScore = 25; }
  else if (outflowDays >= 2) { direction = 'slight_outflow'; flowScore = 40; }
  
  return {
    flow_score: Math.min(100, Math.max(0, flowScore)),
    direction, days_inflow: inflowDays, days_outflow: outflowDays,
    concentration, signals,
    vol_ratio: avgVol > 0 ? +(vols[0] / avgVol).toFixed(2) : 1,
  };
}

/**
 * 市场资金抱团度
 * 用行业涨跌幅近似估算资金集中度（后续可替换为真实资金流API）
 */
function calcMarketConcentration(sectors) {
  if (!sectors || sectors.length === 0) return { top_sectors: [], worst_sectors: [], concentration: 30, total_inflow: 0, total_outflow: 0 };
  
  const positive = sectors.filter(s => s.net_inflow > 0).sort((a,b) => b.net_inflow - a.net_inflow);
  const negative = sectors.filter(s => s.net_inflow < 0).sort((a,b) => a.net_inflow - b.net_inflow);
  const totalNet = sectors.reduce((a,b) => a + Math.abs(b.net_inflow), 0);
  const top3 = positive.slice(0, 3);
  const top3Net = top3.reduce((a,b) => a + b.net_inflow, 0);
  const concentration = totalNet > 0 ? Math.min(80, Math.round(top3Net / totalNet * 100)) : 30;
  
  return {
    top_sectors: top3.map(s => ({ name: s.name, net_inflow: s.net_inflow })),
    worst_sectors: negative.slice(0, 3).map(s => ({ name: s.name, net_inflow: s.net_inflow })),
    concentration,
    total_inflow: Math.round(positive.reduce((a,b)=>a+b.net_inflow,0)),
    total_outflow: Math.round(negative.reduce((a,b)=>a+b.net_inflow,0)),
  };
}

module.exports = {
  getMarketOverview,
  getStockFlowSignals,
  calcMarketConcentration,
};
