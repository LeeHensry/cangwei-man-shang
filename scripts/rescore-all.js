#!/usr/bin/env node
/**
 * 密集调用 score-batch 重跑所有股票评分
 * 解决Render 50秒超时+免费版休眠问题
 */
const https = require('https');
const http = require('http');

const BASE = process.env.BASE_URL || 'https://cangwei-man-shang.onrender.com';
const BATCH_SIZE = 15; // 每批评15只，约30-40秒
const DELAY_MS = 800;  // 批间延时

function postStep(step, extra = {}) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({ step, batchSize: BATCH_SIZE, ...extra }).toString();
    const url = new URL(BASE + '/api/sync/step?' + body);
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      timeout: 55000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({ raw: data.slice(0, 500) }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== 密集调用 score-batch 重跑评分 ===');
  console.log('目标:', BASE);
  
  // 第一次调用会初始化offset=0
  let total = 0, done = false, batchNum = 0;
  
  while (!done) {
    batchNum++;
    const t0 = Date.now();
    try {
      // 先做一个轻量请求保持进程唤醒
      if (batchNum > 1) await fetch(BASE + '/api/version').catch(() => {});
      
      const res = await postStep('score-batch');
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      
      if (res.error) {
        console.log(`[${batchNum}] ❌ 错误: ${res.error} (${elapsed}s)`);
        await sleep(3000);
        continue;
      }
      
      total = res.total || total;
      done = !!res.done;
      console.log(`[${batchNum}] ✅ offset=${res.offset}/${total} processed=${res.processed} scoreCount=${res.scoreCount} done=${done} (${elapsed}s)`);
      
      if (!done) await sleep(DELAY_MS);
    } catch(e) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[${batchNum}] ❌ 异常: ${e.message} (${elapsed}s), 等待3s重试...`);
      await sleep(3000);
    }
  }
  
  console.log(`\n=== 评分完成! 共处理 ${total} 只股票, ${batchNum} 批次 ===`);
}

// 简单fetch替代node fetch (node 22有)
async function fetch(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { timeout: 10000 }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
