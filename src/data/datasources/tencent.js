/**
 * 腾讯财经数据源适配器（复用现有 tencent.js）
 */
const tencent = require('../tencent');

const sleep = tencent.sleep;

async function probe() {
  try {
    const start = Date.now();
    // 简单打一个行情接口
    const axios = require('axios');
    const iconv = require('iconv-lite');
    const res = await axios.get('https://qt.gtimg.cn/q=sh600519', {
      timeout: 5000,
      responseType: 'arraybuffer',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://gu.qq.com/' },
    });
    const text = iconv.decode(Buffer.from(res.data), 'gbk');
    const ok = text.includes('贵州茅台');
    return { ok, latency: Date.now() - start };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  name: 'tencent',
  label: '腾讯财经',
  regions: ['domestic'],
  getQuickStockList: tencent.getQuickStockList,
  getDailyKline: tencent.getDailyKline,
  getIndexQuotes: tencent.getIndexQuotes,
  getSectorList: tencent.getSectorList,
  sleep,
  probe,
};
