import React, { useEffect, useState, useRef } from 'react';
import {
  Card, Row, Col, Table, Tag, Button, Typography, Statistic,
  Space, Progress, Alert, Spin, Tooltip, Badge,
} from 'antd';
import {
  DollarCircleOutlined, RocketOutlined, ArrowDownOutlined, ArrowUpOutlined,
  ReloadOutlined, WarningOutlined, ThunderboltOutlined, RiseOutlined, FallOutlined,
} from '@ant-design/icons';

const { Title, Text } = Typography;

const signalMeta = {
  long:        { label: '做多', color: 'var(--down)', bg: 'var(--down-soft)', icon: <ArrowUpOutlined/>, tip: '看多，可开多单' },
  watch_long:  { label: '偏多', color: '#73d13d', bg: 'var(--down-soft)', icon: <RiseOutlined style={{fontSize:12}}/>, tip: '偏强，等待入场' },
  hold:        { label: '观望', color: '#8c8c8c', bg: '#FAFAFA', icon: null, tip: '方向不明' },
  watch_short: { label: '偏空', color: '#ff7a45', bg: 'var(--warn-soft)', icon: <FallOutlined style={{fontSize:12}}/>, tip: '偏弱，等待做空' },
  short:       { label: '做空', color: 'var(--up)', bg: 'var(--up-soft)', icon: <ArrowDownOutlined/>, tip: '看空，可开空单' },
};

const coinColor = {
  BTC: '#f7931a', ETH: '#627eea', BNB: '#f0b90b', SOL: '#9945ff',
  XRP: '#23292f', DOGE: '#c3a634', ADA: '#0033ad', AVAX: '#e84142',
};

function formatPrice(p) {
  if (!p) return '-';
  if (p >= 1000) return '$' + p.toLocaleString(undefined, {maximumFractionDigits: 2});
  if (p >= 1) return '$' + p.toFixed(2);
  if (p >= 0.01) return '$' + p.toFixed(4);
  return '$' + p.toFixed(6);
}

function formatVolume(v) {
  if (v >= 1e9) return '$' + (v/1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v/1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + (v/1e3).toFixed(2) + 'K';
  return '$' + v?.toFixed(0);
}

export default function Crypto() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [lastUpdate, setLastUpdate] = useState('');
  const esRef = useRef(null);

  const loadData = () => {
    if (esRef.current) esRef.current.close();
    setLoading(true);
    setData([]);
    setProgress({ done: 0, total: 0 });

    const es = new EventSource('/api/crypto/market');
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'start') {
          setProgress({ done: 0, total: msg.total });
        } else if (msg.type === 'data') {
          setData(prev => [...prev, msg.item]);
          setProgress({ done: msg.done, total: msg.total });
        } else if (msg.type === 'done') {
          setData(msg.data);
          setProgress({ done: msg.data.length, total: msg.data.length });
          setLastUpdate(new Date().toLocaleTimeString());
          setLoading(false);
          es.close();
          esRef.current = null;
        }
      } catch(e) {}
    };
    es.onerror = () => {
      setLoading(false);
      es.close();
    };
  };

  useEffect(() => {
    loadData();
    return () => { if (esRef.current) esRef.current.close(); };
  }, []);

  const longCount = data.filter(d => d.signal === 'long').length;
  const shortCount = data.filter(d => d.signal === 'short').length;
  const marketBias = data.length > 0 ? Math.round(data.reduce((a,b)=>a+b.score-50,0)/data.length) : 0;

  const columns = [
    {
      title: '币种',
      dataIndex: 'symbol',
      width: 130,
      fixed: 'left',
      render: (_, r) => (
        <Space>
          <div style={{
            width:28,height:28,borderRadius:'50%',
            background: coinColor[r.symbol] || 'var(--accent)',
            color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',
            fontSize:12,fontWeight:700,
          }}>
            {r.symbol.slice(0,2)}
          </div>
          <div>
            <div><b>{r.symbol}</b> <Text type="secondary" style={{fontSize:11}}>/USDT</Text></div>
          </div>
        </Space>
      ),
    },
    {
      title: '现价',
      dataIndex: 'price',
      width: 110,
      align: 'right',
      render: v => <Text strong>{formatPrice(v)}</Text>,
      sorter: (a,b) => a.price - b.price,
    },
    {
      title: '24h涨跌',
      dataIndex: 'pct_24h',
      width: 100,
      align: 'right',
      render: v => (
        <span style={{ color: v>=0 ? 'var(--down)' : 'var(--up)', fontWeight: 600 }}>
          {v>=0?'+':''}{v?.toFixed(2)}%
        </span>
      ),
      sorter: (a,b) => a.pct_24h - b.pct_24h,
    },
    {
      title: '24h成交额',
      dataIndex: 'volume_24h',
      width: 110,
      align: 'right',
      render: v => <Text type="secondary" style={{fontSize:12}}>{formatVolume(v)}</Text>,
      sorter: (a,b) => a.volume_24h - b.volume_24h,
    },
    {
      title: '量化评分',
      dataIndex: 'score',
      width: 130,
      align: 'center',
      sorter: (a,b) => a.score - b.score,
      render: v => (
        <div>
          <div style={{ fontWeight: 700, fontSize: 16,
            color: v >= 65 ? 'var(--down)' : v <= 35 ? 'var(--up)' : '#8c8c8c' }}>{v}</div>
          <Progress percent={Math.max(0,v)} showInfo={false}
            strokeColor={v >= 65 ? 'var(--down)' : v <= 35 ? 'var(--up)' : '#d9d9d9'}
            size="small" style={{ width: 90, margin: '2px auto 0' }}/>
        </div>
      ),
    },
    {
      title: '信号',
      dataIndex: 'signal',
      width: 110,
      align: 'center',
      render: s => signalMeta[s] ? (
        <Tooltip title={signalMeta[s].tip}>
          <Tag color={signalMeta[s].color} style={{margin:0}}>
            {signalMeta[s].icon} {signalMeta[s].label}
          </Tag>
        </Tooltip>
      ) : '-',
      filters: Object.entries(signalMeta).map(([k,v])=>({text:v.label,value:k})),
      onFilter: (v, r) => r.signal === v,
    },
    {
      title: '杠杆建议',
      dataIndex: 'leverage',
      width: 90,
      align: 'center',
      render: (v, r) => v > 0 ? <Tag color="gold">×{v}x</Tag> : '-',
    },
    {
      title: '理由',
      dataIndex: 'reasons',
      render: (reasons, r) => (
        <Space size={[4,4]} wrap>
          {(reasons||[]).map((rs,i)=>(
            <Tag key={i} color="green" style={{margin:0,fontSize:11}}>{rs}</Tag>
          ))}
          {(r.risks||[]).slice(0,2).map((rs,i)=>(
            <Tag key={'r'+i} color="red" style={{margin:0,fontSize:11}}><WarningOutlined style={{color:'var(--warn)',fontSize:12,marginRight:2}}/>{rs}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '止损/止盈',
      width: 180,
      align: 'center',
      render: (_, r) => r.leverage > 0 ? (
        <Space size={8} direction="vertical" style={{fontSize:12}}>
          <Text type="danger">止损 {formatPrice(r.stop_loss)}</Text>
          <Text type="success">目标 {formatPrice(r.target)}</Text>
        </Space>
      ) : '-',
    },
  ];

  const pct = progress.total > 0 ? Math.round(progress.done / progress.total * 100) : 0;

  return (
    <div>
      <div style={{ marginBottom: 16, display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div>
          <Title level={4} style={{ margin: 0, fontWeight: 700 }}>
            <DollarCircleOutlined style={{ color:'#f7931a' }}/> 加密货币
            <Tag color="orange" style={{ marginLeft: 8, fontWeight:'normal' }}>量化择时</Tag>
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            币安现货行情 · 基于均线/MACD/RSI/BOLL/量价多因子评分 · 日内-波段参考
          </Text>
        </div>
        <Button icon={loading ? <Spin size="small"/> : <ReloadOutlined/>} onClick={loadData} loading={loading}>
          重新分析
        </Button>
      </div>

      <Alert
        type="warning" showIcon
        message="高风险提示"
        description="加密货币7×24小时交易，波动剧烈。本模块信号仅供参考，高杠杆交易风险极高，建议严格止损，不超过3x杠杆，单笔不超过总资金5%。"
        style={{ marginBottom: 16 }}
      />

      {/* 市场偏见 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small" bodyStyle={{ padding: '16px 20px', background: longCount > shortCount ? 'var(--down-soft)' : (shortCount>longCount?'var(--up-soft)':'#FAFAFA') }}>
            <Statistic
              title="市场情绪"
              value={marketBias > 10 ? '偏多' : marketBias < -10 ? '偏空' : '中性'}
              valueStyle={{
                color: marketBias > 10 ? 'var(--down)' : marketBias < -10 ? 'var(--up)' : '#8c8c8c',
                fontSize: 24, fontWeight: 700 }}
              suffix={<span style={{fontSize:14}}>({marketBias>=0?'+':''}{marketBias})</span>}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" bodyStyle={{ padding: '16px 20px', background:'var(--down-soft)' }}>
            <Statistic
              title="做多信号"
              value={longCount}
              suffix="个"
              prefix={<RocketOutlined style={{color:'var(--down)'}}/>}
              valueStyle={{ color:'var(--down)', fontSize:28, fontWeight:700 }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" bodyStyle={{ padding: '16px 20px', background:'var(--up-soft)' }}>
            <Statistic
              title="做空/回避信号"
              value={shortCount}
              suffix="个"
              prefix={<WarningOutlined style={{color:'var(--up)'}}/>}
              valueStyle={{ color:'var(--up)', fontSize:28, fontWeight:700 }}
            />
          </Card>
        </Col>
      </Row>

      {loading && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ textAlign:'center', padding: '8px 0' }}>
            <Spin />
            <div style={{ marginTop: 12 }}>
              <Progress percent={pct} size="small" style={{maxWidth:400, margin:'0 auto'}} />
              <Text type="secondary" style={{fontSize:12, display:'block', marginTop:8}}>
                正在分析币种... {progress.done}/{progress.total}
              </Text>
            </div>
          </div>
        </Card>
      )}

      <Card bodyStyle={{ padding: 0 }}>
        <Table
          columns={columns}
          dataSource={data}
          rowKey="pair"
          size="middle"
          scroll={{ x: 1100 }}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          rowClassName={(r) => r.signal === 'long' ? 'row-long' : (r.signal==='short'?'row-short':'')}
          locale={{ emptyText: loading ? '正在加载数据...' : '暂无数据' }}
        />
      </Card>

      {lastUpdate && (
        <div style={{ textAlign:'right', marginTop:8, fontSize:11, color:'#999' }}>
          最后更新: {lastUpdate} · 数据来源: Binance
        </div>
      )}

      <style>{`
        .row-long { background:#f6ffed44 !important; }
        .row-long:hover td { background:#f6ffed99 !important; }
        .row-short { background:#fff1f044 !important; }
        .row-short:hover td { background:#fff1f099 !important; }
      `}</style>
    </div>
  );
}
