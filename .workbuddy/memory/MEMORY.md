# 项目长期记忆

## 仓位满上 TopUp
- **项目路径**：`/Users/mlamp/WorkBuddy/2026-07-30-16-01-51/`（不是 ~/cangwei-man-shang）
- **仓库**：https://github.com/LeeHensry/cangwei-man-shang (main分支)
- **线上地址**：https://cangwei-man-shang.onrender.com（免费版，冷启动1-2分钟）
- **当前版本**：v1.4.3
- **技术栈**：React+AntD+Vite前端 / Express+@libsql/client(Turso)后端
- **数据库**：Turso云数据库 libsql://topup-db-leehensry.aws-ap-northeast-1.turso.io（东京区）
- **代码约定**：数据库股票代码统一为纯6位数字；数据源层(toSinaCode/toTencentCode)自动加前缀
- **数据库API**：全部异步（dbGet/dbAll/dbRun/dbBatch/dbExec/dbIsReady），不再使用better-sqlite3同步API
- **部署约定**：版本号更新和部署必须先经用户确认后再执行；web/dist在.gitignore中，Render通过build脚本自动构建
- **Render环境变量**：TURSO_AUTH_TOKEN和TURSO_DATABASE_URL已硬编码到db.js默认值中（用户无法登录Render Dashboard），线上已连接Turso。等用户恢复Render登录后建议改为环境变量方式
