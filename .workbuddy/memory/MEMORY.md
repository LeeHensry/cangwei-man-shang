# 项目长期记忆

## 仓位满上 TopUp
- **项目路径**：`/Users/mlamp/WorkBuddy/2026-07-30-16-01-51/`（不是 ~/cangwei-man-shang）
- **仓库**：https://github.com/LeeHensry/cangwei-man-shang (main分支)
- **线上地址**：https://cangwei-man-shang.onrender.com（免费版，冷启动1-2分钟）
- **当前版本**：v1.5.0
- **技术栈**：React+AntD+Vite前端 / Express+@libsql/client(Turso)后端
- **期权模块**：v1.5.0新增src/options/，基于Deribit的BTC/ETH期权策略系统（BS定价/Greeks/Gamma Explosion等AK策略/盈亏计算器/回测），前端Options.jsx页面
- **数据库**：Turso云数据库 libsql://topup-db-leehensry.aws-ap-northeast-1.turso.io（东京区）
- **代码约定**：数据库股票代码统一为纯6位数字；数据源层(toSinaCode/toTencentCode)自动加前缀；期权模块金额统一USD计价
- **数据库API**：全部异步（dbGet/dbAll/dbRun/dbBatch/dbExec/dbIsReady），不再使用better-sqlite3同步API
- **部署约定**：版本号更新和部署必须先经用户确认后再执行；web/dist在.gitignore中，Render通过build脚本自动构建
- **Render环境变量**：TURSO_AUTH_TOKEN和TURSO_DATABASE_URL用户已在Dashboard配置，db.js已移除硬编码token改为纯process.env读取
- **Render时区坑**：服务器时间为UTC，node-cron表达式必须写UTC时间（北京时间-8小时）。Render免费版进程在无外部请求时会被suspend，setInterval/setTimeout在休眠期间不执行，必须靠外部HTTP请求（如GitHub Actions）保活才能让cron按时触发
- **保活方案**：GitHub Actions每10分钟curl `/api/version`（.github/workflows/keep-alive.yml）
- **当前版本**：v1.5.2
