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

// 403 无权限提示页（access 用户访问策略配置时显示）
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

  // 菜单配置：8个功能模块，icon 互不重复
  // 市场总览    → DashboardOutlined  仪表盘
  // 价值信号    → ThunderboltOutlined 闪电
  // 短线机会    → RocketOutlined     火箭 🚀
  // 加密货币    → WalletOutlined     钱包 💰
  // 拥挤度雷达  → RadarChartOutlined 雷达图 📡
  // 自选持仓    → StarOutlined       星星 ⭐
  // 回测分析    → HistoryOutlined    历史/回溯
  // 策略配置    → ControlOutlined    控制台（仅管理员可见）
  const allMenuItems = [
    { key: '/', icon: <DashboardOutlined />, label: '市场总览' },
    { key: '/signals', icon: <ThunderboltOutlined />, label: '价值信号' },
    { key: '/short', icon: <RocketOutlined />, label: '⚡ 短线机会' },
    { key: '/crypto', icon: <WalletOutlined />, label: '🪙 加密货币' },
    { key: '/crowding', icon: <RadarChartOutlined />, label: '📡 拥挤度雷达' },
    { key: '/holdings', icon: <StarOutlined />, label: '自选持仓' },
    { key: '/backtest', icon: <HistoryOutlined />, label: '回测分析' },
    { key: '/settings', icon: <ControlOutlined />, label: '策略配置', adminOnly: true },
  ];

  // 普通用户隐藏策略配置菜单
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
// build Thu Jul 30 2026 - access key auth v1.1.0
