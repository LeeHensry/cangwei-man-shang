import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <ConfigProvider
    locale={zhCN}
    theme={{
      token: {
        colorPrimary: '#0052FF',
        colorBgBase: '#FAFAFA',
        colorTextBase: '#0F172A',
        colorBgContainer: '#FFFFFF',
        colorBgElevated: '#FFFFFF',
        colorBorder: '#E2E8F0',
        colorBorderSecondary: '#F1F5F9',
        colorTextSecondary: '#334155',
        colorTextTertiary: '#64748B',
        colorTextQuaternary: '#94A3B8',
        colorFill: '#F8FAFC',
        colorFillSecondary: '#F1F5F9',
        colorFillTertiary: '#E2E8F0',
        borderRadius: 8,
        borderRadiusLG: 12,
        fontFamily: "'Inter', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif",
        fontSize: 14,
        fontWeightStrong: 600,
        boxShadowSecondary: '0 10px 15px -3px rgba(0,0,0,0.06), 0 4px 6px -4px rgba(0,0,0,0.04)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      },
      components: {
        Layout: {
          bodyBg: '#FAFAFA',
          headerBg: 'rgba(255,255,255,0.85)',
          siderBg: '#FFFFFF',
          triggerBg: '#FFFFFF',
        },
        Menu: {
          itemBg: 'transparent',
          itemSelectedBg: '#0052FF',
          itemColor: '#64748B',
          itemSelectedColor: '#FFFFFF',
          itemHoverBg: '#F1F5F9',
          itemHoverColor: '#0F172A',
          itemBorderRadius: 12,
          itemHeight: 40,
          iconSize: 16,
          itemSelectedFontWeight: 500,
          horizontalItemSelectedColor: '#0052FF',
        },
        Card: {
          borderRadiusLG: 16,
          colorBgContainer: '#FFFFFF',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        },
        Table: {
          colorBgContainer: 'transparent',
          headerBg: '#F1F5F9',
          headerColor: '#64748B',
          headerSortActiveBg: '#F1F5F9',
          headerSortHoverBg: '#E2E8F0',
          rowHoverBg: 'rgba(0,82,255,0.04)',
          borderColor: '#E2E8F0',
          cellPaddingBlock: 11,
          cellFontSize: 13,
          colorText: '#0F172A',
          colorTextHeading: '#334155',
          footerBg: 'transparent',
        },
        Button: {
          borderRadius: 12,
          controlHeight: 36,
          fontWeight: 500,
          primaryShadow: '0 4px 14px rgba(0,82,255,0.2)',
          defaultShadow: 'none',
          colorPrimary: '#0052FF',
          colorPrimaryHover: '#4D7CFF',
          colorPrimaryActive: '#0044D6',
          colorText: '#0F172A',
          colorTextDisabled: '#94A3B8',
          borderColor: '#E2E8F0',
          defaultBg: '#FFFFFF',
        },
        Tag: {
          borderRadiusSM: 8,
          defaultBg: '#F1F5F9',
          defaultColor: '#64748B',
          colorBorder: 'transparent',
        },
        Progress: {
          defaultColor: '#0052FF',
          remainingColor: '#F1F5F9',
          lineBorderRadius: 4,
        },
        Spin: { colorPrimary: '#0052FF' },
        Tooltip: {
          colorBgSpotlight: '#0F172A',
          borderRadius: 8,
        },
        Divider: { colorSplit: '#E2E8F0' },
        Input: {
          colorBgContainer: '#FFFFFF',
          colorText: '#0F172A',
          colorTextPlaceholder: '#94A3B8',
          colorBorder: '#E2E8F0',
          activeBorderColor: '#0052FF',
          hoverBorderColor: '#CBD5E1',
          activeShadow: '0 0 0 3px rgba(0,82,255,0.1)',
        },
        Modal: {
          contentBg: '#FFFFFF',
          headerBg: '#FFFFFF',
          colorIcon: '#64748B',
          colorIconHover: '#0F172A',
        },
        Drawer: {
          colorBgElevated: '#FFFFFF',
        },
        Select: {
          colorBgContainer: '#FFFFFF',
          optionSelectedBg: 'rgba(0,82,255,0.08)',
          optionActiveBg: '#F1F5F9',
          colorText: '#0F172A',
          colorBgElevated: '#FFFFFF',
        },
        Pagination: {
          colorText: '#334155',
          colorPrimary: '#0052FF',
          colorBgTextActive: '#0052FF',
        },
        Tabs: {
          itemSelectedColor: '#0052FF',
          itemHoverColor: '#0052FF',
          inkBarColor: '#0052FF',
          titleFontSize: 14,
        },
        Switch: {
          colorPrimary: '#0052FF',
        },
        Slider: {
          colorPrimary: '#0052FF',
        },
        Radio: {
          colorPrimary: '#0052FF',
        },
        Checkbox: {
          colorPrimary: '#0052FF',
        },
        DatePicker: {
          colorBgContainer: '#FFFFFF',
          colorText: '#0F172A',
          colorTextPlaceholder: '#94A3B8',
          colorBorder: '#E2E8F0',
          activeBorderColor: '#0052FF',
          cellActiveWithRangeBg: 'rgba(0,82,255,0.08)',
          cellHoverBg: 'rgba(0,82,255,0.06)',
        },
        Segmented: {
          trackBg: '#F1F5F9',
          itemSelectedBg: '#FFFFFF',
          itemSelectedColor: '#0052FF',
          itemColor: '#64748B',
        },
        Steps: {
          colorPrimary: '#0052FF',
        },
        Alert: {
          colorInfoBg: 'rgba(0,82,255,0.06)',
          colorInfoBorder: 'rgba(0,82,255,0.2)',
        },
      },
    }}
  >
    <App />
  </ConfigProvider>
);
