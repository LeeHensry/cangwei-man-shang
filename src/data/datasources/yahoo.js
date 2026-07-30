/**
 * Yahoo Finance 数据源（海外节点推荐）
 * 特点：
 * - 海外节点（Render/AWS）访问稳定快速，国内被墙
 * - 数据质量高：全球股票/A股(带.SS/.SZ后缀)/ETF/加密货币全覆盖
 * - 无需 API Key，公开接口
 * - 响应为 JSON，无需编码转换
 *
 * A股代码转换规则：
 *   sh600519 → 600519.SS  (上交所 .SS = Shanghai Stock Exchange)
 *   sz000858 → 000858.SZ  (深交所 .SZ = Shenzhen Stock Exchange)
 *   sh000001 → 000001.SS  (上证指数)
 */
const axios = require('axios');
const dayjs = require('dayjs');

const YAHOO = axios.create({
  baseURL: 'https://query1.finance.yahoo.com',
  timeout: 6000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
  },
});

// 代码转换 sh600519 → 600519.SS
function toYahooCode(code) {
  if (!code) return code;
  code = String(code).toLowerCase();
  let num;
  if (code.startsWith('sh') || code.startsWith('sz') || code.startsWith('bj')) {
    num = code.substring(2);
  } else {
    num = code;
  }
  // 判断交易所
  if (/^(6|5|9)/.test(num)) return `${num}.SS`;
  if (/^(0|2|3)/.test(num)) return `${num}.SZ`;
  if (/^(8|4)/.test(num)) return `${num}.BJ`;
  // 指数
  if (num === '000001') return '000001.SS';   // 上证指数
  if (num === '399001') return '399001.SZ';   // 深证成指
  if (num === '399006') return '399006.SZ';   // 创业板指
  if (num === '000300') return '000300.SS';   // 沪深300
  if (num === '000016') return '000016.SS';   // 上证50
  if (num === '000905') return '000905.SS';   // 中证500
  if (num === '000688') return '000688.SS';   // 科创50
  return `${num}.SZ`;
}

// yahooCode → 内部代码 600519.SS → sh600519
function fromYahooCode(ycode) {
  if (!ycode) return ycode;
  const [num, suffix] = ycode.toUpperCase().split('.');
  if (suffix === 'SS') return `sh${num}`;
  if (suffix === 'SZ') return `sz${num}`;
  if (suffix === 'BJ') return `bj${num}`;
  return num;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 批量获取实时/最新行情
 * Yahoo chart 接口包含最新价格、前收、成交量、市值、PE 等
 */
async function getQuickStockList(stockCodes) {
  const results = [];
  // Yahoo没有批量接口（除v7/quote但需要cookie），逐个获取chart做行情
  // 优化：只取最新2天，并发5个
  const concurrency = 5;
  const queue = [...stockCodes];

  async function fetchOne(code) {
    const ycode = toYahooCode(code);
    try {
      const res = await YAHOO.get('/v8/finance/chart/' + ycode, {
        params: { range: '5d', interval: '1d', includePrePost: 'false' },
      });
      const chart = res.data?.chart?.result?.[0];
      if (!chart || !chart.indicators?.quote?.[0]) return null;
      const meta = chart.meta || {};
      const q = chart.indicators.quote[0];
      const ts = chart.timestamp || [];
      if (ts.length === 0) return null;

      const lastIdx = ts.length - 1;
      const close = q.close?.[lastIdx] ?? meta.regularMarketPrice;
      const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? q.close?.[lastIdx - 1];
      const open = q.open?.[lastIdx];
      const high = q.high?.[lastIdx];
      const low = q.low?.[lastIdx];
      const volume = q.volume?.[lastIdx];
      if (!close || close <= 0) return null;

      const pct_chg = prevClose ? +((close - prevClose) / prevClose * 100).toFixed(2) : 0;
      const chg = prevClose ? +(close - prevClose).toFixed(2) : 0;
      const intCode = fromYahooCode(ycode);
      const market = intCode.startsWith('sh') ? 'SH' : intCode.startsWith('sz') ? 'SZ' : 'BJ';
      const codeNum = intCode.substring(2);

      // 尝试从meta拿PE
      const pe = meta.trailingPE || null;
      const total_mv = meta.marketCap ? Math.round(meta.marketCap / 100000000) : null; // 元→亿
      const name = meta.shortName || meta.longName || intCode;

      return {
        code: codeNum,
        name: name.replace(/\s*\(.*\)\s*$/, ''), // 去掉 (SS) 后缀
        market,
        close: +close.toFixed(2),
        pre_close: prevClose ? +prevClose.toFixed(2) : null,
        open: open ? +open.toFixed(2) : null,
        high: high ? +high.toFixed(2) : null,
        low: low ? +low.toFixed(2) : null,
        volume: volume ? Math.round(volume / 100) : 0, // 股→手
        amount: null,
        pct_chg,
        chg,
        amplitude: prevClose && high && low ? +((high - low) / prevClose * 100).toFixed(2) : 0,
        turnover: null,
        pe: pe && pe > 0 && pe < 10000 ? +pe.toFixed(1) : null,
        pb: null,
        total_mv,
        circ_mv: null,
        is_st: name.includes('ST') ? 1 : 0,
        updated_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        trade_date: dayjs().format('YYYYMMDD'),
        _source: 'yahoo',
      };
    } catch(e) {
      return null;
    }
  }

  // 并发控制
  const workers = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const code = queue.shift();
        const r = await fetchOne(code);
        if (r) results.push(r);
        await sleep(100);
      }
    })());
  }
  await Promise.all(workers);
  return results;
}

/**
 * 获取日K线
 */
async function getDailyKline(code, startDate, endDate) {
  const ycode = toYahooCode(code);
  const intCode = fromYahooCode(ycode);
  try {
    // 计算range：endDate-startDate的天数
    const start = startDate ? dayjs(startDate) : dayjs().subtract(120, 'day');
    const end = endDate ? dayjs(endDate) : dayjs();
    const days = Math.max(60, end.diff(start, 'day') + 30); // 多取一点防止边界
    let range = '6mo';
    if (days <= 60) range = '3mo';
    else if (days <= 120) range = '6mo';
    else if (days <= 250) range = '1y';
    else range = '2y';

    const res = await YAHOO.get('/v8/finance/chart/' + ycode, {
      params: { range, interval: '1d', includePrePost: 'false' },
    });
    const chart = res.data?.chart?.result?.[0];
    if (!chart || !chart.timestamp) return [];
    const ts = chart.timestamp;
    const q = chart.indicators.quote[0];
    const startYmd = start.format('YYYYMMDD');
    const endYmd = end.format('YYYYMMDD');

    const klines = [];
    let prevClose = null;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i] * 1000;
      const d = dayjs(t).format('YYYYMMDD');
      if (d < startYmd || d > endYmd) continue;
      const open = q.open?.[i];
      const close = q.close?.[i];
      const high = q.high?.[i];
      const low = q.low?.[i];
      const volume = q.volume?.[i];
      if (!close || close <= 0) continue;
      klines.push({
        code: intCode,
        trade_date: d,
        open: +open.toFixed(2),
        close: +close.toFixed(2),
        high: +high.toFixed(2),
        low: +low.toFixed(2),
        volume: volume ? Math.round(volume / 100) : 0,
        amount: null,
        amplitude: prevClose ? +((high - low) / prevClose * 100).toFixed(2) : 0,
        chg: prevClose ? +(close - prevClose).toFixed(2) : 0,
        pct_chg: prevClose ? +((close - prevClose) / prevClose * 100).toFixed(2) : 0,
        turnover: null,
      });
      prevClose = close;
    }
    return klines;
  } catch(e) {
    console.error(`[yahoo] K线失败 ${code}:`, e.message);
    return [];
  }
}

/**
 * 获取指数行情
 */
async function getIndexQuotes() {
  const indices = ['sh000001', 'sz399001', 'sz399006', 'sh000300', 'sh000016', 'sh000905', 'sh000688'];
  const quotes = await getQuickStockList(indices);
  // Yahoo返回的code是6位数字，需替换为 sh000001 形式以兼容
  const codeMap = {};
  indices.forEach(c => { codeMap[c.substring(2)] = c; });
  return quotes.map(q => ({ ...q, code: codeMap[q.code] || q.code }));
}

/**
 * 获取板块列表（Yahoo无板块接口，返回空数组，由上层fallback到其他数据源）
 */
async function getSectorList() {
  // Yahoo没有直接的A股板块接口，后续可考虑用screener接口，先返回空
  return [];
}

/**
 * 连通性探测
 */
async function probe() {
  try {
    const start = Date.now();
    const res = await YAHOO.get('/v8/finance/chart/600519.SS', {
      params: { range: '2d', interval: '1d' },
    });
    const ok = res.data?.chart?.result?.[0]?.meta?.regularMarketPrice > 0;
    return { ok, latency: Date.now() - start };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  name: 'yahoo',
  label: 'Yahoo Finance',
  regions: ['overseas'], // 仅海外可用（国内被墙）
  getQuickStockList,
  getDailyKline,
  getIndexQuotes,
  getSectorList,
  toYahooCode,
  fromYahooCode,
  sleep,
  probe,
};
