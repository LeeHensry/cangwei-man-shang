import React, { useState } from 'react';
import {
  Card, Typography, Row, Col, Button, Space, Form, Select, InputNumber, DatePicker,
  Table, Statistic, Tag, Spin, message, Progress, Divider,
} from 'antd';
import { PlayCircleOutlined, LineChartOutlined, TrophyOutlined, WarningOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

export default function Backtest() {
  const [form] = Form.useForm();
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const runBT = async () => {
    try {
      const vals = await form.validateFields();
      setLoading(true);
      const res = await fetch('/api/backtest/run', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          startDate: vals.dateRange?.[0]?.format('YYYYMMDD') || '20230101',
          endDate: vals.dateRange?.[1]?.format('YYYYMMDD') || dayjs().format('YYYYMMDD'),
          initialCapital: vals.capital || 1000000,
          topN: vals.topN || 10,
          stopLossPct: -(vals.stopLoss || 15),
          takeProfitPct: vals.takeProfit || 40,
        }),
      }).then(r => r.json());
      if (res.error) { message.error(res.error); return; }
      setResult(res);
    } catch(e) {
      message.error('回测失败');
    } finally {
      setLoading(false);
    }
  };

  const navOption = result ? {
    grid: { left: 50, right: 20, top: 30, bottom: 30 },
    tooltip: { trigger: 'axis',
      formatter: (params) => {
        const p = params[0];
        const p2 = params[1];
        return `${p.axisValue}<br/>策略: ${(p.value*100).toFixed(1)}%<br/>回撤: ${p2.value.toFixed(1)}%`;
      }
    },
    xAxis: { type: 'category', data: result.nav_curve.map(n=>n.date),
      axisLabel: { fontSize: 10, color: '#98a2b3' }, axisLine: { lineStyle: { color: '#e4e7ec' }} },
    yAxis: [
      { type: 'value', axisLabel: { formatter: v => ((v-1)*100).toFixed(0)+'%', fontSize: 10, color: '#98a2b3' },
        splitLine: { lineStyle: { color: '#f2f4f7' }}},
      { type: 'value', axisLabel: { formatter: '{value}%', fontSize: 10, color: '#f04438' }, splitLine: { show: false }},
    ],
    series: [
      { name: '策略净值', type: 'line', data: result.nav_curve.map(n=>n.value),
        lineStyle: { color: '#f04438', width: 2 },
        areaStyle: { color: {type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:'rgba(240,68,56,0.12)'},{offset:1,color:'rgba(240,68,56,0)'}]}},
        showSymbol: false, smooth: true },
      { name: '回撤', type: 'bar', yAxisIndex: 1, data: result.nav_curve.map(n=>-n.drawdown),
        itemStyle: { color: 'rgba(16,185,129,0.2)' }, barWidth: 2 },
    ],
  } : {};

  const tradeCols = [
    { title: '股票', render: (_,r) => <Text strong>{r.code}</Text> },
    { title: '买入', align: 'center', width: 100, render: (_,r) => (
      <div><Text style={{fontSize:12}}>{r.buyDate}</Text><br/><Text type="secondary" style={{fontSize:11}}>¥{r.buyPrice}</Text></div>
    )},
    { title: '卖出', align: 'center', width: 100, render: (_,r) => (
      <div><Text style={{fontSize:12}}>{r.sellDate}</Text><br/><Text type="secondary" style={{fontSize:11}}>¥{r.sellPrice}</Text></div>
    )},
    { title: '收益', align: 'right', width: 120, render: (_,r) => (
      <Text style={{color:r.pnl>=0?'#f04438':'#12b76a',fontWeight:600,fontFamily:'Inter'}}>
        {r.pnl>=0?'+':''}{r.pnl_pct}%
      </Text>
    )},
    { title: '原因', align: 'center', width: 70, render: (_,r) => (
      <Tag color={r.reason==='止损'?'red':r.reason==='止盈'?'green':'blue'} style={{margin:0}}>{r.reason}</Tag>
    )},
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0, fontWeight: 700 }}>📊 策略回测</Title>
        <Text type="secondary" style={{ fontSize: 12 }}>基于历史数据验证价值策略表现（月度调仓+止损止盈）</Text>
      </div>

      {/* 参数配置 */}
      <Card style={{ marginBottom: 16 }}>
        <Form form={form} layout="inline" initialValues={{
          dateRange: [dayjs('2023-01-01'), dayjs()],
          capital: 1000000, topN: 10, stopLoss: 15, takeProfit: 40,
        }}>
          <Form.Item name="dateRange" label="回测区间">
            <DatePicker.RangePicker style={{ width: 260 }} />
          </Form.Item>
          <Form.Item name="capital" label="初始资金">
            <InputNumber min={10000} step={100000} formatter={v => `¥${(v/10000).toFixed(0)}万`} parser={v => Number(v.replace(/[^\d.]/g,''))*10000} style={{width:130}} />
          </Form.Item>
          <Form.Item name="topN" label="持仓数">
            <Select style={{ width: 100 }} options={[5,8,10,15,20].map(n=>({label:n+'只',value:n}))} />
          </Form.Item>
          <Form.Item name="stopLoss" label="止损%">
            <InputNumber min={5} max={30} style={{width:80}} formatter={v=>v+'%'} parser={v=>Number(v.replace('%',''))} />
          </Form.Item>
          <Form.Item name="takeProfit" label="止盈%">
            <InputNumber min={10} max={100} style={{width:80}} formatter={v=>v+'%'} parser={v=>Number(v.replace('%',''))} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={runBT} loading={loading}>开始回测</Button>
          </Form.Item>
        </Form>
      </Card>

      {loading && <div style={{textAlign:'center',padding:80}}><Spin size="large" tip="回测计算中..."/></div>}

      {result && !loading && (
        <>
          {/* 收益概览 */}
          <Row gutter={[12,12]} style={{ marginBottom: 16 }}>
            <Col span={6}>
              <Card bodyStyle={{padding:'16px 20px'}}>
                <Statistic title="总收益率" value={result.summary.total_return} suffix="%" precision={2}
                  valueStyle={{fontSize:26,fontWeight:700,color:result.summary.total_return>=0?'#f04438':'#12b76a',fontFamily:'Inter'}}
                  prefix={result.summary.total_return>=0?'+':''} />
                <div style={{marginTop:6}}>
                  <Text type="secondary" style={{fontSize:11}}>基准 {result.summary.benchmark_return>0?'+':''}{result.summary.benchmark_return.toFixed(1)}% </Text>
                  <Tag color={result.summary.excess_return>=0?'red':'green'} style={{marginLeft:4}}>超额{result.summary.excess_return>0?'+':''}{result.summary.excess_return.toFixed(1)}%</Tag>
                </div>
              </Card>
            </Col>
            <Col span={6}>
              <Card bodyStyle={{padding:'16px 20px'}}>
                <Statistic title="年化收益率" value={result.summary.annual_return} suffix="%" precision={2}
                  valueStyle={{fontSize:26,fontWeight:700,color:result.summary.annual_return>=0?'#f04438':'#12b76a',fontFamily:'Inter'}}
                  prefix={result.summary.annual_return>=0?'+':''} />
                <div style={{marginTop:6}}>
                  <Text type="secondary" style={{fontSize:11}}>回测周期 {result.summary.years}年</Text>
                </div>
              </Card>
            </Col>
            <Col span={6}>
              <Card bodyStyle={{padding:'16px 20px'}}>
                <Statistic title="最大回撤" value={result.summary.max_drawdown} suffix="%" precision={2}
                  valueStyle={{fontSize:26,fontWeight:700,color:'#12b76a',fontFamily:'Inter'}} prefix="-" />
                <div style={{marginTop:6}}>
                  <Text type="secondary" style={{fontSize:11}}><WarningOutlined /> 最大浮亏</Text>
                </div>
              </Card>
            </Col>
            <Col span={6}>
              <Card bodyStyle={{padding:'16px 20px'}}>
                <Statistic title="胜率" value={result.summary.win_rate} suffix="%" precision={1}
                  valueStyle={{fontSize:26,fontWeight:700,fontFamily:'Inter',color:'#2e90fa'}} />
                <div style={{marginTop:6,display:'flex',justifyContent:'space-between',fontSize:11}}>
                  <Text type="secondary">赢面 <Text style={{color:'#f04438',fontWeight:600}}>+{result.summary.avg_win.toFixed(1)}%</Text></Text>
                  <Text type="secondary">亏 <Text style={{color:'#12b76a',fontWeight:600}}>{result.summary.avg_loss.toFixed(1)}%</Text></Text>
                </div>
              </Card>
            </Col>
          </Row>

          {/* 净值曲线 */}
          <Card title={<Space><LineChartOutlined/>净值曲线</Space>} style={{marginBottom:16}}>
            <ReactECharts option={navOption} style={{height:320}} />
          </Card>

          {/* 交易记录 */}
          <Card title={<Space><TrophyOutlined/>最近交易记录 ({result.trades.length}笔)</Space>}>
            <Table columns={tradeCols} dataSource={result.trades} rowKey={(r,i)=>i}
              pagination={{pageSize:20,size:'small'}} size="small" />
          </Card>
        </>
      )}
    </div>
  );
}
