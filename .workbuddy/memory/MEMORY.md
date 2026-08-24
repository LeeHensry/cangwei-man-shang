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
- **部署约定（用户2026-08-24明确）**：任何部署前必须先向用户确认「**目标版本号 + 部署内容清单**」（改动文件/功能点），获确认后才执行 push/部署。未经确认不得直接部署；web/dist在.gitignore中，Render通过build脚本自动构建
- **Render环境变量**：SUPABASE_DB_URL（pooler连接字符串），已删除旧的TURSO_AUTH_TOKEN和TURSO_DATABASE_URL
- **Render时区坑**：服务器时间为UTC，node-cron表达式必须写UTC时间（北京时间-8小时）。Render免费版进程在无外部请求时会被suspend，setInterval/setTimeout在休眠期间不执行，必须靠外部HTTP请求（如GitHub Actions）保活才能让cron按时触发
- **保活方案**：GitHub Actions每10分钟curl `/api/version`（.github/workflows/keep-alive.yml）
- **当前版本**：v1.6.8
- **当前版本(实际)**：v1.7.6（2026-08-24）
- **Universe v2（v1.6.4+）**：六维评分选股(市值25%/流动性25%/活跃度15%/风险15%/估值10%/数据质量10%)；行业调节系数+硬上限（银行0.90≤50只/地产0.75≤25只/高成长1.02~1.08/传统周期0.88~0.95）；三层入选(核心大盘+行业代表+成长活跃)；亏损股分层(PE≤-1000硬剔除/轻度中度亏损×0.7惩罚)；跌停硬剔除改为风险扣分
- **数据源可用性**：东方财富clist/get全市场列表API在Render上完全不可用；腾讯没有全市场列表接口只有批量行情查询(qt.gtimg.cn)；**Universe刷新采用本地脚本方案**(scripts/upload-universe.js本地拉腾讯行情→打分→/api/universe/upload-batch上传)
- **腾讯行情字段位置**：parts[3]=close, [6]=volume(手), [32]=pct_chg, [37]=amount(万元需×10000转元), [38]=turnover%, [39]=PE, [43]=amplitude, [44]=circ_mv(亿), [45]=total_mv(亿)；tencent.js parseFullQuote已修复amount单位bug
- **crowding-batch性能问题**：getCrowdingSignal首次计算板块拥挤度很慢(冷启动需查大量K线)，当前初始化时查全量stock_info(841只)而非pool(200只)，在Render上易超时；密集连续调用可避免进程suspend导致state重置
- **分步同步架构**：v1.6.1新增`/api/sync/step` API，将全量同步拆分为独立步骤(kline/indicators/score/crowding/pool/finance/full-pipeline/status)，每步50秒内完成一批，支持断点续传。解决Render免费版suspend导致全量同步中断的问题。GitHub Actions收盘后分4次触发full-pipeline
- **K线数据源**：v1.6.3采用「东方财富优先→腾讯回退」策略。东方财富K线API(push2his)在Render上间歇性失败，回退到腾讯K线(可用但不返回换手率)，用circ_mv和成交量自行计算换手率：turnover(%) = volume(手) * 100 * close / (circ_mv * 1e8) * 100。getDailyKline含2次重试+8秒超时。server.js中`emKline`引用东方财富模块，`tq`引用腾讯datasources
- **财务数据分步拉取**：v1.6.3新增finance step，分批拉取东方财富datacenter财务数据，避免scoreAllStocks内同步拉取200只财务数据超时。full-pipeline在评分前自动检查finance < pool*0.5时触发
- **动态Universe**：v1.6.0新增stock_universe表，从全市场按市值降序动态筛选Top 1000只（排除ST/退市/北交所/价格<2元），月初自动更新；股票池(200只)从Universe中按流动性45%+市值30%+动量25%综合打分选出；静态JSON保留作降级兜底
- **数据库迁移**：v1.6.0从Turso(SQLite)迁移到Supabase(PostgreSQL)，db.js内置SQL方言转换器（?→$N, INSERT OR REPLACE→ON CONFLICT），环境变量SUPABASE_DB_URL；本地开发仍用better-sqlite3
- **性能优化**：v1.6.1优化指标计算查询——只SELECT必要字段(trade_date,close,high,low,volume)而非SELECT *，只写最近250天指标，减少Supabase远程DB传输量
- **⚠️ SQL占位符铁律(v1.7.4教训)**：server.js写SQL必须用`?`占位符让db.js方言转换器转`$N`；**禁止手写`$N`**——db.js只处理`?`，手写`$N`在线上PostgreSQL会INSERT静默失败（无报错但写不进DB）。score-batch是字符串拼接SQL所以没踩坑
- **⚠️ Render内存state会丢**：/api/sync/step各step的进度state存进程内存，Render suspend后重置为0。客户端必须自维护进度(如rescore-v3.js传codes、crowd-run.js密集调用)或服务端setTimeout自调度
- **评分缓存**：/api/stocks/:code和列表读的是stock_score表缓存(DB)，不是实时计算。改评分逻辑后必须重跑评分(score-codes)才能生效，debug接口/api/debug/score/:code可看实时计算vs DB差异
- **crowding性能(v1.7.6)**：crowding.js有O(N²)嵌套计算(getCrowdingSignal→calcSectorCrowding→calcStockCrowding)，v1.7.6加两级内存缓存(个股`code|tradeDate`+板块`industry|tradeDate`)后单只20s→0.4s。缓存键含trade_date自动跨日失效，导出clearCrowdingCache()
- **财务数据本地上传**：Render上东财datacenter财务API可用性差，用scripts/upload-finance.js本地拉(getFinancialData在src/data/finance.js)→POST /api/sync/step step=finance-upload批量上传
- **退市股清理**：POST /api/cleanup/remove-stocks {codes:[...]} 从stock_info/stock_score/stock_universe/valuation/crowding_score/financial_indicator/daily_kline/technical_indicators 8张表删除
- **无PE估值分(v1.7.0)**：无PE时V分上限55、method='price_position_only(no_pe_data)'带warning；无财报Q分默认30。避免垃圾股因股价低位拿V=100

- **监控报警系统(v1.7.7, 2026-08-24, commit d6cd564+cc36b13+d5c701a)**：`GET /api/monitor/health`只读接口(服务/DB规模/新鲜度/信号分布/同步状态)+`.github/scripts/monitor.py`(阈值判断+gh自动创建Issue,标题固定`[监控] 线上健康异常`+open同名去重)+`.github/workflows/monitor.yml`(工作日每小时UTC cron `0 * * * 1-5`,权限issues:write)。新鲜度告警阈值diff>=3自然日,北京时间15:30-18:00同步窗口跳过新鲜度检查。踩坑:①PG的COUNT返回字符串需Number()转换 ②Render服务器UTC,期望交易日必须用`dayjs().add(8,'hour')`算北京时间 ③本机python3缺CA证书,本地测线上https需SSL_CERT_FILE=/etc/ssl/cert.pem
