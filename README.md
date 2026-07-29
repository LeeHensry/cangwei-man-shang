# 仓位满上 Top Up 🥃

基于多因子模型 + LLM辅助解读的A股交易决策系统，输出可执行的买卖建议（关注/买入/卖出/减仓 + 价格 + 仓位 + 理由）。

## 功能

- 📊 **市场概览**：指数行情、市场温度计、板块资金流、信号统计
- 🎯 **智能选股**：多因子量化评分（质量/估值/技术），输出买卖信号
- 📈 **机会池**：买入机会、观望标的、冷门机会
- 💼 **持仓管理**：模拟持仓、止损/止盈、盈亏跟踪
- 🔥 **拥挤度**：板块拥挤度、市场集中度、资金拥挤信号
- ⏰ **日报生成**：每日复盘自动生成

## 本地开发

```bash
# 安装依赖
npm install

# 启动服务（前端+后端一体化）
npm start
# 访问 http://localhost:3001
```

## 部署

### Render（免费）

点击下方按钮一键部署：

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

或手动：
1. Fork 本仓库
2. 去 [render.com](https://render.com) 用 GitHub 登录
3. New → Web Service → 选择仓库
4. Build Command: `npm install`
5. Start Command: `node server.js`
6. 选 Free 计划，点 Create

部署后访问 `https://xxx.onrender.com`，首次启动会自动初始化股票数据。

> 注意：免费实例15分钟无访问会休眠，首次访问需等待冷启动（约30-60秒）。
> SQLite 数据库存在临时磁盘上，实例休眠重启后数据会丢失，系统会自动重新初始化热门股票池。

## 技术栈

- **后端**：Node.js + Express + better-sqlite3
- **前端**：React + Vite
- **数据源**：腾讯财经、东方财富、新浪财经（公开行情API）
- **策略**：多因子模型（质量+估值+技术）+ 资金流 + 拥挤度
