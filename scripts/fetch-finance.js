/**
 * 本地批量拉取股票池财务数据，保存到JSON，然后上传到Render DB
 */
const axios = require('axios');
const https = require('https');
const fs = require('fs');

const agent = new https.Agent({ rejectUnauthorized: false });

const EastMoneyDC = axios.create({
  baseURL: 'https://datacenter.eastmoney.com/securities/api/data/v1/get',
  timeout: 15000,
  httpsAgent: agent,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://emweb.securities.eastmoney.com/',
  }
});

const RENDER_URL = 'https://cangwei-man-shang.onrender.com';

async function getStockPoolCodes() {
  const res = await axios.get(`${RENDER_URL}/api/stocks`, {
    params: { pageSize: 250, page: 1 },
    timeout: 25000,
  });
  return res.data.data.map(r => r.code);
}

async function getFinancialData(code, count = 20) {
  try {
    const res = await EastMoneyDC.get('', {
      params: {
        reportName: 'RPT_F10_FINANCE_MAINFINADATA',
        columns: 'ALL',
        filter: `(SECURITY_CODE="${code}")`,
        pageNumber: 1,
        pageSize: count,
        sortColumns: 'REPORT_DATE',
        sortTypes: '-1',
        source: 'HSF10',
        client: 'PC',
        _: Date.now(),
      }
    });
    const data = res.data?.result?.data;
    if (!data || data.length === 0) return [];
    return data.map(r => ({
      code,
      report_date: r.REPORT_DATE ? r.REPORT_DATE.substring(0, 10).replace(/-/g, '') : null,
      report_type: r.REPORT_TYPE || '',
      roe: r.ROEJQ,
      roa: r.ZZCJLL,
      gross_margin: r.XSMLL,
      net_margin: r.XSJLL,
      revenue: r.TOTALOPERATEREVE ? +(r.TOTALOPERATEREVE / 1e8).toFixed(2) : null,
      revenue_yoy: r.TOTALOPERATEREVETZ,
      net_profit: r.PARENTNETPROFIT ? +(r.PARENTNETPROFIT / 1e8).toFixed(2) : null,
      net_profit_yoy: r.PARENTNETPROFITTZ,
      debt_ratio: r.ZCFZL,
      current_ratio: r.LD,
      ocf: r.NETCASH_OPERATE_PK ? +(r.NETCASH_OPERATE_PK / 1e8).toFixed(2) : null,
      eps: r.EPSJB,
      bps: r.BPS,
      ocf_per_share: r.MGJYXJJE,
      roic: r.ROIC,
    })).filter(r => r.report_date);
  } catch (e) {
    console.error(`  ${code} failed:`, e.response?.status || e.message);
    return [];
  }
}

async function uploadToRender(records) {
  // 分批上传，每批30条（避免请求body过大）
  let totalWritten = 0;
  for (let i = 0; i < records.length; i += 30) {
    const batch = records.slice(i, i + 30);
    try {
      const res = await axios.post(`${RENDER_URL}/api/sync/step`, {
        step: 'finance-upload',
        records: batch,
      }, { 
        timeout: 50000,
        headers: { 'Content-Type': 'application/json' },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      totalWritten += res.data.written || 0;
      if (i % 120 === 0) console.log(`  uploaded ${i + batch.length}/${records.length}`);
    } catch (e) {
      console.error(`  upload batch ${Math.floor(i/30)+1} failed:`, e.response?.status, e.response?.data || e.message);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return totalWritten;
}

async function main() {
  console.log('=== Fetching stock pool codes ===');
  const codes = await getStockPoolCodes();
  console.log(`Pool: ${codes.length} stocks`);

  // Check if we already have cached data
  const cacheFile = '/tmp/finance-data.json';
  let allRecords = [];
  
  if (fs.existsSync(cacheFile)) {
    console.log('Loading cached data from', cacheFile);
    allRecords = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    console.log(`Loaded ${allRecords.length} cached records`);
  } else {
    console.log('\n=== Fetching financial data ===');
    let successCount = 0, failCount = 0;
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      process.stdout.write(`[${i+1}/${codes.length}] ${code} ... `);
      const data = await getFinancialData(code);
      if (data.length > 0) {
        allRecords = allRecords.concat(data);
        successCount++;
        console.log(`${data.length} records`);
      } else {
        failCount++;
        console.log('0 records');
      }
      await new Promise(r => setTimeout(r, 200));
    }
    // Cache to file
    fs.writeFileSync(cacheFile, JSON.stringify(allRecords));
    console.log(`\nFetched: ${successCount} ok, ${failCount} fail, ${allRecords.length} total records`);
    console.log(`Cached to ${cacheFile}`);
  }

  console.log(`\n=== Uploading ${allRecords.length} records to Render ===`);
  const written = await uploadToRender(allRecords);
  console.log(`\n=== Done: ${written} records written ===`);
}

main().catch(e => console.error('Fatal:', e.message));
