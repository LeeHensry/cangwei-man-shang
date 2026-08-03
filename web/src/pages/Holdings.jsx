import React, { useState, useEffect } from 'react';
import {
  Card, Typography, Tag, Button, Space, Table, Statistic, Row, Col, Modal, Form,
  InputNumber, Input, DatePicker, Popconfirm, message, Progress, Tooltip, Empty, Alert,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, RiseOutlined, FallOutlined,
  WarningOutlined, CheckCircleOutlined, FundViewOutlined, CloudDownloadOutlined, WalletOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { getPortfolio, addHolding, deleteHolding } from '../api';

const { Title, Text } = Typography;

// ===== 持仓本地备份（防止Render免费版重启丢失数据）=====
const PORTFOLIO_BACKUP_KEY = 'cwms_portfolio_backup';

function savePortfolioBackup(holdings) {
  try {
    // 只备份必要字段，不带计算字段
    const backup = holdings.map(h => ({
      code: h.code, name: h.name, buy_price: h.buy_price, shares: h.shares,
      buy_date: h.buy_date, strategy: h.strategy || 'value',
    }));
    localStorage.setItem(PORTFOLIO_BACKUP_KEY, JSON.stringify(backup));
  } catch(e) {}
}

async function restoreFromBackup() {
  try {
    const raw = localStorage.getItem(PORTFOLIO_BACKUP_KEY);
    if (!raw) return 0;
    const backup = JSON.parse(raw);
    if (!Array.isArray(backup) || backup.length === 0) return 0;
    // 检查后端是否已有数据
    const current = await getPortfolio();
    if (current.holdings && current.holdings.length > 0) return 0; // 后端有数据，不需要恢复
    // 后端空，逐条恢复
    let restored = 0;
    for (const h of backup) {
      try {
        await addHolding(h);
        restored++;
      } catch(e) {}
    }
    return restored;
  } catch(e) {
    return 0;
  }
}


const signalMeta = {
  buy: { label: '买入', color: 'var(--up)', bg: 'var(--up-soft)' },
  watch: { label: '关注', color: 'var(--warn)', bg: 'var(--warn-soft)' },
  hold: { label: '持有', color: 'var(--accent)', bg: 'var(--accent-soft)' },
  sell: { label: '减仓', color: 'var(--down)', bg: 'var(--down-soft)' },
};

function PnLText({ value, suffix = '%', colored = true }) {
  if (value === null || value === undefined || isNaN(value)) return <Text type="secondary">--</Text>;
  const color = value >= 0 ? 'var(--up)' : 'var(--down)';
  const sign = value >= 0 ? '+' : '';
  return <Text style={{ color: colored ? color : '#3A3A3C', fontWeight: 600, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>{sign}{value.toFixed(2)}{suffix}</Text>;
}

export default function Holdings() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    try {
      // 先尝试从本地备份恢复（后端空时）
      const restored = await restoreFromBackup();
      if (restored > 0) {
        message.success(`已从本地备份恢复 ${restored} 只持仓`, 3);
      }
      const d = await getPortfolio();
      setData(d);
      // 每次加载成功都备份一次
      if (d.holdings) savePortfolioBackup(d.holdings);
    } catch(e) {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    try {
      const vals = await form.validateFields();
      setSubmitting(true);
      await addHolding({
        code: vals.code,
        name: vals.name,
        buy_price: vals.buy_price,
        shares: vals.shares,
        buy_date: vals.buy_date ? vals.buy_date.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
      });
      message.success('添加成功');
      setModalOpen(false);
      form.resetFields();
      load();
    } catch(e) {
      if (e?.errorFields) return;
      message.error('添加失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (code) => {
    try {
      await deleteHolding(code);
      message.success('已平仓');
      load();
    } catch(e) { message.error('操作失败'); }
  };

  const summary = data?.summary || {};
  const holdings = data?.holdings || [];

  const cols = [
    { title: '股票', render: (_, r) => (
      <div>
        <a onClick={() => navigate('/stock/'+r.code)} style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</a>
        <div style={{ fontSize: 11, color: '#8E8E93', fontFamily: 'var(--font-mono)' }}>{r.code}</div>
      </div>
    )},
    { title: '成本价', dataIndex: 'buy_price', align: 'right', width: 80,
      render: v => <Text style={{fontFamily:'var(--font-mono)',fontVariantNumeric:'tabular-nums'}}>¥{v?.toFixed(2)}</Text> },
    { title: '现价', dataIndex: 'current_price', align: 'right', width: 80,
      render: (v, r) => <Text strong style={{fontFamily:'var(--font-mono)',fontVariantNumeric:'tabular-nums', color: r.today_pct >=0 ? 'var(--up)' : 'var(--down)'}}>¥{v?.toFixed(2)}</Text> },
    { title: '今日', dataIndex: 'today_pct', align: 'right', width: 78,
      render: v => <PnLText value={v} /> },
    { title: '持仓盈亏', align: 'right', width: 120, render: (_, r) => (
      <div>
        <PnLText value={r.pnl} suffix="元" />
        <div><PnLText value={r.pnl_pct} /></div>
      </div>
    )},
    { title: '持仓', dataIndex: 'shares', align: 'right', width: 80,
      render: v => <Text style={{fontFamily:'var(--font-mono)'}}>{v?.toLocaleString()}股</Text> },
    { title: '市值', dataIndex: 'market_value', align: 'right', width: 90,
      render: v => <Text strong style={{fontFamily:'var(--font-mono)',fontVariantNumeric:'tabular-nums'}}>¥{(v/10000).toFixed(1)}万</Text> },
    { title: '仓位', dataIndex: 'position_pct', align: 'center', width: 80,
      render: (_, r) => {
        const pos = summary.total_value > 0 ? Math.round(r.market_value / summary.total_value * 100) : 0;
        return <Text style={{fontFamily:'var(--font-mono)'}}>{pos}%</Text>;
      }
    },
    { title: '评分', dataIndex: 'total_score', align: 'center', width: 80,
      render: v => {
        const c = v >= 70 ? 'var(--up)' : v >= 60 ? 'var(--warn)' : 'var(--accent)';
        return <span className={'score-badge ' + (v>=70?'score-high':v>=60?'score-mid':'score-low')} style={{background:c+'15',color:c,borderColor:c+'30'}}>{v||'--'}</span>;
      }
    },
    { title: '信号', dataIndex: 'signal', align: 'center', width: 72,
      render: s => s ? <span className={'signal-badge signal-'+s}>{signalMeta[s]?.label}</span> : <Text type="secondary">--</Text> },
    { title: '止损/目标', align: 'center', width: 120, render: (_, r) => (
      <Space size={4}>
        {r.stop_loss && <Tag color="red" style={{margin:0,fontSize:11}}>止损{r.stop_loss}</Tag>}
        {r.target_price && <Tag color="green" style={{margin:0,fontSize:11}}>目标{r.target_price}</Tag>}
      </Space>
    )},
    { title: '操作', align: 'center', width: 70, render: (_, r) => (
      <Popconfirm title="确认平仓？" onConfirm={() => handleDelete(r.code)} okText="确认" cancelText="取消">
        <Button type="text" danger size="small" icon={<DeleteOutlined />} />
      </Popconfirm>
    )},
  ];

  const totalCost = summary.total_cost || 0;
  const totalValue = summary.total_value || 0;
  const totalPnL = summary.total_pnl || 0;
  const totalPnLPct = summary.total_pnl_pct || 0;
  const todayPnL = summary.today_pnl || 0;
  const totalCash = Math.max(0, 1000000 - totalValue); // 假设100万本金，可配置化
  const totalAssets = totalValue + totalCash;
  const posPct = totalAssets > 0 ? Math.round(totalValue / totalAssets * 100) : 0;

  // 基于市场温度给仓位建议（这里简化：固定基准60%）
  const suggestedPos = 60;

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={4} style={{ margin: 0, fontWeight: 700 }}><WalletOutlined style={{color:'var(--accent)',marginRight:6}}/>我的持仓</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>跟踪持仓盈亏，结合策略信号给出调仓建议</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>添加持仓</Button>
      </div>

      {/* 账户概览 */}
      <Row gutter={[12,12]} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card bodyStyle={{ padding: '16px 20px' }}>
            <Statistic title="账户总资产" value={totalAssets} prefix="¥" precision={0}
              valueStyle={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-mono)' }} />
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>持仓市值 ¥{(totalValue/10000).toFixed(1)}万 · 现金 ¥{(totalCash/10000).toFixed(1)}万</Text>
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card bodyStyle={{ padding: '16px 20px' }}>
            <Statistic title="持仓盈亏" value={totalPnL} prefix={totalPnL>=0?'+':''} precision={2}
              valueStyle={{ fontSize: 24, fontWeight: 700, color: totalPnL>=0?'var(--up)':'var(--down)', fontFamily: 'var(--font-mono)' }} />
            <div style={{ marginTop: 8 }}>
              <PnLText value={totalPnLPct} />
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>收益率</Text>
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card bodyStyle={{ padding: '16px 20px' }}>
            <Statistic title="今日盈亏" value={todayPnL} prefix={todayPnL>=0?'+':''} precision={0}
              valueStyle={{ fontSize: 24, fontWeight: 700, color: todayPnL>=0?'var(--up)':'var(--down)', fontFamily: 'var(--font-mono)' }} />
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>{holdings.length}只持仓</Text>
            </div>
          </Card>
        </Col>
        <Col span={6}>
          <Card bodyStyle={{ padding: '16px 20px' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>当前仓位</Text>
            <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--font-mono)', color: posPct > suggestedPos + 20 ? 'var(--up)' : '#1A1A1E', marginTop: 4 }}>{posPct}%</div>
            <Progress percent={posPct} showInfo={false}
              strokeColor={posPct > suggestedPos + 20 ? 'var(--up)' : posPct < suggestedPos - 20 ? 'var(--down)' : 'var(--accent)'}
              style={{ marginTop: 8 }} />
            <Text type="secondary" style={{ fontSize: 11 }}>建议仓位 {suggestedPos}% {posPct > suggestedPos + 20 ? <><WarningOutlined style={{color:'var(--warn)',fontSize:12,marginRight:2}}/>偏高</> : posPct < suggestedPos - 20 ? '可加仓' : <><CheckCircleOutlined style={{color:'var(--down)',fontSize:12}}/>合理</>}</Text>
          </Card>
        </Col>
      </Row>

      {/* 持仓列表 */}
      <Card
        title={<Space><FundViewOutlined />持仓明细</Space>}
        bodyStyle={{ padding: 0 }}
      >
        {holdings.length === 0 ? (
          <div style={{ padding: '60px 0' }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Space direction="vertical" align="center">
                  <Text type="secondary">暂无持仓</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>点击右上角添加持仓，实时跟踪盈亏</Text>
                </Space>
              }
            >
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>添加第一笔持仓</Button>
            </Empty>
          </div>
        ) : (
          <Table
            columns={cols}
            dataSource={holdings}
            rowKey="code"
            pagination={false}
            size="middle"
            loading={loading}
            onRow={(r) => ({ style: { cursor: 'pointer' }, onClick: (e) => {
              if (e.target.closest('button') || e.target.closest('.ant-popconfirm')) return;
              navigate('/stock/'+r.code);
            }})}
          />
        )}
      </Card>

      {/* 调仓建议 */}
      {holdings.length > 0 && (
        <Card title={<Space><WarningOutlined />调仓建议</Space>} style={{ marginTop: 16 }}>
          {holdings.filter(h => h.signal === 'sell').length > 0 && (
            <Alert
              type="error" showIcon style={{ marginBottom: 12 }}
              message={<>建议减仓：{holdings.filter(h => h.signal === 'sell').map(h => h.name).join('、')}</>}
              description="这些股票技术面破位或估值偏高，建议减仓控制风险"
            />
          )}
          {holdings.filter(h => h.signal === 'buy').length > 0 && (
            <Alert
              type="success" showIcon style={{ marginBottom: 12 }}
              message={<>可加仓：{holdings.filter(h => h.signal === 'buy').map(h => h.name).join('、')}</>}
              description="这些股票评分较高且估值合理，可考虑适当加仓"
            />
          )}
          {holdings.filter(h => h.current_price <= (h.stop_loss || 0)).length > 0 && (
            <Alert
              type="warning" showIcon style={{ marginBottom: 12 }}
              message={<><WarningOutlined style={{color:'var(--warn)',fontSize:12,marginRight:2}}/>触及止损：{holdings.filter(h => h.current_price <= (h.stop_loss || 0)).map(h => h.name).join('、')}</>}
              description="已跌破止损线，建议严格止损"
            />
          )}
          {holdings.filter(h => h.signal !== 'sell' && h.signal !== 'buy' && h.current_price > (h.stop_loss || 0)).length === holdings.length &&
           holdings.filter(h => h.signal === 'sell').length === 0 && (
            <Alert type="info" showIcon message="持仓整体健康，无紧急调仓信号" description="继续持有，关注后续信号变化" />
          )}
        </Card>
      )}

      {/* 添加持仓弹窗 */}
      <Modal
        title="添加持仓"
        open={modalOpen}
        onOk={handleAdd}
        onCancel={() => { setModalOpen(false); form.resetFields(); }}
        confirmLoading={submitting}
        okText="添加" cancelText="取消"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="code" label="股票代码" rules={[{ required: true, message: '请输入股票代码' }]}>
            <Input placeholder="如 000333" maxLength={6} style={{ fontFamily: 'Inter' }} />
          </Form.Item>
          <Form.Item name="name" label="股票名称（可选）">
            <Input placeholder="留空则自动获取" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="buy_price" label="成本价（元）" rules={[{ required: true, message: '必填' }]}>
                <InputNumber min={0.01} step={0.01} style={{ width: '100%' }} prefix="¥" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="shares" label="持仓数量（股）" rules={[{ required: true, message: '必填' }]}>
                <InputNumber min={100} step={100} style={{ width: '100%' }} placeholder="100的整数倍" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="buy_date" label="买入日期">
            <DatePicker style={{ width: '100%' }} defaultValue={dayjs()} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
