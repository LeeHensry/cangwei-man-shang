# Changelog

## v1.6.3 (2026-08-21)

### 🐛 Bug 修复
- **修复换手率turnover为null的根本原因**：腾讯K线API(fqkline)只返回6个字段(日期/O/C/H/L/成交量)，不包含换手率。将K线数据源从腾讯切换到东方财富(push2his.eastmoney.com)，东方财富返回11个字段含f61换手率(%)
- 涉及4处K线调用：/api/sync、/api/sync/step(kline)、runStepKline、cron同步
- 日期格式从YYYY-MM-DD改为YYYYMMDD（东方财富API要求）

### 🆕 新增
- **财务数据分步拉取**：新增finance step到/api/sync/step，分批拉取东方财富datacenter财务数据，避免scoreAllStocks内同步拉取200只财务数据超时
- full-pipeline在评分前自动检查并拉取财务数据
- GitHub Actions workflow新增finance选项

---

## v1.6.2 (2026-08-20)

### 🐛 Bug 修复
- **修复首次部署页面空白**：新增 seed.db 种子数据库（54支核心股票+评分+K线+拥挤度数据），Render 启动时自动从 seed 恢复，页面不会空白
- **修复同步接口 schema 不匹配**：stock_info 去掉不存在的 pe 列（pe 在 valuation 表）；stock_score 表补齐 name/industry/current_price/quality_detail 等缺失列
- **修复评分时财务数据不足导致返回null**：无财务数据时返回中性分50，确保评分能产生结果
- **修复菜单图标/emoji 不统一**：去掉 label 里的 emoji 前缀，全部使用 AntD 图标（8个模块icon互不重复）

### 🔧 优化
- 前端加版本检测：启动时检查 /api/version，发现新版本自动页面刷新，解决浏览器缓存旧版问题
- index.html 加 no-cache 响应头，assets URL 附加 ?v= 启动时间戳强制更新
- 服务启动后台更新行情时，API 超时15秒即放弃，避免海外节点阻塞

---

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
