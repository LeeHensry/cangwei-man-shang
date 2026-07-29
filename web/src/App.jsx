import React, { useState } from 'react';
import { Layout, Menu, Typography, Badge, Space } from 'antd';
import {
  DashboardOutlined, ThunderboltOutlined, LineChartOutlined,
  FundOutlined, BarChartOutlined, SettingOutlined, AlertOutlined,
  DollarCircleOutlined,
} from '@ant-design/icons';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, UserBadge } from './auth';
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

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: '市场总览' },
    { key: '/signals', icon: <ThunderboltOutlined />, label: '价值信号' },
    { key: '/short', icon: <LineChartOutlined />, label: '⚡ 短线机会' },
    { key: '/crypto', icon: <DollarCircleOutlined />, label: '🪙 加密货币' },
    { key: '/crowding', icon: <AlertOutlined />, label: '📡 拥挤度雷达' },
    { key: '/holdings', icon: <FundOutlined />, label: '自选持仓' },
    { key: '/backtest', icon: <BarChartOutlined />, label: '回测分析' },
    { key: '/settings', icon: <SettingOutlined />, label: '策略配置' },
  ];

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

  return (
    <Layout style={{ minHeight: '100vh', background: '#f5f7fa' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={220}
        collapsedWidth={64}
        style={{ background: '#0c111d', position: 'fixed', height: '100vh', zIndex: 100, overflow: 'auto' }}
      >
        <div className="nav-logo">
          <div className="logo-icon">🥃</div>
          {!collapsed && (
            <div>
              <div className="logo-text">仓位满上</div>
              <div className="logo-sub">TOP UP</div>
            </div>
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname.startsWith('/stock') ? '/signals' : location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ marginTop: 12, background: 'transparent', border: 'none' }}
        />
      </Sider>
      <Layout style={{ marginLeft: collapsed ? 64 : 220, transition: 'margin-left 0.2s' }}>
        <Header style={{
          background: '#fff', padding: '0 28px', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, zIndex: 99, height: 56,
        }}>
          <Space align="center" size={12}>
            <Text strong style={{ fontSize: 16, color: '#101828', fontWeight: 600 }}>{getPageTitle()}</Text>
          </Space>
          <Space size={16}>
            <Badge dot color="#52c41a">
              <Text type="secondary" style={{ fontSize: 12 }}>实时数据</Text>
            </Badge>
            <Text type="secondary" style={{ fontSize: 13, fontFamily: 'Inter, monospace' }}>
              {new Date().toLocaleDateString('zh-CN', { weekday: 'short', month: 'numeric', day: 'numeric' })}
            </Text>
            <UserBadge />
          </Space>
        </Header>
        <Content style={{ padding: 24, minHeight: 'calc(100vh - 56px)' }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/signals" element={<Signals />} />
            <Route path="/short" element={<ShortTerm />} />
            <Route path="/crypto" element={<Crypto />} />
            <Route path="/crowding" element={<Crowding />} />
            <Route path="/stock/:code" element={<StockDetail />} />
            <Route path="/holdings" element={<Holdings />} />
            <Route path="/backtest" element={<Backtest />} />
            <Route path="/settings" element={<Settings />} />
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
// build Tue Jul 28 06:23:27 PM CST 2026
