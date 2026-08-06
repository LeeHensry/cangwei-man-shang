import React, { useEffect, useState, useMemo } from 'react';
import {
  Card, Row, Col, Table, Tag, Button, Typography, Statistic,
  Space, Alert, Spin, Tabs, Select, InputNumber, Form, Divider,
  Tooltip, Badge, Switch, Radio, Empty
} from 'antd';
import {
  RiseOutlined, FallOutlined, ReloadOutlined, ThunderboltOutlined,
  SafetyCertificateOutlined, CalculatorOutlined, LineChartOutlined,
  FundOutlined, WarningOutlined, CheckCircleOutlined
} from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;
const { TabPane } = Tabs;
const { Option } = Select;

// ========== 工具函数 ==========
function fmtUSD(v) {
  if (v == null || isNaN(v)) return '-';
  if (v >= 10000) return '$' + (v/1000).toFixed(1) + 'K';
  return '$' + v.toFixed(2);
}
function fmtPct(v) {
  if (v == null || isNaN(v)) return '-';
  return (v * 100).toFixed(2) + '%';
}
function fmtPrice(p) {
  if (!p) return '-';
  if (p >= 10000) return '$' + p.toLocaleString(undefined, {maximumFractionDigits: 0});
  if (p >= 100) return '$' + p.toFixed(1);
  return '$' + p.toFixed(2);
}
function fmtBTC(v) {
  if (!v) return '0';
  return v.toFixed(4) + ' BTC';
}

const priorityColor = { high: 'red', medium: 'orange', low: 'default' };
const priorityLabel = { high: '高优先级', medium: '中优先级', low: '低优先级' };

// ========== 盈亏曲线SVG ==========
function PnLChart({ curve, breakevens, currentPrice, width = 600, height = 300 }) {
  if (!curve || !curve.points || curve.points.length === 0) return <Empty />;

  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;

  const prices = curve.points.map(p => p.price);
  const pnls = curve.points.map(p => p.pnl);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const minPNL = Math.min(...pnls, 0), maxPNL = Math.max(...pnls, 0);
  const pnlRange = maxPNL - minPNL || 1;

  const xScale = p => padding.left + ((p - minP) / (maxP - minP)) * w;
  const yScale = pnl => padding.top + h - ((pnl - minPNL) / pnlRange) * h;
  const zeroY = yScale(0);

  // Build path
  const pathD = curve.points.map((p, i) => {
    const x = xScale(p.price), y = yScale(p.pnl);
    return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');

  // Area fill
  const areaD = pathD + ` L${xScale(maxP).toFixed(1)},${zeroY.toFixed(1)} L${xScale(minP).toFixed(1)},${zeroY.toFixed(1)} Z`;

  // Breakeven lines
  const beLines = (breakevens || []).map((be, i) => (
    <line key={i} x1={xScale(be)} y1={padding.top} x2={xScale(be)} y2={padding.top + h}
      stroke="#faad14" strokeWidth="1" strokeDasharray="4,3" />
  ));

  // Current price line
  const cpLine = currentPrice ? (
    <line x1={xScale(currentPrice)} y1={padding.top} x2={xScale(currentPrice)} y2={padding.top + h}
      stroke="#1890ff" strokeWidth="1.5" strokeDasharray="6,3" />
  ) : null;

  // Y axis labels
  const yLabels = [minPNL, 0, maxPNL].map((v, i) => (
    <text key={i} x={padding.left - 8} y={yScale(v)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="#8c8c8c">
      {typeof v === 'number' ? (v >= 1000 ? (v/1000).toFixed(1)+'K' : v.toFixed(0)) : v}
    </text>
  ));

  // X axis labels
  const xCount = 5;
  const xLabels = [];
  for (let i = 0; i <= xCount; i++) {
    const p = minP + (maxP - minP) * i / xCount;
    xLabels.push(
      <text key={i} x={xScale(p)} y={padding.top + h + 20} textAnchor="middle" fontSize="11" fill="#8c8c8c">
        {p >= 10000 ? '$' + (p/1000).toFixed(0) + 'K' : '$' + p.toFixed(0)}
      </text>
    );
  }

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{maxHeight: height}}>
      {/* Zero line */}
      <line x1={padding.left} y1={zeroY} x2={padding.left + w} y2={zeroY} stroke="#d9d9d9" strokeWidth="1" />
      {/* Profit area */}
      <path d={areaD} fill={maxPNL > 0 ? '#52c41a' : '#ff4d4f'} opacity="0.1" />
      {/* PnL curve */}
      <path d={pathD} fill="none" stroke="#1677ff" strokeWidth="2" />
      {/* Breakeven lines */}
      {beLines}
      {cpLine}
      {/* Axes */}
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + h} stroke="#d9d9d9" />
      <line x1={padding.left} y1={padding.top + h} x2={padding.left + w} y2={padding.top + h} stroke="#d9d9d9" />
      {yLabels}
      {xLabels}
      {/* Labels */}
      <text x={padding.left - 45} y={padding.top + h/2} textAnchor="middle" fontSize="11" fill="#8c8c8c"
        transform={`rotate(-90, ${padding.left - 45}, ${padding.top + h/2})`}>盈亏 ($)</text>
      <text x={padding.left + w/2} y={height - 5} textAnchor="middle" fontSize="11" fill="#8c8c8c">标的价格</text>
    </svg>
  );
}

// ========== 策略信号面板 ==========
function SignalsPanel({ currency }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [bias, setBias] = useState('neutral');

  const load = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/options/signals?currency=${currency}&bias=${bias}`);
      const d = await resp.json();
      setData(d);
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [currency, bias]);

  const columns = [
    {
      title: '策略', dataIndex: 'strategy', key: 'strategy', width: 160,
      render: (s, r) => (
        <Space direction="vertical" size={2}>
          <Text strong>{s}</Text>
          <Tag color={priorityColor[r.priority]}>{priorityLabel[r.priority]}</Tag>
        </Space>
      )
    },
    {
      title: '操作', dataIndex: 'action', key: 'action', width: 70,
      render: a => <Tag color={a === 'BUY' ? 'green' : 'red'}>{a === 'BUY' ? '买入' : '卖出'}</Tag>
    },
    {
      title: '方向', dataIndex: 'direction', key: 'direction', width: 70,
      render: d => {
        if (!d) return '-';
        const icon = d === 'bullish' ? <RiseOutlined style={{color:'#cf1322'}}/> : <FallOutlined style={{color:'#389e0d'}}/>;
        const label = d === 'bullish' ? '看涨' : '看跌';
        return <Space size={4}>{icon}<span>{label}</span></Space>;
      }
    },
    {
      title: '期权', key: 'option', width: 200,
      render: (_, r) => {
        if (r.option) {
          return <Text code>{r.option.instrument || `${r.option.strike} ${r.option.type.toUpperCase()}`}</Text>;
        }
        if (r.options) {
          return r.options.map((o, i) => (
            <Tag key={i}>{o.strike} {o.type.toUpperCase()}</Tag>
          ));
        }
        return '-';
      }
    },
    { title: '到期', dataIndex: 'expiryDate', key: 'expiry', width: 90, render: d => d ? d.slice(0,10) : '-' },
    { title: '剩余天数', dataIndex: 'daysToExpiry', key: 'dte', width: 80 },
    {
      title: '关键信息', key: 'reason', render: (_, r) => (
        <Space direction="vertical" size={2} style={{width:'100%'}}>
          <Text>{r.reason}</Text>
          {r.premiumPct && <Text type="secondary">权利金: {r.premiumPct} {r.annualizedReturn ? `(年化${r.annualizedReturn})` : ''}</Text>}
          {r.costPct && <Text type="secondary">成本: {r.costPct}</Text>}
          {r.moveNeeded && <Text type="secondary">需波动: {r.moveNeeded}</Text>}
          {r.totalPremiumPct && <Text type="secondary">总权利金: {r.totalPremiumPct}</Text>}
          {r.warning && <Tag icon={<WarningOutlined/>} color="warning">{r.warning}</Tag>}
        </Space>
      )
    }
  ];

  return (
    <div>
      <Space style={{marginBottom: 16}}>
        <Select value={bias} onChange={setBias} style={{width: 140}}>
          <Option value="neutral">中性观望</Option>
          <Option value="bullish">偏多看涨</Option>
          <Option value="bearish">偏空看跌</Option>
        </Select>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
        {data?.currentPrice && (
          <Text type="secondary">{currency} 指数价: <Text strong style={{color:'#cf1322'}}>{fmtPrice(data.currentPrice)}</Text></Text>
        )}
      </Space>

      {loading ? <div style={{textAlign:'center', padding:60}}><Spin size="large"/></div> :
       data?.signals?.length > 0 ? (
        <Table columns={columns} dataSource={data.signals} rowKey={(r,i)=>i} pagination={false} size="small"
          scroll={{x: 900}} />
      ) : <Empty description="暂无信号" />}
    </div>
  );
}

// ========== 期权链 ==========
function OptionChain({ currency }) {
  const [loading, setLoading] = useState(false);
  const [chain, setChain] = useState(null);
  const [selectedExpiry, setSelectedExpiry] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/options/chain?currency=${currency}`);
      const d = await resp.json();
      setChain(d);
      if (d.chains?.length > 0) setSelectedExpiry(d.chains[0].expiryTimestamp);
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [currency]);

  const currentExpiry = chain?.chains?.find(c => c.expiryTimestamp === selectedExpiry);
  const indexPrice = chain?.indexPrice || 0;

  // Build chain table: strike | call bid | call ask | call IV | call delta | put delta | put IV | put ask | put bid
  const rows = useMemo(() => {
    if (!currentExpiry) return [];
    const calls = currentExpiry.options.filter(o => o.type === 'call').sort((a,b) => a.strike - b.strike);
    const puts = currentExpiry.options.filter(o => o.type === 'put').sort((a,b) => a.strike - b.strike);
    const putByStrike = {};
    puts.forEach(p => putByStrike[p.strike] = p);

    // Filter strikes near ATM (±20%)
    return calls
      .filter(c => c.strike >= indexPrice * 0.7 && c.strike <= indexPrice * 1.3)
      .map(c => ({
        key: c.strike,
        strike: c.strike,
        isATM: Math.abs(c.strike - indexPrice) / indexPrice < 0.02,
        callBid: c.bidPrice,
        callAsk: c.askPrice,
        callIV: c.markIv,
        callDelta: c.delta,
        callGamma: c.gamma,
        callTheta: c.theta,
        callVega: c.vega,
        putBid: putByStrike[c.strike]?.bidPrice,
        putAsk: putByStrike[c.strike]?.askPrice,
        putIV: putByStrike[c.strike]?.markIv,
        putDelta: putByStrike[c.strike]?.delta,
        putGamma: putByStrike[c.strike]?.gamma,
      }));
  }, [currentExpiry, indexPrice]);

  const optFmt = (v, price) => {
    if (v == null || v <= 0) return <Text type="secondary" style={{fontSize:11}}>-</Text>;
    const usd = v * price;
    return <span>${usd.toFixed(1)} <Text type="secondary" style={{fontSize:10}}>({v.toFixed(4)})</Text></span>;
  };

  const ivFmt = v => v ? ((v || 0) * 100).toFixed(1) + '%' : '-';
  const deltaFmt = v => v != null ? v.toFixed(2) : '-';

  const columns = [
    { title: 'Call Bid', dataIndex: 'callBid', width: 120, render: v => optFmt(v, indexPrice), align: 'right' },
    { title: 'Call Ask', dataIndex: 'callAsk', width: 120, render: v => optFmt(v, indexPrice), align: 'right' },
    { title: 'IV', dataIndex: 'callIV', width: 60, render: ivFmt, align: 'center' },
    { title: 'Δ', dataIndex: 'callDelta', width: 50, render: deltaFmt, align: 'center' },
    {
      title: '行权价', dataIndex: 'strike', width: 90, align: 'center', fixed: 'center',
      render: (s, r) => (
        <Text strong style={{
          background: r.isATM ? '#e6f7ff' : 'transparent',
          padding: '2px 8px', borderRadius: 4,
          color: r.isATM ? '#1890ff' : 'inherit'
        }}>{fmtPrice(s)}</Text>
      )
    },
    { title: 'Δ', dataIndex: 'putDelta', width: 50, render: v => v != null ? v.toFixed(2) : '-', align: 'center' },
    { title: 'IV', dataIndex: 'putIV', width: 60, render: ivFmt, align: 'center' },
    { title: 'Put Ask', dataIndex: 'putAsk', width: 120, render: v => optFmt(v, indexPrice), align: 'right' },
    { title: 'Put Bid', dataIndex: 'putBid', width: 120, render: v => optFmt(v, indexPrice), align: 'right' },
  ];

  return (
    <div>
      <Space style={{marginBottom: 16}} wrap>
        <Select value={selectedExpiry} onChange={setSelectedExpiry} style={{width: 220}} loading={loading}>
          {chain?.chains?.map(c => (
            <Option key={c.expiryTimestamp} value={c.expiryTimestamp}>
              {c.expiryDate.slice(0,10)} ({c.daysToExpiry}天)
            </Option>
          ))}
        </Select>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
        {indexPrice > 0 && (
          <Tag color="blue">{currency} 指数: {fmtPrice(indexPrice)}</Tag>
        )}
      </Space>

      {currentExpiry ? (
        <Table columns={columns} dataSource={rows} pagination={false} size="small" scroll={{x: 900}}
          rowClassName={r => r.isATM ? 'atm-row' : ''}
          bordered={false} />
      ) : loading ? <div style={{textAlign:'center', padding:60}}><Spin size="large"/></div> : <Empty/>}

      <style>{`
        .atm-row td { background: #f0f5ff !important; font-weight: 600; }
        .ant-table-small .ant-table-tbody>tr>td { padding: 6px 8px; }
      `}</style>
    </div>
  );
}

// ========== 盈亏计算器 ==========
function CalculatorPanel({ currency }) {
  const [price, setPrice] = useState(null);
  const [form] = Form.useForm();
  const [result, setResult] = useState(null);

  useEffect(() => {
    fetch(`/api/options/price?currency=${currency}`).then(r=>r.json()).then(d => setPrice(d.price));
  }, [currency]);

  useEffect(() => {
    if (price) {
      form.setFieldsValue({ currentPrice: price, strike: Math.round(price * 1.1), daysToExpiry: 7, iv: 0.7 });
    }
  }, [price]);

  const [legs, setLegs] = useState([
    { id: 1, type: 'call', side: 'long', K: 0, premium: 0, quantity: 1 }
  ]);

  const addLeg = () => {
    setLegs([...legs, { id: Date.now(), type: 'call', side: 'long', K: price ? Math.round(price * 1.1) : 0, premium: 0, quantity: 1 }]);
  };
  const removeLeg = id => setLegs(legs.filter(l => l.id !== id));
  const updateLeg = (id, field, value) => {
    setLegs(legs.map(l => l.id === id ? {...l, [field]: value} : l));
  };

  const calculate = () => {
    const cp = form.getFieldValue('currentPrice') || price;
    const iv = form.getFieldValue('iv') || 0.7;
    const dte = form.getFieldValue('daysToExpiry') || 7;

    // premium已由用户填入USD值，不传默认用BS估算
    const normalizedLegs = legs.map(l => ({
      type: l.type, side: l.side, K: l.K,
      premium: l.premium > 0 ? l.premium : 0,
      quantity: l.quantity
    }));

    fetch('/api/options/calculator', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ legs: normalizedLegs, currentPrice: cp, iv, daysToExpiry: dte, range: 0.5 })
    }).then(r=>r.json()).then(d => {
      // 如果有premium=0的腿，用BS估算填充（后端自动处理）
      setResult(d);
    });
  };

  useEffect(() => {
    if (price && legs[0].K === 0) {
      updateLeg(legs[0].id, 'K', Math.round(price * 1.1));
    }
  }, [price]);

  return (
    <div>
      <Row gutter={16}>
        <Col xs={24} lg={10}>
          <Card title="期权组合构建" size="small">
            <Form form={form} layout="vertical" size="small">
              <Form.Item label={`${currency} 当前价格`} name="currentPrice">
                <InputNumber style={{width:'100%'}} prefix="$" />
              </Form.Item>
              <Row gutter={8}>
                <Col span={12}>
                  <Form.Item label="剩余天数" name="daysToExpiry">
                    <InputNumber style={{width:'100%'}} min={0} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="隐含波动率" name="iv">
                    <InputNumber style={{width:'100%'}} min={0.1} max={2} step={0.1} />
                  </Form.Item>
                </Col>
              </Row>
            </Form>

            <Divider style={{margin: '8px 0'}}>期权腿</Divider>

            {legs.map((leg, idx) => (
              <div key={leg.id} style={{padding:8, marginBottom:8, background:'#fafafa', borderRadius:6}}>
                <Space wrap style={{width:'100%'}} size={6}>
                  <Text type="secondary" style={{width:20}}>#{idx+1}</Text>
                  <Select value={leg.type} onChange={v => updateLeg(leg.id, 'type', v)} style={{width:70}} size="small">
                    <Option value="call">Call</Option>
                    <Option value="put">Put</Option>
                  </Select>
                  <Select value={leg.side} onChange={v => updateLeg(leg.id, 'side', v)} style={{width:70}} size="small">
                    <Option value="long">买入</Option>
                    <Option value="short">卖出</Option>
                  </Select>
                  <InputNumber placeholder="行权价" value={leg.K} onChange={v => updateLeg(leg.id, 'K', v)}
                    style={{width:100}} prefix="$" size="small" />
                  <InputNumber placeholder="权利金" value={leg.premium} onChange={v => updateLeg(leg.id, 'premium', v)}
                    style={{width:100}} prefix="$" size="small" />
                  <InputNumber placeholder="数量" value={leg.quantity} onChange={v => updateLeg(leg.id, 'quantity', v)}
                    style={{width:60}} min={0.1} size="small" />
                  {legs.length > 1 && (
                    <Button size="small" danger type="link" onClick={() => removeLeg(leg.id)}>删除</Button>
                  )}
                </Space>
              </div>
            ))}

            <Space>
              <Button size="small" onClick={addLeg}>+ 添加腿</Button>
              <Button type="primary" size="small" icon={<CalculatorOutlined/>} onClick={calculate}
                disabled={!price}>计算盈亏</Button>
            </Space>
          </Card>

          {result?.summary && (
            <Card title="策略分析" size="small" style={{marginTop: 12}}>
              <Statistic title="策略类型" value={result.summary.name} style={{marginBottom:12}} />
              <Row gutter={16}>
                <Col span={12}><Statistic title="最大盈利" value={result.summary.maxProfit} /></Col>
                <Col span={12}><Statistic title="最大亏损" value={result.summary.maxLoss}
                  valueStyle={{color: typeof result.summary.maxLoss === 'number' && result.summary.maxLoss < 0 ? '#cf1322' : undefined}}/></Col>
              </Row>
              <div style={{marginTop: 12}}>
                <Text type="secondary">盈亏平衡点: </Text>
                <Text strong>{result.summary.breakevens}</Text>
              </div>
              <Paragraph type="secondary" style={{marginTop:8, fontSize:12}}>{result.summary.description}</Paragraph>
            </Card>
          )}
        </Col>

        <Col xs={24} lg={14}>
          <Card title="到期盈亏曲线" size="small">
            {result?.curve ? (
              <PnLChart
                curve={result.curve}
                breakevens={result.curve.breakevens}
                currentPrice={form.getFieldValue('currentPrice') || price}
              />
            ) : (
              <div style={{padding:'60px 0', textAlign:'center'}}>
                <Text type="secondary">构建期权组合后点击「计算盈亏」查看盈亏曲线</Text>
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}

// ========== 回测面板 ==========
function BacktestPanel({ currency }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [days, setDays] = useState(365);

  const run = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/options/backtest?currency=${currency}&days=${days}`);
      const d = await resp.json();
      setResult(d);
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { run(); }, [currency]);

  const columns = [
    { title: '策略', dataIndex: 'strategy', key: 'strategy' },
    {
      title: '收益率', dataIndex: 'returns', key: 'returns', width: 120,
      render: (v, r) => {
        const pct = typeof r.returnsPct === 'number' ? r.returnsPct : parseFloat(v);
        return <Text strong style={{color: pct >= 0 ? '#cf1322' : '#389e0d'}}>{v}</Text>;
      }
    },
    { title: '最大回撤', dataIndex: 'maxDrawdown', key: 'mdd', width: 120 },
    { title: '交易次数', dataIndex: 'trades', key: 'trades', width: 90 },
    { title: '胜率', dataIndex: 'winRate', key: 'wr', width: 90, render: v => v || '-' },
  ];

  return (
    <div>
      <Space style={{marginBottom: 16}}>
        <Select value={days} onChange={setDays} style={{width:140}}>
          <Option value={90}>最近3个月</Option>
          <Option value={180}>最近6个月</Option>
          <Option value={365}>最近1年</Option>
          <Option value={730}>最近2年</Option>
        </Select>
        <Button icon={<LineChartOutlined/>} onClick={run} loading={loading} type="primary">运行回测</Button>
        {result?.historicalVolatility && (
          <Tag color="purple">历史波动率: {result.historicalVolatility}</Tag>
        )}
      </Space>

      {result?.period && (
        <Alert style={{marginBottom: 16}} type="info" showIcon
          message={`回测区间: ${result.period.start} ~ ${result.period.end} (${result.period.days}天)`} />
      )}

      {loading ? <div style={{textAlign:'center', padding:60}}><Spin size="large"/></div> :
        result?.results ? (
          <Card>
            <Table columns={columns} dataSource={result.results} rowKey="strategy" pagination={false} size="small" />
            <Alert
              style={{marginTop: 16}}
              type="warning"
              message="回测结果仅为理论模拟"
              description="历史回测不代表未来收益。期权定价使用Black-Scholes模型，实际交易中存在滑点、流动性、IV变化等因素，真实收益可能有显著差异。Gamma Explosion策略回测为简化版本，实际操作需要结合信号判断。"
              showIcon
            />
          </Card>
        ) : <Empty/>}
    </div>
  );
}

// ========== 主页面 ==========
export default function Options() {
  const [currency, setCurrency] = useState('BTC');
  const [activeTab, setActiveTab] = useState('signals');

  return (
    <div>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 16}}>
        <Space align="center" size={12}>
          <Title level={4} style={{margin:0}}>🎯 期权策略</Title>
          <Tag color="orange" icon={<ThunderboltOutlined/>}>AK策略体系</Tag>
          <Tag color="blue">Deribit</Tag>
        </Space>
        <Space>
          <Text type="secondary">标的:</Text>
          <Radio.Group value={currency} onChange={e => setCurrency(e.target.value)} optionType="button" buttonStyle="solid" size="small">
            <Radio.Button value="BTC">BTC</Radio.Button>
            <Radio.Button value="ETH">ETH</Radio.Button>
          </Radio.Group>
        </Space>
      </div>

      <Alert
        type="info"
        message="AK期权策略体系说明"
        description="基于AlbertTheKing期权交易教学，包含Gamma Explosion(末日轮)、Covered Call(备兑看涨)、Protective Put(保护性看跌)、Short Strangle(做空波动率)等策略。所有策略计算基于Deribit实时期权链数据。"
        showIcon
        style={{marginBottom: 16}}
      />

      <Card>
        <Tabs activeKey={activeTab} onChange={setActiveTab}>
          <TabPane tab={<span><ThunderboltOutlined/>策略信号</span>} key="signals">
            <SignalsPanel currency={currency} />
          </TabPane>
          <TabPane tab={<span><FundOutlined/>期权链</span>} key="chain">
            <OptionChain currency={currency} />
          </TabPane>
          <TabPane tab={<span><CalculatorOutlined/>盈亏计算</span>} key="calculator">
            <CalculatorPanel currency={currency} />
          </TabPane>
          <TabPane tab={<span><LineChartOutlined/>策略回测</span>} key="backtest">
            <BacktestPanel currency={currency} />
          </TabPane>
        </Tabs>
      </Card>
    </div>
  );
}
