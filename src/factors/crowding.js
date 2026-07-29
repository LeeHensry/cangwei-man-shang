/**
 * 量化拥挤度因子模块
 * 核心思路：识别量化资金行为痕迹
 *  - 动量加速度：短期涨幅/中期涨幅，>1.5说明加速赶顶
 *  - 换手率分位：近3年换手率百分位，>90%极端活跃
 *  - 量价背离：价格新高但量能萎缩
 *  - 成交额集中度：板块内TOP10成交额占比
 *  - 连涨天数：个股连续上涨天数
 *  - 板块拥挤度：综合上述因子的板块级评分
 *
 * 搭车阶段(30-65)→持有(65-80)→预警(80-90)→极端危险(>90)
 */
const db = require('../data/db');

// ========== 个股级拥挤度因子 ==========

/**
 * 动量加速度 = 近5日涨幅 / 近20日涨幅
 * >1.5 加速赶顶；0.8-1.2 匀速；<0.5 减速
 */
function calcMomentumAcceleration(klines) {
  if (!klines || klines.length < 25) return { ratio: 1, state: 'normal' };
  const closes = klines.map(k => k.close);
  const current = closes[0];
  const p5 = closes[4] || closes[closes.length - 1];
  const p20 = closes[19] || closes[closes.length - 1];
  const ret5 = (current - p5) / p5 * 100;
  const ret20 = (current - p20) / p20 * 100;
  if (ret20 <= 0) return { ratio: ret5 > 5 ? 2.5 : 0.5, ret5, ret20, state: ret5 > 5 ? 'accelerating_down' : 'decelerating' };
  const ratio = ret20 !== 0 ? Math.abs(ret5 / 5) / Math.abs(ret20 / 20) : 1;
  let state = 'normal';
  if (ratio > 1.8 && ret5 > 8) state = 'blowoff'; // 加速赶顶
  else if (ratio > 1.3 && ret5 > 3) state = 'accelerating'; // 温和加速
  else if (ratio < 0.5 && ret20 > 10) state = 'decelerating'; // 上涨减速
  else if (ret5 < -5 && ret20 > 5) state = 'reversing'; // 反转下跌
  return { ratio: +ratio.toFixed(2), ret5: +ret5.toFixed(2), ret20: +ret20.toFixed(2), state };
}

/**
 * 换手率分位：近3年（约750个交易日）的换手率百分位
 * 百分位越高说明当前越活跃/拥挤
 */
function calcTurnoverPercentile(klines) {
  if (!klines || klines.length < 60) return { percentile: 50, current_turnover: 0 };
  const today = klines[0];
  const turnovers = klines.map(k => k.turnover || 0).filter(t => t > 0);
  if (turnovers.length < 20) return { percentile: 50, current_turnover: today.turnover || 0 };
  const current = today.turnover || 0;
  const below = turnovers.filter(t => t <= current).length;
  const percentile = Math.round(below / turnovers.length * 100);
  return { percentile, current_turnover: +current.toFixed(2), avg_turnover: +(turnovers.reduce((a,b)=>a+b,0)/turnovers.length).toFixed(2) };
}

/**
 * 量价背离检测
 * 价格创N日新高但成交量低于N日均量 → 顶背离
 * 价格创N日新低但成交量萎缩 → 底背离
 */
function calcVolumePriceDivergence(klines) {
  if (!klines || klines.length < 25) return { divergence: null, score: 0 };
  const recent = klines.slice(0, 20);
  const closes = recent.map(k => k.close);
  const volumes = recent.map(k => k.volume);
  const current = closes[0];
  const currentVol = volumes[0];
  const highPrice = Math.max(...closes.slice(1));
  const lowPrice = Math.min(...closes.slice(1));
  const avgVol = volumes.slice(1).reduce((a,b)=>a+b,0) / volumes.slice(1).length;
  const isNewHigh = current > highPrice;
  const isNewLow = current < lowPrice;
  const volRatio = currentVol / avgVol;
  let divergence = null;
  let score = 0;
  if (isNewHigh && volRatio < 0.8) {
    divergence = 'top_divergence'; // 价创新高但缩量
    score = 80;
  } else if (isNewHigh && volRatio < 1.0) {
    divergence = 'weak_top_divergence';
    score = 60;
  } else if (isNewLow && volRatio < 0.7) {
    divergence = 'bottom_divergence'; // 缩量下跌（可能见底）
    score = -30;
  } else if (isNewHigh && volRatio > 1.8) {
    divergence = 'blowoff_volume'; // 天量新高（最后冲顶）
    score = 70;
  } else if (volRatio > 2.0 && current < klines[1].close) {
    divergence = 'high_volume_decline'; // 放量下跌（出货）
    score = 90;
  }
  return { divergence, score, vol_ratio: +volRatio.toFixed(2), is_new_high: isNewHigh, is_new_low: isNewLow };
}

/**
 * 连涨/连跌天数
 */
function calcConsecutiveDays(klines) {
  if (!klines || klines.length < 2) return { up_days: 0, down_days: 0 };
  let upDays = 0, downDays = 0;
  for (let i = 0; i < Math.min(15, klines.length - 1); i++) {
    const pct = klines[i].pct_chg || 0;
    if (pct > 0.1) upDays++;
    else break;
  }
  for (let i = 0; i < Math.min(15, klines.length - 1); i++) {
    const pct = klines[i].pct_chg || 0;
    if (pct < -0.1) downDays++;
    else break;
  }
  return { up_days: upDays, down_days: downDays };
}

/**
 * 个股拥挤度综合评分（0-100）
 */
function calcStockCrowding(code) {
  const klines = db.prepare(`
    SELECT trade_date, close, volume, amount, pct_chg, high, low, turnover
    FROM daily_kline WHERE code = ? ORDER BY trade_date DESC LIMIT 750
  `).all(code);
  if (klines.length < 30) {
    return { score: 50, factors: {}, level: 'normal', signal: 'hold' };
  }
  const momentum = calcMomentumAcceleration(klines);
  const turnover = calcTurnoverPercentile(klines);
  const volDiv = calcVolumePriceDivergence(klines);
  const consecutive = calcConsecutiveDays(klines);
  // 近期涨幅绝对值
  const ret5 = momentum.ret5 || 0;
  const ret20 = momentum.ret20 || 0;
  // ---- 加权评分 ----
  let score = 30; // 基础分
  const factors = {};
  // 1. 动量加速度(25分)
  let momentumScore = 0;
  if (momentum.state === 'blowoff') momentumScore = 25;
  else if (momentum.state === 'accelerating' && ret5 > 5) momentumScore = 18;
  else if (momentum.state === 'accelerating') momentumScore = 12;
  else if (momentum.state === 'normal') momentumScore = 8;
  else if (momentum.state === 'decelerating') momentumScore = 5;
  else if (momentum.state === 'reversing') momentumScore = 20; // 反转也危险
  factors.momentum = momentumScore;
  score += momentumScore;
  // 2. 换手率分位(20分)
  let turnoverScore = 0;
  if (turnover.percentile >= 95) turnoverScore = 20;
  else if (turnover.percentile >= 85) turnoverScore = 15;
  else if (turnover.percentile >= 70) turnoverScore = 10;
  else if (turnover.percentile >= 50) turnoverScore = 5;
  factors.turnover = turnoverScore;
  score += turnoverScore;
  // 3. 量价背离(15分)
  factors.divergence = volDiv.score > 0 ? Math.round(volDiv.score * 0.15) : 0;
  score += factors.divergence;
  // 4. 连涨天数(10分)
  let consecutiveScore = 0;
  if (consecutive.up_days >= 7) consecutiveScore = 10;
  else if (consecutive.up_days >= 5) consecutiveScore = 7;
  else if (consecutive.up_days >= 3) consecutiveScore = 4;
  factors.consecutive = consecutiveScore;
  score += consecutiveScore;
  // 5. 短期涨幅绝对值(15分) - 短期暴涨是最直接的拥挤信号
  let retScore = 0;
  if (ret5 >= 25) retScore = 15;
  else if (ret5 >= 15) retScore = 12;
  else if (ret5 >= 8) retScore = 8;
  else if (ret5 >= 3) retScore = 4;
  else if (ret5 <= -10) retScore = 10; // 暴跌也是踩踏信号
  factors.short_return = retScore;
  score += retScore;
  // 6. 20日涨幅(15分)
  let ret20Score = 0;
  if (ret20 >= 50) ret20Score = 15;
  else if (ret20 >= 30) ret20Score = 12;
  else if (ret20 >= 20) ret20Score = 8;
  else if (ret20 >= 10) ret20Score = 4;
  factors.mid_return = ret20Score;
  score += ret20Score;
  score = Math.max(0, Math.min(100, Math.round(score)));
  // 拥挤等级
  let level = 'normal', signal = 'hold';
  if (score < 30) { level = 'cold'; signal = 'accumulate'; }       // 冷清，可布局
  else if (score < 55) { level = 'warm'; signal = 'buy_zone'; }    // 温和升温，可搭车
  else if (score < 75) { level = 'hot'; signal = 'hold'; }         // 火热，持有不加
  else if (score < 90) { level = 'crowded'; signal = 'trim'; }     // 拥挤预警，减仓
  else { level = 'extreme'; signal = 'exit'; }                     // 极端拥挤，清仓
  return {
    score, level, signal,
    factors: {
      momentum_accel: momentum,
      turnover_percentile: turnover,
      volume_divergence: volDiv,
      consecutive_days: consecutive,
      ret_5d: ret5,
      ret_20d: ret20,
      raw_scores: factors,
    }
  };
}

// ========== 板块级拥挤度 ==========

/**
 * 计算板块拥挤度
 * 用同板块个股的平均拥挤度+板块内分化度（同涨同跌度）
 * @param {string} industryName 行业名称（与quality_detail中的industry对应）
 */
function calcSectorCrowding(industryName) {
  const latestDate = db.prepare('SELECT MAX(trade_date) as d FROM stock_score').get().d;
  if (!latestDate) return { score: 50, level: 'normal' };
  // 获取该行业所有股票的评分
  const allScores = db.prepare(`
    SELECT s.code, s.total_score, s.technical_score, s.quality_detail
    FROM stock_score s WHERE s.trade_date = ? AND s.strategy = 'value'
  `).all(latestDate);
  const sectorStocks = allScores.filter(s => {
    try {
      const qd = JSON.parse(s.quality_detail);
      return qd.industry === industryName;
    } catch(e) { return false; }
  });
  if (sectorStocks.length < 3) return { score: 50, level: 'normal', stock_count: sectorStocks.length };
  // 计算板块内个股拥挤度均值
  let totalCrowding = 0;
  let validCount = 0;
  let momentumUp = 0;
  const pctChanges = [];
  for (const stock of sectorStocks) {
    const crowding = calcStockCrowding(stock.code);
    if (crowding) {
      totalCrowding += crowding.score;
      validCount++;
      if (crowding.factors.ret_5d > 0) momentumUp++;
      // 近5日涨跌幅（从kline取）
      const k = db.prepare('SELECT pct_chg FROM daily_kline WHERE code=? ORDER BY trade_date DESC LIMIT 1').get(stock.code);
      if (k) pctChanges.push(k.pct_chg || 0);
    }
  }
  if (validCount === 0) return { score: 50, level: 'normal', stock_count: 0 };
  const avgCrowding = totalCrowding / validCount;
  // 同涨同跌度：如果板块内大部分股票同方向，说明一致性行动
  const upRatio = pctChanges.filter(p => p > 0).length / Math.max(pctChanges.length, 1);
  let syncScore = 0;
  if (upRatio > 0.8) syncScore = 15;      // 80%同涨
  else if (upRatio > 0.65) syncScore = 8;
  else if (upRatio < 0.2) syncScore = 15; // 80%同跌（踩踏）
  else if (upRatio < 0.35) syncScore = 8;
  // 龙头滞涨信号：板块内涨幅最大的个股开始减速
  let leaderLagScore = 0;
  if (pctChanges.length > 0) {
    // 用近期涨幅判断
    const stockCrowdings = sectorStocks.map(s => {
      const c = calcStockCrowding(s.code);
      return { code: s.code, crowding: c };
    }).filter(x => x.crowding);
    // 找出近20日涨幅最高的（龙头）
    const sorted = stockCrowdings.sort((a,b) => (b.crowding.factors.ret_20d||0) - (a.crowding.factors.ret_20d||0));
    if (sorted.length > 0) {
      const leader = sorted[0].crowding;
      // 龙头近5日涨幅减弱但20日涨幅仍高 → 龙头滞涨
      if (leader.factors.ret_20d > 20 && leader.factors.momentum_accel?.state === 'decelerating') {
        leaderLagScore = 20;
      }
    }
  }
  const sectorScore = Math.round(Math.min(100, Math.max(0, avgCrowding + syncScore + leaderLagScore - 5)));
  let level = 'normal';
  if (sectorScore < 30) level = 'cold';
  else if (sectorScore < 55) level = 'warm';
  else if (sectorScore < 75) level = 'hot';
  else if (sectorScore < 90) level = 'crowded';
  else level = 'extreme';
  return {
    score: sectorScore,
    level,
    stock_count: validCount,
    up_ratio: +upRatio.toFixed(2),
    sync_score: syncScore,
    leader_lag_score: leaderLagScore,
    avg_stock_crowding: +avgCrowding.toFixed(1),
  };
}

/**
 * 全市场板块拥挤度扫描
 */
function calcAllSectorCrowding() {
  const latestDate = db.prepare('SELECT MAX(trade_date) as d FROM stock_score').get().d;
  if (!latestDate) return [];
  const allScores = db.prepare(`
    SELECT s.code, s.quality_detail FROM stock_score s WHERE s.trade_date = ? AND s.strategy = 'value'
  `).all(latestDate);
  // 收集所有行业
  const industries = new Set();
  const industryStocks = {};
  for (const s of allScores) {
    try {
      const qd = JSON.parse(s.quality_detail);
      const ind = qd.industry || '通用';
      industries.add(ind);
      if (!industryStocks[ind]) industryStocks[ind] = [];
      industryStocks[ind].push(s.code);
    } catch(e) {}
  }
  const results = [];
  for (const ind of industries) {
    if (industryStocks[ind].length < 3) continue;
    const crowding = calcSectorCrowding(ind);
    // 板块涨跌幅
    const sectorData = db.prepare(`
      SELECT change_pct, leader_name, leader_pct FROM sector_daily
      WHERE trade_date = (SELECT MAX(trade_date) FROM sector_daily)
      AND (sector_name LIKE ? OR leader_name IN (SELECT name FROM stock_info WHERE code IN (` + industryStocks[ind].map(()=>'?').join(',') + `)))
      LIMIT 1
    `).get('%' + ind.slice(0,2) + '%', ...industryStocks[ind]);
    results.push({
      sector: ind,
      crowding_score: crowding.score,
      level: crowding.level,
      stock_count: crowding.stock_count,
      up_ratio: crowding.up_ratio,
      change_pct: sectorData?.change_pct || null,
      leader_name: sectorData?.leader_name || null,
      leader_pct: sectorData?.leader_pct || null,
    });
  }
  return results.sort((a,b) => b.crowding_score - a.crowding_score);
}

/**
 * 获取个股的拥挤度信号（含搭车/减仓建议）
 * 这是对外的主要接口
 */
function getCrowdingSignal(code) {
  const stockInfo = db.prepare('SELECT name FROM stock_info WHERE code=?').get(code);
  if (!stockInfo) return null;
  const stockCrowding = calcStockCrowding(code);
  // 获取所属行业和是否老登股/困境股（避免循环引用，直接判断关键词）
  let industryName = '通用';
  let isOldman = false;
  let isDistressed = false;
  
  const name = (stockInfo.name || '').replace(/\s+/g, '');
  // 老登股判断（银行/基建/铁路/航空/港口/高速/电力/地产/建筑/钢铁/煤炭/石油石化）
  const oldmanKeywords = ['银行','保险','证券','券商','铁路','航空','机场','港口','高速','电力','核电',
    '地产','万科','保利','置业','建筑','中铁','中建','铁建','交建','钢铁','石油','石化','煤炭'];
  const distressedKeywords = ['地产','万科','保利','置业','碧桂园'];
  for (const kw of oldmanKeywords) {
    if (name.includes(kw)) { isOldman = true; industryName = '传统行业'; break; }
  }
  for (const kw of distressedKeywords) {
    if (name.includes(kw)) { isDistressed = true; break; }
  }
  
  // 尝试从最新quality_detail读取准确行业名
  const latestScore = db.prepare(`
    SELECT quality_detail FROM stock_score WHERE code=? ORDER BY trade_date DESC LIMIT 1
  `).get(code);
  if (latestScore?.quality_detail) {
    try {
      const qd = JSON.parse(latestScore.quality_detail);
      if (qd.industry) industryName = qd.industry;
    } catch(e) {}
  }
  const sectorCrowding = calcSectorCrowding(industryName);
  // 综合个股+板块的信号
  const combinedScore = Math.round(stockCrowding.score * 0.6 + sectorCrowding.score * 0.4);
  let action = 'hold';
  let actionDetail = '';
  let momentumBonus = 0;  // 动量搭车加分（给综合评分用）
  let crowdingPenalty = 0; // 拥挤惩罚分（给综合评分用）
  const reasons = [];
  if (combinedScore >= 90) {
    action = 'exit';
    actionDetail = '🚨 极端拥挤，强烈建议清仓/大幅减仓，踩踏风险极高';
    crowdingPenalty = 20;
    if (stockCrowding.factors.volume_divergence?.divergence === 'top_divergence') reasons.push('量价顶背离');
    if (stockCrowding.factors.consecutive_days?.up_days >= 5) reasons.push('连续上涨超5天');
    if (sectorCrowding.up_ratio > 0.8) reasons.push('板块内一致性看多');
  } else if (combinedScore >= 75) {
    action = 'trim';
    actionDetail = '⚠️ 拥挤预警，建议减仓50%，锁定利润';
    crowdingPenalty = 12;
    if (stockCrowding.factors.turnover_percentile?.percentile >= 90) reasons.push('换手率处于历史极端高位');
    if (sectorCrowding.leader_lag_score > 0) reasons.push('板块龙头开始滞涨');
  } else if (combinedScore >= 55) {
    action = 'hold';
    actionDetail = '🔥 持有阶段，不追加仓位';
    crowdingPenalty = 3;
  } else if (combinedScore >= 30) {
    // 老登股和困境股不给动量搭车信号
    if (isOldman || isDistressed) {
      action = 'hold';
      actionDetail = '传统行业/困境股，不做动量搭车';
      momentumBonus = 0;
    } else {
      action = 'momentum_buy';
      actionDetail = '🟣 动量搭车区，可小仓位顺势介入';
      momentumBonus = 10;
      if (stockCrowding.factors.momentum_accel?.state === 'accelerating') reasons.push('动量温和加速');
      if (sectorCrowding.up_ratio > 0.5 && sectorCrowding.up_ratio < 0.8) reasons.push('板块资金开始关注');
    }
  } else {
    action = 'accumulate';
    actionDetail = '🧊 冷清区域，逆向布局机会';
    momentumBonus = 0;
  }
  // 特别危险信号
  if (stockCrowding.factors.volume_divergence?.divergence === 'high_volume_decline') {
    action = 'exit';
    actionDetail = '🚨 放量下跌，资金出逃，立即止损/清仓';
    crowdingPenalty = 25;
    reasons.push('放量暴跌，资金出逃');
  }
  if (stockCrowding.factors.volume_divergence?.divergence === 'blowoff_volume') {
    reasons.push('天量成交，可能是最后冲顶');
  }
  return {
    code,
    name: stockInfo.name,
    industry: industryName,
    stock_crowding: stockCrowding.score,
    sector_crowding: sectorCrowding.score,
    combined_score: combinedScore,
    level: combinedScore >= 90 ? 'extreme' : combinedScore >=75 ? 'crowded' : combinedScore >=55 ? 'hot' : combinedScore >=30 ? 'warm' : 'cold',
    action,
    action_detail: actionDetail,
    momentum_bonus: momentumBonus,
    crowding_penalty: crowdingPenalty,
    reasons,
    factors: {
      stock: stockCrowding.factors,
      sector: {
        up_ratio: sectorCrowding.up_ratio,
        stock_count: sectorCrowding.stock_count,
        leader_lag: sectorCrowding.leader_lag_score > 0,
      }
    }
  };
}

/**
 * 批量计算全市场拥挤度，存入数据库
 */
function calcAllCrowding() {
  const dayjs = require('dayjs');
  const today = dayjs().format('YYYYMMDD');
  const codes = db.prepare('SELECT code, name FROM stock_info WHERE is_st = 0').all();
  const results = [];
  console.log(`\n🔍 计算拥挤度，共 ${codes.length} 只股票`);
  // 先算板块拥挤度（缓存）
  const sectorCrowdingCache = {};
  for (let i = 0; i < codes.length; i++) {
    const { code, name } = codes[i];
    try {
      const signal = getCrowdingSignal(code);
      if (!signal) continue;
      // 缓存板块拥挤度
      if (!sectorCrowdingCache[signal.industry]) {
        sectorCrowdingCache[signal.industry] = calcSectorCrowding(signal.industry);
      }
      const secCrowd = sectorCrowdingCache[signal.industry];
      results.push({
        code, name, trade_date: today,
        stock_crowding_score: signal.stock_crowding,
        sector_crowding_score: signal.sector_crowding,
        combined_crowding_score: signal.combined_score,
        level: signal.level,
        action: signal.action,
        momentum_bonus: signal.momentum_bonus,
        crowding_penalty: signal.crowding_penalty,
        factors_json: JSON.stringify({
          ret_5d: signal.factors.stock.ret_5d,
          ret_20d: signal.factors.stock.ret_20d,
          momentum_state: signal.factors.stock.momentum_accel?.state,
          momentum_ratio: signal.factors.stock.momentum_accel?.ratio,
          turnover_pct: signal.factors.stock.turnover_percentile?.percentile,
          divergence: signal.factors.stock.volume_divergence?.divergence,
          up_days: signal.factors.stock.consecutive_days?.up_days,
          sector_up_ratio: signal.factors.sector.up_ratio,
          leader_lag: signal.factors.sector.leader_lag,
          reasons: signal.reasons,
        }),
      });
    } catch(e) {
      console.error(`  ${code}拥挤度计算失败:`, e.message);
    }
    if ((i+1) % 30 === 0) console.log(`  拥挤度进度: ${i+1}/${codes.length}`);
  }
  // 存入数据库
  const columns = ['code','name','trade_date','stock_crowding_score','sector_crowding_score',
    'combined_crowding_score','level','action','momentum_bonus','crowding_penalty','factors_json'];
  const placeholders = columns.map(()=>'?').join(',');
  const stmt = db.prepare(`INSERT OR REPLACE INTO crowding_score
    (${columns.join(',')}) VALUES (${placeholders})`);
  const insertMany = db.transaction((rows) => {
    for (const r of rows) stmt.run(...columns.map(c => r[c] ?? null));
  });
  insertMany(results);
  // 板块拥挤度汇总
  const sectorResults = Object.entries(sectorCrowdingCache).map(([name, data]) => ({
    sector: name,
    crowding_score: data.score,
    level: data.level,
    stock_count: data.stock_count,
    up_ratio: data.up_ratio,
    trade_date: today,
  }));
  const secStmt = db.prepare(`INSERT OR REPLACE INTO sector_crowding
    (sector, trade_date, crowding_score, level, stock_count, up_ratio) VALUES (?,?,?,?,?,?)`);
  const insertSectors = db.transaction((rows) => {
    for (const r of rows) secStmt.run(r.sector, r.trade_date, r.crowding_score, r.level, r.stock_count, r.up_ratio);
  });
  insertSectors(sectorResults);
  console.log(`\n✅ 拥挤度计算完成，共 ${results.length} 只股票，${sectorResults.length} 个板块`);
  return { stocks: results.length, sectors: sectorResults.length };
}

module.exports = {
  calcMomentumAcceleration,
  calcTurnoverPercentile,
  calcVolumePriceDivergence,
  calcConsecutiveDays,
  calcStockCrowding,
  calcSectorCrowding,
  calcAllSectorCrowding,
  getCrowdingSignal,
  calcAllCrowding,
};
