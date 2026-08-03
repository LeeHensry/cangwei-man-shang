import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Card, Typography, Row, Col, Slider, Switch, Button, Space, Form, Select, InputNumber,
  message, Divider, Tag, Statistic, Table, Alert, Descriptions, Progress, Modal, List,
  Tooltip, Spin, Popconfirm,
} from 'antd';
import {
  SettingOutlined, SaveOutlined, ReloadOutlined, DatabaseOutlined,
  CheckCircleOutlined, LoadingOutlined, CloseCircleOutlined, SyncOutlined,
  GlobalOutlined, ApiOutlined, ControlOutlined, HistoryOutlined, ThunderboltOutlined,
} from '@ant-design/icons';

const { Title, Text } = Typography;

const stageMeta = {
  init:      { label: '初始化',    color: 'var(--accent)' },
  list:      { label: '加载股票池', color: 'var(--accent)' },
  quote:     { label: '拉取行情',   color: 'var(--accent)' },
  kline:     { label: '同步K线',   color: 'var(--purple)' },
  indicator: { label: '计算指标',   color: 'var(--purple)' },
  score:     { label: '计算评分',   color: 'var(--warn)' },
  short:     { label: '短线信号',   color: 'var(--warn)' },
  crowding:  { label: '计算拥挤度', color: 'var(--warn)' },
  pool:      { label: '更新关注池', color: 'var(--warn)' },
  done:      { label: '完成',      color: 'var(--down)', icon: <CheckCircleOutlined /> },
  error:     { label: '失败',      color: 'var(--up)', icon: <CloseCircleOutlined /> },
};

export default function Settings() {
  const [form] = Form.useForm();
  const [syncing, setSyncing] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncStage, setSyncStage] = useState('');
  const [syncLogs, setSyncLogs] = useState([]);
  const [syncError, setSyncError] = useState(null);
  const [syncMode, setSyncMode] = useState('incremental');
  const [saving, setSaving] = useState(false);
  const [dbStats, setDbStats] = useState(null);
  const [dsStatus, setDsStatus] = useState(null);
  const [dsLoading, setDsLoading] = useState(false);
  const [selectedDs, setSelectedDs] = useState('auto');
  const [version, setVersion] = useState('');
  const esRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);

  useEffect(() => {
    // 从API加载设置（服务端持久化的）
    fetch('/api/settings').then(r => r.json()).then(s => {
      form.setFieldsValue({
        valWeight: 35, qualWeight: 35, techWeight: 30,
        newEconBonus: 5, oldPenalty: 8,
        buyThreshold: 75, watchThreshold: 65, sellThreshold: 50,
        stopLoss: 15, takeProfit: 40,
        topCount: 10, autoSync: true, syncTime: '15:30',
        ...s,
      });
    }).catch(() => {
      const saved = JSON.parse(localStorage.getItem('cwms_settings') || '{}');
      form.setFieldsValue({
        valWeight: 35, qualWeight: 35, techWeight: 30,
        newEconBonus: 5, oldPenalty: 8,
        buyThreshold: 75, watchThreshold: 65, sellThreshold: 50,
        stopLoss: 15, takeProfit: 40,
        topCount: 10, autoSync: true, syncTime: '15:30',
        ...saved,
      });
    });
    loadStats();
    loadDataSource();
    fetch('/api/version').then(r => r.json()).then(v => setVersion(v.version)).catch(() => {});
    return () => {
      if (esRef.current) esRef.current.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  const loadDataSource = async () => {
    setDsLoading(true);
    try {
      const r = await fetch('/api/datasource').then(r => r.json());
      setDsStatus(r);
      setSelectedDs(r.current || 'auto');
    } catch(e) {}
    setDsLoading(false);
  };

  const handleSwitchDs = async (value) => {
    try {
      const r = await fetch('/api/datasource', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: value }),
      }).then(r => r.json());
      if (r.ok) {
        message.success(`已切换到 ${r.label}`);
        setSelectedDs(value);
        await loadDataSource();
      } else {
        message.error(r.error || '切换失败');
      }
    } catch(e) { message.error(e.message); }
  };

  const loadStats = async () => {
    try {
      const res = await fetch('/api/db/stats').then(r => r.json());
      setDbStats(res);
    } catch(e) {}
  };

  const addLog = useCallback((stage, msg, type='info') => {
    setSyncLogs(prev => [...prev.slice(-200), { key: Date.now()+Math.random(), stage, msg, type, time: new Date().toLocaleTimeString() }]);
  }, []);

  const connectSSE = useCallback(() => {
    const es = new EventSource('/api/sync/progress');
    esRef.current = es;

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'done') {
          addLog('done', '同步完成', 'ok');
          setSyncProgress(100);
          setSyncing(false);
          setSyncStage('done');
          es.close();
          esRef.current = null;
          reconnectAttemptsRef.current = 0;
          loadStats();
          message.success('数据同步完成');
          return;
        }
        if (data.type === 'status') {
          if (data.running && !syncing) {
            setSyncing(true);
          }
          return;
        }
        if (data.stage) {
          setSyncStage(data.stage);
          if (typeof data.percent === 'number') {
            setSyncProgress(data.percent < 0 ? Math.max(0, syncProgress) : Math.min(100, data.percent));
          }
          const logType = data.stage === 'error' ? 'error' : (data.stage === 'done' ? 'ok' : 'info');
          addLog(data.stage, data.message, logType);
        }
      } catch(e) {}
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      // 指数退避重连（最多5次）
      if (reconnectAttemptsRef.current < 5 && syncing) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
        reconnectAttemptsRef.current++;
        addLog('init', `连接中断，${delay/1000}秒后重连(${reconnectAttemptsRef.current}/5)...`, 'warn');
        reconnectTimerRef.current = setTimeout(() => {
          connectSSE();
        }, delay);
      } else if (syncing) {
        addLog('error', '连接多次中断，同步可能仍在后台运行，请稍后刷新查看', 'error');
        setSyncing(false);
      }
    };
  }, [addLog, syncing, syncProgress]);

  const handleSync = async (mode = 'incremental') => {
    setSyncMode(mode);
    setSyncing(true);
    setSyncError(null);
    setSyncLogs([]);
    setSyncProgress(0);
    setSyncStage('init');
    setSyncModalOpen(true);
    reconnectAttemptsRef.current = 0;
    addLog('init', mode === 'full' ? '触发全量同步（拉取3年历史K线，预计5-10分钟）...' : '触发增量同步...');

    try {
      const startRes = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      }).then(r => r.json());
      if (startRes.status === 'running') {
        addLog('init', '同步已在进行中，连接进度...', 'warn');
      }
      connectSSE();
    } catch(e) {
      setSyncError(e.message);
      addLog('error', '启动失败: ' + e.message, 'error');
      setSyncing(false);
    }
  };

  const handleCloseModal = () => {
    setSyncModalOpen(false);
    // SSE连接保留，继续接收后台进度
    // 用户可以在页面其他区域操作，同步在后台运行
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = form.getFieldsValue();
      localStorage.setItem('cwms_settings', JSON.stringify(values));
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      }).then(r => r.json());
      if (res.ok) {
        message.success('设置已保存，系统正在使用新参数重新评分...');
      } else {
        message.error('保存失败');
      }
    } finally { setSaving(false); }
  };

  const currentStageMeta = stageMeta[syncStage] || { label: '处理中', color: 'var(--accent)' };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0, fontWeight: 700 }}><ControlOutlined style={{color:'var(--accent)',marginRight:6}}/>策略配置</Title>
        <Text type="secondary" style={{ fontSize: 12 }}>调整评分权重、信号阈值、同步设置（保存后自动重新计算评分）</Text>
      </div>

      <Row gutter={[16,16]}>
        <Col span={12}>
          <Card title="评分权重" style={{ height: '100%' }}>
            <Form form={form} layout="vertical">
              <Form.Item label="质量分权重（好公司）" name="qualWeight">
                <Slider min={10} max={60} marks={{10:'10%',35:'35%',60:'60%'}} tooltip={{ formatter: v=>v+'%' }} />
              </Form.Item>
              <Form.Item label="估值分权重（好价格）" name="valWeight">
                <Slider min={10} max={60} marks={{10:'10%',35:'35%',60:'60%'}} tooltip={{ formatter: v=>v+'%' }} />
              </Form.Item>
              <Form.Item label="技术/资金分权重（好时机）" name="techWeight">
                <Slider min={10} max={60} marks={{10:'10%',30:'30%',60:'60%'}} tooltip={{ formatter: v=>v+'%' }} />
              </Form.Item>
              <Alert type="info" showIcon style={{fontSize:11, marginBottom:12}}
                message="三个权重之和建议为100%。价值投资建议提高估值权重；趋势投资建议提高技术权重。" />
              <Divider style={{ margin: '12px 0' }} />
              <Form.Item label="新经济股加分" name="newEconBonus">
                <Slider min={0} max={15} marks={{0:'0',5:'+5',15:'+15'}} tooltip={{ formatter: v=>'+'+v+'分' }} />
              </Form.Item>
              <Form.Item label="传统行业扣分" name="oldPenalty">
                <Slider min={0} max={15} marks={{0:'0',8:'-8',15:'-15'}} tooltip={{ formatter: v=>'-'+v+'分' }} />
              </Form.Item>
            </Form>
          </Card>
        </Col>

        <Col span={12}>
          <Card title="信号阈值" style={{ height: '100%' }}>
            <Form form={form} layout="vertical">
              <Form.Item label="买入信号最低分" name="buyThreshold">
                <Slider min={60} max={90} marks={{60:60,75:75,90:90}} />
              </Form.Item>
              <Form.Item label="关注信号最低分" name="watchThreshold">
                <Slider min={50} max={75} marks={{50:50,65:65,75:75}} />
              </Form.Item>
              <Form.Item label="减仓信号最高分" name="sellThreshold">
                <Slider min={30} max={60} marks={{30:30,50:50,60:60}} />
              </Form.Item>
              <Alert type="info" showIcon style={{fontSize:11, marginBottom:12}}
                message="阈值越高信号越保守（数量少但质量高）；阈值越低信号越积极（数量多但需筛选）。" />
              <Divider style={{ margin: '12px 0' }} />
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="默认止损%" name="stopLoss">
                    <InputNumber min={5} max={30} formatter={v=>v+'%'} parser={v=>Number(v.replace('%',''))} style={{width:'100%'}} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="默认止盈%" name="takeProfit">
                    <InputNumber min={10} max={100} formatter={v=>v+'%'} parser={v=>Number(v.replace('%',''))} style={{width:'100%'}} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label="TOP推荐数量" name="topCount">
                <Select options={[5,8,10,15,20].map(n=>({label:'TOP '+n,value:n}))} style={{width:120}} />
              </Form.Item>
            </Form>
          </Card>
        </Col>

        <Col span={12}>
          <Card
            title={<Space><DatabaseOutlined/>数据管理</Space>}
            extra={
              <Space>
                <Button
                  icon={syncing ? <LoadingOutlined /> : <ThunderboltOutlined />}
                  onClick={() => handleSync('incremental')}
                  loading={syncing && syncMode === 'incremental'}
                  type="primary"
                  size="middle"
                >
                  增量同步
                </Button>
                <Popconfirm
                  title="全量同步将拉取3年历史K线"
                  description="预计需要5-10分钟，建议在网络稳定时执行。同步将在后台运行，您可以关闭进度窗口继续使用其他功能。"
                  onConfirm={() => handleSync('full')}
                  okText="开始全量同步"
                  cancelText="取消"
                >
                  <Button
                    icon={<HistoryOutlined />}
                    loading={syncing && syncMode === 'full'}
                    size="middle"
                  >
                    全量同步
                  </Button>
                </Popconfirm>
              </Space>
            }
          >
            <Descriptions column={1} size="small" labelStyle={{color:'var(--text-secondary)'}} contentStyle={{fontWeight:600}}>
              {dbStats ? (
                <>
                  <Descriptions.Item label="股票数量">{dbStats.stocks} 只</Descriptions.Item>
                  <Descriptions.Item label="K线记录">{(dbStats.klines/10000).toFixed(1)} 万条</Descriptions.Item>
                  <Descriptions.Item label="技术指标">{(dbStats.indicators/10000).toFixed(1)} 万条</Descriptions.Item>
                  <Descriptions.Item label="财务记录">{dbStats.finance} 条</Descriptions.Item>
                  <Descriptions.Item label="最新交易日">{dbStats.latest_date || '-'}</Descriptions.Item>
                </>
              ) : (
                <Descriptions.Item label="状态">加载中...</Descriptions.Item>
              )}
            </Descriptions>
            <Divider style={{ margin: '12px 0' }} />
            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
              <div><Tag color="blue">增量同步</Tag> 更新近60天行情、K线、评分（约1-2分钟）</div>
              <div style={{marginTop:4}}><Tag color="purple">全量同步</Tag> 拉取3年历史K线，支持回测和长期均线（约5-10分钟，后台运行）</div>
              <div style={{marginTop:4, color:'var(--text-secondary)'}}>同步过程中可以关闭进度窗口，同步将在后台继续执行。</div>
            </div>
          </Card>
        </Col>

        <Col span={12}>
          <Card
            title={<Space><GlobalOutlined />数据源</Space>}
            extra={<Button size="small" icon={<ReloadOutlined />} onClick={loadDataSource} loading={dsLoading}>探测</Button>}
          >
            {dsLoading ? (
              <div style={{textAlign:'center', padding:20}}><Spin /></div>
            ) : dsStatus ? (
              <>
                <Form layout="vertical" size="small">
                  <Form.Item label="当前数据源" style={{marginBottom:12}}>
                    <Select value={selectedDs} onChange={handleSwitchDs} style={{width:'100%'}}>
                      <Select.Option value="auto">自动选择（按网络连通性）</Select.Option>
                      {Object.entries(dsStatus.sources).map(([k, s]) => (
                        <Select.Option key={k} value={k} disabled={!s.ok}>
                          <Space>
                            <span>{s.label}</span>
                            {s.ok ? <Tag color="green" style={{margin:0}}>可用({s.latency}ms)</Tag>
                            : <Tag color="red" style={{margin:0}}>不可用</Tag>}
                          </Space>
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Form>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                  {Object.entries(dsStatus.sources).map(([k, s]) => (
                    <div key={k} style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                      <Space size={6}>
                        {s.ok ? <CheckCircleOutlined style={{color:'var(--down)'}}/> : <CloseCircleOutlined style={{color:'var(--up)'}}/>}
                        <Text>{s.label}</Text>
                      </Space>
                      <Text type={s.ok ? 'success' : 'danger'}>
                        {s.ok ? `${s.latency}ms` : s.error?.substring(0, 30) || '连接失败'}
                      </Text>
                    </div>
                  ))}
                </div>
                <Divider style={{margin:'10px 0'}}/>
                <Alert type="info" showIcon style={{fontSize:11}}
                  message="Render海外部署建议选Yahoo或自动模式。自动模式会自动探测最优数据源。"/>
              </>
            ) : (
              <Text type="secondary">加载中...</Text>
            )}
          </Card>
        </Col>

        <Col span={12}>
          <Card title="关于仓位满上">
            <div style={{ lineHeight: 1.8, fontSize: 13 }}>
              <p><b>仓位满上 TopUp</b> - A股智能决策助手</p>
              <p style={{color:'var(--text-secondary)'}}>以价值投资为核心策略，结合多因子评分模型、资金面分析、技术面择时、量化拥挤度，为个人投资者提供客观的交易参考。</p>
              <Divider style={{margin:'8px 0'}}/>
              <Space direction="vertical" size={4} style={{width:'100%'}}>
                <div style={{display:'flex',justifyContent:'space-between'}}><Text type="secondary">版本</Text><Text>{version || 'v1.x'}</Text></div>
                <div style={{display:'flex',justifyContent:'space-between'}}><Text type="secondary">技术栈</Text><Text>Node.js + React + SQLite</Text></div>
                <div style={{display:'flex',justifyContent:'space-between'}}><Text type="secondary">数据源</Text><Text>腾讯/新浪/Yahoo（自动切换）</Text></div>
                <div style={{display:'flex',justifyContent:'space-between'}}><Text type="secondary">提醒</Text><Tag color="warning">仅供参考，不构成投资建议</Tag></div>
              </Space>
            </div>
          </Card>
        </Col>
      </Row>

      <div style={{ marginTop: 16, textAlign: 'center' }}>
        <Button type="primary" icon={<SaveOutlined />} size="large" onClick={handleSave} loading={saving} style={{padding:'0 40px'}}>
          保存设置并重新评分
        </Button>
      </div>

      {/* 同步进度弹窗 - 支持后台运行 */}
      <Modal
        title={
          <Space>
            <SyncOutlined spin={syncing}/>
            {syncMode === 'full' ? '全量数据同步' : '数据同步'}
            {syncing && <Tag color="processing" style={{margin:0}}>后台运行中</Tag>}
          </Space>
        }
        open={syncModalOpen}
        onCancel={handleCloseModal}
        footer={[
          <Button key="close" onClick={handleCloseModal}>
            {syncing ? '后台运行' : '关闭'}
          </Button>
        ]}
        maskClosable={true}
        width={560}
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom: 8 }}>
            <Space>
              <Tag color={currentStageMeta.color} style={{ margin:0 }}>
                {currentStageMeta.icon || (syncing ? <LoadingOutlined /> : null)} {currentStageMeta.label}
              </Tag>
              <Text type="secondary" style={{fontSize:12}}>{syncLogs.length > 0 ? syncLogs[syncLogs.length-1]?.msg : ''}</Text>
            </Space>
            <Text strong>{syncProgress}%</Text>
          </div>
          <Progress percent={syncProgress} strokeColor={currentStageMeta.color} showInfo={false}
            status={syncError ? 'exception' : (syncProgress >= 100 ? 'success' : 'active')} />
        </div>
        {syncMode === 'full' && syncing && (
          <Alert type="info" showIcon style={{fontSize:11, marginBottom:12}}
            message="全量同步正在后台运行，关闭此窗口不会中断同步。可稍后刷新页面查看最新数据。" />
        )}
        <div style={{ maxHeight: 280, overflowY:'auto', background:'var(--bg-secondary, #fafafa)', borderRadius:8, padding:12, fontSize:12, fontFamily:'var(--font-mono)' }}>
          <List
            size="small"
            dataSource={syncLogs}
            locale={{ emptyText: '等待日志...' }}
            renderItem={item => (
              <List.Item style={{ padding:'2px 0', border:'none' }}>
                <Text type="secondary" style={{marginRight:8, fontSize:11}}>{item.time}</Text>
                <Text type={item.type === 'error' ? 'danger' : (item.type === 'warn' ? 'warning' : (item.type === 'ok' ? 'success' : 'secondary'))}>
                  {item.msg}
                </Text>
              </List.Item>
            )}
          />
        </div>
      </Modal>
    </div>
  );
}
