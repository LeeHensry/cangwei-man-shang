/**
 * 本地批量拉取股票池PE/PB估值数据（腾讯行情），上传到Render DB
 * 腾讯行情字段:
 *   parts[3] = close, parts[32] = pct_chg, parts[38] = turnover(%)
 *   parts[39] = PE(TTM), parts[46] = PB, parts[44] = circ_mv(亿), parts[45] = total_mv(亿)
 *   parts[49] = 量比, parts[37] = 成交额(万元)
 */
const axios = require('axios');
const iconv = require('iconv-lite');

const SERVER = process.argv[2] || 'https://cangwei-man-shang.onrender.com';
const BATCH = 40;  // 腾讯每批最多约50只

const Tencent = axios.create({
  baseURL: 'https://qt.gtimg.cn',
  timeout: 15000,
  responseType: 'arraybuffer',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://gu.qq.com/',
  }
});

function toNum(v) {
  if (v == null || v === '' || v === '-') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function toTencentCode(code) {
  code = String(code).replace(/^(sh|sz|bj)/, '');
  if (code.startsWith('6') || code.startsWith('9')) return 'sh' + code;
  if (code.startsWith('8') || code.startsWith('4')) return 'bj' + code;
  return 'sz' + code;
}

async function getPoolCodes() {
  const res = await axios.get(`${SERVER}/api/stocks`, {
    params: { pageSize: 300, page: 1 },
    timeout: 25000,
  });
  return res.data.data.map(r => r.code);
}

async function fetchValuationBatch(codes) {
  const tCodes = codes.map(toTencentCode).join(',');
  const res = await Tencent.get('/q=' + tCodes);
  const text = iconv.decode(Buffer.from(res.data), 'gbk');
  const results = [];
  for (const line of text.trim().split(';')) {
    if (!line.includes('~')) continue;
    const m = line.match(/v_(..\d+)="(.*)"/);
    if (!m) continue;
    const p = m[2].split('~');
    if (p.length < 50) continue;
    const code = p[2];
    const name = p[1];
    const close = toNum(p[3]);
    if (!close || close <= 0) continue;  // 停牌/退市
    if (name.includes('ST') || name.includes('退')) continue;
    
    const pe = (() => { const v = toNum(p[39]); return v != null && v > 0 && v < 10000 ? v : null; })();
    const pb = (() => { const v = toNum(p[46]); return v != null && v > 0 && v < 1000 ? v : null; })();
    const totalMv = toNum(p[45]);
    const circMv = toNum(p[44]);
    const dvRatio = toNum(p[50]);  // 股息率(%)
    
    results.push({
      code,
      name,
      close,
      pe,          // PE(TTM)
      pe_ttm: pe,
      pb,
      total_mv: totalMv ? Math.round(totalMv) : null,
      circ_mv: circMv ? Math.round(circMv) : null,
      dv_ratio: dvRatio,
      pct_chg: toNum(p[32]),
      turnover: toNum(p[38]),
      amount: toNum(p[37]) ? Math.round(toNum(p[37]) * 10000) : null,  // 万元→元
    });
  }
  return results;
}

async function uploadValuation(records) {
  let totalWritten = 0;
  const UP_BATCH = 50;
  for (let i = 0; i < records.length; i += UP_BATCH) {
    const batch = records.slice(i, i + UP_BATCH);
    try {
      const res = await axios.post(`${SERVER}/api/sync/step`, {
        step: 'valuation-upload',
        records: batch.map(r => ({
          code: r.code,
          pe: r.pe,
          pe_ttm: r.pe_ttm,
          pb: r.pb,
          total_mv: r.total_mv,
          circ_mv: r.circ_mv,
          dv_ratio: r.dv_ratio,
        })),
      }, {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' },
      });
      totalWritten += res.data.written || batch.length;
      if ((i / UP_BATCH) % 2 === 0) {
        console.log(`  uploaded ${Math.min(i + UP_BATCH, records.length)}/${records.length}`);
      }
    } catch (e) {
      console.error(`  upload batch ${Math.floor(i/UP_BATCH)+1} failed:`, e.message?.substring(0, 200));
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return totalWritten;
}

async function main() {
  console.log(`=== Fetching pool codes from ${SERVER} ===`);
  const codes = await getPoolCodes();
  console.log(`Pool: ${codes.length} stocks`);

  console.log('\n=== Fetching valuation data from Tencent ===');
  const allRecords = [];
  const invalidCodes = [];
  
  for (let i = 0; i < codes.length; i += BATCH) {
    const batch = codes.slice(i, i + BATCH);
    try {
      const records = await fetchValuationBatch(batch);
      allRecords.push(...records);
      const invalidInBatch = batch.filter(c => !records.find(r => r.code === c.replace(/^(sh|sz|bj)/, '')));
      invalidCodes.push(...invalidInBatch);
      process.stdout.write(`  batch ${Math.floor(i/BATCH)+1}: ${records.length}/${batch.length} ok\r`);
    } catch (e) {
      console.error(`  batch ${Math.floor(i/BATCH)+1} failed:`, e.message);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log(`\n\nFetched: ${allRecords.length} valid stocks, ${invalidCodes.length} invalid/missing`);
  if (invalidCodes.length > 0) {
    console.log('Invalid/delisted codes:', invalidCodes.slice(0, 20).join(', '));
  }

  // Stats
  const withPE = allRecords.filter(r => r.pe != null).length;
  const withPB = allRecords.filter(r => r.pb != null).length;
  const avgPE = (() => {
    const pes = allRecords.filter(r => r.pe != null && r.pe > 0 && r.pe < 500).map(r => r.pe);
    return pes.length ? (pes.reduce((a,b)=>a+b,0)/pes.length).toFixed(1) : 'N/A';
  })();
  console.log(`With PE: ${withPE}, With PB: ${withPB}, Avg PE: ${avgPE}`);

  console.log(`\n=== Uploading ${allRecords.length} valuation records to Render ===`);
  const written = await uploadValuation(allRecords);
  console.log(`\n=== Done: ${written} records written ===`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
