/**
 * 动态股票池管理
 * 设计：
 * - Universe：从全市场动态筛选 Top 1000 只（按市值降序，排除ST/退市/价格<2元），每月更新
 * - Pool：从 Universe 中按流动性+动量+市值综合打分，选 Top 200 作为重点关注池
 * - 用户自选股票始终入池，不受筛选淘汰
 */
const { dbGet, dbAll, dbRun, dbBatch } = require('./db');
const ds = require('./datasources');
const dayjs = require('dayjs');

// 静态内置池作为兜底（首次启动/数据库为空时使用）
const BUILTIN_UNIVERSE = require('../../data/stock_universe.json');

const UNIVERSE_SIZE = 1000;  // 动态Universe目标数量

/**
 * 从东方财富拉取全市场A股，按市值降序取Top 1000写入stock_universe表
 * 建议每月执行一次
 */
async function updateUniverse() {
  console.log(`[universe] 开始动态更新股票Universe，目标数量: ${UNIVERSE_SIZE}`);
  const t0 = Date.now();
  const tq = require('./datasources/tencent');

  // 用东方财富接口拉全市场A股（已含市值、行情）
  const em = require('./eastmoney');
  let allStocks = [];
  try {
    allStocks = await em.getStockList();
    console.log(`[universe] 东方财富拉取到 ${allStocks.length} 只股票`);
  } catch(e) {
    console.error('[universe] 东方财富拉取失败:', e.message);
    // 降级：用腾讯接口
    try {
      allStocks = await tq.getStockList();
      console.log(`[universe] 腾讯降级拉取到 ${allStocks.length} 只股票`);
    } catch(e2) {
      console.error('[universe] 腾讯也失败:', e2.message);
    }
  }
  // 如果数据源全部失败，用静态JSON兜底
  if (!allStocks || allStocks.length === 0) {
    console.log('[universe] 数据源全部失败，用静态JSON兜底');
    allStocks = BUILTIN_UNIVERSE.map(c => {
      const code = String(c).replace(/^(sh|sz|bj)/, '');
      return { code, name: '', market: code.startsWith('6') ? 'SH' : 'SZ', total_mv: 0, circ_mv: 0, close: 0, pct_chg: 0, amount: 0, is_st: 0 };
    });
  }

  // 过滤：排除ST、退市、价格<2元、北交所
  let filtered = allStocks.filter(s => {
    if (s.is_st) return false;
    if (s.market === 'BJ') return false;
    if (s.close && s.close > 0 && s.close < 2) return false;
    if (s.name && (s.name.includes('退') || s.name.includes('ST'))) return false;
    return true;
  });
  console.log(`[universe] 过滤后剩余 ${filtered.length} 只`);

  // 如果拉取数量太少（<500），用静态JSON补充
  if (filtered.length < 500) {
    console.log(`[universe] 拉取数量不足(${filtered.length})，用静态JSON补充`);
    const builtinCodes = BUILTIN_UNIVERSE.map(c => String(c).replace(/^(sh|sz|bj)/, ''));
    const existingCodes = new Set(filtered.map(s => s.code));
    const supplement = builtinCodes
      .filter(c => !existingCodes.has(c))
      .map(c => ({ code: c, name: '', market: c.startsWith('6') ? 'SH' : 'SZ', total_mv: 0, circ_mv: 0, close: 0, pct_chg: 0, amount: 0, is_st: 0 }));
    filtered = [...filtered, ...supplement];
    console.log(`[universe] 补充后共 ${filtered.length} 只`);
  }

  // 按总市值降序排序，取Top 1000
  filtered.sort((a, b) => (b.total_mv || 0) - (a.total_mv || 0));
  const topStocks = filtered.slice(0, UNIVERSE_SIZE);
  console.log(`[universe] 按市值取Top ${topStocks.length} 只`);

  // 写入数据库
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');

  // 先标记所有为不在universe
  await dbRun(`UPDATE stock_universe SET in_universe = 0, updated_at = ?`, [now]);

  // 批量插入/更新
  const batchStmts = topStocks.map(s => ({
    sql: `INSERT OR REPLACE INTO stock_universe
      (code, name, market, total_mv, circ_mv, close, pct_chg, amount, is_st, updated_at, in_universe)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      String(s.code).replace(/^(sh|sz|bj)/, ''),
      s.name,
      s.market,
      s.total_mv || null,
      s.circ_mv || null,
      s.close || null,
      s.pct_chg || null,
      s.amount || null,
      s.is_st || 0,
      now,
      1
    ]
  }));

  for (let i = 0; i < batchStmts.length; i += 200) {
    await dbBatch(batchStmts.slice(i, i + 200));
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[universe] ✅ 更新完成，共 ${topStocks.length} 只，耗时 ${elapsed}s`);
  return { total: topStocks.length, elapsed: Date.now() - t0 };
}

/**
 * 获取当前Universe股票代码列表（优先读数据库动态表，降级读静态JSON）
 */
async function getUniverseCodes() {
  try {
    const rows = await dbAll(`SELECT code FROM stock_universe WHERE in_universe = 1`);
    if (rows && rows.length > 0) {
      return rows.map(r => r.code);
    }
  } catch(e) {
    console.log('[universe] 读数据库失败，降级静态JSON:', e.message);
  }
  // 降级：静态JSON
  return BUILTIN_UNIVERSE.map(c => String(c).replace(/^(sh|sz|bj)/, ''));
}

/**
 * 执行股票池更新（每周一执行）
 * 从动态Universe中按流动性+动量+市值综合打分，选Top 200
 * @param {number} targetSize 目标股票池大小，默认200
 */
async function updateStockPool(targetSize = 200) {
  console.log('[pool] 开始更新股票池，目标数量:', targetSize);
  const t0 = Date.now();

  // 1. 构建待扫描股票名单：动态Universe + 已有池内股票（含手动添加）+ portfolio里的股票
  const universeCodes = await getUniverseCodes();
  const manualRows = await dbAll(`SELECT code, name FROM stock_pool WHERE is_manual = 1`);
  const manualCodes = manualRows.map(r => r.code);
  const portfolioRows = await dbAll(`SELECT DISTINCT code FROM portfolio WHERE status='holding'`);
  const portfolioCodes = portfolioRows.map(r => r.code);
  const universeSet = new Set([...universeCodes, ...manualCodes, ...portfolioCodes]);
  // 保证所有代码格式正确（sh/sz前缀）
  const allCodes = [...universeSet].map(toTencentCode);
  console.log(`[pool] 待扫描股票: ${allCodes.length} 只`);

  // 2. 批量拉取行情（新浪/腾讯，自动选数据源）
  let quotes = await ds.getQuickStockList(allCodes);
  // 统一code为纯6位（去掉sh/sz前缀）
  quotes = quotes.map(q => ({ ...q, code: String(q.code).replace(/^(sh|sz|bj)/, '') }));
  console.log(`[pool] 成功获取行情: ${quotes.length} 只`);

  // 3. 拉取K线计算动量（近20日涨幅）
  const momentumMap = {};
  const klineCodes = quotes.slice(0, Math.min(quotes.length, 300)); // 动量计算只处理前300只高流动性
  for (let i = 0; i < klineCodes.length; i++) {
    const q = klineCodes[i];
    try {
      const kl = await ds.getDailyKline(q.code, dayjs().subtract(30, 'day').format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD'));
      if (kl && kl.length >= 15) {
        const closes = kl.map(k => k.close).filter(c => c > 0);
        if (closes.length >= 10) {
          const ret = (closes[closes.length - 1] - closes[0]) / closes[0];
          momentumMap[q.code] = ret;
        }
      }
    } catch(e) {}
    if (i % 50 === 0) await ds.sleep(80);
  }

  // 4. 打分与筛选
  const today = dayjs().format('YYYYMMDD');
  const scored = quotes.map(q => {
    // 过滤：非ST，价格>=2元，成交额>=5000万（50M）
    if (q.is_st) return null;
    if (!q.close || q.close < 2) return null;
    const amountYi = (q.amount || 0) / 10000; // 万→亿
    if (amountYi < 0.5) return null; // 成交额小于5000万的冷门股不关注

    // 流动性分（按成交额对数归一）
    const volScore = Math.min(100, Math.max(0, Math.log10(Math.max(1, amountYi)) * 25 + 10));
    // 动量分（-20%~+50% 映射到0-100，过热和暴跌都扣分）
    const ret = momentumMap[q.code];
    let momScore = 50;
    if (ret !== undefined) {
      if (ret > 0.5) momScore = 40;        // 短期暴涨50%以上，过热
      else if (ret > 0.2) momScore = 75;    // 温和上涨
      else if (ret > -0.05) momScore = 60;  // 横盘
      else if (ret > -0.2) momScore = 45;   // 小跌
      else momScore = 25;                    // 大跌
    }
    // 市值分（大中盘优先，过小盘筛掉；字段缺失时给中性分）
    let mvScore = 50;
    const mv = q.total_mv || 0;
    if (mv > 0) {
      if (mv > 5000) mvScore = 90;
      else if (mv > 1000) mvScore = 80;
      else if (mv > 300) mvScore = 70;
      else if (mv > 100) mvScore = 55;
      else if (mv > 50) mvScore = 40;
      else mvScore = 20;
    }

    const total = +(volScore * 0.45 + momScore * 0.25 + mvScore * 0.3).toFixed(1);

    return {
      code: q.code, name: q.name,
      amount_yi: +amountYi.toFixed(2),
      pct_chg: q.pct_chg, close: q.close, total_mv: q.total_mv,
      ret_20d: ret !== undefined ? +(ret * 100).toFixed(1) : null,
      vol_score: +volScore.toFixed(0),
      mom_score: momScore,
      mv_score: mvScore,
      score: total,
      is_manual: manualCodes.includes(q.code) || portfolioCodes.includes(q.code) ? 1 : 0,
    };
  }).filter(Boolean);

  // 手动添加/持仓的股票强制入池，其他按总分排序取前targetSize
  const manualStocks = scored.filter(s => s.is_manual);
  const autoPool = scored.filter(s => !s.is_manual).sort((a, b) => b.score - a.score)
                         .slice(0, Math.max(0, targetSize - manualStocks.length));
  const finalPool = [...manualStocks, ...autoPool];

  // 5. 写入数据库（先标记不在池的为0，再插入/更新池内的）
  const poolCodes = new Set(finalPool.map(s => s.code));
  const existingAll = await dbAll(`SELECT code FROM stock_pool`);
  const existSet = new Set(existingAll.map(r => r.code));

  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const todayShort = dayjs().format('YYYY-MM-DD');

  // 标记不在池的股票
  if (finalPool.length > 0) {
    const placeholders = finalPool.map(() => '?').join(',');
    await dbRun(`UPDATE stock_pool SET in_pool = 0, updated_at = ? WHERE code NOT IN (${placeholders})`, [now, ...finalPool.map(s => s.code)]);
  }

  // 批量插入/更新池内股票
  const batchStmts = finalPool.map(s => {
    const reason = s.is_manual ? '手动/持仓' :
      `流动性${s.vol_score} 动量${s.mom_score} 市值${s.mv_score}`;
    return {
      sql: `INSERT OR REPLACE INTO stock_pool
        (code, name, in_pool, is_manual, pool_score, pool_reason, score_volume, score_momentum,
         last_trade_date, updated_at, in_pool_date)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT in_pool_date FROM stock_pool WHERE code = ?), ?))`,
      args: [s.code, s.name, s.is_manual, s.score, reason, s.vol_score, s.mom_score,
                today, now, s.code, todayShort]
    };
  });

  // 分批处理
  for (let i = 0; i < batchStmts.length; i += 200) {
    await dbBatch(batchStmts.slice(i, i + 200));
  }

  console.log(`[pool] 股票池更新完成，共 ${finalPool.length} 只（手动${manualStocks.length}只 + 自动${autoPool.length}只），耗时 ${((Date.now()-t0)/1000).toFixed(1)}s`);
  return { total: finalPool.length, manual: manualStocks.length, auto: autoPool.length, elapsed: Date.now()-t0 };
}

/**
 * 获取当前股票池代码列表（返回纯6位码，不带sh/sz前缀，API调用时再转）
 */
async function getPoolCodes() {
  const rows = await dbAll(`SELECT code, name FROM stock_pool WHERE in_pool = 1 ORDER BY pool_score DESC`);
  return rows.map(r => r.code);
}

/**
 * 添加股票到股票池（用户手动/搜索添加）
 */
async function addToPool(code, name, isManual = true) {
  const sixCode = toSixCode(code);
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  await dbRun(`INSERT OR REPLACE INTO stock_pool
    (code, name, in_pool, is_manual, pool_score, pool_reason, updated_at, in_pool_date)
    VALUES (?, ?, 1, ?, 99, '手动添加', ?, COALESCE((SELECT in_pool_date FROM stock_pool WHERE code=?), ?))`,
    [sixCode, name || code, isManual ? 1 : 0, now, sixCode, dayjs().format('YYYY-MM-DD')]);
  return sixCode;
}

// 代码格式规范化 — 对外返回sh/sz前缀格式（给API用），内部db存纯6位
function toSixCode(code) {
  if (!code) return code;
  return String(code).toLowerCase().replace(/^(sh|sz|bj)/, '').replace(/\.(ss|sz)$/i, '');
}
function toTencentCode(code) {
  if (!code) return code;
  code = String(code).toLowerCase();
  if (code.startsWith('sh') || code.startsWith('sz') || code.startsWith('bj')) return code;
  // 处理 yahoo 格式 600519.SS → sh600519
  if (code.endsWith('.ss')) return 'sh' + code.replace('.ss','');
  if (code.endsWith('.sz')) return 'sz' + code.replace('.sz','');
  if (/^(6|5|9)/.test(code)) return 'sh' + code;
  if (/^(0|2|3)/.test(code)) return 'sz' + code;
  return 'sz' + code;
}

/**
 * 分批更新股票池（避免Render suspend）
 * 每次调用处理一批，可多次调用直到done
 * @param {number} targetSize 目标股票池大小
 * @param {number} startTime 开始时间戳，用于超时控制
 */
async function updateStockPoolBatch(targetSize = 200, startTime = 0) {
  const TIMEOUT = 45000; // 45秒超时
  const BATCH_QUOTE_SIZE = 50; // 每批拉50只行情

  // 第一次调用时初始化（用内存静态变量维护状态）
  if (!updateStockPoolBatch._state || updateStockPoolBatch._state.done) {
    const universeCodes = await getUniverseCodes();
    const manualRows = await dbAll(`SELECT code, name FROM stock_pool WHERE is_manual = 1`);
    const manualCodes = manualRows.map(r => r.code);
    const portfolioRows = await dbAll(`SELECT DISTINCT code FROM portfolio WHERE status='holding'`);
    const portfolioCodes = portfolioRows.map(r => r.code);
    const universeSet = new Set([...universeCodes, ...manualCodes, ...portfolioCodes]);
    const allCodes = [...universeSet].map(toTencentCode);

    updateStockPoolBatch._state = {
      allCodes,
      allCodesRaw: [...universeSet],
      manualCodes,
      portfolioCodes,
      targetSize,
      offset: 0,
      quotes: [],
      done: false,
    };
    console.log(`[pool-batch] 初始化，待扫描 ${allCodes.length} 只`);
  }

  const state = updateStockPoolBatch._state;
  let processed = 0;

  // 分批拉取行情
  while (state.offset < state.allCodes.length && processed < BATCH_QUOTE_SIZE) {
    const batch = state.allCodes.slice(state.offset, state.offset + BATCH_QUOTE_SIZE);
    try {
      const batchQuotes = await ds.getQuickStockList(batch);
      const cleaned = batchQuotes.map(q => ({ ...q, code: String(q.code).replace(/^(sh|sz|bj)/, '') }));
      state.quotes.push(...cleaned);
      processed += batch.length;
    } catch(e) {
      console.log(`[pool-batch] 行情拉取失败(offset=${state.offset}):`, e.message);
      // 即使失败也推进offset
      processed += batch.length;
    }
    state.offset += batch.length;

    // 超时检查
    if (startTime > 0 && Date.now() - startTime > TIMEOUT) break;
    await ds.sleep(50);
  }

  console.log(`[pool-batch] 进度: ${state.offset}/${state.allCodes.length}，已获取行情 ${state.quotes.length} 只`);

  // 如果还没拉完，返回未完成
  if (state.offset < state.allCodes.length) {
    return {
      done: false,
      progress: `${state.offset}/${state.allCodes.length}`,
      progressPct: Math.round(state.offset / state.allCodes.length * 100),
      quotesSoFar: state.quotes.length,
    };
  }

  // 全部行情拉完，开始打分筛选
  console.log(`[pool-batch] 行情拉取完成(${state.quotes.length}只)，开始打分筛选...`);

  // 拉取K线计算动量（只处理前300只高流动性）
  const momentumMap = {};
  const klineCodes = state.quotes.slice(0, Math.min(state.quotes.length, 300));
  for (let i = 0; i < klineCodes.length; i++) {
    const q = klineCodes[i];
    try {
      const kl = await ds.getDailyKline(q.code, dayjs().subtract(30, 'day').format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD'));
      if (kl && kl.length >= 15) {
        const closes = kl.map(k => k.close).filter(c => c > 0);
        if (closes.length >= 10) {
          const ret = (closes[closes.length - 1] - closes[0]) / closes[0];
          momentumMap[q.code] = ret;
        }
      }
    } catch(e) {}
    if (i % 50 === 0) await ds.sleep(80);
    // 超时检查
    if (startTime > 0 && Date.now() - startTime > TIMEOUT * 1.5) {
      console.log(`[pool-batch] 动量计算超时，已处理 ${i}/${klineCodes.length}`);
      break;
    }
  }

  // 打分与筛选
  const scored = state.quotes.map(q => {
    if (q.is_st) return null;
    if (!q.close || q.close < 2) return null;
    const amountYi = (q.amount || 0) / 10000;
    if (amountYi < 0.5) return null;

    const volScore = Math.min(100, Math.max(0, Math.log10(Math.max(1, amountYi)) * 25 + 10));
    const ret = momentumMap[q.code];
    let momScore = 50;
    if (ret !== undefined) {
      if (ret > 0.5) momScore = 40;
      else if (ret > 0.2) momScore = 75;
      else if (ret > -0.05) momScore = 60;
      else if (ret > -0.2) momScore = 45;
      else momScore = 25;
    }
    let mvScore = 50;
    const mv = q.total_mv || 0;
    if (mv > 0) {
      if (mv > 5000) mvScore = 90;
      else if (mv > 1000) mvScore = 80;
      else if (mv > 300) mvScore = 70;
      else if (mv > 100) mvScore = 55;
      else if (mv > 50) mvScore = 40;
      else mvScore = 20;
    }

    const total = +(volScore * 0.45 + momScore * 0.25 + mvScore * 0.3).toFixed(1);

    return {
      code: q.code, name: q.name,
      amount_yi: +amountYi.toFixed(2),
      pct_chg: q.pct_chg, close: q.close, total_mv: q.total_mv,
      ret_20d: ret !== undefined ? +(ret * 100).toFixed(1) : null,
      vol_score: +volScore.toFixed(0),
      mom_score: momScore,
      mv_score: mvScore,
      score: total,
      is_manual: state.manualCodes.includes(q.code) || state.portfolioCodes.includes(q.code) ? 1 : 0,
    };
  }).filter(Boolean);

  // 如果打分结果太少（行情数据不完整），用Universe直接入池
  let finalPool;
  if (scored.length < 50) {
    console.log(`[pool-batch] 打分结果仅${scored.length}只，用Universe直接入池`);
    finalPool = state.allCodesRaw.slice(0, state.targetSize).map((code, idx) => ({
      code, name: '', score: 50 - idx * 0.01,
      is_manual: state.manualCodes.includes(code) || state.portfolioCodes.includes(code) ? 1 : 0,
      vol_score: 50, mom_score: 50, mv_score: 50,
    }));
  } else {
    const manualStocks = scored.filter(s => s.is_manual);
    const autoPool = scored.filter(s => !s.is_manual).sort((a, b) => b.score - a.score)
                           .slice(0, Math.max(0, state.targetSize - manualStocks.length));
    finalPool = [...manualStocks, ...autoPool];
  }

  // 写入数据库
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const todayShort = dayjs().format('YYYY-MM-DD');

  if (finalPool.length > 0) {
    const placeholders = finalPool.map(() => '?').join(',');
    await dbRun(`UPDATE stock_pool SET in_pool = 0, updated_at = ? WHERE code NOT IN (${placeholders})`, [now, ...finalPool.map(s => s.code)]);
  }

  const batchStmts = finalPool.map(s => {
    const reason = s.is_manual ? '手动/持仓' :
      `流动性${s.vol_score} 动量${s.mom_score} 市值${s.mv_score}`;
    return {
      sql: `INSERT OR REPLACE INTO stock_pool
        (code, name, in_pool, is_manual, pool_score, pool_reason, score_volume, score_momentum,
         last_trade_date, updated_at, in_pool_date)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT in_pool_date FROM stock_pool WHERE code = ?), ?))`,
      args: [s.code, s.name || s.code, s.is_manual, s.score, reason, s.vol_score, s.mom_score,
                todayShort, now, s.code, todayShort]
    };
  });

  for (let i = 0; i < batchStmts.length; i += 200) {
    await dbBatch(batchStmts.slice(i, i + 200));
  }

  state.done = true;
  console.log(`[pool-batch] ✅ 股票池更新完成，共 ${finalPool.length} 只`);

  return {
    done: true,
    total: finalPool.length,
    scored: scored.length,
    progress: '100%',
    progressPct: 100,
  };
}

module.exports = { updateUniverse, getUniverseCodes, updateStockPool, updateStockPoolBatch, getPoolCodes, addToPool, toTencentCode, BUILTIN_UNIVERSE };
