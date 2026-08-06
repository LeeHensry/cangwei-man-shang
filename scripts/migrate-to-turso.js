/**
 * 数据迁移脚本：从本地 seed.db 导入数据到 Turso 云数据库
 * 运行: node scripts/migrate-to-turso.js
 */
const Database = require('better-sqlite3');
const { createClient } = require('@libsql/client');
const path = require('path');

const TURSO_URL = process.env.TURSO_DATABASE_URL || 'libsql://topup-db-leehensry.aws-ap-northeast-1.turso.io';
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_TOKEN) {
  console.error('❌ 请设置 TURSO_AUTH_TOKEN 环境变量');
  process.exit(1);
}

const seedPath = path.join(__dirname, '..', 'data', 'seed.db');
const local = new Database(seedPath, { readonly: true });
const remote = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

const TABLES = [
  'stock_info', 'daily_kline', 'technical_indicators', 'financial_indicator',
  'valuation', 'fund_flow', 'sector_daily', 'stock_score', 'north_hold',
  'news_sentiment', 'portfolio', 'crowding_score', 'sector_crowding',
  'sync_log', 'short_signals', 'stock_pool', 'app_settings',
];

const BATCH_SIZE = 200;

const DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS stock_info (code TEXT PRIMARY KEY, name TEXT NOT NULL, market TEXT NOT NULL, industry TEXT, list_date TEXT, is_st INTEGER DEFAULT 0, total_mv REAL, circ_mv REAL, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS daily_kline (code TEXT NOT NULL, trade_date TEXT NOT NULL, open REAL, high REAL, low REAL, close REAL, volume REAL, amount REAL, amplitude REAL, pct_chg REAL, chg REAL, turnover REAL, PRIMARY KEY (code, trade_date))`,
  `CREATE INDEX IF NOT EXISTS idx_kline_date ON daily_kline(trade_date)`,
  `CREATE TABLE IF NOT EXISTS technical_indicators (code TEXT NOT NULL, trade_date TEXT NOT NULL, ma5 REAL, ma10 REAL, ma20 REAL, ma60 REAL, ma120 REAL, ma250 REAL, vol_ma5 REAL, vol_ma20 REAL, macd_dif REAL, macd_dea REAL, macd_bar REAL, rsi6 REAL, rsi14 REAL, kdj_k REAL, kdj_d REAL, kdj_j REAL, boll_upper REAL, boll_mid REAL, boll_lower REAL, PRIMARY KEY (code, trade_date))`,
  `CREATE TABLE IF NOT EXISTS financial_indicator (code TEXT NOT NULL, report_date TEXT NOT NULL, roe REAL, roa REAL, gross_margin REAL, net_margin REAL, revenue REAL, revenue_yoy REAL, net_profit REAL, net_profit_yoy REAL, debt_ratio REAL, current_ratio REAL, ocf REAL, ocf_per_share REAL, eps REAL, bps REAL, roic REAL, report_type TEXT, PRIMARY KEY (code, report_date))`,
  `CREATE TABLE IF NOT EXISTS valuation (code TEXT NOT NULL, trade_date TEXT NOT NULL, pe REAL, pe_ttm REAL, pb REAL, ps REAL, ps_ttm REAL, dv_ratio REAL, total_mv REAL, circ_mv REAL, PRIMARY KEY (code, trade_date))`,
  `CREATE TABLE IF NOT EXISTS fund_flow (code TEXT NOT NULL, trade_date TEXT NOT NULL, main_net_inflow REAL, main_net_pct REAL, super_large_net REAL, large_net REAL, medium_net REAL, small_net REAL, north_net_inflow REAL, PRIMARY KEY (code, trade_date))`,
  `CREATE TABLE IF NOT EXISTS sector_daily (sector_code TEXT NOT NULL, sector_name TEXT NOT NULL, trade_date TEXT NOT NULL, change_pct REAL, main_net_inflow REAL, up_count INTEGER, down_count INTEGER, leader_code TEXT, leader_name TEXT, leader_pct REAL, PRIMARY KEY (sector_code, trade_date))`,
  `CREATE TABLE IF NOT EXISTS stock_score (code TEXT NOT NULL, trade_date TEXT NOT NULL, strategy TEXT NOT NULL, name TEXT, industry TEXT, quality_score REAL, valuation_score REAL, technical_score REAL, fund_score REAL, sentiment_score REAL, crowding_score REAL, crowding_level TEXT, total_score REAL, signal TEXT, current_price REAL, target_price REAL, stop_loss REAL, position_pct REAL, reason TEXT, quality_detail TEXT, quality_latest REAL, valuation_detail TEXT, technical_detail TEXT, pe REAL, PRIMARY KEY (code, trade_date, strategy))`,
  `CREATE TABLE IF NOT EXISTS north_hold (code TEXT NOT NULL, trade_date TEXT NOT NULL, hold_shares REAL, hold_market_cap REAL, hold_ratio REAL, change_1d REAL, change_5d REAL, PRIMARY KEY (code, trade_date))`,
  `CREATE TABLE IF NOT EXISTS news_sentiment (id INTEGER PRIMARY KEY AUTOINCREMENT, publish_time TEXT, source TEXT, title TEXT, content TEXT, related_codes TEXT, sentiment REAL, impact_score REAL, affected_sectors TEXT, summary TEXT, processed_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS portfolio (code TEXT PRIMARY KEY, name TEXT, strategy TEXT, buy_date TEXT, buy_price REAL, position_pct REAL, shares INTEGER, stop_loss REAL, target_price REAL, status TEXT DEFAULT 'holding')`,
  `CREATE TABLE IF NOT EXISTS crowding_score (code TEXT NOT NULL, name TEXT, trade_date TEXT NOT NULL, stock_crowding_score REAL, sector_crowding_score REAL, combined_crowding_score REAL, level TEXT, action TEXT, momentum_bonus REAL, crowding_penalty REAL, factors_json TEXT, PRIMARY KEY (code, trade_date))`,
  `CREATE INDEX IF NOT EXISTS idx_crowding_date ON crowding_score(trade_date)`,
  `CREATE INDEX IF NOT EXISTS idx_crowding_level ON crowding_score(level)`,
  `CREATE TABLE IF NOT EXISTS sector_crowding (sector TEXT NOT NULL, trade_date TEXT NOT NULL, crowding_score REAL, level TEXT, stock_count INTEGER, up_ratio REAL, PRIMARY KEY (sector, trade_date))`,
  `CREATE TABLE IF NOT EXISTS sync_log (table_name TEXT NOT NULL, last_sync TEXT NOT NULL, rows_count INTEGER, PRIMARY KEY (table_name))`,
  `CREATE TABLE IF NOT EXISTS short_signals (code TEXT NOT NULL, trade_date TEXT NOT NULL, close REAL, pct_chg REAL, short_score REAL, signal TEXT, position_pct REAL, stop_loss REAL, target_price REAL, reasons_json TEXT, risks_json TEXT, PRIMARY KEY (code, trade_date))`,
  `CREATE INDEX IF NOT EXISTS idx_short_date ON short_signals(trade_date)`,
  `CREATE TABLE IF NOT EXISTS stock_pool (code TEXT PRIMARY KEY, name TEXT, industry TEXT, in_pool INTEGER DEFAULT 1, is_manual INTEGER DEFAULT 0, added_at TEXT, note TEXT, pool_score REAL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)`,
];

async function createTables() {
  console.log('📋 创建表结构...');
  for (const sql of DDL_STATEMENTS) {
    try { await remote.execute(sql); } catch(e) { /* ignore IF NOT EXISTS conflicts */ }
  }
  console.log('✅ 表结构创建完成\n');
}

async function migrateTable(tableName) {
  const rows = local.prepare(`SELECT * FROM ${tableName}`).all();
  if (rows.length === 0) {
    console.log(`  ${tableName}: 0 rows (skip)`);
    return;
  }
  const columns = Object.keys(rows[0]);
  const placeholders = columns.map(() => '?').join(',');
  const sql = `INSERT OR REPLACE INTO ${tableName} (${columns.join(',')}) VALUES (${placeholders})`;
  
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const statements = batch.map(r => ({
      sql,
      args: columns.map(c => r[c] ?? null),
    }));
    await remote.batch(statements);
  }
  console.log(`  ${tableName}: ${rows.length} rows ✅`);
}

async function main() {
  console.log('🚀 开始迁移数据到 Turso...\n');
  
  // 先建表
  await createTables();
  
  for (const table of TABLES) {
    try {
      await migrateTable(table);
    } catch(e) {
      console.error(`  ${table}: ❌ ${e.message}`);
    }
  }
  
  console.log('');
  console.log('✅ 迁移完成！');
  
  // 验证
  for (const table of ['stock_info', 'daily_kline', 'stock_score', 'stock_pool']) {
    try {
      const r = await remote.execute(`SELECT COUNT(*) as c FROM ${table}`);
      console.log(`  ${table}: ${r.rows[0].c} rows on Turso`);
    } catch(e) {
      console.log(`  ${table}: 验证失败 - ${e.message}`);
    }
  }
  
  local.close();
  remote.close();
}

main().catch(e => { console.error('迁移失败:', e); process.exit(1); });
