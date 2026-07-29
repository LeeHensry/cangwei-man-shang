# 项目结构说明

```
stock-advisor/
├── README.md          # 产品架构文档（核心文档）
├── PROJECT.md         # 本文件
├── data/              # DuckDB数据库文件存放
├── src/
│   ├── data/          # 数据获取与存储
│   ├── factors/       # 因子计算
│   ├── strategies/    # 策略逻辑（价值/短线）
│   ├── backtest/      # 回测引擎
│   ├── llm/           # LLM辅助模块
│   ├── risk/          # 风控引擎
│   └── output/        # 日报生成与推送
├── notebooks/         # Jupyter分析notebook
└── tests/             # 测试
```
