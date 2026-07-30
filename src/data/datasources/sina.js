/**
 * 新浪财经数据源
 * 特点：CDN全球加速，国内/海外节点均可访问，GBK编码，无需API Key
 * 覆盖：实时行情、日K线、指数行情、板块行情
 */
const axios = require('axios');
const iconv = require('iconv-lite');
const dayjs = require('dayjs');

const SINA_HQ = axios.create({
  baseURL: 'https://hq.sinajs.cn',
  timeout: 5000,
  responseType: 'arraybuffer',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://finance.sina.com.cn/',
  },
});

const SINA_KLINE = axios.create({
  baseURL: 'https://money.finance.sina.com.cn',
  timeout: 5000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://finance.sina.com.cn/',
  },
});

const SINA_SECTOR = axios.create({
  baseURL: 'https://vip.stock.finance.sina.com.cn',
  timeout: 5000,
  responseType: 'arraybuffer',
  headers: {
    'User-Agent': 'Mozilla/5.0',
    'Referer': 'https://finance.sina.com.cn/',
  },
});

// 代码格式转换（内部统一 sh600519/sz000858）
function toSinaCode(code) {
  if (!code) return code;
  code = String(code).toLowerCase();
  if (code.startsWith('sh') || code.startsWith('sz') || code.startsWith('bj')) return code;
  if (code.startsWith('6') || code.startsWith('5') || code.startsWith('9')) return `sh${code}`;
  if (code.startsWith('0') || code.startsWith('3') || code.startsWith('2')) return `sz${code}`;
  if (code.startsWith('8') || code.startsWith('4')) return `bj${code}`;
  return `sz${code}`;
}

function decodeGBK(buf) {
  return iconv.decode(Buffer.from(buf), 'gbk');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 解析新浪实时行情（hq.sinajs.cn/list=xxx）
 * 返回与腾讯parseFullQuote兼容的字段结构
 */
function parseSinaQuotes(text) {
  const results = [];
  const lines = text.trim().split('\n').filter(l => l.includes('="'));
  for (const line of lines) {
    const m = line.match(/hq_str_([a-z]{2}\d+)="([^"]*)"/);
    if (!m) continue;
    const [, fullCode, data] = m;
    const parts = data.split(',');
    if (parts.length < 30) continue;
    const market = fullCode.substring(0, 2);
    const isIndex = fullCode.startsWith('sh000') || fullCode.startsWith('sz399');

    // 新浪字段顺序：0=name 1=open 2=pre_close 3=price 4=high 5=low ...
    // 30=date 31=time
    const name = parts[0];
    const open = parseFloat(parts[1]);
    const pre_close = parseFloat(parts[2]);
    const close = parseFloat(parts[3]);
    const high = parseFloat(parts[4]);
    const low = parseFloat(parts[5]);
    const volume = parseFloat(parts[8]); // 股
    const amount = parseFloat(parts[9]); // 元
    const date = parts[30];
    const timeStr = parts[31];

    if (!name || close <= 0) continue;

    const chg = +(close - pre_close).toFixed(2);
    const pct_chg = pre_close > 0 ? +((close - pre_close) / pre_close * 100).toFixed(2) : 0;
    const volumeHand = volume ? Math.round(volume / 100) : 0; // 股→手
    const amountWan = amount ? Math.round(amount / 10000) : 0; // 元→万
    const code = fullCode.substring(2);

    results.push({
      code,
      name: name.trim(),
      market: market === 'sh' ? 'SH' : market === 'sz' ? 'SZ' : 'BJ',
      close,
      pre_close,
      open,
      high,
      low,
      volume: volumeHand,
      amount: amountWan,
      pct_chg,
      chg,
      amplitude: pre_close > 0 ? +((high - low) / pre_close * 100).toFixed(2) : 0,
      turnover: null, // 新浪行情接口不直接给换手率
      pe: parseFloat(parts[39]) > 0 && parseFloat(parts[39]) < 10000 ? parseFloat(parts[39]) : null,
      pb: null,
      total_mv: parseFloat(parts[45]) > 0 ? Math.round(parseFloat(parts[45]) / 100000000) : null, // 元→亿
      circ_mv: parseFloat(parts[44]) > 0 ? Math.round(parseFloat(parts[44]) / 100000000) : null,
      is_st: name.includes('ST') || name.includes('*ST') ? 1 : 0,
      updated_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      trade_date: (date || dayjs().format('YYYY-MM-DD')).replace(/-/g, ''),
      _source: 'sina',
    });
  }
  return results;
}

/**
 * 批量获取实时行情
 */
async function getQuickStockList(stockCodes) {
  const results = [];
  const codes = stockCodes.map(toSinaCode);
  const batchSize = 80;

  for (let i = 0; i < codes.length; i += batchSize) {
    const batch = codes.slice(i, i + batchSize).join(',');
    try {
      const res = await SINA_HQ.get(`/list=${batch}`);
      const text = decodeGBK(res.data);
      const quotes = parseSinaQuotes(text);
      results.push(...quotes);
      await sleep(80);
    } catch (e) {
      console.error('[sina] 行情批次失败:', e.message);
    }
  }
  return results;
}

/**
 * 获取日K线
 * 新浪K线接口：CN_MarketData.getKLineData?symbol=sh600519&scale=240(日)&ma=no&datalen=N
 * 返回：[{"day":"2026-07-01","open":"...","high":"...","low":"...","close":"...","volume":"..."}]
 */
async function getDailyKline(code, startDate, endDate) {
  const scode = toSinaCode(code);
  try {
    // 新浪K线通过datalen控制数量，没有日期区间；我们取足够长的(250条=1年)，然后本地过滤
    const datalen = 300;
    const res = await SINA_KLINE.get('/quotes_service/api/json_v2.php/CN_MarketData.getKLineData', {
      params: {
        symbol: scode,
        scale: 240, // 日线
        ma: 'no',
        datalen,
      }
    });

    let klines = [];
    if (typeof res.data === 'string') {
      // 有时返回JSON字符串
      try { klines = JSON.parse(res.data); } catch(e) { klines = []; }
    } else if (Array.isArray(res.data)) {
      klines = res.data;
    }

    if (!klines || klines.length === 0) return [];

    const start = (startDate || '').replace(/-/g, '');
    const end = (endDate || dayjs().format('YYYY-MM-DD')).replace(/-/g, '');

    // 过滤日期区间
    const filtered = klines
      .filter(k => {
        const d = (k.day || '').replace(/-/g, '');
        return d >= start && d <= end;
      })
      .map(k => ({
        code: toSinaCode(code).replace(/^(sh|sz|bj)/, ''), // 返回纯6位码，与现有db兼容
        trade_date: (k.day || '').replace(/-/g, ''),
        open: parseFloat(k.open),
        close: parseFloat(k.close),
        high: parseFloat(k.high),
        low: parseFloat(k.low),
        volume: parseFloat(k.volume) ? Math.round(parseFloat(k.volume) / 100) : 0, // 股→手
        amount: null,
        amplitude: null,
        pct_chg: null,
        chg: null,
        turnover: null,
      }))
      .filter(k => k.trade_date && k.close > 0)
      .sort((a, b) => a.trade_date.localeCompare(b.trade_date));

    // 重新计算chg/pct_chg/amplitude
    for (let i = 0; i < filtered.length; i++) {
      if (i === 0) {
        filtered[i].chg = 0;
        filtered[i].pct_chg = 0;
        filtered[i].amplitude = 0;
      } else {
        const prev = filtered[i - 1];
        const cur = filtered[i];
        cur.chg = +(cur.close - prev.close).toFixed(2);
        cur.pct_chg = prev.close > 0 ? +((cur.close - prev.close) / prev.close * 100).toFixed(2) : 0;
        cur.amplitude = prev.close > 0 ? +((cur.high - cur.low) / prev.close * 100).toFixed(2) : 0;
      }
    }

    // code格式统一返回sh600519/sz000858（与腾讯一致）
    filtered.forEach(k => { k.code = toSinaCode(code); });

    return filtered;
  } catch (e) {
    console.error(`[sina] K线获取失败 ${code}:`, e.message);
    return [];
  }
}

/**
 * 获取指数行情
 */
async function getIndexQuotes() {
  const indices = ['sh000001', 'sz399001', 'sz399006', 'sh000300', 'sh000016', 'sh000905', 'sh000688'];
  const codes = indices.join(',');
  try {
    const res = await SINA_HQ.get(`/list=${codes}`);
    const text = decodeGBK(res.data);
    return parseSinaQuotes(text);
  } catch (e) {
    return [];
  }
}

/**
 * 获取行业板块列表
 */
async function getSectorList() {
  try {
    const res = await SINA_SECTOR.get('/q/view/newSinaHy.php');
    const text = decodeGBK(res.data);
    const sectors = [];
    const regex = /"new_([a-z]+)":"new_[a-z]+,([^,]+),(\d+),([\d.\-]+),([\d.\-]+),([\d.\-]+),([\d.]+),([\d.]+),([sz\d]+),([\d.\-]+),([\d.]+),([\d.\-]+),([^"]+)"/g;
    let m;
    while ((m = regex.exec(text)) !== null) {
      sectors.push({
        sector_code: m[1],
        sector_name: m[2],
        stock_count: parseInt(m[3]),
        avg_price: parseFloat(m[4]),
        change_pct: parseFloat(m[6]),
        volume: parseInt(m[7]),
        amount: parseFloat(m[8]),
        leader_code: m[9].replace(/^(sh|sz)/, ''),
        leader_pct: parseFloat(m[10]),
        leader_price: parseFloat(m[11]),
        leader_name: m[13],
        trade_date: dayjs().format('YYYYMMDD'),
      });
    }
    return sectors.sort((a, b) => b.change_pct - a.change_pct);
  } catch (e) {
    console.error('[sina] 获取板块失败:', e.message);
    return [];
  }
}

/**
 * 连通性测试：快速打一行情接口判断是否可用
 */
async function probe() {
  try {
    const start = Date.now();
    const res = await SINA_HQ.get('/list=sh600519');
    const text = decodeGBK(res.data);
    const ok = text.includes('贵州茅台');
    return { ok, latency: Date.now() - start };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  name: 'sina',
  label: '新浪财经',
  regions: ['domestic', 'overseas'], // 国内外均可用
  getQuickStockList,
  getDailyKline,
  getIndexQuotes,
  getSectorList,
  toSinaCode,
  sleep,
  probe,
};
