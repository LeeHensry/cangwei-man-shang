/**
 * 数据库层 - 统一异步API
 * 生产环境: Supabase (PostgreSQL) 云端数据库
 * 本地开发(NODE_ENV=localdev): better-sqlite3（通过Promise包装保持API一致）
 *
 * API:
 *   dbGet(sql, params?)    => Promise<row|null>
 *   dbAll(sql, params?)    => Promise<rows>
 *   dbRun(sql, params?)    => Promise<{changes, lastInsertRowid}>
 *   dbExec(sql)            => Promise<void>
 *   dbBatch(statements)    => Promise<void>  (statements: [{sql, args}])
 *   dbIsReady()            => Promise<void>
 *   usePostgres            => boolean
 */

const isLocalDev = process.env.NODE_ENV === 'localdev';
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const usePostgres = !isLocalDev && !!SUPABASE_DB_URL;

// PostgreSQL DDL（与SQLite版差异：AUTOINCREMENT→SERIAL，TEXT不变，INTEGER不变）
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
  `CREATE TABLE IF NOT EXISTS news_sentiment (id SERIAL PRIMARY KEY, publish_time TEXT, source TEXT, title TEXT, content TEXT, related_codes TEXT, sentiment REAL, impact_score REAL, affected_sectors TEXT, summary TEXT, processed_at TEXT)`,
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
  `CREATE TABLE IF NOT EXISTS stock_universe (code TEXT PRIMARY KEY, name TEXT, market TEXT, total_mv REAL, circ_mv REAL, close REAL, pct_chg REAL, amount REAL, is_st INTEGER DEFAULT 0, updated_at TEXT, in_universe INTEGER DEFAULT 1)`,
  `CREATE INDEX IF NOT EXISTS idx_universe_mv ON stock_universe(total_mv DESC)`,
];

const ALTER_COLS = [
  ['stock_score','name','TEXT'],['stock_score','industry','TEXT'],['stock_score','current_price','REAL'],
  ['stock_score','reason','TEXT'],['stock_score','quality_detail','TEXT'],['stock_score','quality_latest','REAL'],
  ['stock_score','valuation_detail','TEXT'],['stock_score','technical_detail','TEXT'],['stock_score','pe','REAL'],
  ['stock_score','crowding_score','REAL'],['stock_score','crowding_level','TEXT'],
  ['stock_pool','pool_score','REAL']
];

if (usePostgres) {
  // ========== Supabase / PostgreSQL 云数据库 ==========
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: SUPABASE_DB_URL,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: process.env.SUPABASE_DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  });

  /**
   * 将 SQLite 风格的 ? 占位符转为 PostgreSQL 的 $1, $2, ...
   * 同时转换 INSERT OR REPLACE → INSERT ... ON CONFLICT ... DO UPDATE（需要调用方提供冲突列，这里做通用转换）
   */
  function convertSql(sql) {
    // 转换 ? 占位符为 $N
    let pgSql = sql;
    let paramIdx = 0;
    pgSql = pgSql.replace(/\?/g, () => `$${++paramIdx}`);
    return pgSql;
  }

  /**
   * 转换 INSERT OR REPLACE INTO ... VALUES (...) 为 PostgreSQL 的 ON CONFLICT
   * 需要知道主键列，这里通过表名推断
   */
  const TABLE_CONFLICT_COLS = {
    'stock_info': ['code'],
    'daily_kline': ['code', 'trade_date'],
    'technical_indicators': ['code', 'trade_date'],
    'financial_indicator': ['code', 'report_date'],
    'valuation': ['code', 'trade_date'],
    'fund_flow': ['code', 'trade_date'],
    'sector_daily': ['sector_code', 'trade_date'],
    'stock_score': ['code', 'trade_date', 'strategy'],
    'north_hold': ['code', 'trade_date'],
    'news_sentiment': ['id'],
    'portfolio': ['code'],
    'crowding_score': ['code', 'trade_date'],
    'sector_crowding': ['sector', 'trade_date'],
    'sync_log': ['table_name'],
    'short_signals': ['code', 'trade_date'],
    'stock_pool': ['code'],
    'app_settings': ['key'],
    'stock_universe': ['code'],
  };

  function convertInsertOrReplace(sql) {
    // 匹配: INSERT OR REPLACE INTO table_name (cols...) VALUES ...
    const match = sql.match(/^INSERT OR REPLACE INTO (\w+)\s*\(([^)]+)\)/i);
    if (!match) return null;

    const table = match[1];
    const cols = match[2].split(',').map(c => c.trim());
    const conflictCols = TABLE_CONFLICT_COLS[table];
    if (!conflictCols) return null;

    const updateCols = cols.filter(c => !conflictCols.includes(c));
    let conflictClause;
    if (updateCols.length > 0) {
      const setClause = updateCols.map(c => `${c}=EXCLUDED.${c}`).join(', ');
      conflictClause = `ON CONFLICT (${conflictCols.join(', ')}) DO UPDATE SET ${setClause}`;
    } else {
      conflictClause = `ON CONFLICT (${conflictCols.join(', ')}) DO NOTHING`;
    }

    // 将 INSERT OR REPLACE 替换为 INSERT，在 SQL 末尾追加 ON CONFLICT
    return sql.replace(/^INSERT OR REPLACE INTO/i, 'INSERT INTO') + ' ' + conflictClause;
  }

  function convertInsertOrIgnore(sql) {
    // INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
    if (/^INSERT OR IGNORE INTO/i.test(sql)) {
      return sql.replace(/^INSERT OR IGNORE INTO/i, 'INSERT INTO') + ' ON CONFLICT DO NOTHING';
    }
    return sql;
  }

  function toPgSql(sql) {
    let pgSql = sql;
    // 先处理 INSERT OR REPLACE
    const replaced = convertInsertOrReplace(pgSql);
    if (replaced) pgSql = replaced;
    // 处理 INSERT OR IGNORE
    pgSql = convertInsertOrIgnore(pgSql);
    // 占位符转换
    pgSql = convertSql(pgSql);
    return pgSql;
  }

  _ready = (async () => {
    try {
      const client = await pool.connect();
      for (const sql of DDL_STATEMENTS) {
        try { await client.query(sql); } catch(e) {}
      }
      for (const [table, col, type] of ALTER_COLS) {
        try { await client.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch(e) {}
      }
      client.release();
      console.log('✅ Supabase/PostgreSQL数据库初始化完成');
    } catch(err) {
      console.error('❌ PostgreSQL初始化失败:', err.message);
    }
  })();

  async function dbGet(sql, params = []) {
    const r = await pool.query(toPgSql(sql), params);
    return r.rows[0] || null;
  }
  async function dbAll(sql, params = []) {
    const r = await pool.query(toPgSql(sql), params);
    return r.rows;
  }
  async function dbRun(sql, params = []) {
    const r = await pool.query(toPgSql(sql), params);
    return { changes: r.rowCount, lastInsertRowid: r.rows[0]?.id || null };
  }
  async function dbExec(sql) {
    await pool.query(sql);
  }
  async function dbBatch(statements) {
    if (!statements.length) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const s of statements) {
        await client.query(toPgSql(s.sql), s.args || []);
      }
      await client.query('COMMIT');
    } catch(e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  function dbIsReady() { return _ready; }

  module.exports = { dbGet, dbAll, dbRun, dbExec, dbBatch, dbIsReady, usePostgres: true, useTurso: false, pool };

} else {
  // ========== 本地 SQLite ==========
  console.log(isLocalDev ? '⚠️ 本地开发模式(NODE_ENV=localdev)，使用SQLite' : '⚠️ SUPABASE_DB_URL未设置，使用本地SQLite');
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

  module.exports = { dbGet, dbAll, dbRun, dbExec, dbBatch, dbIsReady, usePostgres: false, useTurso: false, client: sqlite };
}
