/**
 * 期权策略信号模块
 * 基于AK(AlbertTheKing)交易体系的策略实现
 * 
 * 核心策略:
 * 1. Gamma Explosion (末日轮) - 买入即将到期的虚值期权博方向
 * 2. Covered Call (备兑看涨) - 持仓时卖出虚值call收权利金增强
 * 3. Protective Put (保护性看跌) - 持仓时买put防回撤
 * 4. Short Strangle (做空波动率) - 横盘时同时卖虚值call+put
 * 5. Long Straddle (做多波动率) - 重大事件前买同行权价call+put
 * 6. Bull Put Spread (牛市价差) - 看多但降低成本
 * 7. Bear Call Spread (熊市价差) - 看空但降低成本
 */

const { priceOption, timeToExpiry } = require('./pricing');

/**
 * 策略1: Gamma Explosion 末日轮信号
 * AK核心策略: 在价格拐点处买入剩余1-3天到期的虚值期权
 * 特点: 成本极低(白菜价)，判断正确可翻10-20倍，判断错误最多亏权利金
 * 
 * @param {Object} params
 * @param {number} params.currentPrice - 当前标的价格
 * @param {Array} params.chain - 期权链 {expiryDate, daysToExpiry, options:[]}
 * @param {string} params.direction - 'up'(看涨买call) | 'down'(看跌买put) | 'both'(双买)
 * @param {number} params.confidence - 方向判断置信度(0-1), 影响虚值程度选择
 * @returns {Array} 推荐的期权合约列表
 */
function gammaExplosion(params) {
  const { currentPrice, chain, direction = 'up', confidence = 0.6 } = params;
  const signals = [];

  // 筛选剩余1-5天到期的期权
  const nearExpiry = chain.filter(c => c.daysToExpiry >= 0 && c.daysToExpiry <= 5);
  if (nearExpiry.length === 0) return signals;

  // 根据置信度选择虚值程度 (置信度越低越保守，选更近的行权价)
  // confidence 0.5 -> ~5% OTM, 0.8 -> ~15-20% OTM, 0.95 -> ~30% OTM
  const otmPercent = 0.05 + confidence * 0.25;

  for (const expiry of nearExpiry) {
    const calls = expiry.options.filter(o => o.type === 'call').sort((a, b) => a.strike - b.strike);
    const puts = expiry.options.filter(o => o.type === 'put').sort((a, b) => a.strike - b.strike);

    if (direction === 'up' || direction === 'both') {
      // 找目标行权价附近的call
      const targetStrike = currentPrice * (1 + otmPercent);
      const targetCall = findNearestOption(calls, targetStrike);
      if (targetCall && targetCall.askPrice > 0) {
        const costUSD = targetCall.askPrice * currentPrice; // Deribit期权以BTC计价，这里转USD
        signals.push({
          strategy: 'Gamma Explosion',
          action: 'BUY',
          option: targetCall,
          direction: 'bullish',
          expiryDate: expiry.expiryDate,
          daysToExpiry: expiry.daysToExpiry,
          reason: `${expiry.daysToExpiry}天后到期，买入${targetCall.strike}Call成本极低(约$${costUSD.toFixed(1)})，判断正确可翻5-20倍，错误最多亏权利金`,
          riskReward: estimateGammaRR(targetCall, currentPrice, expiry.daysToExpiry, 'call'),
          suggestedPositionPct: Math.min(0.02, confidence * 0.02), // 建议用总资金的1-2%
          priority: confidence > 0.8 ? 'high' : 'medium'
        });
      }
    }

    if (direction === 'down' || direction === 'both') {
      const targetStrike = currentPrice * (1 - otmPercent);
      const targetPut = findNearestOption(puts, targetStrike);
      if (targetPut && targetPut.askPrice > 0) {
        const costUSD = targetPut.askPrice * currentPrice;
        signals.push({
          strategy: 'Gamma Explosion',
          action: 'BUY',
          option: targetPut,
          direction: 'bearish',
          expiryDate: expiry.expiryDate,
          daysToExpiry: expiry.daysToExpiry,
          reason: `${expiry.daysToExpiry}天后到期，买入${targetPut.strike}Put成本极低(约$${costUSD.toFixed(1)})，暴跌时高Gamma快速盈利`,
          riskReward: estimateGammaRR(targetPut, currentPrice, expiry.daysToExpiry, 'put'),
          suggestedPositionPct: Math.min(0.02, confidence * 0.02),
          priority: confidence > 0.8 ? 'high' : 'medium'
        });
      }
    }
  }

  return signals;
}

/**
 * 策略2: Covered Call 备兑看涨
 * 持仓标的时，卖出虚值call，赚权利金增强收益
 * AK策略群在上涨途中常用的止盈手法之一
 * 
 * @param {Object} params
 * @param {number} params.currentPrice
 * @param {Array} params.chain
 * @param {number} params.targetPrice - 你认为短期不会突破的价格
 * @param {number} params.holdings - 持仓数量(BTC/ETH)
 * @returns {Array}
 */
function coveredCall(params) {
  const { currentPrice, chain, targetPrice, holdings = 1 } = params;
  const signals = [];

  // 选7-30天到期的期权（太远流动性差，太近收不到多少权利金）
  const suitable = chain.filter(c => c.daysToExpiry >= 7 && c.daysToExpiry <= 30);
  if (suitable.length === 0) return signals;

  const target = targetPrice || currentPrice * 1.1;

  for (const expiry of suitable.slice(0, 2)) {
    const calls = expiry.options.filter(o => o.type === 'call' && o.strike >= target).sort((a, b) => a.strike - b.strike);
    if (calls.length === 0) continue;

    // 选择最接近目标价的虚值call
    const selectedCall = calls[0];
    const premiumPct = selectedCall.bidPrice * 100; // Deribit价格以BTC计，0.001 = 0.1% of 1 BTC
    const annualizedReturn = (premiumPct / expiry.daysToExpiry) * 365;

    signals.push({
      strategy: 'Covered Call',
      action: 'SELL',
      option: selectedCall,
      expiryDate: expiry.expiryDate,
      daysToExpiry: expiry.daysToExpiry,
      premium: selectedCall.bidPrice,
      premiumUSD: selectedCall.bidPrice * currentPrice,
      premiumPct: premiumPct.toFixed(2) + '%',
      annualizedReturn: annualizedReturn.toFixed(1) + '%',
      maxProfitPoint: selectedCall.strike,
      reason: `卖出${expiry.daysToExpiry}天${selectedCall.strike}Call，收权利金${premiumPct.toFixed(2)}%（年化${annualizedReturn.toFixed(0)}%），价格到${selectedCall.strike}以上才会被行权，锁定卖价`,
      quantity: holdings,
      priority: premiumPct > 2 ? 'high' : 'medium'
    });
  }

  return signals;
}

/**
 * 策略3: Protective Put 保护性看跌
 * 持仓时买入put做保险，控制最大回撤
 * AK群在牛市中一直持有低价值put作为回撤保护
 * 
 * @param {Object} params
 * @param {number} params.currentPrice
 * @param {Array} params.chain
 * @param {number} params.maxLossPct - 愿意承受的最大跌幅
 * @param {number} params.holdings
 */
function protectivePut(params) {
  const { currentPrice, chain, maxLossPct = 0.15, holdings = 1 } = params;
  const signals = [];

  // 选15-60天到期（保护一段时间）
  const suitable = chain.filter(c => c.daysToExpiry >= 15 && c.daysToExpiry <= 60);
  if (suitable.length === 0) return signals;

  const targetStrike = currentPrice * (1 - maxLossPct);

  for (const expiry of suitable.slice(0, 2)) {
    const puts = expiry.options.filter(o => o.type === 'put' && o.strike <= currentPrice).sort((a, b) => b.strike - a.strike);
    const selectedPut = findNearestOption(puts, targetStrike);
    if (!selectedPut || selectedPut.askPrice <= 0) continue;

    const costPct = selectedPut.askPrice * 100; // Deribit以BTC计，0.01 = 1%
    const protectedPrice = selectedPut.strike;
    const maxLoss = ((currentPrice - protectedPrice) / currentPrice * 100) + costPct;

    signals.push({
      strategy: 'Protective Put',
      action: 'BUY',
      option: selectedPut,
      expiryDate: expiry.expiryDate,
      daysToExpiry: expiry.daysToExpiry,
      costPct: costPct.toFixed(2) + '%',
      costUSD: selectedPut.askPrice * currentPrice,
      protectedBelow: protectedPrice,
      maxLossPct: maxLoss.toFixed(2) + '%',
      reason: `买入${expiry.daysToExpiry}天${selectedPut.strike}Put作为保护，成本${costPct.toFixed(2)}%，跌破${Math.round(protectedPrice)}后put收益对冲持仓亏损，最大亏损约${maxLoss.toFixed(1)}%`,
      quantity: holdings,
      priority: costPct < 3 ? 'high' : 'medium'
    });
  }

  return signals;
}

/**
 * 策略4: Short Strangle 做空波动率
 * 判断横盘时同时卖出虚值call+put，双份权利金
 * AK文章: 高手从"不涨不跌"中赚钱的方法
 * 
 * @param {Object} params
 * @param {number} params.currentPrice
 * @param {Array} params.chain
 * @param {number} params.upperBound - 判断不会超过的价格
 * @param {number} params.lowerBound - 判断不会跌破的价格
 */
function shortStrangle(params) {
  const { currentPrice, chain, upperBound, lowerBound } = params;
  const signals = [];

  if (!upperBound || !lowerBound) return signals;

  // 选7-21天到期
  const suitable = chain.filter(c => c.daysToExpiry >= 7 && c.daysToExpiry <= 21);
  if (suitable.length === 0) return signals;

  for (const expiry of suitable.slice(0, 2)) {
    const calls = expiry.options.filter(o => o.type === 'call').sort((a, b) => a.strike - b.strike);
    const puts = expiry.options.filter(o => o.type === 'put').sort((a, b) => b.strike - a.strike);

    const shortCall = calls.find(o => o.strike >= upperBound);
    const shortPut = puts.find(o => o.strike <= lowerBound);

    if (!shortCall || !shortPut) continue;

    const callPremium = shortCall.bidPrice;
    const putPremium = shortPut.bidPrice;
    const totalPremium = callPremium + putPremium;
    const totalPremiumPct = totalPremium * 100;
    const totalPremiumUSD = totalPremium * currentPrice;

    signals.push({
      strategy: 'Short Strangle',
      action: 'SELL',
      options: [
        { ...shortCall, side: 'short' },
        { ...shortPut, side: 'short' }
      ],
      expiryDate: expiry.expiryDate,
      daysToExpiry: expiry.daysToExpiry,
      totalPremium,
      totalPremiumPct: totalPremiumPct.toFixed(2) + '%',
      totalPremiumUSD,
      profitRange: `${shortPut.strike} - ${shortCall.strike}`,
      maxProfit: totalPremiumUSD,
      reason: `判断${expiry.daysToExpiry}天内价格在${shortPut.strike}-${shortCall.strike}区间，卖出${shortCall.strike}Call+${shortPut.strike}Put，双收权利金${totalPremiumPct.toFixed(2)}%，区间内全赚。注意：突破区间亏损无上限，需有保证金风控`,
      priority: totalPremiumPct > 3 ? 'high' : 'medium',
      warning: '裸卖期权亏损无上限，需严格风控：short call准备等量BTC保证金，short put准备等量保证金或用期货对冲'
    });
  }

  return signals;
}

/**
 * 策略5: Long Straddle 做多波动率
 * 重大事件(如ETF通过、减半等)前，同时买入平值call+put
 * 不管大涨大跌都赚钱，只亏时间价值
 * 
 * @param {Object} params
 * @param {number} params.currentPrice
 * @param {Array} params.chain
 * @param {string} params.catalyst - 事件名称
 */
function longStraddle(params) {
  const { currentPrice, chain } = params;
  const signals = [];

  // 选事件前到期的短期期权（3-14天）
  const suitable = chain.filter(c => c.daysToExpiry >= 3 && c.daysToExpiry <= 14);
  if (suitable.length === 0) return signals;

  for (const expiry of suitable.slice(0, 1)) {
    const atmCall = findATMOption(expiry.options.filter(o => o.type === 'call'), currentPrice);
    const atmPut = findATMOption(expiry.options.filter(o => o.type === 'put'), currentPrice);

    if (!atmCall || !atmPut) continue;

    const totalCost = atmCall.askPrice + atmPut.askPrice;
    const totalCostPct = totalCost * 100;
    const totalCostUSD = totalCost * currentPrice;
    const moveNeeded = totalCostPct; // 需要涨/跌超过这个百分比才盈利

    signals.push({
      strategy: 'Long Straddle',
      action: 'BUY',
      options: [
        { ...atmCall, side: 'long' },
        { ...atmPut, side: 'long' }
      ],
      expiryDate: expiry.expiryDate,
      daysToExpiry: expiry.daysToExpiry,
      totalCost,
      totalCostPct: totalCostPct.toFixed(2) + '%',
      totalCostUSD,
      moveNeeded: moveNeeded.toFixed(1) + '%',
      reason: `买入${expiry.daysToExpiry}天平值Call+Put，成本${totalCostPct.toFixed(2)}%，涨跌超过${moveNeeded.toFixed(1)}%即盈利，赌大波动。时间是敌人，越临近到期亏得越快`,
      priority: totalCostPct < 10 ? 'high' : 'medium'
    });
  }

  return signals;
}

// --- 辅助函数 ---

function findNearestOption(options, targetStrike) {
  if (!options || options.length === 0) return null;
  return options.reduce((best, opt) => {
    if (!best) return opt;
    return Math.abs(opt.strike - targetStrike) < Math.abs(best.strike - targetStrike) ? opt : best;
  }, null);
}

function findATMOption(options, currentPrice) {
  return findNearestOption(options.filter(o => o.askPrice > 0), currentPrice);
}

function estimateGammaRR(option, currentPrice, daysToExpiry, type) {
  // 粗略估算末日轮的盈亏比
  // 假设有20%概率翻5倍，10%概率翻10倍，70%概率归零下注1单位
  // 但更直观的方式：计算需要多大波动才能回本
  const cost = option.askPrice * currentPrice;
  if (cost <= 0) return { ratio: 'N/A', moveNeeded: 'N/A' };

  const strike = option.strike;
  let moveNeeded;
  if (type === 'call') {
    moveNeeded = ((strike + cost) / currentPrice - 1) * 100;
  } else {
    moveNeeded = (1 - (strike - cost) / currentPrice) * 100;
  }
  return {
    ratio: '10-50x',
    moveNeeded: moveNeeded.toFixed(1) + '%'
  };
}

/**
 * 综合策略扫描 - 一次性扫描所有策略信号
 * @param {Object} params
 */
function scanAllSignals(params) {
  const { currentPrice, chain, marketBias, volatilityRegime } = params;
  // marketBias: 'bullish' | 'bearish' | 'neutral' | 'high_volatility'
  // volatilityRegime: 'high' | 'low' | 'normal' (IV水平)

  const allSignals = [];

  // 根据市场状态选择策略
  if (marketBias === 'bullish') {
    allSignals.push(...gammaExplosion({ currentPrice, chain, direction: 'up', confidence: 0.7 }));
    // 如果有持仓，covered call
    allSignals.push(...coveredCall({ currentPrice, chain, holdings: 1 }));
  }

  if (marketBias === 'bearish') {
    allSignals.push(...gammaExplosion({ currentPrice, chain, direction: 'down', confidence: 0.7 }));
  }

  if (marketBias === 'neutral' || volatilityRegime === 'low') {
    // 低波动横盘 - 做空波动率
    const upper = currentPrice * 1.08;
    const lower = currentPrice * 0.92;
    allSignals.push(...shortStrangle({ currentPrice, chain, upperBound: upper, lowerBound: lower }));
  }

  if (volatilityRegime === 'high') {
    // 高波动但不确定方向 - 保护性put
    allSignals.push(...protectivePut({ currentPrice, chain, maxLossPct: 0.15, holdings: 1 }));
  }

  // 始终提供保护期权推荐
  allSignals.push(...protectivePut({ currentPrice, chain, maxLossPct: 0.2, holdings: 1 }));

  return allSignals.sort((a, b) => {
    const priority = { high: 0, medium: 1, low: 2 };
    return (priority[a.priority] || 1) - (priority[b.priority] || 1);
  });
}

module.exports = {
  gammaExplosion,
  coveredCall,
  protectivePut,
  shortStrangle,
  longStraddle,
  scanAllSignals
};
