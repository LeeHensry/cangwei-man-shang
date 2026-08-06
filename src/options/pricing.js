/**
 * Black-Scholes 期权定价引擎
 * 支持欧式现金交割期权（Deribit风格）
 * 计算期权理论价格和Greeks(Delta/Gamma/Vega/Theta/Rho)
 */

// 正态分布CDF
function normCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

// 正态分布PDF
function normPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * 计算Black-Scholes参数d1, d2
 * @param {number} S - 标的价格
 * @param {number} K - 行权价
 * @param {number} T - 剩余时间（年）
 * @param {number} r - 无风险利率（Deribit BTC用永续掉期利率，通常0或负数）
 * @param {number} sigma - 年化隐含波动率
 */
function d1d2(S, K, T, r, sigma) {
  if (T <= 0 || sigma <= 0) return { d1: 0, d2: 0 };
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return { d1, d2 };
}

/**
 * 期权定价
 * @param {string} type - 'call' | 'put'
 * @param {number} S - 标的价格
 * @param {number} K - 行权价
 * @param {number} T - 剩余时间（年）
 * @param {number} r - 无风险利率
 * @param {number} sigma - 年化隐含波动率 (0-1, 如0.6=60%)
 * @returns {{price: number, delta: number, gamma: number, vega: number, theta: number, rho: number}}
 */
function priceOption(type, S, K, T, r, sigma) {
  if (T <= 0) {
    // 到期日
    const intrinsic = type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
    return { price: intrinsic, delta: type === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0),
             gamma: 0, vega: 0, theta: 0, rho: 0 };
  }

  const { d1, d2 } = d1d2(S, K, T, r, sigma);
  const Nd1 = normCDF(d1), Nd2 = normCDF(d2);
  const nd1 = normPDF(d1);
  const disc = Math.exp(-r * T);
  const sqrtT = Math.sqrt(T);

  let price, delta, gamma, vega, theta, rho;

  if (type === 'call') {
    price = S * Nd1 - K * disc * Nd2;
    delta = Nd1;
    rho = K * T * disc * Nd2;
  } else {
    price = K * disc * normCDF(-d2) - S * normCDF(-d1);
    delta = Nd1 - 1;
    rho = -K * T * disc * normCDF(-d2);
  }

  gamma = nd1 / (S * sigma * sqrtT);
  vega = S * sqrtT * nd1;
  theta = -(S * sigma * nd1) / (2 * sqrtT);
  if (type === 'call') {
    theta -= r * K * disc * Nd2;
  } else {
    theta += r * K * disc * normCDF(-d2);
  }

  return {
    price,
    delta,
    gamma,
    vega,
    theta,
    rho
  };
}

/**
 * 从期权价格反推隐含波动率（牛顿迭代法）
 * @param {string} type - 'call' | 'put'
 * @param {number} S - 标的价格
 * @param {number} K - 行权价
 * @param {number} T - 剩余时间（年）
 * @param {number} r - 无风险利率
 * @param {number} marketPrice - 市场期权价格
 * @returns {number} 隐含波动率 (0-1)
 */
function impliedVolatility(type, S, K, T, r, marketPrice) {
  if (T <= 0 || marketPrice <= 0) return 0;
  let sigma = 0.7; // 初始猜测70%
  const tolerance = 0.001;
  const maxIter = 100;

  for (let i = 0; i < maxIter; i++) {
    const { price, vega } = priceOption(type, S, K, T, r, sigma);
    const diff = price - marketPrice;
    if (Math.abs(diff) < tolerance) return sigma;
    if (vega < 1e-10) break;
    sigma = sigma - diff / vega;
    if (sigma < 0.01) sigma = 0.01;
    if (sigma > 5) sigma = 5;
  }
  return sigma;
}

/**
 * 计算期权组合盈亏
 * @param {Array} legs - [{type, side('long'|'short'), K, premium, quantity}]
 * @param {number} S - 到期标的价格
 * @returns {number} 组合盈亏
 */
function portfolioPnL(legs, S) {
  let pnl = 0;
  for (const leg of legs) {
    const intrinsic = leg.type === 'call' ? Math.max(S - leg.K, 0) : Math.max(leg.K - S, 0);
    const sign = leg.side === 'long' ? 1 : -1;
    pnl += sign * leg.quantity * (intrinsic - leg.premium);
  }
  return pnl;
}

/**
 * 计算组合盈亏平衡点和最大盈亏
 * @param {Array} legs - 期权组合
 * @param {number} currentPrice - 当前标的价格
 * @param {number} range - 价格范围倍数
 */
function analyzePortfolio(legs, currentPrice, range = 0.5) {
  const prices = [];
  const pnls = [];
  const minP = currentPrice * (1 - range);
  const maxP = currentPrice * (1 + range);
  const steps = 200;

  for (let i = 0; i <= steps; i++) {
    const p = minP + (maxP - minP) * i / steps;
    prices.push(p);
    pnls.push(portfolioPnL(legs, p));
  }

  const maxProfit = Math.max(...pnls);
  const maxLoss = Math.min(...pnls);

  // 找盈亏平衡点
  const breakevens = [];
  for (let i = 1; i < pnls.length; i++) {
    if ((pnls[i-1] <= 0 && pnls[i] > 0) || (pnls[i-1] >= 0 && pnls[i] < 0)) {
      // 线性插值
      const frac = -pnls[i-1] / (pnls[i] - pnls[i-1]);
      breakevens.push(prices[i-1] + frac * (prices[i] - prices[i-1]));
    }
  }

  return { prices, pnls, maxProfit, maxLoss, breakevens };
}

/**
 * 计算距离到期时间（年）
 * @param {number} expiryTimestamp - 到期日Unix时间戳(ms)
 * @returns {number} T in years
 */
function timeToExpiry(expiryTimestamp) {
  const ms = expiryTimestamp - Date.now();
  if (ms <= 0) return 0;
  return ms / (365.25 * 24 * 3600 * 1000);
}

module.exports = {
  priceOption,
  impliedVolatility,
  portfolioPnL,
  analyzePortfolio,
  timeToExpiry,
  normCDF,
  normPDF
};
