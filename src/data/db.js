/**
 * 数据库层 - 统一异步API
 * 生产环境: Turso (libSQL) 云端数据库
 * 本地开发(NODE_ENV=localdev): better-sqlite3（通过Promise包装保持API一致）
 *
 * API:
 *   dbGet(sql, params?)    => Promise<row|null>
 *   dbAll(sql, params?)    => Promise<rows>
 *   dbRun(sql, params?)    => Promise<{changes, lastInsertRowid}>
 *   dbExec(sql)            => Promise<void>
 *   dbBatch(statements)    => Promise<void>  (statements: [{sql, args}])
 *   dbIsReady()            => Promise<void>
 *   useTurso               => boolean
 *
 * 同时导出default对象兼容旧代码: db.prepare(sql).get/all/run 但返回Promise
 */

const TURSO_URL = process.env.TURSO_DATABASE_URL || 'libsql://topup-db-leehensry.aws-ap-northeast-1.turso.io';
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const isLocalDev = process.env.NODE_ENV === 'localdev';
const useTurso = !isLocalDev && !!TURSO_TOKEN;

let client;
let _ready;
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
  `CREATE TABLE IF NOT EXISTS stock_pool (code TEXT PRIMARY KEY, name TEXT, industry TEXT, in_pool INTEGER DEFAULT 1, is_manual INTEGER DEFAULT 0, added_at TEXT, note TEXT, pool_score REAL DEFAULT 0, pool_reason TEXT, score_volume REAL, score_momentum REAL, last_trade_date TEXT, updated_at TEXT, in_pool_date TEXT)`,
  `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)`,
];

const ALTER_COLS = [
  ['stock_score','name','TEXT'],['stock_score','industry','TEXT'],['stock_score','current_price','REAL'],
  ['stock_score','reason','TEXT'],['stock_score','quality_detail','TEXT'],['stock_score','quality_latest','REAL'],
  ['stock_score','valuation_detail','TEXT'],['stock_score','technical_detail','TEXT'],['stock_score','pe','REAL'],
  ['stock_score','crowding_score','REAL'],['stock_score','crowding_level','TEXT'],
  ['stock_pool','pool_score','REAL']
];

if (useTurso) {
  // ========== Turso 云数据库 ==========
  const { createClient } = require('@libsql/client');
  client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

  _ready = (async () => {
    try {
      for (const sql of DDL_STATEMENTS) {
        try { await client.execute(sql); } catch(e) {}
      }
      for (const [table, col, type] of ALTER_COLS) {
        try { await client.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch(e) {}
      }
      console.log('✅ Turso云数据库初始化完成');
    } catch(err) {
      console.error('❌ Turso初始化失败:', err.message);
    }
  })();

  async function dbGet(sql, params = []) {
    const r = await client.execute({ sql, args: params });
    return r.rows[0] || null;
  }
  async function dbAll(sql, params = []) {
    const r = await client.execute({ sql, args: params });
    return r.rows;
  }
  async function dbRun(sql, params = []) {
    const r = await client.execute({ sql, args: params });
    return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid };
  }
  async function dbExec(sql) {
    await client.executeMultiple(sql);
  }
  async function dbBatch(statements) {
    if (!statements.length) return;
    await client.batch(statements.map(s => ({ sql: s.sql, args: s.args || [] })));
  }
  function dbIsReady() { return _ready; }

  module.exports = { dbGet, dbAll, dbRun, dbExec, dbBatch, dbIsReady, useTurso: true, client };

} else {
  // ========== 本地 SQLite ==========
  console.log(isLocalDev ? '⚠️ 本地开发模式(NODE_ENV=localdev)，使用SQLite' : '⚠️ TURSO_AUTH_TOKEN未设置，使用本地SQLite');
  const Database = require('better-sqlite3');
  const path = require('path');
  const fs = require('fs');
  const dataDir = path.join(__dirname, '..', '..', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // 种子数据
  const dbPath = path.join(dataDir, 'stock_advisor.db');
  const seedPath = path.join(dataDir, 'seed.db');
  if (isLocalDev || !process.env.PORT) {
    let needSeed = false;
    if (!fs.existsSync(dbPath)) needSeed = true;
    else { try { const s = fs.statSync(dbPath); if (s.size < 100*1024) needSeed = true; } catch(e) {} }
    if (needSeed && fs.existsSync(seedPath)) {
      fs.copyFileSync(seedPath, dbPath);
      console.log('[init] ✅ 已从 seed.db 恢复种子数据库');
    }
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  for (const sql of DDL_STATEMENTS) { try { sqlite.exec(sql); } catch(e) {} }
  for (const [table, col, type] of ALTER_COLS) {
    try { sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch(e) {}
  }
  console.log('✅ 本地SQLite数据库初始化完成');

  async function dbGet(sql, params = []) { return sqlite.prepare(sql).get(...params) || null; }
  async function dbAll(sql, params = []) { return sqlite.prepare(sql).all(...params); }
  async function dbRun(sql, params = []) {
    const info = sqlite.prepare(sql).run(...params);
    return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
  }
  async function dbExec(sql) { sqlite.exec(sql); }
  async function dbBatch(statements) {
    const tx = sqlite.transaction((stmts) => {
      for (const s of stmts) sqlite.prepare(s.sql).run(...(s.args || []));
    });
    tx(statements);
  }
  function dbIsReady() { return Promise.resolve(); }

  module.exports = { dbGet, dbAll, dbRun, dbExec, dbBatch, dbIsReady, useTurso: false, client: sqlite };
}
