# crypto-eth-quant — ETH 多空双向 1H 量化策略

ETH 单币多空双向策略（BTC 环境门控 + 事件驱动），7 年 1H 回测 → 模拟盘实测中。

- 策略文档: `docs/`（v2.0 → v2.5 迭代全记录，v2.5 为定稿）
- 回测脚本: `scripts/`（信号回放 → 网格搜索 → 多空组合，实验决策链完整）
- K线数据: `data/crypto/cache/`（币安公开镜像 data-api.binance.vision，1d/4h/1h 三周期，2019-06 起）
- 模拟盘: `scripts/crypto_paper_engine.py` + `data/crypto/paper/state.json`（虚拟 1 万 USDT 复利记账）
- 回测报告: `data/crypto/*_report.json`

## 定稿配置速览（v2.5, 5:5 多空风险配比）
- LONG: E1-E5 事件 + 软门控(BTC>SMA20×1.03) + SL=1.5×ATR / TP 1:1，风险 15%/单
- SHORT: mirror 趋势跟空 + 熊市三重确认(ETH日线空头+MACD死叉+BTC<SMA20)，风险 6.5%/单
- 组合: 共用 4 仓并发池，连亏 3 笔停 168h 熔断；7 年回测无亏损年
