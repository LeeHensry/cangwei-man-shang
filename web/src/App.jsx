import React, { useState, useEffect } from 'react';
import { Layout, Menu, Input, Avatar, Space, Badge } from 'antd';
import {
  DashboardOutlined, FundOutlined, ThunderboltOutlined, WalletOutlined,
  SettingOutlined, RadarChartOutlined,
  SearchOutlined, BellOutlined,
} from '@ant-design/icons';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Signals from './pages/Signals';
import StockDetail from './pages/StockDetail';
import Holdings from './pages/Holdings';
import Settings from './pages/Settings';
import ShortTerm from './pages/ShortTerm';
import Crowding from './pages/Crowding';

const { Sider, Content, Header } = Layout;

function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const menuItems = [
    { key: '/',          icon: <DashboardOutlined />,  label: '市场总览' },
    { key: '/signals',   icon: <FundOutlined />,       label: '价值信号' },
    { key: '/short-term',icon: <ThunderboltOutlined />,label: '短线机会' },
    { key: '/holdings',  icon: <WalletOutlined />,     label: '我的持仓' },
    { key: '/crowding',  icon: <RadarChartOutlined />, label: '拥挤度雷达' },
    { key: '/settings',  icon: <SettingOutlined />,    label: '设置' },
  ];

  return (
    <Layout style={{ height:'100vh', background:'#FAFAFA' }}>
      <Sider
        width={232}
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        style={{
          background:'#FFFFFF',
          borderRight:'1px solid #E2E8F0',
          boxShadow:'0 0 20px rgba(0,0,0,0.02)',
        }}
      >
        {/* Logo — F1矮胖像素威士忌杯(深色版) + 上下排版标题 */}
        <div style={{
          padding: collapsed?'24px 12px 20px':'28px 24px 24px',
          display:'flex', alignItems:'center', gap:12,
        }}>
          <svg width="38" height="38" viewBox="0 0 32 32" shapeRendering="crispEdges" style={{flexShrink:0}}>
            {/* F1 矮胖型 32x32 — 深色轮廓+品牌蓝酒液 */}
            <rect x="8" y="2" width="1" height="1" fill="#0F172A"/><rect x="23" y="2" width="1" height="1" fill="#0F172A"/>
            <rect x="7" y="3" width="1" height="2" fill="#0F172A"/><rect x="24" y="3" width="1" height="2" fill="#0F172A"/>
            <rect x="6" y="5" width="1" height="3" fill="#0F172A"/><rect x="25" y="5" width="1" height="3" fill="#0F172A"/>
            <rect x="5" y="8" width="1" height="5" fill="#0F172A"/><rect x="26" y="8" width="1" height="5" fill="#0F172A"/>
            <rect x="6" y="13" width="1" height="2" fill="#0F172A"/><rect x="25" y="13" width="1" height="2" fill="#0F172A"/>
            <rect x="7" y="15" width="1" height="2" fill="#0F172A"/><rect x="24" y="15" width="1" height="2" fill="#0F172A"/>
            <rect x="8" y="17" width="1" height="1" fill="#0F172A"/><rect x="23" y="17" width="1" height="1" fill="#0F172A"/>
            <rect x="9" y="18" width="14" height="1" fill="#0F172A"/>
            {/* 品牌电蓝渐变酒液 */}
            <rect x="7" y="8" width="18" height="2" fill="#0052FF"/><rect x="6" y="10" width="20" height="3" fill="#0052FF"/>
            <rect x="6" y="13" width="20" height="2" fill="#0052FF"/><rect x="7" y="15" width="18" height="2" fill="#0052FF"/>
            <rect x="8" y="17" width="16" height="1" fill="#0052FF" opacity="0.7"/>
            <rect x="9" y="18" width="14" height="1" fill="#4D7CFF" opacity="0.4"/>
            <rect x="6" y="9" width="1" height="1" fill="#0052FF"/><rect x="25" y="9" width="1" height="1" fill="#0052FF"/>
            {/* 高光 — 亮蓝 */}
            <rect x="7" y="8" width="7" height="1" fill="#4D7CFF" opacity="0.5"/>
            <rect x="7" y="9" width="1" height="4" fill="#fff" opacity="0.15"/>
            <rect x="12" y="11" width="3" height="2" fill="#fff" opacity="0.3"/>
            <rect x="18" y="13" width="2" height="2" fill="#fff" opacity="0.25"/>
            {/* 杯茎+底座 深色 */}
            <rect x="15" y="19" width="2" height="5" fill="#0F172A"/>
            <rect x="11" y="24" width="10" height="1" fill="#0F172A"/>
            <rect x="9" y="25" width="14" height="1" fill="#0F172A"/>
          </svg>
          {!collapsed && (
            <div style={{display:'flex',flexDirection:'column',gap:2,lineHeight:1}}>
              <div style={{
                fontFamily:"'Calistoga',Georgia,serif",
                fontSize:20, fontWeight:400, color:'#0F172A',
                letterSpacing:'0', lineHeight:1,
              }}>仓位满上</div>
              <div style={{
                fontSize:11, color:'#64748B', fontWeight:500,
                letterSpacing:'0.1em', textTransform:'uppercase', marginTop:3,
                fontFamily:"'JetBrains Mono',monospace",
              }}>TopUp</div>
            </div>
          )}
        </div>

        {/* Nav */}
        <Menu
          mode="inline"
          selectedKeys={[location.pathname.startsWith('/stock') ? '/' : location.pathname]}
          items={menuItems}
          onClick={({key}) => navigate(key)}
          style={{
            background:'transparent', border:'none',
            padding:'4px 10px',
          }}
        />

        {/* Bottom version card */}
        {!collapsed && (
          <div style={{
            position:'absolute', bottom:16, left:14, right:14,
            padding:'14px 16px', borderRadius:14,
            background:'linear-gradient(135deg, rgba(0,82,255,0.04), rgba(77,124,255,0.02))',
            border:'1px solid rgba(0,82,255,0.12)',
          }}>
            <div style={{
              fontSize:10, color:'#64748B', fontWeight:500,
              letterSpacing:'0.1em', textTransform:'uppercase',
              marginBottom:5, fontFamily:"'JetBrains Mono',monospace",
            }}>Version</div>
            <div style={{
              fontFamily:"'Calistoga',Georgia,serif",
              fontSize:18, fontWeight:400, color:'#0F172A',
              fontVariantNumeric:'tabular-nums',
            }}>v1.3.0</div>
            <div style={{ fontSize:11, color:'#94A3B8', fontWeight:400, marginTop:4 }}>价值投资辅助</div>
          </div>
        )}
      </Sider>

      <Layout>
        {/* Top bar */}
        <Header style={{
          height:64,
          padding:'0 32px',
          display:'flex', alignItems:'center', justifyContent:'space-between',
          background:'rgba(255,255,255,0.82)',
          backdropFilter:'blur(20px)',
          WebkitBackdropFilter:'blur(20px)',
          borderBottom:'1px solid #E2E8F0',
          position:'sticky', top:0, zIndex:100,
        }}>
          <div style={{display:'flex',alignItems:'center',gap:14}}>
            <div style={{
              fontSize:13, color:'#64748B', fontWeight:400,
              fontFamily:"'Inter',sans-serif",
            }}>
              {currentTime.toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'})}
            </div>
            <div style={{
              display:'inline-flex',alignItems:'center',gap:6,
              padding:'4px 12px', borderRadius:999,
              background:'rgba(34,197,94,0.08)',
              border:'1px solid rgba(34,197,94,0.2)',
            }}>
              <span style={{
                width:6,height:6,borderRadius:'50%',
                background:'#22C55E',
                boxShadow:'0 0 0 0 rgba(34,197,94,0.5)',
                animation:'pulse-dot 2s ease-in-out infinite',
              }}/>
              <span style={{fontSize:11, color:'#16A34A', fontWeight:600, fontFamily:"'JetBrains Mono',monospace",letterSpacing:'0.05em',textTransform:'uppercase'}}>Live</span>
            </div>
          </div>
          <Space size={16}>
            <Input
              prefix={<SearchOutlined style={{color:'#94A3B8'}}/>}
              placeholder="搜索股票代码 / 名称..."
              style={{
                width:280, height:40,
                borderRadius:12,
              }}
              styles={{input:{background:'transparent',color:'#0F172A',fontWeight:400}}}
              onPressEnter={e => navigate('/stock/'+e.target.value)}
            />
            <Badge dot color="#0052FF" offset={[-2,2]}>
              <BellOutlined style={{fontSize:18,color:'#64748B',cursor:'pointer',transition:'color 0.2s'}}
                onMouseEnter={e => e.target.style.color='#0052FF'}
                onMouseLeave={e => e.target.style.color='#64748B'}
              />
            </Badge>
            <Avatar size={36} style={{
              background:'linear-gradient(135deg,#0052FF,#4D7CFF)',
              fontWeight:600, fontSize:13, color:'#fff',
              boxShadow:'0 4px 14px rgba(0,82,255,0.25)',
            }}>U</Avatar>
          </Space>
        </Header>

        <Content style={{
          padding:'32px 36px',
          overflowY:'auto',
          background:'#FAFAFA',
        }}>
          <Routes>
            <Route path="/" element={<Dashboard/>}/>
            <Route path="/signals" element={<Signals/>}/>
            <Route path="/short-term" element={<ShortTerm/>}/>
            <Route path="/holdings" element={<Holdings/>}/>
            <Route path="/settings" element={<Settings/>}/>
            <Route path="/crowding" element={<Crowding/>}/>
            <Route path="/stock/:code" element={<StockDetail/>}/>
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <MainLayout/>
    </BrowserRouter>
  );
}
