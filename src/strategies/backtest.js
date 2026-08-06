/**
 * 简单回测引擎 v2
 * 均线趋势策略：MA20>MA60多头排列买入，月度调仓，止损止盈
 */
const { dbGet, dbAll } = require('../data/db');
const dayjs = require('dayjs');

async function runBacktest(params) {
  const {
    startDate,
    endDate = dayjs().format('YYYYMMDD'),
    initialCapital = 1000000,
    topN = 10,
    stopLossPct = -15,
    takeProfitPct = 40,
    maShort = 10,
    maLong = 20,
  } = params;

  // 如果没有指定startDate，自动检测可用数据范围
  const dateRange = await dbGet(`
    SELECT MIN(trade_date) as min_d, MAX(trade_date) as max_d, COUNT(DISTINCT trade_date) as cnt
    FROM daily_kline
  `);

  const actualStart = startDate || dateRange.min_d;
  const actualEnd = endDate || dateRange.max_d;

  const tradeDateRows = await dbAll(`
    SELECT DISTINCT trade_date FROM daily_kline 
    WHERE trade_date >= ? AND trade_date <= ? 
    ORDER BY trade_date ASC
  `, [actualStart, actualEnd]);
  const tradeDates = tradeDateRows.map(r => r.trade_date);

  // 根据实际数据量自动调整均线参数
  const availableDays = tradeDates.length;
  let effMaShort = maShort;
  let effMaLong = maLong;
  let dataNote = '';

  if (availableDays < maLong + 20) {
    if (availableDays >= 40) {
      effMaShort = 5;
      effMaLong = 10;
      dataNote = `当前仅有${availableDays}个交易日数据，已自动调整为MA5/MA10短周期回测。点击"全量同步"可获取3年历史数据进行长期回测。`;
    } else if (availableDays >= 25) {
      effMaShort = 5;
      effMaLong = 10;
      dataNote = `当前仅有${availableDays}个交易日，回测结果参考性有限，建议先执行全量数据同步。`;
    } else {
      return { error: `回测数据不足：当前仅${availableDays}个交易日，需要至少25个交易日。请先执行数据同步。` };
    }
  }

  const minRequired = effMaLong + 10;
  if (tradeDates.length < minRequired) {
    return { error: `回测周期太短，需要至少${minRequired}个交易日（当前${tradeDates.length}个）。请扩大日期范围或执行全量同步。` };
  }

  // 股票池（有足够历史数据的非ST股）
  const requiredKlines = Math.min(effMaLong + 15, availableDays - 5);
  const stockCodeRows = await dbAll(`
    SELECT DISTINCT dk.code FROM daily_kline dk
    JOIN stock_info si ON dk.code = si.code
    WHERE si.is_st = 0
    GROUP BY dk.code HAVING COUNT(*) >= ?
  `, [requiredKlines]);
  const stockCodes = stockCodeRows.map(r => r.code);

  if (stockCodes.length < 10) {
    return { error: `有效股票数量不足（${stockCodes.length}只），需要至少10只。请先执行数据同步。` };
  }

  const nameRows = await dbAll('SELECT code, name FROM stock_info');
  const nameMap = {};
  nameRows.forEach(r => { nameMap[r.code] = r.name; });

  let cash = initialCapital;
  let positions = {};
  const navCurve = [];
  const trades = [];
  let peak = initialCapital;
  let maxDrawdown = 0;
  let lastMonth = null;

  for (let di = effMaLong; di < tradeDates.length; di++) {
    const date = tradeDates[di];
    const monthKey = date.substring(0, 6);

    // 当日价格 — 批量查所有股票
    const placeholders = stockCodes.map(()=>'?').join(',');
    const priceRows = await dbAll(
      `SELECT code, close, pct_chg FROM daily_kline WHERE trade_date=? AND code IN (${placeholders})`,
      [date, ...stockCodes]
    );
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

    // 月初调仓（如果数据量少则每周调仓）
    const rebalanceKey = availableDays < 60 ? date.substring(0, 7) + '-' + Math.floor(parseInt(date.substring(6,8))/7) : monthKey;
    if (rebalanceKey !== lastMonth) {
      lastMonth = rebalanceKey;
      const candidates = [];
      const scanLimit = Math.min(stockCodes.length, 200);
      for (const code of stockCodes.slice(0, scanLimit)) {
        const ks = await dbAll(
          `SELECT close FROM daily_kline WHERE code=? AND trade_date<=? ORDER BY trade_date DESC LIMIT ?`,
          [code, date, effMaLong + 5]
        );
        if (ks.length < effMaLong) continue;
        const closes = ks.map(k=>k.close).reverse();
        const maS = closes.slice(-effMaShort).reduce((a,b)=>a+b,0)/effMaShort;
        const maL = closes.slice(-effMaLong).reduce((a,b)=>a+b,0)/effMaLong;
        const cur = closes[closes.length-1];
        const prev = closes[closes.length-effMaShort-1] || cur;
        const momentum = (cur - prev) / prev * 100;
        if (cur > maS && maS > maL && momentum < 25 && momentum > -8) {
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
  const years = Math.max(0.1, dayjs(actualEnd, 'YYYYMMDD').diff(dayjs(actualStart, 'YYYYMMDD'),'year',true));
  const annualReturn = years >= 0.5 ? (Math.pow(finalNav, 1/years)-1)*100 : totalReturn / years * (tradeDates.length / 252);

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
    const b = await dbGet(`SELECT AVG(last_c/first_c-1)*100 ret FROM (
      SELECT code,
        (SELECT close FROM daily_kline WHERE code=d.code AND trade_date>=? ORDER BY trade_date ASC LIMIT 1) first_c,
        (SELECT close FROM daily_kline WHERE code=d.code AND trade_date<=? ORDER BY trade_date DESC LIMIT 1) last_c
      FROM (SELECT DISTINCT code FROM daily_kline WHERE trade_date BETWEEN ? AND ? AND code IN (${ph})) d
      WHERE first_c>0 AND last_c>0
    )`, [startDate, endDate, startDate, endDate, ...sampleCodes]);
    benchmarkReturn = b?.ret || 0;
  } catch(e) {}

  const finalPositions = Object.entries(positions).map(([code,p]) => ({
    code, name: p.name, shares: p.shares, buyPrice: p.buyPrice, currentPrice: p.currentPrice,
    marketValue: Math.round(p.shares*p.currentPrice),
    pnl: Math.round((p.currentPrice-p.buyPrice)*p.shares),
    pnl_pct: +((p.currentPrice-p.buyPrice)/p.buyPrice*100).toFixed(2),
  }));

  return {
    params: { startDate: actualStart, endDate: actualEnd, initialCapital, topN, stopLossPct, takeProfitPct, maShort: effMaShort, maLong: effMaLong },
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
      years: +years.toFixed(2),
      trading_days: tradeDates.length,
      stock_count: stockCodes.length,
    },
    nav_curve: navCurve,
    trades: trades.slice(-100).reverse(),
    final_positions: finalPositions,
    note: `均线趋势策略：MA${effMaShort}上穿MA${effMaLong}买入，${availableDays < 60 ? '周度' : '月度'}调仓，止损${Math.abs(stopLossPct)}%/止盈${takeProfitPct}%`,
    data_note: dataNote,
  };
}

module.exports = { runBacktest };
