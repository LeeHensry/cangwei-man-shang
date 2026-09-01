import React, { useState, useEffect } from 'react';
import {
  Row, Col, Card, Table, Tag, Progress, Typography, Space, Button, Tooltip, Spin, Divider, Alert,
} from 'antd';
import {
  ReloadOutlined, FireOutlined, RiseOutlined, InfoCircleOutlined, ArrowUpOutlined, ArrowDownOutlined,
  FundViewOutlined, CheckCircleOutlined, FallOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import { getOverview, triggerSync } from '../api';
import { useIsMobile } from '../utils/useIsMobile';

const { Title, Text } = Typography;

const signalMeta = {
  buy: { label: '买入', color: 'var(--up)', bg: 'var(--up-soft)', icon: '' },
  watch: { label: '关注', color: 'var(--warn)', bg: 'var(--warn-soft)', icon: '' },
  hold: { label: '持有', color: 'var(--accent)', bg: 'var(--accent-soft)', icon: '' },
  sell: { label: '减仓', color: 'var(--down)', bg: 'var(--down-soft)', icon: '' },
  momentum_buy: { label: '动量搭车', color: 'var(--purple)', bg: 'var(--purple-soft)', icon: '' },
};

function IndexCard({ item }) {
  const isUp = item.pct_chg >= 0;
  const color = isUp ? 'var(--up)' : 'var(--down)';
  return (
    <Card className="mini-chart-card" bodyStyle={{ padding: '12px 14px' }} style={{ height: '100%' }}>
      <Text type="secondary" style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>{item.name}</Text>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#1A1A1E', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
          {item.close?.toFixed(item.close > 1000 ? 0 : item.close > 100 ? 1 : 2)}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color, whiteSpace: 'nowrap' }}>
          {isUp ? '+' : ''}{item.pct_chg?.toFixed(2)}%
        </span>
      </div>
    </Card>
  );
}

function MiniBar({ label, score, color }) {
  return (
      <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>{score}</div>
      <Text type="secondary" style={{ fontSize: 10 }}>{label}</Text>
      <Progress percent={score} showInfo={false} strokeColor={color} size="small" style={{ marginTop: 2 }} />
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const load = async () => {
    setLoading(true);
    try { setData(await getOverview()); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const handleSync = async () => {
    setSyncing(true);
    await triggerSync();
    setTimeout(load, 2500);
    setTimeout(() => setSyncing(false), 4000);
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 120 }}><Spin size="large" /></div>;
  if (!data) return null;

  const t = data.temperature;
  const amountWanYi = (t.total_amount / 10000).toFixed(2);

  // 温度计gauge（缩小版）
  const tempOption = {
    series: [{
      type: 'gauge',
      startAngle: 210, endAngle: -30,
      min: 0, max: 100, radius: '95%', center: ['50%','62%'],
      progress: { show: true, width: 12, roundCap: true },
      axisLine: { lineStyle: { width: 12, roundCap: true, color: [
        [0.2, '#12b76a'], [0.35, '#32d583'], [0.55, '#fac515'], [0.7, '#f79009'], [0.85, '#f04438'], [1, '#d92d20']
      ]}},
      pointer: { length: '50%', width: 2, itemStyle: { color: '#344054' } },
      anchor: { show: true, size: 8, itemStyle: { color: '#fff', borderColor: '#344054', borderWidth: 2 } },
      axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
      title: { show: false },
      detail: {
        valueAnimation: true, fontSize: 26, fontWeight: 700, offsetCenter: [0,'-5%'],
        formatter: () => t.value + '°', color: t.color, fontFamily: 'Inter',
      },
      data: [{ value: t.value }],
    }],
  };

  // 行业涨跌（横向条形图，显示涨跌TOP各5）
  const sectorUp = [...(data.sectors||[])].sort((a,b) => (b.change_pct||0) - (a.change_pct||0)).slice(0, 5);
  const sectorDown = [...(data.sectors||[])].sort((a,b) => (a.change_pct||0) - (b.change_pct||0)).slice(0, 5);
  const sectorsForChart = [...sectorDown.reverse(), ...sectorUp];
  const sectorOption = {
    grid: { left: 68, right: 36, top: 2, bottom: 2 },
    xAxis: { type: 'value', show: false, min: (v) => Math.floor(v.min - 0.3), max: (v) => Math.ceil(v.max + 0.3) },
    yAxis: { type: 'category', data: sectorsForChart.map(s => s.sector_name),
      axisLine: { show: false }, axisTick: { show: false }, axisLabel: { fontSize: 10, color: '#475467' }
    },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(16,24,40,0.9)', borderWidth:0, textStyle:{color:'#fff',fontSize:11} },
    series: [{
      type: 'bar', data: sectorsForChart.map(s => ({
        value: +(s.change_pct||0).toFixed(2),
        itemStyle: { color: (s.change_pct||0) >= 0 ? '#EF4444' : '#22C55E', borderRadius: (s.change_pct||0) >= 0 ? [0,3,3,0] : [3,0,0,3] }
      })),
      barWidth: 10,
      label: { show: true, position: 'right', formatter: '{c}%', fontSize: 9, color: '#667085', fontWeight: 500 },
    }],
  };

  const pctColor = (v) => v === null || v === undefined ? '#8E8E93' : v >= 0 ? 'var(--up)' : 'var(--down)';
  const formatPct = (v) => v === null || v === undefined ? '-' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';

  const topCols = [
    { title: '#', width: 32, align: 'center', render: (_, __, i) => (
      <span style={{
        width: 20, height: 20, borderRadius: 5, display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700,
        background: i < 3 ? 'var(--up-soft)' : i < 6 ? 'var(--warn-soft)' : '#f2f4f7',
        color: i < 3 ? 'var(--up)' : i < 6 ? 'var(--warn)' : '#3A3A3C',
      }}>{i+1}</span>
    )},
    { title: '股票', dataIndex: 'name', render: (v, r) => (
      <div>
        <a onClick={() => navigate('/stock/' + r.code)} style={{ fontWeight: 600, fontSize: 13, color: '#1A1A1E', whiteSpace: 'nowrap' }}>{v}</a>
        <div style={{ fontSize: 10, color: '#8E8E93', fontFamily: 'var(--font-mono)' }}>{r.code}</div>
      </div>
    )},
    { title: '现价', dataIndex: 'close', align: 'right', width: 72,
      render: (v, r) => <Text style={{ fontWeight: 600, fontSize: 13, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: pctColor(r.pct_chg) }}>{v?.toFixed(2)}</Text>
    },
    { title: '今日', dataIndex: 'pct_chg', align: 'right', width: 68,
      render: v => <Text style={{ fontWeight: 600, fontSize: 12, fontFamily: 'var(--font-mono)', color: pctColor(v) }}>{formatPct(v)}</Text>,
      sorter: (a,b) => (a.pct_chg||0) - (b.pct_chg||0),
    },
    { title: '7日', dataIndex: 'pct_7d', align: 'right', width: 68,
      render: v => <Text style={{ fontWeight: 600, fontSize: 12, fontFamily: 'var(--font-mono)', color: pctColor(v) }}>{formatPct(v)}</Text>,
      sorter: (a,b) => (a.pct_7d||0) - (b.pct_7d||0),
    },
    { title: 'PE', dataIndex: 'pe', align: 'right', width: 54,
      render: v => <Text type="secondary" style={{ fontSize: 12, fontFamily: 'var(--font-mono)' }}>{v?.toFixed(1)}x</Text> },
    { title: '综合分', dataIndex: 'total_score', width: 120, align: 'center',
      sorter: (a,b)=>a.total_score-b.total_score, defaultSortOrder: 'descend',
      render: v => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Progress percent={v} size="small" showInfo={false}
            strokeColor={v >= 75 ? 'var(--up)' : v >= 65 ? 'var(--warn)' : 'var(--accent)'}
            style={{ flex: 1 }}
          />
          <span className={'score-badge ' + (v>=70?'score-high':v>=60?'score-mid':'score-low')}>{v}</span>
        </div>
      )
    },
    { title: '分项', align: 'center', width: 90, render: (_, r) => (
      <Space size={3}>
        <Tooltip title="质量"><span style={{ fontSize: 11, color: 'var(--down)', fontWeight: 600 }}>{r.quality}</span></Tooltip>
        <Text type="secondary" style={{ fontSize: 9 }}>·</Text>
        <Tooltip title="估值"><span style={{ fontSize: 11, color: 'var(--up)', fontWeight: 600 }}>{r.valuation}</span></Tooltip>
        <Text type="secondary" style={{ fontSize: 9 }}>·</Text>
        <Tooltip title="技术+资金"><span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>{r.technical}</span></Tooltip>
      </Space>
    )},
    { title: '信号', dataIndex: 'signal', width: 84, align: 'center',
      render: s => <span className={'signal-badge signal-'+s} style={{whiteSpace:'nowrap'}}>{signalMeta[s]?.label}</span>
    },
  ];

  const signalTotal = data.total_stocks;

  return (
    <div>
      {/* 标题行 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', marginBottom: 12, flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 8 : 0 }}>
        <div>
          <Title level={isMobile ? 5 : 4} style={{ margin: 0, fontWeight: 700 }}>今日市场</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>{data.date} · {data.total_stocks}只股票 · 收盘数据</Text>
        </div>
        <Button icon={<ReloadOutlined spin={syncing}/>} onClick={handleSync} loading={syncing} size={isMobile ? "small" : "middle"}>
          {syncing ? '同步中' : '刷新数据'}
        </Button>
      </div>

      {/* 指数一行 */}
      <Row gutter={[8,8]} style={{ marginBottom: 12 }}>
        {data.indices.map((idx, i) => <Col xs={12} sm={12} md={6} lg={6} xl={Math.floor(24/data.indices.length)} key={idx.code}><IndexCard item={idx} /></Col>)}
      </Row>

      {/* 温度计6 + 信号分布(含行业涨跌)18  等分 */}
      <Row gutter={[10,10]} style={{ marginBottom: 12 }}>
        {/* 市场温度计 */}
        <Col xs={24} lg={8}>
          <Card
            title={
              <Space size={6}>
                <FundViewOutlined style={{color:'var(--warn)'}}/>
                <span style={{fontSize:13,fontWeight:600}}>市场温度</span>
                <Tag style={{
                  fontSize:10, padding:'0 6px', borderRadius:10, lineHeight:'16px',
                  background:t.color+'15', color:t.color, border:'none', fontWeight:600,
                }}>{t.label}</Tag>
              </Space>
            }
            extra={
              <Tooltip title={
                <div style={{maxWidth:260,fontSize:12,lineHeight:1.7}}>
                  <div style={{fontWeight:600,marginBottom:4}}>四维加权评分：</div>
                  <div>估值30% · 资金35% · 趋势20% · 情绪15%</div>
                  <div style={{marginTop:4,color:'#8E8E93'}}>
                    资金面看两市成交额+行业资金集中度，
                    趋势看指数均线位置，情绪看当日涨跌比
                  </div>
                </div>
              }><InfoCircleOutlined style={{color:'#8E8E93',fontSize:13}}/></Tooltip>
            }
            bodyStyle={{ padding: '0 14px 10px' }}
            style={{ height: '100%' }}
          >
            <div style={{ display:'flex', alignItems:'center' }}>
              <ReactECharts option={tempOption} style={{ width: isMobile ? 130 : 160, height: isMobile ? 120 : 140, flexShrink: 0 }} />
              <div style={{ flex: 1, paddingLeft: 4 }}>
                <div style={{ marginBottom: 6, textAlign:'center' }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>全市场成交 <Text strong style={{fontSize:15,color:'#1A1A1E',fontFamily:'var(--font-mono)',margin:'0 2px'}}>{amountWanYi}</Text>万亿</Text>
                </div>
                <Tag style={{
                  display:'block',textAlign:'center',fontSize:12,fontWeight:600,padding:'4px 0',borderRadius:16,
                  background:'var(--accent-soft)',color:'var(--accent)',border:'none',marginBottom:10,
                }}>建议仓位 {t.suggested_position}</Tag>
              </div>
            </div>
            {/* 四维分解横排 */}
            <div style={{ display: 'flex', gap: 8 }}>
              {(t.breakdown||[]).map(b => <MiniBar key={b.label} {...b} />)}
            </div>
          </Card>
        </Col>

        {/* 信号分布 + 行业涨跌（整合） */}
        <Col xs={24} lg={16}>
          <Card
            title={
              <Space size={8}>
                <CheckCircleOutlined style={{color:'var(--accent)'}}/>
                <span style={{fontSize:13,fontWeight:600}}>信号分布</span>
                <Text type="secondary" style={{fontSize:11,fontWeight:400}}>· 行业来源：新浪财经行业板块</Text>
              </Space>
            }
            bodyStyle={{ padding: '12px 16px' }}
            style={{ height: '100%' }}
          >
            {/* 信号数字行 */}
            <Row gutter={0} style={{ textAlign: 'center', marginBottom: 8 }}>
              {['buy','momentum_buy','watch','hold','sell'].map(key => {
                const meta = signalMeta[key];
                const count = data.signal_counts[key] || 0;
                const pct = Math.round(count/signalTotal*100);
                return (
                  <Col key={key}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: meta.color, fontFamily: 'var(--font-mono)', lineHeight: 1 }}>{count}</div>
                    <div className={'signal-badge signal-'+key} style={{ margin: '6px auto 2px', fontSize: 10 }}>
                      {meta.label}
                    </div>
                    <Text type="secondary" style={{ fontSize: 10 }}>{pct}%</Text>
                  </Col>
                );
              })}
            </Row>
            <Divider style={{ margin: '8px 0' }} />
            {/* 行业涨跌条形图（整合到信号分布卡片） */}
            <div>
              <Row gutter={12}>
                <Col xs={24} md={14}>
                  <Text type="secondary" style={{ fontSize: 11, fontWeight: 500 }}><RiseOutlined style={{color:'var(--up)',fontSize:11,marginRight:2}}/>行业涨跌（实时）</Text>
                  <ReactECharts option={sectorOption} style={{ height: 170, marginTop: 2 }} />
                </Col>
                <Col xs={24} md={10}>
                  {/* 资金流向 */}
                  <Text type="secondary" style={{ fontSize: 11, fontWeight: 500 }}><FireOutlined style={{color:'var(--warn)',fontSize:11,marginRight:2}}/>行业资金方向</Text>
                  <div style={{ marginTop: 6 }}>
                    <Text style={{fontSize:10,color:'var(--up)',fontWeight:600}}>▲ 净流入 TOP3</Text>
                    {(t.top_flow_sectors||[]).slice(0,3).map((s,i) => (
                      <div key={'in'+i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize: 12, marginBottom: 3 }}>
                        <Text>{s.name}</Text>
                        <Text style={{color:'var(--up)',fontFamily:'var(--font-mono)',fontWeight:600}}>+{s.net_inflow}亿</Text>
                      </div>
                    ))}
                    {(t.top_flow_sectors||[]).length === 0 && (
                      <Text type="secondary" style={{fontSize:11}}>无明显净流入</Text>
                    )}
                    <div style={{marginTop:6,borderTop:'1px dashed #E8E8ED',paddingTop:6}}>
                      <Text style={{fontSize:10,color:'var(--down)',fontWeight:600}}>▼ 净流出 TOP3</Text>
                      {(t.worst_flow_sectors||[]).slice(0,3).map((s,i) => (
                        <div key={'out'+i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize: 12, marginBottom: 2 }}>
                          <Text type="secondary">{s.name}</Text>
                          <Text style={{color:'var(--down)',fontFamily:'var(--font-mono)',fontWeight:600}}>{s.net_inflow}亿</Text>
                        </div>
                      ))}
                    </div>
                  </div>
                </Col>
              </Row>
            </div>
          </Card>
        </Col>
      </Row>

      {/* TOP10 */}
      <Card
        title={
          <Space size={8}>
            <FireOutlined style={{ color: 'var(--up)' }}/>
            <span style={{ fontSize: 14, fontWeight: 600 }}>TOP 10 推荐</span>
            <Tag color="red" style={{ margin: 0 }}>{data.top_stocks.length}只</Tag>
          </Space>
        }
        extra={<a onClick={() => navigate('/signals')} style={{ fontSize: 13 }}>查看全部 →</a>}
      >
        <Table
          columns={topCols}
          dataSource={data.top_stocks}
          rowKey="code"
          pagination={false}
          size={isMobile ? "small" : "middle"}
          scroll={{ x: isMobile ? 650 : undefined }}
          onRow={(r) => ({ style: { cursor: 'pointer' }, onClick: () => navigate('/stock/' + r.code) })}
        />
      </Card>
    </div>
  );
}
