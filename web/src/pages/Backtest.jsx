import React, { useState, useEffect } from 'react';
import {
  Card, Typography, Row, Col, Button, Space, Form, Select, InputNumber, DatePicker,
  Table, Statistic, Tag, Spin, message, Progress, Divider, Alert,
} from 'antd';
import { PlayCircleOutlined, LineChartOutlined, TrophyOutlined, WarningOutlined, BarChartOutlined, HistoryOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

export default function Backtest() {
  const [form] = Form.useForm();
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dbStats, setDbStats] = useState(null);

  useEffect(() => {
    fetch('/api/db/stats').then(r => r.json()).then(setDbStats).catch(() => {});
  }, []);

  const hasEnoughData = dbStats && dbStats.klines > 5000;

  const runBT = async () => {
    try {
      const vals = await form.validateFields();
      setLoading(true);
      setResult(null);
      const body = {
        initialCapital: vals.capital || 1000000,
        topN: vals.topN || 10,
        stopLossPct: -(vals.stopLoss || 15),
        takeProfitPct: vals.takeProfit || 40,
      };
      // 如果用户选了日期范围就传，否则不传（后端自动检测可用范围）
      if (vals.dateRange && vals.dateRange[0]) {
        body.startDate = vals.dateRange[0].format('YYYYMMDD');
        body.endDate = vals.dateRange[1]?.format('YYYYMMDD') || dayjs().format('YYYYMMDD');
      }
      const res = await fetch('/api/backtest/run', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify(body),
      }).then(r => r.json());
      if (res.error) { message.error(res.error); return; }
      setResult(res);
      if (res.data_note) {
        message.warning(res.data_note, 6);
      }
    } catch(e) {
      message.error('回测失败: ' + e.message);
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
        return `${p.axisValue}<br/>策略: ${((p.value-1)*100).toFixed(1)}%<br/>回撤: ${p2.value.toFixed(1)}%`;
      }
    },
    xAxis: { type: 'category', data: result.nav_curve.map(n=>n.date),
      axisLabel: { fontSize: 10, color: 'var(--text-secondary)' }, axisLine: { lineStyle: { color: 'var(--border)' }} },
    yAxis: [
      { type: 'value', axisLabel: { formatter: v => ((v-1)*100).toFixed(0)+'%', fontSize: 10, color: 'var(--text-secondary)' },
        splitLine: { lineStyle: { color: 'var(--border)' }}},
      { type: 'value', axisLabel: { formatter: '{value}%', fontSize: 10, color: 'var(--down)' }, splitLine: { show: false }},
    ],
    series: [
      { name: '策略净值', type: 'line', data: result.nav_curve.map(n=>n.value),
        lineStyle: { color: 'var(--up)', width: 2 },
        areaStyle: { color: {type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:'rgba(239,68,68,0.12)'},{offset:1,color:'rgba(239,68,68,0)'}]}},
        showSymbol: false, smooth: true },
      { name: '回撤', type: 'bar', yAxisIndex: 1, data: result.nav_curve.map(n=>-n.drawdown),
        itemStyle: { color: 'rgba(34,197,94,0.2)' }, barWidth: 2 },
    ],
  } : {};

  const tradeCols = [
    { title: '股票', render: (_,r) => <Text strong>{r.code} {r.name}</Text> },
    { title: '买入', align: 'center', width: 120, render: (_,r) => (
      <div><Text style={{fontSize:12}}>{r.buyDate}</Text><br/><Text type="secondary" style={{fontSize:11}}>¥{r.buyPrice?.toFixed(2)}</Text></div>
    )},
    { title: '卖出', align: 'center', width: 120, render: (_,r) => (
      <div><Text style={{fontSize:12}}>{r.sellDate}</Text><br/><Text type="secondary" style={{fontSize:11}}>¥{r.sellPrice?.toFixed(2)}</Text></div>
    )},
    { title: '收益', align: 'right', width: 120, render: (_,r) => (
      <Text style={{color:r.pnl>=0?'var(--up)':'var(--down)',fontWeight:600,fontFamily:'var(--font-mono)'}}>
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
        <Title level={4} style={{ margin: 0, fontWeight: 700 }}><BarChartOutlined style={{color:'var(--accent)',marginRight:6}}/>策略回测</Title>
        <Text type="secondary" style={{ fontSize: 12 }}>基于历史数据验证均线趋势策略表现（支持自动适配数据周期）</Text>
      </div>

      {/* 数据提示 */}
      {dbStats && !hasEnoughData && (
        <Alert
          type="warning" showIcon
          style={{ marginBottom: 16 }}
          message="历史数据不足，回测结果参考性有限"
          description={
            <div>
              <div>当前仅有 {(dbStats.klines/10000).toFixed(1)} 万条K线记录（约{(dbStats.klines/200).toFixed(0)}个交易日/只）。短期回测可运行，但年化收益等指标不准确。</div>
              <div style={{marginTop:6}}>建议前往「策略配置 → 数据管理」执行<b>全量同步</b>获取3年历史数据后再进行回测。</div>
            </div>
          }
        />
      )}

      {/* 参数配置 */}
      <Card style={{ marginBottom: 16 }}>
        <Form form={form} layout="inline" initialValues={{
          capital: 1000000, topN: 10, stopLoss: 15, takeProfit: 40,
        }}>
          <Form.Item name="dateRange" label="回测区间" tooltip="留空则自动使用全部可用数据">
            <DatePicker.RangePicker style={{ width: 260 }} placeholder={['自动检测','今天']} />
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
        {result?.note && (
          <div style={{marginTop:8, fontSize:11, color:'var(--text-secondary)'}}>
            <HistoryOutlined /> {result.note}
            {result.data_note && <span style={{marginLeft:12, color:'var(--warn)'}}>{result.data_note}</span>}
          </div>
        )}
      </Card>

      {loading && <div style={{textAlign:'center',padding:80}}><Spin size="large" tip="回测计算中..."/></div>}

      {result && !loading && (
        <>
          {/* 收益概览 */}
          <Row gutter={[12,12]} style={{ marginBottom: 16 }}>
            <Col span={6}>
              <Card bodyStyle={{padding:'16px 20px'}}>
                <Statistic title="总收益率" value={result.summary.total_return} suffix="%" precision={2}
                  valueStyle={{fontSize:26,fontWeight:700,color:result.summary.total_return>=0?'var(--up)':'var(--down)',fontFamily:'var(--font-mono)'}}
                  prefix={result.summary.total_return>=0?'+':''} />
                <div style={{marginTop:6}}>
                  <Text type="secondary" style={{fontSize:11}}>基准 {result.summary.benchmark_return>0?'+':''}{result.summary.benchmark_return.toFixed(1)}% </Text>
                  <Tag color={result.summary.excess_return>=0?'red':'green'} style={{marginLeft:4}}>超额{result.summary.excess_return>0?'+':''}{result.summary.excess_return.toFixed(1)}%</Tag>
                </div>
              </Card>
            </Col>
            <Col span={6}>
              <Card bodyStyle={{padding:'16px 20px'}}>
                <Statistic title={result.summary.years < 0.5 ? '区间收益率(年化)' : '年化收益率'} value={result.summary.annual_return} suffix="%" precision={2}
                  valueStyle={{fontSize:26,fontWeight:700,color:result.summary.annual_return>=0?'var(--up)':'var(--down)',fontFamily:'var(--font-mono)'}}
                  prefix={result.summary.annual_return>=0?'+':''} />
                <div style={{marginTop:6}}>
                  <Text type="secondary" style={{fontSize:11}}>{result.summary.trading_days}个交易日 / {result.summary.stock_count}只股票</Text>
                </div>
              </Card>
            </Col>
            <Col span={6}>
              <Card bodyStyle={{padding:'16px 20px'}}>
                <Statistic title="最大回撤" value={result.summary.max_drawdown} suffix="%" precision={2}
                  valueStyle={{fontSize:26,fontWeight:700,color:'var(--down)',fontFamily:'var(--font-mono)'}} prefix="-" />
                <div style={{marginTop:6}}>
                  <Text type="secondary" style={{fontSize:11}}><WarningOutlined /> 最大浮亏</Text>
                </div>
              </Card>
            </Col>
            <Col span={6}>
              <Card bodyStyle={{padding:'16px 20px'}}>
                <Statistic title="胜率" value={result.summary.win_rate} suffix="%" precision={1}
                  valueStyle={{fontSize:26,fontWeight:700,fontFamily:'var(--font-mono)',color:'var(--accent)'}} />
                <div style={{marginTop:6,display:'flex',justifyContent:'space-between',fontSize:11}}>
                  <Text type="secondary">赢面 <Text style={{color:'var(--up)',fontWeight:600}}>+{result.summary.avg_win.toFixed(1)}%</Text></Text>
                  <Text type="secondary">亏 <Text style={{color:'var(--down)',fontWeight:600}}>{result.summary.avg_loss.toFixed(1)}%</Text></Text>
                </div>
              </Card>
            </Col>
          </Row>

          {/* 净值曲线 */}
          <Card title={<Space><LineChartOutlined/>净值曲线</Space>} style={{marginBottom:16}}>
            <ReactECharts option={navOption} style={{height:320}} />
          </Card>

          {/* 期末持仓 */}
          {result.final_positions?.length > 0 && (
            <Card title="期末持仓" style={{marginBottom:16}}>
              <Table
                size="small"
                pagination={false}
                dataSource={result.final_positions}
                rowKey="code"
                columns={[
                  { title: '代码', dataIndex: 'code', width: 80 },
                  { title: '名称', dataIndex: 'name' },
                  { title: '持仓', dataIndex: 'shares', align: 'right', width: 100, render: v => v?.toLocaleString() },
                  { title: '成本价', dataIndex: 'buyPrice', align: 'right', width: 90, render: v => '¥'+v?.toFixed(2) },
                  { title: '现价', dataIndex: 'currentPrice', align: 'right', width: 90, render: v => '¥'+v?.toFixed(2) },
                  { title: '盈亏', align: 'right', width: 100, render: (_,r) => (
                    <Text style={{color:r.pnl>=0?'var(--up)':'var(--down)',fontFamily:'var(--font-mono)'}}>
                      {r.pnl>=0?'+':''}{(r.pnl/10000).toFixed(1)}万
                    </Text>
                  )},
                ]}
              />
            </Card>
          )}

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
