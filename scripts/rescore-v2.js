#!/usr/bin/env node
/**
 * 密集调用 score-batch 重跑评分 - 改进版
 * 关键：每批之间间隔很短(300ms)，用version ping保持活跃
 */
const https = require('https');

const BASE = 'https://cangwei-man-shang.onrender.com';
const BATCH_SIZE = 8;

function request(path, method = 'GET', body = null, timeout = 55000) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const client = https;
    const opts = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method,
      timeout,
      headers: { 'Connection': 'close' }
    };
    const req = client.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({ _raw: data.slice(0, 300), _status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('ETIMEDOUT')); });
    if (body) req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== 开始密集重评分 ===');
  const t0all = Date.now();
  let batch = 0;
  let done = false;
  
  while (!done) {
    batch++;
    const t0 = Date.now();
    try {
      // 并发：一个评分请求，一个version ping保活
      const [res] = await Promise.all([
        request(`/api/sync/step?step=score-batch&batchSize=${BATCH_SIZE}`, 'POST', null, 55000),
        request('/api/version', 'GET', null, 10000).catch(() => null)
      ]);
      
      if (res._raw) {
        console.log(`[${batch}] ❌ HTTP ${res._status}: ${res._raw.slice(0,100)}`);
        await sleep(2000);
        continue;
      }
      if (res.error) {
        console.log(`[${batch}] ❌ ${res.error} (${Date.now()-t0}ms)`);
        await sleep(2000);
        continue;
      }
      
      done = !!res.done;
      const elapsed = (Date.now() - t0) / 1000;
      console.log(`[${batch}] ${res.progress} processed=${res.processed} scoreCount=${res.scoreCount} done=${done} (${elapsed.toFixed(1)}s)`);
      
      // 短延时保持活跃
      if (!done) await sleep(300);
    } catch(e) {
      console.log(`[${batch}] ❌ ${e.message}, 5s后重试...`);
      await sleep(5000);
    }
  }
  
  console.log(`\n=== 评分完成! ${batch}批次, 总耗时 ${((Date.now()-t0all)/1000).toFixed(0)}s ===`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
