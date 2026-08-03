import React, { useState, useEffect } from 'react';
import {
  Row, Col, Card, Table, Tag, Progress, Typography, Space, Button, Tooltip, Spin, Divider, Alert, Statistic,
} from 'antd';
import {
  ReloadOutlined, FireOutlined, WarningOutlined, RocketOutlined, CloudOutlined,
  RiseOutlined, FallOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import { getCrowdingOverview, triggerCrowdingCalc } from '../api';

const { Title, Text } = Typography;

// 拥挤度等级meta
const levelMeta = {
  extreme: { label: '🚨 极端危险', color: '#d92d20', bg: 'rgba(239,68,68,0.08)', advice: '立即减仓/清仓，踩踏风险极高' },
  crowded: { label: '⚠️ 拥挤预警', color: '#f04438', bg: 'rgba(239,68,68,0.08)', advice: '减仓50%，锁定利润' },
  hot: { label: '🔥 火热持有', color: '#f79009', bg: 'rgba(249,115,22,0.08)', advice: '持有不追加，密切关注' },
  warm: { label: '🟣 动量搭车', color: '#9e77ed', bg: 'rgba(168,85,247,0.08)', advice: '小仓位顺势介入，严格止损' },
  cold: { label: '🧊 冷清逆向', color: '#12b76a', bg: 'rgba(34,197,94,0.08)', advice: '关注基本面好的标的，逆向布局' },
};

const actionMeta = {
  exit: { label: '清仓', color: '#d92d20', icon: '🚨' },
  trim: { label: '减仓', color: '#f04438', icon: '⚠️' },
  hold: { label: '持有', color: '#175cd3', icon: '⏸' },
  momentum_buy: { label: '动量买入', color: '#9e77ed', icon: '🟣' },
  accumulate: { label: '布局', color: '#12b76a', icon: '🟢' },
};

const pctColor = (v) => v === null || v === undefined ? '#94A3B8' : v >= 0 ? '#f04438' : '#12b76a';
const formatPct = (v) => v === null || v === undefined ? '-' : (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%';

export default function CrowdingRadar() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [calcLoading, setCalcLoading] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try { setData(await getCrowdingOverview()); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const handleCalc = async () => {
    setCalcLoading(true);
    await triggerCrowdingCalc();
    setTimeout(load, 3000);
    setTimeout(() => setCalcLoading(false), 4000);
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 120 }}><Spin size="large" /></div>;
  if (!data) return null;

  const { market_avg_crowding, market_crowding_level, sector_levels,
    all_sectors, exit_signals, trim_signals, momentum_candidates, cold_opportunities } = data;
  const ml = levelMeta[market_crowding_level] || levelMeta.hot;

  // 板块拥挤度热力图条形图
  const sortedSectors = [...(all_sectors||[])].sort((a,b) => a.crowding_score - b.crowding_score);
  const sectorOption = {
    grid: { left: 90, right: 50, top: 10, bottom: 10 },
    xAxis: { type: 'value', min: 0, max: 100, show: false },
    yAxis: {
      type: 'category',
      data: sortedSectors.map(s => s.sector),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { fontSize: 11, color: '#94A3B8' }
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const p = params[0];
        const s = sortedSectors[p.dataIndex];
        const lvl = levelMeta[s.level] || {};
        return `<b>${s.sector}</b><br/>拥挤度: ${s.crowding_score}<br/>状态: ${lvl.label || s.level}<br/>成分股: ${s.stock_count}只`;
      }
    },
    series: [{
      type: 'bar',
      data: sortedSectors.map(s => ({
        value: s.crowding_score,
        itemStyle: {
          color: s.crowding_score >= 90 ? '#d92d20'
            : s.crowding_score >= 75 ? '#f04438'
            : s.crowding_score >= 55 ? '#f79009'
            : s.crowding_score >= 30 ? '#9e77ed'
            : '#12b76a',
          borderRadius: s.crowding_score >= 55 ? [0,3,3,0] : [3,0,0,3]
        }
      })),
      barWidth: 12,
      label: {
        show: true, position: 'right',
        formatter: (p) => p.value,
        fontSize: 10, color: '#94A3B8', fontWeight: 600,
      }
    }],
  };

  // 板块等级分布饼图
  const levelPieOption = {
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie', radius: ['40%', '70%'], center: ['50%', '50%'],
      label: { fontSize: 11, formatter: '{b}\n{c}个' },
      data: [
        { value: sector_levels.extreme, name: '极端危险', itemStyle: { color: '#d92d20' } },
        { value: sector_levels.crowded, name: '拥挤预警', itemStyle: { color: '#f04438' } },
        { value: sector_levels.hot, name: '火热持有', itemStyle: { color: '#f79009' } },
        { value: sector_levels.warm, name: '动量搭车', itemStyle: { color: '#9e77ed' } },
        { value: sector_levels.cold, name: '冷清逆向', itemStyle: { color: '#12b76a' } },
      ].filter(d => d.value > 0),
    }]
  };

  // 通用股票列配置
  const stockCols = [
    { title: '股票', dataIndex: 'name', render: (v, r) => (
      <div>
        <a onClick={() => navigate('/stock/' + r.code)} style={{ fontWeight: 600, fontSize: 13, color: '#0F172A' }}>{v}</a>
        <div style={{ fontSize: 10, color: '#94A3B8' }}>{r.code}</div>
      </div>
    )},
    { title: '拥挤度', dataIndex: 'combined_crowding_score', width: 100, align: 'center',
      render: (v) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Progress percent={v} size="small" showInfo={false}
            strokeColor={v>=85?'#d92d20':v>=70?'#f04438':v>=50?'#f79009':'#9e77ed'}
            style={{flex:1}} />
          <span style={{fontSize:12,fontWeight:700,fontFamily:'Inter',
            color: v>=85?'#d92d20':v>=70?'#f04438':'#f79009'}}>{v}</span>
        </div>
      )
    },
    { title: '5日涨幅', dataIndex: 'factors', width: 80, align: 'right',
      render: (f) => <Text style={{color:pctColor(f?.ret_5d),fontWeight:600,fontSize:12,fontFamily:'Inter'}}>{formatPct(f?.ret_5d)}</Text>
    },
    { title: '20日涨幅', dataIndex: 'factors', width: 85, align: 'right',
      render: (f) => <Text style={{color:pctColor(f?.ret_20d),fontWeight:600,fontSize:12,fontFamily:'Inter'}}>{formatPct(f?.ret_20d)}</Text>
    },
    { title: '综合分', dataIndex: 'total_score', width: 65, align: 'center',
      render: v => <span className={v>=70?'score-high':v>=60?'score-mid':'score-low'} style={{fontWeight:700}}>{v||'-'}</span>
    },
    { title: '危险信号', dataIndex: 'factors', render: (f) => (
      <Space size={4} wrap>
        {(f?.reasons||[]).map((r,i) => (
          <Tag key={i} color="red" style={{fontSize:10,margin:0}}>{r}</Tag>
        ))}
        {f?.divergence && <Tag color="volcano" style={{fontSize:10,margin:0}}>{f.divergence==='top_divergence'?'顶背离':f.divergence}</Tag>}
      </Space>
    )},
  ];

  const momentumCols = [
    { title: '股票', dataIndex: 'name', render: (v, r) => (
      <div>
        <a onClick={() => navigate('/stock/' + r.code)} style={{ fontWeight: 600, fontSize: 13, color: '#0F172A' }}>{v}</a>
        <div style={{ fontSize: 10, color: '#94A3B8' }}>{r.code}</div>
      </div>
    )},
    { title: '拥挤度', dataIndex: 'combined_crowding_score', width: 80, align: 'center',
      render: v => <span style={{color:'#9e77ed',fontWeight:700,fontSize:13}}>{v}</span>
    },
    { title: '动量状态', dataIndex: 'factors', width: 100,
      render: f => <Tag color="purple">{f?.momentum_state || 'accelerating'}</Tag>
    },
    { title: '5日涨幅', dataIndex: 'factors', width: 80, align: 'right',
      render: f => <Text style={{color:'#f04438',fontWeight:600,fontSize:12}}>{formatPct(f?.ret_5d)}</Text>
    },
    { title: '综合分', dataIndex: 'total_score', width: 65, align: 'center',
      render: v => <span className={v>=70?'score-high':'score-mid'} style={{fontWeight:700}}>{v||'-'}</span>
    },
    { title: '技术分', dataIndex: 'technical_score', width: 65, align: 'center',
      render: v => <Text style={{color:'#2e90fa',fontWeight:600}}>{v||'-'}</Text>
    },
  ];

  const coldCols = [
    { title: '股票', dataIndex: 'name', render: (v, r) => (
      <div>
        <a onClick={() => navigate('/stock/' + r.code)} style={{ fontWeight: 600, fontSize: 13, color: '#0F172A' }}>{v}</a>
        <div style={{ fontSize: 10, color: '#94A3B8' }}>{r.code}</div>
      </div>
    )},
    { title: '拥挤度', dataIndex: 'combined_crowding_score', width: 80, align: 'center',
      render: v => <span style={{color:'#12b76a',fontWeight:700,fontSize:13}}>{v}</span>
    },
    { title: '综合分', dataIndex: 'total_score', width: 65, align: 'center',
      render: v => <span className={v>=70?'score-high':'score-mid'} style={{fontWeight:700}}>{v||'-'}</span>
    },
    { title: '质量分', dataIndex: 'quality_score', width: 65, align: 'center',
      render: v => <Text style={{color:'#12b76a',fontWeight:600}}>{v||'-'}</Text>
    },
    { title: '估值分', dataIndex: 'valuation_score', width: 65, align: 'center',
      render: v => <Text style={{color:'#f04438',fontWeight:600}}>{v||'-'}</Text>
    },
    { title: '5日涨幅', dataIndex: 'factors', width: 80, align: 'right',
      render: f => <Text style={{color:pctColor(f?.ret_5d),fontWeight:600,fontSize:12}}>{formatPct(f?.ret_5d)}</Text>
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0, fontWeight: 700 }}>📡 量化拥挤度雷达</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            识别量化资金动量·搭车加速段·极端拥挤前先跑 · {data.date}
          </Text>
        </div>
        <Button icon={<ReloadOutlined spin={calcLoading}/>} onClick={handleCalc} loading={calcLoading} type="primary">
          {calcLoading ? '计算中' : '重新计算拥挤度'}
        </Button>
      </div>

      {/* 总览卡片 */}
      <Row gutter={[12,12]} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card bodyStyle={{padding:'16px 20px'}}>
            <Statistic
              title={<Text type="secondary" style={{fontSize:12}}>全市场平均拥挤度</Text>}
              value={market_avg_crowding}
              suffix="°"
              valueStyle={{ color: ml.color, fontSize: 32, fontWeight: 800, fontFamily: 'Inter' }}
            />
            <Tag style={{marginTop:8,background:ml.bg,color:ml.color,border:'none',fontWeight:600}}>
              {ml.label}
            </Tag>
            <div style={{marginTop:6,fontSize:11,color:'#94A3B8'}}>{ml.advice}</div>
          </Card>
        </Col>
        <Col span={5}>
          <Card bodyStyle={{padding:'16px 20px'}}>
            <div style={{marginBottom:8}}>
              <WarningOutlined style={{color:'#d92d20',marginRight:4}}/>
              <Text strong style={{fontSize:13,color:'#d92d20'}}>🚨 清仓预警</Text>
            </div>
            <div style={{fontSize:32,fontWeight:800,fontFamily:'Inter',color:'#d92d20'}}>
              {exit_signals.length}<span style={{fontSize:14,color:'#94A3B8',fontWeight:400,marginLeft:4}}>只</span>
            </div>
            <Text type="secondary" style={{fontSize:11}}>极端拥挤，踩踏风险极高</Text>
          </Card>
        </Col>
        <Col span={5}>
          <Card bodyStyle={{padding:'16px 20px'}}>
            <div style={{marginBottom:8}}>
              <RocketOutlined style={{color:'#9e77ed',marginRight:4}}/>
              <Text strong style={{fontSize:13,color:'#9e77ed'}}>🟣 动量搭车</Text>
            </div>
            <div style={{fontSize:32,fontWeight:800,fontFamily:'Inter',color:'#9e77ed'}}>
              {momentum_candidates.length}<span style={{fontSize:14,color:'#94A3B8',fontWeight:400,marginLeft:4}}>只</span>
            </div>
            <Text type="secondary" style={{fontSize:11}}>温和加速，小仓位顺势介入</Text>
          </Card>
        </Col>
        <Col span={8}>
          <Card bodyStyle={{padding:'16px 20px',height:'100%'}}>
            <div style={{marginBottom:8}}>
              <InfoCircleOutlined style={{color:'#94A3B8',marginRight:4}}/>
              <Text strong style={{fontSize:12,color:'#334155'}}>拥挤度策略逻辑</Text>
            </div>
            <div style={{fontSize:11,lineHeight:1.8,color:'#94A3B8'}}>
              <div>🟢 <b>0-30 冷清</b>：无人问津，逆向布局优质股</div>
              <div>🟣 <b>30-55 搭车</b>：量化刚涌入，顺势小仓位介入</div>
              <div>⏸ <b>55-75 持有</b>：趋势延续，不追加</div>
              <div>⚠️ <b>75-90 预警</b>：拥挤，准备减仓</div>
              <div>🚨 <b>90+ 极端</b>：踩踏风险极高，立即减仓</div>
            </div>
          </Card>
        </Col>
      </Row>

      {/* 板块拥挤度 + 等级分布 */}
      <Row gutter={[12,12]} style={{ marginBottom: 16 }}>
        <Col span={16}>
          <Card title={<span style={{fontSize:13,fontWeight:600}}>板块拥挤度热力图</span>} bodyStyle={{padding:'8px 12px'}}>
            <ReactECharts option={sectorOption} style={{height: Math.max(240, all_sectors.length * 28)}} />
          </Card>
        </Col>
        <Col span={8}>
          <Card title={<span style={{fontSize:13,fontWeight:600}}>板块状态分布</span>} bodyStyle={{padding:'10px'}}>
            <ReactECharts option={levelPieOption} style={{height: 260}} />
          </Card>
        </Col>
      </Row>

      {/* 危险信号 */}
      {(exit_signals.length > 0 || trim_signals.length > 0) && (
        <Card
          title={
            <Space size={8}>
              <WarningOutlined style={{color:'#d92d20'}}/>
              <span style={{fontSize:14,fontWeight:600,color:'#d92d20'}}>⚠️ 拥挤度减仓预警</span>
              <Tag color="red">{exit_signals.length + trim_signals.length}只</Tag>
            </Space>
          }
          bodyStyle={{padding: 0}}
          style={{ marginBottom: 16, borderColor: '#f04438' }}
        >
          <Alert
            message="以下个股/板块拥挤度达到极端水平，量化资金一致性过高，存在踩踏风险。建议主动减仓锁定利润，不要等放量下跌再跑。"
            type="error" showIcon style={{borderRadius:0,border:'none'}}
          />
          <Table
            columns={stockCols}
            dataSource={[...exit_signals, ...trim_signals]}
            rowKey="code"
            pagination={false}
            size="small"
            onRow={(r) => ({ style: { cursor: 'pointer' }, onClick: () => navigate('/stock/' + r.code) })}
          />
        </Card>
      )}

      {/* 动量搭车 + 冷清机会 */}
      <Row gutter={[12,12]}>
        <Col span={12}>
          <Card
            title={
              <Space size={8}>
                <RocketOutlined style={{color:'#9e77ed'}}/>
                <span style={{fontSize:14,fontWeight:600,color:'#9e77ed'}}>🟣 动量搭车机会</span>
                <Tag color="purple">{momentum_candidates.length}只</Tag>
              </Space>
            }
            bodyStyle={{padding: 0}}
            extra={<Tooltip title="量化资金刚开始涌入，动量温和加速阶段。单只仓位5%，严格-7%止损，拥挤度到80止盈">
              <InfoCircleOutlined style={{color:'#94A3B8'}}/>
            </Tooltip>}
          >
            <div style={{padding:'8px 12px',background:'rgba(168,85,247,0.06)',fontSize:11,color:'#6941c6'}}>
              💡 搭车要点：不追高，等回踩5日线介入；板块拥挤度超过80必须止盈；止损-7%不犹豫
            </div>
            <Table
              columns={momentumCols}
              dataSource={momentum_candidates}
              rowKey="code"
              pagination={false}
              size="small"
              onRow={(r) => ({ style: { cursor: 'pointer' }, onClick: () => navigate('/stock/' + r.code) })}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card
            title={
              <Space size={8}>
                <CloudOutlined style={{color:'#12b76a'}}/>
                <span style={{fontSize:14,fontWeight:600,color:'#12b76a'}}>🧊 冷清逆向机会</span>
                <Tag color="green">{cold_opportunities.length}只</Tag>
              </Space>
            }
            bodyStyle={{padding: 0}}
            extra={<Tooltip title="无人问津的优质股，基本面好+估值低+拥挤度低，适合长线布局">
              <InfoCircleOutlined style={{color:'#94A3B8'}}/>
            </Tooltip>}
          >
            <div style={{padding:'8px 12px',background:'rgba(34,197,94,0.06)',fontSize:11,color:'#027a48'}}>
              💡 逆向要点：基本面(质量分≥60) + 估值合理 + 无人关注，耐心等待价值回归
            </div>
            <Table
              columns={coldCols}
              dataSource={cold_opportunities}
              rowKey="code"
              pagination={false}
              size="small"
              onRow={(r) => ({ style: { cursor: 'pointer' }, onClick: () => navigate('/stock/' + r.code) })}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
