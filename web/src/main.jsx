import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import 'antd/dist/reset.css';

// 全局样式
const style = document.createElement('style');
style.textContent = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif; background: #f5f7fa; }
  .nav-logo { height: 56px; display: flex; align-items: center; gap: 10px; padding: 0 20px; border-bottom: 1px solid rgba(255,255,255,0.08); }
  .logo-icon { font-size: 24px; }
  .logo-text { font-size: 15px; font-weight: 700; color: #fff; letter-spacing: 0.5px; }
  .logo-sub { font-size: 10px; color: #98a2b3; font-family: 'Inter', monospace; letter-spacing: 2px; }
  .signal-badge { display: inline-flex; align-items: center; gap: 2px; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap; }
  .signal-buy { background: #fef3f2; color: #f04438; }
  .signal-momentum_buy { background: #f9f5ff; color: #9e77ed; }
  .signal-watch { background: #fffaeb; color: #b54708; }
  .signal-hold { background: #f0f9ff; color: #175cd3; }
  .signal-sell { background: #ecfdf3; color: #027a48; }
  .score-badge { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 22px; border-radius: 6px; font-size: 12px; font-weight: 700; font-family: 'Inter', monospace; }
  .score-high { background: #fef3f2; color: #f04438; }
  .score-mid { background: #fffaeb; color: #b54708; }
  .score-low { background: #f2f4f7; color: #667085; }
  .mini-chart-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); transition: box-shadow 0.2s; }
  .ant-card { border-radius: 10px !important; }
  .ant-card-head { border-bottom: 1px solid #f0f0f0 !important; min-height: 44px !important; }
  .ant-card-head-title { padding: 10px 0 !important; font-size: 13px; }
  table { font-size: 12px; }
  .ant-table-thead > tr > th { background: #fafbfc !important; font-size: 11px !important; color: #475467 !important; font-weight: 600 !important; }
  .ant-progress-bg { border-radius: 100px !important; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-thumb { background: #d0d5dd; border-radius: 3px; }
  ::-webkit-scrollbar-track { background: transparent; }
`;
document.head.appendChild(style);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <ConfigProvider locale={zhCN} theme={{
    token: {
      colorPrimary: '#1677ff',
      colorSuccess: '#52c41a',
      colorWarning: '#faad14',
      colorError: '#f5222d',
      borderRadius: 6,
    },
  }}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </ConfigProvider>
);
