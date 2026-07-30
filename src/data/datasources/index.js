/**
 * 数据源统一路由层
 * 支持多数据源自动切换 + 手动配置 + fallback
 *
 * 数据源：
 *   - tencent  腾讯财经（国内推荐，GBK编码，字段最全）
 *   - sina     新浪财经（国内外CDN，GBK编码，稳定备用）
 *   - yahoo    Yahoo Finance（海外推荐，JSON，高质量）
 *   - auto     自动探测：优先国内用tencent，海外用yahoo，sina兜底
 *
 * 使用方法：
 *   const ds = require('./datasources');
 *   await ds.setSource('yahoo');    // 手动切换
 *   await ds.getQuickStockList([...]) // 自动使用当前数据源
 *   await ds.probeAll();            // 探测所有数据源可用性
 */
const tencent = require('./tencent');
const sina = require('./sina');
const yahoo = require('./yahoo');
const fs = require('fs');
const path = require('path');

const SOURCES = { tencent, sina, yahoo };
const CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'data', 'ds_config.json');

// 当前活跃数据源
let currentSource = null;
let currentName = 'auto';
let probeCache = null;
let probeCacheTime = 0;
const PROBE_TTL = 5 * 60 * 1000; // 探测结果5分钟有效

/**
 * 读取数据源配置
 */
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch(e) {}
  return { source: 'auto' };
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch(e) {
    console.error('[ds] 保存配置失败:', e.message);
  }
}

/**
 * 带超时的Promise
 */
function withTimeout(p, ms, fallback) {
  return Promise.race([
    p,
    new Promise(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * 探测所有数据源连通性（并行，总超时8秒）
 */
async function probeAll() {
  const entries = Object.entries(SOURCES);
  const resultsArr = await Promise.all(
    entries.map(async ([name, ds]) => {
      const r = await withTimeout(
        ds.probe().catch(e => ({ ok: false, error: e.message })),
        6000,
        { ok: false, error: 'probe timeout' }
      );
      return [name, { ...r, label: ds.label, regions: ds.regions }];
    })
  );
  const results = Object.fromEntries(resultsArr);
  probeCache = results;
  probeCacheTime = Date.now();
  return results;
}

/**
 * 根据auto策略选择最佳数据源
 * 策略：优先选择国内(tencent)→sina兜底；如果tencent/yahoo都通但yahoo延迟低用yahoo
 */
async function autoSelect() {
  const results = await probeAll();
  // 优先排序：tencent(国内) → sina(兜底) → yahoo(海外)
  const preference = ['tencent', 'sina', 'yahoo'];
  for (const name of preference) {
    if (results[name]?.ok) {
      return SOURCES[name];
    }
  }
  // 全挂了默认返回sina
  console.warn('[ds] 所有数据源探测失败，默认使用sina');
  return sina;
}

/**
 * 设置数据源
 * @param {string} name tencent|sina|yahoo|auto
 */
async function setSource(name) {
  if (name === 'auto' || !name) {
    currentSource = await autoSelect();
    currentName = 'auto';
  } else if (SOURCES[name]) {
    currentSource = SOURCES[name];
    currentName = name;
  } else {
    throw new Error(`未知数据源: ${name}，可选: tencent/sina/yahoo/auto`);
  }
  saveConfig({ source: currentName === 'auto' ? 'auto' : currentName });
  console.log(`[ds] 数据源切换为: ${currentName} (${currentSource.label})`);
  return { source: currentName, label: currentSource.label };
}

/**
 * 获取当前数据源
 */
function getSource() {
  return { name: currentName, label: currentSource.label, impl: currentSource };
}

/**
 * 返回所有数据源状态（用于前端设置页）
 * force=true强制重新探测，否则优先用5分钟内缓存
 */
async function getStatus(force = false) {
  const cfg = loadConfig();
  let results;
  if (force || !probeCache || Date.now() - probeCacheTime > PROBE_TTL) {
    results = await probeAll();
  } else {
    results = probeCache;
  }
  return {
    current: currentName,
    configured: cfg.source,
    sources: Object.fromEntries(
      Object.entries(results).map(([name, r]) => [name, {
        label: SOURCES[name].label,
        regions: SOURCES[name].regions,
        ...r,
      }])
    ),
  };
}

/**
 * 包装数据源方法：调用失败自动fallback到sina
 */
function withFallback(fnName, ...args) {
  return (async () => {
    try {
      return await currentSource[fnName](...args);
    } catch(e) {
      console.warn(`[ds] ${currentName}.${fnName} 失败:`, e.message, '→ fallback sina');
      if (currentName !== 'sina') {
        try { return await sina[fnName](...args); } catch(e2) {
          console.error(`[ds] sina fallback 也失败:`, e2.message);
          throw e;
        }
      }
      throw e;
    }
  })();
}

// ========== 统一API（对外）==========

async function getQuickStockList(codes) { return withFallback('getQuickStockList', codes); }
async function getDailyKline(code, start, end) { return withFallback('getDailyKline', code, start, end); }
async function getIndexQuotes() { return withFallback('getIndexQuotes'); }
async function getSectorList() {
  // yahoo没有板块接口，直接用sina（sina板块全球CDN）
  if (currentName === 'yahoo') {
    return sina.getSectorList();
  }
  return withFallback('getSectorList');
}

// ========== 初始化 ==========
let initPromise = (async function init() {
  const cfg = loadConfig();
  try {
    await setSource(cfg.source || 'auto');
  } catch(e) {
    console.error('[ds] 初始化失败，使用sina:', e.message);
    currentSource = sina;
    currentName = 'sina';
  }
})();

async function waitReady() {
  await initPromise;
}

module.exports = {
  setSource,
  getSource,
  getStatus,
  probeAll,
  getQuickStockList,
  getDailyKline,
  getIndexQuotes,
  getSectorList,
  waitReady,
  sleep: (ms) => new Promise(r => setTimeout(r, ms)),
  SOURCES,
};
