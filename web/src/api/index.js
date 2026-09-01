import axios from 'axios';

const api = axios.create({ baseURL: '/api', timeout: 15000 });

export const getOverview = () => api.get('/market/overview').then(r => r.data);
export const getStocks = (params) => api.get('/stocks', { params }).then(r => r.data);
export const getStockDetail = (code) => api.get(`/stocks/${code}`).then(r => r.data);
export const getIndustries = () => api.get('/industries').then(r => r.data);
export const triggerSync = () => api.post('/sync').then(r => r.data);

// 持仓管理
export const getPortfolio = () => api.get('/portfolio').then(r => r.data);
export const addHolding = (data) => api.post('/portfolio', data).then(r => r.data);
export const deleteHolding = (code) => api.delete(`/portfolio/${code}`).then(r => r.data);

// 设置
export const getSettings = () => api.get('/settings').then(r => r.data);
export const saveSettings = (data) => api.post('/settings', data).then(r => r.data);

// 资讯
export const getNews = (params) => api.get('/news', { params }).then(r => r.data);

// 数据源
export const getDataSource = () => api.get('/datasource').then(r => r.data);
export const setDataSource = (source) => api.post('/datasource', { source }).then(r => r.data);

export default api;
