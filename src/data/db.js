/**
 * 数据库初始化 - DuckDB替代方案：better-sqlite3
 * 设计：支持行情、基本面、资金、估值等多类数据
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'stock_advisor.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// ========== 建表 ==========

// 1. 股票基本信息表
db.exec(`
CREATE TABLE IF NOT EXISTS stock_info (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  market TEXT NOT NULL,           -- SH/SZ/BJ
  industry TEXT,                  -- 所属行业(东财)
  list_date TEXT,                 -- 上市日期
  is_st INTEGER DEFAULT 0,        -- 是否ST
  total_mv REAL,                  -- 总市值(亿)
  circ_mv REAL,                   -- 流通市值(亿)
  updated_at TEXT
)`);

// 2. 日K线表
db.exec(`
CREATE TABLE IF NOT EXISTS daily_kline (
  code TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  open REAL, high REAL, low REAL, close REAL,
  volume REAL,                    -- 成交量(手)
  amount REAL,                    -- 成交额(元)
  amplitude REAL,                 -- 振幅%
  pct_chg REAL,                   -- 涨跌幅%
  chg REAL,                       -- 涨跌额
  turnover REAL,                  -- 换手率%
  PRIMARY KEY (code, trade_date)
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_kline_date ON daily_kline(trade_date)`);

// 3. 技术指标表（日频）
db.exec(`
CREATE TABLE IF NOT EXISTS technical_indicators (
  code TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  ma5 REAL, ma10 REAL, ma20 REAL, ma60 REAL, ma120 REAL, ma250 REAL,
  vol_ma5 REAL, vol_ma20 REAL,
  macd_dif REAL, macd_dea REAL, macd_bar REAL,
  rsi6 REAL, rsi14 REAL,
  kdj_k REAL, kdj_d REAL, kdj_j REAL,
  boll_upper REAL, boll_mid REAL, boll_lower REAL,
  PRIMARY KEY (code, trade_date)
)`);

// 4. 财务指标表（季度）
db.exec(`
CREATE TABLE IF NOT EXISTS financial_indicator (
  code TEXT NOT NULL,
  report_date TEXT NOT NULL,      -- 报告期 2024-12-31
  roe REAL,                       -- ROE%
  roa REAL,                       -- ROA%
  gross_margin REAL,              -- 毛利率%
  net_margin REAL,                -- 净利率%
  revenue REAL,                   -- 营业收入(亿)
  revenue_yoy REAL,               -- 营收同比%
  net_profit REAL,                -- 净利润(亿)
  net_profit_yoy REAL,            -- 净利润同比%
  debt_ratio REAL,                -- 资产负债率%
  current_ratio REAL,             -- 流动比率
  ocf REAL,                       -- 经营现金流(亿)
  ocf_per_share REAL,             -- 每股经营现金流
  eps REAL,                       -- 每股收益
  bps REAL,                       -- 每股净资产
  roic REAL,                      -- 投入资本回报率
  report_type TEXT,               -- 报告类型(年报/中报/一季报/三季报)
  PRIMARY KEY (code, report_date)
)`);

// 5. 估值指标表（日频）
db.exec(`
CREATE TABLE IF NOT EXISTS valuation (
  code TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  pe REAL,                        -- 市盈率(动态)
  pe_ttm REAL,                    -- 市盈率TTM
  pb REAL,                        -- 市净率
  ps REAL,                        -- 市销率
  ps_ttm REAL,
  dv_ratio REAL,                  -- 股息率%
  total_mv REAL,                  -- 总市值(亿)
  circ_mv REAL,                   -- 流通市值(亿)
  PRIMARY KEY (code, trade_date)
)`);

// 6. 资金流向表
db.exec(`
CREATE TABLE IF NOT EXISTS fund_flow (
  code TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  main_net_inflow REAL,           -- 主力净流入(万)
  main_net_pct REAL,              -- 主力净占比%
  super_large_net REAL,           -- 超大单净流入(万)
  large_net REAL,                 -- 大单净流入(万)
  medium_net REAL,                -- 中单净流入(万)
  small_net REAL,                 -- 小单净流入(万)
  north_net_inflow REAL,          -- 北向资金净流入(亿，全市场)
  PRIMARY KEY (code, trade_date)
)`);

// 7. 行业板块表
db.exec(`
CREATE TABLE IF NOT EXISTS sector_daily (
  sector_code TEXT NOT NULL,
  sector_name TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  change_pct REAL,                -- 涨跌幅%
  main_net_inflow REAL,           -- 主力净流入(亿)
  up_count INTEGER,               -- 上涨家数
  down_count INTEGER,             -- 下跌家数
  leader_code TEXT,               -- 领涨股代码
  leader_name TEXT,
  leader_pct REAL,                -- 领涨股涨幅
  PRIMARY KEY (sector_code, trade_date)
)`);

// 8. 评分结果表（每日）
db.exec(`
CREATE TABLE IF NOT EXISTS stock_score (
  code TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  strategy TEXT NOT NULL,         -- value / short / momentum
  name TEXT,                      -- 股票名称
  industry TEXT,                  -- 所属行业
  quality_score REAL,             -- 质量分(0-100)
  valuation_score REAL,           -- 估值分(0-100)
  technical_score REAL,           -- 技术分(0-100)
  fund_score REAL,                -- 资金分(0-100)
  sentiment_score REAL,           -- 情绪分(-100~+100, LLM辅助)
  crowding_score REAL,            -- 拥挤度(0-100，越高越拥挤)
  crowding_level TEXT,            -- cold/warm/hot/crowded/extreme
  total_score REAL,               -- 综合分(0-100)
  signal TEXT,                    -- buy/momentum_buy/sell/hold/watch/trim/exit
  current_price REAL,             -- 当前价格
  target_price REAL,              -- 目标价
  stop_loss REAL,                 -- 止损价
  position_pct REAL,              -- 建议仓位%
  reason TEXT,                    -- 理由JSON/文本
  quality_detail TEXT,            -- 质量因子明细JSON
  quality_latest REAL,            -- 最新质量分快照
  valuation_detail TEXT,          -- 估值因子明细JSON
  technical_detail TEXT,          -- 技术因子明细JSON
  pe REAL,                        -- PE
  PRIMARY KEY (code, trade_date, strategy)
)`);
// 给已有表加字段（如果不存在）
const stockScoreCols = ['name','industry','current_price','reason','quality_detail','quality_latest','valuation_detail','technical_detail','pe'];
for (const col of stockScoreCols) {
  try { db.exec(`ALTER TABLE stock_score ADD COLUMN ${col} ${col === 'pe' || col === 'current_price' || col === 'quality_latest' ? 'REAL' : 'TEXT'}`); } catch(e) {}
}
// 旧字段兼容
try { db.exec('ALTER TABLE stock_score ADD COLUMN crowding_score REAL'); } catch(e) {}
try { db.exec('ALTER TABLE stock_score ADD COLUMN crowding_level TEXT'); } catch(e) {}

// 9. 北向资金个股持仓
db.exec(`
CREATE TABLE IF NOT EXISTS north_hold (
  code TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  hold_shares REAL,               -- 持股数(万股)
  hold_market_cap REAL,           -- 持股市值(亿)
  hold_ratio REAL,                -- 持股占比%
  change_1d REAL,                 -- 1日持股变化(万股)
  change_5d REAL,                 -- 5日持股变化(万股)
  PRIMARY KEY (code, trade_date)
)`);

// 10. 新闻/公告情绪表（LLM处理后）
db.exec(`
CREATE TABLE IF NOT EXISTS news_sentiment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publish_time TEXT,
  source TEXT,
  title TEXT,
  content TEXT,
  related_codes TEXT,             -- JSON数组
  sentiment REAL,                 -- -1~+1
  impact_score REAL,              -- 1-5
  affected_sectors TEXT,          -- JSON数组
  summary TEXT,
  processed_at TEXT
)`);

// 11. 组合/持仓跟踪
db.exec(`
CREATE TABLE IF NOT EXISTS portfolio (
  code TEXT PRIMARY KEY,
  name TEXT,
  strategy TEXT,                  -- value/short
  buy_date TEXT,
  buy_price REAL,
  position_pct REAL,              -- 仓位%
  shares INTEGER,                 -- 持仓数量
  stop_loss REAL,
  target_price REAL,
  status TEXT DEFAULT 'holding'   -- holding/closed
)`);

// 12. 拥挤度评分表（量化动量跟踪）
db.exec(`
CREATE TABLE IF NOT EXISTS crowding_score (
  code TEXT NOT NULL,
  name TEXT,
  trade_date TEXT NOT NULL,
  stock_crowding_score REAL,      -- 个股拥挤度0-100
  sector_crowding_score REAL,     -- 板块拥挤度0-100
  combined_crowding_score REAL,   -- 综合拥挤度0-100
  level TEXT,                     -- cold/warm/hot/crowded/extreme
  action TEXT,                    -- accumulate/momentum_buy/hold/trim/exit
  momentum_bonus REAL,            -- 动量搭车加分(0-15)
  crowding_penalty REAL,          -- 拥挤惩罚分(0-25)
  factors_json TEXT,              -- 因子明细JSON
  PRIMARY KEY (code, trade_date)
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_crowding_date ON crowding_score(trade_date)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_crowding_level ON crowding_score(level)`);

// 13. 板块拥挤度表
db.exec(`
CREATE TABLE IF NOT EXISTS sector_crowding (
  sector TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  crowding_score REAL,
  level TEXT,
  stock_count INTEGER,
  up_ratio REAL,
  PRIMARY KEY (sector, trade_date)
)`);

// 14. 数据更新日志
db.exec(`
CREATE TABLE IF NOT EXISTS sync_log (
  table_name TEXT NOT NULL,
  last_sync TEXT NOT NULL,
  rows_count INTEGER,
  PRIMARY KEY (table_name)
)`);

// 14. 短线信号表
const hasShortSignals = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='short_signals'").get();
if (!hasShortSignals) {
db.exec(`
CREATE TABLE IF NOT EXISTS short_signals (
  code TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  close REAL,
  pct_chg REAL,
  short_score REAL,
  signal TEXT,
  position_pct REAL,
  stop_loss REAL,
  target_price REAL,
  reasons_json TEXT,
  risks_json TEXT,
  PRIMARY KEY (code, trade_date)
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_short_date ON short_signals(trade_date)`);
}

// 应用设置表（持久化用户配置）
db.exec(`CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT
)`);

console.log('✅ 数据库初始化完成');
module.exports = db;
