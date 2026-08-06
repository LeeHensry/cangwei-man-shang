/**
 * 期权盈亏计算器
 * 支持组合盈亏曲线计算、到期盈亏分析
 * 基于定价引擎，提供用户友好的计算接口
 */

const { priceOption, analyzePortfolio, portfolioPnL, timeToExpiry } = require('./pricing');

/**
 * 计算单笔期权到期盈亏
 * 注意: 所有金额以USD计价
 * @param {Object} leg
 * @param {string} leg.type - 'call' | 'put'
 * @param {string} leg.side - 'long' | 'short'
 * @param {number} leg.K - 行权价(USD)
 * @param {number} leg.premium - 开仓权利金(USD/合约)
 * @param {number} leg.quantity - 合约数量
 * @param {number} expiryPrice - 到期标的价格(USD)
 * @returns {number} 盈亏(USD)
 */
function calcLegPnL(leg, expiryPrice) {
  const intrinsic = leg.type === 'call'
    ? Math.max(expiryPrice - leg.K, 0)
    : Math.max(leg.K - expiryPrice, 0);
  const sign = leg.side === 'long' ? 1 : -1;
  return sign * leg.quantity * (intrinsic - leg.premium);
}

/**
 * 计算组合在不同价格下的盈亏曲线（含到期前的理论价值）
 * @param {Array} legs - 期权腿列表
 * @param {number} currentPrice - 当前标的价格
 * @param {number} daysToExpiry - 距到期天数
 * @param {number} iv - 隐含波动率
 * @param {number} r - 无风险利率
 * @param {Object} options - {range: 0.5, steps: 200, includeSpot: false}
 */
function calcProfitCurve(legs, currentPrice, daysToExpiry, iv, r = 0, options = {}) {
  const { range = 0.5, steps = 200, includeSpot = false } = options;
  const T = daysToExpiry / 365.25;
  const minP = currentPrice * (1 - range);
  const maxP = currentPrice * (1 + range);

  const points = [];
  let maxProfit = -Infinity;
  let maxLoss = Infinity;

  for (let i = 0; i <= steps; i++) {
    const S = minP + (maxP - minP) * i / steps;
    let totalPnL = 0;

    for (const leg of legs) {
      if (T <= 0) {
        // 到期：只有内在价值
        totalPnL += calcLegPnL(leg, S);
      } else {
        // 到期前：BS理论价值
        const opt = priceOption(leg.type, S, leg.K, T, r, iv);
        const sign = leg.side === 'long' ? 1 : -1;
        totalPnL += sign * leg.quantity * (opt.price - leg.premium);
      }
    }

    points.push({ price: S, pnl: totalPnL });
    if (totalPnL > maxProfit) maxProfit = totalPnL;
    if (totalPnL < maxLoss) maxLoss = totalPnL;
  }

  // 找盈亏平衡点
  const breakevens = [];
  for (let i = 1; i < points.length; i++) {
    if ((points[i-1].pnl <= 0 && points[i].pnl > 0) || (points[i-1].pnl >= 0 && points[i].pnl < 0)) {
      const frac = -points[i-1].pnl / (points[i].pnl - points[i-1].pnl);
      breakevens.push(points[i-1].price + frac * (points[i].price - points[i-1].price));
    }
  }

  // 计算当前价格下的盈亏
  const currentPnL = T <= 0 ? 0 : points.reduce((acc, p) => {
    // 找最接近currentPrice的点
    return Math.abs(p.price - currentPrice) < Math.abs(acc.price - currentPrice) ? p : acc;
  }, { price: 0, pnl: 0 }).pnl;

  return {
    points,
    maxProfit: isFinite(maxProfit) ? maxProfit : 'Unlimited',
    maxLoss: isFinite(maxLoss) ? maxLoss : 'Unlimited',
    breakevens,
    currentPnL
  };
}

/**
 * 识别期权组合策略类型
 */
function detectStrategy(legs) {
  if (legs.length === 1) {
    const leg = legs[0];
    if (leg.type === 'call' && leg.side === 'long') return { name: 'Long Call', description: '看涨，有限亏损无限收益' };
    if (leg.type === 'call' && leg.side === 'short') return { name: 'Short Call', description: '看跌/中性，有限收益无限亏损' };
    if (leg.type === 'put' && leg.side === 'long') return { name: 'Long Put', description: '看跌，有限亏损无限收益' };
    if (leg.type === 'put' && leg.side === 'short') return { name: 'Short Put', description: '看涨/中性，有限收益无限亏损' };
  }

  if (legs.length === 2) {
    const [l1, l2] = legs;
    // Covered Call (long spot + short call) - 简化：如果有现货仓位这里暂不处理
    if (l1.type === 'call' && l2.type === 'call') {
      if (l1.side !== l2.side) return { name: 'Call Spread', description: '垂直价差，有限盈亏' };
    }
    if (l1.type === 'put' && l2.type === 'put') {
      if (l1.side !== l2.side) return { name: 'Put Spread', description: '垂直价差，有限盈亏' };
    }
    // Straddle
    if (l1.type !== l2.type && l1.K === l2.K && l1.side === l2.side) {
      if (l1.side === 'long') return { name: 'Long Straddle', description: '做多波动率，大涨大跌都赚' };
      return { name: 'Short Straddle', description: '做空波动率，横盘赚，突破大亏' };
    }
  }

  if (legs.length === 2) {
    const [l1, l2] = legs;
    if (l1.type !== l2.type && l1.K !== l2.K && l1.side === l2.side) {
      if (l1.side === 'long') return { name: 'Long Strangle', description: '做多波动率(虚值)，成本比Straddle低' };
      return { name: 'Short Strangle', description: '做空波动率(虚值)，区间更宽，双收权利金' };
    }
  }

  return { name: 'Custom Strategy', description: '自定义组合' };
}

/**
 * 生成策略概要说明
 */
function summarizeStrategy(legs, result, currentPrice) {
  const strategy = detectStrategy(legs);
  const maxProfitStr = typeof result.maxProfit === 'number' ? `$${result.maxProfit.toFixed(2)}` : result.maxProfit;
  const maxLossStr = typeof result.maxLoss === 'number' ? `$${result.maxLoss.toFixed(2)}` : result.maxLoss;
  const beStr = result.breakevens.length > 0
    ? result.breakevens.map(b => `$${b.toFixed(0)}`).join(', ')
    : 'None';

  // 总成本（USD）
  const totalCost = legs.reduce((sum, leg) => {
    const sign = leg.side === 'long' ? 1 : -1;
    return sum + sign * leg.premium * leg.quantity;
  }, 0);

  return {
    ...strategy,
    totalCost: totalCost >= 0 ? `$${totalCost.toFixed(2)} (支出)` : `$${Math.abs(totalCost).toFixed(2)} (收入)`,
    maxProfit: maxProfitStr,
    maxLoss: maxLossStr,
    breakevens: beStr,
    legCount: legs.length
  };
}

module.exports = {
  calcLegPnL,
  calcProfitCurve,
  detectStrategy,
  summarizeStrategy
};
