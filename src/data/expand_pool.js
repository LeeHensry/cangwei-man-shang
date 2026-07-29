/**
 * 股票池扩容到100只并同步数据
 */
const db = require('../data/db');
const tq = require('../data/tencent');
const { sleep } = require('../data/tencent');
const { getFinancialData } = require('../data/finance');

// 100只核心股票池（分类）
const STOCK_POOL = [
  // === 科技/AI/半导体/电子（20只 - 新质生产力主力）===
  '002415',  // 海康威视
  '601138',  // 工业富联
  '002230',  // 科大讯飞
  '688981',  // 中芯国际
  '002371',  // 北方华创
  '688256',  // 寒武纪
  '002241',  // 歌尔股份
  '002475',  // 立讯精密
  '688041',  // 海光信息
  '600588',  // 用友网络
  '688111',  // 金山办公
  '000725',  // 京东方A
  '603501',  // 韦尔股份
  '002049',  // 紫光国微
  '688008',  // 澜起科技
  '000977',  // 浪潮信息
  '300308',  // 中际旭创
  '300496',  // 中科创达
  '603160',  // 汇顶科技
  '300408',  // 三环集团
  '002236',  // 大华股份
  '688396',  // 华润微
  '002371',  // 北方华创(dup)

  // === 新能源/电动车（12只）===
  '300750',  // 宁德时代
  '002594',  // 比亚迪
  '601012',  // 隆基绿能
  '600089',  // 特变电工
  '300274',  // 阳光电源
  '002460',  // 赣锋锂业
  '300014',  // 亿纬锂能
  '601633',  // 长城汽车
  '000625',  // 长安汽车
  '600438',  // 通威股份
  '002129',  // TCL中环
  '002466',  // 天齐锂业

  // === 医药/医疗（14只）===
  '600276',  // 恒瑞医药
  '300760',  // 迈瑞医疗
  '603259',  // 药明康德
  '000661',  // 长春高新
  '300142',  // 沃森生物
  '002007',  // 华兰生物
  '000538',  // 云南白药
  '600436',  // 片仔癀
  '002821',  // 凯莱英
  '300347',  // 泰格医药
  '600196',  // 复星医药
  '600085',  // 同仁堂
  '300015',  // 爱尔眼科
  '300896',  // 爱美客

  // === 白酒/食品消费（15只）===
  '600519',  // 贵州茅台
  '000858',  // 五粮液
  '000568',  // 泸州老窖
  '600809',  // 山西汾酒
  '002304',  // 洋河股份
  '603369',  // 今世缘
  '600887',  // 伊利股份
  '603288',  // 海天味业
  '000651',  // 格力电器
  '000333',  // 美的集团
  '600690',  // 海尔智家
  '002714',  // 牧原股份
  '600597',  // 光明乳业
  '002507',  // 涪陵榨菜
  '600600',  // 青岛啤酒

  // === 高端制造/军工/工业（14只）===
  '600031',  // 三一重工
  '300124',  // 汇川技术
  '601100',  // 恒立液压
  '000338',  // 潍柴动力
  '600760',  // 中航沈飞
  '002050',  // 三花智控
  '601689',  // 拓普集团
  '002271',  // 东方雨虹
  '603290',  // 斯达半导
  '002352',  // 顺丰控股
  '600309',  // 万华化学
  '600089',  // 特变电工(duplicate check)
  '601766',  // 中国中车
  '000425',  // 徐工机械

  // === 互联网/传媒/平台（8只）===
  '300059',  // 东方财富
  '002027',  // 分众传媒
  '002555',  // 三七互娱
  '603444',  // 吉比特
  '600637',  // 东方明珠
  '002602',  // 世纪华通
  '002555',  // 三七互娱(dup)
  '603444',  // 吉比特(dup)

  // === 资源/能源/材料（10只）===
  '601899',  // 紫金矿业
  '601857',  // 中国石油
  '601088',  // 中国神华
  '601225',  // 陕西煤业
  '600346',  // 恒力石化
  '600547',  // 山东黄金
  '601600',  // 中国铝业
  '600019',  // 宝钢股份
  '601985',  // 中国核电
  '600028',  // 中国石化

  // === 金融（10只，降权后保留核心）===
  '600036',  // 招商银行
  '601318',  // 中国平安
  '601398',  // 工商银行
  '601288',  // 农业银行
  '600030',  // 中信证券
  '601628',  // 中国人寿
  '000001',  // 平安银行
  '601166',  // 兴业银行
  '601328',  // 交通银行
  '601601',  // 中国太保
  '600999',  // 招商证券

  // === 基建/交运/公用（6只，降权参考组）===
  '601668',  // 中国建筑
  '601390',  // 中国中铁
  '601006',  // 大秦铁路
  '600900',  // 长江电力
  '601919',  // 中远海控
  '600050',  // 中国联通

  // === 地产/建材（4只，困境组）===
  '000002',  // 万科A
  '600048',  // 保利发展
  '600585',  // 海螺水泥
  '600801',  // 华新水泥
];

// 去重
const codes = [...new Set(STOCK_POOL)];
console.log(`📊 股票池: ${codes.length} 只（去重后）`);

async function main() {
  const cmd = process.argv[2] || 'all';

  if (cmd === 'all' || cmd === 'info') {
    console.log('\n📋 同步股票基本行情...');
    const quotes = await tq.getQuickStockList(codes);
    console.log(`  获取到 ${quotes.length} 只股票行情`);
    
    const infoColumns = ['code','name','market','is_st','total_mv','circ_mv','updated_at'];
    const infoData = quotes.map(s => ({
      code: s.code, name: s.name, market: s.market,
      is_st: s.is_st, total_mv: s.total_mv, circ_mv: s.circ_mv, updated_at: s.updated_at,
    }));
    
    const placeholders = infoColumns.map(() => '?').join(',');
    const stmt = db.prepare(`INSERT OR REPLACE INTO stock_info (${infoColumns.join(',')}) VALUES (${placeholders})`);
    const insertMany = db.transaction((rows) => { for (const r of rows) stmt.run(...infoColumns.map(c => r[c] ?? null)); });
    insertMany(infoData);
    console.log('✅ 股票基本信息已更新');
    
    // 更新估值
    const today = new Date().toISOString().slice(0,10).replace(/-/g,'');
    const valData = quotes.filter(s => s.pe > 0).map(s => ({
      code: s.code, trade_date: today,
      pe: s.pe, pe_ttm: s.pe, pb: null, ps: null, ps_ttm: null,
      dv_ratio: null, total_mv: s.total_mv, circ_mv: s.circ_mv,
    }));
    const valStmt = db.prepare(`INSERT OR REPLACE INTO valuation
      (code, trade_date, pe, pe_ttm, pb, ps, ps_ttm, dv_ratio, total_mv, circ_mv)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const valInsert = db.transaction((rows) => { for (const r of rows) valStmt.run(
      r.code, r.trade_date, r.pe, r.pe_ttm, r.pb, r.ps, r.ps_ttm, r.dv_ratio, r.total_mv, r.circ_mv); });
    valInsert(valData);
    console.log(`✅ 估值数据已更新，${valData.length}只有效PE`);
  }

  if (cmd === 'all' || cmd === 'kline') {
    console.log('\n📈 同步历史K线（近3年数据）...');
    const existingCodes = db.prepare('SELECT DISTINCT code FROM daily_kline').all().map(r => r.code);
    const newCodes = codes.filter(c => !existingCodes.includes(c));
    const codesToSync = existingCodes.length > 0 ? newCodes : codes;
    console.log(`  需要新增K线: ${codesToSync.length} 只`);
    
    for (let i = 0; i < codesToSync.length; i++) {
      const code = codesToSync[i];
      const klines = await tq.getDailyKline(code, '2022-01-01', new Date().toISOString().slice(0,10));
      if (klines.length > 0) {
        const cols = ['code','trade_date','open','close','high','low','volume','amount','amplitude','pct_chg','chg','turnover'];
        const ph = cols.map(()=>'?').join(',');
        const st = db.prepare(`INSERT OR REPLACE INTO daily_kline (${cols.join(',')}) VALUES (${ph})`);
        const ins = db.transaction((rows)=>{ for(const r of rows) st.run(...cols.map(c=>r[c]??null)); });
        ins(klines);
      }
      if ((i+1) % 10 === 0) console.log(`  K线进度: ${i+1}/${codesToSync.length}`);
      await sleep(120);
    }
    console.log('✅ K线同步完成');
  }

  if (cmd === 'all' || cmd === 'finance') {
    console.log('\n💰 同步财务数据...');
    let success = 0;
    for (let i = 0; i < codes.length; i++) {
      const data = await getFinancialData(codes[i], 20);
      if (data.length > 0) {
        const cols = ['code','report_date','report_type','roe','roa','gross_margin','net_margin','revenue','revenue_yoy',
          'net_profit','net_profit_yoy','debt_ratio','current_ratio','ocf','eps','bps','ocf_per_share','roic'];
        const ph = cols.map(()=>'?').join(',');
        const st = db.prepare(`INSERT OR REPLACE INTO financial_indicator (${cols.join(',')}) VALUES (${ph})`);
        const ins = db.transaction((rows)=>{ for(const r of rows) st.run(...cols.map(c=>r[c]??null)); });
        ins(data);
        success++;
      }
      if ((i+1) % 20 === 0) console.log(`  财务进度: ${i+1}/${codes.length}`);
      await sleep(200);
    }
    console.log(`✅ 财务数据同步完成，${success}只成功`);
  }

  console.log('\n═══════════════════════════════════════');
  console.log('  扩容完成！股票池大小:', codes.length);
  console.log('═══════════════════════════════════════');
}

main().catch(console.error);
