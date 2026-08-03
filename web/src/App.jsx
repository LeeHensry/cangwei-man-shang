import React, { useState } from 'react';
import { Layout, Menu, Typography, Badge, Space, Result, Button } from 'antd';
import {
  DashboardOutlined,
  ThunderboltOutlined,
  RocketOutlined,
  WalletOutlined,
  RadarChartOutlined,
  StarOutlined,
  HistoryOutlined,
  ControlOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { AuthProvider, UserBadge, useAuth } from './auth';
import Dashboard from './pages/Dashboard';
import Signals from './pages/Signals';
import Crowding from './pages/Crowding';
import StockDetail from './pages/StockDetail';
import Holdings from './pages/Holdings';
import Backtest from './pages/Backtest';
import ShortTerm from './pages/ShortTerm';
import Crypto from './pages/Crypto';
import Settings from './pages/Settings';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

// F1像素威士忌杯Logo
function PixelLogo({ size = 36 }) {
  const s = size / 38;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" shapeRendering="crispEdges" style={{ flexShrink: 0 }}>
      {/* 杯身轮廓 */}
      <rect x="8" y="2" width={1} height={1} fill="#0F172A"/><rect x="23" y="2" width={1} height={1} fill="#0F172A"/>
      <rect x="7" y="3" width={1} height={2} fill="#0F172A"/><rect x="24" y="3" width={1} height={2} fill="#0F172A"/>
      <rect x="6" y="5" width={1} height={3} fill="#0F172A"/><rect x="25" y="5" width={1} height={3} fill="#0F172A"/>
      <rect x="5" y="8" width={1} height={5} fill="#0F172A"/><rect x="26" y="8" width={1} height={5} fill="#0F172A"/>
      <rect x="6" y="13" width={1} height={2} fill="#0F172A"/><rect x="25" y="13" width={1} height={2} fill="#0F172A"/>
      <rect x="7" y="15" width={1} height={2} fill="#0F172A"/><rect x="24" y="15" width={1} height={2} fill="#0F172A"/>
      <rect x="8" y="17" width={1} height={1} fill="#0F172A"/><rect x="23" y="17" width={1} height={1} fill="#0F172A"/>
      <rect x="9" y="18" width={14} height={1} fill="#0F172A"/>
      {/* 酒液 */}
      <rect x="7" y="8" width={18} height={2} fill="#0052FF"/>
      <rect x="6" y="10" width={20} height={3} fill="#0052FF"/>
      <rect x="6" y="13" width={20} height={2} fill="#0052FF"/>
      <rect x="7" y="15" width={18} height={2} fill="#0052FF"/>
      <rect x="8" y="17" width={16} height={1} fill="#0052FF" opacity="0.7"/>
      <rect x="9" y="18" width={14} height={1} fill="#4D7CFF" opacity="0.4"/>
      {/* 杯柄 */}
      <rect x="15" y="19" width={2} height={5} fill="#0F172A"/>
      <rect x="11" y="24" width={10} height={1} fill="#0F172A"/>
      <rect x="9" y="25" width={14} height={1} fill="#0F172A"/>
    </svg>
  );
}

// 403 无权限提示页
function RequireAdmin({ children }) {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role !== 'admin') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Result
          status="403"
          title="403"
          subTitle={`抱歉，${user.username}，您没有访问【策略配置】模块的权限，请联系管理员开通。`}
          extra={<Button type="primary" onClick={() => window.history.back()}>返回上一页</Button>}
        />
      </div>
    );
  }
  return children;
}

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  const allMenuItems = [
    { key: '/', icon: <DashboardOutlined />, label: '市场总览' },
    { key: '/signals', icon: <ThunderboltOutlined />, label: '价值信号' },
    { key: '/short', icon: <RocketOutlined />, label: '短线机会' },
    { key: '/crypto', icon: <WalletOutlined />, label: '加密货币' },
    { key: '/crowding', icon: <RadarChartOutlined />, label: '拥挤度雷达' },
    { key: '/holdings', icon: <StarOutlined />, label: '自选持仓' },
    { key: '/backtest', icon: <HistoryOutlined />, label: '回测分析' },
    { key: '/settings', icon: <ControlOutlined />, label: '策略配置', adminOnly: true },
  ];

  const menuItems = allMenuItems.filter(item => !item.adminOnly || user?.role === 'admin');

  const getPageTitle = () => {
    const map = { '/': '市场总览', '/signals': '价值信号', '/short': '短线机会', '/crypto': '加密货币',
      '/crowding': '拥挤度雷达', '/holdings': '自选持仓', '/backtest': '回测分析', '/settings': '策略配置' };
    for (const [path, title] of Object.entries(map)) {
      if (location.pathname.startsWith(path) && path !== '/') return title;
      if (location.pathname === path) return title;
    }
    if (location.pathname.startsWith('/stock')) return '个股详情';
    return '';
  };

  const currentTime = new Date();

  return (
    <Layout style={{ minHeight: '100vh', background: '#FAFAFA' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={220}
        collapsedWidth={60}
        trigger={null}
        style={{
          background: '#fff',
          position: 'fixed',
          height: '100vh',
          zIndex: 100,
          overflow: 'hidden',
          borderRight: '1px solid #E8E8ED',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
          {/* Logo */}
          <div className="nav-logo" style={collapsed ? { justifyContent: 'center', padding: '0 !important' } : undefined}>
            <PixelLogo size={collapsed ? 30 : 34} />
            {!collapsed && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1 }}>
                <div className="logo-text">仓位满上</div>
                <div className="logo-sub">TOP UP</div>
              </div>
            )}
          </div>

          {/* Menu */}
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingTop: 6 }}>
            <Menu
              theme="light"
              mode="inline"
              selectedKeys={[location.pathname.startsWith('/stock') ? '/signals' : location.pathname]}
              items={menuItems}
              onClick={({ key }) => navigate(key)}
              style={{ border: 'none' }}
            />
          </div>

          {/* 底栏：版本号 + 折叠按钮 */}
          <div
            onClick={() => setCollapsed(!collapsed)}
            style={{
              height: 40,
              borderTop: '1px solid #E8E8ED',
              display: 'flex',
              alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'space-between',
              padding: collapsed ? 0 : '0 16px',
              cursor: 'pointer',
              color: '#8E8E93',
              fontSize: 11,
              flexShrink: 0,
              transition: 'background 150ms',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#F5F5F7'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            {!collapsed && (
              <span className="num-mono" style={{ color: '#AEAEB2', letterSpacing: '0.05em' }}>v1.4.0</span>
            )}
            {collapsed
              ? <MenuUnfoldOutlined style={{ fontSize: 14 }} />
              : <MenuFoldOutlined style={{ fontSize: 14 }} />
            }
          </div>
        </div>
      </Sider>

      <Layout style={{ marginLeft: collapsed ? 60 : 220, transition: 'margin-left 0.2s ease' }}>
        <Header style={{
          padding: '0 24px', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, zIndex: 99, height: 56,
        }}>
          <Space align="center" size={12}>
            <Text strong style={{ fontSize: 15, color: '#1A1A1E', fontWeight: 600 }}>{getPageTitle()}</Text>
            <span className="live-pill">
              <span className="live-dot" style={{ width: 5, height: 5 }}/>
              LIVE
            </span>
          </Space>
          <Space size={14}>
            <Text type="secondary" style={{ fontSize: 12, color: '#8E8E93' }}>
              {currentTime.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' })}
            </Text>
            <UserBadge />
          </Space>
        </Header>
        <Content style={{ padding: '20px 24px', minHeight: 'calc(100vh - 56px)' }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/signals" element={<Signals />} />
            <Route path="/short" element={<ShortTerm />} />
            <Route path="/crypto" element={<Crypto />} />
            <Route path="/crowding" element={<Crowding />} />
            <Route path="/stock/:code" element={<StockDetail />} />
            <Route path="/holdings" element={<Holdings />} />
            <Route path="/backtest" element={<Backtest />} />
            <Route path="/settings" element={<RequireAdmin><Settings /></RequireAdmin>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
