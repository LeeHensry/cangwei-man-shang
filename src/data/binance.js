/**
 * 加密货币数据源 - Binance公开API
 * 无需API Key
 */
const axios = require('axios');
const dayjs = require('dayjs');

const Binance = axios.create({
  baseURL: 'https://api.binance.com',
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0' },
});

// 主流币种USDT交易对
const HOT_PAIRS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','ADAUSDT',
  'AVAXUSDT','DOTUSDT','LINKUSDT','MATICUSDT','LTCUSDT','UNIUSDT','ATOMUSDT',
  'NEARUSDT','APTUSDT','ARBUSDT','OPUSDT','SUIUSDT','SEIUSDT','TONUSDT',
  'PEPEUSDT','SHIBUSDT','WIFUSDT','FETUSDT','RNDRUSDT','INJUSDT',
];

const SLEEP_MS = 100;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 获取交易对Ticker(24h行情)
 */
async function getTicker(symbol) {
  try {
    const res = await Binance.get('/api/v3/ticker/24hr', { params: { symbol } });
    return {
      symbol,
      name: symbol.replace('USDT', ''),
      price: parseFloat(res.data.lastPrice),
      pct_change: parseFloat(res.data.priceChangePercent),
      high: parseFloat(res.data.highPrice),
      low: parseFloat(res.data.lowPrice),
      volume: parseFloat(res.data.volume),
      quote_volume: parseFloat(res.data.quoteVolume),
      trades: parseInt(res.data.count),
    };
  } catch(e) { return null; }
}

/**
 * 批量获取所有主流币Ticker
 */
async function getAllTickers() {
  const results = [];
  for (let i = 0; i < HOT_PAIRS.length; i++) {
    const t = await getTicker(HOT_PAIRS[i]);
    if (t) results.push(t);
    await sleep(SLEEP_MS);
  }
  return results;
}

/**
 * 获取K线
 * @param {string} symbol
 * @param {string} interval 1d/4h/1h
 * @param {number} limit
 */
async function getKlines(symbol, interval = '1d', limit = 100) {
  try {
    const res = await Binance.get('/api/v3/klines', {
      params: { symbol, interval, limit }
    });
    return res.data.map(k => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      close_time: k[6],
      quote_volume: parseFloat(k[7]),
      trades: k[8],
    }));
  } catch(e) { return []; }
}

/**
 * 计算加密货币的技术指标
 */
function calcIndicators(klines) {
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const n = closes.length;

  const SMA = (period) => {
    if (n < period) return null;
    return closes.slice(-period).reduce((a,b)=>a+b,0) / period;
  };
  const EMA = (period) => {
    if (n < period) return null;
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a,b)=>a+b,0)/period;
    for (let i = period; i < n; i++) ema = closes[i]*k + ema*(1-k);
    return ema;
  };
  const STD = (period) => {
    const m = SMA(period);
    if (m == null) return null;
    const v = closes.slice(-period).reduce((a,b)=>a+Math.pow(b-m,2),0)/period;
    return Math.sqrt(v);
  };
  const RSI = (period=14) => {
    if (n < period+1) return null;
    let gains=0, losses=0;
    for (let i = n-period; i < n; i++) {
      const diff = closes[i] - closes[i-1];
      if (diff > 0) gains += diff; else losses -= diff;
    }
    const avgGain = gains/period, avgLoss = losses/period;
    if (avgLoss === 0) return 100;
    const rs = avgGain/avgLoss;
    return 100 - 100/(1+rs);
  };

  const sma5 = SMA(5), sma10 = SMA(10), sma20 = SMA(20), sma60 = SMA(60);
  const ema12 = EMA(12), ema26 = EMA(26);
  const macdDif = ema12 && ema26 ? ema12 - ema26 : null;
  // 计算MACD DEA（标准9日EMA of DIF）
  let macdDea = null, macdBar = null;
  if (ema12 && ema26 && n >= 35) {
    // 需要完整DIF序列来计算DEA（9日EMA of DIF）
    const difSeries = [];
    for (let i = 26; i < n; i++) {
      // 递归计算到i位置的EMA12和EMA26
      const k12 = 2/13, k26 = 2/27;
      let e12 = closes.slice(0,12).reduce((a,b)=>a+b,0)/12;
      let e26 = closes.slice(0,26).reduce((a,b)=>a+b,0)/26;
      for (let j = 26; j <= i; j++) {
        e12 = closes[j]*k12 + e12*(1-k12);
        e26 = closes[j]*k26 + e26*(1-k26);
      }
      difSeries.push(e12 - e26);
    }
    if (difSeries.length >= 9) {
      const k9 = 2/10;
      let dea = difSeries.slice(0,9).reduce((a,b)=>a+b,0)/9;
      for (let i = 9; i < difSeries.length; i++) {
        dea = difSeries[i]*k9 + dea*(1-k9);
      }
      macdDea = dea;
      macdBar = 2*(macdDif - macdDea);
    }
  }
  const rsi = RSI(14);
  const bollMid = sma20;
  const bollStd = STD(20);
  const bollUpper = bollMid && bollStd ? bollMid + 2*bollStd : null;
  const bollLower = bollMid && bollStd ? bollMid - 2*bollStd : null;

  // 成交量均线
  const volMA5 = volumes.length >= 5 ? volumes.slice(-5).reduce((a,b)=>a+b,0)/5 : null;
  const volMA20 = volumes.length >= 20 ? volumes.slice(-20).reduce((a,b)=>a+b,0)/20 : null;

  return {
    sma5, sma10, sma20, sma60,
    ema12, ema26, macd_dif: macdDif, macd_dea: macdDea, macd_bar: macdBar,
    rsi14: rsi, rsi6: RSI(6),
    boll_upper: bollUpper, boll_mid: bollMid, boll_lower: bollLower,
    vol_ma5: volMA5, vol_ma20: volMA20,
  };
}

/**
 * 单币种综合短线/中长线评分
 * 返回signal: long / short / watch / hold
 */
async function analyzeSymbol(symbol) {
  const [ticker, klinesD, klines4H] = await Promise.all([
    getTicker(symbol),
    getKlines(symbol, '1d', 100),
    getKlines(symbol, '4h', 100),
  ]);
  if (!ticker || klinesD.length < 60) return null;

  const ind = calcIndicators(klinesD);
  const latest = klinesD[klinesD.length - 1];
  const prev = klinesD[klinesD.length - 2];
  const score = { total: 50, long: 0, short: 0, reasons: [], risks: [] };

  // === 趋势判断 ===
  if (ind.sma5 && ind.sma20 && ind.sma60) {
    if (ind.sma5 > ind.sma20 && ind.sma20 > ind.sma60) {
      score.long += 15;
      score.reasons.push('均线多头排列（日）');
    } else if (ind.sma5 < ind.sma20 && ind.sma20 < ind.sma60) {
      score.short += 15;
      score.risks.push('均线空头排列（日）');
    }
  }

  // 4H级别均线
  if (klines4H.length >= 60) {
    const ind4h = calcIndicators(klines4H);
    if (ind4h.sma5 && ind4h.sma20 && ind4h.sma5 > ind4h.sma20) {
      score.long += 8;
      score.reasons.push('4H均线多头');
    } else if (ind4h.sma5 && ind4h.sma20 && ind4h.sma5 < ind4h.sma20) {
      score.short += 8;
      score.risks.push('4H均线空头');
    }
  }

  // === MACD ===
  if (ind.macd_dif != null && ind.macd_dea != null && ind.macd_dif > ind.macd_dea) {
    score.long += 8;
    score.reasons.push('MACD多头（日）');
  } else if (ind.macd_dif != null && ind.macd_dif < ind.macd_dea) {
    score.short += 8;
    score.risks.push('MACD空头（日）');
  }

  // === RSI ===
  if (ind.rsi14 != null) {
    if (ind.rsi14 < 30) { score.long += 12; score.reasons.push(`RSI超卖(${ind.rsi14.toFixed(0)})`); }
    else if (ind.rsi14 > 75) { score.short += 12; score.risks.push(`RSI超买(${ind.rsi14.toFixed(0)})`); }
    else if (ind.rsi14 > 50 && ind.rsi14 < 65) { score.long += 4; score.reasons.push(`RSI偏强(${ind.rsi14.toFixed(0)})`); }
  }

  // === 突破 ===
  const high20 = Math.max(...klinesD.slice(-21,-1).map(k=>k.high));
  if (latest.close > high20 && ticker.pct_change > 2) {
    score.long += 10;
    score.reasons.push('突破20日新高');
  }
  const low20 = Math.min(...klinesD.slice(-21,-1).map(k=>k.low));
  if (latest.close < low20 && ticker.pct_change < -3) {
    score.short += 10;
    score.risks.push('跌破20日新低');
  }

  // === 成交量 ===
  if (ind.vol_ma20) {
    const volRatio = latest.volume / ind.vol_ma20;
    if (volRatio > 2 && ticker.pct_change > 3) { score.long += 8; score.reasons.push(`放量上涨(量比${volRatio.toFixed(1)})`); }
    else if (volRatio > 2 && ticker.pct_change < -5) { score.short += 8; score.risks.push(`放量下跌(量比${volRatio.toFixed(1)})`); }
  }

  // === BOLL ===
  if (ind.boll_upper && latest.close > ind.boll_upper) { score.short += 5; score.risks.push('突破BOLL上轨（超买）'); }
  if (ind.boll_lower && latest.close < ind.boll_lower) { score.long += 5; score.reasons.push('跌破BOLL下轨（超卖）'); }

  // === 24h涨跌幅极端值 ===
  if (ticker.pct_change > 10) { score.short += 8; score.risks.push(`24h涨${ticker.pct_change.toFixed(1)}%（过热）`); }
  if (ticker.pct_change < -10) { score.long += 6; score.reasons.push(`24h跌${ticker.pct_change.toFixed(1)}%（恐慌）`); }

  // 计算综合方向
  score.total = 50 + score.long - score.short;
  score.total = Math.max(0, Math.min(100, score.total));

  let signal = 'hold';
  let action = '观望';
  let leverage = 0;
  let stopLossPct = 5;
  let targetPct = 12;
  let isShort = false;
  if (score.total >= 72) {
    signal = 'long';
    action = '做多';
    leverage = 3;
    stopLossPct = 5;
    targetPct = 12;
  } else if (score.total <= 28) {
    signal = 'short';
    action = '做空/回避';
    leverage = 2;
    isShort = true;
    stopLossPct = 5;
    targetPct = 12;
  } else if (score.total >= 60) {
    signal = 'watch_long';
    action = '关注做多';
  } else if (score.total <= 40) {
    signal = 'watch_short';
    action = '关注做空';
  }

  return {
    symbol: ticker.name,
    pair: symbol,
    price: ticker.price,
    pct_24h: ticker.pct_change,
    volume_24h: ticker.quote_volume,
    score: Math.round(score.total),
    long_score: score.long,
    short_score: score.short,
    signal,
    action,
    leverage,
    stop_loss: isShort
      ? +(ticker.price * (1 + stopLossPct/100)).toFixed(4)   // 做空止损在上方
      : +(ticker.price * (1 - stopLossPct/100)).toFixed(4),  // 做多止损在下方
    target: isShort
      ? +(ticker.price * (1 - targetPct/100)).toFixed(4)     // 做空止盈在下方
      : +(ticker.price * (1 + targetPct/100)).toFixed(4),    // 做多止盈在上方
    reasons: score.reasons.slice(0,5),
    risks: score.risks.slice(0,5),
    rsi: ind.rsi14 ? +ind.rsi14.toFixed(0) : null,
    macd: ind.macd_dif ? +ind.macd_dif.toFixed(4) : null,
    sma20: ind.sma20,
    sma60: ind.sma60,
    updated_at: dayjs().format('YYYY-MM-DD HH:mm'),
  };
}

/**
 * 分析所有主流币
 */
async function analyzeAll() {
  const results = [];
  for (const pair of HOT_PAIRS) {
    try {
      const r = await analyzeSymbol(pair);
      if (r) results.push(r);
    } catch(e) {}
    await sleep(150);
  }
  return results.sort((a,b) => Math.abs(50-b.score) - Math.abs(50-a.score));
}

module.exports = {
  getTicker, getAllTickers, getKlines, calcIndicators,
  analyzeSymbol, analyzeAll, HOT_PAIRS,
};
