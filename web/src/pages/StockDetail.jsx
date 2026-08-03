import React, { useState, useEffect } from 'react';
import {
  Card, Row, Col, Descriptions, Tag, Progress, Table, Typography,
  Spin, Space, Statistic, Divider, Segmented, Tooltip,
} from 'antd';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeftOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { getStockDetail } from '../api';

const { Title, Text } = Typography;

const signalMeta = {
  buy: { color: '#f04438', label: '🟢 买入建议', bg: '#fef3f2' },
  watch: { color: '#b54708', label: '🟡 建议关注', bg: '#fffaeb' },
  hold: { color: '#175cd3', label: '⚪ 继续持有', bg: '#f0f9ff' },
  sell: { color: '#027a48', label: '🔴 建议减仓', bg: '#ecfdf3' },
};

function ScoreRing({ value, color, size = 80, label }) {
  const option = {
    series: [{
      type: 'gauge', radius: '100%', center: ['50%','55%'],
      startAngle: 220, endAngle: -40, min:0, max:100,
      progress: { show: true, width: 8, roundCap: true, itemStyle: { color } },
      axisLine: { lineStyle: { width: 8, color: [[1,'#f2f4f7']], roundCap: true } },
      pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
      title: { show: false },
      detail: { valueAnimation: true, fontSize: 22, fontWeight: 700, color: '#101828', offsetCenter: [0,0],
        formatter: () => value, fontFamily: 'Inter' },
      data: [{ value }],
    }],
    graphic: [{
      type: 'text', bottom: 10, left: 'center',
      style: { text: label, fontSize: 11, fill: '#98a2b3', fontWeight: 500 }
    }],
  };
  return <ReactECharts option={option} style={{ height: size + 20, width: size }} />;
}

export default function StockDetail() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('1y');

  useEffect(() => {
    setLoading(true);
    getStockDetail(code).then(d => { setData(d); setLoading(false); });
  }, [code]);

  if (loading) return <div style={{ textAlign: 'center', padding: 120 }}><Spin size="large" /></div>;
  if (!data) return <div>加载失败</div>;

  const s = data.score || {};
  const ql = s.quality_latest || {};
  const vd = s.valuation_detail || {};
  const qd = s.quality_detail || {};
  const td = s.technical_detail || {};

  let klineData = data.klines || [];
  const rangeMap = { '1m': 20, '3m': 60, '6m': 120, '1y': 250, 'all': klineData.length };
  klineData = klineData.slice(-rangeMap[range]);
  const dates = klineData.map(k => k.date);
  const ohlc = klineData.map(k => [k.open, k.close, k.low, k.high]);
  const volumes = klineData.map(k => ({ value: k.volume, itemStyle: { color: k.close>=k.open?'#f04438':'#12b76a' }}));

  const klineOption = {
    animation: false,
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' },
      backgroundColor: 'rgba(16,24,40,0.92)', borderWidth:0, textStyle:{color:'#fff',fontSize:12},
    },
    legend: { data:['K','MA5','MA20','MA60'], top: 8, right: 16, textStyle:{fontSize:11,color:'#667085'},
      itemWidth: 14, itemHeight: 2,
    },
    grid: [
      { left: 50, right: 16, top: 44, height: '56%' },
      { left: 50, right: 16, top: '74%', height: '14%' },
    ],
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    xAxis: [
      { type: 'category', data: dates, scale: true, boundaryGap: false,
        axisLine: { lineStyle: { color: '#eaecf0' } }, axisLabel: { fontSize: 10, color: '#98a2b3' },
        splitLine: { show: false }, min: 'dataMin', max: 'dataMax' },
      { type: 'category', gridIndex: 1, data: dates, axisLabel: { show:false }, axisLine: {show:false}, axisTick:{show:false}, splitLine:{show:false} },
    ],
    yAxis: [
      { scale: true, splitLine: { lineStyle: { type: 'dashed', color: '#f5f5f5' } },
        axisLine: { show: false }, axisTick: { show: false }, axisLabel: { fontSize: 10, color: '#98a2b3' } },
      { scale: true, gridIndex: 1, splitNumber: 2, axisLabel: { show:false }, axisLine:{show:false}, axisTick:{show:false}, splitLine:{show:false} },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0,1], start: 0, end: 100 },
    ],
    series: [
      { name:'K', type:'candlestick', data:ohlc,
        itemStyle: { color:'#f04438', color0:'#12b76a', borderColor:'#f04438', borderColor0:'#12b76a' } },
      { name:'MA5', type:'line', data:klineData.map(k=>k.ma5), smooth:true, symbol:'none', lineStyle:{width:1,color:'#f79009'} },
      { name:'MA20', type:'line', data:klineData.map(k=>k.ma20), smooth:true, symbol:'none', lineStyle:{width:1,color:'#2e90fa'} },
      { name:'MA60', type:'line', data:klineData.map(k=>k.ma60), smooth:true, symbol:'none', lineStyle:{width:1,color:'#9e77ed'} },
      { name:'成交量', type:'bar', xAxisIndex:1, yAxisIndex:1, data:volumes, barWidth:'55%' },
    ],
  };

  // 雷达
  const radarOption = {
    radar: {
      indicator: [
        { name: '盈利能力', max: 30, color: '#667085' },
        { name: '成长性', max: 25, color: '#667085' },
        { name: '财务健康', max: 25, color: '#667085' },
        { name: '稳定性', max: 20, color: '#667085' },
      ],
      radius: '65%', center: ['50%','55%'],
      axisName: { fontSize: 11, color: '#475467' },
      splitArea: { areaStyle: { color: ['#fafbfc','#fff'] } },
      axisLine: { lineStyle: { color: '#eaecf0' } },
      splitLine: { lineStyle: { color: '#eaecf0' } },
    },
    series: [{
      type: 'radar',
      data: [{ value: [qd.profit||0,qd.growth||0,qd.health||0,qd.extra||0],
        areaStyle: { color: 'rgba(22,119,255,0.15)' },
        lineStyle: { color: '#1677ff', width: 2 },
        itemStyle: { color: '#1677ff' }, symbol:'circle', symbolSize:5,
      }],
    }],
  };

  const curPrice = klineData[klineData.length-1]?.close || s.current_price;
  const changePct = klineData[klineData.length-1]?.pct_chg;
  const isUp = changePct >= 0;

  return (
    <div>
      <a onClick={() => navigate(-1)} style={{ marginBottom: 16, display: 'inline-block', fontSize: 13, color: '#667085' }}>
        <ArrowLeftOutlined /> 返回
      </a>

      {/* 头部卡片 */}
      <Card style={{ marginBottom: 16 }} bodyStyle={{ padding: '20px 24px' }}>
        <Row gutter={24} align="middle">
          <Col flex="auto">
            <Space align="baseline" size={12}>
              <Title level={3} style={{ margin: 0, fontWeight: 700 }}>{data.name}</Title>
              <Text type="secondary" style={{ fontSize: 15, fontFamily: 'Inter', fontVariantNumeric: 'tabular-nums' }}>{code}</Text>
              <Tag color={data.is_new_economy?'volcano':data.is_oldman?'default':'blue'}
                style={{ borderRadius: 20, margin:0, padding: '2px 10px', fontSize: 11 }}>
                {data.is_new_economy?'🚀 新经济':data.is_oldman?'👴 传统':data.industry}
              </Tag>
              {data.total_mv && <Text type="secondary" style={{fontSize:12}}>市值 {data.total_mv.toLocaleString()}亿</Text>}
            </Space>
            <Space align="baseline" style={{ marginTop: 12 }} size={16}>
              <span style={{ fontSize: 36, fontWeight: 700, color: isUp?'#f04438':'#12b76a', fontFamily:'Inter', fontVariantNumeric:'tabular-nums', lineHeight: 1 }}>
                {curPrice?.toFixed(2)}
              </span>
              <span style={{ fontSize: 16, fontWeight: 600, color: isUp?'#f04438':'#12b76a', display:'inline-flex',alignItems:'center',gap:4 }}>
                {isUp?'▲':'▼'} {isUp?'+':''}{changePct?.toFixed(2)}%
              </span>
            </Space>
          </Col>
          {s.signal && (
            <Col>
              <div style={{
                background: signalMeta[s.signal].bg, borderRadius: 14, padding: '14px 22px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 13, color: signalMeta[s.signal].color, fontWeight: 600 }}>{signalMeta[s.signal].label}</div>
                <div style={{ fontSize: 36, fontWeight: 700, color: signalMeta[s.signal].color, fontFamily: 'Inter', lineHeight: 1.2 }}>{s.total}</div>
                <div style={{ fontSize: 11, color: '#98a2b3' }}>综合评分</div>
              </div>
            </Col>
          )}
        </Row>

        {s.signal === 'buy' && (
          <div style={{ marginTop: 20, padding: '16px 20px', background: '#fef3f2', borderRadius: 10, border: '1px solid #fee4e2' }}>
            <Row gutter={24}>
              <Col span={6}>
                <Statistic title="💡 建议仓位" value={s.position_pct||10} suffix="%" valueStyle={{ fontSize: 22, fontWeight:700, color:'#f04438' }} />
              </Col>
              <Col span={6}>
                <Statistic title="🎯 目标价" value={s.target_price} prefix="¥" valueStyle={{ fontSize: 22, fontWeight:700, color:'#f04438' }} />
              </Col>
              <Col span={6}>
                <Statistic title="🛑 止损价" value={s.stop_loss} prefix="¥" valueStyle={{ fontSize: 22, fontWeight:700, color:'#12b76a' }} />
              </Col>
              <Col span={6}>
                <Statistic title="📈 潜在空间"
                  value={s.target_price && curPrice ? ((s.target_price/curPrice-1)*100).toFixed(1) : '-'} suffix="%"
                  valueStyle={{ fontSize: 22, fontWeight:700, color:'#f04438' }} />
              </Col>
            </Row>
          </div>
        )}
      </Card>

      {/* 三个评分数 */}
      <Row gutter={14} style={{ marginBottom: 14 }}>
        <Col span={8}>
          <Card bodyStyle={{ padding: '16px 20px', display:'flex', alignItems:'center', gap:16 }}>
            <ScoreRing value={s.quality} color="#12b76a" label="质量" size={90} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#101828', marginBottom: 8 }}>质量评分</div>
              <Space direction="vertical" size={2} style={{ width: '100%' }}>
                {[['盈利',qd.profit,30],['成长',qd.growth,25],['健康',qd.health,25],['稳定',qd.extra,20]].map(([name,v,max])=>(
                  <div key={name} style={{display:'flex',alignItems:'center',gap:8}}>
                    <Text style={{fontSize:11,color:'#667085',width:32}}>{name}</Text>
                    <Progress percent={Math.round(v/max*100)} showInfo={false} strokeColor="#12b76a" size="small" style={{flex:1}} />
                    <Text style={{fontSize:11,fontFamily:'Inter',width:20,textAlign:'right',color:'#475467'}}>{v}</Text>
                  </div>
                ))}
              </Space>
            </div>
          </Card>
        </Col>
        <Col span={8}>
          <Card bodyStyle={{ padding: '16px 20px', display:'flex', alignItems:'center', gap:16 }}>
            <ScoreRing value={s.valuation} color="#f04438" label="估值" size={90} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#101828', marginBottom: 8 }}>估值水平</div>
              <Descriptions column={1} size="small" colon={false} labelStyle={{width:'auto',fontSize:12,color:'#667085',padding:'2px 0'}} contentStyle={{fontSize:12,padding:'2px 0',fontFamily:'Inter',textAlign:'right'}}>
                <Descriptions.Item label="PE(TTM)"><Text strong>{vd.current_pe}x</Text></Descriptions.Item>
                <Descriptions.Item label="价格位置"><Text strong>{vd.price_percentile}%</Text></Descriptions.Item>
                <Descriptions.Item label={vd.price_percentile<30?'判断':'判断'}>
                  <Tag color={vd.price_percentile<30?'red':vd.price_percentile<60?'orange':'green'} style={{margin:0,borderRadius:20}}>
                    {vd.price_percentile<20?'极度低估':vd.price_percentile<40?'低估':vd.price_percentile<60?'合理':vd.price_percentile<80?'偏高':'高估'}
                  </Tag>
                </Descriptions.Item>
              </Descriptions>
            </div>
          </Card>
        </Col>
        <Col span={8}>
          <Card bodyStyle={{ padding: '16px 20px', display:'flex', alignItems:'center', gap:16 }}>
            <ScoreRing value={s.technical} color="#2e90fa" label="技术" size={90} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#101828', marginBottom: 8 }}>技术面</div>
              <div style={{fontSize:12}}>
                {(td.signals||[]).slice(0,5).map((sig,i)=>{
                  const isPos = sig.includes('+');
                  return <Tag key={i} color={isPos?'blue':'red'} style={{margin:'0 4px 4px 0',fontSize:11,borderRadius:6,background:isPos?'#eff8ff':'#fef3f2',borderColor:isPos?'#d1e9ff':'#fecdca',color:isPos?'#175cd3':'#b42318'}}>{sig.replace('+','↑').replace('-','↓')}</Tag>;
                })}
                {(!td.signals||td.signals.length===0) && <Text type="secondary">暂无明显信号</Text>}
              </div>
            </div>
          </Card>
        </Col>
      </Row>

      {/* K线 */}
      <Card
        title={<Text strong style={{fontSize:14}}>K线走势</Text>}
        extra={
          <Segmented size="small" value={range} onChange={setRange}
            options={[
              {label:'1月',value:'1m'},{label:'3月',value:'3m'},{label:'6月',value:'6m'},{label:'1年',value:'1y'},{label:'全部',value:'all'},
            ]}
          />
        }
        style={{ marginBottom: 14 }}
      >
        <ReactECharts option={klineOption} style={{ height: 420 }} />
      </Card>

      <Row gutter={14}>
        <Col span={10}>
          <Card title={<Text strong style={{fontSize:14}}>基本面雷达</Text>} style={{ marginBottom: 14 }}>
            <ReactECharts option={radarOption} style={{ height: 260 }} />
          </Card>
        </Col>
        <Col span={14}>
          <Card title={<Text strong style={{fontSize:14}}>核心财务指标</Text>} style={{ marginBottom: 14 }}>
            <Descriptions column={2} size="small" bordered colon={false}>
              <Descriptions.Item label="ROE(加权)">
                <Text strong style={{color:ql.roe>=15?'#f04438':ql.roe>=10?'#f79009':'#667085'}}>{ql.roe?.toFixed(1)}%</Text>
              </Descriptions.Item>
              <Descriptions.Item label="ROIC">
                <Text strong>{ql.roic?.toFixed(1)}%</Text>
              </Descriptions.Item>
              <Descriptions.Item label="毛利率">{ql.gross_margin?.toFixed(1)}%</Descriptions.Item>
              <Descriptions.Item label="净利率">{ql.net_margin?.toFixed(1)}%</Descriptions.Item>
              <Descriptions.Item label="资产负债率">{ql.debt_ratio?.toFixed(0)}%</Descriptions.Item>
              <Descriptions.Item label="OCF/净利润">{ql.ocf_np_ratio?.toFixed(2)||'-'}</Descriptions.Item>
              <Descriptions.Item label="PE(TTM)" span={1}>{vd.current_pe}x</Descriptions.Item>
              <Descriptions.Item label="总市值">{data.total_mv?.toLocaleString()}亿</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      <Card title={<Text strong style={{fontSize:14}}>历史财务数据</Text>}>
        <Table size="small" pagination={false} dataSource={data.financials} rowKey="report_date"
          scroll={{x:800}}
          columns={[
            { title:'报告期',dataIndex:'report_date',width:90,render:v=>(
              <span style={{fontSize:12}}>{v.substring(0,4)}-{v.substring(4,6)} <Text type="secondary">{v.includes('1231')?'年报':v.includes('0630')?'中报':v.includes('0331')?'Q1':'Q3'}</Text></span>
            )},
            { title:'ROE%',dataIndex:'roe',align:'right',render:v=><Text style={{fontFamily:'Inter',fontSize:12}}>{v?.toFixed(1)}</Text>},
            { title:'毛利率%',dataIndex:'gross_margin',align:'right',render:v=><Text style={{fontFamily:'Inter',fontSize:12}}>{v?.toFixed(1)}</Text>},
            { title:'净利率%',dataIndex:'net_margin',align:'right',render:v=><Text style={{fontFamily:'Inter',fontSize:12}}>{v?.toFixed(1)}</Text>},
            { title:'营收(亿)',dataIndex:'revenue',align:'right',render:v=><Text style={{fontFamily:'Inter',fontSize:12}}>{v?.toFixed(0)}</Text>},
            { title:'营收YoY',dataIndex:'revenue_yoy',align:'right',render:v=>(
              <Text style={{color:v>=0?'#f04438':'#12b76a',fontFamily:'Inter',fontSize:12,fontWeight:500}}>{v>=0?'+':''}{v?.toFixed(1)}%</Text>
            )},
            { title:'净利(亿)',dataIndex:'net_profit',align:'right',render:v=><Text style={{fontFamily:'Inter',fontSize:12}}>{v?.toFixed(1)}</Text>},
            { title:'净利YoY',dataIndex:'net_profit_yoy',align:'right',render:v=>(
              <Text style={{color:v>=0?'#f04438':'#12b76a',fontFamily:'Inter',fontSize:12,fontWeight:500}}>{v>=0?'+':''}{v?.toFixed(1)}%</Text>
            )},
            { title:'负债率%',dataIndex:'debt_ratio',align:'right',render:v=><Text style={{fontFamily:'Inter',fontSize:12}}>{v?.toFixed(0)}</Text>},
          ]}
        />
      </Card>
    </div>
  );
}
