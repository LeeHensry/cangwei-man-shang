/**
 * 仓位满上 Top Up - 后端API Server
 */
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

// ========== 启动前种子数据检查 ==========
// 如果数据库不存在或为空，从seed.db复制（保证Render部署时页面不会空白）
(function initSeed() {
  const dbPath = path.join(__dirname, 'data', 'stock_advisor.db');
  const seedPath = path.join(__dirname, 'data', 'seed.db');
  try {
    let needSeed = false;
    if (!fs.existsSync(dbPath)) needSeed = true;
    else {
      // 快速检查：文件太小说明是空表(刚初始化)
      const stat = fs.statSync(dbPath);
      if (stat.size < 100 * 1024) needSeed = true; // < 100KB 视为没有数据
    }
    if (needSeed && fs.existsSync(seedPath)) {
      fs.copyFileSync(seedPath, dbPath);
      console.log('[init] ✅ 已从 seed.db 恢复种子数据库');
    } else if (needSeed) {
      console.log('[init] ⚠️ 数据库为空且无 seed.db，将在首次启动时创建空表');
    }
  } catch(e) {
    console.log('[init] 种子检查失败:', e.message);
  }
})();

const db = require('./src/data/db');
const stockPool = require('./src/data/stock_pool');
const ds = require('./src/data/datasources');
// 兼容旧代码：tq.xxx → ds.xxx
const tq = ds;
const { calcAllIndicators } = require('./src/factors/indicators');
const { scoreAllStocks, classifyIndustry } = require('./src/strategies/value_score');
const { getMarketOverview, calcMarketConcentration } = require('./src/data/money_flow');
const { calcAllCrowding, getCrowdingSignal } = require('./src/factors/crowding');
const dayjs = require('dayjs');

const app = express();
app.use(cors());
app.use(express.json());

// ========== API 路由 ==========

/**
 * GET /api/market/overview
 * 市场概览：指数、温度计、信号统计
 */
app.get('/api/market/overview', async (req, res) => {
  try {
    // 获取全市场数据（含成交额、指数行情）
    const marketData = await getMarketOverview();
    // 用marketData里的完整版指数数据（带成交额）
    const indices = marketData.indices.length > 0 ? marketData.indices : await tq.getIndexQuotes();
    
    // 获取板块行情（优先数据库，为空则实时拉取）
    let sectors = db.prepare(`
      SELECT sector_code, sector_name, change_pct, leader_name, leader_pct
      FROM sector_daily ORDER BY trade_date DESC, change_pct DESC LIMIT 40
    `).all();
    if (sectors.length === 0) {
      try {
        const liveSectors = await ds.getSectorList();
        sectors = (liveSectors || []).slice(0, 40).map(s => ({
          sector_code: s.sector_code,
          sector_name: s.sector_name,
          change_pct: s.change_pct,
          leader_name: s.leader_name || '',
          leader_pct: s.leader_pct || 0,
        }));
      } catch(e) { console.error('getSectorList failed:', e.message); }
    }
    // 构造资金流近似数据（基于板块涨跌幅×估算体量）
    const sectorFlows = sectors.map(s => ({
      name: s.sector_name,
      net_inflow: Math.round(s.change_pct * 12),
      leader_name: s.leader_name, leader_pct: s.leader_pct,
    })).sort((a,b) => b.net_inflow - a.net_inflow);
    const concentration = calcMarketConcentration(sectorFlows);
    
    // 评分数据
    const latestDate = db.prepare('SELECT MAX(trade_date) as d FROM stock_score').get().d;
    const scores = db.prepare(`
      SELECT s.code, s.total_score, s.signal, s.quality_score, s.valuation_score, s.technical_score,
             v.pe, i.name, i.total_mv
      FROM stock_score s
      LEFT JOIN valuation v ON s.code = v.code AND v.trade_date = (SELECT MAX(trade_date) FROM valuation)
      LEFT JOIN stock_info i ON s.code = i.code
      WHERE s.trade_date = ? AND s.strategy = 'value'
    `).all(latestDate);
    
    // ========== 市场温度计 v2: 多维综合评分 ==========
    // 维度1: 估值（30%权重）- PE中位数
    const peValues = scores.map(s => s.pe).filter(v => v && v > 0 && v < 200);
    const medianPE = peValues.sort((a,b) => a-b)[Math.floor(peValues.length/2)] || 15;
    let valuationScore;
    if (medianPE < 10) valuationScore = 10;       // 极度低估
    else if (medianPE < 14) valuationScore = 25;  // 低估
    else if (medianPE < 20) valuationScore = 50;  // 合理
    else if (medianPE < 28) valuationScore = 72;  // 偏高
    else valuationScore = 92;                      // 泡沫
    
    // 维度2: 资金面（35%权重）
    // 成交额水平：地量(冷)→正常→天量(热)
    // 但放量要区分方向：放量上涨=过热，放量下跌=恐慌出清(偏冷)
    const totalAmount = marketData.total_amount_yi || 8000;
    const avgIdxPct = indices.reduce((a,b) => a + (b.pct_chg||0), 0) / indices.length;
    
    let moneyScore = 50;
    if (totalAmount < 6000) moneyScore = 20;       // 地量见底
    else if (totalAmount < 8000) moneyScore = 35;  // 缩量
    else if (totalAmount < 10000) moneyScore = 50; // 正常
    else if (totalAmount < 12000) moneyScore = 62; // 温和放量
    else if (totalAmount < 15000) moneyScore = 72; // 活跃
    else moneyScore = 80;                           // 天量
    
    // 放量+大涨=过热加分；放量+大跌=恐慌出清，反向减分
    if (totalAmount > 12000) {
      if (avgIdxPct > 1) moneyScore += 10;       // 天量大涨→亢奋过热
      else if (avgIdxPct < -1) moneyScore -= 20; // 天量大跌→恐慌出清(偏冷)
      else if (avgIdxPct < -0.3) moneyScore -= 10;
    }
    moneyScore = Math.max(0, Math.min(100, moneyScore));
    
    // 资金集中度修正：抱团度极高加分（趋势强化）
    const conc = concentration.concentration || 30;
    if (conc > 55) moneyScore = Math.min(95, moneyScore + 5);
    else if (conc < 20) moneyScore = Math.max(10, moneyScore - 5);
    
    // 维度3: 趋势（20%权重）
    // 用指数平均涨跌+均线位置（近20日趋势）
    let trendScore = 50;
    // avgIdxPct 已在资金面计算中定义
    // 检查上证和沪深300在20日线上方
    for (const idxCode of ['000001','000300']) {
      const kl = db.prepare(`SELECT close FROM daily_kline WHERE code=? ORDER BY trade_date DESC LIMIT 20`).all(idxCode);
      if (kl.length >= 20) {
        const ma20 = kl.reduce((a,b)=>a+b.close,0)/kl.length;
        const cur = kl[0].close;
        if (cur > ma20 * 1.02) trendScore += 15;
        else if (cur > ma20) trendScore += 5;
        else if (cur < ma20 * 0.98) trendScore -= 15;
        else trendScore -= 5;
      }
    }
    if (avgIdxPct > 1) trendScore += 15;
    else if (avgIdxPct > 0) trendScore += 5;
    else if (avgIdxPct < -2) trendScore -= 15;
    else if (avgIdxPct < -1) trendScore -= 8;
    trendScore = Math.max(0, Math.min(100, trendScore));
    
    // 指数涨跌统计
    const upIndices = indices.filter(i => i.pct_chg > 0).length;

    // 维度4: 情绪/涨跌比（15%权重）
    let sentimentScore = 50;
    if (avgIdxPct > 1.5) sentimentScore = 80;
    else if (avgIdxPct > 0.5) sentimentScore = 65;
    else if (avgIdxPct > -0.3) sentimentScore = 50;
    else if (avgIdxPct > -1) sentimentScore = 35;
    else if (avgIdxPct > -2) sentimentScore = 25;
    else sentimentScore = 15;
    
    // 综合温度 = 加权平均
    const temp = Math.round(
      valuationScore * 0.30 + moneyScore * 0.35 +
      trendScore * 0.20 + sentimentScore * 0.15
    );
    
    // 温度→描述→仓位
    let tempDesc, suggestedPos, tempColor;
    if (temp < 20) { tempDesc = '极度寒冷(地量见底)'; suggestedPos = '80-100%'; tempColor = '#12b76a'; }
    else if (temp < 35) { tempDesc = '偏冷(低估区间)'; suggestedPos = '60-80%'; tempColor = '#32d583'; }
    else if (temp < 55) { tempDesc = '温(估值合理)'; suggestedPos = '40-60%'; tempColor = '#fac515'; }
    else if (temp < 70) { tempDesc = '偏热(资金活跃)'; suggestedPos = '20-40%'; tempColor = '#f79009'; }
    else if (temp < 85) { tempDesc = '过热(警惕回调)'; suggestedPos = '10-20%'; tempColor = '#f04438'; }
    else { tempDesc = '🔥亢奋泡沫(减仓)'; suggestedPos = '0-10%'; tempColor = '#d92d20'; }
    
    // 各维度数据供前端展示
    const tempBreakdown = [
      { label: '估值', score: valuationScore, weight: '30%', detail: `PE中位数 ${medianPE.toFixed(1)}x`, color: '#12b76a' },
      { label: '资金', score: moneyScore, weight: '35%', detail: `成交${totalAmount}亿 抱团${conc}%`, color: '#2e90fa' },
      { label: '趋势', score: trendScore, weight: '20%', detail: `均线位置`, color: '#f79009' },
      { label: '情绪', score: sentimentScore, weight: '15%', detail: `均涨${avgIdxPct?.toFixed(1)||0}% ${upIndices}涨`, color: '#9e77ed' },
    ];
    
    // 信号统计
    const signalCounts = { buy: 0, watch: 0, hold: 0, sell: 0, momentum_buy: 0 };
    scores.forEach(s => { if (signalCounts[s.signal] !== undefined) signalCounts[s.signal]++; });
    
    // ========== 拥挤度雷达数据 ==========
    const today = dayjs().format('YYYYMMDD');
    const sectorCrowdingRows = db.prepare(`
      SELECT * FROM sector_crowding WHERE trade_date = ? ORDER BY crowding_score DESC
    `).all(today);
    const crowdedSectors = sectorCrowdingRows.filter(s => s.crowding_score >= 75);
    const coldSectors = sectorCrowdingRows.filter(s => s.crowding_score < 35);
    const momentumSectors = sectorCrowdingRows.filter(s => s.crowding_score >= 35 && s.crowding_score < 65);
    
    // 个股拥挤度预警（持仓相关）
    const stockWarnings = db.prepare(`
      SELECT c.code, c.name, c.combined_crowding_score, c.level, c.action, c.factors_json,
             s.signal, s.total_score
      FROM crowding_score c
      LEFT JOIN stock_score s ON c.code = s.code AND s.trade_date = c.trade_date AND s.strategy = 'value'
      WHERE c.trade_date = ? AND (c.level = 'extreme' OR c.level = 'crowded')
      ORDER BY c.combined_crowding_score DESC LIMIT 15
    `).all(today).map(r => {
      let factors = {};
      try { factors = JSON.parse(r.factors_json); } catch(e) {}
      return { ...r, ret_5d: factors.ret_5d, ret_20d: factors.ret_20d, reasons: factors.reasons || [] };
    });
    
    // 动量搭车候选（action=momentum_buy，总分>=45）
    const momentumCandidates = db.prepare(`
      SELECT c.code, c.name, c.combined_crowding_score, s.total_score, s.technical_score,
             c.factors_json, i.industry
      FROM crowding_score c
      LEFT JOIN stock_score s ON c.code = s.code AND s.trade_date = c.trade_date AND s.strategy = 'value'
      LEFT JOIN stock_info i ON c.code = i.code
      WHERE c.trade_date = ? AND c.action = 'momentum_buy'
        AND s.total_score >= 45
      ORDER BY s.total_score DESC LIMIT 10
    `).all(today).map(r => {
      let factors = {};
      try { factors = JSON.parse(r.factors_json); } catch(e) {}
      return { ...r, ret_5d: factors.ret_5d, ret_20d: factors.ret_20d, momentum_state: factors.momentum_state };
    });
    
    // TOP10 买入/关注/动量搭车
    const topStocks = scores
      .filter(s => s.signal === 'buy' || s.signal === 'watch' || s.signal === 'momentum_buy')
      .sort((a,b) => b.total_score - a.total_score)
      .slice(0, 10)
      .map(s => {
        const val = db.prepare('SELECT pe, trade_date FROM valuation WHERE code = ? ORDER BY trade_date DESC LIMIT 1').get(s.code);
        const kline = db.prepare('SELECT close, pct_chg, trade_date FROM daily_kline WHERE code = ? ORDER BY trade_date DESC LIMIT 10').all(s.code);
        const todayClose = kline[0]?.close;
        const todayPct = kline[0]?.pct_chg;
        // 近7日涨跌幅：用7天前的收盘价算
        let pct7d = null;
        if (kline.length >= 5) {
          const ref = kline[kline.length - 1]?.close;
          if (ref && todayClose) pct7d = +((todayClose / ref - 1) * 100).toFixed(2);
        }
        return {
          code: s.code, name: s.name,
          total_score: s.total_score, signal: s.signal,
          quality: s.quality_score, valuation: s.valuation_score, technical: s.technical_score,
          pe: val?.pe, close: todayClose, pct_chg: todayPct, pct_7d: pct7d,
        };
      });
    
    res.json({
      date: dayjs().format('YYYY-MM-DD HH:mm'),
      indices: indices.map(i => ({
        name: i.name, code: i.code, close: i.close, pct_chg: i.pct_chg
      })),
      temperature: {
        value: temp, label: tempDesc, suggested_position: suggestedPos,
        median_pe: +medianPE.toFixed(1), color: tempColor,
        breakdown: tempBreakdown,
        total_amount: totalAmount,
        concentration: conc,
        top_flow_sectors: concentration.top_sectors,
        worst_flow_sectors: concentration.worst_sectors,
      },
      signal_counts: signalCounts,
      top_stocks: topStocks,
      sectors: sectors.slice(0, 10),
      total_stocks: scores.length,
      // 拥挤度雷达数据
      crowding: {
        sector_crowding: sectorCrowdingRows.slice(0, 20),
        crowded_sectors: crowdedSectors,
        cold_sectors: coldSectors.slice(0, 8),
        momentum_sectors: momentumSectors.slice(0, 8),
        stock_warnings: stockWarnings,
        momentum_candidates: momentumCandidates,
        market_avg_crowding: sectorCrowdingRows.length > 0
          ? Math.round(sectorCrowdingRows.reduce((a,b)=>a+b.crowding_score,0)/sectorCrowdingRows.length)
          : 50,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/stocks
 * 信号池：分页+筛选+排序
 * Query: signal(buy/watch/hold/sell), industry, sort, order, page, pageSize, minScore
 */
app.get('/api/stocks', (req, res) => {
  try {
    const {
      signal, industry, sort = 'total_score', order = 'desc',
      page = 1, pageSize = 20, minScore, isNewEconomy, isOldman
    } = req.query;
    
    const latestDate = db.prepare('SELECT MAX(trade_date) as d FROM stock_score').get().d;
    
    let where = `WHERE s.trade_date = ? AND s.strategy = 'value'`;
    const params = [latestDate];
    
    if (signal) { where += ` AND s.signal = ?`; params.push(signal); }
    if (minScore) { where += ` AND s.total_score >= ?`; params.push(parseInt(minScore)); }
    
    // 行业筛选和新经济/老登过滤需要查quality_detail
    // 简化：直接查所有再过滤
    const latestKlineDate = db.prepare('SELECT MAX(trade_date) as d FROM daily_kline').get().d;
    let rows = db.prepare(`
      SELECT s.*, i.name, i.total_mv, v.pe,
             k.close as current_price, k.pct_chg as daily_pct_chg
      FROM stock_score s
      LEFT JOIN stock_info i ON s.code = i.code
      LEFT JOIN valuation v ON s.code = v.code AND v.trade_date = (SELECT MAX(trade_date) FROM valuation)
      LEFT JOIN daily_kline k ON s.code = k.code AND k.trade_date = ?
      ${where}
    `).all(latestKlineDate, ...params);
    
    // 过滤行业/新经济/老登
    rows = rows.map(r => {
      let ind = null;
      try { ind = JSON.parse(r.quality_detail); } catch(e) {}
      return { ...r, _industry: ind?.industry, _isNewEconomy: ind?.isNewEconomy, _isOldman: ind?.isOldman };
    });
    
    if (industry && industry !== 'all') {
      rows = rows.filter(r => r._industry && r._industry.includes(industry));
    }
    if (isNewEconomy === 'true') rows = rows.filter(r => r._isNewEconomy);
    if (isOldman === 'true') rows = rows.filter(r => r._isOldman);
    
    // 排序
    const sortField = sort === 'pe' ? 'pe' : sort === 'total_mv' ? 'total_mv' :
      sort === 'quality' ? 'quality_score' : sort === 'valuation' ? 'valuation_score' :
      sort === 'technical' ? 'technical_score' : sort === 'crowding' ? 'crowding_score' :
      sort === 'pct_chg' ? 'pct_chg' : 'total_score';
    const sortOrder = order === 'asc' ? 1 : -1;
    rows.sort((a,b) => {
      const va = a[sortField] ?? -999, vb = b[sortField] ?? -999;
      return (va - vb) * sortOrder;
    });
    
    // 分页
    const total = rows.length;
    const p = parseInt(page), ps = parseInt(pageSize);
    const pageData = rows.slice((p-1)*ps, p*ps);
    
    res.json({
      total, page: p, pageSize: ps,
      data: pageData.map(r => ({
        code: r.code, name: r.name,
        total_score: r.total_score, signal: r.signal,
        quality_score: r.quality_score,
        valuation_score: r.valuation_score,
        technical_score: r.technical_score,
        crowding_score: r.crowding_score,
        crowding_level: r.crowding_level,
        pe: r.pe, total_mv: r.total_mv,
        current_price: r.current_price,
        target_price: r.target_price,
        stop_loss: r.stop_loss,
        pct_chg: r.daily_pct_chg,
        industry: r._industry,
        is_new_economy: r._isNewEconomy,
        is_oldman: r._isOldman,
        reason: r.reason ? JSON.parse(r.reason) : [],
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/stocks/:code
 * 个股详情
 */
app.get('/api/stocks/:code', (req, res) => {
  try {
    const { code } = req.params;
    const info = db.prepare('SELECT * FROM stock_info WHERE code = ?').get(code);
    if (!info) return res.status(404).json({ error: '股票不存在' });
    
    // 最新评分
    const latestScore = db.prepare(`
      SELECT * FROM stock_score WHERE code = ? ORDER BY trade_date DESC LIMIT 1
    `).get(code);
    
    // 最新估值
    const val = db.prepare('SELECT * FROM valuation WHERE code = ? ORDER BY trade_date DESC LIMIT 1').get(code);
    
    // 最近K线（约1年，250条）
    const klines = db.prepare(`
      SELECT k.trade_date, k.open, k.high, k.low, k.close, k.volume, k.pct_chg,
             t.ma5, t.ma10, t.ma20, t.ma60, t.macd_dif, t.macd_dea, t.macd_bar, t.rsi14,
             t.boll_upper, t.boll_mid, t.boll_lower
      FROM daily_kline k LEFT JOIN technical_indicators t USING(code, trade_date)
      WHERE k.code = ? ORDER BY k.trade_date DESC LIMIT 250
    `).all(code).reverse();
    
    // 最新技术指标
    const tech = klines[klines.length - 1];
    
    // 财务数据
    const financials = db.prepare(`
      SELECT * FROM financial_indicator WHERE code = ? ORDER BY report_date DESC LIMIT 8
    `).all(code);
    
    // 估值历史（收盘价位置计算）
    const valDetail = latestScore?.valuation_detail ? JSON.parse(latestScore.valuation_detail) : {};
    const qualityDetail = latestScore?.quality_detail ? JSON.parse(latestScore.quality_detail) : {};
    const qualityLatest = latestScore?.quality_latest ? JSON.parse(latestScore.quality_latest) : {};
    const techDetail = latestScore?.technical_detail ? JSON.parse(latestScore.technical_detail) : {};
    
    // 行业分类
    const industry = classifyIndustry(code, info.name);
    
    res.json({
      code, name: info.name, market: info.market, industry: industry.group.name,
      is_new_economy: industry.isNewEconomy, is_oldman: industry.isOldman,
      total_mv: info.total_mv,
      score: latestScore ? {
        total: latestScore.total_score,
        quality: latestScore.quality_score,
        valuation: latestScore.valuation_score,
        technical: latestScore.technical_score,
        signal: latestScore.signal,
        target_price: latestScore.target_price,
        stop_loss: latestScore.stop_loss,
        position_pct: latestScore.position_pct,
        quality_detail: qualityDetail,
        quality_latest: qualityLatest,
        valuation_detail: valDetail,
        technical_detail: techDetail,
        reason: latestScore.reason ? JSON.parse(latestScore.reason) : [],
      } : null,
      valuation: val ? { pe: val.pe, pe_ttm: val.pe_ttm, pb: val.pb, dv_ratio: val.dv_ratio, total_mv: val.total_mv } : null,
      klines: klines.map(k => ({
        date: k.trade_date,
        open: k.open, close: k.close, high: k.high, low: k.low,
        volume: k.volume, pct_chg: k.pct_chg,
        ma5: k.ma5, ma10: k.ma10, ma20: k.ma20, ma60: k.ma60,
        macd_dif: k.macd_dif, macd_dea: k.macd_dea, macd_bar: k.macd_bar,
        boll_upper: k.boll_upper, boll_mid: k.boll_mid, boll_lower: k.boll_lower,
      })),
      financials: financials.map(f => ({
        report_date: f.report_date, report_type: f.report_type,
        roe: f.roe, gross_margin: f.gross_margin, net_margin: f.net_margin,
        revenue: f.revenue, revenue_yoy: f.revenue_yoy,
        net_profit: f.net_profit, net_profit_yoy: f.net_profit_yoy,
        debt_ratio: f.debt_ratio, current_ratio: f.current_ratio,
        eps: f.eps, roic: f.roic, ocf: f.ocf,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/industries
 * 行业列表
 */
app.get('/api/industries', (req, res) => {
  const latestDate = db.prepare('SELECT MAX(trade_date) as d FROM stock_score').get().d;
  const rows = db.prepare(`
    SELECT s.code, s.quality_detail, s.total_score, s.signal
    FROM stock_score s WHERE s.trade_date = ? AND s.strategy = 'value'
  `).all(latestDate);
  
  const industries = {};
  rows.forEach(r => {
    try {
      const qd = JSON.parse(r.quality_detail);
      const ind = qd.industry || '通用';
      if (!industries[ind]) industries[ind] = { name: ind, count: 0, avg_score: 0, buy: 0, scores: [] };
      industries[ind].count++;
      industries[ind].scores.push(r.total_score);
      if (r.signal === 'buy' || r.signal === 'watch') industries[ind].buy++;
    } catch(e) {}
  });
  
  const result = Object.values(industries).map(i => ({
    name: i.name, count: i.count,
    avg_score: Math.round(i.scores.reduce((a,b)=>a+b,0) / i.scores.length),
    opportunities: i.buy,
  })).sort((a,b) => b.avg_score - a.avg_score);
  
  res.json(result);
});

// ========== 同步进度事件 ==========
const { EventEmitter } = require('events');
const syncEvents = new EventEmitter();
syncEvents.setMaxListeners(50);
let syncRunning = false;

function emitProgress(stage, message, percent, extra = {}) {
  const payload = JSON.stringify({ stage, message, percent, time: dayjs().format('HH:mm:ss'), ...extra });
  console.log('[sync]', payload);
  syncEvents.emit('progress', payload);
}

// SSE 进度订阅端点
app.get('/api/sync/progress', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 3000\n`);
  // 发送当前状态
  res.write(`data: ${JSON.stringify({ type:'status', running: syncRunning, time: dayjs().format('HH:mm:ss') })}\n\n`);
  const onProgress = (data) => { res.write(`data: ${data}\n\n`); };
  syncEvents.on('progress', onProgress);
  req.on('close', () => { syncEvents.removeListener('progress', onProgress); });
});

/**
 * POST /api/sync
 * 触发数据同步和评分（通过SSE推送进度）
 */
app.post('/api/sync', async (req, res) => {
  if (syncRunning) {
    return res.json({ status: 'running', message: '同步正在进行中' });
  }
  syncRunning = true;
  res.json({ status: 'started', message: '数据同步已启动' });
  
  // 异步执行
  (async () => {
    try {
      emitProgress('init', '开始同步数据...', 0);
      // 优先使用股票池，其次stock_info，最后兜底热门股票
      let codes = stockPool.getPoolCodes();
      if (codes.length === 0) {
        codes = db.prepare('SELECT code FROM stock_info').all().map(r => r.code).filter(c => /^\d{6}$/.test(c));
      }
      
      if (codes.length === 0) {
        // 首次同步：拉取热门股票池作为种子（股票池更新会扩大到200只）
        emitProgress('list', '数据库为空，加载热门股票池...', 5);
        const hotCodes = [
          '600519','000858','601318','600036','000333','600276',
          '300750','601012','600900','601899','002594','601166',
          '600030','000001','600887','601398','601288','600000',
          '601988','600050','000725','600585','601668','601390',
          '002475','300059','600438','002352','601888','600309',
          '603288','000568','000596','600809','300124','002415',
          '603501','688981','688012','688256','300760','002241',
          '600048','601628','601601','600104','601857','600028',
          '601088','600111','600547','601225','002460','300274',
        ];
        codes = hotCodes;
      }
      
      // 1. 更新行情
      emitProgress('quote', `正在拉取 ${codes.length} 支股票实时行情...`, 10);
      const quotes = await tq.getQuickStockList(codes);
      const stmt = db.prepare(`INSERT OR REPLACE INTO stock_info (code,name,market,is_st,total_mv,circ_mv,updated_at) VALUES (?,?,?,?,?,?,?)`);
      const insInfo = db.transaction((rows) => { for(const r of rows) stmt.run(r.code,r.name,r.market,r.is_st||0,r.total_mv,r.circ_mv,dayjs().format('YYYY-MM-DD HH:mm:ss')); });
      insInfo(quotes.filter(q=>q.code&&q.name).map(q => ({code:q.code,name:q.name,market:q.market||(q.code.startsWith('6')?'SH':'SZ'),is_st:q.is_st||(q.name&&q.name.includes('ST')?1:0),total_mv:q.total_mv,circ_mv:q.circ_mv})));
      // 同时把PE写入valuation表
      const today = dayjs().format('YYYYMMDD');
      const vstmt = db.prepare(`INSERT OR REPLACE INTO valuation (code,trade_date,pe) VALUES (?,?,?)`);
      const insVal = db.transaction((rows) => { for(const r of rows) if(r.pe != null) vstmt.run(r.code, today, r.pe); });
      insVal(quotes.filter(q=>q.code&&q.pe!=null));
      emitProgress('quote', `行情更新完成：${quotes.length} 支`, 25);
      
      // 2. 更新K线（最近7天，全量codes但每批更新）
      emitProgress('kline', `更新K线数据...`, 30);
      const klineStart = dayjs().subtract(60,'day').format('YYYY-MM-DD');
      const klineEnd = dayjs().format('YYYY-MM-DD');
      const kstmt = db.prepare(`INSERT OR REPLACE INTO daily_kline (code,trade_date,open,close,high,low,volume,amount,amplitude,pct_chg,chg,turnover) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
      let klineCount = 0;
      const klineCodes = codes; // 拉取全量股票池K线（最多200只）
      for (let i = 0; i < klineCodes.length; i++) {
        const code = klineCodes[i];
        try {
          const klines = await tq.getDailyKline(code, klineStart, klineEnd);
          if (klines.length > 0) {
            const kins = db.transaction((rows) => { for(const k of rows) kstmt.run(k.code,k.trade_date,k.open,k.close,k.high,k.low,k.volume,k.amount,k.amplitude,k.pct_chg,k.chg,k.turnover); });
            kins(klines);
            klineCount += klines.length;
          }
        } catch(e) {}
        if (i % 10 === 0) {
          const pct = 30 + Math.floor((i / klineCodes.length) * 25);
          emitProgress('kline', `K线: ${i+1}/${klineCodes.length} (${klineCount}条)`, pct);
        }
        await tq.sleep(80);
      }
      emitProgress('kline', `K线更新完成：${klineCount} 条`, 55);
      
      // 3. 计算技术指标
      emitProgress('indicator', '计算技术指标（MA/MACD/RSI/KDJ/BOLL）...', 60);
      const allCodes = db.prepare('SELECT DISTINCT code FROM daily_kline').all().map(r => r.code);
      let indCount = 0;
      for (let i = 0; i < allCodes.length; i++) {
        const code = allCodes[i];
        const ks = db.prepare(`SELECT * FROM daily_kline WHERE code = ? ORDER BY trade_date ASC`).all(code);
        if (ks.length < 25) continue;
        const inds = calcAllIndicators(ks);
        const istmt = db.prepare(`INSERT OR REPLACE INTO technical_indicators (code,trade_date,ma5,ma10,ma20,ma60,ma120,ma250,vol_ma5,vol_ma20,macd_dif,macd_dea,macd_bar,rsi6,rsi14,kdj_k,kdj_d,kdj_j,boll_upper,boll_mid,boll_lower) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
        const iins = db.transaction((rows) => { for(const r of rows) if(r.ma5!==null) istmt.run(code,r.trade_date,r.ma5,r.ma10,r.ma20,r.ma60,r.ma120,r.ma250,r.vol_ma5,r.vol_ma20,r.macd_dif,r.macd_dea,r.macd_bar,r.rsi6,r.rsi14,r.kdj_k,r.kdj_d,r.kdj_j,r.boll_upper,r.boll_mid,r.boll_lower); });
        iins(inds);
        indCount++;
        if (i % 20 === 0) {
          const pct = 60 + Math.floor((i / allCodes.length) * 15);
          emitProgress('indicator', `指标: ${i+1}/${allCodes.length}`, pct);
        }
      }
      emitProgress('indicator', `技术指标计算完成：${indCount} 支`, 75);
      
      // 4. 计算评分
      emitProgress('score', '计算多因子评分...', 80);
      await scoreAllStocks(false);
      emitProgress('score', '评分完成', 90);
      
      // 5. 计算拥挤度
      emitProgress('crowding', '计算拥挤度...', 93);
      try { calcAllCrowding(); } catch(e) { console.log('crowding error:', e.message); }
      emitProgress('crowding', '拥挤度计算完成', 97);

      // 同步完更新股票池
      try {
        emitProgress('pool', '更新关注池...', 99);
        await stockPool.updateStockPool(200);
      } catch(e) { console.log('pool update error:', e.message); }

      emitProgress('done', `同步完成！${quotes.length}支行情 / ${klineCount}条K线 / ${indCount}支评分 / 200关注池`, 100);
      console.log('[' + dayjs().format('YYYY-MM-DD HH:mm') + '] 同步完成');
    } catch(e) {
      emitProgress('error', '同步失败: ' + e.message, -1);
      console.error('同步失败:', e);
    } finally {
      syncRunning = false;
      setTimeout(() => syncEvents.emit('progress', JSON.stringify({ type:'done', time: dayjs().format('HH:mm:ss') })), 500);
    }
  })();
});

// ========== 短线策略 API ==========
const { calcShortSignal, calcAllShortSignals, getShortOpportunities } = require('./src/strategies/short_term');

// GET /api/short/opportunities - 短线机会列表
app.get('/api/short/opportunities', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    const signal = req.query.signal || '';
    const minScore = parseInt(req.query.minScore) || 60;
    let opps = getShortOpportunities({ limit, signal, minScore });
    // 如果没有现成结果，触发一次计算
    if (opps.length === 0) {
      try { calcAllShortSignals(); opps = getShortOpportunities({ limit, signal, minScore }); } catch(e){}
    }
    res.json({ date: dayjs().format('YYYY-MM-DD'), count: opps.length, data: opps });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/short/calc - 手动触发短线信号计算
app.post('/api/short/calc', (req, res) => {
  res.json({ status: 'started' });
  setTimeout(() => {
    try { calcAllShortSignals(); } catch(e) { console.error('短线计算失败:', e.message); }
  }, 100);
});

// GET /api/short/stock/:code - 单只股票短线信号
app.get('/api/short/stock/:code', (req, res) => {
  try {
    const sig = calcShortSignal(req.params.code);
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
        if (r) {
          results.push(r);
          res.write(`data: ${JSON.stringify({type:'data', item:r, done:i+1, total: binance.HOT_PAIRS.length})}\n\n`);
        }
      } catch(e) {}
      await new Promise(r=>setTimeout(r,80));
    }
    // BTC/ETH/SOL 固定置顶，其余按信号强度排序
    const PRIORITY = ['BTC', 'ETH', 'SOL'];
    results.sort((a,b) => {
      const aIdx = PRIORITY.indexOf(a.symbol);
      const bIdx = PRIORITY.indexOf(b.symbol);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return Math.abs(50-b.score) - Math.abs(50-a.score);
    });
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

app.post('/api/backtest/run', (req, res) => {
  try {
    const result = runBacktest(req.body || {});
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 数据库统计
app.get('/api/db/stats', (req, res) => {
  try {
    const stocks = db.prepare('SELECT COUNT(*) as c FROM stock_info').get().c;
    const klines = db.prepare('SELECT COUNT(*) as c FROM daily_kline').get().c;
    const indicators = db.prepare('SELECT COUNT(*) as c FROM technical_indicators').get().c;
    const finance = db.prepare('SELECT COUNT(*) as c FROM financial_indicator').get().c;
    const latest = db.prepare('SELECT MAX(trade_date) as d FROM daily_kline').get().d;
    res.json({ stocks, klines, indicators, finance, latest_date: latest });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 设置接口（内存存储，重启后恢复默认）
const defaultSettings = {
  valWeight: 35, qualWeight: 35, techWeight: 30,
  newEconBonus: 5, oldPenalty: 8,
  buyThreshold: 75, watchThreshold: 65, sellThreshold: 50,
  stopLoss: 15, takeProfit: 40,
  topCount: 10, autoSync: true, syncTime: '15:30',
};
let userSettings = { ...defaultSettings };
app.get('/api/settings', (req, res) => res.json(userSettings));
app.post('/api/settings', (req, res) => {
  userSettings = { ...defaultSettings, ...(req.body || {}) };
  res.json({ ok: true, settings: userSettings });
});

// 版本信息
app.get('/api/version', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  let version = 'unknown';
  try { version = fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim(); } catch(e) {}
  res.json({
    version,
    name: '仓位满上 TopUp',
    build_time: new Date().toISOString(),
  });
});

// ========== 数据源管理 ==========
app.get('/api/datasource', async (req, res) => {
  try {
    const force = req.query.refresh === '1';
    const status = await ds.getStatus(force);
    const labelMap = { tencent: '腾讯财经', sina: '新浪财经', yahoo: 'Yahoo Finance' };
    const activeSource = status.current === 'auto'
      ? Object.entries(status.sources).find(([k,v])=>v.ok)?.[0] || 'sina'
      : status.current;
    res.json({
      current: status.current,
      configured: status.configured,
      current_label: labelMap[activeSource] || '自动',
      sources: Object.fromEntries(
        Object.entries(status.sources).map(([k, v]) => [k, {
          label: v.label,
          regions: v.regions,
          ok: v.ok,
          latency: v.latency || null,
          error: v.error || null,
        }])
      ),
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/datasource', async (req, res) => {
  try {
    const { source } = req.body;
    const result = await ds.setSource(source);
    res.json({ ok: true, ...result });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// ========== 股票池管理 ==========
app.get('/api/stock-pool', (req, res) => {
  try {
    const stocks = db.prepare(`
      SELECT p.*, s.total_score, s.signal, s.quality_score, s.valuation_score, s.technical_score,
             k.close as current_price, k.pct_chg as today_pct,
             v.pe
      FROM stock_pool p
      LEFT JOIN stock_score s ON p.code = s.code AND s.trade_date = (SELECT MAX(trade_date) FROM stock_score) AND s.strategy='value'
      LEFT JOIN (SELECT code, close, pct_chg FROM daily_kline k1 WHERE trade_date = (SELECT MAX(trade_date) FROM daily_kline WHERE code=k1.code)) k ON p.code = k.code
      LEFT JOIN valuation v ON p.code = v.code AND v.trade_date = (SELECT MAX(trade_date) FROM valuation)
      WHERE p.in_pool = 1
      ORDER BY p.pool_score DESC, p.is_manual DESC
    `).all();
    const stats = db.prepare(`SELECT COUNT(*) as total, SUM(is_manual) as manual FROM stock_pool WHERE in_pool=1`).get();
    res.json({ stocks, stats: { total: stats.total, manual: stats.manual || 0 } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/stock-pool/refresh', async (req, res) => {
  try {
    const result = await stockPool.updateStockPool(200);
    res.json({ ok: true, ...result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/stock-pool/add', (req, res) => {
  try {
    const { code, name } = req.body;
    if (!code) return res.status(400).json({ error: '缺少code' });
    const fullCode = stockPool.addToPool(code, name, true);
    res.json({ ok: true, code: fullCode });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 新闻代理（暂用模拟数据，后续接入真实财经API）
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

/**
 * GET /api/crowding/overview
 * 拥挤度概览：板块热力图+预警+搭车机会
 */
app.get('/api/crowding/overview', (req, res) => {
  try {
    const today = dayjs().format('YYYYMMDD');
    const latestDate = db.prepare('SELECT MAX(trade_date) as d FROM crowding_score').get().d || today;
    
    // 全板块拥挤度
    const sectors = db.prepare(`
      SELECT * FROM sector_crowding WHERE trade_date = ? ORDER BY crowding_score DESC
    `).all(latestDate);
    
    // 按等级分组
    const levels = { extreme: [], crowded: [], hot: [], warm: [], cold: [] };
    sectors.forEach(s => {
      if (levels[s.level]) levels[s.level].push(s);
    });
    
    // 极端拥挤个股（action=exit）
    const exitStocks = db.prepare(`
      SELECT c.*, s.total_score, s.signal as score_signal,
             (SELECT close FROM daily_kline WHERE code=c.code ORDER BY trade_date DESC LIMIT 1) as current_price,
             (SELECT pct_chg FROM daily_kline WHERE code=c.code ORDER BY trade_date DESC LIMIT 1) as pct_chg
      FROM crowding_score c
      LEFT JOIN stock_score s ON c.code = s.code AND s.trade_date = c.trade_date AND s.strategy = 'value'
      WHERE c.trade_date = ? AND c.action = 'exit'
      ORDER BY c.combined_crowding_score DESC
    `).all(latestDate);
    
    // 拥挤预警个股（action=trim）
    const trimStocks = db.prepare(`
      SELECT c.*, s.total_score, s.signal as score_signal,
             (SELECT close FROM daily_kline WHERE code=c.code ORDER BY trade_date DESC LIMIT 1) as current_price,
             (SELECT pct_chg FROM daily_kline WHERE code=c.code ORDER BY trade_date DESC LIMIT 1) as pct_chg
      FROM crowding_score c
      LEFT JOIN stock_score s ON c.code = s.code AND s.trade_date = c.trade_date AND s.strategy = 'value'
      WHERE c.trade_date = ? AND c.action = 'trim'
      ORDER BY c.combined_crowding_score DESC
    `).all(latestDate);
    
    // 动量搭车个股
    const momentumStocks = db.prepare(`
      SELECT c.*, s.total_score, s.technical_score, s.quality_score,
             (SELECT close FROM daily_kline WHERE code=c.code ORDER BY trade_date DESC LIMIT 1) as current_price,
             (SELECT pct_chg FROM daily_kline WHERE code=c.code ORDER BY trade_date DESC LIMIT 1) as pct_chg
      FROM crowding_score c
      LEFT JOIN stock_score s ON c.code = s.code AND s.trade_date = c.trade_date AND s.strategy = 'value'
      WHERE c.trade_date = ? AND c.action = 'momentum_buy'
        AND (s.technical_score >= 50 OR s.technical_score IS NULL)
        AND s.total_score >= 45
      ORDER BY s.total_score DESC
    `).all(latestDate);
    
    // 冷清逆向机会
    const coldStocks = db.prepare(`
      SELECT c.*, s.total_score, s.quality_score, s.valuation_score,
             (SELECT close FROM daily_kline WHERE code=c.code ORDER BY trade_date DESC LIMIT 1) as current_price,
             (SELECT pct_chg FROM daily_kline WHERE code=c.code ORDER BY trade_date DESC LIMIT 1) as pct_chg
      FROM crowding_score c
      LEFT JOIN stock_score s ON c.code = s.code AND s.trade_date = c.trade_date AND s.strategy = 'value'
      WHERE c.trade_date = ? AND c.level = 'cold'
        AND s.quality_score >= 60 AND s.valuation_score >= 55
      ORDER BY s.total_score DESC LIMIT 20
    `).all(latestDate);
    
    // 解析factors_json
    const parseFactors = (list) => list.map(r => {
      let factors = {};
      try { factors = JSON.parse(r.factors_json); } catch(e) {}
      return { ...r, factors };
    });
    
    const avgCrowding = sectors.length > 0
      ? Math.round(sectors.reduce((a,b)=>a+b.crowding_score,0)/sectors.length)
      : 50;
    
    res.json({
      date: latestDate,
      market_avg_crowding: avgCrowding,
      market_crowding_level: avgCrowding >= 80 ? 'extreme' : avgCrowding >= 65 ? 'crowded' : avgCrowding >= 45 ? 'hot' : avgCrowding >= 25 ? 'warm' : 'cold',
      sector_levels: {
        extreme: levels.extreme.length,
        crowded: levels.crowded.length,
        hot: levels.hot.length,
        warm: levels.warm.length,
        cold: levels.cold.length,
      },
      all_sectors: sectors.map(s => ({
        ...s,
        change_pct: null, // 后续可join sector_daily
      })),
      exit_signals: parseFactors(exitStocks),
      trim_signals: parseFactors(trimStocks),
      momentum_candidates: parseFactors(momentumStocks),
      cold_opportunities: parseFactors(coldStocks),
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/crowding/stock/:code
 * 单只股票的拥挤度详情
 */
app.get('/api/crowding/stock/:code', (req, res) => {
  try {
    const { code } = req.params;
    const signal = getCrowdingSignal(code);
    if (!signal) return res.status(404).json({ error: '股票不存在' });
    
    // 近20日拥挤度历史
    const history = db.prepare(`
      SELECT trade_date, combined_crowding_score, level, action FROM crowding_score
      WHERE code = ? ORDER BY trade_date DESC LIMIT 20
    `).all(code).reverse();
    
    res.json({ ...signal, history });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/crowding/calc
 * 手动触发拥挤度计算
 */
app.post('/api/crowding/calc', (req, res) => {
  try {
    res.json({ status: 'started', message: '拥挤度计算已开始' });
    setTimeout(() => {
      try {
        calcAllCrowding();
        console.log('[' + dayjs().format('YYYY-MM-DD HH:mm') + '] 拥挤度计算完成');
      } catch(e) { console.error('拥挤度计算失败:', e.message); }
    }, 100);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ========== 持仓管理 API ==========

// 获取持仓列表（带实时行情+盈亏）
app.get('/api/portfolio', (req, res) => {
  try {
    const holdings = db.prepare(`
      SELECT p.*, s.total_score, s.signal, s.quality_score, s.valuation_score, s.technical_score,
             v.pe, v.pb,
             (SELECT close FROM daily_kline WHERE code=p.code ORDER BY trade_date DESC LIMIT 1) as current_price,
             (SELECT pct_chg FROM daily_kline WHERE code=p.code ORDER BY trade_date DESC LIMIT 1) as today_pct
      FROM portfolio p
      LEFT JOIN stock_score s ON p.code = s.code AND s.trade_date = (SELECT MAX(trade_date) FROM stock_score) AND s.strategy = 'value'
      LEFT JOIN valuation v ON p.code = v.code AND v.trade_date = (SELECT MAX(trade_date) FROM valuation)
      WHERE p.status = 'holding'
    `).all();

    // 计算盈亏
    let totalCost = 0, totalValue = 0, totalTodayPnL = 0;
    const items = holdings.map(h => {
      const currentPrice = h.current_price || h.buy_price;
      const costValue = h.buy_price * h.shares;
      const marketValue = currentPrice * h.shares;
      const pnl = marketValue - costValue;
      const pnlPct = h.buy_price > 0 ? ((currentPrice - h.buy_price) / h.buy_price * 100) : 0;
      const yesterdayClose = h.today_pct ? currentPrice / (1 + h.today_pct/100) : currentPrice;
      const todayPnL = (currentPrice - yesterdayClose) * h.shares;
      totalCost += costValue;
      totalValue += marketValue;
      totalTodayPnL += todayPnL;
      return {
        ...h,
        current_price: currentPrice,
        cost_value: Math.round(costValue),
        market_value: Math.round(marketValue),
        pnl: Math.round(pnl * 100) / 100,
        pnl_pct: +pnlPct.toFixed(2),
        today_pnl: Math.round(todayPnL * 100) / 100,
      };
    });

    const totalPnL = totalValue - totalCost;
    const totalPnLPct = totalCost > 0 ? (totalPnL / totalCost * 100) : 0;

    res.json({
      holdings: items,
      summary: {
        total_cost: Math.round(totalCost),
        total_value: Math.round(totalValue),
        total_pnl: Math.round(totalPnL * 100) / 100,
        total_pnl_pct: +totalPnLPct.toFixed(2),
        today_pnl: Math.round(totalTodayPnL * 100) / 100,
        count: items.length,
        suggested_position: 60,
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 添加持仓
app.post('/api/portfolio', (req, res) => {
  try {
    const { code, name, buy_price, shares, buy_date, strategy = 'value' } = req.body;
    if (!code || !buy_price || !shares) return res.status(400).json({ error: '缺少必填字段' });
    const stockInfo = db.prepare('SELECT name FROM stock_info WHERE code=?').get(code);
    const stockName = name || stockInfo?.name || code;
    // 获取当前评分的止损/目标价
    const score = db.prepare(`SELECT * FROM stock_score WHERE code=? AND strategy=? ORDER BY trade_date DESC LIMIT 1`).get(code, strategy);
    const stopLoss = +(buy_price * 0.85).toFixed(2);
    const targetPrice = score?.total_score >= 70 ? +(buy_price * 1.3).toFixed(2) : null;
    db.prepare(`INSERT OR REPLACE INTO portfolio (code,name,strategy,buy_date,buy_price,shares,stop_loss,target_price,status)
      VALUES (?,?,?,?,?,?,?,?,'holding')`).run(code, stockName, strategy, buy_date || new Date().toISOString().slice(0,10),
        buy_price, shares, stopLoss, targetPrice);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除持仓
app.delete('/api/portfolio/:code', (req, res) => {
  try {
    db.prepare(`UPDATE portfolio SET status='closed' WHERE code=?`).run(req.params.code);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 平仓记录
app.get('/api/portfolio/closed', (req, res) => {
  try {
    const closed = db.prepare(`SELECT * FROM portfolio WHERE status='closed' ORDER BY buy_date DESC`).all();
    res.json({ closed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ========== 服务端渲染的拥挤度页面（不经过React build，立即可访问）==========
// 注意：必须在express.static之前处理，否则会被SPA fallback拦截
app.get('/crowding-radar', (req, res) => {
  try {
    const today = dayjs().format('YYYYMMDD');
    const latestDate = db.prepare('SELECT MAX(trade_date) as d FROM crowding_score').get().d || today;
    
    // 全市场数据
    const sectors = db.prepare(`SELECT * FROM sector_crowding WHERE trade_date = ? ORDER BY crowding_score DESC`).all(latestDate);
    const exitStocks = db.prepare(`
      SELECT c.*, s.total_score, s.signal as score_signal,
        (SELECT close FROM daily_kline WHERE code=c.code ORDER BY trade_date DESC LIMIT 1) as current_price,
        (SELECT pct_chg FROM daily_kline WHERE code=c.code ORDER BY trade_date DESC LIMIT 1) as pct_chg
      FROM crowding_score c
      LEFT JOIN stock_score s ON c.code = s.code AND s.trade_date = c.trade_date AND s.strategy = 'value'
      WHERE c.trade_date = ? AND c.action IN ('exit','trim')
      ORDER BY c.combined_crowding_score DESC
    `).all(latestDate);
    const momentumStocks = db.prepare(`
      SELECT c.*, s.total_score, s.technical_score, s.quality_score
      FROM crowding_score c
      LEFT JOIN stock_score s ON c.code = s.code AND s.trade_date = c.trade_date AND s.strategy = 'value'
      WHERE c.trade_date = ? AND c.action = 'momentum_buy' AND s.total_score >= 45
      ORDER BY s.total_score DESC LIMIT 20
    `).all(latestDate);
    const coldStocks = db.prepare(`
      SELECT c.*, s.total_score, s.quality_score, s.valuation_score
      FROM crowding_score c
      LEFT JOIN stock_score s ON c.code = s.code AND s.trade_date = c.trade_date AND s.strategy = 'value'
      WHERE c.trade_date = ? AND c.level = 'cold' AND s.quality_score >= 60
      ORDER BY s.total_score DESC LIMIT 15
    `).all(latestDate);
    
    const parseFactors = (r) => { try { return JSON.parse(r.factors_json); } catch(e) { return {}; } };
    
    const avgCrowding = sectors.length > 0 ? Math.round(sectors.reduce((a,b)=>a+b.crowding_score,0)/sectors.length) : 50;
    
    const levelColor = { extreme:'#d92d20', crowded:'#f04438', hot:'#f79009', warm:'#9e77ed', cold:'#12b76a' };
    const levelLabel = { extreme:'🚨极端危险', crowded:'⚠️拥挤预警', hot:'🔥火热', warm:'🟣动量搭车', cold:'🧊冷清' };
    const levelAdvice = {
      extreme:'立即减仓/清仓，踩踏风险极高',
      crowded:'减仓50%，锁定利润',
      hot:'持有不追加仓位',
      warm:'小仓位顺势介入，严格止损(-7%)',
      cold:'优质标的可逆向布局'
    };
    
    const marketLevel = avgCrowding>=80?'extreme':avgCrowding>=65?'crowded':avgCrowding>=45?'hot':avgCrowding>=25?'warm':'cold';
    
    const stockRow = (s, type) => {
      const f = parseFactors(s);
      const pctColor = (f.ret_5d||0)>=0?'#f04438':'#12b76a';
      return `<tr style="border-bottom:1px solid #f0f0f0">
        <td style="padding:8px 12px"><b>${s.name}</b> <span style="color:#98a2b3;font-size:11px">${s.code}</span></td>
        <td style="padding:8px 12px;text-align:center">
          <div style="display:inline-block;width:60px;height:8px;background:#f0f0f0;border-radius:4px;overflow:hidden">
            <div style="width:${s.combined_crowding_score}%;height:100%;background:${levelColor[s.level]||'#98a2b3'}"></div>
          </div>
          <span style="margin-left:6px;font-weight:700;color:${levelColor[s.level]||'#333'};font-size:12px">${s.combined_crowding_score}°</span>
        </td>
        <td style="padding:8px 12px;text-align:right;color:${pctColor};font-weight:600;font-family:monospace">${(f.ret_5d||0)>0?'+':''}${(f.ret_5d||0).toFixed?.(1)||0}%</td>
        <td style="padding:8px 12px;text-align:right;color:${pctColor};font-weight:600;font-family:monospace">${(f.ret_20d||0)>0?'+':''}${(f.ret_20d||0).toFixed?.(1)||0}%</td>
        <td style="padding:8px 12px;text-align:center;font-weight:600;color:#101828">${s.total_score||'-'}</td>
        <td style="padding:8px 12px;font-size:11px;color:#667085">${(f.reasons||[]).join('、')||(type==='momentum'?'动量温和加速':type==='cold'?'优质低位':'放量加速')}</td>
      </tr>`;
    };
    
    const sectorRow = (s) => `<tr style="border-bottom:1px solid #f0f0f0">
      <td style="padding:6px 12px;font-weight:500">${s.sector}</td>
      <td style="padding:6px 12px;width:50%">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:12px;background:#f0f0f0;border-radius:6px;overflow:hidden">
            <div style="width:${s.crowding_score}%;height:100%;background:linear-gradient(90deg,#12b76a,#9e77ed,#f79009,#f04438,#d92d20);border-radius:6px"></div>
          </div>
          <span style="font-weight:700;color:${levelColor[s.level]};min-width:32px;font-size:12px">${s.crowding_score}°</span>
        </div>
      </td>
      <td style="padding:6px 12px"><span style="background:${levelColor[s.level]}15;color:${levelColor[s.level]};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">${levelLabel[s.level]}</span></td>
      <td style="padding:6px 12px;color:#98a2b3;font-size:11px">${s.stock_count}只</td>
    </tr>`;
    
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>📡 拥挤度雷达 - 仓位满上</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, 'PingFang SC','Microsoft YaHei',sans-serif; background: #f5f7fa; color: #101828; padding: 24px; }
h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
h2 { font-size: 16px; font-weight: 600; margin-bottom: 12px; }
.subtitle { color: #98a2b3; font-size: 13px; margin-bottom: 20px; }
.card { background:#fff; border-radius:12px; border:1px solid #eaecf0; padding:20px; margin-bottom:16px; box-shadow:0 1px 2px rgba(16,24,40,0.04); }
.grid { display:grid; grid-template-columns: repeat(4,1fr); gap:12px; margin-bottom:20px; }
.stat { text-align:center; padding:16px; border-radius:10px; }
.stat-num { font-size:32px;font-weight:800;font-family:'Inter',monospace; line-height:1; margin-bottom:6px; }
.stat-label { font-size:12px;color:#667085;font-weight:500; }
table { width:100%; border-collapse: collapse; font-size:13px; }
th { text-align:left; padding:10px 12px; background:#fafbfb; font-size:11px; color:#667085; font-weight:600; text-transform:uppercase; letter-spacing:0.03em; border-bottom:1px solid #eaecf0; }
.tag { display:inline-block; padding:3px 10px; border-radius:20px; font-size:12px; font-weight:600; }
.back { display:inline-block; margin-bottom:16px; color:#1677ff; text-decoration:none; font-size:13px; }
.back:hover { text-decoration:underline; }
.two-col { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
@media(max-width:900px){ .grid{grid-template-columns:repeat(2,1fr)} .two-col{grid-template-columns:1fr} }
</style></head><body>
<a href="/" class="back">← 返回市场总览</a>
<h1>📡 量化拥挤度雷达</h1>
<p class="subtitle">识别量化资金行为模式 · 搭车加速段 · 拥挤极端前先跑 · ${dayjs().format('YYYY-MM-DD HH:mm')}</p>

<div class="grid">
  <div class="stat" style="background:${levelColor[marketLevel]}15">
    <div class="stat-num" style="color:${levelColor[marketLevel]}">${avgCrowding}°</div>
    <div class="stat-label">全市场平均拥挤度</div>
    <div class="tag" style="background:${levelColor[marketLevel]};color:#fff;margin-top:8px;font-size:11px">${levelLabel[marketLevel]}</div>
    <div style="font-size:11px;color:#667085;margin-top:6px">${levelAdvice[marketLevel]}</div>
  </div>
  <div class="stat" style="background:#fff1f0">
    <div class="stat-num" style="color:#d92d20">${exitStocks.length}</div>
    <div class="stat-label">🚨 减仓/清仓预警</div>
    <div style="font-size:11px;color:#98a2b3;margin-top:6px">拥挤度≥75°，踩踏风险</div>
  </div>
  <div class="stat" style="background:#f9f5ff">
    <div class="stat-num" style="color:#9e77ed">${momentumStocks.length}</div>
    <div class="stat-label">🟣 动量搭车候选</div>
    <div style="font-size:11px;color:#98a2b3;margin-top:6px">拥挤度30-55°，温和加速</div>
  </div>
  <div class="stat" style="background:#ecfdf3">
    <div class="stat-num" style="color:#12b76a">${coldStocks.length}</div>
    <div class="stat-label">🧊 冷清逆向机会</div>
    <div style="font-size:11px;color:#98a2b3;margin-top:6px">无人关注，基本面优质</div>
  </div>
</div>

${exitStocks.length>0?`<div class="card" style="border-color:#f04438">
<h2 style="color:#d92d20">⚠️ 拥挤度减仓预警（${exitStocks.length}只）</h2>
<p style="font-size:12px;color:#667085;margin-bottom:12px">以下个股拥挤度达到极端水平，量化资金一致性过高，存在踩踏风险。建议主动减仓锁定利润。</p>
<table><thead><tr><th>股票</th><th style="text-align:center">拥挤度</th><th style="text-align:right">5日涨幅</th><th style="text-align:right">20日涨幅</th><th style="text-align:center">综合分</th><th>信号</th></tr></thead>
<tbody>${exitStocks.map(s=>stockRow(s,'exit')).join('')}</tbody></table>
</div>`:''}

<div class="card">
<h2>📊 板块拥挤度热力图（${sectors.length}个板块）</h2>
<table><thead><tr><th>板块</th><th>拥挤度</th><th>状态</th><th>成分股</th></tr></thead>
<tbody>${sectors.map(s=>sectorRow(s)).join('')}</tbody></table>
</div>

<div class="two-col">
<div class="card">
<h2 style="color:#9e77ed">🟣 动量搭车机会（${momentumStocks.length}只）</h2>
<p style="font-size:12px;color:#667085;margin-bottom:12px">量化刚开始涌入，温和加速阶段。单只5-8%仓位，-7%严格止损，拥挤度到80止盈。</p>
<table><thead><tr><th>股票</th><th style="text-align:center">拥挤度</th><th style="text-align:right">5日</th><th style="text-align:right">20日</th><th style="text-align:center">总分</th><th>理由</th></tr></thead>
<tbody>${momentumStocks.slice(0,10).map(s=>stockRow(s,'momentum')).join('')}</tbody></table>
</div>

<div class="card">
<h2 style="color:#12b76a">🧊 冷清逆向机会（${coldStocks.length}只）</h2>
<p style="font-size:12px;color:#667085;margin-bottom:12px">无人问津的优质股，基本面好+估值低+拥挤度低，适合长线布局。</p>
<table><thead><tr><th>股票</th><th style="text-align:center">拥挤度</th><th style="text-align:right">质量分</th><th style="text-align:right">估值分</th><th style="text-align:center">总分</th></tr></thead>
<tbody>${coldStocks.map(s=>{
  return `<tr style="border-bottom:1px solid #f0f0f0">
    <td style="padding:8px 12px"><b>${s.name}</b> <span style="color:#98a2b3;font-size:11px">${s.code}</span></td>
    <td style="padding:8px 12px;text-align:center"><span style="color:#12b76a;font-weight:700;font-size:12px">${s.combined_crowding_score}°</span></td>
    <td style="padding:8px 12px;text-align:center;color:#12b76a;font-weight:600">${s.quality_score||'-'}</td>
    <td style="padding:8px 12px;text-align:center;color:#f04438;font-weight:600">${s.valuation_score||'-'}</td>
    <td style="padding:8px 12px;text-align:center;font-weight:700">${s.total_score||'-'}</td>
  </tr>`;
}).join('')}</tbody></table>
</div>
</div>

<div class="card" style="background:#f9fafb">
<h2>💡 策略说明</h2>
<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;font-size:12px">
<div><b style="color:#12b76a">0-30° 冷清</b><br><span style="color:#667085">无人问津，逆向布局优质股</span></div>
<div><b style="color:#9e77ed">30-55° 搭车</b><br><span style="color:#667085">量化刚涌入，小仓顺势介入(-7%止损)</span></div>
<div><b style="color:#f79009">55-75° 持有</b><br><span style="color:#667085">趋势延续，不追加</span></div>
<div><b style="color:#f04438">75-90° 预警</b><br><span style="color:#667085">拥挤，减仓50%</span></div>
<div><b style="color:#d92d20">90°+ 极端</b><br><span style="color:#667085">踩踏风险极高，立即清仓</span></div>
</div>
</div>

</body></html>`;
    
    res.send(html);
  } catch(e) {
    res.status(500).send('<h1>错误</h1><p>'+e.message+'</p><p><a href="/">返回</a></p>');
  }
});

// ========== 静态文件缓存策略 ==========
const staticPath = path.join(__dirname, 'web', 'dist');
// /assets/ 带hash的文件 → 长期缓存
app.use('/assets/', express.static(path.join(staticPath, 'assets'), {
  maxAge: '1y',
  immutable: false, // 改maxAge=0，因为URL带查询参数v=会强制刷新
  setHeaders: (res) => {
    // 有版本参数的文件可以缓存，但我们不依赖这个
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  }
}));

// 根路径 / 始终返回动态HTML（给JS/CSS加版本号，强制浏览器下载最新版）
const BUILD_VERSION = Date.now().toString();
function serveIndex(req, res) {
  const fs = require('fs');
  const indexPath = path.join(staticPath, 'index.html');
  if (!fs.existsSync(indexPath)) {
    // 构建产物不存在，返回部署中提示（fallback）
    res.status(200).send('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>仓位满上</title>'
      + '<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f7fa;color:#101828}'
      + '.card{background:#fff;border-radius:12px;padding:40px;max-width:500px;text-align:center;box-shadow:0 4px 20px rgba(0,0,0,0.08)}'
      + 'h1{font-size:24px;margin-bottom:8px}.sub{color:#667085;font-size:14px;line-height:1.7}'
      + '.spin{display:inline-block;width:32px;height:32px;border:3px solid #eaecf0;border-top-color:#1677ff;border-radius:50%;animation:spin 0.8s linear infinite;margin:20px 0}'
      + '@keyframes spin{to{transform:rotate(360deg)}}</style></head><body>'
      + '<div class="card"><div class="spin"></div><h1>🥃 仓位满上 部署中</h1>'
      + '<p class="sub">前端静态资源正在构建，请稍等 1-2 分钟后刷新页面…<br/>如果持续看到此页面，说明前端构建失败，请查看 Render Build Logs。</p></div></body></html>');
    return;
  }
  let html = fs.readFileSync(indexPath, 'utf-8');
  // 去掉我之前临时加的banner
  html = html.replace(/<div id="crowding-banner".*?<\/script>/s, '<div id="root"></div>');
  // 给assets引用加版本参数
  html = html.replace(/(\/assets\/[^"?\s]+\.(js|css))/g, '$1?v=' + BUILD_VERSION);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(html);
}
app.get('/', serveIndex);
// 其他SPA路由
app.get(/^\/(?!api|assets|crowding-radar)[^.]*$/, serveIndex);
// ========== 定时任务 ==========
// 每周一00:30更新股票池
cron.schedule('30 0 * * 1', async () => {
  console.log('[cron] 周一00:30，开始更新股票池...');
  try {
    const r = await stockPool.updateStockPool(200);
    console.log('[cron] 股票池更新完成:', r);
  } catch(e) { console.log('[cron] 股票池更新失败:', e.message); }
});
// 10:00 盘中更新
cron.schedule('0 10 * * 1-5', () => { console.log('10:00 定时更新'); /* 调同步 */ });
// 11:30 上午收盘
cron.schedule('30 11 * * 1-5', () => { console.log('11:30 定时更新'); });
// 14:00 下午开盘
cron.schedule('0 14 * * 1-5', () => { console.log('14:00 定时更新'); });
// 15:30 收盘全量
cron.schedule('30 15 * * 1-5', () => {
  console.log('15:30 收盘全量更新');
  // TODO: 调用全量同步
});

// ========== 启动 ==========
const PORT = process.env.PORT || 3001;

// 启动时：检查数据库是否有数据，打印日志
function ensureSeedData() {
  try {
    const stockCount = db.prepare('SELECT COUNT(*) as c FROM stock_info').get().c;
    if (stockCount >= 50) {
      console.log(`[init] 数据库就绪：${stockCount} 支股票`);
    } else {
      console.log(`[init] ⚠️ 数据库仅 ${stockCount} 支股票，数据较少`);
    }
  } catch(e) {
    console.log('[init] 数据库检查失败:', e.message);
  }
}

app.listen(PORT, '0.0.0.0', async () => {
  console.log('═══════════════════════════════════════');
  console.log('  🥃 仓位满上 Top Up  服务已启动');
  console.log('  API地址: http://0.0.0.0:' + PORT);
  console.log('  时间: ' + dayjs().format('YYYY-MM-DD HH:mm:ss'));
  console.log('═══════════════════════════════════════');
  
  // 0. 等待数据源初始化完成
  try {
    await ds.waitReady();
    console.log(`[init] 📡 数据源: ${ds.getSource().label} (${ds.getSource().name})`);
  } catch(e) {
    console.log('[init] 数据源初始化失败:', e.message);
  }

  // 1. 先确保有种子数据，避免页面空白
  ensureSeedData();

  // 2. 初始化股票池（串行：先完成池子，再做行情更新）
  try {
    const poolCount = db.prepare('SELECT COUNT(*) as c FROM stock_pool WHERE in_pool=1').get().c;
    const lastUpdate = db.prepare('SELECT MAX(updated_at) as t FROM stock_pool').get().t;
    const needUpdate = poolCount < 100 || !lastUpdate || dayjs().diff(dayjs(lastUpdate), 'day') >= 7;
    if (needUpdate) {
      console.log('[init] 股票池为空或过期，开始更新股票池...');
      const r = await stockPool.updateStockPool(200);
      console.log(`[init] 股票池更新完成: ${r.total}只`);
    } else {
      console.log(`[init] 股票池已有 ${poolCount} 只，跳过更新`);
    }
  } catch(e) {
    console.log('[init] 股票池初始化失败:', e.message);
  }

  // 3. 后台尝试更新行情（API不通则静默失败）
  (async () => {
    try {
      console.log('[init] 后台尝试更新行情...');
      let codes = stockPool.getPoolCodes();
      if (codes.length === 0) {
        codes = db.prepare('SELECT code FROM stock_info').all().map(r => r.code).filter(c => /^\d{6}$/ || c.startsWith('sh') || c.startsWith('sz'));
      }
      if (codes.length === 0) throw new Error('无股票代码');
      const quotes = await Promise.race([
        tq.getQuickStockList(codes.slice(0, 250)),
        new Promise((_, rej) => setTimeout(() => rej(new Error('行情拉取超时(20s)')), 20000)),
      ]);
      // stock_info表无pe列
      const insInfo = db.prepare(`INSERT OR REPLACE INTO stock_info (code,name,market,is_st,total_mv,circ_mv,updated_at) VALUES (?,?,?,?,?,?,?)`);
      const tx = db.transaction((rows) => { for(const r of rows) insInfo.run(r.code,r.name,r.market||(String(r.code).startsWith('6')?'SH':'SZ'),r.is_st||0,r.total_mv,r.circ_mv,dayjs().format('YYYY-MM-DD HH:mm:ss')); });
      tx(quotes.filter(s=>s.code && s.name).map(q => ({code:String(q.code).replace(/^(sh|sz|bj)/,''),name:q.name,market:q.market,is_st:q.is_st||(q.name&&q.name.includes('ST')?1:0),total_mv:q.total_mv,circ_mv:q.circ_mv})));
      const today = dayjs().format('YYYYMMDD');
      const vstmt = db.prepare(`INSERT OR REPLACE INTO valuation (code,trade_date,pe) VALUES (?,?,?)`);
      const vtx = db.transaction((rows) => { for(const r of rows) if(r.pe != null) vstmt.run(String(r.code).replace(/^(sh|sz|bj)/,''), today, r.pe); });
      vtx(quotes.filter(q => q.code && q.pe != null));
      console.log(`[init] 行情更新完成: ${quotes.length} 支`);

      // 4. 评分
      const poolCount = db.prepare('SELECT COUNT(*) FROM stock_pool WHERE in_pool=1').pluck().get() || 0;
      const scoredCount = db.prepare('SELECT COUNT(DISTINCT code) FROM stock_score').pluck().get() || 0;
      const latest = db.prepare('SELECT MAX(trade_date) as d FROM stock_score').get().d;
      const needScore = !latest || scoredCount < poolCount * 0.7 || latest < dayjs().subtract(3,'day').format('YYYYMMDD');
      if (needScore) {
        console.log(`[init] 开始评分（覆盖${scoredCount}/${poolCount}只）...`);
        await scoreAllStocks(false);
        console.log('[init] 评分完成');
      } else {
        console.log(`[init] 评分数据已是最新(${latest}, ${scoredCount}只)，跳过`);
      }
      await calcAllCrowding();
      console.log('[init] 拥挤度计算完成');
    } catch(e) {
      console.log('[init] 行情/评分更新跳过(可能API受限):', e.message);
    }
  })();
});

