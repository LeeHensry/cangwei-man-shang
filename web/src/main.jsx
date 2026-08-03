import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import 'antd/dist/reset.css';

// 全局样式覆盖
const style = document.createElement('style');
style.textContent = `
  body { background: #FAFAFA !important; }

  /* AntD 组件全局样式 */
  .ant-layout-sider {
    box-shadow: none !important;
    border-right: 1px solid #E8E8ED !important;
  }
  .ant-layout-header {
    background: rgba(255,255,255,0.85) !important;
    backdrop-filter: saturate(180%) blur(20px);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    box-shadow: 0 1px 0 #E8E8ED !important;
    padding: 0 24px !important;
    height: 56px !important;
    line-height: 56px !important;
  }
  .ant-card {
    border-radius: 14px !important;
    border: 1px solid #E8E8ED !important;
    box-shadow: 0 1px 3px rgba(0,0,0,0.03) !important;
    transition: box-shadow 200ms ease;
  }
  .ant-card-head {
    border-bottom: 1px solid #F0F0F2 !important;
    min-height: 48px !important;
  }
  .ant-card-head-title {
    font-weight: 600 !important;
    font-size: 14px !important;
    color: #1A1A1E !important;
    padding: 12px 0 !important;
  }
  .ant-card-body { padding: 18px !important; }
  .ant-statistic-title {
    font-size: 11px !important;
    color: #8E8E93 !important;
    margin-bottom: 4px !important;
    font-weight: 500 !important;
  }
  .ant-statistic-content {
    font-size: 22px !important;
    font-weight: 600 !important;
    font-family: 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace !important;
    font-variant-numeric: tabular-nums;
  }
  .ant-table-thead > tr > th {
    background: #FAFAFA !important;
    font-weight: 600 !important;
    color: #64748B !important;
    font-size: 11px !important;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid #E8E8ED !important;
    padding: 10px 12px !important;
  }
  .ant-table-tbody > tr > td {
    border-bottom: 1px solid #F5F5F7 !important;
    font-size: 13px !important;
    padding: 10px 12px !important;
  }
  .ant-table-tbody > tr:hover > td { background: #F8FAFC !important; }
  .ant-tag {
    border-radius: 20px !important;
    font-size: 11px !important;
    line-height: 20px !important;
    padding: 0 8px !important;
    border: none !important;
  }
  .ant-progress-text { font-size: 11px !important; font-weight: 600 !important; }
  .ant-progress-bg { border-radius: 100px !important; }
  .ant-progress-inner { border-radius: 100px !important; background: #F1F5F9 !important; }
  .ant-divider { border-color: #F0F0F2 !important; margin: 16px 0 !important; }
  .ant-descriptions-bordered .ant-descriptions-item-label {
    background: #FAFAFA !important; font-weight: 500 !important; color: #64748B !important;
    width: 30% !important; font-size: 12px !important;
  }
  .ant-descriptions-bordered .ant-descriptions-item-content { font-size: 13px !important; }

  /* 浅色菜单 */
  .ant-menu-light { background: transparent !important; border-right: none !important; }
  .ant-menu-light .ant-menu-item {
    margin: 2px 8px !important;
    border-radius: 10px !important;
    height: 38px !important;
    line-height: 38px !important;
    color: #64748B !important;
    font-weight: 500 !important;
    font-size: 13px !important;
  }
  .ant-menu-light .ant-menu-item:hover {
    background: #F1F5F9 !important;
    color: #1A1A1E !important;
  }
  .ant-menu-light .ant-menu-item-selected {
    background: linear-gradient(135deg, #0052FF, #4D7CFF) !important;
    color: #fff !important;
    font-weight: 600 !important;
    box-shadow: 0 2px 8px rgba(0,82,255,0.2);
  }
  .ant-menu-light .ant-menu-item-selected .ant-menu-item-icon { color: #fff !important; }
  .ant-layout-sider-trigger {
    background: #fff !important;
    border-right: none !important;
    border-top: 1px solid #E8E8ED !important;
    color: #8E8E93 !important;
  }
  .ant-layout-sider-trigger:hover { color: #0052FF !important; }

  /* 按钮 */
  .ant-btn {
    border-radius: 10px !important;
    font-weight: 500 !important;
    font-size: 12px !important;
    height: 32px !important;
    padding: 0 16px !important;
  }
  .ant-btn-primary {
    background: linear-gradient(135deg, #0052FF, #4D7CFF) !important;
    border: none !important;
    box-shadow: 0 2px 8px rgba(0,82,255,0.2) !important;
  }
  .ant-btn-primary:hover {
    transform: translateY(-1px) !important;
    box-shadow: 0 4px 14px rgba(0,82,255,0.3) !important;
  }
  .ant-btn-default {
    background: #fff !important;
    border-color: #E8E8ED !important;
    color: #1A1A1E !important;
  }
  .ant-btn-default:hover { border-color: #0052FF !important; color: #0052FF !important; }

  /* 输入框 */
  .ant-input, .ant-select-selector {
    border-radius: 10px !important;
    border-color: #E8E8ED !important;
  }
  .ant-input:focus, .ant-input-focused,
  .ant-select-focused .ant-select-selector {
    border-color: #0052FF !important;
    box-shadow: 0 0 0 2px rgba(0,82,255,0.1) !important;
  }

  /* Tabs */
  .ant-tabs-tab { font-size: 13px !important; font-weight: 500 !important; }
  .ant-tabs-tab-active { font-weight: 600 !important; }
  .ant-tabs-ink-bar { background: #0052FF !important; height: 2px !important; border-radius: 2px; }

  /* LIVE Badge */
  .live-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: #22C55E; display: inline-block;
    animation: livePulse 2s ease-in-out infinite;
  }
  @keyframes livePulse {
    0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34,197,94,0.4); }
    50% { opacity: 0.7; box-shadow: 0 0 0 4px rgba(34,197,94,0); }
  }
  .live-pill {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 2px 8px; border-radius: 20px;
    background: rgba(34,197,94,0.08);
    font-size: 10px; color: #16A34A; font-weight: 600;
    font-family: 'SF Mono', Menlo, monospace;
    letter-spacing: 0.06em;
  }

  /* Skeleton */
  .ant-skeleton-content .ant-skeleton-title,
  .ant-skeleton-content .ant-skeleton-paragraph > li {
    background: linear-gradient(90deg, #F0F0F2 25%, #F8F8FA 50%, #F0F0F2 75%);
    background-size: 200% 100%;
    animation: skeletonShimmer 1.5s ease-in-out infinite;
    border-radius: 4px;
  }
  @keyframes skeletonShimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* Gauge */
  .gauge-container { position: relative; text-align: center; }

  /* Link hover */
  a { color: #0052FF; text-decoration: none; transition: color 150ms; }
  a:hover { color: #4D7CFF; }
`;
document.head.appendChild(style);

// 版本检测
const APP_VERSION = 'v1.4.0';
const lastVersion = localStorage.getItem('cwms_app_version');
if (lastVersion && lastVersion !== APP_VERSION) {
  localStorage.setItem('cwms_app_version', APP_VERSION);
  if (lastVersion < 'v1.1.0') {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('cwms_users') || k === 'cwms_current_user') toRemove.push(k);
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  }
  window.location.reload();
} else {
  localStorage.setItem('cwms_app_version', APP_VERSION);
}
setInterval(async () => {
  try {
    const r = await fetch('/api/version', { cache: 'no-store' });
    const d = await r.json();
    if (d.version && d.version !== APP_VERSION && d.version !== localStorage.getItem('cwms_app_version')) {
      localStorage.setItem('cwms_app_version', d.version);
      window.location.reload();
    }
  } catch(e) {}
}, 5 * 60 * 1000);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <ConfigProvider locale={zhCN} theme={{
    token: {
      colorPrimary: '#0052FF',
      colorSuccess: '#22C55E',
      colorWarning: '#F59E0B',
      colorError: '#EF4444',
      colorInfo: '#0052FF',
      borderRadius: 10,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'PingFang SC', 'Helvetica Neue', sans-serif",
      fontSize: 13,
    },
    components: {
      Menu: { itemBg: 'transparent', itemSelectedBg: 'linear-gradient(135deg, #0052FF, #4D7CFF)', itemColor: '#64748B', itemSelectedColor: '#fff', itemHeight: 38, iconSize: 16 },
      Card: { borderRadiusLG: 14 },
      Table: { headerBg: '#FAFAFA', headerColor: '#64748B', rowHoverBg: '#F8FAFC' },
      Button: { borderRadius: 10, controlHeight: 32 },
      Tag: { borderRadiusSM: 20 },
    },
  }}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </ConfigProvider>
);
