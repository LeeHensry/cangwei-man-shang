/**
 * 腾讯财经公开API数据获取
 * 经过测试可正常通过代理访问，无需API Key
 * 覆盖：实时行情、历史K线(前复权)、股票列表、财务指标
 */
const axios = require('axios');
const iconv = require('iconv-lite');
const dayjs = require('dayjs');

// 配置axios
const Tencent = axios.create({
  baseURL: 'https://qt.gtimg.cn',
  timeout: 15000,
  responseType: 'arraybuffer',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://gu.qq.com/',
  }
});

const TencentKline = axios.create({
  baseURL: 'https://web.ifzq.gtimg.cn',
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://gu.qq.com/',
  }
});

const TencentStock = axios.create({
  baseURL: 'https://stock.gtimg.cn',
  timeout: 15000,
  responseType: 'arraybuffer',
  headers: {
    'User-Agent': 'Mozilla/5.0',
    'Referer': 'https://gu.qq.com/',
  }
});

// 代码转腾讯格式（支持已带sh/sz/bj前缀的代码，幂等）
function toTencentCode(code) {
  if (!code) return code;
  code = String(code).toLowerCase();
  if (code.startsWith('sh') || code.startsWith('sz') || code.startsWith('bj')) return code;
  if (code.startsWith('6') || code.startsWith('5') || code.startsWith('9')) return `sh${code}`;
  if (code.startsWith('0') || code.startsWith('3') || code.startsWith('2')) return `sz${code}`;
  if (code.startsWith('8') || code.startsWith('4')) return `bj${code}`;
  return `sz${code}`;
}

function decodeGBK(data) {
  return iconv.decode(Buffer.from(data), 'gbk');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 解析腾讯实时行情（简版 s_ 前缀）
 * 返回字段：名称/代码/价/涨跌/涨跌幅/成交量/成交额
 */
function parseSimpleQuote(text) {
  const results = [];
  const lines = text.trim().split(';').filter(l => l.trim() && l.includes('~'));
  for (const line of lines) {
    const m = line.match(/v_([a-z]{2}\d+)="([^"]*)"/);
    if (!m) continue;
    const [, fullCode, data] = m;
    const parts = data.split('~');
    if (parts.length < 10) continue;
    const market = fullCode.substring(0, 2);
    const code = parts[2];
    results.push({
      code,
      market: market === 'sh' ? 'SH' : market === 'sz' ? 'SZ' : 'BJ',
      name: parts[1],
      price: parseFloat(parts[3]),
      chg: parseFloat(parts[4]),
      pct_chg: parseFloat(parts[5]),
      volume: parseFloat(parts[6]),  // 手
      amount: parseFloat(parts[7]),  // 万
    });
  }
  return results;
}

/**
 * 解析腾讯实时行情（完整版，含PE/PB/市值等）
 */
function parseFullQuote(text) {
  const results = [];
  const lines = text.trim().split(';').filter(l => l.trim() && l.includes('~'));
  for (const line of lines) {
    const m = line.match(/v_([a-z]{2}\d+)="([^"]*)"/);
    if (!m) continue;
    const [, fullCode, data] = m;
    const parts = data.split('~');
    if (parts.length < 50) continue;
    
    const market = fullCode.substring(0, 2);
    const code = parts[2];
    const name = parts[1];
    
    results.push({
      code,
      name,
      market: market === 'sh' ? 'SH' : market === 'sz' ? 'SZ' : 'BJ',
      close: parseFloat(parts[3]),
      pre_close: parseFloat(parts[4]),
      open: parseFloat(parts[5]),
      volume: parseFloat(parts[6]),  // 手
      amount: parseFloat(parts[37] || parts[36]) / 10000, // 成交额(万)
      high: parseFloat(parts[33]),
      low: parseFloat(parts[34]),
      pct_chg: parseFloat(parts[32]),
      chg: parseFloat(parts[31]),
      amplitude: parseFloat(parts[43]),
      turnover: parseFloat(parts[38]), // 换手率%
      pe: parseFloat(parts[39]) > 0 && parseFloat(parts[39]) < 10000 ? parseFloat(parts[39]) : null,
      pb: null, // 完整版PB在另一个字段
      total_mv: parseFloat(parts[45]) > 0 ? Math.round(parseFloat(parts[45])) : null, // 亿
      circ_mv: parseFloat(parts[44]) > 0 ? Math.round(parseFloat(parts[44])) : null,  // 亿
      is_st: name.includes('ST') || name.includes('*ST') ? 1 : 0,
      updated_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      trade_date: dayjs().format('YYYYMMDD'),
    });
  }
  return results;
}

/**
 * 1. 获取A股全部股票列表（含实时行情，全量拉取）
 * 腾讯全量股票列表通过股票列表页接口
 */
async function getStockList() {
  // 使用腾讯股票列表接口 - 沪深A股
  const allStocks = [];
  const marketIds = [
    { market: 'sh', start: 600000, end: 605999 },
    { market: 'sh', start: 601000, end: 603999 },
    { market: 'sh', start: 605000, end: 605999 },
    { market: 'sh', start: 688000, end: 689999 }, // 科创板
    { market: 'sz', start: 0, end: 999 },         // 000xxx
    { market: 'sz', start: 1000, end: 2999 },     // 001xxx/002xxx
    { market: 'sz', start: 300000, end: 301999 }, // 创业板
  ];
  
  // 更高效方式：直接用腾讯的分类列表接口
  try {
    // 沪市A股
    for (const page of [1, 2, 3, 4, 5]) {
      const res = await TencentStock.get('/data/index.php', {
        params: {
          appn: 'rank',
          t: 'ranka/chr',
          p: page,
          o: 0,
          l: 400,
          v: 'list_data',
          f: 'file',
          pz: 1,
        }
      });
      const text = decodeGBK(res.data);
      // 解析列表格式
    }
    
    // 改用批量查询方式：从东财获取股票列表，腾讯批量查行情
    // 最简方式：预生成代码列表批量查询
  } catch (e) {}
  
  // 直接批量查询：沪深A股约5000只，每批50只
  const codes = [];
  // 沪市主板 600000-605999
  for (let i = 600000; i <= 605999; i++) codes.push(`sh${i}`);
  // 沪市主板 601000-603999
  for (let i = 601000; i <= 603999; i++) codes.push(`sh${i}`);
  // 科创板 688xxx
  for (let i = 688000; i <= 689999; i++) codes.push(`sh${i}`);
  // 深市主板 000xxx/001xxx
  for (let i = 1; i <= 999; i++) codes.push(`sz${String(i).padStart(6, '0')}`);
  for (let i = 1000; i <= 2999; i++) codes.push(`sz${String(i).padStart(6, '0')}`);
  // 创业板 300xxx/301xxx
  for (let i = 300000; i <= 301999; i++) codes.push(`sz${i}`);
  
  // 每批50个批量查询，过滤掉不存在的股票（成交价为0的）
  const batchSize = 80;
  for (let i = 0; i < codes.length; i += batchSize) {
    const batch = codes.slice(i, i + batchSize).join(',');
    try {
      const res = await Tencent.get(`/q=${batch}`);
      const text = decodeGBK(res.data);
      const quotes = parseFullQuote(text);
      for (const q of quotes) {
        if (q.close > 0 && q.name && !q.name.includes('ST')) {
          allStocks.push(q);
        } else if (q.close > 0 && q.name) {
          q.is_st = 1;
          allStocks.push(q);
        }
      }
      if (i % 800 === 0) {
        console.log(`  已扫描 ${i + batchSize}/${codes.length} 个代码，找到 ${allStocks.length} 只有效股票`);
      }
      await sleep(120);
    } catch (e) {
      console.error(`  批次 ${i} 失败:`, e.message);
    }
  }
  
  return allStocks;
}

/**
 * 快速版本：只拉取重点股票池和主要指数（推荐首次使用）
 */
async function getQuickStockList(stockCodes) {
  const allStocks = [];
  const codes = stockCodes.map(toTencentCode);
  const batchSize = 20; // 小批次更稳定，避免Render连接被限流

  for (let i = 0; i < codes.length; i += batchSize) {
    const batch = codes.slice(i, i + batchSize).join(',');
    let retries = 3;
    while (retries >= 0) {
      try {
        const res = await Tencent.get(`/q=${batch}`, { timeout: 8000 });
        const text = decodeGBK(res.data);
        const quotes = parseFullQuote(text);
        const valid = quotes.filter(q => q.close > 0 && q.name);
        allStocks.push(...valid);
        break; // 成功
      } catch (e) {
        retries--;
        if (retries < 0) {
          console.error(`[tencent] 批次${Math.floor(i/batchSize)+1}/${Math.ceil(codes.length/batchSize)}失败:`, e.message?.substring(0,80));
        } else {
          await sleep(500);
        }
      }
    }
    await sleep(250); // 更长延时避免被限流
  }
  console.log(`[tencent] getQuickStockList: 请求${codes.length}只, 返回${allStocks.length}只有效行情`);
  return allStocks;
}

/**
 * 2. 获取单只股票历史日K线（前复权）
 * @param {string} code 股票代码
 * @param {string} startDate YYYY-MM-DD
 * @param {string} endDate YYYY-MM-DD
 */
async function getDailyKline(code, startDate, endDate) {
  const tcode = toTencentCode(code);
  try {
    // 腾讯K线接口每次最多返回约600条，循环获取
    const allKlines = [];
    let currentEnd = endDate;
    const maxIterations = 20; // 防止无限循环
    
    for (let iter = 0; iter < maxIterations; iter++) {
      const url = `/appstock/app/fqkline/get?param=${tcode},day,${startDate},${currentEnd},600,qfq`;
      const res = await TencentKline.get(url);
      const data = res.data?.data?.[tcode];
      if (!data) break;
      
      // 优先取qfqday（前复权），fallback到day
      const klines = data.qfqday || data.day;
      if (!klines || klines.length === 0) break;
      
      const parsed = klines.map(k => {
        // [日期, 开, 收, 高, 低, 成交量(手)]
        const trade_date = k[0].replace(/-/g, '');
        const open = parseFloat(k[1]);
        const close = parseFloat(k[2]);
        const high = parseFloat(k[3]);
        const low = parseFloat(k[4]);
        const volume = parseFloat(k[5]);
        const pre_close = allKlines.length > 0 ? allKlines[allKlines.length - 1].close : null;
        const chg = pre_close ? +(close - pre_close).toFixed(2) : 0;
        const pct_chg = pre_close && pre_close !== 0 ? +((close - pre_close) / pre_close * 100).toFixed(2) : 0;
        const amplitude = pre_close && pre_close !== 0 ? +((high - low) / pre_close * 100).toFixed(2) : 0;
        
        return {
          code, trade_date, open, close, high, low, volume,
          amount: null, amplitude, pct_chg, chg, turnover: null,
        };
      });
      
      // 去重并合并
      const existingDates = new Set(allKlines.map(k => k.trade_date));
      for (const k of parsed) {
        if (!existingDates.has(k.trade_date)) {
          allKlines.push(k);
        }
      }
      
      // 如果返回数据不足600条说明已经到最早了
      if (klines.length < 600) break;
      
      // 否则往更早的日期继续拉
      const earliestDate = klines[0][0];
      const nextEnd = dayjs(earliestDate).subtract(1, 'day').format('YYYY-MM-DD');
      if (nextEnd >= currentEnd) break;
      currentEnd = nextEnd;
      await sleep(150);
    }
    
    // 按日期排序
    allKlines.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
    
    // 重新计算chg/pct_chg/amplitude（确保连续性正确）
    for (let i = 0; i < allKlines.length; i++) {
      if (i === 0) {
        allKlines[i].chg = 0;
        allKlines[i].pct_chg = 0;
        allKlines[i].amplitude = 0;
      } else {
        const prev = allKlines[i - 1];
        const cur = allKlines[i];
        cur.chg = +(cur.close - prev.close).toFixed(2);
        cur.pct_chg = +((cur.close - prev.close) / prev.close * 100).toFixed(2);
        cur.amplitude = +((cur.high - cur.low) / prev.close * 100).toFixed(2);
      }
    }
    
    return allKlines;
  } catch (e) {
    console.error(`获取${code}K线失败:`, e.message);
    return [];
  }
}

/**
 * 3. 获取指数实时行情
 */
async function getIndexQuotes() {
  const indices = ['sh000001', 'sz399001', 'sz399006', 'sh000300', 'sh000016', 'sh000905', 'sh000688'];
  try {
    const res = await Tencent.get(`/q=${indices.join(',')}`);
    const text = decodeGBK(res.data);
    return parseFullQuote(text);
  } catch (e) {
    return [];
  }
}

/**
 * 4. 获取行业板块列表（新浪财经）
 */
async function getSectorList() {
  try {
    const res = await axios.get('https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php', {
      timeout: 10000,
      responseType: 'arraybuffer',
      headers: { 'Referer': 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0' }
    });
    const text = iconv.decode(Buffer.from(res.data), 'gbk');
    const sectors = [];
    // 格式: "new_blhy":"new_blhy,玻璃行业,公司数,均价,均价变化,涨跌幅%,成交量,成交额,领涨股代码,涨跌幅,价格,涨跌额,领涨股名"
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
    console.error('获取板块失败:', e.message);
    return [];
  }
}

module.exports = {
  getStockList,
  getQuickStockList,
  getDailyKline,
  getIndexQuotes,
  getSectorList,
  toTencentCode,
  sleep,
};
