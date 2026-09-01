import React, { useState, useEffect } from 'react';
import { Layout, Menu, Typography, Badge, Space, Result, Button, Drawer } from 'antd';
import {
  DashboardOutlined,
  ThunderboltOutlined,
  WalletOutlined,
  StarOutlined,
  ControlOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MenuOutlined,
  FundProjectionScreenOutlined,
} from '@ant-design/icons';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { AuthProvider, UserBadge, useAuth } from './auth';
import { useIsMobile } from './utils/useIsMobile';
import Dashboard from './pages/Dashboard';
import Signals from './pages/Signals';
import StockDetail from './pages/StockDetail';
import Holdings from './pages/Holdings';
import Crypto from './pages/Crypto';
import Options from './pages/Options';
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

// 侧边栏菜单内容（桌面Sider和移动端Drawer共用）
function SidebarContent({ collapsed, onCollapse, onNavigate, currentPath, menuItems, isMobile }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: isMobile ? '100%' : '100vh' }}>
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
          selectedKeys={[currentPath.startsWith('/stock') ? '/signals' : currentPath]}
          items={menuItems}
          onClick={({ key }) => { onNavigate(key); if (isMobile) onCollapse(false); }}
          style={{ border: 'none' }}
        />
      </div>

      {/* 底栏：版本号 + 折叠按钮（仅桌面端显示） */}
      {!isMobile && (
        <div
          onClick={() => onCollapse(!collapsed)}
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
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#F5F5F7'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          {!collapsed && (
            <span className="num-mono" style={{ color: '#AEAEB2', letterSpacing: '0.05em' }}>v1.5.1</span>
          )}
          {collapsed
            ? <MenuUnfoldOutlined style={{ fontSize: 14 }} />
            : <MenuFoldOutlined style={{ fontSize: 14 }} />
          }
        </div>
      )}
    </div>
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
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // 切换到移动端时重置折叠状态
  useEffect(() => {
    if (isMobile) setCollapsed(false);
  }, [isMobile]);

  const allMenuItems = [
    { key: '/', icon: <DashboardOutlined />, label: '市场总览' },
    { key: '/signals', icon: <ThunderboltOutlined />, label: '价值信号' },
    { key: '/crypto', icon: <WalletOutlined />, label: '加密货币' },
    { key: '/options', icon: <FundProjectionScreenOutlined />, label: '期权策略' },
    { key: '/holdings', icon: <StarOutlined />, label: '自选持仓' },
    { key: '/settings', icon: <ControlOutlined />, label: '策略配置', adminOnly: true },
  ];

  const menuItems = allMenuItems.filter(item => !item.adminOnly || user?.role === 'admin');

  const getPageTitle = () => {
    const map = { '/': '市场总览', '/signals': '价值信号', '/crypto': '加密货币',
      '/options': '期权策略', '/holdings': '自选持仓', '/settings': '策略配置' };
    for (const [path, title] of Object.entries(map)) {
      if (location.pathname.startsWith(path) && path !== '/') return title;
      if (location.pathname === path) return title;
    }
    if (location.pathname.startsWith('/stock')) return '个股详情';
    return '';
  };

  const currentTime = new Date();

  // 移动端路由切换时自动关闭菜单
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <Layout style={{ minHeight: '100vh', background: '#FAFAFA' }}>
      {/* 桌面端固定侧边栏 */}
      {!isMobile && (
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
          <SidebarContent
            collapsed={collapsed}
            onCollapse={setCollapsed}
            onNavigate={navigate}
            currentPath={location.pathname}
            menuItems={menuItems}
            isMobile={false}
          />
        </Sider>
      )}

      {/* 移动端抽屉菜单 */}
      {isMobile && (
        <Drawer
          title={null}
          placement="left"
          closable={false}
          onClose={() => setMobileMenuOpen(false)}
          open={mobileMenuOpen}
          width={260}
          bodyStyle={{ padding: 0, background: '#fff' }}
          styles={{ body: { padding: 0, background: '#fff' } }}
        >
          <SidebarContent
            collapsed={false}
            onCollapse={setMobileMenuOpen}
            onNavigate={navigate}
            currentPath={location.pathname}
            menuItems={menuItems}
            isMobile={true}
          />
        </Drawer>
      )}

      <Layout style={{ marginLeft: isMobile ? 0 : (collapsed ? 60 : 220), transition: 'margin-left 0.2s ease' }}>
        <Header style={{
          padding: isMobile ? '0 12px' : '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky', top: 0, zIndex: 99, height: isMobile ? 48 : 56,
          background: '#fff',
          borderBottom: '1px solid #F0F0F0',
        }}>
          <Space align="center" size={isMobile ? 8 : 12}>
            {isMobile && (
              <MenuOutlined
                onClick={() => setMobileMenuOpen(true)}
                style={{ fontSize: 18, color: '#1A1A1E', cursor: 'pointer', padding: '4px 0' }}
              />
            )}
            <Text strong style={{ fontSize: isMobile ? 14 : 15, color: '#1A1A1E', fontWeight: 600 }}>
              {getPageTitle()}
            </Text>
            {!isMobile && (
              <span className="live-pill">
                <span className="live-dot" style={{ width: 5, height: 5 }}/>
                LIVE
              </span>
            )}
          </Space>
          <Space size={isMobile ? 8 : 14}>
            {!isMobile && (
              <Text type="secondary" style={{ fontSize: 12, color: '#8E8E93' }}>
                {currentTime.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' })}
              </Text>
            )}
            <UserBadge />
          </Space>
        </Header>
        <Content style={{
          padding: isMobile ? '12px 12px 24px' : '20px 24px',
          minHeight: isMobile ? 'calc(100vh - 48px)' : 'calc(100vh - 56px)',
        }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/signals" element={<Signals />} />
            <Route path="/crypto" element={<Crypto />} />
            <Route path="/options" element={<Options />} />
            <Route path="/stock/:code" element={<StockDetail />} />
            <Route path="/holdings" element={<Holdings />} />
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
