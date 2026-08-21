/**
 * 财务数据获取（东方财富datacenter API）
 * 覆盖：ROE、毛利率、净利率、营收增速、利润增速、资产负债率、现金流等
 */
const axios = require('axios');
const https = require('https');

// 忽略SSL证书问题
const agent = new https.Agent({ rejectUnauthorized: false });

const EastMoneyDC = axios.create({
  baseURL: 'https://datacenter.eastmoney.com/securities/api/data/v1/get',
  timeout: 20000,
  httpsAgent: agent,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://emweb.securities.eastmoney.com/',
  }
});

/**
 * 获取个股主要财务指标（近N个季度）
 * 包含：ROE、毛利率、净利率、营收增速、净利增速、资产负债率、经营现金流、EPS
 */
async function getFinancialData(code, count = 20) {
  try {
    const res = await EastMoneyDC.get('', {
      params: {
        reportName: 'RPT_F10_FINANCE_MAINFINADATA',
        columns: 'ALL',
        filter: `(SECURITY_CODE="${code}")`,
        pageNumber: 1,
        pageSize: count,
        sortColumns: 'REPORT_DATE',
        sortTypes: '-1',
        source: 'HSF10',
        client: 'PC',
        _: Date.now(),
      }
    });
    
    const data = res.data?.result?.data;
    if (!data || data.length === 0) return [];
    
    return data.map(r => {
      const reportDate = r.REPORT_DATE ? r.REPORT_DATE.substring(0, 10).replace(/-/g, '') : null;
      return {
        code,
        report_date: reportDate,
        report_type: r.REPORT_TYPE || '',
        roe: r.ROEJQ,                        // ROE(加权)
        roa: r.ZZCJLL,                       // 总资产净利率
        gross_margin: r.XSMLL,               // 毛利率%
        net_margin: r.XSJLL,                 // 净利率%
        revenue: r.TOTALOPERATEREVE ? +(r.TOTALOPERATEREVE / 1e8).toFixed(2) : null,  // 亿
        revenue_yoy: r.TOTALOPERATEREVETZ,   // 营收同比%
        net_profit: r.PARENTNETPROFIT ? +(r.PARENTNETPROFIT / 1e8).toFixed(2) : null, // 亿
        net_profit_yoy: r.PARENTNETPROFITTZ, // 净利润同比%
        debt_ratio: r.ZCFZL,                 // 资产负债率%
        current_ratio: r.LD,                 // 流动比率
        ocf: r.NETCASH_OPERATE_PK ? +(r.NETCASH_OPERATE_PK / 1e8).toFixed(2) : null, // 经营现金流(亿)
        eps: r.EPSJB,                        // 基本EPS
        bps: r.BPS,                          // 每股净资产
        ocf_per_share: r.MGJYXJJE,           // 每股经营现金流
        roic: r.ROIC,                        // 投入资本回报率
      };
    });
  } catch (e) {
    console.error(`获取${code}财务数据失败:`, e.response?.status, e.message);
    return [];
  }
}

module.exports = { getFinancialData };
