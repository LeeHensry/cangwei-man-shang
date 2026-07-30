# Changelog

## v1.1.0 (2026-07-30)

### 🆕 新增
- **Access Key 账号体系**：替换原用户名+密码注册登录，改为内置 105 个账号（5 admin + 100 access），输入 8 位 Access Key 即可登录
  - admin 账号：策略配置等全部模块可用
  - access 账号：菜单自动隐藏策略配置，直接访问URL拦截并显示403
  - 用户名支持点击右上角头像旁✏️图标自定义修改，修改后本地保存
  - 登录界面简化为单输入框，输入Key自动转小写
- 新增 `/api/version` 接口，前端/运维可检查版本

### 🎨 UI 优化
- **菜单栏 icon 全部去重**：原 LineChart/BarChart/Fund/DollarCircle/Alert/Setting 多个模块图标风格混乱、语义不清，统一为语义化独立图标
  - 市场总览 → DashboardOutlined（仪表盘）
  - 价值信号 → ThunderboltOutlined（闪电）
  - 短线机会 → RocketOutlined 🚀（火箭）
  - 加密货币 → WalletOutlined 💰（钱包）
  - 拥挤度雷达 → RadarChartOutlined 📡（雷达图）
  - 自选持仓 → StarOutlined ⭐（星星）
  - 回测分析 → HistoryOutlined（历史回溯）
  - 策略配置 → ControlOutlined ⚙️（控制台，仅admin可见）
- Header 用户徽章增加角色标签（管理员/用户），管理员头像橙色、普通用户蓝色
- 登录窗口去除注册 Tab，只保留 Access Key 输入
- 403 无权限友好提示页

### 🔑 内置管理员账号（5个）
| Access Key | 用户名 |
|---|---|
| pw4esfks | 李忠兴 |
| uia1y2qi | 超级管理员 |
| bbtsekvi | 系统管理员 |
| bjaqik9p | 运维管理员 |
| p3tnbmwg | 策略管理员 |

完整账号清单见 `账号清单.txt` / `accounts.csv`（100个access用户）。

### 📦 部署
- 线上地址：https://cangwei-man-shang.onrender.com
- 平台：Render Free Plan，GitHub main 分支 push 触发自动部署
- 构建命令：`npm install && npm run build`
- 启动命令：`node server.js`

---

## v1.0.0 (2026-07-28 ~ 2026-07-29)

### 首发及迭代版本
- 市场总览：大盘温度计（估值/资金/趋势/情绪四维加权）、指数行情、板块涨跌、市值结构、信号统计
- 价值信号池：ROE+PE+技术面综合评分，信号分 buy/watch/hold/sell 四档
- 个股详情：估值/技术/资金/财务多维度分析 + AI诊断报告（占位）
- 自选持仓：手动添加，成本价/持仓比例，实时盈亏计算（localStorage）
- 回测分析：价值策略/趋势策略/均值回归三策略
- 📡 拥挤度雷达：量化资金拥挤度模型，板块热力图+减仓预警+动量搭车+冷清逆向
- ⚡ 短线机会（v1.0.1加）：换手率+量价+波动率综合打分，短线信号
- 🪙 加密货币（v1.0.1加）：接入Binance公开API，BTC/ETH/SOL等主流币种行情+MA/RSI分析
- 策略配置：评分权重等参数可视化调整
- 数据源：腾讯财经（GBK K线/实时行情）、新浪财经（板块）、东方财富（财务指标）、Binance（加密货币）
- 账号体系（v1.0版本）：本地用户名+密码注册登录，localStorage存储
- 部署到 Render，完成 Node+React 全栈 CI/CD 自动部署链路
