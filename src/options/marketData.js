/**
 * 加密货币历史数据获取
 * 从Binance公开API获取K线数据用于期权回测
 */

const axios = require('axios');

const BINANCE_BASE = 'https://api.binance.com/api/v3';

/**
 * 获取K线数据
 * @param {string} symbol - 'BTCUSDT' | 'ETHUSDT'
 * @param {string} interval - '1d' | '4h' | '1h' | '15m'
 * @param {number} limit - 数量，最多1000
 * @param {number} startTime - 开始时间(ms)
 * @param {number} endTime - 结束时间(ms)
 */
async function getKlines(symbol = 'BTCUSDT', interval = '1d', limit = 500, startTime = null, endTime = null) {
  const params = { symbol, interval, limit };
  if (startTime) params.startTime = startTime;
  if (endTime) params.endTime = endTime;

  try {
    const resp = await axios.get(`${BINANCE_BASE}/klines`, { params, timeout: 15000 });
    return resp.data.map(k => ({
      timestamp: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: k[6]
    }));
  } catch (err) {
    console.error(`Binance klines error for ${symbol}:`, err.message);
    throw err;
  }
}

/**
 * 获取历史波动率 (从K线计算)
 * @param {Array} klines
 * @param {number} period - 计算周期
 * @returns {number} 年化波动率
 */
function calcHistoricalVolatility(klines, period = 30) {
  if (klines.length < period + 1) return 0.6; // 默认60%

  const returns = [];
  for (let i = klines.length - period; i < klines.length; i++) {
    const ret = Math.log(klines[i].close / klines[i - 1].close);
    returns.push(ret);
  }

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  const dailyVol = Math.sqrt(variance);
  return dailyVol * Math.sqrt(365); // 年化
}

/**
 * 获取多段K线（突破1000根限制）
 */
async function getHistoricalKlines(symbol = 'BTCUSDT', interval = '1d', days = 365) {
  const allKlines = [];
  const limit = 1000;
  let endTime = Date.now();
  const msPerInterval = interval === '1d' ? 86400000 : interval === '4h' ? 14400000 : 3600000;
  const needed = Math.min(days * (86400000 / msPerInterval), 10000);

  while (allKlines.length < needed) {
    const batch = await getKlines(symbol, interval, limit, null, endTime);
    if (batch.length === 0) break;
    allKlines.unshift(...batch);
    endTime = batch[0].timestamp - 1;
    if (batch.length < limit) break;
    await new Promise(r => setTimeout(r, 100)); // rate limit
  }

  return allKlines.slice(-needed);
}

module.exports = { getKlines, getHistoricalKlines, calcHistoricalVolatility };
