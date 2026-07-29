/**
 * 简单回测引擎 v2
 * 均线趋势策略：MA20>MA60多头排列买入，月度调仓，止损止盈
 */
const db = require('../data/db');
const dayjs = require('dayjs');

function runBacktest(params) {
  const {
    startDate = '20240101',
    endDate = dayjs().format('YYYYMMDD'),
    initialCapital = 1000000,
    topN = 10,
    stopLossPct = -15,
    takeProfitPct = 40,
    maShort = 20,
    maLong = 60,
  } = params;

  const tradeDates = db.prepare(`
    SELECT DISTINCT trade_date FROM daily_kline 
    WHERE trade_date >= ? AND trade_date <= ? 
    ORDER BY trade_date ASC
  `).all(startDate, endDate).map(r => r.trade_date);

  if (tradeDates.length < maLong + 20) {
    return { error: `回测周期太短，需要至少${maLong+20}个交易日` };
  }

  // 股票池（有足够历史数据的非ST股）
  const stockCodes = db.prepare(`
    SELECT DISTINCT dk.code FROM daily_kline dk
    JOIN stock_info si ON dk.code = si.code
    WHERE si.is_st = 0
    GROUP BY dk.code HAVING COUNT(*) >= ?
  `).all(maLong + 30).map(r => r.code);

  if (stockCodes.length < 20) return { error: '有效股票数量不足' };

  const nameMap = {};
  db.prepare('SELECT code, name FROM stock_info').all().forEach(r => { nameMap[r.code] = r.name; });

  let cash = initialCapital;
  let positions = {};
  const navCurve = [];
  const trades = [];
  let peak = initialCapital;
  let maxDrawdown = 0;
  let lastMonth = null;

  for (let di = maLong; di < tradeDates.length; di++) {
    const date = tradeDates[di];
    const monthKey = date.substring(0, 6);

    // 当日价格
    const placeholders = stockCodes.map(()=>'?').join(',');
    const priceRows = db.prepare(
      `SELECT code, close, pct_chg FROM daily_kline WHERE trade_date=? AND code IN (${placeholders})`
    ).all(date, ...stockCodes);
    const priceMap = {};
    for (const p of priceRows) priceMap[p.code] = p;

    // 持仓市值+止损止盈
    let marketValue = 0;
    for (const code of Object.keys({...positions})) {
      const pos = positions[code];
      const price = priceMap[code]?.close;
      if (!price) continue;
      pos.currentPrice = price;
      marketValue += pos.shares * price;
      const pnlPct = (price - pos.buyPrice) / pos.buyPrice * 100;
      if (pnlPct <= stopLossPct || pnlPct >= takeProfitPct) {
        const val = pos.shares * price;
        cash += val;
        trades.push({ code, name: pos.name, buyDate: pos.buyDate, sellDate: date,
          buyPrice: pos.buyPrice, sellPrice: price, shares: pos.shares,
          pnl: Math.round((val - pos.shares*pos.buyPrice)*100)/100,
          pnl_pct: +pnlPct.toFixed(2), reason: pnlPct <= stopLossPct ? '止损' : '止盈' });
        delete positions[code];
        marketValue -= val;
      }
    }

    const totalAssets = cash + marketValue;
    peak = Math.max(peak, totalAssets);
    const dd = (peak - totalAssets) / peak * 100;
    maxDrawdown = Math.max(maxDrawdown, dd);

    if (di % 5 === 0 || di === tradeDates.length - 1) {
      navCurve.push({
        date: date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6,8),
        value: +(totalAssets/initialCapital).toFixed(4),
        totalAssets: Math.round(totalAssets), drawdown: +dd.toFixed(2),
      });
    }

    // 月初调仓
    if (monthKey !== lastMonth) {
      lastMonth = monthKey;
      const candidates = [];
      // 对每只股票算均线+动量
      for (const code of stockCodes.slice(0, 80)) { // 限制数量防超时
        const ks = db.prepare(
          `SELECT close FROM daily_kline WHERE code=? AND trade_date<=? ORDER BY trade_date DESC LIMIT ${maLong+5}`
        ).all(code, date);
        if (ks.length < maLong) continue;
        const closes = ks.map(k=>k.close).reverse();
        const maS = closes.slice(-maShort).reduce((a,b)=>a+b,0)/maShort;
        const maL = closes.slice(-maLong).reduce((a,b)=>a+b,0)/maLong;
        const cur = closes[closes.length-1];
        const prev = closes[closes.length-maShort-1] || cur;
        const momentum = (cur - prev) / prev * 100;
        if (cur > maS && maS > maL && momentum < 20 && momentum > -5) {
          candidates.push({ code, momentum, close: cur });
        }
      }
      candidates.sort((a,b) => b.momentum - a.momentum);
      const buyList = candidates.slice(0, topN);
      const buySet = new Set(buyList.map(b => b.code));

      // 卖出换仓
      for (const code of Object.keys({...positions})) {
        if (!buySet.has(code)) {
          const pos = positions[code];
          const price = priceMap[code]?.close || pos.currentPrice;
          if (price) {
            const val = pos.shares * price; cash += val;
            const pnlPct = (price - pos.buyPrice)/pos.buyPrice*100;
            trades.push({ code, name: pos.name, buyDate: pos.buyDate, sellDate: date,
              buyPrice: pos.buyPrice, sellPrice: price, shares: pos.shares,
              pnl: Math.round((val-pos.shares*pos.buyPrice)*100)/100,
              pnl_pct: +pnlPct.toFixed(2), reason: '换仓' });
            delete positions[code];
          }
        }
      }

      // 买入新仓
      const existing = Object.keys(positions);
      const newCodes = buyList.filter(b => !existing.includes(b.code) && priceMap[b.code]);
      const totalSlots = buyList.length;
      const perStock = (cash * 0.95) / Math.max(1, totalSlots);
      for (const b of newCodes) {
        const price = priceMap[b.code]?.close;
        if (!price) continue;
        const shares = Math.floor(perStock / price / 100) * 100;
        if (shares < 100) continue;
        const cost = shares * price;
        if (cost > cash) continue;
        cash -= cost;
        positions[b.code] = { shares, buyPrice: price, buyDate: date, currentPrice: price, name: nameMap[b.code]||b.code };
      }
    }
  }

  const finalNav = navCurve[navCurve.length-1]?.value || 1;
  const totalReturn = (finalNav - 1)*100;
  const years = Math.max(0.5, dayjs(endDate).diff(dayjs(startDate),'year',true));
  const annualReturn = (Math.pow(finalNav, 1/years)-1)*100;

  const wins = trades.filter(t=>t.pnl>0);
  const losses = trades.filter(t=>t.pnl<=0);
  const winRate = trades.length ? wins.length/trades.length*100 : 0;
  const avgWin = wins.length ? wins.reduce((a,t)=>a+t.pnl_pct,0)/wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((a,t)=>a+t.pnl_pct,0)/losses.length : 0;
  const pf = losses.length && avgLoss !== 0 ? Math.abs((avgWin*wins.length)/(avgLoss*losses.length)) : (wins.length?9.9:0);

  // 基准：等权股票池
  let benchmarkReturn = 0;
  try {
    const sampleCodes = stockCodes.slice(0, 50);
    const ph = sampleCodes.map(()=>'?').join(',');
    const b = db.prepare(`SELECT AVG(last_c/first_c-1)*100 ret FROM (
      SELECT code,
        (SELECT close FROM daily_kline WHERE code=d.code AND trade_date>=? ORDER BY trade_date ASC LIMIT 1) first_c,
        (SELECT close FROM daily_kline WHERE code=d.code AND trade_date<=? ORDER BY trade_date DESC LIMIT 1) last_c
      FROM (SELECT DISTINCT code FROM daily_kline WHERE trade_date BETWEEN ? AND ? AND code IN (${ph})) d
      WHERE first_c>0 AND last_c>0
    )`).get(startDate, endDate, startDate, endDate, ...sampleCodes);
    benchmarkReturn = b?.ret || 0;
  } catch(e) {}

  const finalPositions = Object.entries(positions).map(([code,p]) => ({
    code, name: p.name, shares: p.shares, buyPrice: p.buyPrice, currentPrice: p.currentPrice,
    marketValue: Math.round(p.shares*p.currentPrice),
    pnl: Math.round((p.currentPrice-p.buyPrice)*p.shares),
    pnl_pct: +((p.currentPrice-p.buyPrice)/p.buyPrice*100).toFixed(2),
  }));

  return {
    params: { startDate, endDate, initialCapital, topN, stopLossPct, takeProfitPct },
    summary: {
      total_return: +totalReturn.toFixed(2),
      annual_return: +annualReturn.toFixed(2),
      benchmark_return: +benchmarkReturn.toFixed(2),
      excess_return: +(totalReturn-benchmarkReturn).toFixed(2),
      max_drawdown: +maxDrawdown.toFixed(2),
      win_rate: +winRate.toFixed(1),
      profit_factor: +pf.toFixed(2),
      total_trades: trades.length,
      avg_win: +avgWin.toFixed(2),
      avg_loss: +avgLoss.toFixed(2),
      final_value: Math.round(initialCapital*finalNav),
      years: +years.toFixed(1),
    },
    nav_curve: navCurve,
    trades: trades.slice(-100).reverse(),
    final_positions: finalPositions,
    note: `均线趋势策略：MA${maShort}上穿MA${maLong}买入，月度调仓，止损${Math.abs(stopLossPct)}%/止盈${takeProfitPct}%`,
  };
}

module.exports = { runBacktest };
