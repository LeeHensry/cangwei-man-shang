#!/usr/bin/env node
/**
 * 客户端控制分批拥挤度计算
 * 密集调用crowding-batch,并行ping保活,直到done
 */
const https = require('https');

const BASE = 'https://cangwei-man-shang.onrender.com';
const BATCH = 8;

function req(path, method='GET', timeout=55000) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const r = https.request({ hostname: url.hostname, port:443, path: url.pathname+url.search, method, timeout, headers:{'Connection':'close'} }, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{
        try{ resolve(JSON.parse(d)); }catch(e){ resolve({_parse:true, raw:d.slice(0,200), status:res.statusCode}); }
      });
    });
    r.on('error', reject);
    r.on('timeout',()=>r.destroy(new Error('timeout')));
    r.end();
  });
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));

(async () => {
  let done = false, lastProgress = '', stuck = 0;
  const t0 = Date.now();
  while (!done) {
    let ok = false, retries = 0;
    while (!ok && retries < 3) {
      try {
        const [res] = await Promise.all([
          req(`/api/sync/step?step=crowding-batch&batchSize=${BATCH}`, 'POST', 50000),
          req('/api/version','GET',8000).catch(()=>null)
        ]);
        if (res._parse) throw new Error(`HTTP ${res.status}: ${res.raw.slice(0,100)}`);
        if (res.error) throw new Error(res.error);
        const prog = res.progress || '';
        if (prog === lastProgress) stuck++; else stuck = 0;
        lastProgress = prog;
        const el = ((Date.now()-t0)/1000).toFixed(0);
        console.log(`[${el}s] progress=${prog} done=${res.done} processed=${res.processed} stuck=${stuck}`);
        if (res.done) { done = true; console.log('=== crowding 全部完成! ==='); }
        ok = true;
      } catch(e) {
        retries++;
        console.log(`❌ ${e.message}, retry ${retries}/3`);
        await sleep(3000);
        await req('/api/version','GET',10000).catch(()=>null);
      }
    }
    if (!ok) { console.log('跳过一轮, 3次重试失败'); await sleep(5000); }
    if (stuck >= 6) { console.log('进度连续6轮无变化, 暂停30s...'); await sleep(30000); stuck = 0; }
    await sleep(300);
  }
  console.log(`总耗时${((Date.now()-t0)/1000).toFixed(0)}s`);
})();
