import React, { useState, useEffect, useRef } from 'react';
import {
  Card, Typography, Row, Col, Slider, Switch, Button, Space, Form, Select, InputNumber,
  message, Divider, Tag, Statistic, Table, Alert, Descriptions, Progress, Modal, List,
  Tooltip, Spin,
} from 'antd';
import {
  SettingOutlined, SaveOutlined, ReloadOutlined, DatabaseOutlined,
  CheckCircleOutlined, LoadingOutlined, CloseCircleOutlined, SyncOutlined,
  GlobalOutlined, ApiOutlined,
} from '@ant-design/icons';

const { Title, Text } = Typography;

const stageMeta = {
  init:      { label: '初始化',   color: '#1677ff' },
  list:      { label: '加载股票池', color: '#1677ff' },
  quote:     { label: '拉取行情',   color: '#1677ff' },
  kline:     { label: '同步K线',   color: '#722ed1' },
  indicator: { label: '计算指标',   color: '#722ed1' },
  score:     { label: '计算评分',   color: '#fa8c16' },
  crowding:  { label: '计算拥挤度', color: '#fa8c16' },
  done:      { label: '完成',     color: '#52c41a', icon: <CheckCircleOutlined /> },
  error:     { label: '失败',     color: '#f5222d', icon: <CloseCircleOutlined /> },
};

export default function Settings() {
  const [form] = Form.useForm();
  const [syncing, setSyncing] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncStage, setSyncStage] = useState('');
  const [syncLogs, setSyncLogs] = useState([]);
  const [syncError, setSyncError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dbStats, setDbStats] = useState(null);
  const [dsStatus, setDsStatus] = useState(null);
  const [dsLoading, setDsLoading] = useState(false);
  const [selectedDs, setSelectedDs] = useState('auto');
  const esRef = useRef(null);

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem('cwms_settings') || '{}');
    form.setFieldsValue({
      valWeight: 35, qualWeight: 35, techWeight: 30,
      newEconBonus: 5, oldPenalty: 8,
      buyThreshold: 75, watchThreshold: 65, sellThreshold: 50,
      stopLoss: 15, takeProfit: 40,
      topCount: 10, autoSync: true, syncTime: '15:30',
      ...saved,
    });
    loadStats();
    loadDataSource();
    return () => { if (esRef.current) esRef.current.close(); };
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

  const addLog = (stage, msg, type='info') => {
    setSyncLogs(prev => [...prev, { key: Date.now()+Math.random(), stage, msg, type, time: new Date().toLocaleTimeString() }]);
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncLogs([]);
    setSyncProgress(0);
    setSyncStage('init');
    setSyncModalOpen(true);
    addLog('init', '触发同步任务...');

    try {
      // 先POST启动同步
      const startRes = await fetch('/api/sync', { method: 'POST' }).then(r => r.json());
      if (startRes.status === 'running') {
        addLog('init', '同步已在进行中', 'warn');
      }

      // 建立SSE连接监听进度
      const es = new EventSource('/api/sync/progress');
      esRef.current = es;
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === 'done') {
            addLog('done', '同步流程结束', 'ok');
            setSyncProgress(100);
            setSyncing(false);
            setSyncStage('done');
            es.close();
            esRef.current = null;
            loadStats();
            return;
          }
          if (data.type === 'status') {
            if (!data.running && syncing && syncStage !== 'done' && syncStage !== 'error') {
              // 初始状态
            }
            return;
          }
          // 进度消息
          if (data.stage) {
            setSyncStage(data.stage);
            if (typeof data.percent === 'number') {
              setSyncProgress(data.percent < 0 ? 0 : Math.min(100, data.percent));
            }
            const logType = data.stage === 'error' ? 'error' : (data.stage === 'done' ? 'ok' : 'info');
            addLog(data.stage, data.message, logType);
          }
        } catch(e) {}
      };
      es.onerror = () => {
        addLog('error', '连接中断', 'error');
        setSyncing(false);
      };
    } catch(e) {
      setSyncError(e.message);
      addLog('error', '启动失败: ' + e.message, 'error');
      setSyncing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const values = form.getFieldsValue();
      localStorage.setItem('cwms_settings', JSON.stringify(values));
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      message.success('设置已保存');
    } finally { setSaving(false); }
  };

  const currentStageMeta = stageMeta[syncStage] || { label: '处理中', color: '#1677ff' };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0, fontWeight: 700 }}>⚙️ 策略配置</Title>
        <Text type="secondary" style={{ fontSize: 12 }}>调整评分权重、信号阈值、同步设置</Text>
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
            extra={<Button type="primary" icon={syncing ? <LoadingOutlined /> : <ReloadOutlined spin={syncing}/>} onClick={handleSync} loading={syncing}>立即同步</Button>}
          >
            <Descriptions column={1} size="small" labelStyle={{color:'#667085'}} contentStyle={{fontWeight:600}}>
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
            <Alert type="info" showIcon style={{fontSize:12}}
              message="同步计划：启动时自动初始化热门股票池，手动同步更新行情/K线/评分" />
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
                      <Select.Option value="auto">🤖 自动选择（按网络连通性）</Select.Option>
                      {Object.entries(dsStatus.sources).map(([k, s]) => (
                        <Select.Option key={k} value={k} disabled={!s.ok}>
                          <Space>
                            <span>{s.label}</span>
                            {s.ok ? <Tag color="green" style={{margin:0}}>可用({s.latency}ms)</Tag>
                            : <Tag color="red" style={{margin:0}}>不可用</Tag>}
                            {s.regions?.includes('overseas') && !s.regions?.includes('domestic') && <Tag color="blue" style={{margin:0}}>海外</Tag>}
                            {s.regions?.includes('domestic') && !s.regions?.includes('overseas') && <Tag color="orange" style={{margin:0}}>国内</Tag>}
                            {s.regions?.length === 2 && <Tag color="purple" style={{margin:0}}>全球</Tag>}
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
                        {s.ok ? <CheckCircleOutlined style={{color:'#52c41a'}}/> : <CloseCircleOutlined style={{color:'#f5222d'}}/>}
                        <Text>{s.label}</Text>
                        <Text type="secondary">
                          ({s.regions?.map(r => r === 'domestic' ? '国内' : '海外').join('/')})
                        </Text>
                      </Space>
                      <Text type={s.ok ? 'success' : 'danger'}>
                        {s.ok ? `${s.latency}ms` : s.error?.substring(0, 25) || '连接失败'}
                      </Text>
                    </div>
                  ))}
                </div>
                <Divider style={{margin:'10px 0'}}/>
                <Alert type="info" showIcon style={{fontSize:11}}
                  message="国内部署选腾讯/新浪；海外部署（如Render）建议选Yahoo或自动选择。自动模式会自动探测最优数据源。"/>
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
              <p style={{color:'#667085'}}>以价值投资为核心策略，结合多因子评分模型、资金面分析、技术面择时、量化拥挤度，为个人投资者提供客观的交易参考。</p>
              <Divider style={{margin:'8px 0'}}/>
              <Space direction="vertical" size={4} style={{width:'100%'}}>
                <div style={{display:'flex',justifyContent:'space-between'}}><Text type="secondary">版本</Text><Text>v1.1.1</Text></div>
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
          保存设置
        </Button>
      </div>

      {/* 同步进度弹窗 */}
      <Modal
        title={<Space><SyncOutlined spin={syncing}/>数据同步进度</Space>}
        open={syncModalOpen}
        onCancel={() => { setSyncModalOpen(false); if (esRef.current) esRef.current.close(); esRef.current = null; }}
        footer={[
          <Button key="close" onClick={() => { setSyncModalOpen(false); if (esRef.current) esRef.current.close(); esRef.current = null; }} disabled={syncing}>
            {syncing ? '后台运行' : '关闭'}
          </Button>
        ]}
        maskClosable={false}
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
        <div style={{ maxHeight: 280, overflowY:'auto', background:'#fafafa', borderRadius:8, padding:12, fontSize:12, fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace' }}>
          <List
            size="small"
            dataSource={syncLogs}
            locale={{ emptyText: '等待日志...' }}
            renderItem={item => (
              <List.Item style={{ padding:'2px 0', border:'none' }}>
                <Text type="secondary" style={{marginRight:8, fontSize:11}}>{item.time}</Text>
                <Text type={item.type === 'error' ? 'danger' : (item.type === 'ok' ? 'success' : 'secondary')}>
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
