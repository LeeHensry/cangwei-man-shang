/**
 * 期权策略回测引擎
 * 基于历史K线数据回测AK期权策略
 * 
 * 支持策略:
 * 1. 买入持有 (Buy & Hold 基准)
 * 2. Covered Call 备兑看涨
 * 3. Protective Put 保护性看跌
 * 4. Gamma Explosion 末日轮策略
 * 5. Short Strangle 做空波动率
 */

const { priceOption, timeToExpiry } = require('./pricing');

/**
 * 用BS模型模拟期权价格
 * @param {Object} params
 * @param {number} params.S - 当前价格
 * @param {number} params.K - 行权价
 * @param {number} params.daysToExpiry - 剩余天数
 * @param {number} params.iv - 隐含波动率
 * @param {string} params.type - 'call' | 'put'
 * @param {number} params.r - 利率
 */
function simulateOptionPrice({ S, K, daysToExpiry, iv, type, r = 0 }) {
  const T = Math.max(daysToExpiry, 0) / 365.25;
  return priceOption(type, S, K, T, r, iv);
}

/**
 * 回测Buy & Hold（基准）
 */
function backtestBuyAndHold(klines) {
  if (klines.length < 2) return { returns: 0, trades: 0 };
  const startPrice = klines[0].close;
  const endPrice = klines[klines.length - 1].close;
  return {
    strategy: 'Buy & Hold',
    returns: ((endPrice - startPrice) / startPrice) * 100,
    startPrice,
    endPrice,
    maxDrawdown: calcMaxDrawdown(klines.map(k => k.close)),
    trades: 0
  };
}

/**
 * 回测Covered Call策略
 * 每周卖出delta≈0.2的虚值call（约高于当前价5-15%），到期时：
 * - 如果call被行权(价格>strike)，卖出持仓获得strike价格，下周继续
 * - 如果没被行权，获得权利金
 * 
 * @param {Array} klines - 日线K线 [{timestamp, open, high, low, close, volume}]
 * @param {Object} params - {deltaTarget: 0.2, iv: 0.6}
 */
function backtestCoveredCall(klines, params = {}) {
  const { iv = 0.6, otmPercent = 0.1, r = 0 } = params;
  if (klines.length < 30) return { error: '需要至少30天数据' };

  let cash = 0;
  let holdings = 1; // 持有1 BTC
  let trades = 0;
  const equity = [];
  let entryDay = 0;

  // 每7天roll一次
  const rollPeriod = 7;

  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];
    const dayIdx = i - entryDay;

    // 开仓或roll
    if (i === 0 || (dayIdx > 0 && dayIdx % rollPeriod === 0)) {
      const S = k.close;
      const K = S * (1 + otmPercent);
      const T = rollPeriod / 365.25;
      const opt = simulateOptionPrice({ S, K, daysToExpiry: rollPeriod, iv, type: 'call', r });
      // 收到权利金
      cash += opt.price;
      trades++;

      // 检查到7天后是否被行权
      if (i + rollPeriod < klines.length) {
        const expiryK = klines[Math.min(i + rollPeriod, klines.length - 1)];
        if (expiryK.close > K) {
          // 被行权 - 以K卖出
          cash += K * holdings;
          holdings = 0;
          // 以到期价格买回
          holdings = cash / expiryK.close;
          cash = 0;
        }
      }
    }

    // 记录权益
    const totalValue = cash + holdings * k.close;
    equity.push({ timestamp: k.timestamp, value: totalValue, price: k.close });
  }

  const finalValue = cash + holdings * klines[klines.length - 1].close;
  const initialValue = klines[0].close;
  const returns = ((finalValue - initialValue) / initialValue) * 100;

  return {
    strategy: 'Covered Call',
    returns: returns.toFixed(2) + '%',
    returnsPct: returns,
    maxDrawdown: calcMaxDrawdown(equity.map(e => e.value)),
    trades,
    finalValue,
    initialValue
  };
}

/**
 * 回测Protective Put策略
 * 每月买入5% OTM put做保护
 */
function backtestProtectivePut(klines, params = {}) {
  const { iv = 0.6, otmPercent = 0.1, r = 0 } = params;
  if (klines.length < 30) return { error: '需要至少30天数据' };

  let cash = 0;
  let holdings = 1;
  let trades = 0;
  const equity = [];
  const putPeriod = 30; // 每月买put

  let currentPut = null;
  let putDaysLeft = 0;

  for (let i = 0; i < klines.length; i++) {
    const k = klines[i];

    // 买新put（每个月或初始）
    if (!currentPut || putDaysLeft <= 0) {
      const S = k.close;
      const K = S * (1 - otmPercent);
      const opt = simulateOptionPrice({ S, K, daysToExpiry: putPeriod, iv, type: 'put', r });
      cash -= opt.price;
      currentPut = { K, entryPrice: S, cost: opt.price };
      putDaysLeft = putPeriod;
      trades++;
    }

    putDaysLeft--;

    // 计算put价值
    let putValue = 0;
    if (currentPut && putDaysLeft >= 0) {
      const optNow = simulateOptionPrice({ S: k.close, K: currentPut.K, daysToExpiry: putDaysLeft, iv, type: 'put', r });
      putValue = optNow.price;
    }

    // 到期结算
    if (putDaysLeft <= 0 && currentPut) {
      const intrinsic = Math.max(currentPut.K - k.close, 0);
      cash += intrinsic;
      currentPut = null;
    }

    const totalValue = cash + holdings * k.close + putValue;
    equity.push({ timestamp: k.timestamp, value: totalValue });
  }

  // 最后put价值
  let finalPutValue = 0;
  if (currentPut && putDaysLeft >= 0) {
    const optNow = simulateOptionPrice({ S: klines[klines.length - 1].close, K: currentPut.K, daysToExpiry: putDaysLeft, iv, type: 'put', r });
    finalPutValue = optNow.price;
  }

  const finalValue = cash + holdings * klines[klines.length - 1].close + finalPutValue;
  const initialValue = klines[0].close;
  const returns = ((finalValue - initialValue) / initialValue) * 100;

  return {
    strategy: 'Protective Put',
    returns: returns.toFixed(2) + '%',
    returnsPct: returns,
    maxDrawdown: calcMaxDrawdown(equity.map(e => e.value)),
    trades,
    finalValue,
    initialValue,
    putCostPct: (otmPercent * 100).toFixed(0) + '% OTM'
  };
}

/**
 * 回测Gamma Explosion（末日轮）
 * 简化版：在检测到大波动时买入1-3天到期的OTM期权
 * 这是一个信号驱动策略，需要波动信号
 * 这里用简化规则：当日振幅超过2倍ATR时视为大波动信号
 */
function backtestGammaExplosion(klines, params = {}) {
  const { iv = 0.6, otmPercent = 0.15, allocationPct = 0.02, r = 0, volLookback = 20 } = params;
  if (klines.length < volLookback + 5) return { error: '数据不足' };

  let cash = 0;
  let holdings = 1;
  let trades = 0;
  let wins = 0;
  let losses = 0;
  let totalPnL = 0;
  const equity = [];
  let openOptions = [];

  for (let i = volLookback; i < klines.length; i++) {
    const k = klines[i];
    const S = k.close;

    // 计算ATR
    let atr = 0;
    for (let j = i - volLookback; j < i; j++) {
      atr += klines[j].high - klines[j].low;
    }
    atr /= volLookback;
    const dailyRange = k.high - k.low;
    const avgPrice = k.close;

    // 先结算到期期权
    openOptions = openOptions.filter(opt => {
      opt.daysLeft--;
      if (opt.daysLeft <= 0) {
        const intrinsic = opt.type === 'call'
          ? Math.max(S - opt.K, 0)
          : Math.max(opt.K - S, 0);
        const pnl = intrinsic - opt.cost;
        cash += pnl;
        totalPnL += pnl;
        trades++;
        if (pnl > 0) wins++;
        else losses++;
        return false;
      }
      return true;
    });

    // 大波动信号：当日振幅 > 1.5倍ATR
    if (dailyRange > 1.5 * atr) {
      const isUp = k.close > klines[i - 1].close;
      const K = isUp ? S * (1 + otmPercent) : S * (1 - otmPercent);
      const type = isUp ? 'call' : 'put';
      const premium = simulateOptionPrice({ S, K, daysToExpiry: 3, iv: iv * 1.2, type, r }).price;

      // 用allocationPct的资金买期权
      const positionValue = (cash + holdings * S) * allocationPct;
      const quantity = premium > 0 ? positionValue / (premium * S) : 0;

      if (quantity > 0) {
        cash -= premium * quantity * S;
        openOptions.push({ type, K, cost: premium, quantity: quantity * S, entryPrice: S, daysLeft: 3 });
      }
    }

    // 计算未平仓期权价值
    let optionValue = 0;
    for (const opt of openOptions) {
      const optVal = simulateOptionPrice({ S, K: opt.K, daysToExpiry: opt.daysLeft, iv, type: opt.type, r });
      optionValue += optVal.price * (opt.quantity / opt.entryPrice);
    }

    const totalValue = cash + holdings * S + optionValue;
    equity.push({ timestamp: k.timestamp, value: totalValue });
  }

  // 结算剩余期权（按最后价格平仓）
  const finalS = klines[klines.length - 1].close;
  for (const opt of openOptions) {
    const optVal = simulateOptionPrice({ S: finalS, K: opt.K, daysToExpiry: opt.daysLeft, iv, type: opt.type, r });
    cash += optVal.price * (opt.quantity / opt.entryPrice);
  }

  const finalValue = cash + holdings * finalS;
  const initialValue = klines[volLookback].close;
  const returns = ((finalValue - initialValue) / initialValue) * 100;
  const winRate = trades > 0 ? (wins / trades * 100).toFixed(1) + '%' : 'N/A';

  return {
    strategy: 'Gamma Explosion (末日期权)',
    returns: returns.toFixed(2) + '%',
    returnsPct: returns,
    maxDrawdown: calcMaxDrawdown(equity.map(e => e.value)),
    trades,
    wins,
    losses,
    winRate,
    finalValue,
    initialValue
  };
}

/**
 * 计算最大回撤
 */
function calcMaxDrawdown(values) {
  if (values.length < 2) return 0;
  let peak = values[0];
  let maxDd = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak * 100;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd.toFixed(2) + '%';
}

/**
 * 运行全部策略回测对比
 * @param {Array} klines - K线数据
 * @param {Object} params - 波动率参数等
 */
function runAllBacktests(klines, params = {}) {
  const bh = backtestBuyAndHold(klines);
  const cc = backtestCoveredCall(klines, params);
  const pp = backtestProtectivePut(klines, params);
  const ge = backtestGammaExplosion(klines, params);

  return {
    period: klines.length > 0 ? {
      start: new Date(klines[0].timestamp).toISOString().split('T')[0],
      end: new Date(klines[klines.length - 1].timestamp).toISOString().split('T')[0],
      days: klines.length
    } : null,
    results: [bh, cc, pp, ge]
  };
}

module.exports = {
  simulateOptionPrice,
  backtestBuyAndHold,
  backtestCoveredCall,
  backtestProtectivePut,
  backtestGammaExplosion,
  runAllBacktests,
  calcMaxDrawdown
};
