/**
 * 仓位满上 Top Up - 后端API Server
 */
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

// ========== 启动前种子数据检查 ==========
if (!process.env.TURSO_AUTH_TOKEN) {
  (function initSeed() {
    const dbPath = path.join(__dirname, 'data', 'stock_advisor.db');
    const seedPath = path.join(__dirname, 'data', 'seed.db');
    try {
      let needSeed = false;
      if (!fs.existsSync(dbPath)) needSeed = true;
      else { const stat = fs.statSync(dbPath); if (stat.size < 100 * 1024) needSeed = true; }
      if (needSeed && fs.existsSync(seedPath)) { fs.copyFileSync(seedPath, dbPath); console.log('[init] ✅ 已从 seed.db 恢复种子数据库'); }
      else if (needSeed) { console.log('[init] ⚠️ 数据库为空且无 seed.db'); }
    } catch(e) { console.log('[init] 种子检查失败:', e.message); }
  })();
}

const { dbGet, dbAll, dbRun, dbBatch, dbIsReady, usePostgres, useTurso, client } = require('./src/data/db');
const stockPool = require('./src/data/stock_pool');
const ds = require('./src/data/datasources');
const tq = ds;
// 东方财富K线数据源（含换手率字段，腾讯K线不返回换手率）
const emKline = require('./src/data/eastmoney');
const { calcAllIndicators } = require('./src/factors/indicators');
const { scoreAllStocks, classifyIndustry, syncFinancialData } = require('./src/strategies/value_score');
const { getMarketOverview, calcMarketConcentration } = require('./src/data/money_flow');
const { calcAllCrowding, getCrowdingSignal } = require('./src/factors/crowding');
const dayjs = require('dayjs');

const app = express();
app.use(cors());
app.use(express.json());

// ========== API 路由 ==========

app.get('/api/market/overview', async (req, res) => {
  try {
    const marketData = await getMarketOverview();
    const indices = marketData.indices.length > 0 ? marketData.indices : await tq.getIndexQuotes();
    let sectors = await dbAll(`SELECT sector_code, sector_name, change_pct, leader_name, leader_pct FROM sector_daily ORDER BY trade_date DESC, change_pct DESC LIMIT 40`);
    if (sectors.length === 0) {
      try { const live = await ds.getSectorList(); sectors = (live || []).slice(0, 40).map(s => ({ sector_code: s.sector_code, sector_name: s.sector_name, change_pct: s.change_pct, leader_name: s.leader_name || '', leader_pct: s.leader_pct || 0 })); } catch(e) {}
    }
    const sectorFlows = sectors.map(s => ({ name: s.sector_name, net_inflow: Math.round(s.change_pct * 12), leader_name: s.leader_name, leader_pct: s.leader_pct })).sort((a,b) => b.net_inflow - a.net_inflow);
    const concentration = calcMarketConcentration(sectorFlows);
    const latestDateRow = await dbGet('SELECT MAX(trade_date) as d FROM stock_score');
    const latestDate = latestDateRow?.d;
    const scores = await dbAll(`SELECT s.code, s.total_score, s.signal, s.quality_score, s.valuation_score, s.technical_score, v.pe, i.name, i.total_mv FROM stock_score s LEFT JOIN valuation v ON s.code = v.code AND v.trade_date = (SELECT MAX(trade_date) FROM valuation) LEFT JOIN stock_info i ON s.code = i.code WHERE s.trade_date = ? AND s.strategy = 'value'`, [latestDate]);
    const peValues = scores.map(s => s.pe).filter(v => v && v > 0 && v < 200);
    const medianPE = peValues.sort((a,b) => a-b)[Math.floor(peValues.length/2)] || 15;
    let valuationScore; if (medianPE < 10) valuationScore = 10; else if (medianPE < 14) valuationScore = 25; else if (medianPE < 20) valuationScore = 50; else if (medianPE < 28) valuationScore = 72; else valuationScore = 92;
    const totalAmount = marketData.total_amount_yi || 8000;
    const avgIdxPct = indices.reduce((a,b) => a + (b.pct_chg||0), 0) / indices.length;
    let moneyScore = 50; if (totalAmount < 6000) moneyScore = 20; else if (totalAmount < 8000) moneyScore = 35; else if (totalAmount < 10000) moneyScore = 50; else if (totalAmount < 12000) moneyScore = 62; else if (totalAmount < 15000) moneyScore = 72; else moneyScore = 80;
    if (totalAmount > 12000) { if (avgIdxPct > 1) moneyScore += 10; else if (avgIdxPct < -1) moneyScore -= 20; else if (avgIdxPct < -0.3) moneyScore -= 10; }
    moneyScore = Math.max(0, Math.min(100, moneyScore));
    const conc = concentration.concentration || 30;
    if (conc > 55) moneyScore = Math.min(95, moneyScore + 5); else if (conc < 20) moneyScore = Math.max(10, moneyScore - 5);
    let trendScore = 50;
    for (const idxCode of ['000001','000300']) {
      const kl = await dbAll(`SELECT close FROM daily_kline WHERE code=? ORDER BY trade_date DESC LIMIT 20`, [idxCode]);
      if (kl.length >= 20) { const ma20 = kl.reduce((a,b)=>a+b.close,0)/kl.length; const cur = kl[0].close; if (cur > ma20 * 1.02) trendScore += 15; else if (cur > ma20) trendScore += 5; else if (cur < ma20 * 0.98) trendScore -= 15; else trendScore -= 5; }
    }
    if (avgIdxPct > 1) trendScore += 15; else if (avgIdxPct > 0) trendScore += 5; else if (avgIdxPct < -2) trendScore -= 15; else if (avgIdxPct < -1) trendScore -= 8;
    trendScore = Math.max(0, Math.min(100, trendScore));
    const upIndices = indices.filter(i => i.pct_chg > 0).length;
    let sentimentScore = 50; if (avgIdxPct > 1.5) sentimentScore = 80; else if (avgIdxPct > 0.5) sentimentScore = 65; else if (avgIdxPct > -0.3) sentimentScore = 50; else if (avgIdxPct > -1) sentimentScore = 35; else if (avgIdxPct > -2) sentimentScore = 25; else sentimentScore = 15;
    const temp = Math.round(valuationScore * 0.30 + moneyScore * 0.35 + trendScore * 0.20 + sentimentScore * 0.15);
    let tempDesc, suggestedPos, tempColor;
    if (temp < 20) { tempDesc = '极度寒冷(地量见底)'; suggestedPos = '80-100%'; tempColor = '#12b76a'; } else if (temp < 35) { tempDesc = '偏冷(低估区间)'; suggestedPos = '60-80%'; tempColor = '#32d583'; } else if (temp < 55) { tempDesc = '温(估值合理)'; suggestedPos = '40-60%'; tempColor = '#fac515'; } else if (temp < 70) { tempDesc = '偏热(资金活跃)'; suggestedPos = '20-40%'; tempColor = '#f79009'; } else if (temp < 85) { tempDesc = '过热(警惕回调)'; suggestedPos = '10-20%'; tempColor = '#f04438'; } else { tempDesc = '🔥亢奋泡沫(减仓)'; suggestedPos = '0-10%'; tempColor = '#d92d20'; }
    const tempBreakdown = [
      { label: '估值', score: valuationScore, weight: '30%', detail: `PE中位数 ${medianPE.toFixed(1)}x`, color: '#12b76a' },
      { label: '资金', score: moneyScore, weight: '35%', detail: `成交${totalAmount}亿 抱团${conc}%`, color: '#2e90fa' },
      { label: '趋势', score: trendScore, weight: '20%', detail: `均线位置`, color: '#f79009' },
      { label: '情绪', score: sentimentScore, weight: '15%', detail: `均涨${avgIdxPct?.toFixed(1)||0}% ${upIndices}涨`, color: '#9e77ed' },
    ];
    const signalCounts = { buy: 0, watch: 0, hold: 0, sell: 0, momentum_buy: 0 };
    scores.forEach(s => { if (signalCounts[s.signal] !== undefined) signalCounts[s.signal]++; });
    const today = dayjs().format('YYYYMMDD');
    const sectorCrowdingRows = await dbAll(`SELECT * FROM sector_crowding WHERE trade_date = ? ORDER BY crowding_score DESC`, [today]);
    const crowdedSectors = sectorCrowdingRows.filter(s => s.crowding_score >= 75);
    const coldSectors = sectorCrowdingRows.filter(s => s.crowding_score < 35);
    const momentumSectors = sectorCrowdingRows.filter(s => s.crowding_score >= 35 && s.crowding_score < 65);
    const stockWarningRows = await dbAll(`SELECT c.code, c.name, c.combined_crowding_score, c.level, c.action, c.factors_json, s.signal, s.total_score FROM crowding_score c LEFT JOIN stock_score s ON c.code = s.code AND s.trade_date = c.trade_date AND s.strategy = 'value' WHERE c.trade_date = ? AND (c.level = 'extreme' OR c.level = 'crowded') ORDER BY c.combined_crowding_score DESC LIMIT 15`, [today]);
    const stockWarnings = stockWarningRows.map(r => { let factors = {}; try { factors = JSON.parse(r.factors_json); } catch(e) {} return { ...r, ret_5d: factors.ret_5d, ret_20d: factors.ret_20d, reasons: factors.reasons || [] }; });
    const momentumCandidateRows = await dbAll(`SELECT c.code, c.name, c.combined_crowding_score, s.total_score, s.technical_score, c.factors_json, i.industry FROM crowding_score c LEFT JOIN stock_score s ON c.code = s.code AND s.trade_date = c.trade_date AND s.strategy = 'value' LEFT JOIN stock_info i ON c.code = i.code WHERE c.trade_date = ? AND c.action = 'momentum_buy' AND s.total_score >= 45 ORDER BY s.total_score DESC LIMIT 10`, [today]);
    const momentumCandidates = momentumCandidateRows.map(r => { let factors = {}; try { factors = JSON.parse(r.factors_json); } catch(e) {} return { ...r, ret_5d: factors.ret_5d, ret_20d: factors.ret_20d, momentum_state: factors.momentum_state }; });
    const topCandidates = scores.filter(s => s.signal === 'buy' || s.signal === 'watch' || s.signal === 'momentum_buy').sort((a,b) => b.total_score - a.total_score).slice(0, 10);
    const topStocks = [];
    for (const s of topCandidates) {
      const val = await dbGet('SELECT pe, trade_date FROM valuation WHERE code = ? ORDER BY trade_date DESC LIMIT 1', [s.code]);
      const kline = await dbAll('SELECT close, pct_chg, trade_date FROM daily_kline WHERE code = ? ORDER BY trade_date DESC LIMIT 10', [s.code]);
      const todayClose = kline[0]?.close; const todayPct = kline[0]?.pct_chg;
      let pct7d = null; if (kline.length >= 5) { const ref = kline[kline.length - 1]?.close; if (ref && todayClose) pct7d = +((todayClose / ref - 1) * 100).toFixed(2); }
      topStocks.push({ code: s.code, name: s.name, total_score: s.total_score, signal: s.signal, quality: s.quality_score, valuation: s.valuation_score, technical: s.technical_score, pe: val?.pe, close: todayClose, pct_chg: todayPct, pct_7d: pct7d });
    }
    res.json({
      date: dayjs().format('YYYY-MM-DD HH:mm'),
      indices: indices.map(i => ({ name: i.name, code: i.code, close: i.close, pct_chg: i.pct_chg })),
      temperature: { value: temp, label: tempDesc, suggested_position: suggestedPos, median_pe: +medianPE.toFixed(1), color: tempColor, breakdown: tempBreakdown, total_amount: totalAmount, concentration: conc, top_flow_sectors: concentration.top_sectors, worst_flow_sectors: concentration.worst_sectors },
      signal_counts: signalCounts, top_stocks: topStocks, sectors: sectors.slice(0, 10), total_stocks: scores.length,
      crowding: { sector_crowding: sectorCrowdingRows.slice(0, 20), crowded_sectors: crowdedSectors, cold_sectors: coldSectors.slice(0, 8), momentum_sectors: momentumSectors.slice(0, 8), stock_warnings: stockWarnings, momentum_candidates: momentumCandidates, market_avg_crowding: sectorCrowdingRows.length > 0 ? Math.round(sectorCrowdingRows.reduce((a,b)=>a+b.crowding_score,0)/sectorCrowdingRows.length) : 50 },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stocks', async (req, res) => {
  try {
    const { signal, industry, sort = 'total_score', order = 'desc', page = 1, pageSize = 20, minScore, isNewEconomy, isOldman } = req.query;
    const latestDateRow = await dbGet('SELECT MAX(trade_date) as d FROM stock_score');
    const latestDate = latestDateRow?.d;
    let where = `WHERE s.trade_date = ? AND s.strategy = 'value'`;
    const params = [latestDate];
    if (signal) { where += ` AND s.signal = ?`; params.push(signal); }
    if (minScore) { where += ` AND s.total_score >= ?`; params.push(parseInt(minScore)); }
    const latestKlineDateRow = await dbGet('SELECT MAX(trade_date) as d FROM daily_kline');
    const latestKlineDate = latestKlineDateRow?.d;
    let rows = await dbAll(`SELECT s.*, i.name, i.total_mv, v.pe, k.close as current_price, k.pct_chg as daily_pct_chg FROM stock_score s LEFT JOIN stock_info i ON s.code = i.code LEFT JOIN valuation v ON s.code = v.code AND v.trade_date = (SELECT MAX(trade_date) FROM valuation WHERE code = s.code) LEFT JOIN daily_kline k ON k.code = s.code AND k.trade_date = (SELECT MAX(trade_date) FROM daily_kline WHERE code = s.code) ${where}`, [...params]);
    rows = rows.map(r => { let ind = null; try { ind = JSON.parse(r.quality_detail); } catch(e) {} return { ...r, _industry: ind?.industry, _isNewEconomy: ind?.isNewEconomy, _isOldman: ind?.isOldman }; });
    if (industry && industry !== 'all') rows = rows.filter(r => r._industry && r._industry.includes(industry));
    if (isNewEconomy === 'true') rows = rows.filter(r => r._isNewEconomy);
    if (isOldman === 'true') rows = rows.filter(r => r._isOldman);
    const sortField = sort === 'pe' ? 'pe' : sort === 'total_mv' ? 'total_mv' : sort === 'quality' ? 'quality_score' : sort === 'valuation' ? 'valuation_score' : sort === 'technical' ? 'technical_score' : sort === 'crowding' ? 'crowding_score' : sort === 'pct_chg' ? 'pct_chg' : 'total_score';
    const sortOrder = order === 'asc' ? 1 : -1;
    rows.sort((a,b) => { const va = a[sortField] ?? -999, vb = b[sortField] ?? -999; return (va - vb) * sortOrder; });
    const total = rows.length; const p = parseInt(page), ps = parseInt(pageSize);
    const pageData = rows.slice((p-1)*ps, p*ps);
    res.json({ total, page: p, pageSize: ps, data: pageData.map(r => ({ code: r.code, name: r.name, total_score: r.total_score, signal: r.signal, quality_score: r.quality_score, valuation_score: r.valuation_score, technical_score: r.technical_score, crowding_score: r.crowding_score, crowding_level: r.crowding_level, pe: r.pe, total_mv: r.total_mv, current_price: r.current_price, target_price: r.target_price, stop_loss: r.stop_loss, pct_chg: r.daily_pct_chg, industry: r._industry, is_new_economy: r._isNewEconomy, is_oldman: r._isOldman, reason: r.reason ? JSON.parse(r.reason) : [] })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/stocks/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const info = await dbGet('SELECT * FROM stock_info WHERE code = ?', [code]);
    if (!info) return res.status(404).json({ error: '股票不存在' });
    const latestScore = await dbGet(`SELECT * FROM stock_score WHERE code = ? ORDER BY trade_date DESC LIMIT 1`, [code]);
    const val = await dbGet('SELECT * FROM valuation WHERE code = ? ORDER BY trade_date DESC LIMIT 1', [code]);
    const klines = (await dbAll(`SELECT k.trade_date, k.open, k.high, k.low, k.close, k.volume, k.pct_chg, t.ma5, t.ma10, t.ma20, t.ma60, t.macd_dif, t.macd_dea, t.macd_bar, t.rsi14, t.boll_upper, t.boll_mid, t.boll_lower FROM daily_kline k LEFT JOIN technical_indicators t USING(code, trade_date) WHERE k.code = ? ORDER BY k.trade_date DESC LIMIT 250`, [code])).reverse();
    const tech = klines[klines.length - 1];
    const financials = await dbAll(`SELECT * FROM financial_indicator WHERE code = ? ORDER BY report_date DESC LIMIT 8`, [code]);
    const valDetail = latestScore?.valuation_detail ? JSON.parse(latestScore.valuation_detail) : {};
    const qualityDetail = latestScore?.quality_detail ? JSON.parse(latestScore.quality_detail) : {};
    const qualityLatest = latestScore?.quality_latest ? JSON.parse(latestScore.quality_latest) : {};
    const techDetail = latestScore?.technical_detail ? JSON.parse(latestScore.technical_detail) : {};
    const industry = classifyIndustry(code, info.name);
    res.json({
      code, name: info.name, market: info.market, industry: industry.group.name, is_new_economy: industry.isNewEconomy, is_oldman: industry.isOldman, total_mv: info.total_mv,
      score: latestScore ? { total: latestScore.total_score, quality: latestScore.quality_score, valuation: latestScore.valuation_score, technical: latestScore.technical_score, signal: latestScore.signal, target_price: latestScore.target_price, stop_loss: latestScore.stop_loss, position_pct: latestScore.position_pct, quality_detail: qualityDetail, quality_latest: qualityLatest, valuation_detail: valDetail, technical_detail: techDetail, reason: latestScore.reason ? JSON.parse(latestScore.reason) : [] } : null,
      valuation: val ? { pe: val.pe, pe_ttm: val.pe_ttm, pb: val.pb, dv_ratio: val.dv_ratio, total_mv: val.total_mv } : null,
      klines: klines.map(k => ({ date: k.trade_date, open: k.open, close: k.close, high: k.high, low: k.low, volume: k.volume, pct_chg: k.pct_chg, ma5: k.ma5, ma10: k.ma10, ma20: k.ma20, ma60: k.ma60, macd_dif: k.macd_dif, macd_dea: k.macd_dea, macd_bar: k.macd_bar, boll_upper: k.boll_upper, boll_mid: k.boll_mid, boll_lower: k.boll_lower })),
      financials: financials.map(f => ({ report_date: f.report_date, report_type: f.report_type, roe: f.roe, gross_margin: f.gross_margin, net_margin: f.net_margin, revenue: f.revenue, revenue_yoy: f.revenue_yoy, net_profit: f.net_profit, net_profit_yoy: f.net_profit_yoy, debt_ratio: f.debt_ratio, current_ratio: f.current_ratio, eps: f.eps, roic: f.roic, ocf: f.ocf })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/industries', async (req, res) => {
  try {
    const latestDateRow = await dbGet('SELECT MAX(trade_date) as d FROM stock_score');
    const latestDate = latestDateRow?.d;
    const rows = await dbAll(`SELECT s.code, s.quality_detail, s.total_score, s.signal FROM stock_score s WHERE s.trade_date = ? AND s.strategy = 'value'`, [latestDate]);
    const industries = {};
    rows.forEach(r => { try { const qd = JSON.parse(r.quality_detail); const ind = qd.industry || '通用'; if (!industries[ind]) industries[ind] = { name: ind, count: 0, avg_score: 0, buy: 0, scores: [] }; industries[ind].count++; industries[ind].scores.push(r.total_score); if (r.signal === 'buy' || r.signal === 'watch') industries[ind].buy++; } catch(e) {} });
    const result = Object.values(industries).map(i => ({ name: i.name, count: i.count, avg_score: Math.round(i.scores.reduce((a,b)=>a+b,0) / i.scores.length), opportunities: i.buy })).sort((a,b) => b.avg_score - a.avg_score);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== 同步进度事件 ==========
const { EventEmitter } = require('events');
const syncEvents = new EventEmitter();
syncEvents.setMaxListeners(50);
let syncRunning = false;
let syncStartTime = 0;

function emitProgress(stage, message, percent, extra = {}) {
  const payload = JSON.stringify({ stage, message, percent, time: dayjs().format('HH:mm:ss'), ...extra });
  console.log('[sync]', payload);
  syncEvents.emit('progress', payload);
}

app.get('/api/sync/progress', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`retry: 3000\n`);
  res.write(`data: ${JSON.stringify({ type:'status', running: syncRunning, time: dayjs().format('HH:mm:ss') })}\n\n`);
  const onProgress = (data) => { res.write(`data: ${data}\n\n`); };
  syncEvents.on('progress', onProgress);
  req.on('close', () => { syncEvents.removeListener('progress', onProgress); });
});

app.post('/api/sync', async (req, res) => {
  // 如果上次同步超过15分钟还在running，强制重置（防止suspend导致死锁）
  if (syncRunning && syncStartTime > 0 && Date.now() - syncStartTime > 15 * 60 * 1000) {
    console.log('[sync] 检测到超时死锁，重置syncRunning');
    syncRunning = false;
  }
  if (syncRunning) return res.json({ status: 'running', message: '同步正在进行中' });
  syncRunning = true;
  syncStartTime = Date.now();
  const syncMode = req.body?.mode || req.query?.mode || 'incremental';
  const waitForComplete = req.body?.wait === true || req.query?.wait === '1';

  const doSync = (async () => {
    let result = { status: 'ok', klineCount: 0, indCount: 0, errors: 0 };
    let indCount = 0;
    try {
      const currentSettings = userSettings;
      emitProgress('init', syncMode === 'full' ? '开始全量数据同步（拉取2年历史K线）...' : '开始增量同步数据...', 0);
      let codes = await stockPool.getPoolCodes();
      if (codes.length === 0) { const infoRows = await dbAll('SELECT code FROM stock_info'); codes = infoRows.map(r => r.code).filter(c => /^\d{6}$/.test(c)); }
      if (codes.length === 0) {
        emitProgress('list', '数据库为空，加载热门股票池...', 5);
        codes = ['600519','000858','601318','600036','000333','600276','300750','601012','600900','601899','002594','601166','600030','000001','600887','601398','601288','600000','601988','600050','000725','600585','601668','601390','002475','300059','600438','002352','601888','600309','603288','000568','000596','600809','300124','002415','603501','688981','688012','688256','300760','002241','600048','601628','601601','600104','601857','600028','601088','600111','600547','601225','002460','300274'];
      }
      emitProgress('quote', `正在拉取 ${codes.length} 支股票实时行情...`, 5);
      let quotes = [];
      let klineErrors = 0;
      try { quotes = await tq.getQuickStockList(codes); } catch(e) { emitProgress('quote', `行情拉取失败: ${e.message}`, 8); }
      const nowStr = dayjs().format('YYYY-MM-DD HH:mm:ss');
      const today = dayjs().format('YYYYMMDD');
      const infoData = quotes.filter(q=>q.code&&q.name).map(q => ({ code:q.code, name:q.name, market:q.market||(q.code.startsWith('6')?'SH':'SZ'), is_st:q.is_st||(q.name&&q.name.includes('ST')?1:0), total_mv:q.total_mv, circ_mv:q.circ_mv }));
      await dbBatch(infoData.map(r => ({ sql: `INSERT OR REPLACE INTO stock_info (code,name,market,is_st,total_mv,circ_mv,updated_at) VALUES (?,?,?,?,?,?,?)`, args: [r.code, r.name, r.market, r.is_st, r.total_mv, r.circ_mv, nowStr] })));
      const valData = quotes.filter(q=>q.code&&q.pe!=null);
      await dbBatch(valData.map(q => ({ sql: `INSERT OR REPLACE INTO valuation (code,trade_date,pe) VALUES (?,?,?)`, args: [q.code, today, q.pe] })));
      emitProgress('quote', `行情更新完成：${quotes.length} 支`, 15);
      const klineHistoryDays = syncMode === 'full' ? 730 : 60;
      const klineStart = dayjs().subtract(klineHistoryDays,'day').format('YYYYMMDD');
      const klineEnd = dayjs().format('YYYYMMDD');
      emitProgress('kline', `更新K线数据（${syncMode === 'full' ? '全量2年' : '近60天增量'}）...`, 18);
      let klineCount = 0;
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        try {
          let klines = await emKline.getDailyKline(code, klineStart, klineEnd);
          // 东方财富失败则回退到腾讯+计算换手率
          if (!klines || klines.length === 0) {
            const info = await dbGet('SELECT circ_mv FROM stock_info WHERE code = ?', [code]);
            const tqKlines = await tq.getDailyKline(code, 
              dayjs(klineStart).format('YYYY-MM-DD'), 
              dayjs(klineEnd).format('YYYY-MM-DD')
            );
            if (tqKlines && tqKlines.length > 0) {
              klines = tqKlines.map(k => {
                let turnover = null;
                if (info && info.circ_mv && info.circ_mv > 0 && k.close > 0 && k.volume > 0) {
                  turnover = Math.round((k.volume * 100 * k.close / (info.circ_mv * 1e8) * 100) * 100) / 100;
                }
                return { ...k, turnover };
              });
            }
          }
          if (klines && klines.length > 0) {
            for (let j = 0; j < klines.length; j += 200) {
              await dbBatch(klines.slice(j, j+200).map(k => ({ sql: `INSERT OR REPLACE INTO daily_kline (code,trade_date,open,close,high,low,volume,amount,amplitude,pct_chg,chg,turnover) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, args: [k.code, k.trade_date, k.open, k.close, k.high, k.low, k.volume, k.amount, k.amplitude, k.pct_chg, k.chg, k.turnover] })));
            }
            klineCount += klines.length;
          }
        } catch(e) { klineErrors++; if (klineErrors <= 3) emitProgress('kline', `K线警告: ${code} 拉取失败(${e.message?.slice(0,30)})`, -1); }
        if (i % 5 === 0 || i === codes.length - 1) { const pct = syncMode === 'full' ? 18 + Math.floor((i / codes.length) * 45) : 18 + Math.floor((i / codes.length) * 35); emitProgress('kline', `K线: ${i+1}/${codes.length} (${klineCount}条${klineErrors > 0 ? `, ${klineErrors}个失败` : ''})`, pct); }
        await tq.sleep(syncMode === 'full' ? 120 : 80);
      }
      emitProgress('kline', `K线更新完成：${klineCount} 条${klineErrors > 0 ? `（${klineErrors}个失败）` : ''}`, syncMode === 'full' ? 63 : 53);

      if (syncMode === 'full') {
        const indStartPct = 65;
        emitProgress('indicator', '计算技术指标（MA/MACD/RSI/KDJ/BOLL）...', indStartPct);
        const allCodeRows = await dbAll('SELECT DISTINCT code FROM daily_kline');
        const allCodes = allCodeRows.map(r => r.code);
        indCount = 0;
        for (let i = 0; i < allCodes.length; i++) {
          const code = allCodes[i];
          const ks = await dbAll(`SELECT trade_date,close,high,low,volume FROM daily_kline WHERE code = ? ORDER BY trade_date ASC`, [code]);
          if (ks.length < 25) continue;
          const inds = calcAllIndicators(ks);
          const validInds = inds.filter(r => r.ma5 !== null);
          for (let j = 0; j < validInds.length; j += 200) {
            await dbBatch(validInds.slice(j, j+200).map(r => ({ sql: `INSERT OR REPLACE INTO technical_indicators (code,trade_date,ma5,ma10,ma20,ma60,ma120,ma250,vol_ma5,vol_ma20,macd_dif,macd_dea,macd_bar,rsi6,rsi14,kdj_k,kdj_d,kdj_j,boll_upper,boll_mid,boll_lower) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, args: [code, r.trade_date, r.ma5, r.ma10, r.ma20, r.ma60, r.ma120, r.ma250, r.vol_ma5, r.vol_ma20, r.macd_dif, r.macd_dea, r.macd_bar, r.rsi6, r.rsi14, r.kdj_k, r.kdj_d, r.kdj_j, r.boll_upper, r.boll_mid, r.boll_lower] })));
          }
          indCount++;
          if (i % 20 === 0) { const pct = indStartPct + Math.floor((i / allCodes.length) * 12); emitProgress('indicator', `指标: ${i+1}/${allCodes.length}`, pct); }
        }
        emitProgress('indicator', `技术指标计算完成：${indCount} 支`, indStartPct + 12);
        result.indCount = indCount;

        emitProgress('score', '计算多因子评分（含财务数据补全）...', 80);
        await scoreAllStocks(true, true, currentSettings);
        emitProgress('score', '评分完成', 87);
        emitProgress('short', '计算短线信号...', 88);
        try { await calcAllShortSignals(); } catch(e) { console.log('short signals error:', e.message); }
        emitProgress('short', '短线信号计算完成', 91);
        emitProgress('crowding', '计算拥挤度...', 92);
        try { await calcAllCrowding(); } catch(e) { console.log('crowding error:', e.message); }
        emitProgress('crowding', '拥挤度计算完成', 96);
        try { emitProgress('pool', '更新关注池...', 97); await stockPool.updateStockPool(200); } catch(e) { console.log('pool update error:', e.message); }
      } else {
        emitProgress('score', '增量同步：快速评分中...', 60);
        await scoreAllStocks(false, false, currentSettings);
        emitProgress('score', '评分完成', 95);
      }

      emitProgress('done', `同步完成！${quotes.length}支行情 / ${klineCount}条K线${syncMode === 'full' ? ' / 全量指标评分' : '（增量快速模式）'}${klineErrors > 0 ? `（${klineErrors}个K线拉取失败）` : ''}`, 100);
      console.log('[' + dayjs().format('YYYY-MM-DD HH:mm') + '] 同步完成 (' + syncMode + ')');
      result = { status: 'completed', mode: syncMode, quotes: quotes.length, klines: klineCount, indicators: indCount, errors: klineErrors };
    } catch(e) {
      emitProgress('error', '同步失败: ' + e.message, -1);
      console.error('同步失败:', e);
      result = { status: 'error', message: e.message };
    } finally {
      syncRunning = false;
      syncStartTime = 0;
      setTimeout(() => syncEvents.emit('progress', JSON.stringify({ type:'done', time: dayjs().format('HH:mm:ss') })), 500);
    }
    return result;
  })();

  if (waitForComplete) {
    const result = await doSync;
    return res.json(result);
  } else {
    res.json({ status: 'started', message: syncMode === 'full' ? '全量数据同步已启动' : '数据同步已启动', mode: syncMode });
    doSync.catch(e => console.error('sync error:', e));
  }
});

// ========== 分步同步 API ==========
// 解决Render免费版suspend问题：每个step在50秒内完成一批，可反复调用
// 前端/GitHub Actions通过轮询逐步完成全量同步

const SYNC_STEP_TIMEOUT = 50000; // 50秒超时，留足Render响应时间
const SYNC_BATCH_SIZE = 20;      // 每批处理20只股票的K线

// 通用分步同步状态（内存中维护，进程重启后从DB推断）
let stepSyncState = {
  kline: { offset: 0, total: 0, codes: [], done: false },
  indicators: { offset: 0, total: 0, codes: [], done: false },
  finance: { offset: 0, total: 0, codes: [], done: false },
};

function getTimeLeft(startTime) {
  return SYNC_STEP_TIMEOUT - (Date.now() - startTime);
}

app.post('/api/sync/step', async (req, res) => {
  const step = req.body?.step || req.query?.step;
  const batchSize = parseInt(req.body?.batchSize || req.query?.batchSize) || SYNC_BATCH_SIZE;

  if (!step) return res.status(400).json({ error: '缺少step参数' });

  try {
    const startTime = Date.now();
    let result = {};

    if (step === 'kline') {
      // === K线分批同步 ===
      // 如果是第一次调用或codes为空，初始化
      if (stepSyncState.kline.codes.length === 0 || stepSyncState.kline.done) {
        let codes = await stockPool.getPoolCodes();
        if (codes.length === 0) {
          const infoRows = await dbAll('SELECT code FROM stock_info');
          codes = infoRows.map(r => r.code).filter(c => /^\d{6}$/.test(c));
        }
        if (codes.length === 0) {
          // 用内置热门列表
          codes = ['600519','000858','601318','600036','000333','600276','300750','601012','600900','601899','002594','601166','600030','000001','600887','601398','601288','600000','601988','600050','000725','600585','601668','601390','002475','300059','600438','002352','601888','600309','603288','000568','000596','600809','300124','002415','603501','688981','688012','688256','300760','002241','600048','601628','601601','600104','601857','600028','601088','600111','600547','601225','002460','300274'];
        }
        stepSyncState.kline = { offset: 0, total: codes.length, codes, done: false };
      }

      const state = stepSyncState.kline;
      const klineHistoryDays = req.body?.full ? 730 : 60;
      const klineStart = dayjs().subtract(klineHistoryDays, 'day').format('YYYYMMDD');
      const klineEnd = dayjs().format('YYYYMMDD');
      let processed = 0, klineCount = 0, errors = 0;

      // 先拉取本批的实时行情（full模式下跳过以节省时间给K线拉取）
      const isFullMode = req.body?.full === true;
      const batchCodes = isFullMode ? [] : state.codes.slice(state.offset, state.offset + batchSize * 5);
      if (batchCodes.length > 0) {
        try {
          const quotes = await tq.getQuickStockList(batchCodes);
          const nowStr = dayjs().format('YYYY-MM-DD HH:mm:ss');
          const today = dayjs().format('YYYYMMDD');
          const infoData = quotes.filter(q => q.code && q.name).map(q => ({
            code: String(q.code).replace(/^(sh|sz|bj)/, ''),
            name: q.name, market: q.market || (q.code.startsWith('6') ? 'SH' : 'SZ'),
            is_st: q.is_st || (q.name && q.name.includes('ST') ? 1 : 0),
            total_mv: q.total_mv, circ_mv: q.circ_mv
          }));
          await dbBatch(infoData.map(r => ({ sql: `INSERT OR REPLACE INTO stock_info (code,name,market,is_st,total_mv,circ_mv,updated_at) VALUES (?,?,?,?,?,?,?)`, args: [r.code, r.name, r.market, r.is_st, r.total_mv, r.circ_mv, nowStr] })));
          const valData = quotes.filter(q => q.code && q.pe != null).map(q => ({
            code: String(q.code).replace(/^(sh|sz|bj)/, ''), today, pe: q.pe
          }));
          if (valData.length > 0) await dbBatch(valData.map(r => ({ sql: `INSERT OR REPLACE INTO valuation (code,trade_date,pe) VALUES (?,?,?)`, args: [r.code, r.today, r.pe] })));
        } catch(e) { console.log('[step:kline] 行情拉取失败:', e.message); }
      }

      // 拉取K线（full模式并发拉取提升效率）
      // 策略：优先用东方财富（含turnover），失败则回退到腾讯+自行计算turnover
      const klineBatchSize = isFullMode ? 3 : batchSize;
      while (state.offset < state.total && processed < klineBatchSize && getTimeLeft(startTime) > 8000) {
        // 并发拉取本批K线（最多3只并发）
        const remaining = klineBatchSize - processed;
        const concurrentBatch = Math.min(3, remaining, state.total - state.offset);
        const batchCodes = [];
        for (let b = 0; b < concurrentBatch; b++) {
          batchCodes.push(state.codes[state.offset + b]);
        }
        
        // 优先尝试东方财富K线（含换手率）
        const emPromises = batchCodes.map(code => 
          emKline.getDailyKline(code, klineStart, klineEnd).catch(e => [])
        );
        const emResults = await Promise.all(emPromises);
        
        // 对东方财富失败的股票，回退到腾讯K线并计算换手率
        const fallbackCodes = [];
        for (let i = 0; i < emResults.length; i++) {
          if (!emResults[i] || emResults[i].length === 0) {
            fallbackCodes.push(batchCodes[i]);
          }
        }
        
        let fallbackResults = [];
        if (fallbackCodes.length > 0) {
          // 获取流通市值用于计算换手率
          const circMvMap = {};
          for (const fc of fallbackCodes) {
            const info = await dbGet('SELECT circ_mv, total_mv FROM stock_info WHERE code = ?', [fc]);
            if (info) circMvMap[fc] = info;
          }
          
          const tqPromises = fallbackCodes.map(code => 
            tq.getDailyKline(code, 
              dayjs(klineStart).format('YYYY-MM-DD'), 
              dayjs(klineEnd).format('YYYY-MM-DD')
            ).catch(e => [])
          );
          const tqResults = await Promise.all(tqPromises);
          
          // 为腾讯K线计算换手率: turnover = volume(手) * 100 * close / (circ_mv * 1e8) * 100
          fallbackResults = tqResults.map((klines, idx) => {
            const code = fallbackCodes[idx];
            const info = circMvMap[code];
            if (!klines || klines.length === 0) return [];
            return klines.map(k => {
              let turnover = null;
              if (info && info.circ_mv && info.circ_mv > 0 && k.close > 0 && k.volume > 0) {
                // circ_mv是亿元，volume是手(100股/手)
                // turnover(%) = volume(手) * 100(股/手) * close / (circ_mv * 1e8) * 100
                turnover = Math.round((k.volume * 100 * k.close / (info.circ_mv * 1e8) * 100) * 100) / 100;
              }
              return { ...k, turnover };
            });
          });
        }
        
        // 合并结果写入DB
        const allKlines = [];
        for (let i = 0; i < emResults.length; i++) {
          if (emResults[i] && emResults[i].length > 0) {
            allKlines.push(...emResults[i]);
          }
        }
        for (const fr of fallbackResults) {
          if (fr && fr.length > 0) allKlines.push(...fr);
        }
        
        if (allKlines.length > 0) {
          for (let j = 0; j < allKlines.length; j += 200) {
            await dbBatch(allKlines.slice(j, j + 200).map(k => ({ sql: `INSERT OR REPLACE INTO daily_kline (code,trade_date,open,close,high,low,volume,amount,amplitude,pct_chg,chg,turnover) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, args: [k.code, k.trade_date, k.open, k.close, k.high, k.low, k.volume, k.amount, k.amplitude, k.pct_chg, k.chg, k.turnover] })));
          }
          klineCount += allKlines.length;
        }
        
        state.offset += concurrentBatch;
        processed += concurrentBatch;
      }

      state.done = state.offset >= state.total;
      result = {
        step: 'kline', processed, klineCount, errors,
        progress: `${state.offset}/${state.total}`,
        progressPct: Math.round(state.offset / state.total * 100),
        done: state.done,
        timeElapsed: Date.now() - startTime,
      };

      if (state.done) {
        stepSyncState.kline = { offset: 0, total: 0, codes: [], done: false };
      }
    } else if (step === 'indicators') {
      // === 技术指标分批计算 ===
      if (stepSyncState.indicators.codes.length === 0 || stepSyncState.indicators.done) {
        const allCodeRows = await dbAll('SELECT DISTINCT code FROM daily_kline');
        stepSyncState.indicators = { offset: 0, total: allCodeRows.length, codes: allCodeRows.map(r => r.code), done: false };
      }

      const state = stepSyncState.indicators;
      const indBatchSize = batchSize * 3; // 指标计算是本地操作，可以快一些
      let processed = 0, indCount = 0;

      while (state.offset < state.total && processed < indBatchSize && getTimeLeft(startTime) > 5000) {
        const code = state.codes[state.offset];
        try {
          // 只查必要字段，减少远程DB传输量
          const ks = await dbAll(`SELECT trade_date,close,high,low,volume FROM daily_kline WHERE code = ? ORDER BY trade_date ASC`, [code]);
          if (ks.length >= 25) {
            const inds = calcAllIndicators(ks);
            // 只写入最近250天的指标，减少DB写入量
            const recentInds = inds.slice(-250).filter(r => r.ma5 !== null);
            for (let j = 0; j < recentInds.length; j += 200) {
              await dbBatch(recentInds.slice(j, j + 200).map(r => ({ sql: `INSERT OR REPLACE INTO technical_indicators (code,trade_date,ma5,ma10,ma20,ma60,ma120,ma250,vol_ma5,vol_ma20,macd_dif,macd_dea,macd_bar,rsi6,rsi14,kdj_k,kdj_d,kdj_j,boll_upper,boll_mid,boll_lower) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, args: [code, r.trade_date, r.ma5, r.ma10, r.ma20, r.ma60, r.ma120, r.ma250, r.vol_ma5, r.vol_ma20, r.macd_dif, r.macd_dea, r.macd_bar, r.rsi6, r.rsi14, r.kdj_k, r.kdj_d, r.kdj_j, r.boll_upper, r.boll_mid, r.boll_lower] })));
            }
            indCount++;
          }
        } catch(e) {}
        state.offset++;
        processed++;
      }

      state.done = state.offset >= state.total;
      result = {
        step: 'indicators', processed, indCount,
        progress: `${state.offset}/${state.total}`,
        progressPct: Math.round(state.offset / state.total * 100),
        done: state.done,
        timeElapsed: Date.now() - startTime,
      };

      if (state.done) {
        stepSyncState.indicators = { offset: 0, total: 0, codes: [], done: false };
      }
    } else if (step === 'score') {
      // === 评分（含财务数据补全）===
      // 评分本身是一步完成，但可以限制只处理部分股票
      const fullScore = req.body?.full !== false;
      await scoreAllStocks(fullScore, fullScore, userSettings);
      result = { step: 'score', done: true, timeElapsed: Date.now() - startTime };

      // 评分后顺便算短线信号
      try { await calcAllShortSignals(); } catch(e) { console.log('[step:score] 短线信号失败:', e.message); }

    } else if (step === 'crowding') {
      // === 拥挤度计算 ===
      await calcAllCrowding();
      result = { step: 'crowding', done: true, timeElapsed: Date.now() - startTime };

    } else if (step === 'finance') {
      // === 财务数据分批拉取 ===
      if (stepSyncState.finance.codes.length === 0 || stepSyncState.finance.done) {
        const allCodeRows = await dbAll('SELECT code FROM stock_pool WHERE in_pool=1');
        stepSyncState.finance = { offset: 0, total: allCodeRows.length, codes: allCodeRows.map(r => r.code), done: false };
      }
      const state = stepSyncState.finance;
      let processed = 0, finCount = 0, errors = 0;
      while (state.offset < state.total && processed < batchSize * 2 && getTimeLeft(startTime) > 5000) {
        const code = state.codes[state.offset];
        try {
          const hasFin = (await dbGet('SELECT COUNT(*) as c FROM financial_indicator WHERE code = ?', [code]))?.c || 0;
          if (hasFin === 0) {
            const ok = await syncFinancialData(code);
            if (ok) finCount++;
          }
        } catch(e) { errors++; }
        state.offset++;
        processed++;
        await new Promise(r => setTimeout(r, 150));
      }
      state.done = state.offset >= state.total;
      result = {
        step: 'finance', processed, finCount, errors,
        progress: `${state.offset}/${state.total}`,
        progressPct: Math.round(state.offset / state.total * 100),
        done: state.done,
        timeElapsed: Date.now() - startTime,
      };
      if (state.done) {
        stepSyncState.finance = { offset: 0, total: 0, codes: [], done: false };
      }

    } else if (step === 'pool') {
      // === 股票池刷新（分批拉行情）===
      const r = await stockPool.updateStockPoolBatch(200, startTime);
      result = { step: 'pool', done: r.done, ...r, timeElapsed: Date.now() - startTime };

    } else if (step === 'status') {
      // 查询当前同步状态
      const poolCount = (await dbGet('SELECT COUNT(*) as c FROM stock_pool WHERE in_pool=1'))?.c || 0;
      const stockCount = (await dbGet('SELECT COUNT(*) as c FROM stock_info'))?.c || 0;
      const klineCount = (await dbGet('SELECT COUNT(*) as c FROM daily_kline'))?.c || 0;
      const indCount = (await dbGet('SELECT COUNT(*) as c FROM technical_indicators'))?.c || 0;
      const scoreCount = (await dbGet('SELECT COUNT(DISTINCT code) as c FROM stock_score'))?.c || 0;
      const crowdCount = (await dbGet('SELECT COUNT(DISTINCT code) as c FROM crowding_score'))?.c || 0;
      const financeCount = (await dbGet('SELECT COUNT(DISTINCT code) as c FROM financial_indicator'))?.c || 0;
      result = {
        step: 'status',
        pool: poolCount, stocks: stockCount, klines: klineCount,
        indicators: indCount, scores: scoreCount, crowding: crowdCount,
        finance: financeCount,
        klineSync: stepSyncState.kline.done ? 'idle' : `${stepSyncState.kline.offset}/${stepSyncState.kline.total}`,
        indicatorSync: stepSyncState.indicators.done ? 'idle' : `${stepSyncState.indicators.offset}/${stepSyncState.indicators.total}`,
        financeSync: stepSyncState.finance.done ? 'idle' : `${stepSyncState.finance.offset}/${stepSyncState.finance.total}`,
      };

    } else if (step === 'full-pipeline') {
      // === 一键全流程（前端轮询调用，每次返回下一步）===
      // 检查各模块状态，自动执行下一步
      const status = await getSyncStatus();
      let nextStep = null;
      let stepResult = null;

      if (status.pool < 100) {
        // 先确保股票池有数据
        const r = await stockPool.updateStockPoolBatch(200, startTime);
        nextStep = r.done ? 'kline' : 'pool';
        stepResult = { subStep: 'pool', ...r };
      } else if (status.indicators === 0 && status.klines > 0) {
        // 有K线但没指标→先算指标
        nextStep = 'indicators';
        // 执行一批指标计算
        const r = await runStepIndicators(startTime, batchSize * 3);
        stepResult = r;
      } else if (status.klines < status.pool * 100) {
        // K线不够→拉K线
        nextStep = 'kline';
        const r = await runStepKline(startTime, batchSize, req.body?.full);
        stepResult = r;
      } else if (status.indicators < status.pool && status.klines > 0) {
        // 指标不够→算指标
        nextStep = 'indicators';
        const r = await runStepIndicators(startTime, batchSize * 3);
        stepResult = r;
      } else if (status.finance < status.pool * 0.5) {
        // 财务数据不够→拉财务
        nextStep = 'finance';
        const r = await runStepFinance(startTime, batchSize * 2);
        stepResult = r;
      } else if (status.scores < status.pool) {
        // 评分不够→评分
        nextStep = 'score';
        await scoreAllStocks(false, false, userSettings);
        try { await calcAllShortSignals(); } catch(e) {}
        stepResult = { subStep: 'score', done: true };
      } else if (status.crowding < status.pool * 0.5) {
        // 拥挤度不够→算拥挤度
        nextStep = 'crowding';
        await calcAllCrowding();
        stepResult = { subStep: 'crowding', done: true };
      } else {
        // 全部完成
        nextStep = null;
        stepResult = { subStep: 'all-done', done: true };
      }

      result = { step: 'full-pipeline', nextStep, ...stepResult, status, timeElapsed: Date.now() - startTime };

    } else {
      return res.status(400).json({ error: `未知的step: ${step}` });
    }

    res.json(result);
  } catch(e) {
    console.error('[step-sync] 错误:', e);
    res.status(500).json({ error: e.message, step: req.body?.step || req.query?.step });
  }
});

// 辅助函数：获取同步状态摘要
async function getSyncStatus() {
  const poolCount = (await dbGet('SELECT COUNT(*) as c FROM stock_pool WHERE in_pool=1'))?.c || 0;
  const stockCount = (await dbGet('SELECT COUNT(*) as c FROM stock_info'))?.c || 0;
  const klineCount = (await dbGet('SELECT COUNT(*) as c FROM daily_kline'))?.c || 0;
  const indCount = (await dbGet('SELECT COUNT(*) as c FROM technical_indicators'))?.c || 0;
  const scoreCount = (await dbGet('SELECT COUNT(DISTINCT code) as c FROM stock_score'))?.c || 0;
  const crowdCount = (await dbGet('SELECT COUNT(DISTINCT code) as c FROM crowding_score'))?.c || 0;
  const financeCount = (await dbGet('SELECT COUNT(DISTINCT code) as c FROM financial_indicator'))?.c || 0;
  return { pool: poolCount, stocks: stockCount, klines: klineCount, indicators: indCount, scores: scoreCount, crowding: crowdCount, finance: financeCount };
}

// 辅助函数：执行一批K线同步
async function runStepKline(startTime, batchSize, full) {
  if (stepSyncState.kline.codes.length === 0 || stepSyncState.kline.done) {
    let codes = await stockPool.getPoolCodes();
    if (codes.length === 0) {
      const infoRows = await dbAll('SELECT code FROM stock_info');
      codes = infoRows.map(r => r.code).filter(c => /^\d{6}$/.test(c));
    }
    if (codes.length === 0) return { done: true, processed: 0, klineCount: 0 };
    stepSyncState.kline = { offset: 0, total: codes.length, codes, done: false };
  }

  const state = stepSyncState.kline;
  const klineHistoryDays = full ? 730 : 60;
  const klineStart = dayjs().subtract(klineHistoryDays, 'day').format('YYYYMMDD');
  const klineEnd = dayjs().format('YYYYMMDD');
  let processed = 0, klineCount = 0, errors = 0;

  // 行情
  const batchCodes = state.codes.slice(state.offset, state.offset + batchSize * 5);
  if (batchCodes.length > 0) {
    try {
      const quotes = await tq.getQuickStockList(batchCodes);
      const nowStr = dayjs().format('YYYY-MM-DD HH:mm:ss');
      const today = dayjs().format('YYYYMMDD');
      const infoData = quotes.filter(q => q.code && q.name).map(q => ({
        code: String(q.code).replace(/^(sh|sz|bj)/, ''),
        name: q.name, market: q.market || (q.code.startsWith('6') ? 'SH' : 'SZ'),
        is_st: q.is_st || (q.name && q.name.includes('ST') ? 1 : 0),
        total_mv: q.total_mv, circ_mv: q.circ_mv
      }));
      await dbBatch(infoData.map(r => ({ sql: `INSERT OR REPLACE INTO stock_info (code,name,market,is_st,total_mv,circ_mv,updated_at) VALUES (?,?,?,?,?,?,?)`, args: [r.code, r.name, r.market, r.is_st, r.total_mv, r.circ_mv, nowStr] })));
      const valData = quotes.filter(q => q.code && q.pe != null).map(q => ({
        code: String(q.code).replace(/^(sh|sz|bj)/, ''), today, pe: q.pe
      }));
      if (valData.length > 0) await dbBatch(valData.map(r => ({ sql: `INSERT OR REPLACE INTO valuation (code,trade_date,pe) VALUES (?,?,?)`, args: [r.code, r.today, r.pe] })));
    } catch(e) {}
  }

  while (state.offset < state.total && processed < batchSize && getTimeLeft(startTime) > 5000) {
    // 并发拉取3只股票的K线，减少网络等待
    const concurrency = Math.min(3, batchSize - processed, state.total - state.offset);
    const batchCodes = [];
    for (let c = 0; c < concurrency; c++) {
      batchCodes.push(state.codes[state.offset + c]);
    }
    
    // 优先用东方财富K线（含换手率）
    const emPromises = batchCodes.map(code => 
      emKline.getDailyKline(code, klineStart, klineEnd).catch(e => [])
    );
    const emResults = await Promise.all(emPromises);
    
    // 对东方财富失败的，回退到腾讯+计算换手率
    const allKlines = [];
    for (let i = 0; i < emResults.length; i++) {
      if (emResults[i] && emResults[i].length > 0) {
        allKlines.push(...emResults[i]);
      } else {
        // 回退到腾讯
        const code = batchCodes[i];
        try {
          const info = await dbGet('SELECT circ_mv FROM stock_info WHERE code = ?', [code]);
          const tqKlines = await tq.getDailyKline(code, 
            dayjs(klineStart).format('YYYY-MM-DD'), 
            dayjs(klineEnd).format('YYYY-MM-DD')
          );
          if (tqKlines && tqKlines.length > 0) {
            for (const k of tqKlines) {
              let turnover = null;
              if (info && info.circ_mv && info.circ_mv > 0 && k.close > 0 && k.volume > 0) {
                turnover = Math.round((k.volume * 100 * k.close / (info.circ_mv * 1e8) * 100) * 100) / 100;
              }
              allKlines.push({ ...k, turnover });
            }
          }
        } catch(e) { errors++; }
      }
      state.offset++;
      processed++;
    }
    
    if (allKlines.length > 0) {
      for (let j = 0; j < allKlines.length; j += 500) {
        await dbBatch(allKlines.slice(j, j + 500).map(k => ({ sql: `INSERT OR REPLACE INTO daily_kline (code,trade_date,open,close,high,low,volume,amount,amplitude,pct_chg,chg,turnover) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, args: [k.code, k.trade_date, k.open, k.close, k.high, k.low, k.volume, k.amount, k.amplitude, k.pct_chg, k.chg, k.turnover] })));
      }
      klineCount += allKlines.length;
    }
    await tq.sleep(50);
  }

  state.done = state.offset >= state.total;
  const r = { subStep: 'kline', processed, klineCount, errors, progress: `${state.offset}/${state.total}`, progressPct: Math.round(state.offset / state.total * 100), done: state.done };
  if (state.done) stepSyncState.kline = { offset: 0, total: 0, codes: [], done: false };
  return r;
}

// 辅助函数：执行一批指标计算
async function runStepIndicators(startTime, batchSize) {
  if (stepSyncState.indicators.codes.length === 0 || stepSyncState.indicators.done) {
    const allCodeRows = await dbAll('SELECT DISTINCT code FROM daily_kline');
    stepSyncState.indicators = { offset: 0, total: allCodeRows.length, codes: allCodeRows.map(r => r.code), done: false };
  }
  const state = stepSyncState.indicators;
  let processed = 0, indCount = 0;
  while (state.offset < state.total && processed < batchSize && getTimeLeft(startTime) > 5000) {
    const code = state.codes[state.offset];
    try {
      const ks = await dbAll(`SELECT trade_date,close,high,low,volume FROM daily_kline WHERE code = ? ORDER BY trade_date ASC`, [code]);
      if (ks.length >= 25) {
        const inds = calcAllIndicators(ks);
        const recentInds = inds.slice(-250).filter(r => r.ma5 !== null);
        for (let j = 0; j < recentInds.length; j += 200) {
          await dbBatch(recentInds.slice(j, j + 200).map(r => ({ sql: `INSERT OR REPLACE INTO technical_indicators (code,trade_date,ma5,ma10,ma20,ma60,ma120,ma250,vol_ma5,vol_ma20,macd_dif,macd_dea,macd_bar,rsi6,rsi14,kdj_k,kdj_d,kdj_j,boll_upper,boll_mid,boll_lower) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, args: [code, r.trade_date, r.ma5, r.ma10, r.ma20, r.ma60, r.ma120, r.ma250, r.vol_ma5, r.vol_ma20, r.macd_dif, r.macd_dea, r.macd_bar, r.rsi6, r.rsi14, r.kdj_k, r.kdj_d, r.kdj_j, r.boll_upper, r.boll_mid, r.boll_lower] })));
        }
        indCount++;
      }
    } catch(e) {}
    state.offset++;
    processed++;
  }
  state.done = state.offset >= state.total;
  const r = { subStep: 'indicators', processed, indCount, progress: `${state.offset}/${state.total}`, progressPct: Math.round(state.offset / state.total * 100), done: state.done };
  if (state.done) stepSyncState.indicators = { offset: 0, total: 0, codes: [], done: false };
  return r;
}

// 辅助函数：执行一批财务数据拉取
async function runStepFinance(startTime, batchSize) {
  if (stepSyncState.finance.codes.length === 0 || stepSyncState.finance.done) {
    const allCodeRows = await dbAll('SELECT code FROM stock_pool WHERE in_pool=1');
    if (allCodeRows.length === 0) return { done: true, processed: 0, finCount: 0 };
    stepSyncState.finance = { offset: 0, total: allCodeRows.length, codes: allCodeRows.map(r => r.code), done: false };
  }
  const state = stepSyncState.finance;
  let processed = 0, finCount = 0, errors = 0;
  while (state.offset < state.total && processed < batchSize && getTimeLeft(startTime) > 5000) {
    const code = state.codes[state.offset];
    try {
      const hasFin = (await dbGet('SELECT COUNT(*) as c FROM financial_indicator WHERE code = ?', [code]))?.c || 0;
      if (hasFin === 0) {
        const ok = await syncFinancialData(code);
        if (ok) finCount++;
      }
    } catch(e) { errors++; }
    state.offset++;
    processed++;
    await new Promise(r => setTimeout(r, 150));
  }
  state.done = state.offset >= state.total;
  const r = { subStep: 'finance', processed, finCount, errors, progress: `${state.offset}/${state.total}`, progressPct: Math.round(state.offset / state.total * 100), done: state.done };
  if (state.done) stepSyncState.finance = { offset: 0, total: 0, codes: [], done: false };
  return r;
}

// ========== 短线策略 API ==========
const { calcShortSignal, calcAllShortSignals, getShortOpportunities } = require('./src/strategies/short_term');

app.get('/api/short/opportunities', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    const signal = req.query.signal || '';
    const minScore = parseInt(req.query.minScore) || 60;
    let opps = await getShortOpportunities({ limit, signal, minScore });
    if (opps.length === 0) { try { await calcAllShortSignals(); opps = await getShortOpportunities({ limit, signal, minScore }); } catch(e) {} }
    res.json({ date: dayjs().format('YYYY-MM-DD'), count: opps.length, data: opps });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/short/calc', (req, res) => {
  res.json({ status: 'started' });
  setTimeout(async () => { try { await calcAllShortSignals(); } catch(e) { console.error('短线计算失败:', e.message); } }, 100);
});

app.get('/api/short/stock/:code', async (req, res) => {
  try {
    const sig = await calcShortSignal(req.params.code);
    res.json(sig || { signal: 'nodata' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ========== 加密货币 API ==========
const binance = require('./src/data/binance');

app.get('/api/crypto/market', async (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({type:'start', total: binance.HOT_PAIRS.length})}\n\n`);
    const results = [];
    for (let i = 0; i < binance.HOT_PAIRS.length; i++) {
      try {
        const r = await binance.analyzeSymbol(binance.HOT_PAIRS[i]);
        if (r) { results.push(r); res.write(`data: ${JSON.stringify({type:'data', item:r, done:i+1, total: binance.HOT_PAIRS.length})}\n\n`); }
      } catch(e) {}
      await new Promise(r=>setTimeout(r,80));
    }
    const PRIORITY = ['BTC', 'ETH', 'SOL'];
    results.sort((a,b) => { const aIdx = PRIORITY.indexOf(a.symbol); const bIdx = PRIORITY.indexOf(b.symbol); if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx; if (aIdx !== -1) return -1; if (bIdx !== -1) return 1; return Math.abs(50-b.score) - Math.abs(50-a.score); });
    res.write(`data: ${JSON.stringify({type:'done', data:results})}\n\n`);
    res.end();
  } catch(e) { res.status(500).json({error: e.message}); }
});

app.get('/api/crypto/ticker/:symbol', async (req, res) => {
  try {
    const t = await binance.getTicker(req.params.symbol.toUpperCase()+'USDT');
    const klines = await binance.getKlines(req.params.symbol.toUpperCase()+'USDT','1d',100);
    const ind = binance.calcIndicators(klines);
    res.json({ticker: t, indicators: ind, klines: klines.slice(-60)});
  } catch(e) { res.status(500).json({error: e.message}); }
});

// ========== 回测 API ==========
const { runBacktest } = require('./src/strategies/backtest');

app.post('/api/backtest/run', async (req, res) => {
  try {
    const result = await runBacktest(req.body || {});
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 数据库统计
app.get('/api/db/stats', async (req, res) => {
  try {
    const stocks = (await dbGet('SELECT COUNT(*) as c FROM stock_info')).c;
    const klines = (await dbGet('SELECT COUNT(*) as c FROM daily_kline')).c;
    const indicators = (await dbGet('SELECT COUNT(*) as c FROM technical_indicators')).c;
    const finance = (await dbGet('SELECT COUNT(*) as c FROM financial_indicator')).c;
    const latest = (await dbGet('SELECT MAX(trade_date) as d FROM daily_kline')).d;
    res.json({ stocks, klines, indicators, finance, latest_date: latest });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 设置接口（数据库持久化）
const defaultSettings = {
  valWeight: 35, qualWeight: 35, techWeight: 30,
  newEconBonus: 5, oldPenalty: 8,
  buyThreshold: 75, watchThreshold: 65, sellThreshold: 50,
  stopLoss: 15, takeProfit: 40,
  topCount: 10, autoSync: true, syncTime: '15:30',
};

async function loadSettings() {
  try {
    const rows = await dbAll('SELECT key, value FROM app_settings');
    const saved = {};
    for (const r of rows) { try { saved[r.key] = JSON.parse(r.value); } catch(e) { saved[r.key] = r.value; } }
    return { ...defaultSettings, ...saved };
  } catch(e) { return { ...defaultSettings }; }
}

async function saveSettingsToDB(settings) {
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  await dbBatch(Object.entries(settings).map(([k, v]) => ({ sql: 'INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)', args: [k, JSON.stringify(v), now] })));
}

let userSettings = { ...defaultSettings };

app.get('/api/settings', (req, res) => res.json(userSettings));
app.post('/api/settings', async (req, res) => {
  userSettings = { ...defaultSettings, ...(req.body || {}) };
  await saveSettingsToDB(userSettings);
  setTimeout(async () => {
    try {
      console.log('[settings] 设置已变更，重新计算评分...');
      await scoreAllStocks(true, true, userSettings);
      try { await calcAllCrowding(); } catch(e) {}
      try { await calcAllShortSignals(); } catch(e) {}
      console.log('[settings] 重新评分完成');
    } catch(e) { console.error('[settings] 重新评分失败:', e.message); }
  }, 100);
  res.json({ ok: true, settings: userSettings });
});

// 版本信息
app.get('/api/version', (req, res) => {
  let version = 'unknown';
  try { version = fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim(); } catch(e) {}
  res.json({ version, name: '仓位满上 TopUp', build_time: new Date().toISOString() });
});

// ========== 期权模块 ==========
const { publicClient: deribit } = require('./src/options/deribit');
const { priceOption, impliedVolatility, timeToExpiry } = require('./src/options/pricing');
const { calcProfitCurve, detectStrategy, summarizeStrategy, calcLegPnL } = require('./src/options/calculator');
const { gammaExplosion, coveredCall, protectivePut, shortStrangle, longStraddle, scanAllSignals } = require('./src/options/strategies');
const { getHistoricalKlines, calcHistoricalVolatility } = require('./src/options/marketData');
const { runAllBacktests } = require('./src/options/backtest');

// 获取期权链行情
app.get('/api/options/chain', async (req, res) => {
  try {
    const currency = (req.query.currency || 'BTC').toUpperCase();
    const expiry = req.query.expiry ? parseInt(req.query.expiry) : null;
    const maxExp = parseInt(req.query.max || '6');
    const result = await deribit.getOptionChainSummary(currency, expiry, maxExp);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 获取期权策略信号
app.get('/api/options/signals', async (req, res) => {
  try {
    const currency = (req.query.currency || 'BTC').toUpperCase();
    const bias = req.query.bias || 'neutral'; // bullish/bearish/neutral
    const volRegime = req.query.volatility || 'normal'; // high/low/normal

    const chain = await deribit.getOptionChainSummary(currency, null, 10);
    const currentPrice = chain.indexPrice;
    // 取最近3个到期日做信号
    const signals = scanAllSignals({
      currentPrice,
      chain: chain.chains,
      marketBias: bias,
      volatilityRegime: volRegime
    });

    res.json({ currency, currentPrice, signals, timestamp: new Date().toISOString() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 期权定价/Greeks计算
app.post('/api/options/greeks', (req, res) => {
  try {
    const { type, S, K, T, r = 0, sigma } = req.body;
    const Tyears = typeof T === 'number' && T > 10 ? T / 365.25 : T; // 如果T>10视为天数
    const result = priceOption(type, S, K, Tyears, r, sigma);
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 盈亏计算器
app.post('/api/options/calculator', (req, res) => {
  try {
    const { legs, currentPrice, iv = 0.6, daysToExpiry = 7, r = 0, range = 0.5, atExpiry = true } = req.body;
    if (!legs || !Array.isArray(legs) || legs.length === 0) {
      return res.status(400).json({ error: '需要至少一个期权腿' });
    }
    // 对premium=0的腿用BS模型估算当前权利金
    const T = daysToExpiry / 365.25;
    const processedLegs = legs.map(leg => {
      if (leg.premium > 0) return leg;
      // 用BS估算当前价格
      const bsPrice = priceOption(leg.type, currentPrice, leg.K, T, r, iv);
      return { ...leg, premium: Math.max(bsPrice.price, 0.01) };
    });
    // 默认显示到期日盈亏（T=0），更直观
    const curveDays = atExpiry ? 0 : daysToExpiry;
    const curve = calcProfitCurve(processedLegs, currentPrice, curveDays, iv, r, { range, steps: 200 });
    // 同时计算当前价值（非到期）
    const currentCurve = atExpiry ? calcProfitCurve(processedLegs, currentPrice, daysToExpiry, iv, r, { range, steps: 50 }) : null;
    const summary = summarizeStrategy(processedLegs, curve, currentPrice);
    res.json({ summary, curve, currentCurve, legs: processedLegs, atExpiry });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 期权策略回测
app.get('/api/options/backtest', async (req, res) => {
  try {
    const currency = (req.query.currency || 'BTC').toUpperCase();
    const symbol = currency === 'BTC' ? 'BTCUSDT' : 'ETHUSDT';
    const days = parseInt(req.query.days || '365');
    const iv = parseFloat(req.query.iv || '0.6');

    const klines = await getHistoricalKlines(symbol, '1d', days);
    const histIv = calcHistoricalVolatility(klines) || iv;
    const results = runAllBacktests(klines, { iv: histIv, otmPercent: 0.1 });
    results.historicalVolatility = (histIv * 100).toFixed(1) + '%';
    res.json(results);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 获取标的当前价格
app.get('/api/options/price', async (req, res) => {
  try {
    const currency = (req.query.currency || 'BTC').toUpperCase();
    const price = await deribit.getIndexPrice(currency);
    res.json({ currency, price, timestamp: new Date().toISOString() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ========== 数据源管理 ==========
app.get('/api/datasource', async (req, res) => {
  try {
    const force = req.query.refresh === '1';
    const status = await ds.getStatus(force);
    const labelMap = { tencent: '腾讯财经', sina: '新浪财经', yahoo: 'Yahoo Finance' };
    const activeSource = status.current === 'auto' ? Object.entries(status.sources).find(([k,v])=>v.ok)?.[0] || 'sina' : status.current;
    res.json({ current: status.current, configured: status.configured, current_label: labelMap[activeSource] || '自动', sources: Object.fromEntries(Object.entries(status.sources).map(([k, v]) => [k, { label: v.label, regions: v.regions, ok: v.ok, latency: v.latency || null, error: v.error || null }])) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/datasource', async (req, res) => {
  try { const { source } = req.body; const result = await ds.setSource(source); res.json({ ok: true, ...result }); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

// ========== 股票池管理 ==========
app.get('/api/stock-pool', async (req, res) => {
  try {
    const stocks = await dbAll(`SELECT p.*, s.total_score, s.signal, s.quality_score, s.valuation_score, s.technical_score, k.close as current_price, k.pct_chg as today_pct, v.pe FROM stock_pool p LEFT JOIN stock_score s ON p.code = s.code AND s.trade_date = (SELECT MAX(trade_date) FROM stock_score) AND s.strategy='value' LEFT JOIN (SELECT code, close, pct_chg FROM daily_kline k1 WHERE trade_date = (SELECT MAX(trade_date) FROM daily_kline WHERE code=k1.code)) k ON p.code = k.code LEFT JOIN valuation v ON p.code = v.code AND v.trade_date = (SELECT MAX(trade_date) FROM valuation) WHERE p.in_pool = 1 ORDER BY p.pool_score DESC, p.is_manual DESC`);
    const stats = await dbGet(`SELECT COUNT(*) as total, SUM(is_manual) as manual FROM stock_pool WHERE in_pool=1`);
    res.json({ stocks, stats: { total: stats.total, manual: stats.manual || 0 } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/stock-pool/refresh', async (req, res) => {
  try { const result = await stockPool.updateStockPool(200); res.json({ ok: true, ...result }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// 动态Universe更新（每月执行一次，或手动触发）
app.post('/api/universe/refresh', async (req, res) => {
  try {
    const result = await stockPool.updateUniverse();
    res.json({ ok: true, ...result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 查看Universe状态
app.get('/api/universe/stats', async (req, res) => {
  try {
    const stats = await dbGet(`SELECT COUNT(*) as total, SUM(in_universe) as active FROM stock_universe`);
    const lastUpdate = await dbGet(`SELECT MAX(updated_at) as t FROM stock_universe`);
    res.json({ total: stats.total, active: stats.active || 0, lastUpdate: lastUpdate.t });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/stock-pool/add', async (req, res) => {
  try {
    const { code, name } = req.body;
    if (!code) return res.status(400).json({ error: '缺少code' });
    const fullCode = await stockPool.addToPool(code, name, true);
    res.json({ ok: true, code: fullCode });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 新闻代理
app.get('/api/news', (req, res) => {
  const type = req.query.type || 'market';
  const mockNews = {
    market: [
      { title: 'A股三大指数集体收跌，两市成交额超1.9万亿', time: '15:00', source: '财经快讯', tag: '大盘' },
      { title: '市场放量下跌，机构建议控制仓位等待企稳', time: '15:15', source: '券商策略', tag: '策略' },
      { title: '央行公开市场净投放，资金面平稳', time: '09:45', source: '宏观', tag: '宏观' },
    ],
    stock: [
      { title: '半导体板块逆市飘红，国产替代持续推进', time: '14:20', source: '板块跟踪', tag: '板块' },
      { title: '新能源赛道集体调整，短期承压', time: '14:35', source: '盘面观察', tag: '板块' },
    ],
    global: [
      { title: '美股三大指数隔夜涨跌不一', time: '06:00', source: '全球市场', tag: '大盘' },
    ],
  };
  res.json({ items: mockNews[type] || [] });
});

// ========== 拥挤度雷达 API ==========
app.get('/api/crowding/overview', async (req, res) => {
  try {
    const today = dayjs().format('YYYYMMDD');
    const latestDateRow = await dbGet('SELECT MAX(trade_date) as d FROM crowding_score');
    const latestDate = latestDateRow?.d || today;
    const sectors = await dbAll(`SELECT * FROM sector_crowding WHERE trade_date = ? ORDER BY crowding_score DESC`, [latestDate]);
    const levels = { extreme: [], crowded: [], hot: [], warm: [], cold: [] };
    sectors.forEach(s => { if (levels[s.level]) levels[s.level].push(s); });
    const exitStocks = await dbAll(`SELECT c.*, s.total_score, s.signal as score_signal, (SELECT close FROM daily_kline WHERE code=c.code ORDER BY trade_date DESC LIMIT 1) as current_price, (SELECT pct_chg FROM daily_kline WHERE code=c.code ORDER BY trade_date DESC LIMIT 1) as pct_chg FROM crowding_score c LEFT JOIN stock_score s ON c.code = s.code AND s.trade_date = c.trade_date AND s.strategy = 'value' WHERE c.trade_date = ? AND c.action = 'exit' ORDER BY c.combined_crowding_score DESC`, [latestDate]);
    const trimStocks = await dbAll(`SELECT c.*, s.total_score, s.signal as score_signal, (SELECT close FROM daily_kline WHERE code=c.code ORDER BY trade_date DESC LIMIT 1) as current_price, (SELECT pct_chg FROM daily_kline WHERE code=c.code ORDER BY trade_date DESC LIMIT 1) as pct_chg FROM crowding_score c LEFT JOIN stock_score s ON c.code = s.code AND s.trade_date = c.trade_date AND s.strategy = 'value' WHERE c.trade_date = ? AND c.action = 'trim' ORDER BY c.combined_crowding_score DESC`, [latestDate]);
    const momentumStocks = await dbAll(`SELECT c.*, s.total_score, s.technical_score, s.quality_score, (SELECT close FROM daily_kline WHERE code=c.code ORDER BY trade_date DESC LIMIT 1) as current_price, (SELECT pct_chg FROM daily_kline WHERE code=c.code ORDER BY trade_date DESC LIMIT 1) as pct_chg FROM crowding_score c LEFT JOIN stock_score s ON c.code = s.code AND s.trade_date = c.trade_date AND s.strategy = 'value' WHERE c.trade_date = ? AND c.action = 'momentum_buy' AND (s.technical_score >= 50 OR s.technical_score IS NULL) AND s.total_score >= 45 ORDER BY s.total_score DESC`, [latestDate]);
    const coldStocks = await dbAll(`SELECT c.*, s.total_score, s.quality_score, s.valuation_score, (SELECT close FROM daily_kline WHERE code=c.code ORDER BY trade_date DESC LIMIT 1) as current_price, (SELECT pct_chg FROM daily_kline WHERE code=c.code ORDER BY trade_date DESC LIMIT 1) as pct_chg FROM crowding_score c LEFT JOIN stock_score s ON c.code = s.code AND s.trade_date = c.trade_date AND s.strategy = 'value' WHERE c.trade_date = ? AND c.level = 'cold' AND s.quality_score >= 60 AND s.valuation_score >= 55 ORDER BY s.total_score DESC LIMIT 20`, [latestDate]);
    const parseFactors = (list) => list.map(r => { let factors = {}; try { factors = JSON.parse(r.factors_json); } catch(e) {} return { ...r, factors }; });
    const avgCrowding = sectors.length > 0 ? Math.round(sectors.reduce((a,b)=>a+b.crowding_score,0)/sectors.length) : 50;
    res.json({
      date: latestDate, market_avg_crowding: avgCrowding,
      market_crowding_level: avgCrowding >= 80 ? 'extreme' : avgCrowding >= 65 ? 'crowded' : avgCrowding >= 45 ? 'hot' : avgCrowding >= 25 ? 'warm' : 'cold',
      sector_levels: { extreme: levels.extreme.length, crowded: levels.crowded.length, hot: levels.hot.length, warm: levels.warm.length, cold: levels.cold.length },
      all_sectors: sectors.map(s => ({ ...s, change_pct: null })),
      exit_signals: parseFactors(exitStocks), trim_signals: parseFactors(trimStocks),
      momentum_candidates: parseFactors(momentumStocks), cold_opportunities: parseFactors(coldStocks),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/crowding/stock/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const signal = await getCrowdingSignal(code);
    if (!signal) return res.status(404).json({ error: '股票不存在' });
    const history = await dbAll(`SELECT trade_date, combined_crowding_score, level, action FROM crowding_score WHERE code = ? ORDER BY trade_date DESC LIMIT 20`, [code]);
    res.json({ ...signal, history: history.reverse() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/crowding/calc', (req, res) => {
  res.json({ status: 'started', message: '拥挤度计算已开始' });
  setTimeout(async () => { try { await calcAllCrowding(); console.log('[' + dayjs().format('YYYY-MM-DD HH:mm') + '] 拥挤度计算完成'); } catch(e) { console.error('拥挤度计算失败:', e.message); } }, 100);
});

// ========== 持仓管理 API ==========
app.get('/api/portfolio', async (req, res) => {
  try {
    const holdings = await dbAll(`SELECT p.*, s.total_score, s.signal, s.quality_score, s.valuation_score, s.technical_score, v.pe, v.pb, (SELECT close FROM daily_kline WHERE code=p.code ORDER BY trade_date DESC LIMIT 1) as current_price, (SELECT pct_chg FROM daily_kline WHERE code=p.code ORDER BY trade_date DESC LIMIT 1) as today_pct FROM portfolio p LEFT JOIN stock_score s ON p.code = s.code AND s.trade_date = (SELECT MAX(trade_date) FROM stock_score) AND s.strategy = 'value' LEFT JOIN valuation v ON p.code = v.code AND v.trade_date = (SELECT MAX(trade_date) FROM valuation) WHERE p.status = 'holding'`);
    let totalCost = 0, totalValue = 0, totalTodayPnL = 0;
    const items = holdings.map(h => {
      const currentPrice = h.current_price || h.buy_price;
      const costValue = h.buy_price * h.shares;
      const marketValue = currentPrice * h.shares;
      const pnl = marketValue - costValue;
      const pnlPct = h.buy_price > 0 ? ((currentPrice - h.buy_price) / h.buy_price * 100) : 0;
      const yesterdayClose = h.today_pct ? currentPrice / (1 + h.today_pct/100) : currentPrice;
      const todayPnL = (currentPrice - yesterdayClose) * h.shares;
      totalCost += costValue; totalValue += marketValue; totalTodayPnL += todayPnL;
      return { ...h, current_price: currentPrice, cost_value: Math.round(costValue), market_value: Math.round(marketValue), pnl: Math.round(pnl * 100) / 100, pnl_pct: +pnlPct.toFixed(2), today_pnl: Math.round(todayPnL * 100) / 100 };
    });
    const totalPnL = totalValue - totalCost;
    const totalPnLPct = totalCost > 0 ? (totalPnL / totalCost * 100) : 0;
    res.json({ holdings: items, summary: { total_cost: Math.round(totalCost), total_value: Math.round(totalValue), total_pnl: Math.round(totalPnL * 100) / 100, total_pnl_pct: +totalPnLPct.toFixed(2), today_pnl: Math.round(totalTodayPnL * 100) / 100, count: items.length, suggested_position: 60 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/portfolio', async (req, res) => {
  try {
    const { code, name, buy_price, shares, buy_date, strategy = 'value' } = req.body;
    if (!code || !buy_price || !shares) return res.status(400).json({ error: '缺少必填字段' });
    const stockInfo = await dbGet('SELECT name FROM stock_info WHERE code=?', [code]);
    const stockName = name || stockInfo?.name || code;
    const score = await dbGet(`SELECT * FROM stock_score WHERE code=? AND strategy=? ORDER BY trade_date DESC LIMIT 1`, [code, strategy]);
    const stopLoss = +(buy_price * 0.85).toFixed(2);
    const targetPrice = score?.total_score >= 70 ? +(buy_price * 1.3).toFixed(2) : null;
    await dbRun(`INSERT OR REPLACE INTO portfolio (code,name,strategy,buy_date,buy_price,shares,stop_loss,target_price,status) VALUES (?,?,?,?,?,?,?,?,?)`, [code, stockName, strategy, buy_date || new Date().toISOString().slice(0,10), buy_price, shares, stopLoss, targetPrice, 'holding']);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/portfolio/:code', async (req, res) => {
  try { await dbRun(`UPDATE portfolio SET status='closed' WHERE code=?`, [req.params.code]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/portfolio/closed', async (req, res) => {
  try { const closed = await dbAll(`SELECT * FROM portfolio WHERE status='closed' ORDER BY buy_date DESC`); res.json({ closed }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== 服务端渲染的拥挤度页面 ==========
app.get('/crowding-radar', async (req, res) => {
  try {
    const today = dayjs().format('YYYYMMDD');
    const latestDateRow = await dbGet('SELECT MAX(trade_date) as d FROM crowding_score');
    const latestDate = latestDateRow?.d || today;
    const sectors = await dbAll(`SELECT * FROM sector_crowding WHERE trade_date = ? ORDER BY crowding_score DESC`, [latestDate]);
    const exitStocks = await dbAll(`SELECT c.*, s.total_score, s.signal as score_signal, (SELECT close FROM daily_kline WHERE code=c.code ORDER BY trade_date DESC LIMIT 1) as current_price, (SELECT pct_chg FROM daily_kline WHERE code=c.code ORDER BY trade_date DESC LIMIT 1) as pct_chg FROM crowding_score c LEFT JOIN stock_score s ON c.code = s.code AND s.trade_date = c.trade_date AND s.strategy = 'value' WHERE c.trade_date = ? AND c.action IN ('exit','trim') ORDER BY c.combined_crowding_score DESC`, [latestDate]);
    const momentumStocks = await dbAll(`SELECT c.*, s.total_score, s.technical_score, s.quality_score FROM crowding_score c LEFT JOIN stock_score s ON c.code = s.code AND s.trade_date = c.trade_date AND s.strategy = 'value' WHERE c.trade_date = ? AND c.action = 'momentum_buy' AND s.total_score >= 45 ORDER BY s.total_score DESC LIMIT 20`, [latestDate]);
    const coldStocks = await dbAll(`SELECT c.*, s.total_score, s.quality_score, s.valuation_score FROM crowding_score c LEFT JOIN stock_score s ON c.code = s.code AND s.trade_date = c.trade_date AND s.strategy = 'value' WHERE c.trade_date = ? AND c.level = 'cold' AND s.quality_score >= 60 ORDER BY s.total_score DESC LIMIT 15`, [latestDate]);
    const parseFactors = (r) => { try { return JSON.parse(r.factors_json); } catch(e) { return {}; } };
    const avgCrowding = sectors.length > 0 ? Math.round(sectors.reduce((a,b)=>a+b.crowding_score,0)/sectors.length) : 50;
    const levelColor = { extreme:'#d92d20', crowded:'#f04438', hot:'#f79009', warm:'#9e77ed', cold:'#12b76a' };
    const levelLabel = { extreme:'🚨极端危险', crowded:'⚠️拥挤预警', hot:'🔥火热', warm:'🟣动量搭车', cold:'🧊冷清' };
    const levelAdvice = { extreme:'立即减仓/清仓，踩踏风险极高', crowded:'减仓50%，锁定利润', hot:'持有不追加仓位', warm:'小仓位顺势介入，严格止损(-7%)', cold:'优质标的可逆向布局' };
    const marketLevel = avgCrowding>=80?'extreme':avgCrowding>=65?'crowded':avgCrowding>=45?'hot':avgCrowding>=25?'warm':'cold';
    const stockRow = (s, type) => {
      const f = parseFactors(s);
      const pctColor = (f.ret_5d||0)>=0?'#f04438':'#12b76a';
      return `<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:8px 12px"><b>${s.name}</b> <span style="color:#98a2b3;font-size:11px">${s.code}</span></td><td style="padding:8px 12px;text-align:center"><div style="display:inline-block;width:60px;height:8px;background:#f0f0f0;border-radius:4px;overflow:hidden"><div style="width:${s.combined_crowding_score}%;height:100%;background:${levelColor[s.level]||'#98a2b3'}"></div></div><span style="margin-left:6px;font-weight:700;color:${levelColor[s.level]||'#333'};font-size:12px">${s.combined_crowding_score}°</span></td><td style="padding:8px 12px;text-align:right;color:${pctColor};font-weight:600;font-family:monospace">${(f.ret_5d||0)>0?'+':''}${(f.ret_5d||0).toFixed?.(1)||0}%</td><td style="padding:8px 12px;text-align:right;color:${pctColor};font-weight:600;font-family:monospace">${(f.ret_20d||0)>0?'+':''}${(f.ret_20d||0).toFixed?.(1)||0}%</td><td style="padding:8px 12px;text-align:center;font-weight:600;color:#101828">${s.total_score||'-'}</td><td style="padding:8px 12px;font-size:11px;color:#667085">${(f.reasons||[]).join('、')||(type==='momentum'?'动量温和加速':type==='cold'?'优质低位':'放量加速')}</td></tr>`;
    };
    const sectorRow = (s) => `<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:6px 12px;font-weight:500">${s.sector}</td><td style="padding:6px 12px;width:50%"><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:12px;background:#f0f0f0;border-radius:6px;overflow:hidden"><div style="width:${s.crowding_score}%;height:100%;background:linear-gradient(90deg,#12b76a,#9e77ed,#f79009,#f04438,#d92d20);border-radius:6px"></div></div><span style="font-weight:700;color:${levelColor[s.level]};min-width:32px;font-size:12px">${s.crowding_score}°</span></div></td><td style="padding:6px 12px"><span style="background:${levelColor[s.level]}15;color:${levelColor[s.level]};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">${levelLabel[s.level]}</span></td><td style="padding:6px 12px;color:#98a2b3;font-size:11px">${s.stock_count}只</td></tr>`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>📡 拥挤度雷达 - 仓位满上</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;background:#f5f7fa;color:#101828;padding:24px}h1{font-size:24px;font-weight:700;margin-bottom:4px}h2{font-size:16px;font-weight:600;margin-bottom:12px}.subtitle{color:#98a2b3;font-size:13px;margin-bottom:20px}.card{background:#fff;border-radius:12px;border:1px solid #eaecf0;padding:20px;margin-bottom:16px;box-shadow:0 1px 2px rgba(16,24,40,0.04)}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}.stat{text-align:center;padding:16px;border-radius:10px}.stat-num{font-size:32px;font-weight:800;font-family:'Inter',monospace;line-height:1;margin-bottom:6px}.stat-label{font-size:12px;color:#667085;font-weight:500}table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;padding:10px 12px;background:#fafbfb;font-size:11px;color:#667085;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;border-bottom:1px solid #eaecf0}.tag{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}.back{display:inline-block;margin-bottom:16px;color:#1677ff;text-decoration:none;font-size:13px}.back:hover{text-decoration:underline}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}.two-col{grid-template-columns:1fr}}</style></head><body><a href="/" class="back">← 返回市场总览</a><h1>📡 量化拥挤度雷达</h1><p class="subtitle">识别量化资金行为模式 · 搭车加速段 · 拥挤极端前先跑 · ${dayjs().format('YYYY-MM-DD HH:mm')}</p><div class="grid"><div class="stat" style="background:${levelColor[marketLevel]}15"><div class="stat-num" style="color:${levelColor[marketLevel]}">${avgCrowding}°</div><div class="stat-label">全市场平均拥挤度</div><div class="tag" style="background:${levelColor[marketLevel]};color:#fff;margin-top:8px;font-size:11px">${levelLabel[marketLevel]}</div><div style="font-size:11px;color:#667085;margin-top:6px">${levelAdvice[marketLevel]}</div></div><div class="stat" style="background:#fff1f0"><div class="stat-num" style="color:#d92d20">${exitStocks.length}</div><div class="stat-label">🚨 减仓/清仓预警</div><div style="font-size:11px;color:#98a2b3;margin-top:6px">拥挤度≥75°，踩踏风险</div></div><div class="stat" style="background:#f9f5ff"><div class="stat-num" style="color:#9e77ed">${momentumStocks.length}</div><div class="stat-label">🟣 动量搭车候选</div><div style="font-size:11px;color:#98a2b3;margin-top:6px">拥挤度30-55°，温和加速</div></div><div class="stat" style="background:#ecfdf3"><div class="stat-num" style="color:#12b76a">${coldStocks.length}</div><div class="stat-label">🧊 冷清逆向机会</div><div style="font-size:11px;color:#98a2b3;margin-top:6px">无人关注，基本面优质</div></div></div>${exitStocks.length>0?`<div class="card" style="border-color:#f04438"><h2 style="color:#d92d20">⚠️ 拥挤度减仓预警（${exitStocks.length}只）</h2><p style="font-size:12px;color:#667085;margin-bottom:12px">以下个股拥挤度达到极端水平，量化资金一致性过高，存在踩踏风险。建议主动减仓锁定利润。</p><table><thead><tr><th>股票</th><th style="text-align:center">拥挤度</th><th style="text-align:right">5日涨幅</th><th style="text-align:right">20日涨幅</th><th style="text-align:center">综合分</th><th>信号</th></tr></thead><tbody>${exitStocks.map(s=>stockRow(s,'exit')).join('')}</tbody></table></div>`:''}<div class="card"><h2>📊 板块拥挤度热力图（${sectors.length}个板块）</h2><table><thead><tr><th>板块</th><th>拥挤度</th><th>状态</th><th>成分股</th></tr></thead><tbody>${sectors.map(s=>sectorRow(s)).join('')}</tbody></table></div><div class="two-col"><div class="card"><h2 style="color:#9e77ed">🟣 动量搭车机会（${momentumStocks.length}只）</h2><p style="font-size:12px;color:#667085;margin-bottom:12px">量化刚开始涌入，温和加速阶段。单只5-8%仓位，-7%严格止损，拥挤度到80止盈。</p><table><thead><tr><th>股票</th><th style="text-align:center">拥挤度</th><th style="text-align:right">5日</th><th style="text-align:right">20日</th><th style="text-align:center">总分</th><th>理由</th></tr></thead><tbody>${momentumStocks.slice(0,10).map(s=>stockRow(s,'momentum')).join('')}</tbody></table></div><div class="card"><h2 style="color:#12b76a">🧊 冷清逆向机会（${coldStocks.length}只）</h2><p style="font-size:12px;color:#667085;margin-bottom:12px">无人问津的优质股，基本面好+估值低+拥挤度低，适合长线布局。</p><table><thead><tr><th>股票</th><th style="text-align:center">拥挤度</th><th style="text-align:right">质量分</th><th style="text-align:right">估值分</th><th style="text-align:center">总分</th></tr></thead><tbody>${coldStocks.map(s=>{return `<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:8px 12px"><b>${s.name}</b> <span style="color:#98a2b3;font-size:11px">${s.code}</span></td><td style="padding:8px 12px;text-align:center"><span style="color:#12b76a;font-weight:700;font-size:12px">${s.combined_crowding_score}°</span></td><td style="padding:8px 12px;text-align:center;color:#12b76a;font-weight:600">${s.quality_score||'-'}</td><td style="padding:8px 12px;text-align:center;color:#f04438;font-weight:600">${s.valuation_score||'-'}</td><td style="padding:8px 12px;text-align:center;font-weight:700">${s.total_score||'-'}</td></tr>`;}).join('')}</tbody></table></div></div><div class="card" style="background:#f9fafb"><h2>💡 策略说明</h2><div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;font-size:12px"><div><b style="color:#12b76a">0-30° 冷清</b><br><span style="color:#667085">无人问津，逆向布局优质股</span></div><div><b style="color:#9e77ed">30-55° 搭车</b><br><span style="color:#667085">量化刚涌入，小仓顺势介入(-7%止损)</span></div><div><b style="color:#f79009">55-75° 持有</b><br><span style="color:#667085">趋势延续，不追加</span></div><div><b style="color:#f04438">75-90° 预警</b><br><span style="color:#667085">拥挤，减仓50%</span></div><div><b style="color:#d92d20">90°+ 极端</b><br><span style="color:#667085">踩踏风险极高，立即清仓</span></div></div></div></body></html>`;
    res.send(html);
  } catch(e) { res.status(500).send('<h1>错误</h1><p>'+e.message+'</p><p><a href="/">返回</a></p>'); }
});

// ========== 静态文件缓存策略 ==========
const staticPath = path.join(__dirname, 'web', 'dist');
app.use('/assets/', express.static(path.join(staticPath, 'assets'), {
  maxAge: '1y', immutable: false,
  setHeaders: (res) => { res.setHeader('Cache-Control', 'no-cache, must-revalidate'); }
}));

const BUILD_VERSION = Date.now().toString();
function serveIndex(req, res) {
  const indexPath = path.join(staticPath, 'index.html');
  if (!fs.existsSync(indexPath)) {
    res.status(200).send('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>仓位满上</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f7fa;color:#101828}.card{background:#fff;border-radius:12px;padding:40px;max-width:500px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.08)}h1{font-size:24px;margin-bottom:8px}.sub{color:#667085;font-size:14px;line-height:1.7}.spin{display:inline-block;width:32px;height:32px;border:3px solid #eaecf0;border-top-color:#1677ff;border-radius:50%;animation:spin 0.8s linear infinite;margin:20px 0}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="card"><div class="spin"></div><h1>🥃 仓位满上 部署中</h1><p class="sub">前端静态资源正在构建，请稍等 1-2 分钟后刷新页面…<br/>如果持续看到此页面，说明前端构建失败，请查看 Render Build Logs。</p></div></body></html>');
    return;
  }
  let html = fs.readFileSync(indexPath, 'utf-8');
  html = html.replace(/<div id="crowding-banner".*?<\/script>/s, '<div id="root"></div>');
  html = html.replace(/(\/assets\/[^"?\s]+\.(js|css))/g, '$1?v=' + BUILD_VERSION);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(html);
}
app.get('/', serveIndex);
app.get(/^\/(?!api|assets|crowding-radar)[^.]*$/, serveIndex);

// ========== 定时任务 ==========

// 提取同步逻辑为可复用函数（cron和手动触发共用）
async function runAutoSync(mode = 'incremental') {
  if (syncRunning) { console.log('[cron] 同步正在进行中，跳过'); return; }
  syncRunning = true;
  try {
    console.log(`[cron] 开始${mode === 'full' ? '全量' : '增量'}数据同步...`);
    const currentSettings = userSettings;
    let codes = await stockPool.getPoolCodes();
    if (codes.length === 0) { const infoRows = await dbAll('SELECT code FROM stock_info'); codes = infoRows.map(r => r.code).filter(c => /^\d{6}$/.test(c)); }
    if (codes.length === 0) { console.log('[cron] 无股票代码，跳过'); return; }

    // 1. 拉取实时行情
    let quotes = [];
    try { quotes = await tq.getQuickStockList(codes.slice(0, 250)); } catch(e) { console.log('[cron] 行情拉取失败:', e.message); }
    const nowStr = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const today = dayjs().format('YYYYMMDD');
    const infoData = quotes.filter(q=>q.code&&q.name).map(q => ({ code:q.code, name:q.name, market:q.market||(q.code.startsWith('6')?'SH':'SZ'), is_st:q.is_st||(q.name&&q.name.includes('ST')?1:0), total_mv:q.total_mv, circ_mv:q.circ_mv }));
    if (infoData.length > 0) await dbBatch(infoData.map(r => ({ sql: `INSERT OR REPLACE INTO stock_info (code,name,market,is_st,total_mv,circ_mv,updated_at) VALUES (?,?,?,?,?,?,?)`, args: [r.code, r.name, r.market, r.is_st, r.total_mv, r.circ_mv, nowStr] })));
    const valData = quotes.filter(q=>q.code&&q.pe!=null);
    if (valData.length > 0) await dbBatch(valData.map(q => ({ sql: `INSERT OR REPLACE INTO valuation (code,trade_date,pe) VALUES (?,?,?)`, args: [q.code, today, q.pe] })));
    console.log(`[cron] 行情更新: ${quotes.length}支`);

    // 2. 拉取K线
    const klineHistoryDays = mode === 'full' ? 730 : 60;
    const klineStart = dayjs().subtract(klineHistoryDays,'day').format('YYYYMMDD');
    const klineEnd = dayjs().format('YYYYMMDD');
    let klineCount = 0;
    for (let i = 0; i < codes.length; i++) {
      try {
        let klines = await emKline.getDailyKline(codes[i], klineStart, klineEnd);
        // 东方财富失败则回退到腾讯+计算换手率
        if (!klines || klines.length === 0) {
          const info = await dbGet('SELECT circ_mv FROM stock_info WHERE code = ?', [codes[i]]);
          const tqKlines = await tq.getDailyKline(codes[i], 
            dayjs(klineStart).format('YYYY-MM-DD'), 
            dayjs(klineEnd).format('YYYY-MM-DD')
          );
          if (tqKlines && tqKlines.length > 0) {
            klines = tqKlines.map(k => {
              let turnover = null;
              if (info && info.circ_mv && info.circ_mv > 0 && k.close > 0 && k.volume > 0) {
                turnover = Math.round((k.volume * 100 * k.close / (info.circ_mv * 1e8) * 100) * 100) / 100;
              }
              return { ...k, turnover };
            });
          }
        }
        if (klines && klines.length > 0) {
          for (let j = 0; j < klines.length; j += 200) {
            await dbBatch(klines.slice(j, j+200).map(k => ({ sql: `INSERT OR REPLACE INTO daily_kline (code,trade_date,open,close,high,low,volume,amount,amplitude,pct_chg,chg,turnover) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, args: [k.code, k.trade_date, k.open, k.close, k.high, k.low, k.volume, k.amount, k.amplitude, k.pct_chg, k.chg, k.turnover] })));
          }
          klineCount += klines.length;
        }
      } catch(e) {}
      await tq.sleep(mode === 'full' ? 120 : 60);
    }
    console.log(`[cron] K线更新: ${klineCount}条`);

    if (mode === 'full') {
      // 全量同步才重算技术指标、评分、短线、拥挤度
      // 3. 计算技术指标
      const allCodeRows = await dbAll('SELECT DISTINCT code FROM daily_kline');
      const allCodes = allCodeRows.map(r => r.code);
      let indCount = 0;
      for (let i = 0; i < allCodes.length; i++) {
        const ks = await dbAll('SELECT trade_date,close,high,low,volume FROM daily_kline WHERE code = ? ORDER BY trade_date ASC', [allCodes[i]]);
        if (ks.length < 25) continue;
        const inds = calcAllIndicators(ks);
        const validInds = inds.filter(r => r.ma5 !== null);
        for (let j = 0; j < validInds.length; j += 200) {
          await dbBatch(validInds.slice(j, j+200).map(r => ({ sql: `INSERT OR REPLACE INTO technical_indicators (code,trade_date,ma5,ma10,ma20,ma60,ma120,ma250,vol_ma5,vol_ma20,macd_dif,macd_dea,macd_bar,rsi6,rsi14,kdj_k,kdj_d,kdj_j,boll_upper,boll_mid,boll_lower) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, args: [allCodes[i], r.trade_date, r.ma5, r.ma10, r.ma20, r.ma60, r.ma120, r.ma250, r.vol_ma5, r.vol_ma20, r.macd_dif, r.macd_dea, r.macd_bar, r.rsi6, r.rsi14, r.kdj_k, r.kdj_d, r.kdj_j, r.boll_upper, r.boll_mid, r.boll_lower] })));
        }
        indCount++;
      }
      console.log(`[cron] 技术指标: ${indCount}支`);

      // 4. 评分（syncFinance=true：仅对缺少财务数据的股票拉取，已有数据的不重复拉）
      await scoreAllStocks(true, true, currentSettings);
      console.log('[cron] 评分完成');

      // 5. 短线信号
      try { await calcAllShortSignals(); } catch(e) { console.log('[cron] 短线信号失败:', e.message); }

      // 6. 拥挤度
      try { await calcAllCrowding(); } catch(e) { console.log('[cron] 拥挤度失败:', e.message); }
    } else {
      // 增量同步：只更新行情+K线+快速评分（不重算指标和拥挤度）
      console.log('[cron] 增量模式：跳过技术指标/拥挤度重算');
      await scoreAllStocks(false, false, currentSettings);
      console.log('[cron] 快速评分完成');
    }

    console.log(`[cron] ✅ ${mode === 'full' ? '全量' : '增量'}同步完成`);
  } catch(e) {
    console.error('[cron] 同步失败:', e.message);
  } finally {
    syncRunning = false;
  }
}

// 周一凌晨00:30(北京时间)更新股票池 = UTC周日16:30
cron.schedule('30 16 * * 0', async () => {
  console.log('[cron] 周一00:30(北京时间)，开始更新股票池...');
  try { const r = await stockPool.updateStockPool(200); console.log('[cron] 股票池更新完成:', r); } catch(e) { console.log('[cron] 股票池更新失败:', e.message); }
});

// 每月1号凌晨00:00(北京时间)更新动态Universe = UTC上月最后一天16:00
cron.schedule('0 16 28-31 * *', async () => {
  // 取每月最后一天的UTC16:00 = 北京时间次月1号00:00
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (tomorrow.getUTCDate() === 1) {
    console.log('[cron] 月初，开始更新动态Universe...');
    try {
      const r = await stockPool.updateUniverse();
      console.log('[cron] Universe更新完成:', r);
      // Universe更新后立即刷新股票池
      const r2 = await stockPool.updateStockPool(200);
      console.log('[cron] 股票池刷新完成:', r2);
    } catch(e) { console.log('[cron] Universe更新失败:', e.message); }
  }
});

// 工作日盘中增量同步（北京时间：10:00开盘、11:30午盘、14:00下午盘）
// 注意：cron使用UTC时间，北京时间 = UTC+8
// 增量同步：快速行情+K线+评分（不重算指标和拥挤度）
cron.schedule('0 2 * * 1-5', () => runAutoSync('incremental'));   // UTC 02:00 = 北京10:00
cron.schedule('30 3 * * 1-5', () => runAutoSync('incremental'));  // UTC 03:30 = 北京11:30
cron.schedule('0 6 * * 1-5', () => runAutoSync('incremental'));   // UTC 06:00 = 北京14:00

// 收盘后全量同步（北京时间15:30）= UTC 07:30
// 改为分步同步：先拉K线，后续指标/评分/拥挤度由GitHub Actions轮询触发
cron.schedule('30 7 * * 1-5', async () => {
  console.log('[cron] 收盘后同步：K线+行情+评分...');
  await runAutoSync('incremental');
  // 额外触发拥挤度计算
  try { await calcAllCrowding(); } catch(e) { console.log('[cron] 拥挤度失败:', e.message); }
});

// 防休眠：每10分钟自ping，保持Render免费版不进入休眠
// 这样工作日盘中cron任务才能按时触发
setInterval(async () => {
  try {
    const http = require('http');
    const port = process.env.PORT || 3001;
    http.get(`http://127.0.0.1:${port}/api/version`, (res) => {
      res.resume();
    }).on('error', () => {});
  } catch(e) {}
}, 10 * 60 * 1000);

// ========== 启动 ==========
const PORT = process.env.PORT || 3001;

async function ensureSeedData() {
  try {
    const row = await dbGet('SELECT COUNT(*) as c FROM stock_info');
    if (row.c >= 50) console.log(`[init] 数据库就绪：${row.c} 支股票`);
    else console.log(`[init] ⚠️ 数据库仅 ${row.c} 支股票，数据较少`);
  } catch(e) { console.log('[init] 数据库检查失败:', e.message); }
}

app.listen(PORT, '0.0.0.0', async () => {
  console.log('═══════════════════════════════════════');
  console.log('  🥃 仓位满上 Top Up  服务已启动');
  console.log('  API地址: http://0.0.0.0:' + PORT);
  console.log('  时间: ' + dayjs().format('YYYY-MM-DD HH:mm:ss'));
  console.log('  数据库: ' + (usePostgres ? 'Supabase/PostgreSQL' : (useTurso ? 'Turso云数据库' : '本地SQLite')));
  console.log('═══════════════════════════════════════');
  
  try { await dbIsReady(); } catch(e) { console.log('[init] 数据库初始化等待失败:', e.message); }

  try { await ds.waitReady(); console.log(`[init] 📡 数据源: ${ds.getSource().label} (${ds.getSource().name})`); } catch(e) { console.log('[init] 数据源初始化失败:', e.message); }

  // 加载设置
  try { userSettings = await loadSettings(); console.log('[init] 设置已加载'); } catch(e) { console.log('[init] 设置加载失败:', e.message); }

  await ensureSeedData();

  // 初始化动态Universe（如果数据库中为空）
  try {
    const uniRow = await dbGet('SELECT COUNT(*) as c FROM stock_universe WHERE in_universe=1');
    if (uniRow.c < 100) {
      console.log('[init] 动态Universe为空，开始从全市场拉取...');
      const r = await stockPool.updateUniverse();
      console.log(`[init] Universe更新完成: ${r.total}只`);
    } else {
      console.log(`[init] Universe已有 ${uniRow.c} 只`);
    }
  } catch(e) { console.log('[init] Universe初始化失败:', e.message); }

  // 初始化股票池
  try {
    const poolCountRow = await dbGet('SELECT COUNT(*) as c FROM stock_pool WHERE in_pool=1');
    const lastUpdateRow = await dbGet('SELECT MAX(updated_at) as t FROM stock_pool');
    const needUpdate = poolCountRow.c < 100 || !lastUpdateRow.t || dayjs().diff(dayjs(lastUpdateRow.t), 'day') >= 7;
    if (needUpdate) {
      console.log('[init] 股票池为空或过期，开始更新股票池...');
      const r = await stockPool.updateStockPool(200);
      console.log(`[init] 股票池更新完成: ${r.total}只`);
    } else { console.log(`[init] 股票池已有 ${poolCountRow.c} 只，跳过更新`); }
  } catch(e) { console.log('[init] 股票池初始化失败:', e.message); }

  // 后台尝试更新行情（轻量级，只拉行情+增量K线，不跑全量评分）
  (async () => {
    try {
      console.log('[init] 后台尝试更新行情...');
      let codes = await stockPool.getPoolCodes();
      if (codes.length === 0) { const infoRows = await dbAll('SELECT code FROM stock_info'); codes = infoRows.map(r => r.code).filter(c => /^\d{6}$/.test(c)); }
      if (codes.length === 0) throw new Error('无股票代码');
      const quotes = await Promise.race([
        tq.getQuickStockList(codes.slice(0, 100)),
        new Promise((_, rej) => setTimeout(() => rej(new Error('行情拉取超时(20s)')), 20000)),
      ]);
      const nowStr = dayjs().format('YYYY-MM-DD HH:mm:ss');
      const today = dayjs().format('YYYYMMDD');
      const infoData = quotes.filter(s=>s.code && s.name).map(q => ({code:String(q.code).replace(/^(sh|sz|bj)/,''),name:q.name,market:q.market||(String(q.code).startsWith('6')?'SH':'SZ'),is_st:q.is_st||(q.name&&q.name.includes('ST')?1:0),total_mv:q.total_mv,circ_mv:q.circ_mv}));
      await dbBatch(infoData.map(r => ({ sql: `INSERT OR REPLACE INTO stock_info (code,name,market,is_st,total_mv,circ_mv,updated_at) VALUES (?,?,?,?,?,?,?)`, args: [r.code, r.name, r.market, r.is_st, r.total_mv, r.circ_mv, nowStr] })));
      const valData = quotes.filter(q => q.code && q.pe != null).map(q => ({ code: String(q.code).replace(/^(sh|sz|bj)/,''), today, pe: q.pe }));
      await dbBatch(valData.map(r => ({ sql: `INSERT OR REPLACE INTO valuation (code,trade_date,pe) VALUES (?,?,?)`, args: [r.code, r.today, r.pe] })));
      console.log(`[init] 行情更新完成: ${quotes.length} 支`);

      // 只在评分数据完全缺失时做快速评分（不拉财务，不算拥挤度）
      const scoredRow = await dbGet('SELECT COUNT(DISTINCT code) as c FROM stock_score');
      if (scoredRow.c === 0) {
        console.log('[init] 无评分数据，快速评分中...');
        await scoreAllStocks(false, false, userSettings);
        console.log('[init] 快速评分完成');
      } else {
        console.log(`[init] 已有 ${scoredRow.c} 只评分数据，跳过`);
      }
    } catch(e) { console.log('[init] 行情/评分更新跳过(可能API受限):', e.message); }
  })();
});