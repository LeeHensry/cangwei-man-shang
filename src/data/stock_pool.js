/**
 * 动态股票池管理
 * 设计：
 * - 覆盖大中盘约1000只股票（内置名单+用户自选+热门股）
 * - 每周扫描一次全市场，按流动性（成交额/换手率）+ 动量 + 市值 综合打分
 * - 选出 top 200 只作为重点关注池，后续评分/信号只对这200只做深度分析
 * - 用户自选股票始终入池，不受筛选淘汰
 */
const { dbGet, dbAll, dbRun, dbBatch } = require('./db');
const ds = require('./datasources');
const dayjs = require('dayjs');

// 内置大中盘股票池（约970只，沪市主板/科创板/深市主板/创业板龙头活跃股）
const BUILTIN_UNIVERSE = require('../../data/stock_universe.json');

// 注意：建表已由 db.js 统一处理，此处不再执行 db.exec

/**
 * 执行股票池更新（每周一执行）
 * @param {number} targetSize 目标股票池大小，默认200
 */
async function updateStockPool(targetSize = 200) {
  console.log('[pool] 开始更新股票池，目标数量:', targetSize);
  const t0 = Date.now();

  // 1. 构建待扫描股票名单：内置universe + 已有池内股票（含手动添加）+ portfolio里的股票
  const manualRows = await dbAll(`SELECT code, name FROM stock_pool WHERE is_manual = 1`);
  const manualCodes = manualRows.map(r => r.code);
  const portfolioRows = await dbAll(`SELECT DISTINCT code FROM portfolio WHERE status='holding'`);
  const portfolioCodes = portfolioRows.map(r => r.code);
  const universeSet = new Set([...BUILTIN_UNIVERSE, ...manualCodes, ...portfolioCodes]);
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

module.exports = { updateStockPool, getPoolCodes, addToPool, toTencentCode, BUILTIN_UNIVERSE };
