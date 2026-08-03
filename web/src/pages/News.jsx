import React, { useState, useEffect } from 'react';
import { Card, Typography, List, Tag, Row, Col, Button, Space, Tabs, Spin, Empty, Avatar } from 'antd';
import { BulbOutlined, RiseOutlined, FallOutlined, SoundOutlined, ReadOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

// 新闻源配置
const NEWS_SOURCES = [
  { key: 'market', label: '市场要闻', type: 'gn' },
  { key: 'stock', label: '股票新闻', type: 'cj' },
  { key: 'global', label: '全球市场', type: 'global' },
];

export default function News() {
  const [news, setNews] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('market');

  const loadNews = async (type) => {
    setLoading(true);
    try {
      // 用新浪财经RSS替代（CORS友好的方式通过后端代理）
      const res = await fetch(`/api/news?type=${type}`).then(r => r.json());
      setNews(prev => ({ ...prev, [type]: res.items || [] }));
    } catch(e) {
      // 后端未实现时使用模拟数据
      setNews(prev => ({ ...prev, [type]: [
        { title: 'A股三大指数集体收跌，两市成交额超1.9万亿', time: '2026-07-24 15:00', source: '财经快讯', tag: '大盘' },
        { title: '新能源板块资金流出明显，半导体表现抗跌', time: '2026-07-24 14:30', source: '盘面观察', tag: '板块' },
        { title: '机构观点：当前估值处于历史中位，关注结构性机会', time: '2026-07-24 12:00', source: '券商晨报', tag: '策略' },
        { title: '北向资金今日净流出超百亿，蓝筹股遭抛售', time: '2026-07-24 15:30', source: '资金面', tag: '资金' },
        { title: '央行今日开展逆回购操作，资金面保持平稳', time: '2026-07-24 09:30', source: '宏观', tag: '宏观' },
      ]}));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNews(activeTab);
  }, [activeTab]);

  const tagColors = { '大盘': 'red', '板块': 'orange', '策略': 'blue', '资金': 'purple', '宏观': 'cyan', '公告': 'green' };

  return (
    <div>
      <div style={{ marginBottom: 16, display:'flex',justifyContent:'space-between',alignItems:'center' }}>
        <div>
          <Title level={4} style={{ margin: 0, fontWeight: 700 }}>📰 市场资讯</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>财经新闻+市场热点+策略观点（资讯模块开发中，将接入LLM摘要）</Text>
        </div>
        <Button icon={<SoundOutlined />} onClick={() => loadNews(activeTab)}>刷新</Button>
      </div>

      {/* 资讯提醒条 */}
      <Card bodyStyle={{ padding: '12px 20px' }} style={{ marginBottom: 16, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}>
        <Row align="middle" gutter={12}>
          <Col><BulbOutlined style={{ fontSize: 20, color: '#f79009' }} /></Col>
          <Col flex="1">
            <Text strong style={{ fontSize: 13 }}>💡 今日市场状态</Text>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                市场温度 <Text strong style={{color:'#f79009'}}>51°（温）</Text>，成交 <Text strong>1.93万亿</Text>，
                建议仓位 <Text strong>40-60%</Text>。今日放量下跌，注意控制仓位，等待企稳信号。
              </Text>
            </div>
          </Col>
        </Row>
      </Card>

      <Row gutter={[16,16]}>
        <Col span={16}>
          <Card bodyStyle={{ padding: 0 }}>
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              items={NEWS_SOURCES.map(s => ({ key: s.key, label: s.label }))}
              style={{ padding: '0 16px' }}
            />
            <div style={{ padding: '0 16px 16px' }}>
              {loading ? <div style={{textAlign:'center',padding:40}}><Spin tip="加载中..."/></div> :
               (news[activeTab]||[]).length === 0 ? <Empty description="暂无新闻" /> :
               <List
                 dataSource={news[activeTab]||[]}
                 renderItem={item => (
                   <List.Item style={{ padding: '10px 0', borderBottom: '1px solid #E2E8F0', cursor: 'pointer' }}>
                     <List.Item.Meta
                       avatar={
                         <div style={{width:36,height:36,borderRadius:8,background:'#F8FAFC',display:'flex',alignItems:'center',justifyContent:'center'}}>
                           <ReadOutlined style={{color:'#94A3B8',fontSize:16}}/>
                         </div>
                       }
                       title={
                         <Space size={8}>
                           <Tag color={tagColors[item.tag]||'blue'} style={{margin:0,fontSize:10}}>{item.tag}</Tag>
                           <Text style={{fontSize:13}}>{item.title}</Text>
                         </Space>
                       }
                       description={
                         <Space size={10}>
                           <Text type="secondary" style={{fontSize:11}}>{item.source}</Text>
                           <Text type="secondary" style={{fontSize:11}}>{item.time}</Text>
                         </Space>
                       }
                     />
                   </List.Item>
                 )}
               />}
            </div>
          </Card>
        </Col>

        {/* 侧边栏：策略提醒 */}
        <Col span={8}>
          <Card title={<Space><BulbOutlined/>策略信号提醒</Space>} size="small" style={{marginBottom:16}}>
            <List
              size="small"
              dataSource={[
                { type: 'warn', text: '今日放量下跌，持仓股注意止损位' },
                { type: 'info', text: '科技/新经济板块回调，关注逢低布局机会' },
                { type: 'ok', text: '价值评分买入信号股数量增加' },
              ]}
              renderItem={item => (
                <List.Item style={{border:'none',padding:'4px 0'}}>
                  <Text style={{fontSize:12}}>
                    {item.type==='warn' && <Text style={{color:'#f04438'}}>⚠️ </Text>}
                    {item.type==='info' && <Text style={{color:'#2e90fa'}}>ℹ️ </Text>}
                    {item.type==='ok' && <Text style={{color:'#12b76a'}}>✓ </Text>}
                    {item.text}
                  </Text>
                </List.Item>
              )}
            />
          </Card>

          <Card title="市场情绪指标" size="small">
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              {[
                { label: '涨停家数', value: '32', color: '#f04438' },
                { label: '跌停家数', value: '28', color: '#12b76a' },
                { label: '上涨家数', value: '892', color: '#f04438' },
                { label: '下跌家数', value: '4236', color: '#12b76a' },
                { label: '北向资金', value: '-108亿', color: '#12b76a' },
                { label: '两融余额', value: '1.68万亿', color: '#2e90fa' },
              ].map(s => (
                <div key={s.label} style={{textAlign:'center',padding:8,background:'#FFFFFF',borderRadius:8,border:'1px solid #F1F5F9'}}>
                  <div style={{fontSize:18,fontWeight:700,color:s.color,fontFamily:'Inter'}}>{s.value}</div>
                  <Text type="secondary" style={{fontSize:11}}>{s.label}</Text>
                </div>
              ))}
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
