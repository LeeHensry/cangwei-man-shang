/**
 * 东方财富公开API数据获取
 * 直接调用东财HTTP接口，无需API Key
 * 覆盖：股票列表、实时行情、历史K线、财报、资金流、板块等
 */
const axios = require('axios');
const dayjs = require('dayjs');

// 东财API基础配置
const EastMoney = axios.create({
  baseURL: 'https://push2.eastmoney.com/api/qt',
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://quote.eastmoney.com/',
  }
});

const EastMoneyDatacenter = axios.create({
  baseURL: 'https://datacenter-web.eastmoney.com/api/data/v1/get',
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://data.eastmoney.com/',
  }
});

const EastMoneyFinance = axios.create({
  baseURL: 'https://push2his.eastmoney.com/api/qt/stock',
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://quote.eastmoney.com/',
  }
});

const EastMoneyEmweb = axios.create({
  baseURL: 'https://push2.eastmoney.com/api/qt/clist/get',
  timeout: 8000, // 缩短超时，Render上不可用时快速失败降级
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://quote.eastmoney.com/',
  }
});

// 工具：代码转东财secid (0.开头=深证, 1.开头=上证)
function toSecId(code) {
  if (code.startsWith('6') || code.startsWith('9') || code.startsWith('5')) return `1.${code}`;
  return `0.${code}`;
}

// 延时函数（防封）
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 1. 获取A股全部股票列表（实时快照，含基本行情和市值）
 */
async function getStockList() {
  const allStocks = [];
  const pageSize = 5000; // 一次拉5000只，减少请求次数，避免Render上多页超时

  // 沪深A股 fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23（含创业板+科创板）
  // m:0+t:81+s:2048 = 北交所，排除
  for (let page = 1; page <= 3; page++) { // 3页×5000=15000只，足够覆盖全部A股
    let retries = 2;
    while (retries >= 0) {
      try {
        const res = await EastMoneyEmweb.get('', {
          timeout: 20000, // 单页20秒超时
          params: {
            pn: page,
            pz: pageSize,
            po: 1,
            np: 1,
            fltt: 2,
            invt: 2,
            fid: 'f20', // 按总市值降序，大盘股优先
            fs: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23',
            fields: 'f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f14,f15,f16,f17,f18,f20,f21,f23',
            _: Date.now()
          }
        });

        const data = res.data?.data?.diff;
        if (!data || data.length === 0) break;

        for (const item of data) {
          const code = item.f12;
          const name = item.f14;
          if (!code || !name) continue;
          // 安全转换数值字段：东财对停牌/无效数据返回'-'，需转为null
          const toNum = (v) => {
            if (v == null || v === '-' || v === '' || Number.isNaN(Number(v))) return null;
            return Number(v);
          };
          const close = toNum(item.f2);
          const pct_chg = toNum(item.f3);
          const high = toNum(item.f15);
          const low = toNum(item.f16);
          const amount = toNum(item.f6);
          const amplitude = toNum(item.f7);
          const turnover = toNum(item.f8);
          const peRaw = toNum(item.f9);
          const pe = (peRaw != null && peRaw > 0 && peRaw < 10000) ? peRaw : null;
          const total_mv_raw = toNum(item.f20);
          const circ_mv_raw = toNum(item.f21);

          const market = code.startsWith('6') ? 'SH' : (code.startsWith('8') || code.startsWith('4') ? 'BJ' : 'SZ');

          allStocks.push({
            code,
            name,
            market,
            close,
            pct_chg,
            chg: toNum(item.f4),
            volume: toNum(item.f5),
            amount, // 元
            amplitude,
            turnover, // 换手率%
            pe,
            high,
            low,
            open: toNum(item.f17),
            pre_close: toNum(item.f18),
            total_mv: total_mv_raw ? Math.round(total_mv_raw / 100000000) : null,  // 转亿
            circ_mv: circ_mv_raw ? Math.round(circ_mv_raw / 100000000) : null,
            is_st: name.includes('ST') ? 1 : 0,
            updated_at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
          });
        }

        console.log(`[东财股票列表] 第${page}页获取 ${data.length} 只，累计 ${allStocks.length} 只`);
        if (data.length < pageSize) break; // 最后一页
        break; // 成功，跳出重试
      } catch (e) {
        retries--;
        if (retries < 0) {
          console.error(`[东财股票列表] 第${page}页最终失败:`, e.message);
          break; // 失败则停止翻页（前面的页数据已可用）
        }
        console.log(`[东财股票列表] 第${page}页重试(${retries})...`);
        await sleep(500);
      }
    }
    await sleep(200);
  }

  return allStocks;
}

/**
 * 2. 获取单只股票日K线历史数据
 * @param {string} code 股票代码
 * @param {string} startDate 起始日期 YYYYMMDD
 * @param {string} endDate 结束日期 YYYYMMDD
 * @param {string} klt K线类型 101=日 102=周 103=月
 */
async function getDailyKline(code, startDate, endDate, klt = '101') {
  const maxRetries = 2;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const secid = toSecId(code);
      const res = await EastMoneyFinance.get('/kline/get', {
        params: {
          secid,
          ut: 'fa5fd1943c7b386f172d6893dbfba10b',
          fields1: 'f1,f2,f3,f4,f5,f6',
          fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
          klt,
          fqt: 1,           // 前复权
          beg: startDate,
          end: endDate,
          smplmt: 550,     // 最多条数(2年约500交易日)
          lmt: 1000000,
          _: Date.now()
        },
        timeout: 8000,  // 单次请求8秒超时（减少等待）
      });
      
      const klines = res.data?.data?.klines;
      if (!klines || klines.length === 0) {
        if (attempt < maxRetries) {
          await sleep(300);  // 短暂等待后重试
          continue;
        }
        return [];
      }
      
      return klines.map(line => {
        const parts = line.split(',');
        return {
          code,
          trade_date: parts[0].replace(/-/g, ''),
          open: parseFloat(parts[1]),
          close: parseFloat(parts[2]),
          high: parseFloat(parts[3]),
          low: parseFloat(parts[4]),
          volume: parseFloat(parts[5]),     // 手
          amount: parseFloat(parts[6]),     // 元
          amplitude: parseFloat(parts[7]),
          pct_chg: parseFloat(parts[8]),
          chg: parseFloat(parts[9]),
          turnover: parseFloat(parts[10]) || null,  // f61换手率(%)
        };
      });
    } catch (e) {
      if (attempt < maxRetries) {
        await sleep(300);
        continue;
      }
      return [];
    }
  }
  return [];
}

/**
 * 3. 获取行业板块列表及行情
 */
async function getSectorList() {
  try {
    const res = await EastMoney.get('/clist/get', {
      params: {
        pn: 1, pz: 200, po: 1, np: 1,
        fltt: 2, invt: 2, fid: 'f3',
        fs: 'm:90+t:2',  // 行业板块
        fields: 'f2,f3,f4,f8,f12,f14,f20,f104,f105,f128,f136,f140',
        _: Date.now()
      }
    });
    
    const data = res.data?.data?.diff;
    if (!data) return [];
    
    return data.map(item => ({
      sector_code: item.f12,
      sector_name: item.f14,
      change_pct: item.f3,
      main_net_inflow: item.f62 ? Math.round(item.f62 / 100000000 * 100) / 100 : null,
      up_count: item.f104,
      down_count: item.f105,
      leader_code: item.f128,
      leader_name: item.f140,
      leader_pct: item.f136,
    }));
  } catch (e) {
    console.error('获取板块列表失败:', e.message);
    return [];
  }
}

/**
 * 4. 获取个股资金流向（近5日）
 */
async function getFundFlow(code) {
  try {
    const secid = toSecId(code);
    const res = await EastMoney.get(`/stock/fflow/daykline/get`, {
      params: {
        lmt: 0,
        klt: 101,
        secid,
        fields1: 'f1,f2,f3,f7',
        fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65',
        ut: 'b2884a393a59ad64002292a3e90d46a5',
        _: Date.now()
      }
    });
    
    const klines = res.data?.data?.klines;
    if (!klines) return [];
    
    return klines.map(line => {
      const p = line.split(',');
      return {
        code,
        trade_date: p[0].replace(/-/g, ''),
        main_net_inflow: parseFloat(p[1]),    // 主力净流入(万)
        main_net_pct: parseFloat(p[2]),       // 主力净占比
        super_large_net: parseFloat(p[5]),
        large_net: parseFloat(p[6]),
        medium_net: parseFloat(p[7]),
        small_net: parseFloat(p[8]),
      };
    });
  } catch (e) {
    console.error(`获取${code}资金流失败:`, e.message);
    return [];
  }
}

/**
 * 5. 获取财务指标（个股）
 */
async function getFinancialIndicator(code) {
  try {
    const res = await EastMoneyDatacenter.get('', {
      params: {
        sortColumns: 'REPORT_DATE',
        sortTypes: '-1',
        pageSize: 20,
        pageNumber: 1,
        reportName: 'RPT_DMSK_FN_INCOME',
        columns: 'ALL',
        filter: `(SECURITY_CODE="${code}")`,
        _: Date.now()
      }
    });
    
    // 东财财务数据接口比较复杂，这里用简化版
    // 实际使用个股财务指标需要从财务摘要接口获取
    return [];
  } catch (e) {
    return [];
  }
}

/**
 * 6. 获取全部A股估值快照（PE/PB/总市值/股息率）
 */
async function getValuationSnapshot() {
  const results = [];
  const pageSize = 200;
  
  for (let page = 1; page <= 30; page++) {
    try {
      const res = await EastMoney.get('/clist/get', {
        params: {
          pn: page, pz: pageSize, po: 1, np: 1,
          fltt: 2, invt: 2, fid: 'f9',
          fs: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23',
          fields: 'f9,f23,f20,f21,f12,f115,f167',  // PE,PB,总市值,流通市值,代码,股息率,PE-TTM
          _: Date.now()
        }
      });
      
      const data = res.data?.data?.diff;
      if (!data || data.length === 0) break;
      
      const today = dayjs().format('YYYYMMDD');
      for (const item of data) {
        results.push({
          code: item.f12,
          trade_date: today,
          pe: item.f9 > 0 && item.f9 < 10000 ? item.f9 : null,
          pe_ttm: item.f167 > 0 && item.f167 < 10000 ? item.f167 : null,
          pb: item.f23 > 0 && item.f23 < 1000 ? item.f23 : null,
          total_mv: item.f20 ? Math.round(item.f20 / 100000000) : null,
          circ_mv: item.f21 ? Math.round(item.f21 / 100000000) : null,
          dv_ratio: item.f115 || null,
        });
      }
      
      await sleep(80);
    } catch (e) {
      console.error(`获取估值第${page}页失败:`, e.message);
      break;
    }
  }
  
  return results;
}

module.exports = {
  getStockList,
  getDailyKline,
  getSectorList,
  getFundFlow,
  getFinancialIndicator,
  getValuationSnapshot,
  toSecId,
  sleep,
};
