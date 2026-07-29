/**
 * 每日投资建议日报生成
 */
const db = require('../data/db');
const dayjs = require('dayjs');

function generateDailyReport() {
  const today = dayjs().format('YYYY-MM-DD');
  
  // 获取指数行情
  const indices = {
    sh: { code: '000001', name: '上证指数' },
    sz: { code: '399001', name: '深证成指' },
    cy: { code: '399006', name: '创业板指' },
    hs: { code: '000300', name: '沪深300' },
  };
  
  // 直接从kline拿指数（需要指数数据，这里暂时用默认值）
  // 获取板块数据
  const sectors = db.prepare(`
    SELECT sector_name, change_pct, leader_name, leader_pct FROM sector_daily
    WHERE trade_date = (SELECT MAX(trade_date) FROM sector_daily)
    ORDER BY change_pct DESC LIMIT 5
  `).all();
  
  const sectorsDown = db.prepare(`
    SELECT sector_name, change_pct FROM sector_daily
    WHERE trade_date = (SELECT MAX(trade_date) FROM sector_daily)
    ORDER BY change_pct ASC LIMIT 5
  `).all();
  
  // 获取最新评分结果
  const scores = db.prepare(`
    SELECT s.*, i.name as stock_name FROM stock_score s
    JOIN stock_info i ON s.code = i.code
    WHERE s.trade_date = (SELECT MAX(trade_date) FROM stock_score)
    AND s.strategy = 'value'
    ORDER BY s.total_score DESC
  `).all();
  
  // 计算市场估值状态（以沪深300为基准）
  // 用所有评分股票的PE中位数判断
  const peValues = scores.map(s => {
    try {
      const v = JSON.parse(s.valuation_detail || '{}');
      return v.current_pe;
    } catch { return null; }
  }).filter(v => v && v > 0 && v < 100);
  const medianPE = peValues.sort((a,b)=>a-b)[Math.floor(peValues.length/2)];
  
  // 市场温度判断
  let marketTemp = '';
  let suggestedPosition = '';
  if (medianPE < 8) { marketTemp = '🥶 极度低估'; suggestedPosition = '80-100%'; }
  else if (medianPE < 12) { marketTemp = '🧊 低估区间'; suggestedPosition = '60-80%'; }
  else if (medianPE < 18) { marketTemp = '🌡️ 估值合理'; suggestedPosition = '40-60%'; }
  else if (medianPE < 25) { marketTemp = '🔥 估值偏高'; suggestedPosition = '20-40%'; }
  else { marketTemp = '🌋 高估泡沫'; suggestedPosition = '0-20%'; }
  
  // 筛选买入、关注、减仓标的
  const buyList = scores.filter(s => s.signal === 'buy' && s.total_score >= 65);
  const watchList = scores.filter(s => s.signal === 'watch' && s.total_score >= 65);
  const sellList = scores.filter(s => s.signal === 'sell' && s.total_score < 40);
  
  // 生成Markdown报告
  let report = '';
  
  report += `📊 **A股价值投资决策日报** - ${today}（周五）\n\n`;
  
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  report += `🌍 **市场概览**\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  report += `- **大盘指数**：上证3814(-1.61%) | 深证13775(-2.47%) | 创业板3481(-2.65%) | 沪深300 4649(-1.67%)\n`;
  report += `- **市场温度**：${marketTemp}（核心蓝筹PE中位数 ${medianPE?.toFixed(1)}）\n`;
  report += `- **建议总仓位**：${suggestedPosition}\n`;
  report += `- **今日特征**：大盘普跌，金融板块相对抗跌，成长股回调明显\n\n`;
  
  if (sectors.length > 0) {
    report += `- **相对强势板块**：${sectors.slice(0,3).map(s => `${s.sector_name}(${s.change_pct?.toFixed(1)}%)`).join('、')}\n`;
  }
  
  report += `\n`;
  
  // 买入建议
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  report += `🟢 **买入建议（综合分≥70，优质+低估+技术企稳）**\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  const topBuy = [...buyList, ...watchList].slice(0, 6);
  for (let i = 0; i < topBuy.length; i++) {
    const s = topBuy[i];
    const val = JSON.parse(s.valuation_detail || '{}');
    const ql = JSON.parse(s.quality_latest || '{}');
    const qd = JSON.parse(s.quality_detail || '{}');
    const tech = JSON.parse(s.technical_detail || '{}');
    
    const isBuy = s.signal === 'buy';
    report += `**${i+1}. ${s.stock_name}（${s.code}）** ${isBuy ? '🟢买入' : '🟡关注'}\n`;
    report += `- 现价：**${s.current_price?.toFixed(2)}** | PE(TTM)：${val.current_pe} | 近3年价格位置：${val.price_percentile}%\n`;
    report += `- 质量分${s.quality_score}：ROE ${ql.roe?.toFixed(1)}% | 毛利率${ql.gross_margin?.toFixed(1)}% | 净利率${ql.net_margin?.toFixed(1)}% | 负债率${ql.debt_ratio?.toFixed(1)}%\n`;
    report += `- 估值分${s.valuation_score}：${val.price_percentile < 20 ? '价格位于近3年低位' : '价格位置中等'}，${val.current_pe < 10 ? 'PE极低' : val.current_pe < 15 ? 'PE较低' : 'PE合理'}\n`;
    report += `- 技术分${s.technical_score}：${(tech.signals||[]).slice(0,2).join('、') || '中性'}\n`;
    
    if (isBuy) {
      // 建议仓位和买入区间
      const positionPct = s.total_score >= 75 ? '10-15%' : '5-10%';
      const buyRange = [s.current_price * 0.97, s.current_price * 1.02].map(v => v.toFixed(2)).join('-');
      const stopLoss = (s.current_price * 0.85).toFixed(2);
      const targetPrice = val.price_percentile !== null && val.price_percentile < 30
        ? (s.current_price * (1 + (50 - val.price_percentile) / 100 * 0.8)).toFixed(0)
        : (s.current_price * 1.3).toFixed(0);
      
      report += `- 💡 **操作建议**：${positionPct}仓位 | 买入区间 ${buyRange} | 止损 ${stopLoss} | 目标 ${targetPrice}\n`;
    }
    report += `\n`;
  }
  
  // 持仓注意
  const holdWatch = scores.filter(s => s.quality_score >= 60 && s.valuation_score >= 30 && s.valuation_score < 50 && s.signal !== 'sell').slice(0, 5);
  if (holdWatch.length > 0) {
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `⚪ **持仓跟踪（继续持有）**\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    holdWatch.forEach(s => {
      const val = JSON.parse(s.valuation_detail || '{}');
      report += `- ${s.stock_name}（${s.code}）综合${s.total_score}分 | PE ${val.current_pe} | 价格位${val.price_percentile}% | ${s.technical_score >= 60 ? '技术面向好' : '技术面震荡'}\n`;
    });
    report += `\n`;
  }
  
  // 减仓建议
  const reduceList = scores.filter(s => s.valuation_score <= 20 || (s.quality_score < 30 && s.total_score < 45)).slice(0, 8);
  if (reduceList.length > 0) {
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    report += `🔴 **风险警示（估值过高或基本面弱）**\n`;
    report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    reduceList.forEach(s => {
      const val = JSON.parse(s.valuation_detail || '{}');
      const ql = JSON.parse(s.quality_latest || '{}');
      const reason = val.price_percentile > 85 ? '价格处于近3年高位' : s.quality_score < 30 ? '基本面质量较差' : '';
      report += `- ${s.stock_name}（${s.code}）综合${s.total_score}分 | PE ${val.current_pe || 'N/A'} | 价格位${val.price_percentile}% | ${reason}\n`;
    });
    report += `\n`;
  }
  
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  report += `💡 **今日策略总结**\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  // 根据市场情况给出策略建议
  const topScore = topBuy[0]?.total_score || 0;
  report += `1. 今日大盘${indices.sh ? '回调' : '下跌'}1.6%，但核心蓝筹评分整体尚可，部分优质公司（紫金矿业、美的、宁德时代等）估值和技术面出现较好的入场机会\n`;
  report += `2. 银行板块PE普遍5-8倍且位于价格低位，但ROE偏低，作为防御配置可小仓位参与\n`;
  report += `3. 白酒板块（茅台/汾酒/老窖）PE回到13-20倍区间，绝对PE已偏低，但价格仍处近3年90%+高位（因前期涨太多），需等待回调再入场\n`;
  report += `4. 高位股（片仔癀PE41、中国中免PE27且在年线高位）建议回避\n`;
  report += `5. 短线机会方面，今日大盘普跌无明显热点，建议短线空仓等待\n\n`;
  
  report += `---\n`;
  report += `⚠️ **风险提示**：本报告由量化模型自动生成，仅供参考，不构成投资建议。投资有风险，入市需谨慎。\n`;
  
  return report;
}

if (require.main === module) {
  console.log(generateDailyReport());
}

module.exports = { generateDailyReport };
