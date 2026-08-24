#!/usr/bin/env node
const https = require('https');

function req(path, method='GET', timeout=55000) {
  return new Promise((resolve, reject) => {
    const url = new URL('https://cangwei-man-shang.onrender.com' + path);
    const r = https.request({ hostname: url.hostname, port:443, path: url.pathname+url.search, method, timeout, headers:{'Connection':'close'} }, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){resolve({_e:d.slice(0,200)});} });
    });
    r.on('error', reject); r.on('timeout',()=>r.destroy(new Error('timeout'))); r.end();
  });
}

const sleep = ms => new Promise(r=>setTimeout(r,ms));

(async () => {
  let batch=0, done=false, totalTime=0;
  while (!done) {
    batch++;
    const t0=Date.now();
    try {
      // 并发ping保活
      const [res] = await Promise.all([
        req('/api/sync/step?step=score-batch&batchSize=8','POST'),
        req('/api/version','GET',8000).catch(()=>null)
      ]);
      const t=Date.now()-t0; totalTime+=t;
      if (res._e) { console.log(`${batch}: ERR ${res._e.slice(0,80)}, retry 3s`); await sleep(3000); continue; }
      if (res.error) { console.log(`${batch}: ${res.error}, retry 3s`); await sleep(3000); continue; }
      done = !!res.done;
      console.log(`${batch}: ${res.progress} done=${done} ${(t/1000).toFixed(1)}s`);
      if (!done) await sleep(250);
    } catch(e) {
      console.log(`${batch}: EX ${e.message}, retry 5s`);
      await sleep(5000);
    }
  }
  console.log(`DONE in ${batch} batches, total ${(totalTime/1000).toFixed(0)}s`);
})();
