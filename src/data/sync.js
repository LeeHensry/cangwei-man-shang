/**
 * 数据同步主脚本
 * 负责：初始化数据库 → 拉取股票列表 → 同步历史K线 → 更新技术指标
 */
const db = require('./db');
const tq = require('./tencent');
const dayjs = require('dayjs');

// ========== 辅助函数 ==========

// 批量插入或替换
function insertOrReplace(table, data, columns) {
  if (!data || data.length === 0) return 0;
  const placeholders = columns.map(() => '?').join(',');
  const colNames = columns.join(',');
  const stmt = db.prepare(`INSERT OR REPLACE INTO ${table} (${colNames}) VALUES (${placeholders})`);
  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      stmt.run(...columns.map(c => row[c] ?? null));
    }
  });
  insertMany(data);
  return data.length;
}

// 更新同步日志
function updateSyncLog(tableName, count) {
  db.prepare(`INSERT OR REPLACE INTO sync_log (table_name, last_sync, rows_count) VALUES (?, ?, ?)`)
    .run(tableName, dayjs().format('YYYY-MM-DD HH:mm:ss'), count);
}

// ========== 同步函数 ==========

/**
 * 同步股票基本信息
 * 注意：全量扫描5000+代码比较慢（约10分钟），首次使用建议用重点股票池
 */
async function syncStockList(options = {}) {
  console.log('📋 开始同步股票列表...');
  
  let stocks;
  if (options.quick && options.codes) {
    // 快速模式：只同步指定股票
    stocks = await tq.getQuickStockList(options.codes);
  } else {
    // 全量模式
    stocks = await tq.getStockList();
  }
  
  const columns = ['code', 'name', 'market', 'is_st', 'total_mv', 'circ_mv', 'pe', 'updated_at', 'pct_chg', 'close'];
  // 先插入stock_info
  const stockInfoData = stocks.map(s => ({
    code: s.code,
    name: s.name,
    market: s.market,
    is_st: s.is_st,
    total_mv: s.total_mv,
    circ_mv: s.circ_mv,
    pe: s.pe,
    updated_at: s.updated_at,
    pct_chg: s.pct_chg,
    close: s.close,
  }));
  
  // stock_info表结构适配
  const infoColumns = ['code', 'name', 'market', 'is_st', 'total_mv', 'circ_mv', 'updated_at'];
  const infoData = stocks.map(s => ({
    code: s.code,
    name: s.name,
    market: s.market,
    is_st: s.is_st,
    total_mv: s.total_mv,
    circ_mv: s.circ_mv,
    updated_at: s.updated_at,
  }));
  
  const count = insertOrReplace('stock_info', infoData, infoColumns);
  
  // 同时插入当日行情到daily_kline
  const today = dayjs().format('YYYYMMDD');
  const klineData = stocks.map(s => ({
    code: s.code,
    trade_date: today,
    open: s.open,
    high: s.high,
    low: s.low,
    close: s.close,
    volume: s.volume,
    amount: s.amount ? s.amount * 10000 : null, // 万→元
    pct_chg: s.pct_chg,
    chg: s.chg,
    turnover: s.turnover,
  })).filter(s => s.close > 0);
  
  if (options.updateKline) {
    insertOrReplace('daily_kline', klineData, ['code', 'trade_date', 'open', 'high', 'low', 'close', 'volume', 'amount', 'pct_chg', 'chg', 'turnover']);
  }
  
  updateSyncLog('stock_info', count);
  console.log(`✅ 股票列表同步完成，共 ${count} 只`);
  return stocks;
}

/**
 * 同步指数行情
 */
async function syncIndices() {
  console.log('📊 同步指数行情...');
  const indices = await tq.getIndexQuotes();
  console.log(`  ${indices.map(i => i.name + ':' + i.close + '(' + i.pct_chg + '%)').join(' | ')}`);
  return indices;
}

/**
 * 同步行业板块
 */
async function syncSectors() {
  console.log('🏭 同步行业板块...');
  const sectors = await tq.getSectorList();
  const today = dayjs().format('YYYYMMDD');
  const data = sectors.map(s => ({ ...s, trade_date: today }));
  const columns = ['sector_code', 'sector_name', 'change_pct', 'up_count', 'down_count', 'leader_code', 'leader_name', 'leader_pct', 'trade_date', 'stock_count', 'volume', 'amount'];
  // 适配列名
  const rows = data.map(s => ({
    sector_code: s.sector_code,
    sector_name: s.sector_name,
    trade_date: s.trade_date,
    change_pct: s.change_pct,
    main_net_inflow: null,
    up_count: null,
    down_count: null,
    leader_code: s.leader_code,
    leader_name: s.leader_name,
    leader_pct: s.leader_pct,
  }));
  insertOrReplace('sector_daily', rows, ['sector_code', 'sector_name', 'trade_date', 'change_pct', 'main_net_inflow', 'up_count', 'down_count', 'leader_code', 'leader_name', 'leader_pct']);
  updateSyncLog('sector_daily', sectors.length);
  console.log(`✅ 板块同步完成，共 ${sectors.length} 个行业`);
  return sectors;
}

/**
 * 同步历史K线（核心功能）
 * @param {string[]} codes 股票代码列表
 * @param {string} startDate 起始日期 YYYYMMDD
 */
async function syncDailyKlines(codes, startDate = '20160101') {
  console.log(`📈 开始同步K线数据，${codes.length}只股票，起始日期: ${startDate}`);
  
  const endDate = dayjs().format('YYYYMMDD');
  let total = 0;
  let success = 0;
  let fail = 0;
  
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    try {
      const klines = await tq.getDailyKline(code,
        dayjs(startDate).format('YYYY-MM-DD'),
        dayjs(endDate).format('YYYY-MM-DD'));
      
      if (klines.length > 0) {
        insertOrReplace('daily_kline', klines,
          ['code', 'trade_date', 'open', 'close', 'high', 'low', 'volume', 'amount', 'amplitude', 'pct_chg', 'chg', 'turnover']);
        total += klines.length;
        success++;
      }
      
      if ((i + 1) % 20 === 0 || i === codes.length - 1) {
        console.log(`  进度: ${i + 1}/${codes.length} | 成功: ${success} | 失败: ${fail} | K线总数: ${total}`);
      }
      
      await tq.sleep(120);
    } catch (e) {
      fail++;
      console.error(`  ❌ ${code} 失败:`, e.message);
    }
  }
  
  updateSyncLog('daily_kline', total);
  console.log(`✅ K线同步完成: ${success}只成功, ${fail}只失败, 共${total}条K线`);
  return { success, fail, total };
}

/**
 * 同步估值数据（当日快照）
 */
async function syncValuation(stocks) {
  console.log('💰 同步估值数据...');
  const today = dayjs().format('YYYYMMDD');
  const data = stocks.map(s => ({
    code: s.code,
    trade_date: today,
    pe: s.pe,
    pe_ttm: s.pe,  // 腾讯快照只有一个PE，后续有更好接口再细化
    pb: s.pb,
    total_mv: s.total_mv,
    circ_mv: s.circ_mv,
    dv_ratio: null,
    ps: null,
    ps_ttm: null,
  })).filter(s => s.pe && s.pe > 0);
  
  insertOrReplace('valuation', data, ['code', 'trade_date', 'pe', 'pe_ttm', 'pb', 'ps', 'ps_ttm', 'dv_ratio', 'total_mv', 'circ_mv']);
  updateSyncLog('valuation', data.length);
  console.log(`✅ 估值同步完成，${data.length}只有效PE数据`);
}

// ========== 主入口 ==========

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'init';
  
  console.log('═══════════════════════════════════════');
  console.log('  A股智能决策系统 - 数据同步工具');
  console.log('  时间:', dayjs().format('YYYY-MM-DD HH:mm:ss'));
  console.log('═══════════════════════════════════════');
  
  switch (cmd) {
    case 'init': {
      // 初始化：指数+板块+重点股票K线
      console.log('\n🚀 首次初始化，先拉取市场概览...');
      await syncIndices();
      await syncSectors();
      
      // 先用核心指数成分股作为首批
      // 沪深300代表性蓝筹股（部分，后续扩展）
      const coreStocks = [
        '600519',  // 贵州茅台
        '601398',  // 工商银行
        '601318',  // 中国平安
        '600036',  // 招商银行
        '000858',  // 五粮液
        '600900',  // 长江电力
        '000333',  // 美的集团
        '601012',  // 隆基绿能
        '300750',  // 宁德时代
        '600276',  // 恒瑞医药
        '601888',  // 中国中免
        '000001',  // 平安银行
        '600030',  // 中信证券
        '601857',  // 中国石油
        '601088',  // 中国神华
        '000651',  // 格力电器
        '002594',  // 比亚迪
        '600309',  // 万华化学
        '601166',  // 兴业银行
        '600809',  // 山西汾酒
        '002475',  // 立讯精密
        '601899',  // 紫金矿业
        '600887',  // 伊利股份
        '600031',  // 三一重工
        '000568',  // 泸州老窖
        '600000',  // 浦发银行
        '601288',  // 农业银行
        '601328',  // 交通银行
        '601988',  // 中国银行
        '000002',  // 万科A
        '600048',  // 保利发展
        '601668',  // 中国建筑
        '601390',  // 中国中铁
        '600585',  // 海螺水泥
        '002415',  // 海康威视
        '300059',  // 东方财富
        '002714',  // 牧原股份
        '600346',  // 恒力石化
        '601225',  // 陕西煤业
        '000725',  // 京东方A
        '002352',  // 顺丰控股
        '601628',  // 中国人寿
        '600050',  // 中国联通
        '600028',  // 中国石化
        '601919',  // 中远海控
        '600089',  // 特变电工
        '601138',  // 工业富联
        '603259',  // 药明康德
        '600436',  // 片仔癀
        '601006',  // 大秦铁路
      ];
      
      console.log('\n📊 快速同步重点股票行情...');
      const quickStocks = await tq.getQuickStockList(coreStocks);
      console.log(`获取到 ${quickStocks.length} 只股票行情`);
      
      // 插入股票信息
      const infoData = quickStocks.map(s => ({
        code: s.code, name: s.name, market: s.market,
        is_st: s.is_st, total_mv: s.total_mv, circ_mv: s.circ_mv, updated_at: s.updated_at,
      }));
      insertOrReplace('stock_info', infoData, ['code', 'name', 'market', 'is_st', 'total_mv', 'circ_mv', 'updated_at']);
      
      // 同步估值
      await syncValuation(quickStocks);
      
      // 同步历史K线（近10年，但腾讯单次返回约600条约2.5年，会自动翻页）
      console.log('\n📈 同步历史K线（2016年至今，约10年数据）...');
      await syncDailyKlines(coreStocks, '20160101');
      
      break;
    }
    
    case 'daily': {
      // 每日更新
      console.log('\n🔄 每日增量更新...');
      await syncIndices();
      await syncSectors();
      
      // 获取已入库的股票列表
      const existingCodes = db.prepare('SELECT code FROM stock_info').all().map(r => r.code);
      if (existingCodes.length === 0) {
        console.log('数据库为空，请先执行 init');
        break;
      }
      
      // 更新行情
      const stocks = await tq.getQuickStockList(existingCodes);
      const infoData = stocks.map(s => ({
        code: s.code, name: s.name, market: s.market,
        is_st: s.is_st, total_mv: s.total_mv, circ_mv: s.circ_mv, updated_at: s.updated_at,
      }));
      insertOrReplace('stock_info', infoData, ['code', 'name', 'market', 'is_st', 'total_mv', 'circ_mv', 'updated_at']);
      await syncValuation(stocks);
      
      // 增量K线：只拉最近一周的数据
      const oneWeekAgo = dayjs().subtract(7, 'day').format('YYYYMMDD');
      await syncDailyKlines(existingCodes, oneWeekAgo);
      
      break;
    }
    
    case 'klines': {
      // 单独同步指定股票K线
      const codes = args.slice(1);
      if (codes.length === 0) {
        console.log('用法: node sync.js klines 600519 000001 ...');
        break;
      }
      await syncDailyKlines(codes, args.includes('--all') ? '20160101' : dayjs().subtract(1, 'year').format('YYYYMMDD'));
      break;
    }
    
    case 'indices':
      await syncIndices();
      await syncSectors();
      break;
      
    default:
      console.log('用法:');
      console.log('  node sync.js init        - 首次初始化（重点股票池）');
      console.log('  node sync.js daily       - 每日增量更新');
      console.log('  node sync.js klines 代码... - 同步指定股票K线');
      console.log('  node sync.js indices     - 只更新指数和板块');
  }
  
  console.log('\n═══════════════════════════════════════');
  console.log('  同步完成！');
  console.log('═══════════════════════════════════════');
}

main().catch(console.error);
