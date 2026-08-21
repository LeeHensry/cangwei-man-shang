/**
 * 本地拉取全市场A股快照，通过API上传到线上服务写入stock_universe表
 * 用法: node scripts/upload-universe.js [server_url]
 */
const axios = require('axios');
const iconv = require('iconv-lite');
const path = require('path');

const SERVER = process.argv[2] || 'https://cangwei-man-shang.onrender.com';
const BATCH_SIZE = 20;
const SLEEP_MS = 200;

// 腾讯行情API
const Tencent = axios.create({
  baseURL: 'https://qt.gtimg.cn',
  timeout: 10000,
  responseType: 'arraybuffer',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://gu.qq.com/',
  }
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 加载静态Universe代码列表
const BUILTIN_UNIVERSE = require('../data/stock_universe.json');

// 行业分类规则（更多关键词覆盖，减少other组）
const INDUSTRY_RULES = [
  { group: 'bank', keywords: ['银行'], factor: 0.90, cap: 50 },
  { group: 'insurance', keywords: ['保险'], factor: 0.92, cap: 15 },
  { group: 'broker', keywords: ['证券', '中信建投', '华泰'], factor: 0.93, cap: 20 },
  { group: 'realestate', keywords: ['地产', '置业', '万科', '保利', '招商蛇口', '华润', '龙湖', '金地', '绿城'], factor: 0.75, cap: 25 },
  { group: 'liquor', keywords: ['茅台', '五粮液', '泸州老窖', '汾酒', '洋河', '古井贡', '舍得', '水井坊', '酒鬼酒', '迎驾', '口子窖', '今世缘'], factor: 1.00, cap: 25 },
  { group: 'food', keywords: ['食品', '乳业', '伊利', '海天', '双汇', '安琪酵母', '桃李面包', '洽洽', '盐津', '安井', '千禾', '榨菜', '中炬高新'], factor: 1.00, cap: 25 },
  { group: 'pharmacy', keywords: ['医药', '药业', '生物', '医疗', '健康', '制药', '恒瑞', '药明', '迈瑞', '片仔癀', '云南白药', '同仁堂', '爱尔眼科', '通策'], factor: 1.03, cap: 60 },
  { group: 'semiconductor', keywords: ['半导体', '芯片', '集成电路', '微电子', '晶方', '封测', '晶圆', '光刻', '中芯', '韦尔', '兆易', '北方华创', '中微', '紫光', '长电', '通富'], factor: 1.08, cap: 40 },
  { group: 'hightech', keywords: ['电子', '光电', '激光', '通信', '浪潮', '中兴', '用友', '金山', '科大讯飞', '三六零', '软件', '信息', '科技'], factor: 1.05, cap: 50 },
  { group: 'newenergy', keywords: ['新能源', '锂电', '光伏', '风电', '宁德时代', '比亚迪', '隆基', '通威', '阳光电源', '亿纬锂能', '赣锋', '天齐', '晶澳', '天合', '晶科'], factor: 1.06, cap: 40 },
  { group: 'automotive', keywords: ['汽车', '长城汽车', '赛力斯', '长安汽车', '上汽', '广汽', '吉利', '宇通', '福耀玻璃', '比亚迪'], factor: 1.02, cap: 30 },
  { group: 'defense', keywords: ['军工', '航天', '航空', '船舶', '兵器', '中航', '中船', '航发', '导弹', '雷达'], factor: 1.04, cap: 30 },
  { group: 'homeappliance', keywords: ['家电', '美的', '格力', '海尔', '苏泊尔', '老板', '九阳', '欧派', '九阳', '小熊', '科沃斯'], factor: 1.00, cap: 20 },
  { group: 'consumer', keywords: ['消费', '零售', '美妆', '珀莱雅', '中国中免', '纺织', '服装', '李宁', '安踏', '美邦'], factor: 0.98, cap: 25 },
  { group: 'machinery', keywords: ['机械', '装备', '三一', '中联', '徐工', '汇川', '机器人', '自动化', '机床'], factor: 1.00, cap: 35 },
  { group: 'chemical', keywords: ['化工', '万华', '华鲁', '荣盛', '恒力', '化学', '化纤', '塑料'], factor: 0.92, cap: 30 },
  { group: 'steel', keywords: ['钢铁', '宝钢', '鞍钢', '首钢'], factor: 0.88, cap: 15 },
  { group: 'coal', keywords: ['煤炭', '神华', '中煤', '陕煤'], factor: 0.88, cap: 10 },
  { group: 'power', keywords: ['电力', '长江电力', '华能', '国电', '核电', '水电', '火电', '新能源电力', '华电'], factor: 0.95, cap: 30 },
  { group: 'construction', keywords: ['建筑', '建设', '中铁', '中建', '中铁建', '交建', '中交', '电建', '能建'], factor: 0.88, cap: 20 },
  { group: 'transport', keywords: ['航空', '机场', '航运', '港口', '高速', '铁路', '物流', '顺丰', '中通', '圆通', '韵达'], factor: 0.95, cap: 25 },
  { group: 'agriculture', keywords: ['农业', '种子', '牧原', '温氏', '新希望', '海大', '饲料', '养殖', '猪肉'], factor: 0.95, cap: 20 },
  { group: 'media', keywords: ['传媒', '影视', '游戏', '分众', '芒果', '出版'], factor: 0.95, cap: 15 },
  { group: 'materials', keywords: ['有色', '铜', '铝', '黄金', '紫金', '稀土', '水泥', '海螺', '建材'], factor: 0.92, cap: 25 },
  { group: 'environment', keywords: ['环保', '环境', '污水', '固废', '水务'], factor: 0.93, cap: 15 },
];

function classifyIndustry(name) {
  if (!name) return { group: 'other', factor: 1.00, cap: 600 };
  for (const rule of INDUSTRY_RULES) {
    for (const kw of rule.keywords) {
      if (name.includes(kw)) return { group: rule.group, factor: rule.factor, cap: rule.cap };
    }
  }
  return { group: 'other', factor: 1.00, cap: 600 };
}

function parseFullQuote(text) {
  const results = [];
  const lines = text.trim().split(';').filter(l => l.trim() && l.includes('~'));
  for (const line of lines) {
    const m = line.match(/v_([a-z]{2}\d+)="([^"]*)"/);
    if (!m) continue;
    const [, fullCode, data] = m;
    const parts = data.split('~');
    if (parts.length < 50) continue;
    const toNum = (v) => {
      if (v == null || v === '' || v === '-') return null;
      const n = parseFloat(v);
      return isNaN(n) ? null : n;
    };
    const market = fullCode.substring(0, 2);
    const code = parts[2];
    const name = parts[1];
    const close = toNum(parts[3]);
    if (!close || close <= 0) continue;
    results.push({
      code, name,
      market: market === 'sh' ? 'SH' : market === 'sz' ? 'SZ' : 'BJ',
      close,
      pct_chg: toNum(parts[32]),
      volume: toNum(parts[6]),
      amount: (toNum(parts[37]) || toNum(parts[36])) * 10000, // 万元→元
      amplitude: toNum(parts[43]),
      turnover: toNum(parts[38]),
      pe: (() => { const v = toNum(parts[39]); return (v != null && v > 0 && v < 10000) ? v : null; })(),
      total_mv: (() => { const v = toNum(parts[45]); return v > 0 ? Math.round(v) : null; })(), // 亿
      circ_mv: (() => { const v = toNum(parts[44]); return v > 0 ? Math.round(v) : null; })(),
      is_st: name.includes('ST') || name.includes('*ST') ? 1 : 0,
    });
  }
  return results;
}

async function fetchAllStocks(codes) {
  const allStocks = [];
  const total = codes.length;
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = codes.slice(i, i + BATCH_SIZE).join(',');
    let ok = false;
    for (let retry = 0; retry < 3 && !ok; retry++) {
      try {
        const res = await Tencent.get(`/q=${batch}`);
        const text = iconv.decode(Buffer.from(res.data), 'gbk');
        const quotes = parseFullQuote(text);
        allStocks.push(...quotes);
        ok = true;
      } catch (e) {
        if (retry === 2) console.error(`  Batch ${Math.floor(i/BATCH_SIZE)+1} failed:`, e.message);
        else await sleep(500);
      }
    }
    if ((i / BATCH_SIZE) % 10 === 0) {
      console.log(`  Progress: ${Math.min(i+BATCH_SIZE, total)}/${total}, got ${allStocks.length} stocks`);
    }
    await sleep(SLEEP_MS);
  }
  return allStocks;
}

// 百分位排名
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

function scoreStocks(stocks) {
  // 基础硬过滤
  const filtered = stocks.filter(s => {
    if (s.is_st) return false;
    if (s.name && (s.name.includes('ST') || s.name.includes('*ST') || s.name.includes('退'))) return false;
    if (s.market === 'BJ') return false;
    if (!s.close || s.close < 2) return false;
    return true;
  });
  console.log(`After filtering: ${filtered.length} stocks`);

  // 行业分类
  for (const s of filtered) {
    const ind = classifyIndustry(s.name);
    s._industryGroup = ind.group;
    s._industryFactor = ind.factor;
    s._industryCap = ind.cap;
    s._isLoss = s.pe != null && s.pe < 0;
  }

  // 准备百分位数据
  const amounts = filtered.map(s => ((s.amount || 0) / 1e8)).filter(v => v > 0).sort((a,b)=>a-b);
  const circMvs = filtered.map(s => s.circ_mv || 0).filter(v => v > 0).sort((a,b)=>a-b);
  const totalMvs = filtered.map(s => s.total_mv || 0).filter(v => v > 0).sort((a,b)=>a-b);
  const turnovers = filtered.map(s => s.turnover || 0).filter(v => v > 0).sort((a,b)=>a-b);
  const volumes = filtered.map(s => s.volume || 0).filter(v => v > 0).sort((a,b)=>a-b);

  // 打分
  for (const s of filtered) {
    const amountYi = (s.amount || 0) / 1e8;
    const cmv = s.circ_mv || 0;
    const tmv = s.total_mv || 0;

    let mvScore = 50;
    if (cmv > 0 && tmv > 0) mvScore = percentileRank(cmv, circMvs) * 0.6 + percentileRank(tmv, totalMvs) * 0.4;
    else if (cmv > 0) mvScore = percentileRank(cmv, circMvs);
    else if (tmv > 0) mvScore = percentileRank(tmv, totalMvs);

    let liqScore = 50;
    if (amountYi > 0) {
      const amtPct = percentileRank(amountYi, amounts);
      const volPct = s.volume > 0 ? percentileRank(s.volume, volumes) : 50;
      liqScore = amtPct * 0.8 + volPct * 0.2;
    }

    let activeScore = 50;
    if (s.turnover && s.turnover > 0) {
      const to = s.turnover;
      if (to >= 1 && to <= 8) activeScore = 80 + Math.min(15, (8 - Math.abs(to - 4)) * 2);
      else if (to < 1) activeScore = 30 + to * 30;
      else if (to > 15) activeScore = 25;
      else if (to > 8) activeScore = 70 - (to - 8) * 4;
      activeScore = Math.max(0, Math.min(100, activeScore));
    }

    let riskScore = 70;
    if (s.amplitude && s.amplitude > 0) {
      const amp = s.amplitude;
      if (amp <= 3) riskScore = 90;
      else if (amp <= 5) riskScore = 80;
      else if (amp <= 8) riskScore = 65;
      else if (amp <= 12) riskScore = 45;
      else riskScore = 20;
    }
    if (s.pct_chg >= 9.8) riskScore = Math.max(10, riskScore - 30);
    if (s.pct_chg <= -5) riskScore = Math.max(10, riskScore - 20);

    let valScore = 50;
    const pe = s.pe;
    if (pe != null && pe > 0) {
      if (pe >= 8 && pe <= 25) valScore = 80;
      else if (pe >= 5 && pe < 8) valScore = 65;
      else if (pe > 25 && pe <= 50) valScore = 60;
      else if (pe > 50 && pe <= 100) valScore = 40;
      else if (pe > 100) valScore = 20;
    } else if (pe != null && pe < 0) {
      if (pe > -20) valScore = 20;
      else if (pe > -100) valScore = 10;
      else valScore = 0;
    } else {
      valScore = 30;
    }

    const lossPenalty = s._isLoss ? 0.70 : 1.0;

    let dataScore = 60;
    let fieldCount = 0;
    if (s.close && s.close > 0) fieldCount++;
    if (s.amount && s.amount > 0) fieldCount++;
    if (s.circ_mv && s.circ_mv > 0) fieldCount++;
    if (s.total_mv && s.total_mv > 0) fieldCount++;
    if (s.turnover && s.turnover > 0) fieldCount++;
    if (s.volume && s.volume > 0) fieldCount++;
    if (s.pct_chg != null) fieldCount++;
    dataScore = Math.round(fieldCount / 7 * 100);

    const rawScore = +(
      mvScore * 0.25 + liqScore * 0.25 + activeScore * 0.15 +
      riskScore * 0.15 + valScore * 0.10 + dataScore * 0.10
    ).toFixed(2);
    s._adjustedScore = +(rawScore * s._industryFactor * lossPenalty).toFixed(2);
    s._mvScore = +mvScore.toFixed(1);
    s._liqScore = +liqScore.toFixed(1);
    s._activeScore = +activeScore.toFixed(1);
    s._riskScore = +riskScore.toFixed(1);
    s._valScore = +valScore.toFixed(1);
    s._dataScore = dataScore;
    s._selectReason = 'data';
  }

  // 排序
  filtered.sort((a, b) => b._adjustedScore - a._adjustedScore);

  // 分层入选 + 行业限额
  const selected = [];
  const industryCount = {};
  const selectedSet = new Set();

  function canAdd(s) {
    const g = s._industryGroup;
    if (!industryCount[g]) industryCount[g] = 0;
    const cap = s._industryCap || 80;
    if (g === 'bank' && industryCount[g] >= 50) return false;
    if (g === 'realestate' && industryCount[g] >= 25) return false;
    if (g === 'insurance' && industryCount[g] >= 15) return false;
    if (g === 'broker' && industryCount[g] >= 20) return false;
    if (industryCount[g] >= cap) return false;
    return true;
  }

  function addStock(s, reason) {
    if (selectedSet.has(s.code)) return false;
    if (!canAdd(s)) return false;
    selectedSet.add(s.code);
    industryCount[s._industryGroup] = (industryCount[s._industryGroup] || 0) + 1;
    selected.push({ ...s, _selectReason: reason });
    return true;
  }

  // Layer 1: 核心大盘 600只（要求市值足够大、流动性好）
  for (const s of filtered) {
    if (selected.length >= 600) break;
    if ((s.circ_mv && s.circ_mv >= 50) || (s.total_mv && s.total_mv >= 80)) {
      if (s._liqScore >= 20) addStock(s, 'core');
    }
  }
  for (const s of filtered) {
    if (selected.length >= 600) break;
    if (s._liqScore >= 20 && s._riskScore >= 20) addStock(s, 'core-supplement');
  }
  console.log(`Layer 1 (core): ${selected.length} stocks`);

  // Layer 2: 行业代表 300只
  const sectorGroups = {};
  for (const s of filtered) {
    if (selectedSet.has(s.code)) continue;
    const g = s._industryGroup;
    if (!sectorGroups[g]) sectorGroups[g] = [];
    sectorGroups[g].push(s);
  }
  for (const [group, stocks] of Object.entries(sectorGroups)) {
    if (selected.length >= 900) break;
    const quota = Math.max(5, Math.min(stocks.length, Math.ceil(stocks.length / filtered.length * 300 * 2)));
    const sorted = stocks.sort((a, b) => b._adjustedScore - a._adjustedScore);
    let added = 0;
    for (const s of sorted) {
      if (added >= quota) break;
      if (selected.length >= 900) break;
      if (addStock(s, 'sector-rep')) added++;
    }
  }
  for (const s of filtered) {
    if (selected.length >= 900) break;
    if (s._adjustedScore >= 30) addStock(s, 'sector-supplement');
  }
  console.log(`Layer 2 (sector): ${selected.length - 600} stocks, total ${selected.length}`);

  // Layer 3: 成长活跃 100只 - 把剩余股票全补上直到1000
  const growthGroups = new Set(['growth', 'hightech', 'tech', 'newenergy', 'healthcare', 'defense', 'pharmacy', 'semiconductor']);
  const growthCandidates = filtered.filter(s => {
    if (selectedSet.has(s.code)) return false;
    return growthGroups.has(s._industryGroup) && s._activeScore >= 30;
  }).sort((a, b) => {
    const sa = a._activeScore * 0.4 + a._industryFactor * 100 * 0.3 + a._liqScore * 0.3;
    const sb = b._activeScore * 0.4 + b._industryFactor * 100 * 0.3 + b._liqScore * 0.3;
    return sb - sa;
  });
  for (const s of growthCandidates) {
    if (selected.length >= 1000) break;
    addStock(s, 'growth-active');
  }
  // 最终补足：把所有分数>=20的剩余股票都纳入，直到1000
  for (const s of filtered) {
    if (selected.length >= 1000) break;
    if (s._adjustedScore >= 20) addStock(s, 'supplement');
  }
  console.log(`Layer 3 (growth): ${selected.length - 900} stocks, total ${selected.length}`);

  // 行业分布统计
  const industryDist = {};
  for (const s of selected) {
    industryDist[s._industryGroup] = (industryDist[s._industryGroup] || 0) + 1;
  }

  return { stocks: selected.slice(0, 1000), industryDist };
}

async function uploadToServer(stocks) {
  console.log(`\nUploading ${stocks.length} stocks to ${SERVER}...`);
  const BATCH = 30; // 减小批次避免Supabase超时
  let uploaded = 0;

  for (let i = 0; i < stocks.length; i += BATCH) {
    const batch = stocks.slice(i, i + BATCH);
    let ok = false;
    for (let retry = 0; retry < 3 && !ok; retry++) {
      try {
        const res = await axios.post(`${SERVER}/api/universe/upload-batch`, {
          stocks: batch.map(s => ({
            code: s.code,
            name: s.name,
            market: s.market,
            total_mv: s.total_mv,
            circ_mv: s.circ_mv,
            close: s.close,
            pct_chg: s.pct_chg,
            amount: s.amount,
            is_st: s.is_st || 0,
            universe_score: s._adjustedScore,
            industry_group: s._industryGroup,
            industry_factor: s._industryFactor,
            score_mv: s._mvScore,
            score_liq: s._liqScore,
            score_active: s._activeScore,
            score_risk: s._riskScore,
            score_val: s._valScore,
            score_data: s._dataScore,
            select_reason: s._selectReason,
          }))
        }, { timeout: 25000 });
        uploaded += batch.length;
        ok = true;
        if ((i/BATCH) % 5 === 0 || uploaded >= stocks.length) {
          console.log(`  Uploaded ${uploaded}/${stocks.length}`);
        }
      } catch (e) {
        if (retry === 2) {
          console.error(`  Batch ${Math.floor(i/BATCH)+1} failed:`, e.message?.substring(0, 100));
        } else {
          await sleep(1000);
        }
      }
    }
    await sleep(300);
  }
  return uploaded;
}

async function main() {
  console.log(`=== Uploading Universe to ${SERVER} ===`);
  console.log(`Static universe: ${BUILTIN_UNIVERSE.length} codes`);

  console.log('\n[1/3] Fetching real-time quotes from Tencent...');
  const quotes = await fetchAllStocks(BUILTIN_UNIVERSE);
  console.log(`Fetched ${quotes.length} valid quotes`);

  console.log('\n[2/3] Scoring and selecting top 1000...');
  const { stocks, industryDist } = scoreStocks(quotes);
  console.log('Industry distribution:', JSON.stringify(industryDist));

  console.log('\n[3/3] Uploading to server...');
  const uploaded = await uploadToServer(stocks);
  console.log(`\n=== Done! Uploaded ${uploaded} stocks ===`);
}

main().catch(e => { console.error('Fatal error:', e); process.exit(1); });
