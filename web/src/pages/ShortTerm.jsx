import React, { useState, useEffect } from 'react';
import {
  Card, Row, Col, Table, Tag, Button, Space, Typography, Statistic,
  Tooltip, Progress, Alert, Spin, Empty, Badge,
} from 'antd';
import {
  ThunderboltOutlined, ArrowUpOutlined, ArrowDownOutlined,
  ReloadOutlined, WarningOutlined, CheckCircleOutlined, RocketOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const signalMeta = {
  buy:    { label: '短线买入', color: '#f5222d', bg: '#fff1f0', icon: <RocketOutlined/> },
  watch:  { label: '关注',     color: '#fa8c16', bg: '#fff7e6', icon: <ThunderboltOutlined/> },
  sell:   { label: '回避',     color: '#52c41a', bg: '#f6ffed', icon: <ArrowDownOutlined/> },
  hold:   { label: '中性',     color: '#8c8c8c', bg: '#fafafa', icon: null },
};

export default function ShortTerm() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [calcLoading, setCalcLoading] = useState(false);
  const [data, setData] = useState([]);
  const [date, setDate] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/short/opportunities?limit=50&minScore=60').then(r => r.json());
      setData(res.data || []);
      setDate(res.date);
    } catch(e) {} finally { setLoading(false); }
  };

  const handleCalc = async () => {
    setCalcLoading(true);
    await fetch('/api/short/calc', { method: 'POST' });
    setTimeout(loadData, 3000);
    setTimeout(() => setCalcLoading(false), 3500);
  };

  useEffect(() => { loadData(); }, []);

  const buyCount = data.filter(d => d.signal === 'buy').length;
  const watchCount = data.filter(d => d.signal === 'watch').length;
  const sellCount = data.filter(d => d.signal === 'sell').length;

  const columns = [
    {
      title: '股票',
      dataIndex: 'name',
      width: 140,
      fixed: 'left',
      render: (_, r) => (
        <a onClick={() => navigate(`/stock/${r.code}`)}>
          <div><b>{r.name}</b></div>
          <Text type="secondary" style={{ fontSize: 11 }}>{r.code}</Text>
        </a>
      ),
    },
    {
      title: '现价',
      dataIndex: 'close',
      width: 80,
      align: 'right',
      render: v => <Text strong>{v?.toFixed(2)}</Text>,
    },
    {
      title: '涨跌',
      dataIndex: 'pct_chg',
      width: 80,
      align: 'right',
      render: v => (
        <span style={{ color: v >= 0 ? '#f5222d' : '#52c41a', fontWeight: 600 }}>
          {v >= 0 ? '+' : ''}{v?.toFixed(2)}%
        </span>
      ),
    },
    {
      title: '短线分',
      dataIndex: 'short_score',
      width: 110,
      align: 'center',
      sorter: (a,b) => a.short_score - b.short_score,
      render: (v) => (
        <div>
          <div style={{ fontWeight: 700, fontSize: 16,
            color: v >= 75 ? '#f5222d' : v >= 65 ? '#fa8c16' : '#8c8c8c' }}>{v}</div>
          <Progress percent={v} showInfo={false} strokeColor={
            v >= 75 ? '#f5222d' : v >= 65 ? '#fa8c16' : '#d9d9d9'
          } size="small" style={{ width: 80, margin: '2px auto 0' }}/>
        </div>
      ),
    },
    {
      title: '信号',
      dataIndex: 'signal',
      width: 100,
      align: 'center',
      render: s => signalMeta[s] ? (
        <Tag color={signalMeta[s].color} style={{ margin:0 }}>{signalMeta[s].icon} {signalMeta[s].label}</Tag>
      ) : '-',
      filters: Object.entries(signalMeta).filter(([k])=>k!=='hold').map(([k,v])=>({text:v.label,value:k})),
      onFilter: (v, r) => r.signal === v,
    },
    {
      title: '量比',
      dataIndex: 'vol_ratio',
      width: 70,
      align: 'center',
      render: v => v ? <Text type={v>2?'warning':'secondary'}>{v.toFixed(1)}</Text> : '-',
    },
    {
      title: 'RSI6',
      dataIndex: 'rsi6',
      width: 70,
      align: 'center',
      render: v => v ? (
        <Text type={v<30?'success':v>70?'danger':'secondary'}>{v.toFixed(0)}</Text>
      ) : '-',
    },
    {
      title: '买入理由',
      dataIndex: 'reasons',
      render: (reasons, r) => (
        <Space size={[4,4]} wrap>
          {(reasons||[]).map((rs, i) => (
            <Tag key={i} color="blue" style={{ margin:0, fontSize:11 }}>{rs}</Tag>
          ))}
          {(r.risks||[]).slice(0,2).map((rs, i) => (
            <Tag key={'r'+i} color="red" style={{ margin:0, fontSize:11 }}>⚠️ {rs}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '止损/止盈',
      width: 160,
      align: 'center',
      render: (_, r) => r.signal === 'buy' ? (
        <Space size={8}>
          <Text type="success" style={{ fontSize: 12 }}>止盈 {r.target_price}</Text>
          <Text type="danger" style={{ fontSize: 12 }}>止损 {r.stop_loss}</Text>
        </Space>
      ) : '-',
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div>
          <Title level={4} style={{ margin: 0, fontWeight: 700 }}>
            ⚡ 短线机会
            <Tag color="geekblue" style={{ marginLeft: 8, fontWeight: 'normal' }}>
              {date || dayjs().format('YYYY-MM-DD')}
            </Tag>
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            基于技术面+量价分析（1-5日短线），MACD/KDJ/均线/突破/放量
          </Text>
        </div>
        <Button icon={calcLoading ? <Spin size="small"/> : <ReloadOutlined/>} onClick={handleCalc} loading={calcLoading}>
          重新计算
        </Button>
      </div>

      {/* 免责提示 */}
      <Alert
        type="warning" showIcon
        message="短线交易风险提示"
        description="短线信号基于技术面量化计算，仅供参考，不构成投资建议。严格执行5%止损，单只仓位不超过20%。"
        style={{ marginBottom: 16 }}
      />

      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small" bodyStyle={{ padding: '16px 20px', background: buyCount > 0 ? '#fff1f0' : '#fafafa' }}>
            <Statistic
              title={<span style={{ fontSize:12 }}><RocketOutlined /> 短线买入</span>}
              value={buyCount}
              suffix="只"
              valueStyle={{ color: '#f5222d', fontSize: 28, fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" bodyStyle={{ padding: '16px 20px' }}>
            <Statistic
              title={<span style={{ fontSize:12 }}><ThunderboltOutlined /> 关注</span>}
              value={watchCount}
              suffix="只"
              valueStyle={{ color: '#fa8c16', fontSize: 28, fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" bodyStyle={{ padding: '16px 20px', background: sellCount > 0 ? '#f6ffed' : '#fafafa' }}>
            <Statistic
              title={<span style={{ fontSize:12 }}><WarningOutlined /> 回避信号</span>}
              value={sellCount}
              suffix="只"
              valueStyle={{ color: '#52c41a', fontSize: 28, fontWeight: 700 }}
            />
          </Card>
        </Col>
      </Row>

      {/* 信号表格 */}
      <Card bodyStyle={{ padding: 0 }}>
        <Table
          columns={columns}
          dataSource={data}
          rowKey="code"
          loading={loading}
          size="middle"
          scroll={{ x: 1000 }}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          rowClassName={(r) => r.signal === 'buy' ? 'row-buy' : ''}
          locale={{ emptyText: <Empty description={'暂无短线信号（先在策略配置里点「立即同步」数据）'}/> }}
        />
      </Card>

      <style>{`
        .row-buy { background: #fff1f022 !important; }
        .row-buy:hover td { background: #fff1f055 !important; }
      `}</style>
    </div>
  );
}
