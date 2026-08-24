#!/usr/bin/env node
/**
 * 客户端控制分批评分 - v3
 * 1. 从服务器获取所有pool codes
 * 2. 按小批量(6只)提交score-codes评分
 * 3. 客户端维护offset，不依赖服务器内存state
 * 4. 并发ping version保活防止Render suspend
 */
const https = require('https');

const BASE = 'https://cangwei-man-shang.onrender.com';
const BATCH = 6;
const DELAY_MS = 400;

function req(path, method='GET', timeout=55000) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const r = https.request({ hostname: url.hostname, port:443, path: url.pathname+url.search, method, timeout, headers:{'Connection':'close'} }, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{
        try{ resolve(JSON.parse(d)); }catch(e){ resolve({_parse:true, raw:d.slice(0,300), status:res.statusCode}); }
      });
    });
    r.on('error', reject);
    r.on('timeout',()=>r.destroy(new Error('timeout')));
    r.end();
  });
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));

(async () => {
  console.log('=== 获取stock_pool列表 ===');
  // 唤醒 + 获取列表
  const [listRes, pingRes] = await Promise.all([
    req('/api/sync/step?step=score-list', 'POST', 30000).catch(e => ({error:e.message})),
    req('/api/version', 'GET', 10000).catch(()=>null)
  ]);
  if (listRes.error) { console.error('获取列表失败:', listRes.error); process.exit(1); }
  if (listRes._parse) { console.error('解析失败:', listRes.raw); process.exit(1); }
  const codes = listRes.codes;
  console.log(`共 ${codes.length} 只股票需要评分，每批${BATCH}只`);

  let done = 0, errors = 0, totalT = Date.now();
  for (let i = 0; i < codes.length; i += BATCH) {
    const batch = codes.slice(i, i+BATCH);
    const batchNum = Math.floor(i/BATCH) + 1;
    const t0 = Date.now();
    let ok = false, retries = 0;
    while (!ok && retries < 3) {
      try {
        const codesStr = batch.join(',');
        const [res] = await Promise.all([
          req(`/api/sync/step?step=score-codes&codes=${codesStr}`, 'POST', 50000),
          req('/api/version','GET',8000).catch(()=>null)
        ]);
        if (res._parse) { throw new Error(`HTTP ${res.status}: ${res.raw.slice(0,100)}`); }
        if (res.error) { throw new Error(res.error); }
        done += res.scoreCount || 0;
        const t = ((Date.now()-t0)/1000).toFixed(1);
        console.log(`[${batchNum}] ${Math.min(i+BATCH,codes.length)}/${codes.length} processed=${res.processed} scored=${res.scoreCount} (${t}s)`);
        ok = true;
      } catch(e) {
        retries++;
        console.log(`[${batchNum}] ❌ ${e.message}, 重试 ${retries}/3...`);
        await sleep(3000);
        // retry时重新唤醒
        await req('/api/version','GET',10000).catch(()=>null);
      }
    }
    if (!ok) { errors += batch.length; console.log(`[${batchNum}] 跳过这批`); }
    if (i + BATCH < codes.length) await sleep(DELAY_MS);
  }

  console.log(`\n=== 评分完成! scored=${done}, errors=${errors}, 总耗时${((Date.now()-totalT)/1000).toFixed(0)}s ===`);
})();
