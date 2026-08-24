/**
 * 本地批量拉取股票池财务数据（东方财富datacenter API），上传到Render DB
 * 复用 src/data/finance.js 的 getFinancialData
 */
const axios = require('axios');
const { getFinancialData } = require('../src/data/finance');

const SERVER = process.argv[2] || 'https://cangwei-man-shang.onrender.com';
const BATCH = 20;  // 拉取批大小

async function getPoolCodes() {
  const res = await axios.get(`${SERVER}/api/stocks`, {
    params: { pageSize: 300, page: 1 },
    timeout: 25000,
  });
  return res.data.data.map(r => r.code);
}

async function uploadFinance(records) {
  let totalWritten = 0;
  const UP_BATCH = 40;
  for (let i = 0; i < records.length; i += UP_BATCH) {
    const batch = records.slice(i, i + UP_BATCH);
    let ok = false, retries = 0;
    while (!ok && retries < 3) {
      try {
        const res = await axios.post(`${SERVER}/api/sync/step`, {
          step: 'finance-upload',
          records: batch,
        }, {
          timeout: 30000,
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.data.error) throw new Error(res.data.error);
        totalWritten += res.data.written || batch.length;
        ok = true;
      } catch (e) {
        retries++;
        console.error(`  upload batch ${Math.floor(i/UP_BATCH)+1} retry ${retries}: ${e.message?.substring(0, 150)}`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    if ((i / UP_BATCH) % 2 === 0) {
      console.log(`  uploaded ${Math.min(i + UP_BATCH, records.length)}/${records.length}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return totalWritten;
}

async function main() {
  console.log(`=== Fetching pool codes from ${SERVER} ===`);
  const codes = await getPoolCodes();
  console.log(`Pool: ${codes.length} stocks`);

  console.log('\n=== Fetching financial data from EastMoney (local) ===');
  const allRecords = [];
  let failed = 0;
  for (let i = 0; i < codes.length; i += BATCH) {
    const batch = codes.slice(i, i + BATCH);
    for (const code of batch) {
      try {
        const data = await getFinancialData(code, 8);
        if (data.length > 0) allRecords.push(...data);
        else failed++;
      } catch (e) {
        failed++;
      }
      await new Promise(r => setTimeout(r, 120));
    }
    process.stdout.write(`  fetched ${Math.min(i + BATCH, codes.length)}/${codes.length} (records=${allRecords.length})\r`);
  }

  console.log(`\n\nFetched: ${allRecords.length} financial records, ${failed} stocks failed`);
  const withFin = new Set(allRecords.map(r => r.code)).size;
  console.log(`Stocks with financial data: ${withFin}/${codes.length}`);

  console.log(`\n=== Uploading to Render (finance-upload) ===`);
  const written = await uploadFinance(allRecords);
  console.log(`\n=== Done: ${written} records written ===`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
