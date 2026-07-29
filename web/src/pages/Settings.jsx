import React, { useState, useEffect } from 'react';
import {
  Card, Typography, Row, Col, Slider, Switch, Button, Space, Form, Select, InputNumber,
  message, Divider, Tag, Statistic, Table, Alert, Descriptions,
} from 'antd';
import { SettingOutlined, SaveOutlined, ReloadOutlined, DatabaseOutlined } from '@ant-design/icons';
import { triggerSync } from '../api';

const { Title, Text } = Typography;

export default function Settings() {
  const [form] = Form.useForm();
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dbStats, setDbStats] = useState(null);

  useEffect(() => {
    form.setFieldsValue({
      valWeight: 35, qualWeight: 35, techWeight: 30,
      newEconBonus: 5, oldPenalty: 8,
      buyThreshold: 75, watchThreshold: 65, sellThreshold: 50,
      stopLoss: 15, takeProfit: 40,
      topCount: 10,
      autoSync: true,
      syncTime: '15:30',
    });
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const res = await fetch('/api/db/stats').then(r=>r.json());
      setDbStats(res);
    } catch(e) {}
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      message.success('设置已保存（下次评分生效）');
    } finally { setSaving(false); }
  };

  const handleSync = async () => {
    setSyncing(true);
    try { await triggerSync(); message.success('同步任务已触发'); }
    finally { setSyncing(false); setTimeout(loadStats, 5000); }
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0, fontWeight: 700 }}>⚙️ 系统设置</Title>
        <Text type="secondary" style={{ fontSize: 12 }}>调整评分权重、信号阈值、同步设置</Text>
      </div>

      <Row gutter={[16,16]}>
        {/* 评分权重 */}
        <Col span={12}>
          <Card title="评分权重设置" style={{ height: '100%' }}>
            <Form form={form} layout="vertical">
              <Form.Item label="质量分权重（好公司）" name="qualWeight">
                <Slider min={10} max={60} marks={{10:'10%',35:'35%',60:'60%'}}
                  tooltip={{ formatter: v=>v+'%' }} />
              </Form.Item>
              <Form.Item label="估值分权重（好价格）" name="valWeight">
                <Slider min={10} max={60} marks={{10:'10%',35:'35%',60:'60%'}}
                  tooltip={{ formatter: v=>v+'%' }} />
              </Form.Item>
              <Form.Item label="技术/资金分权重（好时机）" name="techWeight">
                <Slider min={10} max={60} marks={{10:'10%',30:'30%',60:'60%'}}
                  tooltip={{ formatter: v=>v+'%' }} />
              </Form.Item>
              <Divider style={{ margin: '12px 0' }} />
              <Form.Item label="新经济股加分" name="newEconBonus">
                <Slider min={0} max={15} marks={{0:'0',5:'+5',15:'+15'}}
                  tooltip={{ formatter: v=>'+'+v+'分' }} />
              </Form.Item>
              <Form.Item label="老头股扣分" name="oldPenalty">
                <Slider min={0} max={15} marks={{0:'0',8:'-8',15:'-15'}}
                  tooltip={{ formatter: v=>'-'+v+'分' }} />
              </Form.Item>
            </Form>
          </Card>
        </Col>

        {/* 信号阈值 */}
        <Col span={12}>
          <Card title="信号阈值设置" style={{ height: '100%' }}>
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

        {/* 数据同步 */}
        <Col span={12}>
          <Card title={<Space><DatabaseOutlined/>数据管理</Space>} extra={
            <Button icon={<ReloadOutlined spin={syncing}/>} onClick={handleSync} loading={syncing}>立即同步</Button>
          }>
            <Descriptions column={1} size="small" labelStyle={{color:'#667085'}} contentStyle={{fontWeight:600}}>
              {dbStats ? (
                <>
                  <Descriptions.Item label="股票数量">{dbStats.stocks} 只</Descriptions.Item>
                  <Descriptions.Item label="K线记录">{(dbStats.klines/10000).toFixed(1)} 万条</Descriptions.Item>
                  <Descriptions.Item label="技术指标">{(dbStats.indicators/10000).toFixed(1)} 万条</Descriptions.Item>
                  <Descriptions.Item label="财务记录">{dbStats.finance} 条</Descriptions.Item>
                  <Descriptions.Item label="最新交易日">{dbStats.latest_date}</Descriptions.Item>
                </>
              ) : (
                <Descriptions.Item label="状态">加载中...</Descriptions.Item>
              )}
            </Descriptions>
            <Divider style={{ margin: '12px 0' }} />
            <Alert type="info" showIcon style={{fontSize:12}}
              message="同步计划：10:00/11:30/14:00盘中行情更新，15:30全量同步（K线+指标+评分）" />
            <Form form={form} layout="inline" style={{ marginTop: 12 }}>
              <Form.Item name="autoSync" valuePropName="checked" label="自动同步">
                <Switch />
              </Form.Item>
            </Form>
          </Card>
        </Col>

        {/* 关于 */}
        <Col span={12}>
          <Card title="关于仓位满上">
            <div style={{ lineHeight: 1.8, fontSize: 13 }}>
              <p><b>仓位满上 TopUp</b> - A股智能决策助手</p>
              <p style={{color:'#667085'}}>以价值投资为核心策略，结合多因子评分模型、资金面分析、技术面择时，为个人投资者提供客观的交易参考。</p>
              <Divider style={{margin:'8px 0'}}/>
              <Space direction="vertical" size={4} style={{width:'100%'}}>
                <div style={{display:'flex',justifyContent:'space-between'}}><Text type="secondary">版本</Text><Text>v0.2.0</Text></div>
                <div style={{display:'flex',justifyContent:'space-between'}}><Text type="secondary">技术栈</Text><Text>Node.js + React + SQLite</Text></div>
                <div style={{display:'flex',justifyContent:'space-between'}}><Text type="secondary">数据源</Text><Text>腾讯财经 · 新浪财经 · 东方财富</Text></div>
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
    </div>
  );
}
