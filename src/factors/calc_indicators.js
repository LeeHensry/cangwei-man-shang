/**
 * 批量计算技术指标并入库
 */
const db = require('../data/db');
const { calcAllIndicators } = require('./indicators');
const dayjs = require('dayjs');

function calcAndSave(code) {
  // 获取该股票所有K线
  const klines = db.prepare(`
    SELECT code, trade_date, open, high, low, close, volume, pct_chg
    FROM daily_kline WHERE code = ? ORDER BY trade_date ASC
  `).all(code);
  
  if (klines.length < 60) {
    // 数据不足以计算ma60以上的指标
    return 0;
  }
  
  const indicators = calcAllIndicators(klines);
  
  // 批量插入
  const columns = [
    'code', 'trade_date', 'ma5', 'ma10', 'ma20', 'ma60', 'ma120', 'ma250',
    'vol_ma5', 'vol_ma20', 'macd_dif', 'macd_dea', 'macd_bar',
    'rsi6', 'rsi14', 'kdj_k', 'kdj_d', 'kdj_j',
    'boll_upper', 'boll_mid', 'boll_lower'
  ];
  
  const placeholders = columns.map(() => '?').join(',');
  const stmt = db.prepare(`INSERT OR REPLACE INTO technical_indicators
    (${columns.join(',')}) VALUES (${placeholders})`);
  
  const insertMany = db.transaction((rows) => {
    let count = 0;
    for (const row of rows) {
      if (row.ma5 !== null) {  // 至少有MA5才插入
        stmt.run(...columns.map(c => row[c] ?? null));
        count++;
      }
    }
    return count;
  });
  
  const count = insertMany(indicators);
  return count;
}

function main() {
  const args = process.argv.slice(2);
  const specificCode = args[0];
  
  console.log('═══════════════════════════════════════');
  console.log('  技术指标计算');
  console.log('  时间:', dayjs().format('YYYY-MM-DD HH:mm:ss'));
  console.log('═══════════════════════════════════════');
  
  let codes;
  if (specificCode) {
    codes = [specificCode];
  } else {
    codes = db.prepare('SELECT DISTINCT code FROM daily_kline').all().map(r => r.code);
  }
  
  console.log(`\n📊 待计算股票数: ${codes.length}`);
  
  let totalRows = 0;
  for (let i = 0; i < codes.length; i++) {
    const count = calcAndSave(codes[i]);
    totalRows += count;
    if ((i + 1) % 10 === 0 || i === codes.length - 1) {
      console.log(`  进度: ${i + 1}/${codes.length} | 已计算指标: ${totalRows} 条`);
    }
  }
  
  db.prepare('INSERT OR REPLACE INTO sync_log (table_name, last_sync, rows_count) VALUES (?, ?, ?)')
    .run('technical_indicators', dayjs().format('YYYY-MM-DD HH:mm:ss'), totalRows);
  
  console.log(`\n✅ 技术指标计算完成！共 ${totalRows} 条记录`);
}

main();
