# 项目长期记忆

## 仓位满上 TopUp
- **项目路径**：`/Users/mlamp/WorkBuddy/2026-07-30-16-01-51/`（不是 ~/cangwei-man-shang）
- **仓库**：https://github.com/LeeHensry/cangwei-man-shang (main分支)
- **线上地址**：https://cangwei-man-shang.onrender.com（免费版，冷启动1-2分钟）
- **当前版本**：v1.5.0
- **技术栈**：React+AntD+Vite前端 / Express+pg(Supabase/PostgreSQL)后端
- **期权模块**：v1.5.0新增src/options/，基于Deribit的BTC/ETH期权策略系统（BS定价/Greeks/Gamma Explosion等AK策略/盈亏计算器/回测），前端Options.jsx页面
- **数据库**：Supabase PostgreSQL（东京区 ap-northeast-1），连接用pooler地址(aws-0-ap-northeast-1.pooler.supabase.com:5432, IPv4)，不能用直接连接(db.xxx.supabase.co是IPv6, Render不支持)
- **代码约定**：数据库股票代码统一为纯6位数字；数据源层(toSinaCode/toTencentCode)自动加前缀；期权模块金额统一USD计价
- **数据库API**：全部异步（dbGet/dbAll/dbRun/dbBatch/dbExec/dbIsReady），不再使用better-sqlite3同步API
- **部署约定**：版本号更新和部署必须先经用户确认后再执行；web/dist在.gitignore中，Render通过build脚本自动构建
- **Render环境变量**：SUPABASE_DB_URL（pooler连接字符串），已删除旧的TURSO_AUTH_TOKEN和TURSO_DATABASE_URL
- **Render时区坑**：服务器时间为UTC，node-cron表达式必须写UTC时间（北京时间-8小时）。Render免费版进程在无外部请求时会被suspend，setInterval/setTimeout在休眠期间不执行，必须靠外部HTTP请求（如GitHub Actions）保活才能让cron按时触发
- **保活方案**：GitHub Actions每10分钟curl `/api/version`（.github/workflows/keep-alive.yml）
- **当前版本**：v1.6.1
- **分步同步架构**：v1.6.1新增`/api/sync/step` API，将全量同步拆分为独立步骤(kline/indicators/score/crowding/pool/full-pipeline/status)，每步50秒内完成一批，支持断点续传。解决Render免费版suspend导致全量同步中断的问题。GitHub Actions收盘后分4次触发full-pipeline
- **动态Universe**：v1.6.0新增stock_universe表，从全市场按市值降序动态筛选Top 1000只（排除ST/退市/北交所/价格<2元），月初自动更新；股票池(200只)从Universe中按流动性45%+市值30%+动量25%综合打分选出；静态JSON保留作降级兜底
- **数据库迁移**：v1.6.0从Turso(SQLite)迁移到Supabase(PostgreSQL)，db.js内置SQL方言转换器（?→$N, INSERT OR REPLACE→ON CONFLICT），环境变量SUPABASE_DB_URL；本地开发仍用better-sqlite3
- **性能优化**：v1.6.1优化指标计算查询——只SELECT必要字段(trade_date,close,high,low,volume)而非SELECT *，只写最近250天指标，减少Supabase远程DB传输量
