/**
 * 期权交易模块
 * 基于Deribit平台的加密货币期权策略系统
 * 
 * 模块结构:
 * - pricing.js: Black-Scholes定价引擎 + Greeks计算
 * - deribit.js: Deribit API接入(行情+交易)
 * - strategies.js: AK策略体系信号(Gamma Explosion/Covered Call/Protective Put等)
 * - calculator.js: 期权组合盈亏计算器
 * - backtest.js: 策略历史回测
 * - marketData.js: Binance历史K线数据获取
 */

const pricing = require('./pricing');
const deribit = require('./deribit');
const strategies = require('./strategies');
const calculator = require('./calculator');
const backtest = require('./backtest');
const marketData = require('./marketData');

module.exports = { pricing, deribit, strategies, calculator, backtest, marketData };
