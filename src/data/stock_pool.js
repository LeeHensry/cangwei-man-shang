/**
 * 动态股票池管理
 * 设计：
 * - Universe：从全市场动态筛选 Top 1000 只核心观察池
 *     1. 基础硬过滤：非ST/退市/北交所/低价/低成交额/长期停牌
 *     2. UniverseScore = 25%市值 + 25%流动性 + 15%活跃度 + 15%风险稳定 + 10%估值健康 + 10%数据质量
 *     3. 行业调节系数：银行/地产/传统周期降权，高端制造/科技/医药/消费正常或微加权
 *     4. 行业限额：银行≤50、地产≤25、单行业≤80，防止过度集中
 *     5. 分层入选：600核心大盘 + 300行业代表 + 100成长活跃
 *     6. 缓冲机制：新进前900、保留至1200、连续两次跌出1200才剔除
 * - Pool：从 Universe 中按流动性+动量+市值综合打分，选 Top 200 作为重点关注池
 * - 用户自选股票始终入池，不受筛选淘汰
 */
const { dbGet, dbAll, dbRun, dbBatch } = require('./db');
const ds = require('./datasources');
const dayjs = require('dayjs');

// 静态内置池作为兜底（首次启动/数据库为空时使用）
const BUILTIN_UNIVERSE = require('../../data/stock_universe.json');

const UNIVERSE_SIZE = 1000;  // 动态Universe目标数量

// ========== 行业关键词识别与调节系数 ==========
// 注意：规则按优先级排序，更具体的关键词放前面
const INDUSTRY_RULES = [
  // === 高景气/成长行业 → 轻微加权 ===
  { keywords: ['半导体', '芯片', '集成电路', '微电子', '晶方', '封测', '晶圆', '光刻'], factor: 1.05, cap: 80, group: 'semiconductor' },
  { keywords: ['AI', '人工智能', '算力', '光模块', '大模型', '智能'], factor: 1.05, cap: 60, group: 'ai' },
  { keywords: ['机器人', '减速器', '伺服'], factor: 1.04, cap: 40, group: 'robotics' },
  { keywords: ['创新药', '生物', '基因', '疫苗', '血制'], factor: 1.02, cap: 50, group: 'biotech' },
  { keywords: ['医疗器械', '医疗', '医械'], factor: 1.02, cap: 40, group: 'meddevice' },
  { keywords: ['中药', '药业', '制药', '医药', '健康'], factor: 1.00, cap: 60, group: 'pharma' },
  { keywords: ['新能源', '光伏', '锂电', '风电', '储能', '氢能', '电池'], factor: 1.02, cap: 60, group: 'newenergy' },
  { keywords: ['军工', '航天', '航空', '国防', '兵器', '船'], factor: 1.02, cap: 40, group: 'defense' },
  { keywords: ['高端装备', '智能制造', '工业母机', '数控', '自动化', '激光'], factor: 1.03, cap: 50, group: 'hightech' },
  { keywords: ['软件', '信息', '网安', '云计算', '5G', '数据', '通信', '电子'], factor: 1.02, cap: 60, group: 'tech' },

  // === 消费行业 → 正常权重 ===
  { keywords: ['白酒', '啤酒', '乳业', '食品', '饮料', '调味品', '猪肉', '养殖', '饲料'], factor: 1.00, cap: 40, group: 'food' },
  { keywords: ['家电', '家居', '空调', '冰箱'], factor: 0.98, cap: 25, group: 'appliance' },
  { keywords: ['汽车', '整车', '零部件', '车'], factor: 1.00, cap: 45, group: 'auto' },
  { keywords: ['服装', '纺织', '化妆品', '美'], factor: 0.98, cap: 20, group: 'textile' },
  { keywords: ['旅游', '酒店', '免税', '航空', '机场'], factor: 0.97, cap: 25, group: 'travel' },
  { keywords: ['传媒', '游戏', '影视', '文化', '出版'], factor: 0.97, cap: 30, group: 'media' },
  { keywords: ['电商', '互联网', '平台', '快递', '物流'], factor: 1.00, cap: 25, group: 'internet' },
  { keywords: ['教育'], factor: 0.95, cap: 10, group: 'education' },
  { keywords: ['零售', '百货', '超市', '商贸'], factor: 0.95, cap: 20, group: 'retail' },

  // === 金融行业 → 适度降权 ===
  { keywords: ['银行'], factor: 0.90, cap: 50, group: 'bank' },
  { keywords: ['保险'], factor: 0.92, cap: 15, group: 'insurance' },
  { keywords: ['证券', '券商', '信托'], factor: 0.93, cap: 20, group: 'broker' },

  // === 地产/建筑 → 明显降权 ===
  { keywords: ['地产', '房地产', '置业'], factor: 0.75, cap: 25, group: 'realestate' },
  { keywords: ['建筑', '建工', '基建', '建设', '建工', '装饰'], factor: 0.88, cap: 35, group: 'construction' },
  { keywords: ['建材', '水泥', '玻璃', '防水'], factor: 0.90, cap: 25, group: 'materials' },

  // === 传统周期 → 轻微降权 ===
  { keywords: ['煤炭', '煤业'], factor: 0.90, cap: 20, group: 'coal' },
  { keywords: ['钢铁', '钢'], factor: 0.90, cap: 20, group: 'steel' },
  { keywords: ['电力', '电网', '火电', '水电', '核电', '能源'], factor: 0.93, cap: 40, group: 'utility' },
  { keywords: ['石油', '石化', '炼油'], factor: 0.92, cap: 20, group: 'oil' },
  { keywords: ['化工', '化学', '化纤', '氯碱', '磷化工', '盐化工'], factor: 0.93, cap: 40, group: 'chemical' },
  { keywords: ['有色', '铝', '铜', '黄金', '矿业', '镁', '锂矿', '稀土', '金属'], factor: 0.95, cap: 45, group: 'mining' },
  { keywords: ['造纸', '印刷'], factor: 0.93, cap: 10, group: 'paper' },
  { keywords: ['航运', '港口', '船运', '海运'], factor: 0.93, cap: 15, group: 'shipping' },
  { keywords: ['铁路', '高速', '公路'], factor: 0.95, cap: 15, group: 'transport' },
  { keywords: ['环保'], factor: 0.95, cap: 15, group: 'env' },
  { keywords: ['农业', '种业', '农化', '化肥', '农药'], factor: 0.95, cap: 25, group: 'agri' },
  { keywords: ['机械', '重工', '重机', '起重', '轴承'], factor: 0.97, cap: 35, group: 'machinery' },
  { keywords: ['电力设备', '电气', '电缆', '变压器', '开关'], factor: 1.00, cap: 40, group: 'epower' },
];

/**
 * 根据股票名称识别行业组和调节系数
 * @returns {{group: string, factor: number, cap: number}}
 */
function classifyIndustryForUniverse(name) {
  if (!name) return { group: 'other', factor: 1.00, cap: 80 };
  for (const rule of INDUSTRY_RULES) {
    for (const kw of rule.keywords) {
      if (name.includes(kw)) {
        return { group: rule.group, factor: rule.factor, cap: rule.cap };
      }
    }
  }
  return { group: 'other', factor: 1.00, cap: 80 };
}

/**
 * 百分位排名归一化到0-100
 */
function percentileRank(value, sortedAsc) {
  if (sortedAsc.length === 0) return 50;
  let lo = 0, hi = sortedAsc.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid] < value) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.round((lo / sortedAsc.length) * 100);
}

/**
 * 从东方财富/腾讯拉取全市场A股，经过多层筛选选出Top 1000写入stock_universe表
 * 建议每月执行一次
 */
async function updateUniverse() {
  console.log(`[universe] 开始动态更新股票Universe，目标数量: ${UNIVERSE_SIZE}`);
  const t0 = Date.now();
  const tq = require('./datasources/tencent');
  const em = require('./eastmoney');

  // 1. 拉取全市场A股快照
  let allStocks = [];
  try {
    allStocks = await em.getStockList();
    console.log(`[universe] 东方财富拉取到 ${allStocks.length} 只股票`);
  } catch(e) {
    console.error('[universe] 东方财富拉取失败:', e.message);
  }

  // 如果东财数据不足（<500只），用腾讯批量行情为静态972只Universe获取实时数据作为兜底
  if (!allStocks || allStocks.length < 500) {
    console.log(`[universe] 东财数据不足(${allStocks?.length || 0}只)，切换到腾讯批量行情拉取静态Universe(${BUILTIN_UNIVERSE.length}只)...`);
    try {
      const tencentCodes = BUILTIN_UNIVERSE.map(c => String(c));
      const tencentStocks = await tq.getQuickStockList(tencentCodes);
      console.log(`[universe] 腾讯批量行情返回 ${tencentStocks.length} 只`);
      if (tencentStocks.length > 0) {
        // 用腾讯数据覆盖/补充，注意统一单位：腾讯amount是"万元"，东财是"元"，需×10000
        const merged = [...(allStocks || [])];
        const existingCodes = new Set(merged.map(s => s.code));
        for (const s of tencentStocks) {
          // 转换amount单位：万→元
          if (s.amount != null) s.amount = s.amount * 10000;
          if (!existingCodes.has(s.code)) merged.push(s);
        }
        allStocks = merged;
        console.log(`[universe] 合并后共 ${allStocks.length} 只`);
      }
    } catch(e2) {
      console.error('[universe] 腾讯批量行情也失败:', e2.message);
    }
  }

  // 最终兜底：静态JSON（没有实时数据，只能用基础信息）
  if (!allStocks || allStocks.length < 100) {
    console.log(`[universe] 在线数据源全部不足(${allStocks?.length || 0}只)，使用静态兜底`);
    const dbNameMap = new Map();
    try {
      const rows = await dbAll('SELECT code, name FROM stock_info WHERE length(code)=6');
      for (const r of rows) dbNameMap.set(r.code, r.name);
    } catch(e) {}
    const fallbackStocks = BUILTIN_UNIVERSE.map(c => {
      const code = String(c).replace(/^(sh|sz|bj)/, '');
      return {
        code,
        name: dbNameMap.get(code) || '',
        market: code.startsWith('6') ? 'SH' : 'SZ',
        total_mv: 0, circ_mv: 0, close: 10, pct_chg: 0, amount: 0,
        turnover: 0, amplitude: 0, pe: null, volume: 0, is_st: 0,
        _fromFallback: true,
      };
    });
    const existingCodes = new Set((allStocks || []).map(s => s.code));
    allStocks = [...(allStocks || []), ...fallbackStocks.filter(s => !existingCodes.has(s.code))];
    console.log(`[universe] 静态兜底后共 ${allStocks.length} 只`);
  }

  // 2. 基础硬过滤
  const filtered = allStocks.filter(s => {
    // ST/*ST/退市
    if (s.is_st) return false;
    if (s.name && (s.name.includes('ST') || s.name.includes('*ST'))) return false;
    if (s.name && s.name.includes('退')) return false;
    // 北交所
    if (s.market === 'BJ') return false;
    // 名称为空——非兜底来源视为无效；兜底来源允许
    if (!s._fromFallback && (!s.name || s.name.trim() === '' || s.name === 'None')) return false;
    // 价格过滤
    if (s.close == null || isNaN(s.close) || s.close <= 0 || s.close < 2) return false;
    // 成交额过滤：低于3000万元的冷门股剔除（兜底来源数据可能为0，放宽）
    const amountYi = ((s.amount || 0) / 1e8);
    if (!s._fromFallback && s.amount != null && s.amount > 0 && amountYi < 0.3) return false;
    // 流通市值过滤：低于20亿的极小盘剔除（兜底来源无数据时跳过）
    if (!s._fromFallback && s.circ_mv != null && s.circ_mv > 0 && s.circ_mv < 20) return false;
    // PE为负且严重亏损（PE < -1000，即EPS极小/巨亏）直接剔除
    // 注意：正常周期股亏损PE在 -5~-200 范围，这里不硬过滤，留给估值分扣分
    // 但PE < -1000 意味着几乎资不抵债/每股亏损极大，直接排除
    if (s.pe !== null && s.pe !== undefined && s.pe < 0 && s.pe > -1000) {
      // 轻度/中度亏损：保留但标记，后续打分时扣分加重
      s._isLoss = true;
    } else if (s.pe !== null && s.pe !== undefined && s.pe <= -1000) {
      return false; // 严重亏损，直接剔除
    }
    return true;
  });
  console.log(`[universe] 基础硬过滤后剩余 ${filtered.length} 只（原始 ${allStocks.length} 只）`);

  // 补充兜底（如果拉取太少）
  if (filtered.length < 500) {
    console.log(`[universe] 拉取数量不足(${filtered.length})，用静态JSON补充`);
    const builtinCodes = BUILTIN_UNIVERSE.map(c => String(c).replace(/^(sh|sz|bj)/, ''));
    const existingCodes = new Set(filtered.map(s => s.code));
    const supplement = builtinCodes
      .filter(c => !existingCodes.has(c))
      .map(c => ({ code: c, name: '', market: c.startsWith('6') ? 'SH' : 'SZ', total_mv: 0, circ_mv: 0, close: 10, pct_chg: 0, amount: 0, turnover: 0, amplitude: 0, pe: null, volume: 0, is_st: 0, _fromFallback: true }));
    filtered.push(...supplement);
    console.log(`[universe] 补充后共 ${filtered.length} 只`);
  }

  // 3. 识别行业，附加行业系数
  for (const s of filtered) {
    const ind = classifyIndustryForUniverse(s.name);
    s._industryGroup = ind.group;
    s._industryFactor = ind.factor;
    s._industryCap = ind.cap;
  }

  // 4. 准备百分位排名所需的排序数组
  const amounts = filtered.map(s => (s.amount || 0) / 1e8).filter(v => v > 0).sort((a, b) => a - b);
  const circMvs = filtered.map(s => s.circ_mv || 0).filter(v => v > 0).sort((a, b) => a - b);
  const totalMvs = filtered.map(s => s.total_mv || 0).filter(v => v > 0).sort((a, b) => a - b);
  const turnovers = filtered.map(s => s.turnover || 0).filter(v => v > 0).sort((a, b) => a - b);
  const amplitudes = filtered.map(s => s.amplitude || 0).filter(v => v > 0).sort((a, b) => a - b);
  const volumes = filtered.map(s => s.volume || 0).filter(v => v > 0).sort((a, b) => a - b);

  // 5. 计算 UniverseScore
  for (const s of filtered) {
    const amountYi = (s.amount || 0) / 1e8;
    const cmv = s.circ_mv || 0;
    const tmv = s.total_mv || 0;

    // (a) 市值分 25%：流通市值60% + 总市值40%
    let mvScore = 50;
    if (cmv > 0 && tmv > 0) {
      const circPct = percentileRank(cmv, circMvs);
      const totalPct = percentileRank(tmv, totalMvs);
      mvScore = circPct * 0.6 + totalPct * 0.4;
    } else if (cmv > 0) {
      mvScore = percentileRank(cmv, circMvs);
    } else if (tmv > 0) {
      mvScore = percentileRank(tmv, totalMvs);
    }

    // (b) 流动性分 25%：成交额百分位80% + 成交量百分位20%
    let liqScore = 50;
    if (amountYi > 0) {
      const amtPct = percentileRank(amountYi, amounts);
      const volPct = s.volume > 0 ? percentileRank(s.volume, volumes) : 50;
      liqScore = amtPct * 0.8 + volPct * 0.2;
    }

    // (c) 活跃度分 15%：换手率适中最好（1%~8%为佳，过低没人交易，过高过热）
    let activeScore = 50;
    if (s.turnover && s.turnover > 0) {
      const to = s.turnover;
      if (to >= 1 && to <= 8) activeScore = 80 + Math.min(15, (8 - Math.abs(to - 4)) * 2); // 换手4%左右最佳
      else if (to < 1) activeScore = 30 + to * 30; // 换手过低
      else if (to > 15) activeScore = 25; // 换手过高（过热）
      else if (to > 8) activeScore = 70 - (to - 8) * 4; // 换手偏高
      activeScore = Math.max(0, Math.min(100, activeScore));
    }

    // (d) 风险稳定分 15%：振幅适中、非涨跌停
    let riskScore = 70;
    if (s.amplitude && s.amplitude > 0) {
      const amp = s.amplitude;
      if (amp <= 3) riskScore = 90;       // 振幅小，稳定
      else if (amp <= 5) riskScore = 80;
      else if (amp <= 8) riskScore = 65;
      else if (amp <= 12) riskScore = 45;
      else riskScore = 20;               // 振幅过大，妖股特征
    }
    // 涨停扣分（短期过热）
    if (s.pct_chg >= 9.8) riskScore = Math.max(10, riskScore - 30);
    // 当日跌幅过大扣分
    if (s.pct_chg <= -5) riskScore = Math.max(10, riskScore - 20);

    // (e) 估值健康分 10%：PE合理区间加分，亏损/极端PE扣分
    let valScore = 50;
    const pe = s.pe;
    if (pe !== null && pe !== undefined && pe > 0) {
      if (pe >= 8 && pe <= 25) valScore = 80;         // 合理估值
      else if (pe >= 5 && pe < 8) valScore = 65;     // 低估值（银行/周期常见）
      else if (pe > 25 && pe <= 50) valScore = 60;   // 偏高但可接受（成长股）
      else if (pe > 50 && pe <= 100) valScore = 40;  // 偏高
      else if (pe > 100) valScore = 20;              // 极高PE
      else valScore = 50;
    } else if (pe !== null && pe < 0) {
      // 亏损股：PE越负（亏损越严重），分越低
      if (pe > -20) valScore = 20;       // 轻度亏损（周期谷底常见）
      else if (pe > -100) valScore = 10; // 中度亏损
      else valScore = 0;                  // 严重亏损（已被硬过滤PE<-1000，这里保底）
    } else {
      valScore = 30; // PE缺失（可能是新股/数据异常），给低分但不剔除
    }

    // 亏损股额外惩罚系数：在综合分上乘以0.75（整体打75折）
    // 这样亏损股需要流动性/动量/市值明显更好才能入选，自然减少亏损股比例
    const lossPenalty = s._isLoss ? 0.70 : 1.0;

    // (f) 数据质量分 10%：字段完整性
    let dataScore = 60;
    let fieldCount = 0;
    if (s.close && s.close > 0) fieldCount++;
    if (s.amount && s.amount > 0) fieldCount++;
    if (s.circ_mv && s.circ_mv > 0) fieldCount++;
    if (s.total_mv && s.total_mv > 0) fieldCount++;
    if (s.turnover && s.turnover > 0) fieldCount++;
    if (s.volume && s.volume > 0) fieldCount++;
    if (s.pct_chg !== null && s.pct_chg !== undefined) fieldCount++;
    dataScore = Math.round(fieldCount / 7 * 100);

    // 综合 UniverseScore（未应用行业系数和亏损惩罚）
    const rawScore = +(
      mvScore * 0.25 +
      liqScore * 0.25 +
      activeScore * 0.15 +
      riskScore * 0.15 +
      valScore * 0.10 +
      dataScore * 0.10
    ).toFixed(2);

    // 应用行业调节系数 + 亏损惩罚
    const adjustedScore = +(rawScore * s._industryFactor * lossPenalty).toFixed(2);

    s._mvScore = +mvScore.toFixed(1);
    s._liqScore = +liqScore.toFixed(1);
    s._activeScore = +activeScore.toFixed(1);
    s._riskScore = +riskScore.toFixed(1);
    s._valScore = +valScore.toFixed(1);
    s._dataScore = dataScore;
    s._rawScore = rawScore;
    s._adjustedScore = adjustedScore;
  }

  // 6. 按调整后分数降序排序
  filtered.sort((a, b) => b._adjustedScore - a._adjustedScore);

  // 7. 分层入选 + 行业限额
  //    600只核心大盘（按分数排名，受行业限额约束）
  //    300只行业代表（在每个行业组中按分数取代表）
  //    100只成长/活跃补充（活跃度高+成长性行业）
  const selected = new Set();
  const selectedList = [];
  const industryCount = {};

  // 检查行业限额
  function canAdd(s) {
    const g = s._industryGroup;
    if (!industryCount[g]) industryCount[g] = 0;
    const cap = s._industryCap || 80;
    // 银行、地产有独立硬上限
    if (g === 'bank' && industryCount[g] >= 50) return false;
    if (g === 'realestate' && industryCount[g] >= 25) return false;
    if (g === 'insurance' && industryCount[g] >= 15) return false;
    if (g === 'broker' && industryCount[g] >= 20) return false;
    if (industryCount[g] >= cap) return false;
    return true;
  }
  function addStock(s, reason) {
    if (selected.has(s.code)) return false;
    if (!canAdd(s)) return false;
    selected.add(s.code);
    industryCount[s._industryGroup] = (industryCount[s._industryGroup] || 0) + 1;
    selectedList.push({ ...s, _selectReason: reason });
    return true;
  }

  // 7a. 第一层：600只核心大盘（分数排名+行业限额）
  const coreTarget = 600;
  for (const s of filtered) {
    if (selectedList.length >= coreTarget) break;
    // 核心层要求：流通市值>=100亿 OR 总市值>=200亿，且流动性分>=40
    if ((s.circ_mv && s.circ_mv >= 100) || (s.total_mv && s.total_mv >= 200)) {
      if (s._liqScore >= 30) {
        addStock(s, 'core');
      }
    }
  }
  // 如果核心层不足600，从剩余高分股补足
  for (const s of filtered) {
    if (selectedList.length >= coreTarget) break;
    if (s._liqScore >= 40 && s._riskScore >= 30) {
      addStock(s, 'core-supplement');
    }
  }
  console.log(`[universe] 核心大盘层: ${selectedList.length} 只`);

  // 7b. 第二层：300只行业代表（每个行业组取Top代表，保证行业覆盖）
  const sectorTarget = 300;
  const sectorGroups = {};
  for (const s of filtered) {
    if (selected.has(s.code)) continue;
    const g = s._industryGroup;
    if (!sectorGroups[g]) sectorGroups[g] = [];
    sectorGroups[g].push(s);
  }
  // 每个行业组按比例分配名额
  const totalSector = Object.values(sectorGroups).reduce((a, b) => a + b.length, 0);
  for (const [group, stocks] of Object.entries(sectorGroups)) {
    if (selectedList.length >= coreTarget + sectorTarget) break;
    // 按行业股票数量分配名额，最少3只，最多按比例
    const quota = Math.max(3, Math.min(stocks.length, Math.round(stocks.length / totalSector * sectorTarget * 1.2)));
    const sorted = stocks.sort((a, b) => b._adjustedScore - a._adjustedScore);
    let added = 0;
    for (const s of sorted) {
      if (added >= quota) break;
      if (selectedList.length >= coreTarget + sectorTarget) break;
      if (addStock(s, 'sector-rep')) added++;
    }
  }
  // 补足行业代表层
  for (const s of filtered) {
    if (selectedList.length >= coreTarget + sectorTarget) break;
    if (s._adjustedScore >= 40) {
      addStock(s, 'sector-supplement');
    }
  }
  console.log(`[universe] 行业代表层: ${selectedList.length - coreTarget} 只，累计 ${selectedList.length} 只`);

  // 7c. 第三层：100只成长/活跃补充（高换手+高成长行业+趋势好）
  const growthTarget = 100;
  const growthGroups = new Set(['growth', 'hightech', 'tech', 'newenergy', 'healthcare', 'defense']);
  const growthCandidates = filtered.filter(s => {
    if (selected.has(s.code)) return false;
    // 成长行业 + 活跃度高 + 非极端风险
    return growthGroups.has(s._industryGroup) && s._activeScore >= 50 && s._riskScore >= 40;
  }).sort((a, b) => {
    // 按 活跃度*0.4 + 成长系数*0.3 + 流动性*0.3 排序
    const sa = a._activeScore * 0.4 + a._industryFactor * 100 * 0.3 + a._liqScore * 0.3;
    const sb = b._activeScore * 0.4 + b._industryFactor * 100 * 0.3 + b._liqScore * 0.3;
    return sb - sa;
  });
  for (const s of growthCandidates) {
    if (selectedList.length >= coreTarget + sectorTarget + growthTarget) break;
    addStock(s, 'growth-active');
  }
  // 如果成长层不足，从剩余高分股补足到1000
  for (const s of filtered) {
    if (selectedList.length >= UNIVERSE_SIZE) break;
    if (s._adjustedScore >= 35 && s._riskScore >= 30) {
      addStock(s, 'supplement');
    }
  }
  console.log(`[universe] 成长活跃层: ${selectedList.length - coreTarget - sectorTarget} 只，累计 ${selectedList.length} 只`);

  // 最终入选名单
  const topStocks = selectedList.slice(0, UNIVERSE_SIZE);
  console.log(`[universe] 最终Universe: ${topStocks.length} 只`);

  // 统计行业分布
  const industryDist = {};
  for (const s of topStocks) {
    const g = s._industryGroup;
    industryDist[g] = (industryDist[g] || 0) + 1;
  }
  console.log(`[universe] 行业分布:`, JSON.stringify(industryDist));

  // 8. 写入数据库
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  await dbRun(`UPDATE stock_universe SET in_universe = 0, updated_at = ?`, [now]);

  const batchStmts = topStocks.map(s => ({
    sql: `INSERT OR REPLACE INTO stock_universe
      (code, name, market, total_mv, circ_mv, close, pct_chg, amount, is_st, updated_at, in_universe,
       universe_score, industry_group, industry_factor, score_mv, score_liq, score_active, score_risk, score_val, score_data, select_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      String(s.code).replace(/^(sh|sz|bj)/, ''),
      s.name,
      s.market,
      s.total_mv || null,
      s.circ_mv || null,
      s.close || null,
      s.pct_chg || null,
      s.amount || null,
      s.is_st || 0,
      now,
      1,
      s._adjustedScore,
      s._industryGroup,
      s._industryFactor,
      s._mvScore,
      s._liqScore,
      s._activeScore,
      s._riskScore,
      s._valScore,
      s._dataScore,
      s._selectReason,
    ]
  }));

  for (let i = 0; i < batchStmts.length; i += 200) {
    await dbBatch(batchStmts.slice(i, i + 200));
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[universe] ✅ 更新完成，共 ${topStocks.length} 只，耗时 ${elapsed}s`);
  return { total: topStocks.length, industryDist, elapsed: Date.now() - t0 };
}

/**
 * 获取当前Universe股票代码列表（优先读数据库动态表，降级读静态JSON）
 */
async function getUniverseCodes() {
  try {
    const rows = await dbAll(`SELECT code FROM stock_universe WHERE in_universe = 1`);
    if (rows && rows.length > 0) {
      return rows.map(r => r.code);
    }
  } catch(e) {
    console.log('[universe] 读数据库失败，降级静态JSON:', e.message);
  }
  // 降级：静态JSON
  return BUILTIN_UNIVERSE.map(c => String(c).replace(/^(sh|sz|bj)/, ''));
}

/**
 * 执行股票池更新（每周一执行）
 * 从动态Universe中按流动性+动量+市值综合打分，选Top 200
 * @param {number} targetSize 目标股票池大小，默认200
 */
async function updateStockPool(targetSize = 200) {
  console.log('[pool] 开始更新股票池，目标数量:', targetSize);
  const t0 = Date.now();

  // 1. 构建待扫描股票名单：动态Universe + 已有池内股票（含手动添加）+ portfolio里的股票
  const universeCodes = await getUniverseCodes();
  const manualRows = await dbAll(`SELECT code, name FROM stock_pool WHERE is_manual = 1`);
  const manualCodes = manualRows.map(r => r.code);
  const portfolioRows = await dbAll(`SELECT DISTINCT code FROM portfolio WHERE status='holding'`);
  const portfolioCodes = portfolioRows.map(r => r.code);
  const universeSet = new Set([...universeCodes, ...manualCodes, ...portfolioCodes]);
  // 保证所有代码格式正确（sh/sz前缀）
  const allCodes = [...universeSet].map(toTencentCode);
  console.log(`[pool] 待扫描股票: ${allCodes.length} 只`);

  // 2. 批量拉取行情（新浪/腾讯，自动选数据源）
  let quotes = await ds.getQuickStockList(allCodes);
  // 统一code为纯6位（去掉sh/sz前缀）
  quotes = quotes.map(q => ({ ...q, code: String(q.code).replace(/^(sh|sz|bj)/, '') }));
  console.log(`[pool] 成功获取行情: ${quotes.length} 只`);

  // 3. 拉取K线计算动量（近20日涨幅）
  const momentumMap = {};
  const klineCodes = quotes.slice(0, Math.min(quotes.length, 300)); // 动量计算只处理前300只高流动性
  for (let i = 0; i < klineCodes.length; i++) {
    const q = klineCodes[i];
    try {
      const kl = await ds.getDailyKline(q.code, dayjs().subtract(30, 'day').format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD'));
      if (kl && kl.length >= 15) {
        const closes = kl.map(k => k.close).filter(c => c > 0);
        if (closes.length >= 10) {
          const ret = (closes[closes.length - 1] - closes[0]) / closes[0];
          momentumMap[q.code] = ret;
        }
      }
    } catch(e) {}
    if (i % 50 === 0) await ds.sleep(80);
  }

  // 4. 打分与筛选（PoolScore：流动性30% + 市值20% + 动量25% + 风险15% + 质量10%，再乘行业系数）
  const today = dayjs().format('YYYYMMDD');

  // 准备百分位排名
  const poolAmounts = quotes.map(q => (q.amount || 0) / 1e8).filter(v => v > 0).sort((a, b) => a - b);
  const poolMvs = quotes.map(q => q.total_mv || 0).filter(v => v > 0).sort((a, b) => a - b);
  const poolAmps = quotes.map(q => q.amplitude || 0).filter(v => v > 0).sort((a, b) => a - b);

  const scored = quotes.map(q => {
    // 基础过滤
    if (q.is_st) return null;
    if (q.name && (q.name.includes('ST') || q.name.includes('*ST'))) return null;
    if (q.name && q.name.includes('退')) return null;
    if (!q.name || q.name.trim() === '' || q.name === 'None') return null; // 无效代码
    if (!q.close || q.close < 2) return null;
    const amountYi = (q.amount || 0) / 10000; // 万→亿
    if (amountYi < 0.3) return null; // 成交额小于3000万的冷门股不关注
    // 严重亏损（PE < -1000）直接剔除
    if (q.pe !== null && q.pe !== undefined && q.pe <= -1000) return null;
    const isLoss = q.pe !== null && q.pe !== undefined && q.pe < 0 && q.pe > -1000;

    // 流动性分 30%（成交额对数归一）
    const volScore = Math.min(100, Math.max(0, Math.log10(Math.max(1, amountYi)) * 25 + 10));

    // 动量分 25%（20日K线，过热和暴跌都扣分）
    const ret = momentumMap[q.code];
    let momScore = 50;
    if (ret !== undefined) {
      if (ret > 0.5) momScore = 35;        // 短期暴涨50%以上，严重过热
      else if (ret > 0.3) momScore = 55;   // 涨幅偏大
      else if (ret > 0.15) momScore = 80;  // 温和上涨，最佳
      else if (ret > 0) momScore = 70;     // 小涨
      else if (ret > -0.05) momScore = 60; // 横盘
      else if (ret > -0.15) momScore = 45; // 小跌
      else if (ret > -0.3) momScore = 30;  // 中跌
      else momScore = 15;                   // 大跌
    } else {
      // 没有K线动量时，用当日涨跌幅做简单判断
      const pct = q.pct_chg || 0;
      if (pct > 7) momScore = 45;
      else if (pct > 3) momScore = 65;
      else if (pct > -2) momScore = 55;
      else momScore = 35;
    }

    // 市值分 20%（大中盘优先）
    let mvScore = 50;
    const mv = q.total_mv || 0;
    if (mv > 0) {
      if (mv > 5000) mvScore = 85;
      else if (mv > 1000) mvScore = 80;
      else if (mv > 500) mvScore = 75;
      else if (mv > 200) mvScore = 65;
      else if (mv > 100) mvScore = 55;
      else if (mv > 50) mvScore = 40;
      else mvScore = 25;
    }

    // 风险分 15%（振幅适中、非极端涨跌）
    let riskScore = 60;
    const amp = q.amplitude || 0;
    if (amp > 0) {
      if (amp <= 3) riskScore = 90;
      else if (amp <= 5) riskScore = 80;
      else if (amp <= 8) riskScore = 60;
      else if (amp <= 12) riskScore = 40;
      else riskScore = 15;
    }
    if (q.pct_chg >= 9.8) riskScore = Math.max(10, riskScore - 30); // 涨停扣风险分
    if (q.pct_chg <= -5) riskScore = Math.max(10, riskScore - 20);

    // 质量分 10%（基于PE）
    let qualScore = 50;
    const pe = q.pe;
    if (pe !== null && pe !== undefined && pe > 0) {
      if (pe >= 8 && pe <= 25) qualScore = 80;
      else if (pe >= 5 && pe < 8) qualScore = 65;
      else if (pe > 25 && pe <= 50) qualScore = 60;
      else if (pe > 50 && pe <= 100) qualScore = 35;
      else if (pe > 100) qualScore = 15;
    } else if (pe !== null && pe < 0) {
      // 亏损股按亏损程度给分
      if (pe > -20) qualScore = 20;
      else if (pe > -100) qualScore = 10;
      else qualScore = 0;
    } else {
      qualScore = 30; // PE缺失
    }

    // 综合PoolScore（未应用行业系数和亏损惩罚）
    const rawScore = +(
      volScore * 0.30 +
      mvScore * 0.20 +
      momScore * 0.25 +
      riskScore * 0.15 +
      qualScore * 0.10
    ).toFixed(1);

    // 应用行业调节系数 + 亏损惩罚（亏损股打7折）
    const ind = classifyIndustryForUniverse(q.name);
    const lossPenalty = isLoss ? 0.70 : 1.0;
    const poolScore = +(rawScore * ind.factor * lossPenalty).toFixed(1);

    return {
      code: q.code, name: q.name,
      amount_yi: +amountYi.toFixed(2),
      pct_chg: q.pct_chg, close: q.close, total_mv: q.total_mv,
      ret_20d: ret !== undefined ? +(ret * 100).toFixed(1) : null,
      vol_score: +volScore.toFixed(0),
      mom_score: momScore,
      mv_score: mvScore,
      risk_score: +riskScore.toFixed(0),
      qual_score: +qualScore.toFixed(0),
      score: poolScore,
      raw_score: rawScore,
      industry_group: ind.group,
      industry_factor: ind.factor,
      is_manual: manualCodes.includes(q.code) || portfolioCodes.includes(q.code) ? 1 : 0,
    };
  }).filter(Boolean);

  // 手动添加/持仓的股票强制入池，其他按总分排序取前targetSize
  const manualStocks = scored.filter(s => s.is_manual);
  const autoPool = scored.filter(s => !s.is_manual).sort((a, b) => b.score - a.score)
                         .slice(0, Math.max(0, targetSize - manualStocks.length));
  const finalPool = [...manualStocks, ...autoPool];

  // 5. 写入数据库（先标记不在池的为0，再插入/更新池内的）
  const poolCodes = new Set(finalPool.map(s => s.code));
  const existingAll = await dbAll(`SELECT code FROM stock_pool`);
  const existSet = new Set(existingAll.map(r => r.code));

  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const todayShort = dayjs().format('YYYY-MM-DD');

  // 标记不在池的股票
  if (finalPool.length > 0) {
    const placeholders = finalPool.map(() => '?').join(',');
    await dbRun(`UPDATE stock_pool SET in_pool = 0, updated_at = ? WHERE code NOT IN (${placeholders})`, [now, ...finalPool.map(s => s.code)]);
  }

  // 批量插入/更新池内股票
  const batchStmts = finalPool.map(s => {
    const reason = s.is_manual ? '手动/持仓' :
      `流动性${s.vol_score} 动量${s.mom_score} 市值${s.mv_score} 风险${s.risk_score||'-'} 质量${s.qual_score||'-'}${s.industry_group && s.industry_factor !== 1 ? ` [${s.industry_group}×${s.industry_factor}]` : ''}`;
    return {
      sql: `INSERT OR REPLACE INTO stock_pool
        (code, name, in_pool, is_manual, pool_score, pool_reason, score_volume, score_momentum,
         last_trade_date, updated_at, in_pool_date)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT in_pool_date FROM stock_pool WHERE code = ?), ?))`,
      args: [s.code, s.name, s.is_manual, s.score, reason, s.vol_score, s.mom_score,
                today, now, s.code, todayShort]
    };
  });

  // 分批处理
  for (let i = 0; i < batchStmts.length; i += 200) {
    await dbBatch(batchStmts.slice(i, i + 200));
  }

  console.log(`[pool] 股票池更新完成，共 ${finalPool.length} 只（手动${manualStocks.length}只 + 自动${autoPool.length}只），耗时 ${((Date.now()-t0)/1000).toFixed(1)}s`);
  return { total: finalPool.length, manual: manualStocks.length, auto: autoPool.length, elapsed: Date.now()-t0 };
}

/**
 * 获取当前股票池代码列表（返回纯6位码，不带sh/sz前缀，API调用时再转）
 */
async function getPoolCodes() {
  const rows = await dbAll(`SELECT code, name FROM stock_pool WHERE in_pool = 1 ORDER BY pool_score DESC`);
  return rows.map(r => r.code);
}

/**
 * 添加股票到股票池（用户手动/搜索添加）
 */
async function addToPool(code, name, isManual = true) {
  const sixCode = toSixCode(code);
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  await dbRun(`INSERT OR REPLACE INTO stock_pool
    (code, name, in_pool, is_manual, pool_score, pool_reason, updated_at, in_pool_date)
    VALUES (?, ?, 1, ?, 99, '手动添加', ?, COALESCE((SELECT in_pool_date FROM stock_pool WHERE code=?), ?))`,
    [sixCode, name || code, isManual ? 1 : 0, now, sixCode, dayjs().format('YYYY-MM-DD')]);
  return sixCode;
}

// 代码格式规范化 — 对外返回sh/sz前缀格式（给API用），内部db存纯6位
function toSixCode(code) {
  if (!code) return code;
  return String(code).toLowerCase().replace(/^(sh|sz|bj)/, '').replace(/\.(ss|sz)$/i, '');
}
function toTencentCode(code) {
  if (!code) return code;
  code = String(code).toLowerCase();
  if (code.startsWith('sh') || code.startsWith('sz') || code.startsWith('bj')) return code;
  // 处理 yahoo 格式 600519.SS → sh600519
  if (code.endsWith('.ss')) return 'sh' + code.replace('.ss','');
  if (code.endsWith('.sz')) return 'sz' + code.replace('.sz','');
  if (/^(6|5|9)/.test(code)) return 'sh' + code;
  if (/^(0|2|3)/.test(code)) return 'sz' + code;
  return 'sz' + code;
}

/**
 * 分批更新股票池（避免Render suspend）
 * 每次调用处理一批，可多次调用直到done
 * @param {number} targetSize 目标股票池大小
 * @param {number} startTime 开始时间戳，用于超时控制
 */
async function updateStockPoolBatch(targetSize = 200, startTime = 0) {
  const TIMEOUT = 45000; // 45秒超时
  const BATCH_QUOTE_SIZE = 50; // 每批拉50只行情

  // 第一次调用时初始化（用内存静态变量维护状态）
  if (!updateStockPoolBatch._state || updateStockPoolBatch._state.done) {
    const universeCodes = await getUniverseCodes();
    const manualRows = await dbAll(`SELECT code, name FROM stock_pool WHERE is_manual = 1`);
    const manualCodes = manualRows.map(r => r.code);
    const portfolioRows = await dbAll(`SELECT DISTINCT code FROM portfolio WHERE status='holding'`);
    const portfolioCodes = portfolioRows.map(r => r.code);
    const universeSet = new Set([...universeCodes, ...manualCodes, ...portfolioCodes]);
    const allCodes = [...universeSet].map(toTencentCode);

    updateStockPoolBatch._state = {
      allCodes,
      allCodesRaw: [...universeSet],
      manualCodes,
      portfolioCodes,
      targetSize,
      offset: 0,
      quotes: [],
      done: false,
    };
    console.log(`[pool-batch] 初始化，待扫描 ${allCodes.length} 只`);
  }

  const state = updateStockPoolBatch._state;
  let processed = 0;

  // 分批拉取行情
  while (state.offset < state.allCodes.length && processed < BATCH_QUOTE_SIZE) {
    const batch = state.allCodes.slice(state.offset, state.offset + BATCH_QUOTE_SIZE);
    try {
      const batchQuotes = await ds.getQuickStockList(batch);
      const cleaned = batchQuotes.map(q => ({ ...q, code: String(q.code).replace(/^(sh|sz|bj)/, '') }));
      state.quotes.push(...cleaned);
      processed += batch.length;
    } catch(e) {
      console.log(`[pool-batch] 行情拉取失败(offset=${state.offset}):`, e.message);
      // 即使失败也推进offset
      processed += batch.length;
    }
    state.offset += batch.length;

    // 超时检查
    if (startTime > 0 && Date.now() - startTime > TIMEOUT) break;
    await ds.sleep(50);
  }

  console.log(`[pool-batch] 进度: ${state.offset}/${state.allCodes.length}，已获取行情 ${state.quotes.length} 只`);

  // 如果还没拉完，返回未完成
  if (state.offset < state.allCodes.length) {
    return {
      done: false,
      progress: `${state.offset}/${state.allCodes.length}`,
      progressPct: Math.round(state.offset / state.allCodes.length * 100),
      quotesSoFar: state.quotes.length,
    };
  }

  // 全部行情拉完，开始打分筛选
  console.log(`[pool-batch] 行情拉取完成(${state.quotes.length}只)，开始打分筛选...`);

  // 拉取K线计算动量（只处理前300只高流动性）
  const momentumMap = {};
  const klineCodes = state.quotes.slice(0, Math.min(state.quotes.length, 300));
  for (let i = 0; i < klineCodes.length; i++) {
    const q = klineCodes[i];
    try {
      const kl = await ds.getDailyKline(q.code, dayjs().subtract(30, 'day').format('YYYY-MM-DD'), dayjs().format('YYYY-MM-DD'));
      if (kl && kl.length >= 15) {
        const closes = kl.map(k => k.close).filter(c => c > 0);
        if (closes.length >= 10) {
          const ret = (closes[closes.length - 1] - closes[0]) / closes[0];
          momentumMap[q.code] = ret;
        }
      }
    } catch(e) {}
    if (i % 50 === 0) await ds.sleep(80);
    // 超时检查
    if (startTime > 0 && Date.now() - startTime > TIMEOUT * 1.5) {
      console.log(`[pool-batch] 动量计算超时，已处理 ${i}/${klineCodes.length}`);
      break;
    }
  }

  // 打分与筛选
  const scored = state.quotes.map(q => {
    if (q.is_st) return null;
    if (q.name && (q.name.includes('ST') || q.name.includes('*ST'))) return null;
    if (q.name && q.name.includes('退')) return null;
    if (!q.name || q.name.trim() === '' || q.name === 'None') return null;
    if (!q.close || q.close < 2) return null;
    const amountYi = (q.amount || 0) / 10000;
    if (amountYi < 0.3) return null;
    if (q.pe !== null && q.pe !== undefined && q.pe <= -1000) return null;
    const isLoss = q.pe !== null && q.pe !== undefined && q.pe < 0 && q.pe > -1000;

    const volScore = Math.min(100, Math.max(0, Math.log10(Math.max(1, amountYi)) * 25 + 10));
    const ret = momentumMap[q.code];
    let momScore = 50;
    if (ret !== undefined) {
      if (ret > 0.5) momScore = 35;
      else if (ret > 0.3) momScore = 55;
      else if (ret > 0.15) momScore = 80;
      else if (ret > 0) momScore = 70;
      else if (ret > -0.05) momScore = 60;
      else if (ret > -0.15) momScore = 45;
      else if (ret > -0.3) momScore = 30;
      else momScore = 15;
    } else {
      const pct = q.pct_chg || 0;
      if (pct > 7) momScore = 45;
      else if (pct > 3) momScore = 65;
      else if (pct > -2) momScore = 55;
      else momScore = 35;
    }
    let mvScore = 50;
    const mv = q.total_mv || 0;
    if (mv > 0) {
      if (mv > 5000) mvScore = 85;
      else if (mv > 1000) mvScore = 80;
      else if (mv > 500) mvScore = 75;
      else if (mv > 200) mvScore = 65;
      else if (mv > 100) mvScore = 55;
      else if (mv > 50) mvScore = 40;
      else mvScore = 25;
    }

    // 风险分
    let riskScore = 60;
    const amp = q.amplitude || 0;
    if (amp > 0) {
      if (amp <= 3) riskScore = 90;
      else if (amp <= 5) riskScore = 80;
      else if (amp <= 8) riskScore = 60;
      else if (amp <= 12) riskScore = 40;
      else riskScore = 15;
    }
    if (q.pct_chg >= 9.8) riskScore = Math.max(10, riskScore - 30);
    if (q.pct_chg <= -5) riskScore = Math.max(10, riskScore - 20);

    // 质量分
    let qualScore = 50;
    const pe = q.pe;
    if (pe !== null && pe !== undefined && pe > 0) {
      if (pe >= 8 && pe <= 25) qualScore = 80;
      else if (pe >= 5 && pe < 8) qualScore = 65;
      else if (pe > 25 && pe <= 50) qualScore = 60;
      else if (pe > 50 && pe <= 100) qualScore = 35;
      else if (pe > 100) qualScore = 15;
    } else if (pe !== null && pe < 0) {
      if (pe > -20) qualScore = 20;
      else if (pe > -100) qualScore = 10;
      else qualScore = 0;
    } else {
      qualScore = 30;
    }

    const rawScore = +(volScore * 0.30 + mvScore * 0.20 + momScore * 0.25 + riskScore * 0.15 + qualScore * 0.10).toFixed(1);
    const ind = classifyIndustryForUniverse(q.name);
    const lossPenalty = isLoss ? 0.70 : 1.0;
    const poolScore = +(rawScore * ind.factor * lossPenalty).toFixed(1);

    return {
      code: q.code, name: q.name,
      amount_yi: +amountYi.toFixed(2),
      pct_chg: q.pct_chg, close: q.close, total_mv: q.total_mv,
      ret_20d: ret !== undefined ? +(ret * 100).toFixed(1) : null,
      vol_score: +volScore.toFixed(0),
      mom_score: momScore,
      mv_score: mvScore,
      risk_score: +riskScore.toFixed(0),
      qual_score: +qualScore.toFixed(0),
      score: poolScore,
      raw_score: rawScore,
      industry_group: ind.group,
      industry_factor: ind.factor,
      is_manual: state.manualCodes.includes(q.code) || state.portfolioCodes.includes(q.code) ? 1 : 0,
    };
  }).filter(Boolean);

  // 如果打分结果太少（行情数据不完整），用Universe直接入池
  let finalPool;
  if (scored.length < 50) {
    console.log(`[pool-batch] 打分结果仅${scored.length}只，用Universe直接入池`);
    finalPool = state.allCodesRaw.slice(0, state.targetSize).map((code, idx) => ({
      code, name: '', score: 50 - idx * 0.01,
      is_manual: state.manualCodes.includes(code) || state.portfolioCodes.includes(code) ? 1 : 0,
      vol_score: 50, mom_score: 50, mv_score: 50,
    }));
  } else {
    const manualStocks = scored.filter(s => s.is_manual);
    const autoPool = scored.filter(s => !s.is_manual).sort((a, b) => b.score - a.score)
                           .slice(0, Math.max(0, state.targetSize - manualStocks.length));
    finalPool = [...manualStocks, ...autoPool];
  }

  // 写入数据库
  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const todayShort = dayjs().format('YYYY-MM-DD');

  if (finalPool.length > 0) {
    const placeholders = finalPool.map(() => '?').join(',');
    await dbRun(`UPDATE stock_pool SET in_pool = 0, updated_at = ? WHERE code NOT IN (${placeholders})`, [now, ...finalPool.map(s => s.code)]);
  }

  const batchStmts = finalPool.map(s => {
    const reason = s.is_manual ? '手动/持仓' :
      `流动性${s.vol_score} 动量${s.mom_score} 市值${s.mv_score} 风险${s.risk_score||'-'} 质量${s.qual_score||'-'}${s.industry_group && s.industry_factor !== 1 ? ` [${s.industry_group}×${s.industry_factor}]` : ''}`;
    return {
      sql: `INSERT OR REPLACE INTO stock_pool
        (code, name, in_pool, is_manual, pool_score, pool_reason, score_volume, score_momentum,
         last_trade_date, updated_at, in_pool_date)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT in_pool_date FROM stock_pool WHERE code = ?), ?))`,
      args: [s.code, s.name || s.code, s.is_manual, s.score, reason, s.vol_score, s.mom_score,
                todayShort, now, s.code, todayShort]
    };
  });

  for (let i = 0; i < batchStmts.length; i += 200) {
    await dbBatch(batchStmts.slice(i, i + 200));
  }

  state.done = true;
  console.log(`[pool-batch] ✅ 股票池更新完成，共 ${finalPool.length} 只`);

  return {
    done: true,
    total: finalPool.length,
    scored: scored.length,
    progress: '100%',
    progressPct: 100,
  };
}

module.exports = { updateUniverse, getUniverseCodes, updateStockPool, updateStockPoolBatch, getPoolCodes, addToPool, toTencentCode, BUILTIN_UNIVERSE };
