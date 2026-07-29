/**
 * 技术指标计算模块
 * 纯JS实现，不依赖第三方金融库
 * 支持：MA/EMA/MACD/RSI/KDJ(KDJ)/BOLL/量比
 */

// ========== 基础统计工具 ==========

// 简单移动平均 SMA
function SMA(data, period) {
  const result = new Array(data.length).fill(null);
  if (data.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  result[period - 1] = sum / period;
  for (let i = period; i < data.length; i++) {
    sum = sum - data[i - period] + data[i];
    result[i] = sum / period;
  }
  return result;
}

// 指数移动平均 EMA
function EMA(data, period) {
  const result = new Array(data.length).fill(null);
  if (data.length < period) return result;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = ema;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

// 标准差
function STD(data, period) {
  const result = new Array(data.length).fill(null);
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    result[i] = Math.sqrt(variance);
  }
  return result;
}

// 最高/最低值
function HHV(data, period) {
  const result = new Array(data.length).fill(null);
  for (let i = period - 1; i < data.length; i++) {
    result[i] = Math.max(...data.slice(i - period + 1, i + 1));
  }
  return result;
}

function LLV(data, period) {
  const result = new Array(data.length).fill(null);
  for (let i = period - 1; i < data.length; i++) {
    result[i] = Math.min(...data.slice(i - period + 1, i + 1));
  }
  return result;
}

// ========== 技术指标 ==========

/**
 * MACD (12, 26, 9)
 * DIF = EMA(CLOSE,12) - EMA(CLOSE,26)
 * DEA = EMA(DIF,9)
 * MACD柱 = 2*(DIF-DEA)
 */
function calcMACD(closes) {
  const ema12 = EMA(closes, 12);
  const ema26 = EMA(closes, 26);
  const dif = closes.map((_, i) => {
    if (ema12[i] === null || ema26[i] === null) return null;
    return ema12[i] - ema26[i];
  });
  const dea = EMA(dif.map(v => v === null ? 0 : v), 9);
  // 修正DEA前序null
  for (let i = 0; i < 25; i++) dea[i] = null;
  
  const bar = dif.map((d, i) => {
    if (d === null || dea[i] === null) return null;
    return 2 * (d - dea[i]);
  });
  return { dif, dea, bar };
}

/**
 * RSI (相对强弱指标)
 * RSI(N) = 100 - 100/(1 + RS)
 * RS = N日平均涨幅/N日平均跌幅
 */
function calcRSI(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length <= period) return result;
  
  let upSum = 0, downSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) upSum += diff;
    else downSum += Math.abs(diff);
  }
  
  let avgUp = upSum / period;
  let avgDown = downSum / period;
  result[period] = avgDown === 0 ? 100 : 100 - 100 / (1 + avgUp / avgDown);
  
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const up = diff > 0 ? diff : 0;
    const down = diff < 0 ? Math.abs(diff) : 0;
    avgUp = (avgUp * (period - 1) + up) / period;
    avgDown = (avgDown * (period - 1) + down) / period;
    result[i] = avgDown === 0 ? 100 : 100 - 100 / (1 + avgUp / avgDown);
  }
  return result;
}

/**
 * KDJ (9, 3, 3)
 * RSV = (C-LLV(L,9))/(HHV(H,9)-LLV(L,9)) * 100
 * K = SMA(RSV,3) 实际是 2/3*前K + 1/3*RSV
 * D = SMA(K,3)   实际是 2/3*前D + 1/3*K
 * J = 3K - 2D
 */
function calcKDJ(highs, lows, closes, n = 9, m1 = 3, m2 = 3) {
  const K = new Array(closes.length).fill(null);
  const D = new Array(closes.length).fill(null);
  const J = new Array(closes.length).fill(null);
  
  const hhv = HHV(highs, n);
  const llv = LLV(lows, n);
  
  let prevK = 50, prevD = 50;
  for (let i = 0; i < closes.length; i++) {
    if (hhv[i] === null || llv[i] === null) continue;
    const rsv = hhv[i] === llv[i] ? 50 : (closes[i] - llv[i]) / (hhv[i] - llv[i]) * 100;
    const k = (prevK * (m1 - 1) + rsv) / m1;
    const d = (prevD * (m2 - 1) + k) / m2;
    const j = 3 * k - 2 * d;
    K[i] = +k.toFixed(2);
    D[i] = +d.toFixed(2);
    J[i] = +j.toFixed(2);
    prevK = k;
    prevD = d;
  }
  return { K, D, J };
}

/**
 * 布林带 BOLL(20, 2)
 * MID = MA(CLOSE, 20)
 * UPPER = MID + 2*STD(CLOSE,20)
 * LOWER = MID - 2*STD(CLOSE,20)
 */
function calcBOLL(closes, period = 20, times = 2) {
  const mid = SMA(closes, period);
  const std = STD(closes, period);
  const upper = mid.map((m, i) => m === null || std[i] === null ? null : m + times * std[i]);
  const lower = mid.map((m, i) => m === null || std[i] === null ? null : m - times * std[i]);
  return { upper, mid, lower };
}

/**
 * 计算所有技术指标并返回
 * @param {Array} klines K线数组，按日期升序
 */
function calcAllIndicators(klines) {
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  
  const ma5 = SMA(closes, 5);
  const ma10 = SMA(closes, 10);
  const ma20 = SMA(closes, 20);
  const ma60 = SMA(closes, 60);
  const ma120 = SMA(closes, 120);
  const ma250 = SMA(closes, 250);
  
  const volMa5 = SMA(volumes, 5);
  const volMa20 = SMA(volumes, 20);
  
  const macd = calcMACD(closes);
  const rsi6 = calcRSI(closes, 6);
  const rsi14 = calcRSI(closes, 14);
  const kdj = calcKDJ(highs, lows, closes);
  const boll = calcBOLL(closes);
  
  return klines.map((k, i) => ({
    code: k.code,
    trade_date: k.trade_date,
    ma5: ma5[i] ? +ma5[i].toFixed(2) : null,
    ma10: ma10[i] ? +ma10[i].toFixed(2) : null,
    ma20: ma20[i] ? +ma20[i].toFixed(2) : null,
    ma60: ma60[i] ? +ma60[i].toFixed(2) : null,
    ma120: ma120[i] ? +ma120[i].toFixed(2) : null,
    ma250: ma250[i] ? +ma250[i].toFixed(2) : null,
    vol_ma5: volMa5[i] ? +volMa5[i].toFixed(0) : null,
    vol_ma20: volMa20[i] ? +volMa20[i].toFixed(0) : null,
    macd_dif: macd.dif[i] ? +macd.dif[i].toFixed(3) : null,
    macd_dea: macd.dea[i] ? +macd.dea[i].toFixed(3) : null,
    macd_bar: macd.bar[i] ? +macd.bar[i].toFixed(3) : null,
    rsi6: rsi6[i] ? +rsi6[i].toFixed(2) : null,
    rsi14: rsi14[i] ? +rsi14[i].toFixed(2) : null,
    kdj_k: kdj.K[i],
    kdj_d: kdj.D[i],
    kdj_j: kdj.J[i],
    boll_upper: boll.upper[i] ? +boll.upper[i].toFixed(2) : null,
    boll_mid: boll.mid[i] ? +boll.mid[i].toFixed(2) : null,
    boll_lower: boll.lower[i] ? +boll.lower[i].toFixed(2) : null,
  }));
}

// ========== 信号识别（额外辅助函数） ==========

/**
 * 判断均线多头排列
 */
function isBullishMA(ind) {
  return ind.ma5 && ind.ma10 && ind.ma20 && ind.ma60 &&
    ind.ma5 > ind.ma10 && ind.ma10 > ind.ma20 && ind.ma20 > ind.ma60;
}

/**
 * MACD金叉
 */
function isMACDCross(prev, curr) {
  return prev && curr &&
    prev.macd_dif <= prev.macd_dea && curr.macd_dif > curr.macd_dea;
}

/**
 * MACD死叉
 */
function isMACDDeadCross(prev, curr) {
  return prev && curr &&
    prev.macd_dif >= prev.macd_dea && curr.macd_dif < curr.macd_dea;
}

/**
 * 放量突破（量比>2 且 价格突破20日线）
 */
function isVolumeBreakout(prev, curr, kline) {
  if (!curr.vol_ma20 || curr.vol_ma20 === 0) return false;
  const volRatio = kline.volume / curr.vol_ma20;
  return volRatio > 1.5 && curr.close > curr.ma20 && (!prev || prev.close <= prev.ma20);
}

/**
 * RSI超卖
 */
function isRSIOversold(ind, threshold = 30) {
  return ind.rsi14 !== null && ind.rsi14 < threshold;
}

module.exports = {
  SMA, EMA, STD, HHV, LLV,
  calcMACD, calcRSI, calcKDJ, calcBOLL,
  calcAllIndicators,
  isBullishMA, isMACDCross, isMACDDeadCross, isVolumeBreakout, isRSIOversold,
};
