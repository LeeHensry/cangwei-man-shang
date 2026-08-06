/**
 * 短线策略 - 基于技术面+量价的短线交易信号
 * 适合持股周期：1-5个交易日
 */
const { dbGet, dbAll, dbRun, dbBatch } = require('../data/db');
const dayjs = require('dayjs');

/**
 * 计算单只股票短线信号
 */
async function calcShortSignal(code) {
  // 取最近120个交易日K线
  const klines = await dbAll(`
    SELECT * FROM daily_kline WHERE code = ? ORDER BY trade_date ASC LIMIT 120
  `, [code]);
  if (klines.length < 30) return null;

  // 取最近30个交易日的技术指标
  const techs = await dbAll(`
    SELECT * FROM technical_indicators WHERE code = ? ORDER BY trade_date ASC LIMIT 120
  `, [code]);

  const latest = klines[klines.length - 1];
  const prev = klines[klines.length - 2];
  const latestTech = techs.length > 0 ? techs[techs.length - 1] : null;
  const prevTech = techs.length > 1 ? techs[techs.length - 2] : null;
  if (!latest || !latestTech) return null;

  const signals = [];
  let score = 50;
  const reasons = [];
  const risks = [];

  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);

  // === 1. 均线多头排列 (15分) ===
  if (latestTech.ma5 && latestTech.ma10 && latestTech.ma20 && latestTech.ma60) {
    const bullMA = latestTech.ma5 > latestTech.ma10 && latestTech.ma10 > latestTech.ma20 && latestTech.ma20 > latestTech.ma60;
    if (bullMA) {
      score += 15;
      reasons.push('均线多头排列(MA5>MA10>MA20>MA60)');
    } else if (latestTech.ma5 < latestTech.ma10 && latestTech.ma10 < latestTech.ma20) {
      score -= 15;
      risks.push('均线空头排列');
    }
    if (prevTech && prevTech.ma5 <= prevTech.ma10 && latestTech.ma5 > latestTech.ma10) {
      score += 8;
      reasons.push('MA5上穿MA10（短线金叉）');
    }
  }

  // === 2. MACD金叉 (12分) ===
  if (latestTech.macd_dif != null && latestTech.macd_dea != null && prevTech) {
    if (prevTech.macd_dif <= prevTech.macd_dea && latestTech.macd_dif > latestTech.macd_dea) {
      score += 12;
      reasons.push('MACD金叉（DIF上穿DEA）');
    } else if (prevTech.macd_dif >= prevTech.macd_dea && latestTech.macd_dif < latestTech.macd_dea) {
      score -= 12;
      risks.push('MACD死叉');
    }
    if (latestTech.macd_bar > 0 && prevTech && latestTech.macd_bar > (prevTech.macd_bar || 0)) {
      score += 5;
      reasons.push('MACD红柱放大（动能增强）');
    }
  }

  // === 3. 成交量放大 (10分) ===
  if (volumes.length >= 10) {
    const vol5 = volumes.slice(-5).reduce((a,b)=>a+b,0)/5;
    const vol20 = volumes.slice(-20).reduce((a,b)=>a+b,0)/Math.min(20,volumes.length-5);
    const volRatio = latest.volume / (vol20 || 1);
    if (volRatio > 2.0 && latest.pct_chg > 0) {
      score += 10;
      reasons.push(`放量上涨（量比${volRatio.toFixed(1)}）`);
    } else if (volRatio > 2.0 && latest.pct_chg < -3) {
      score -= 10;
      risks.push(`放量大跌（量比${volRatio.toFixed(1)}，注意止损）`);
    } else if (volRatio < 0.5 && latest.pct_chg < 0) {
      score += 3;
      reasons.push('缩量下跌（抛压减弱）');
    }
  }

  // === 4. 突破N日高点 (13分) ===
  if (highs.length >= 20) {
    const high20 = Math.max(...highs.slice(-21, -1));
    const high60 = highs.length >= 60 ? Math.max(...highs.slice(-61, -1)) : high20;
    if (latest.close > high20 && latest.pct_chg > 0) {
      score += 8;
      reasons.push('突破20日新高');
      if (latest.close > high60) {
        score += 5;
        reasons.push('突破60日新高（强势）');
      }
    }
  }

  // === 5. RSI信号 (8分) ===
  if (latestTech.rsi6 != null) {
    if (latestTech.rsi6 < 25) {
      score += 8;
      reasons.push('RSI6超卖（<25），反弹概率大');
    } else if (latestTech.rsi6 > 85) {
      score -= 8;
      risks.push('RSI6超买（>85），注意回调');
    } else if (prevTech && prevTech.rsi6 < 30 && latestTech.rsi6 >= 30) {
      score += 5;
      reasons.push('RSI从超卖区回升');
    }
  }

  // === 6. K线形态 (10分) ===
  if (latest.pct_chg > 5) {
    score += 6;
    reasons.push(`大阳线(+${latest.pct_chg.toFixed(1)}%)`);
  } else if (latest.pct_chg < -5) {
    score -= 8;
    risks.push(`大阴线(${latest.pct_chg.toFixed(1)}%)`);
  }
  const body = Math.abs(latest.close - latest.open);
  const lowerShadow = Math.min(latest.open, latest.close) - latest.low;
  const upperShadow = latest.high - Math.max(latest.open, latest.close);
  const range = latest.high - latest.low;
  if (range > 0 && lowerShadow > body * 2 && body < range * 0.3 && latest.pct_chg > -2) {
    score += 7;
    reasons.push('锤子线（下影线长，有支撑）');
  }

  // === 7. 连续上涨 (5分) ===
  let upDays = 0;
  for (let i = klines.length - 1; i >= 0 && klines[i].pct_chg > 0; i--) upDays++;
  if (upDays >= 3) {
    if (upDays >= 5) {
      score -= 5;
      risks.push(`连涨${upDays}天（短期过热）`);
    } else {
      score += 4;
      reasons.push(`连涨${upDays}天（趋势向上）`);
    }
  }

  // === 8. BOLL突破/反弹 (5分) ===
  if (latestTech.boll_upper && latestTech.boll_lower) {
    if (latest.close > latestTech.boll_upper) {
      score -= 3;
      risks.push('突破BOLL上轨（短期超买）');
    } else if (latest.close < latestTech.boll_lower) {
      score += 5;
      reasons.push('跌破BOLL下轨（超卖反弹机会）');
    }
  }

  // === 9. KDJ金叉 (7分) ===
  if (latestTech.kdj_k != null && prevTech) {
    if (prevTech.kdj_k <= prevTech.kdj_d && latestTech.kdj_k > latestTech.kdj_d && latestTech.kdj_k < 50) {
      score += 7;
      reasons.push('KDJ低位金叉');
    } else if (prevTech.kdj_k >= prevTech.kdj_d && latestTech.kdj_k < latestTech.kdj_d && latestTech.kdj_k > 70) {
      score -= 7;
      risks.push('KDJ高位死叉');
    }
  }

  score = Math.max(0, Math.min(100, score));

  let signal = 'hold';
  let action = '观望';
  let positionPct = 0;
  let stopLoss = 0;
  let targetPrice = 0;

  if (score >= 75 && signals.length === 0) {
    signal = 'buy';
    action = '短线买入';
    positionPct = 20;
    stopLoss = latest.close * 0.95;
    targetPrice = latest.close * 1.10;
  } else if (score >= 65) {
    signal = 'watch';
    action = '关注';
    positionPct = 0;
  } else if (score <= 30) {
    signal = 'sell';
    action = '短线卖出/回避';
  }

  return {
    code,
    trade_date: latest.trade_date,
    close: latest.close,
    pct_chg: latest.pct_chg,
    short_score: Math.round(score),
    signal,
    action,
    position_pct: positionPct,
    stop_loss: stopLoss ? +stopLoss.toFixed(2) : null,
    target_price: targetPrice ? +targetPrice.toFixed(2) : null,
    reasons: reasons.slice(0, 5),
    risks: risks.slice(0, 5),
    vol_ratio: volumes.length >= 20 ? +(latest.volume / (volumes.slice(-20).reduce((a,b)=>a+b,0)/20)).toFixed(2) : null,
    rsi6: latestTech.rsi6,
    macd_gold: reasons.some(r => r.includes('MACD金叉')),
    ma_bull: reasons.some(r => r.includes('均线多头')),
  };
}

/**
 * 批量计算所有股票短线信号
 */
async function calcAllShortSignals() {
  const codeRows = await dbAll(`
    SELECT DISTINCT code FROM daily_kline
    WHERE trade_date = (SELECT MAX(trade_date) FROM daily_kline)
  `);
  const codes = codeRows.map(r => r.code);

  const results = [];
  for (const code of codes) {
    const sig = await calcShortSignal(code);
    if (sig && sig.short_score >= 60) results.push(sig);
  }

  // 保存到数据库
  const today = dayjs().format('YYYYMMDD');
  await dbRun(`DELETE FROM short_signals WHERE trade_date = ?`, [today]);

  const insertSql = `
    INSERT OR REPLACE INTO short_signals
    (code, trade_date, close, pct_chg, short_score, signal, position_pct, stop_loss, target_price, reasons_json, risks_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const stmts = results.map(r => ({
    sql: insertSql,
    args: [r.code, r.trade_date, r.close, r.pct_chg, r.short_score, r.signal,
      r.position_pct, r.stop_loss, r.target_price,
      JSON.stringify(r.reasons), JSON.stringify(r.risks)]
  }));
  for (let i = 0; i < stmts.length; i += 200) {
    await dbBatch(stmts.slice(i, i + 200));
  }

  return results;
}

/**
 * 获取短线机会列表
 */
async function getShortOpportunities(options = {}) {
  const { limit = 30, signal = '', minScore = 60 } = options;
  const todayRow = await dbGet(`SELECT MAX(trade_date) as d FROM short_signals`);
  const today = todayRow?.d;
  if (!today) return [];

  let sql = `
    SELECT s.*, i.name, i.total_mv, i.industry
    FROM short_signals s
    LEFT JOIN stock_info i ON s.code = i.code
    WHERE s.trade_date = ? AND s.short_score >= ?
  `;
  const params = [today, minScore];
  if (signal) { sql += ` AND s.signal = ?`; params.push(signal); }
  sql += ` ORDER BY s.short_score DESC LIMIT ?`;
  params.push(limit);

  const rows = await dbAll(sql, params);
  return rows.map(r => ({
    ...r,
    reasons: r.reasons_json ? JSON.parse(r.reasons_json) : [],
    risks: r.risks_json ? JSON.parse(r.risks_json) : [],
  }));
}

module.exports = {
  calcShortSignal,
  calcAllShortSignals,
  getShortOpportunities,
};
