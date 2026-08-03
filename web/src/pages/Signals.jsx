import React, { useState, useEffect } from 'react';
import {
  Table, Tag, Select, Space, Card, Progress, Typography, Radio, Spin, Input,
  Tooltip, Segmented,
} from 'antd';
import { SearchOutlined, FilterFilled, RocketOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getStocks, getIndustries } from '../api';

const { Text } = Typography;

const signalMeta = {
  buy: { label: '买入', color: 'var(--up)', bg: 'var(--up-soft)', icon: '' },
  momentum_buy: { label: '动量', color: 'var(--purple)', bg: 'var(--purple-soft)', icon: '' },
  watch: { label: '关注', color: 'var(--warn)', bg: 'var(--warn-soft)', icon: '' },
  hold: { label: '持有', color: 'var(--accent)', bg: 'var(--accent-soft)', icon: '' },
  sell: { label: '减仓', color: 'var(--down)', bg: 'var(--down-soft)', icon: '' },
};

export default function Signals() {
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [industries, setIndustries] = useState([]);
  const [search, setSearch] = useState('');
  const [params, setParams] = useState({
    page: 1, pageSize: 20, signal: '', industry: '',
    economyFilter: '', minScore: 0, sort: 'total_score', order: 'desc',
  });
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      const res = await getStocks(params);
      let rows = res.data;
      if (search) {
        rows = rows.filter(r => r.name?.includes(search) || r.code?.includes(search));
      }
      setData(rows);
      setTotal(res.total);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [params]);
  useEffect(() => { getIndustries().then(setIndustries); }, []);

  const scoreBadge = (v) => {
    const cls = v >= 70 ? 'score-high' : v >= 60 ? 'score-mid' : 'score-low';
    return <span className={'score-badge ' + cls}>{v}</span>;
  };

  const cols = [
    { title: '#', width: 36, render: (_, __, i) => <Text type="secondary" style={{ fontSize: 12 }}>{(params.page-1)*params.pageSize+i+1}</Text> },
    { title: '股票', dataIndex: 'name', fixed: 'left', width: 160,
      render: (v, r) => (
        <Space size={6} align="start">
          <div style={{ display: 'flex', gap: 4, flexShrink: 0, paddingTop: 2 }}>
            {r.is_new_economy && <Tooltip title="新经济"><RocketOutlined style={{fontSize:12,color:'var(--purple)'}}/></Tooltip>}
            {r.is_oldman && null}
          </div>
          <div>
            <a onClick={() => navigate('/stock/' + r.code)} style={{ fontWeight: 600, fontSize: 13, color: '#1A1A1E' }}>{v}</a>
            <div>
              <Text type="secondary" style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>{r.code}</Text>
              {r.current_price && (
                <Text style={{ fontSize: 11, marginLeft: 8, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                  color: r.current_price > 0 ? 'var(--up)' : 'var(--down)', fontWeight: 500 }}>
                  ¥{r.current_price.toFixed(2)}
                </Text>
              )}
            </div>
          </div>
        </Space>
      )
    },
    { title: 'PE', dataIndex: 'pe', width: 70, align: 'right',
      render: v => v ? <Text style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{v.toFixed(1)}x</Text> : '-' },
    { title: '市值(亿)', dataIndex: 'total_mv', width: 90, align: 'right', sorter: true,
      render: v => v ? <Text style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#3A3A3C', fontVariantNumeric: 'tabular-nums' }}>{v >= 10000 ? (v/10000).toFixed(1)+'万' : v.toLocaleString()}</Text> : '-' },
    { title: '综合分', dataIndex: 'total_score', width: 140, sorter: true,
      render: v => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Progress
            percent={v} size="small" showInfo={false}
            strokeColor={v >= 70 ? 'var(--up)' : v >= 60 ? 'var(--warn)' : v >= 50 ? 'var(--accent)' : '#E8E8ED'}
            style={{ flex: 1 }}
          />
          {scoreBadge(v)}
        </div>
      )
    },
    { title: <Tooltip title="盈利能力+成长+健康+稳定">质量</Tooltip>, dataIndex: 'quality_score', width: 60, align: 'center', sorter: true,
      render: v => <Text strong style={{ fontSize: 13, color: v >= 60 ? 'var(--down)' : v >= 45 ? 'var(--warn)' : '#8E8E93' }}>{v}</Text> },
    { title: <Tooltip title="PE估值+价格位置">估值</Tooltip>, dataIndex: 'valuation_score', width: 60, align: 'center', sorter: true,
      render: v => <Text strong style={{ fontSize: 13, color: v >= 60 ? 'var(--up)' : v >= 40 ? 'var(--warn)' : '#8E8E93' }}>{v}</Text> },
    { title: <Tooltip title="均线/MACD/RSI/量能">技术</Tooltip>, dataIndex: 'technical_score', width: 60, align: 'center', sorter: true,
      render: v => <Text strong style={{ fontSize: 13, color: v >= 60 ? 'var(--accent)' : v >= 45 ? 'var(--warn)' : '#8E8E93' }}>{v}</Text> },
    { title: '行业', dataIndex: 'industry', width: 120, ellipsis: true,
      render: v => <Text type="secondary" style={{ fontSize: 12 }}>{v || '-'}</Text> },
    { title: '信号', dataIndex: 'signal', width: 90, align: 'center', fixed: 'right',
      render: s => <span className={'signal-badge signal-'+s}>{signalMeta[s]?.label}</span>
    },
    { title: '拥挤度', dataIndex: 'crowding_score', width: 70, align: 'center', sorter: true,
      render: (v, r) => {
        if (v === null || v === undefined) return <Text type="secondary" style={{fontSize:12}}>-</Text>;
        const color = v >= 85 ? 'var(--up)' : v >= 70 ? 'var(--up)' : v >= 55 ? 'var(--warn)' : v >= 30 ? 'var(--purple)' : 'var(--down)';
        return (
          <Tooltip title={`拥挤度等级: ${r.crowding_level || 'normal'}`}>
            <span style={{color, fontWeight:700, fontSize:12, fontFamily:'var(--font-mono)'}}>{Math.round(v)}</span>
          </Tooltip>
        );
      }
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Card size="small" bodyStyle={{ padding: '12px 16px' }}>
          <Space size={12} wrap>
            <Segmented
              value={params.signal || 'all'}
              onChange={v => setParams(p => ({ ...p, signal: v==='all'?'':v, page: 1 }))}
              options={[
                { label: '全部', value: 'all' },
                { label: '买入', value: 'buy' },
                { label: '动量搭车', value: 'momentum_buy' },
                { label: '关注', value: 'watch' },
                { label: '持有', value: 'hold' },
                { label: '减仓', value: 'sell' },
              ]}
            />
            <Segmented
              value={params.economyFilter || 'all'}
              onChange={v => setParams(p => ({ ...p, economyFilter: v==='all'?'':v, page:1 }))}
              options={[
                { label: '全部类型', value: 'all' },
                { label: <span><RocketOutlined style={{color:'var(--purple)',fontSize:11}}/> 新经济</span>, value: 'true' },
                { label: '传统', value: 'false' },
              ]}
            />
            <Select
              placeholder="行业筛选" style={{ width: 170 }} allowClear
              value={params.industry || undefined}
              onChange={v => setParams(p => ({ ...p, industry: v||'', page:1 }))}
              options={industries.map(i => ({ label: `${i.name} (${i.count})`, value: i.name }))}
              suffixIcon={<FilterFilled />}
            />
            <Select
              style={{ width: 110 }} defaultValue={0}
              onChange={v => setParams(p => ({ ...p, minScore: v, page: 1 }))}
              options={[
                { label: '全部分数', value: 0 },
                { label: '≥60分', value: 60 },
                { label: '≥65分', value: 65 },
                { label: '≥70分', value: 70 },
                { label: '≥75分', value: 75 },
              ]}
            />
            <Input
              placeholder="搜索名称或代码" prefix={<SearchOutlined style={{color:'#8E8E93'}}/>}
              style={{ width: 160 }} allowClear size="middle"
              value={search} onChange={e => setSearch(e.target.value)}
            />
          </Space>
        </Card>
      </div>

      <Card bodyStyle={{ padding: 0 }}>
        <Table
          columns={cols}
          dataSource={data}
          rowKey="code"
          loading={loading}
          scroll={{ x: 1000 }}
          pagination={{
            current: params.page, pageSize: params.pageSize, total,
            showSizeChanger: true, showTotal: t => `共 ${t} 只`,
            pageSizeOptions: ['20','50','100'],
            size: 'small',
            onChange: (page, pageSize) => setParams(p => ({ ...p, page, pageSize })),
          }}
          onChange={(pag, filt, sorter) => {
            if (sorter.field) {
              const fieldMap = { total_score:'total_score', quality_score:'quality',
                valuation_score:'valuation', technical_score:'technical',
                total_mv:'total_mv', pe:'pe', pct_chg:'pct_chg' };
              setParams(p => ({ ...p, sort: fieldMap[sorter.field]||sorter.field, order: sorter.order==='ascend'?'asc':'desc', page:1 }));
            }
          }}
          onRow={(r) => ({
            style: { cursor: 'pointer' },
            onClick: () => navigate('/stock/' + r.code),
          })}
          rowHoverable
        />
      </Card>
    </div>
  );
}
