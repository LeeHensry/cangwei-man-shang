/**
 * 财务数据批量同步
 */
const db = require('../data/db');
const { syncFinancialData } = require('./value_score');
const { sleep } = require('../data/tencent');

async function main() {
  const codes = db.prepare('SELECT code, name FROM stock_info WHERE is_st = 0').all();
  console.log(`📊 开始同步财务数据，共 ${codes.length} 只股票`);
  
  let success = 0;
  for (let i = 0; i < codes.length; i++) {
    const { code, name } = codes[i];
    const ok = await syncFinancialData(code);
    if (ok) success++;
    
    if ((i + 1) % 10 === 0) {
      console.log(`  进度: ${i + 1}/${codes.length} | 成功: ${success}`);
    }
    await sleep(200);
  }
  
  console.log(`\n✅ 财务数据同步完成，成功 ${success}/${codes.length}`);
}

main().catch(console.error);
