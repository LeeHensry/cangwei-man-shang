/**
 * 价值投资评分引擎 v2
 * 优化点：
 * 1. 更精细的行业分类（新质生产力/核心消费/医药/金融/周期/基建/公用事业等）
 * 2. 新经济产业加成（科技/新能源/半导体/AI/高端制造）
 * 3. 传统老登股降权（银行/基建/石化/钢铁/煤炭/铁路/地产等低ROE+低成长）
 * 4. 成长性权重提升，质量评分更看重ROIC和成长持续性
 */
const { dbGet, dbAll, dbRun, dbBatch } = require('../data/db');
const { getFinancialData } = require('../data/finance');
const { getStockFlowSignals } = require('../data/money_flow');
const dayjs = require('dayjs');

// ========== 行业分类系统 ==========

// 行业分类映射（按代码+名称双维度）
const INDUSTRY_GROUPS = {
  // === 新质生产力（加分，成长权重更高）===
  tech: {
    name: '科技/AI/半导体',
    codes: ['002415','601138','688981','002230','300750','002594','603259','300014','300059','688256','688041','300274','002371','600588','688111','688008'],
    keywords: ['科技','半导体','芯片','软件','人工智能','AI','云计算','数据','电子','信息技术'],
    peStandard: 'growth',  // PE标准更宽松
    qualityBonus: 5,       // 质量分加成
    growthWeight: 1.3,     // 成长性权重放大
    valueWeight: 0.7,      // 估值权重缩小（允许适度高PE）
  },
  newEnergy: {
    name: '新能源/电动车',
    codes: ['300750','002594','601012','600089','002129','600438','300274','002460','300014','601633','000625','600104'],
    keywords: ['新能源','锂电','光伏','电动车','比亚迪','宁德','隆基','风电','储能','太阳能'],
    peStandard: 'growth',
    qualityBonus: 5,
    growthWeight: 1.3,
    valueWeight: 0.75,
  },
  highEndMfg: {
    name: '高端制造/工业',
    codes: ['600031','600089','300124','601100','000338','600760','002241','002050','000425','603899','600585','601766','002475','603160'],
    keywords: ['高端制造','智能制造','工业','机器人','自动化','军工','航空','航天','精密','立讯'],
    peStandard: 'general',
    qualityBonus: 2,
    growthWeight: 1.1,
    valueWeight: 0.9,
  },
  medicine: {
    name: '医药/医疗',
    codes: ['600276','300760','603259','000661','300142','002007','000538','600436','002821','300347','600196','600085'],
    keywords: ['医药','医疗','生物','制药','健康','药明','恒瑞','片仔癀','迈瑞'],
    peStandard: 'growth',
    qualityBonus: 3,
    growthWeight: 1.1,
    valueWeight: 0.85,
  },

  // === 核心消费（中性偏高，质量权重高）===
  consumer: {
    name: '消费/食品饮料/家电',
    codes: ['600519','000858','000568','600809','002304','600887','000651','000333','600690','002714','000725','603288','000568','603369','600597','002507'],
    keywords: ['消费','食品','白酒','啤酒','乳业','牛奶','家电','美的','格力','茅台','五粮液','牧原','肉','养殖','饮料','榨菜','酱油'],
    peStandard: 'consumer',
    qualityBonus: 2,
    growthWeight: 0.9,
    valueWeight: 1.0,
  },

  // === 资源/能源（中性，周期属性）===
  resources: {
    name: '资源/矿业/能源',
    codes: ['601899','601857','600028','601088','601225','600188','600346','601225','600547','601600','600019','000898','600005'],
    keywords: ['矿业','黄金','铜','石油','石化','煤炭','钢铁','有色','紫金','神华','石油','煤矿','稀土','锂矿'],
    peStandard: 'cyclical',
    qualityBonus: 0,
    growthWeight: 0.8,
    valueWeight: 1.0,
    cyclicalWarning: true, // 周期股低PE可能是顶部
  },

  // === 金融（降权，老登股）===
  finance: {
    name: '金融/银行/保险/券商',
    codes: ['601398','601288','601988','601328','600036','601166','600000','000001','601318','601628','600030','000776','600837','601601','600999'],
    keywords: ['银行','保险','证券','券商','金融'],
    peStandard: 'finance',
    qualityBonus: -8,   // 老登股惩罚
    growthWeight: 0.5,  // 成长性不重要
    valueWeight: 1.3,   // 估值更重要（但低PE不给高分）
    oldmanStock: true,
  },

  // === 基建/建筑/交运（老登股，重度降权）===
  infrastructure: {
    name: '基建/建筑/交运/公用事业',
    codes: ['601668','601390','601186','601800','601669','601006','600029','601111','600009','601333','600886','000089','600018','601766'],
    keywords: ['建筑','中铁','中建','中铁建','交建','铁路','大秦','航空','机场','港口','高速','电力','水电','核电','长江电力','中远','海运'],
    peStandard: 'infrastructure',
    qualityBonus: -12,   // 老登股重罚
    growthWeight: 0.4,
    valueWeight: 1.5,
    oldmanStock: true,
  },

  // === 地产（重度降权，夕阳行业）===
  realestate: {
    name: '房地产/建筑建材',
    codes: ['000002','600048','600383','001979','600340','600585','600801','000786'],
    keywords: ['地产','房地产','万科','保利','水泥','建材','海螺','置业','发展','碧桂园'],
    peStandard: 'distressed',
    qualityBonus: -15,
    growthWeight: 0.3,
    valueWeight: 1.8,
    oldmanStock: true,
    distressed: true,
  },

  // === 互联网/平台/传媒 ===
  internet: {
    name: '互联网/传媒/平台',
    codes: ['002027','300059','002602','002555','603444','600637','600959','300413'],
    keywords: ['互联网','平台','传媒','游戏','电商','社交','视频'],
    peStandard: 'growth',
    qualityBonus: 3,
    growthWeight: 1.2,
    valueWeight: 0.8,
  },
};

/**
 * 识别股票所属行业
 * @returns {object} {group, groupKey, isOldman, isNewEconomy}
 */
function classifyIndustry(code, name) {
  if (!name) name = '';
  
  // 硬编码修复分类
  const hardCode = {
    '300750': 'newEnergy',   // 宁德时代
    '002594': 'newEnergy',   // 比亚迪
    '601012': 'newEnergy',   // 隆基绿能
    '600089': 'newEnergy',   // 特变电工
    '300274': 'newEnergy',   // 阳光电源
    '002460': 'newEnergy',   // 赣锋锂业
    '300014': 'newEnergy',   // 亿纬锂能
    '600438': 'newEnergy',   // 通威股份
    '002466': 'newEnergy',   // 天齐锂业
    '002129': 'newEnergy',   // TCL中环
    '601633': 'newEnergy',   // 长城汽车
    '000625': 'newEnergy',   // 长安汽车
    '601919': 'resources',   // 中远海控（航运周期）
    '002352': 'consumer',    // 顺丰（消费物流）
    '600309': 'resources',   // 万华化学（化工周期）
    '600900': 'resources',   // 长江电力（优质公用但不算老登）
    '601985': 'resources',   // 中国核电
    '300059': 'internet',    // 东方财富（互联网券商）
    '601600': 'resources',   // 中国铝业
    '600547': 'resources',   // 山东黄金
    '688981': 'tech',        // 中芯国际
  };
  if (hardCode[code]) {
    const key = hardCode[code];
    const group = INDUSTRY_GROUPS[key];
    const newEcon = ['tech','newEnergy','highEndMfg','medicine','internet'].includes(key);
    return {
      groupKey: key,
      group,
      isOldman: group.oldmanStock || false,
      isNewEconomy: newEcon,
      isDistressed: group.distressed || false,
    };
  }
  
  for (const [key, group] of Object.entries(INDUSTRY_GROUPS)) {
    if (group.codes.includes(code)) {
      return {
        groupKey: key,
        group,
        isOldman: group.oldmanStock || false,
        isNewEconomy: ['tech', 'newEnergy', 'highEndMfg', 'medicine', 'internet'].includes(key),
        isDistressed: group.distressed || false,
      };
    }
  }
  // 按名称关键词匹配
  for (const [key, group] of Object.entries(INDUSTRY_GROUPS)) {
    for (const kw of (group.keywords || [])) {
      if (name.includes(kw)) {
        return {
          groupKey: key,
          group,
          isOldman: group.oldmanStock || false,
          isNewEconomy: ['tech', 'newEnergy', 'highEndMfg', 'medicine', 'internet'].includes(key),
          isDistressed: group.distressed || false,
        };
      }
    }
  }
  // 默认：通用
  return {
    groupKey: 'general',
    group: {
      name: '通用',
      peStandard: 'general',
      qualityBonus: 0,
      growthWeight: 1.0,
      valueWeight: 1.0,
    },
    isOldman: false,
    isNewEconomy: false,
    isDistressed: false,
  };
}

// ========== 辅助函数 ==========
function clamp(val, min, max) {
  if (val === null || val === undefined || isNaN(val)) return null;
  return Math.max(min, Math.min(max, val));
}

// ========== 财务数据同步 ==========
async function syncFinancialData(code) {
  const data = await getFinancialData(code, 20);
  if (data.length === 0) return false;
  
  const columns = ['code', 'report_date', 'roe', 'roa', 'gross_margin', 'net_margin',
    'revenue', 'revenue_yoy', 'net_profit', 'net_profit_yoy', 'debt_ratio',
    'current_ratio', 'ocf', 'eps', 'bps', 'ocf_per_share', 'roic', 'report_type'];
  
  const stmts = data.map(r => ({
    sql: `INSERT OR REPLACE INTO financial_indicator (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`,
    args: columns.map(c => r[c] ?? null)
  }));
  
  for (let i = 0; i < stmts.length; i += 200) {
    await dbBatch(stmts.slice(i, i + 200));
  }
  return true;
}

// ========== 质量评分 v2 ==========
async function calcQualityScore(code) {
  const finData = await dbAll(`
    SELECT * FROM financial_indicator WHERE code = ? ORDER BY report_date DESC LIMIT 12
  `, [code]);
  
  // 财务数据不足时返回低分(没有财务数据无法判断质量，不能给50分默认值混在好公司里)
  if (finData.length < 2) {
    return { score: 30, method: 'no_financial_data', signals: ['⚠️ 无财务数据，质量分低'], breakdown: { profit: 0, growth: 0, health: 10, extra: 20 } };
  }
  
  const stockInfo = await dbGet('SELECT name, total_mv FROM stock_info WHERE code = ?', [code]);
  const name = stockInfo?.name || '';
  const industry = classifyIndustry(code, name);
  
  const annualReports = finData.filter(r => r.report_type && r.report_type.includes('年报'));
  const latest = finData[0];
  
  // 动态权重基于行业
  const gw = industry.group.growthWeight || 1.0;
  const bonus = industry.group.qualityBonus || 0;
  
  // ---- 盈利能力（满分30，行业权重调整）----
  let profitScore = 0;
  
  const roeAnnual = annualReports.length > 0 ? annualReports[0].roe : (latest.roe || 0);
  // ROE: >20满分，<5零分（银行/保险ROE普遍低但有杠杆，标准放宽）
  if (industry.groupKey === 'finance') {
    if (roeAnnual >= 15) profitScore += 15;
    else if (roeAnnual >= 12) profitScore += 12;
    else if (roeAnnual >= 10) profitScore += 9;
    else if (roeAnnual >= 7) profitScore += 5;
    else if (roeAnnual >= 4) profitScore += 2;
  } else {
    if (roeAnnual >= 20) profitScore += 15;
    else if (roeAnnual >= 15) profitScore += 12;
    else if (roeAnnual >= 12) profitScore += 9;
    else if (roeAnnual >= 8) profitScore += 6;
    else if (roeAnnual >= 5) profitScore += 3;
  }
  
  // ROE稳定性 (0-5分)
  if (annualReports.length >= 2) {
    const roes = annualReports.slice(0, 3).map(r => r.roe || 0);
    const roeStd = Math.sqrt(roes.reduce((s, v) => s + (v - roes.reduce((a,b)=>a+b)/roes.length)**2, 0) / roes.length);
    if (roes.every(r => r > (industry.groupKey === 'finance' ? 8 : 15))) profitScore += 5;
    else if (roes.every(r => r > (industry.groupKey === 'finance' ? 5 : 10))) profitScore += 3;
    else if (roes.every(r => r > (industry.groupKey === 'finance' ? 3 : 5))) profitScore += 1;
  }
  
  // 毛利率 (0-5分): 新经济更高权重
  const gm = latest.gross_margin || 0;
  if (gm >= 50) profitScore += 5;
  else if (gm >= 30) profitScore += 4;
  else if (gm >= 20) profitScore += 3;
  else if (gm >= 10) profitScore += 1;
  
  // 净利率 (0-5分)
  const nm = latest.net_margin || 0;
  if (nm >= 25) profitScore += 5;
  else if (nm >= 15) profitScore += 4;
  else if (nm >= 8) profitScore += 2;
  else if (nm >= 3) profitScore += 1;
  
  // ---- 成长性（满分25，新经济权重×1.3，老登×0.3~0.5）----
  let growthScore = 0;
  const baseGrowthMax = Math.round(25 * gw);
  
  const yoy = annualReports.length > 0 ? annualReports[0] : latest;
  const revYoY = yoy.revenue_yoy || 0;
  const npYoY = yoy.net_profit_yoy || 0;
  
  // 营收增速（满分10分 × gw）
  const revMax = Math.round(10 * gw);
  if (revYoY >= 20) growthScore += revMax;
  else if (revYoY >= 10) growthScore += Math.round(revMax * 0.8);
  else if (revYoY >= 5) growthScore += Math.round(revMax * 0.5);
  else if (revYoY >= 0) growthScore += Math.round(revMax * 0.3);
  else if (revYoY >= -10) growthScore += Math.round(revMax * 0.1);
  
  // 净利润增速（满分10分 × gw）
  const npMax = Math.round(10 * gw);
  if (npYoY >= 25) growthScore += npMax;
  else if (npYoY >= 15) growthScore += Math.round(npMax * 0.8);
  else if (npYoY >= 10) growthScore += Math.round(npMax * 0.6);
  else if (npYoY >= 0) growthScore += Math.round(npMax * 0.3);
  else if (npYoY >= -15) growthScore += Math.round(npMax * 0.1);
  
  // 成长持续性 (0-5分)
  if (annualReports.length >= 2) {
    const revYoYs = annualReports.slice(0, 3).map(r => r.revenue_yoy || 0);
    const npYoYs = annualReports.slice(0, 3).map(r => r.net_profit_yoy || 0);
    const positiveCount = revYoYs.filter(v => v > 0).length + npYoYs.filter(v => v > 0).length;
    growthScore += Math.round(positiveCount / 6 * 5);
  }
  growthScore = Math.min(baseGrowthMax, growthScore);
  
  // ---- 财务健康（满分25）----
  let healthScore = 0;
  
  // 资产负债率（金融/地产/基建放宽）
  const dr = latest.debt_ratio || 50;
  if (industry.groupKey === 'finance') {
    healthScore += 5; // 银行天然高负债，给固定分
  } else if (industry.groupKey === 'realestate') {
    if (dr <= 60) healthScore += 8;
    else if (dr <= 75) healthScore += 4;
    else if (dr <= 85) healthScore += 1;
  } else {
    if (dr <= 30) healthScore += 10;
    else if (dr <= 45) healthScore += 8;
    else if (dr <= 60) healthScore += 5;
    else if (dr <= 75) healthScore += 2;
  }
  
  // 流动比率
  const cr = latest.current_ratio || 1;
  if (industry.groupKey === 'finance') {
    healthScore += 3;
  } else {
    if (cr >= 2) healthScore += 5;
    else if (cr >= 1.5) healthScore += 4;
    else if (cr >= 1) healthScore += 2;
    else if (cr >= 0.8) healthScore += 1;
  }
  
  // 经营现金流/净利润
  const ocfNpRatio = latest.ocf && latest.net_profit && latest.net_profit > 0
    ? latest.ocf / latest.net_profit : 0;
  if (ocfNpRatio >= 1) healthScore += 10;
  else if (ocfNpRatio >= 0.8) healthScore += 8;
  else if (ocfNpRatio >= 0.5) healthScore += 5;
  else if (ocfNpRatio >= 0.2) healthScore += 2;
  else if (ocfNpRatio > 0) healthScore += 1;
  
  // ---- 额外加分/减分（满分20 + 行业bonus）----
  let extraScore = 0;
  
  // ROIC (0-10分) — 真赚钱能力
  const roic = latest.roic || 0;
  if (roic >= 15) extraScore += 10;
  else if (roic >= 10) extraScore += 7;
  else if (roic >= 6) extraScore += 4;
  else if (roic >= 3) extraScore += 2;
  
  // 市值规模（流动性好的大票加分，小票减分）
  const mv = stockInfo?.total_mv || 0;
  if (mv >= 5000) extraScore += 5;
  else if (mv >= 1000) extraScore += 4;
  else if (mv >= 300) extraScore += 2;
  else if (mv >= 100) extraScore += 1;
  
  // 行业加成/惩罚
  extraScore += bonus;
  
  // 老登股额外警告：如果ROE逐年下滑
  if (industry.isOldman && annualReports.length >= 2) {
    const roeTrend = (annualReports[0].roe || 0) - (annualReports[annualReports.length - 1].roe || 0);
    if (roeTrend < -2) extraScore -= 5; // ROE下滑扣分
  }
  
  // 成长股加速度加分：最近一期增速>上期
  if (industry.isNewEconomy && finData.length >= 5) {
    const recentYoY = finData[0].net_profit_yoy || 0;
    const prevYoY = finData[4]?.net_profit_yoy || 0;
    if (recentYoY > prevYoY + 5) extraScore += 3; // 加速成长
  }
  
  const totalQuality = Math.max(0, Math.min(100, profitScore + growthScore + healthScore + extraScore));
  
  return {
    score: totalQuality,
    industry: industry.group.name,
    industryKey: industry.groupKey,
    isOldman: industry.isOldman,
    isNewEconomy: industry.isNewEconomy,
    breakdown: {
      profit: profitScore,
      growth: growthScore,
      health: healthScore,
      extra: extraScore,
    },
    latest: {
      roe: latest.roe,
      gross_margin: latest.gross_margin,
      net_margin: latest.net_margin,
      debt_ratio: latest.debt_ratio,
      revenue_yoy: yoy.revenue_yoy,
      net_profit_yoy: yoy.net_profit_yoy,
      roic: latest.roic,
      ocf_np_ratio: latest.ocf && latest.net_profit ? +(latest.ocf / latest.net_profit).toFixed(2) : null,
    }
  };
}

// ========== 估值评分 v2 ==========
async function calcValuationScore(code) {
  const latestVal = await dbGet(`
    SELECT pe, pe_ttm, pb, total_mv FROM valuation
    WHERE code = ? ORDER BY trade_date DESC LIMIT 1
  `, [code]);
  
  const stockInfo = await dbGet('SELECT name FROM stock_info WHERE code = ?', [code]);
  const name = stockInfo?.name || '';
  const industry = classifyIndustry(code, name);
  
  if (!latestVal || !latestVal.pe || latestVal.pe <= 0) {
    return estimateValuationFromPrice(code);
  }
  
  const currentPE = latestVal.pe;
  
  // ---- PE绝对值评分（满分60，行业适配）----
  let peAbsScore = 0;
  const ps = industry.group.peStandard;
  
  if (ps === 'finance') {
    // 银行/保险：PE<5极低，5-7合理，>10偏高
    if (currentPE < 4) peAbsScore = 50;
    else if (currentPE < 5) peAbsScore = 45;
    else if (currentPE < 6) peAbsScore = 38;
    else if (currentPE < 7) peAbsScore = 28;
    else if (currentPE < 8) peAbsScore = 20;
    else if (currentPE < 10) peAbsScore = 10;
    else peAbsScore = 3;
  } else if (ps === 'distressed') {
    // 地产/困境行业：PE极不稳定，超低PE不给高分
    if (currentPE < 5) peAbsScore = 20;
    else if (currentPE < 8) peAbsScore = 15;
    else if (currentPE > 100) peAbsScore = 5;
    else peAbsScore = 10;
  } else if (ps === 'cyclical') {
    // 周期股：低PE可能是周期顶部（业绩最好时PE最低），中等PE更安全
    if (currentPE < 8) peAbsScore = 30; // 低PE不一定是好事
    else if (currentPE < 12) peAbsScore = 45;
    else if (currentPE < 18) peAbsScore = 35;
    else if (currentPE < 25) peAbsScore = 20;
    else peAbsScore = 8;
  } else if (ps === 'consumer') {
    // 消费/白酒：PE20-30合理，<20低估，>40高估
    if (currentPE < 15) peAbsScore = 58;
    else if (currentPE < 20) peAbsScore = 50;
    else if (currentPE < 25) peAbsScore = 40;
    else if (currentPE < 30) peAbsScore = 28;
    else if (currentPE < 40) peAbsScore = 15;
    else peAbsScore = 3;
  } else if (ps === 'growth') {
    // 科技/成长：PE<25合理，25-40可接受，>60偏高
    if (currentPE < 20) peAbsScore = 55;
    else if (currentPE < 30) peAbsScore = 48;
    else if (currentPE < 45) peAbsScore = 35;
    else if (currentPE < 60) peAbsScore = 18;
    else peAbsScore = 3;
  } else if (ps === 'infrastructure') {
    // 基建/公用事业：PE<10可接受，但成长性不足，上限压低
    if (currentPE < 8) peAbsScore = 40;
    else if (currentPE < 12) peAbsScore = 30;
    else if (currentPE < 18) peAbsScore = 18;
    else peAbsScore = 5;
  } else {
    // 通用标准
    if (currentPE < 6) peAbsScore = 55;
    else if (currentPE < 10) peAbsScore = 48;
    else if (currentPE < 12) peAbsScore = 42;
    else if (currentPE < 15) peAbsScore = 35;
    else if (currentPE < 20) peAbsScore = 25;
    else if (currentPE < 30) peAbsScore = 15;
    else if (currentPE < 50) peAbsScore = 5;
    else peAbsScore = 1;
  }
  
  if (currentPE > 200) peAbsScore = 2;
  
  // ---- 历史价格百分位（满分40，行业权重调整）----
  const vw = industry.group.valueWeight || 1.0;
  const klines = await dbAll(`
    SELECT close FROM daily_kline WHERE code = ? ORDER BY trade_date DESC LIMIT 520
  `, [code]);
  
  let priceScore = 20;
  let pricePercentile = null;
  
  if (klines.length >= 120) {
    const closes = klines.map(k => k.close);
    const current = closes[0];
    const belowCount = closes.filter(c => c >= current).length;
    pricePercentile = Math.round(belowCount / closes.length * 100);
    const rawPriceScore = Math.round(Math.max(0, Math.min(40, 40 * (100 - pricePercentile) / 100)));
    priceScore = Math.round(rawPriceScore * vw);
  }
  
  const totalScore = Math.min(100, peAbsScore + priceScore);
  
  return {
    score: totalScore,
    current_pe: +currentPE.toFixed(1),
    pe_abs_score: peAbsScore,
    price_score: priceScore,
    price_percentile: pricePercentile,
    industry_ps: ps,
    method: 'pe_absolute+price_position_v2'
  };
}

// 备用：纯价格位置（注意：没有PE数据时不能给高分，价格低不代表价值低估）
async function estimateValuationFromPrice(code) {
  const klines = await dbAll(`
    SELECT close FROM daily_kline WHERE code = ? ORDER BY trade_date DESC LIMIT 500
  `, [code]);
  if (klines.length < 60) return { score: 50, method: 'insufficient_data', warning: '无PE数据，估值分不可靠' };
  const closes = klines.map(k => k.close);
  const current = closes[0];
  const max = Math.max(...closes), min = Math.min(...closes);
  const pct = (current - min) / (max - min) * 100;
  // 没有PE数据时，价格位置最多给55分（不够买入信号阈值），不能因为跌得多就给100分
  const score = Math.min(55, Math.round((100 - pct) * 0.55));
  return { score, price_percentile: Math.round(pct), method: 'price_position_only(no_pe_data)', warning: '缺少PE数据，估值分基于价格位置，不可靠' };
}

// ========== 技术评分（不变）==========
async function calcTechnicalScore(code) {
  const recent = await dbAll(`
    SELECT k.trade_date, k.close, k.pct_chg, t.* FROM daily_kline k
    LEFT JOIN technical_indicators t USING(code, trade_date)
    WHERE k.code = ? ORDER BY k.trade_date DESC LIMIT 30
  `, [code]);
  
  if (recent.length < 25) return { score: 50, method: 'insufficient_data' };
  
  let score = 50;
  const curr = recent[0], prev = recent[1];
  const signals = [];
  
  if (curr.ma5 && curr.ma10 && curr.ma20 && curr.ma60) {
    if (curr.ma5 > curr.ma10 && curr.ma10 > curr.ma20) { score += 8; signals.push('均线多头+8'); }
    else if (curr.ma5 < curr.ma10 && curr.ma10 < curr.ma20) { score -= 10; signals.push('均线空头-10'); }
    if (curr.close > curr.ma20) { score += 5; signals.push('站上20日线+5'); }
    else { score -= 5; signals.push('跌破20日线-5'); }
    if (curr.close > curr.ma60) { score += 5; signals.push('站上60日线+5'); }
    else { score -= 3; signals.push('60日线下-3'); }
    const ma20Slope = curr.ma20 && recent[5]?.ma20 ? (curr.ma20 - recent[5].ma20) / recent[5].ma20 * 100 : 0;
    if (ma20Slope > 2) { score += 3; signals.push('MA20向上+3'); }
    else if (ma20Slope < -2) { score -= 3; signals.push('MA20向下-3'); }
  }
  
  if (curr.macd_dif !== null && curr.macd_dea !== null) {
    if (curr.macd_dif > curr.macd_dea && curr.macd_bar > 0) { score += 5; signals.push('MACD多头+5'); }
    if (prev.macd_dif <= prev.macd_dea && curr.macd_dif > curr.macd_dea) { score += 8; signals.push('MACD金叉+8'); }
    if (prev.macd_dif >= prev.macd_dea && curr.macd_dif < curr.macd_dea) { score -= 8; signals.push('MACD死叉-8'); }
    if (curr.macd_dif < 0 && curr.macd_dea < 0) { score -= 3; signals.push('MACD零轴下-3'); }
  }
  
  if (curr.rsi14 !== null) {
    if (curr.rsi14 < 30) { score += 8; signals.push('RSI超卖+8'); }
    else if (curr.rsi14 < 40) { score += 4; signals.push('RSI偏低+4'); }
    else if (curr.rsi14 > 80) { score -= 8; signals.push('RSI超买-8'); }
    else if (curr.rsi14 > 70) { score -= 4; signals.push('RSI偏高-4'); }
  }
  
  if (curr.boll_lower && curr.boll_upper) {
    const bollPos = (curr.close - curr.boll_lower) / (curr.boll_upper - curr.boll_lower);
    if (bollPos < 0.1) { score += 5; signals.push('触及布林下轨+5'); }
    else if (bollPos > 0.95) { score -= 5; signals.push('触及布林上轨-5'); }
  }
  
  if (curr.vol_ma5 && curr.vol_ma20) {
    const volRatio = curr.volume / curr.vol_ma20;
    if (volRatio > 1.5 && curr.pct_chg > 0) { score += 5; signals.push('放量上涨+5'); }
    else if (volRatio > 1.5 && curr.pct_chg < -2) { score -= 5; signals.push('放量下跌-5'); }
    if (volRatio < 0.5) { score += 2; signals.push('缩量调整+2'); }
  }
  
  if (curr.kdj_j !== null) {
    if (curr.kdj_j < 0) { score += 5; signals.push('KDJ超卖+5'); }
    else if (curr.kdj_j > 100) { score -= 3; signals.push('KDJ超买-3'); }
  }
  
  return {
    score: clamp(score, 0, 100),
    signals,
    macd: { dif: curr.macd_dif, dea: curr.macd_dea, bar: curr.macd_bar },
    rsi14: curr.rsi14,
    close: curr.close,
  };
}

// ========== 综合评分 & 信号 v2（含拥挤度调整）==========
function calcTotalScore(code, qualityResult, valuationResult, technicalResult, userSettings = null) {
  // 行业动态权重
  const industry = classifyIndustry(code);
  const ind = industry.group;
  
  // 从用户设置获取权重（百分比转小数），否则使用默认
  const s = userSettings || {};
  let W_QUALITY = (s.qualWeight != null ? s.qualWeight / 100 : null);
  let W_VALUATION = (s.valWeight != null ? s.valWeight / 100 : null);
  let W_TECHNICAL = (s.techWeight != null ? s.techWeight / 100 : null);
  
  // 如果没有自定义权重，按行业使用默认动态权重
  if (W_QUALITY == null || W_VALUATION == null || W_TECHNICAL == null) {
    W_QUALITY = 0.35; W_VALUATION = 0.40; W_TECHNICAL = 0.25;
    if (industry.isNewEconomy) { W_QUALITY = 0.40; W_VALUATION = 0.30; W_TECHNICAL = 0.30; }
    if (industry.isOldman) { W_QUALITY = 0.25; W_VALUATION = 0.55; W_TECHNICAL = 0.20; }
  }
  
  // 信号阈值（用户自定义或默认）
  const BUY_QUAL = s.buyThreshold || 70;
  const BUY_VAL = s.watchThreshold ? Math.max(50, s.watchThreshold - 10) : 65;
  const BUY_TECH = s.buyTechThreshold || 45;
  const WATCH_QUAL = s.watchThreshold || 60;
  const WATCH_VAL = Math.max(40, (s.watchThreshold || 60) - 10);
  const SELL_VAL = s.sellThreshold ? 100 - s.sellThreshold : 15;
  const SELL_QUAL = Math.max(25, 100 - (s.buyThreshold || 70) - 5);
  
  let totalScore = Math.round(
    qualityResult.score * W_QUALITY +
    valuationResult.score * W_VALUATION +
    technicalResult.score * W_TECHNICAL
  );
  
  totalScore = Math.max(0, Math.min(100, totalScore));
  
  // 困境行业（地产）总分封顶50
  if (industry.isDistressed && totalScore > 50) totalScore = 50;
  
  // 信号判断
  let signal = 'hold';
  let reason = [];
  
  // ==== 常规信号判断 ====
  if (qualityResult.score >= BUY_QUAL && valuationResult.score >= BUY_VAL) {
    if (technicalResult.score >= BUY_TECH) {
      signal = 'buy';
      reason.push(industry.isNewEconomy ? '优质成长股+估值合理+技术企稳' : '优质公司+低估区间+技术面企稳');
    } else {
      signal = 'watch';
      reason.push(industry.isNewEconomy ? '优质成长股估值合理，但技术面尚未企稳' : '基本面良好+低估，但等技术面企稳再入场');
    }
  } else if (qualityResult.score >= WATCH_QUAL && valuationResult.score >= WATCH_VAL) {
    signal = 'watch';
    reason.push('基本面尚可，估值进入合理区间');
    if (industry.isNewEconomy) reason.push('新经济方向');
  } else if (valuationResult.score <= SELL_VAL) {
    signal = 'sell';
    reason.push('估值处于高位，建议减仓');
  } else if (qualityResult.score < SELL_QUAL) {
    signal = 'sell';
    reason.push(industry.isOldman ? '基本面偏弱的老登股，建议回避' : '基本面质量不佳');
  } else if (industry.isOldman && qualityResult.score < Math.max(WATCH_QUAL - 10, 40)) {
    signal = 'sell';
    reason.push('传统老登股且基本面一般，资金效率低');
  }
  
  return {
    total_score: totalScore,
    signal,
    reason,
    weights: { quality: W_QUALITY, valuation: W_VALUATION, technical: W_TECHNICAL },
  };
}

// ========== 批量评分 ==========
async function scoreAllStocks(syncFinance = true, settings = null) {
  // 优先从股票池取代码，fallback到stock_info
  let poolCodes = await dbAll('SELECT code, name FROM stock_pool WHERE in_pool = 1');
  let codes = poolCodes;
  if (codes.length === 0) {
    codes = await dbAll('SELECT code, name FROM stock_info WHERE is_st = 0');
  }
  const today = dayjs().format('YYYYMMDD');
  const results = [];
  
  console.log(`\n🔍 开始评分(v2)，共 ${codes.length} 只股票`);
  
  for (let i = 0; i < codes.length; i++) {
    const { code, name } = codes[i];
    try {
      if (syncFinance) {
        const hasFinRow = await dbGet('SELECT COUNT(*) as c FROM financial_indicator WHERE code = ?', [code]);
        const hasFin = hasFinRow?.c || 0;
        if (hasFin === 0) {
          await syncFinancialData(code);
          await new Promise(r => setTimeout(r, 150));
        }
      }
      
      const quality = await calcQualityScore(code);
      if (!quality) continue;
      const valuation = await calcValuationScore(code);
      const technical = await calcTechnicalScore(code);
      // 资金因子
      const flow = await getStockFlowSignals(code);
      // 资金流入给技术面加分，流出减分
      if (flow.direction === 'inflow') technical.score = Math.min(100, technical.score + 8);
      else if (flow.direction === 'slight_inflow') technical.score = Math.min(100, technical.score + 4);
      else if (flow.direction === 'outflow') technical.score = Math.max(0, technical.score - 8);
      else if (flow.direction === 'slight_outflow') technical.score = Math.max(0, technical.score - 4);
      // 放量上涨/缩量调整信号加入技术信号
      if (flow.signals) technical.signals = [...(technical.signals||[]), ...flow.signals];
      
      const total = calcTotalScore(code, quality, valuation, technical, settings);
      
      const latestKline = await dbGet('SELECT close FROM daily_kline WHERE code = ? ORDER BY trade_date DESC LIMIT 1', [code]);
      const currentPrice = latestKline?.close;
      
      let targetPrice = null, stopLoss = null;
      if (currentPrice) {
        const industry = classifyIndustry(code, name);
        // 动量搭车票：更紧的止损，更快的止盈
        if (total.signal === 'buy') {
          const upside = industry.isNewEconomy ? 0.4 : industry.isOldman ? 0.2 : 0.3;
          targetPrice = +(currentPrice * (1 + upside)).toFixed(2);
          stopLoss = +(currentPrice * (industry.isOldman ? 0.92 : 0.85)).toFixed(2);
        } else {
          stopLoss = +(currentPrice * (industry.isOldman ? 0.92 : 0.85)).toFixed(2);
        }
      }
      
      // 建议仓位
      let positionPct = 5;
      if (total.signal === 'buy') positionPct = total.total_score >= 75 ? 15 : 10;
      else if (total.signal === 'watch') positionPct = 0;
      else if (total.signal === 'sell') positionPct = 0;
      
      results.push({
        code, name, trade_date: today, strategy: 'value',
        quality_score: quality.score,
        valuation_score: valuation.score,
        technical_score: technical.score,
        total_score: total.total_score,
        signal: total.signal,
        current_price: currentPrice,
        target_price: targetPrice,
        stop_loss: stopLoss,
        position_pct: positionPct,
        quality_detail: JSON.stringify({ ...quality.breakdown, industry: quality.industry, isNewEconomy: quality.isNewEconomy, isOldman: quality.isOldman, isDistressed: quality.isDistressed }),
        quality_latest: JSON.stringify(quality.latest),
        valuation_detail: JSON.stringify(valuation),
        technical_detail: JSON.stringify({ signals: technical.signals, rsi14: technical.rsi14 }),
        reason: JSON.stringify(total.reason),
      });
    } catch (e) {
      console.error(`  ${code}评分失败:`, e.message);
    }
    
    if ((i + 1) % 20 === 0) console.log(`  评分进度: ${i + 1}/${codes.length}`);
  }
  
  // 保存
  const baseColumns = ['code', 'name', 'trade_date', 'strategy', 'quality_score', 'valuation_score',
    'technical_score', 'total_score', 'signal', 'current_price', 'target_price', 'stop_loss',
    'position_pct', 'quality_detail', 'quality_latest', 'valuation_detail', 'technical_detail', 'reason'];
  const allColumns = [...baseColumns, 'fund_score', 'sentiment_score'];

  const insertSql = `INSERT OR REPLACE INTO stock_score
    (${allColumns.join(',')}) VALUES (${allColumns.map(()=>'?').join(',')})`;

  const stmts = results.map(r => ({
    sql: insertSql,
    args: [
      ...baseColumns.map(c => r[c] ?? null),
      0, 0
    ]
  }));
  
  for (let i = 0; i < stmts.length; i += 200) {
    await dbBatch(stmts.slice(i, i + 200));
  }
  
  console.log(`\n✅ 评分(v2+拥挤度)完成，共 ${results.length} 只`);
  return results;
}

module.exports = {
  classifyIndustry, INDUSTRY_GROUPS,
  syncFinancialData, calcQualityScore, calcValuationScore,
  calcTechnicalScore, calcTotalScore, scoreAllStocks,
};
