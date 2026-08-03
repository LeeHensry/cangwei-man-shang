import React, { useState, useEffect } from 'react';
import {
  Row, Col, Card, Table, Tag, Progress, Typography, Space, Button, Tooltip, Spin, Divider, Alert,
} from 'antd';
import {
  ReloadOutlined, FireOutlined, RiseOutlined, InfoCircleOutlined, ArrowUpOutlined, ArrowDownOutlined,
  FundViewOutlined, WarningOutlined, RocketOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import { getOverview, triggerSync } from '../api';

const { Title, Text } = Typography;

const signalMeta = {
  buy: { label: '买入', color: '#f04438', bg: '#fef3f2', icon: '🟢' },
  watch: { label: '关注', color: '#b54708', bg: '#fffaeb', icon: '🟡' },
  hold: { label: '持有', color: '#175cd3', bg: '#f0f9ff', icon: '⏸' },
  sell: { label: '减仓', color: '#027a48', bg: '#ecfdf3', icon: '↓' },
  momentum_buy: { label: '动量搭车', color: '#9e77ed', bg: '#f9f5ff', icon: '🟣' },
};

const crowdingLevelMeta = {
  extreme: { label: '极端危险', color: '#d92d20' },
  crowded: { label: '拥挤预警', color: '#f04438' },
  hot: { label: '火热', color: '#f79009' },
  warm: { label: '动量搭车', color: '#9e77ed' },
  cold: { label: '冷清', color: '#12b76a' },
};

function IndexCard({ item }) {
  const isUp = item.pct_chg >= 0;
  const color = isUp ? '#f04438' : '#12b76a';
  return (
    <Card className="mini-chart-card" bodyStyle={{ padding: '12px 14px' }} style={{ height: '100%' }}>
      <Text type="secondary" style={{ fontSize: 11, fontWeight: 500, display: 'block', marginBottom: 4 }}>{item.name}</Text>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#101828', fontFamily: 'Inter', fontVariantNumeric: 'tabular-nums' }}>
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
      <div style={{ fontSize: 13, fontWeight: 700, color, fontFamily: 'Inter', fontVariantNumeric: 'tabular-nums' }}>{score}</div>
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

  // 行业涨跌
  const sectors = [...(data.sectors||[])].sort((a,b) => (a.change_pct||0) - (b.change_pct||0));
  const sectorOption = {
    grid: { left: 76, right: 40, top: 4, bottom: 4 },
    xAxis: { type: 'value', show: false },
    yAxis: { type: 'category', data: sectors.map(s => s.sector_name),
      axisLine: { show: false }, axisTick: { show: false }, axisLabel: { fontSize: 11, color: '#475467' }
    },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(16,24,40,0.9)', borderWidth:0, textStyle:{color:'#fff',fontSize:12} },
    series: [{
      type: 'bar', data: sectors.map(s => ({
        value: +(s.change_pct||0).toFixed(2),
        itemStyle: { color: (s.change_pct||0) >= 0 ? '#f04438' : '#12b76a', borderRadius: (s.change_pct||0) >= 0 ? [0,3,3,0] : [3,0,0,3] }
      })),
      barWidth: 11,
      label: { show: true, position: 'right', formatter: '{c}%', fontSize: 10, color: '#667085', fontWeight: 500 },
    }],
  };

  const pctColor = (v) => v === null || v === undefined ? '#98a2b3' : v >= 0 ? '#f04438' : '#12b76a';
  const formatPct = (v) => v === null || v === undefined ? '-' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';

  const topCols = [
    { title: '#', width: 32, align: 'center', render: (_, __, i) => (
      <span style={{
        width: 20, height: 20, borderRadius: 5, display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700,
        background: i < 3 ? '#fef3f2' : i < 6 ? '#fffaeb' : '#f2f4f7',
        color: i < 3 ? '#f04438' : i < 6 ? '#b54708' : '#667085',
      }}>{i+1}</span>
    )},
    { title: '股票', dataIndex: 'name', render: (v, r) => (
      <div>
        <a onClick={() => navigate('/stock/' + r.code)} style={{ fontWeight: 600, fontSize: 13, color: '#101828', whiteSpace: 'nowrap' }}>{v}</a>
        <div style={{ fontSize: 10, color: '#98a2b3', fontFamily: 'Inter' }}>{r.code}</div>
      </div>
    )},
    { title: '现价', dataIndex: 'close', align: 'right', width: 72,
      render: (v, r) => <Text style={{ fontWeight: 600, fontSize: 13, fontFamily: 'Inter', fontVariantNumeric: 'tabular-nums', color: pctColor(r.pct_chg) }}>{v?.toFixed(2)}</Text>
    },
    { title: '今日', dataIndex: 'pct_chg', align: 'right', width: 68,
      render: v => <Text style={{ fontWeight: 600, fontSize: 12, fontFamily: 'Inter', color: pctColor(v) }}>{formatPct(v)}</Text>,
      sorter: (a,b) => (a.pct_chg||0) - (b.pct_chg||0),
    },
    { title: '7日', dataIndex: 'pct_7d', align: 'right', width: 68,
      render: v => <Text style={{ fontWeight: 600, fontSize: 12, fontFamily: 'Inter', color: pctColor(v) }}>{formatPct(v)}</Text>,
      sorter: (a,b) => (a.pct_7d||0) - (b.pct_7d||0),
    },
    { title: 'PE', dataIndex: 'pe', align: 'right', width: 54,
      render: v => <Text type="secondary" style={{ fontSize: 12, fontFamily: 'Inter' }}>{v?.toFixed(1)}x</Text> },
    { title: '综合分', dataIndex: 'total_score', width: 120, align: 'center',
      sorter: (a,b)=>a.total_score-b.total_score, defaultSortOrder: 'descend',
      render: v => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Progress percent={v} size="small" showInfo={false}
            strokeColor={v >= 75 ? '#f04438' : v >= 65 ? '#f79009' : '#2e90fa'}
            style={{ flex: 1 }}
          />
          <span className={'score-badge ' + (v>=70?'score-high':v>=60?'score-mid':'score-low')}>{v}</span>
        </div>
      )
    },
    { title: '分项', align: 'center', width: 90, render: (_, r) => (
      <Space size={3}>
        <Tooltip title="质量"><span style={{ fontSize: 11, color: '#12b76a', fontWeight: 600 }}>{r.quality}</span></Tooltip>
        <Text type="secondary" style={{ fontSize: 9 }}>·</Text>
        <Tooltip title="估值"><span style={{ fontSize: 11, color: '#f04438', fontWeight: 600 }}>{r.valuation}</span></Tooltip>
        <Text type="secondary" style={{ fontSize: 9 }}>·</Text>
        <Tooltip title="技术+资金"><span style={{ fontSize: 11, color: '#2e90fa', fontWeight: 600 }}>{r.technical}</span></Tooltip>
      </Space>
    )},
    { title: '信号', dataIndex: 'signal', width: 84, align: 'center',
      render: s => <span className={'signal-badge signal-'+s} style={{whiteSpace:'nowrap'}}>{signalMeta[s]?.icon} {signalMeta[s]?.label}</span>
    },
  ];

  const signalTotal = data.total_stocks;

  return (
    <div>
      {/* 标题行 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <Title level={4} style={{ margin: 0, fontWeight: 700 }}>🥃 今日市场</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>{data.date} · {data.total_stocks}只股票 · 收盘数据</Text>
        </div>
        <Button icon={<ReloadOutlined spin={syncing}/>} onClick={handleSync} loading={syncing} type="primary" ghost size="middle">
          {syncing ? '同步中' : '刷新数据'}
        </Button>
      </div>

      {/* 拥挤度预警卡片 */}
      {data.crowding && (data.crowding.stock_warnings?.length > 0 || data.crowding.momentum_candidates?.length > 0) && (
        <Row gutter={[10,10]} style={{ marginBottom: 12 }}>
          {data.crowding.stock_warnings?.length > 0 && (
            <Col span={data.crowding.momentum_candidates?.length > 0 ? 12 : 24}>
              <Card
                size="small"
                title={
                  <Space size={6}>
                    <WarningOutlined style={{color:'#d92d20'}}/>
                    <span style={{fontSize:12,fontWeight:600,color:'#d92d20'}}>⚠️ 拥挤度预警</span>
                    <Tag color="red" style={{margin:0}}>{data.crowding.stock_warnings.length}只</Tag>
                  </Space>
                }
                extra={<a onClick={() => navigate('/crowding')} style={{fontSize:12}}>详情 →</a>}
                style={{borderColor:'#f04438'}}
                bodyStyle={{padding:'8px 12px',maxHeight:120,overflowY:'auto'}}
              >
                <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                  {data.crowding.stock_warnings.slice(0,12).map(s => (
                    <Tag
                      key={s.code}
                      onClick={() => navigate('/stock/'+s.code)}
                      style={{cursor:'pointer',background:'#fff1f0',borderColor:'#ffccc7',color:'#cf1322',fontSize:11,margin:0}}
                    >
                      {s.name} <span style={{opacity:0.7}}>{s.combined_crowding_score}°</span>
                      {s.ret_5d > 10 && <FireOutlined style={{marginLeft:2}}/>}
                    </Tag>
                  ))}
                </div>
              </Card>
            </Col>
          )}
          {data.crowding.momentum_candidates?.length > 0 && (
            <Col span={data.crowding.stock_warnings?.length > 0 ? 12 : 24}>
              <Card
                size="small"
                title={
                  <Space size={6}>
                    <RocketOutlined style={{color:'#9e77ed'}}/>
                    <span style={{fontSize:12,fontWeight:600,color:'#9e77ed'}}>🟣 动量搭车</span>
                    <Tag color="purple" style={{margin:0}}>{data.crowding.momentum_candidates.length}只</Tag>
                  </Space>
                }
                extra={<a onClick={() => navigate('/crowding')} style={{fontSize:12}}>详情 →</a>}
                bodyStyle={{padding:'8px 12px',maxHeight:120,overflowY:'auto'}}
              >
                <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                  {data.crowding.momentum_candidates.slice(0,12).map(s => (
                    <Tag
                      key={s.code}
                      onClick={() => navigate('/stock/'+s.code)}
                      style={{cursor:'pointer',background:'#f9f5ff',borderColor:'#e9d5ff',color:'#7e22ce',fontSize:11,margin:0}}
                    >
                      {s.name} <span style={{opacity:0.7}}>{s.total_score}分</span>
                    </Tag>
                  ))}
                </div>
              </Card>
            </Col>
          )}
        </Row>
      )}

      {/* 指数一行 */}
      <Row gutter={[8,8]} style={{ marginBottom: 12 }}>
        {data.indices.map(idx => <Col flex="1" key={idx.code}><IndexCard item={idx} /></Col>)}
      </Row>

      {/* 温度计6 + 信号5 + 行业5  等分 */}
      <Row gutter={[10,10]} style={{ marginBottom: 12 }}>
        {/* 市场温度计 */}
        <Col span={8}>
          <Card
            title={
              <Space size={6}>
                <FundViewOutlined style={{color:'#f79009'}}/>
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
                  <div style={{marginTop:4,color:'#98a2b3'}}>
                    资金面看两市成交额+行业资金集中度，
                    趋势看指数均线位置，情绪看当日涨跌比
                  </div>
                </div>
              }><InfoCircleOutlined style={{color:'#98a2b3',fontSize:13}}/></Tooltip>
            }
            bodyStyle={{ padding: '0 14px 10px' }}
            style={{ height: '100%' }}
          >
            <div style={{ display:'flex', alignItems:'center' }}>
              <ReactECharts option={tempOption} style={{ width: 160, height: 140 }} />
              <div style={{ flex: 1, paddingLeft: 4 }}>
                <div style={{ marginBottom: 6, textAlign:'center' }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>全市场成交 <Text strong style={{fontSize:15,color:'#101828',fontFamily:'Inter',margin:'0 2px'}}>{amountWanYi}</Text>万亿</Text>
                </div>
                <Tag style={{
                  display:'block',textAlign:'center',fontSize:12,fontWeight:600,padding:'4px 0',borderRadius:16,
                  background:'#eff8ff',color:'#175cd3',border:'none',marginBottom:10,
                }}>建议仓位 {t.suggested_position}</Tag>
              </div>
            </div>
            {/* 四维分解横排 */}
            <div style={{ display: 'flex', gap: 8 }}>
              {(t.breakdown||[]).map(b => <MiniBar key={b.label} {...b} />)}
            </div>
          </Card>
        </Col>

        {/* 信号分布 */}
        <Col span={8}>
          <Card title={<span style={{fontSize:13,fontWeight:600}}>信号分布</span>} bodyStyle={{ padding: '12px 12px' }} style={{ height: '100%' }}>
            <Row gutter={0} style={{ textAlign: 'center' }}>
              {['buy','momentum_buy','watch','hold','sell'].map(key => {
                const meta = signalMeta[key];
                const count = data.signal_counts[key] || 0;
                const pct = Math.round(count/signalTotal*100);
                return (
                  <Col span={key==='momentum_buy'?5:key==='watch'?4:5} key={key}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: meta.color, fontFamily: 'Inter', lineHeight: 1 }}>{count}</div>
                    <div className={'signal-badge signal-'+key} style={{ margin: '6px auto 2px', fontSize: 10 }}>
                      {meta.icon} {meta.label}
                    </div>
                    <Text type="secondary" style={{ fontSize: 10 }}>{pct}%</Text>
                  </Col>
                );
              })}
            </Row>
            <Divider style={{ margin: '12px 0 8px' }} />
            {/* 资金流向 */}
            <div>
              <Text type="secondary" style={{ fontSize: 11, fontWeight: 500 }}>🔥 行业资金方向</Text>
              <div style={{ marginTop: 6 }}>
                {(t.top_flow_sectors||[]).slice(0,3).map((s,i) => (
                  <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize: 12, marginBottom: 3 }}>
                    <Text>{s.name}</Text>
                    <Text style={{color:'#f04438',fontFamily:'Inter',fontWeight:600}}>+{s.net_inflow}亿</Text>
                  </div>
                ))}
                {(t.top_flow_sectors||[]).length === 0 && (
                  <Text type="secondary" style={{fontSize:11}}>今日全市场净流出，无净流入行业</Text>
                )}
                <div style={{marginTop:4,borderTop:'1px dashed #f0f0f0',paddingTop:4}}>
                  {(t.worst_flow_sectors||[]).slice(0,2).map((s,i) => (
                    <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', fontSize: 12, marginBottom: 2 }}>
                      <Text type="secondary">{s.name}</Text>
                      <Text style={{color:'#12b76a',fontFamily:'Inter',fontWeight:600}}>{s.net_inflow}亿</Text>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </Col>

        {/* 行业涨跌 */}
        <Col span={8}>
          <Card title={<span style={{fontSize:13,fontWeight:600}}>行业涨跌</span>} bodyStyle={{ padding: '4px 2px' }} style={{ height: '100%' }}>
            <ReactECharts option={sectorOption} style={{ height: 260 }} />
          </Card>
        </Col>
      </Row>

      {/* TOP10 */}
      <Card
        title={
          <Space size={8}>
            <FireOutlined style={{ color: '#f04438' }}/>
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
          size="middle"
          onRow={(r) => ({ style: { cursor: 'pointer' }, onClick: () => navigate('/stock/' + r.code) })}
        />
      </Card>
    </div>
  );
}
