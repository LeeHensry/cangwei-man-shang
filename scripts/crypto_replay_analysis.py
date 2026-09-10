#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
信号回放深度分析: 规则贡献拆解 / score分桶 / 波动率分桶 / vs基线
用法: python scripts/crypto_replay_analysis.py
"""
import json
import pandas as pd
import numpy as np

BASE = '/Users/mlamp/WorkBuddy/2026-08-24-16-17-11'
OUT = f'{BASE}/data/crypto'

df = pd.read_csv(f'{OUT}/replay_signals.csv')
df['date'] = pd.to_datetime(df['date'])

# ===== 1. 基线: 所有(币,日)的7d收益 =====
print('计算全池基线(需要全部币的日线)...')
import urllib.request, os
pairs = df['pair'].unique().tolist()
baseline_rows = []
cache_dir = f'{OUT}/cache'
for pair in pairs:
    cp = f'{cache_dir}/{pair}_1d.csv'
    if not os.path.exists(cp):
        continue
    d = pd.read_csv(cp, parse_dates=['date'])
    d['ret_7d'] = d['close'].shift(-7) / d['close'] - 1
    d['ret_3d'] = d['close'].shift(-3) / d['close'] - 1
    btc = pd.read_csv(f'{cache_dir}/BTCUSDT_1d.csv', parse_dates=['date'])
    btc['sma20'] = btc['close'].rolling(20).mean()
    bull_map = dict(zip(btc['date'].dt.date, (btc['close'] > btc['sma20']).astype(int)))
    d['day'] = d['date'].dt.date
    d['btc_bull'] = d['day'].map(bull_map)
    baseline_rows.append(d[['day', 'btc_bull', 'ret_3d', 'ret_7d']])
bl = pd.concat(baseline_rows)

print('\n===== 基线 vs 信号(7d) =====')
for state, label in ((1, 'BTC牛市'), (0, 'BTC熊市')):
    b = bl[bl['btc_bull'] == state]['ret_7d'].dropna()
    print(f"全池基线[{label}]: n={len(b)}  均值={b.mean()*100:+.2f}%  中位={b.median()*100:+.2f}%")
    for sig, mult in (('long', 1), ('short', -1)):
        s = df[(df['signal'] == sig) & (df['btc_bull'] == state)]
        r = s['ret_7d'] * mult
        if len(r) >= 20:
            print(f"  {sig.upper():5s}信号[{label}]: n={len(r):5d}  均值={r.mean()*100:+.2f}%  "
                  f"超额={r.mean()*100 - b.mean()*100:+.2f}pp")

# ===== 2. 规则贡献拆解 =====
print('\n===== 各规则触发时的7d表现(LONG方向, 仅牛市信号) =====')
lb = df[(df['signal'] == 'long') & (df['btc_bull'] == 1)]
rules = ['均线多头排列(日)', '4H均线多头', 'MACD多头(日)', 'RSI超卖', 'RSI偏强',
         '突破20日新高', '放量上涨', '跌破BOLL下轨(超卖)', '恐慌']
for rule in rules:
    mask = lb['reasons'].fillna('').str.contains(rule)
    if mask.sum() < 15:
        continue
    r = lb[mask]['ret_7d']
    base_bull = bl[bl['btc_bull'] == 1]['ret_7d'].mean() * 100
    print(f"{rule:14s}: n={mask.sum():5d}  胜率={(r>0).mean()*100:5.1f}%  "
          f"均值={r.mean()*100:+.2f}%  vs牛市基线{r.mean()*100-base_bull:+.2f}pp")

print('\n===== 各规则触发时的7d表现(SHORT方向, 全状态) =====')
ss = df[df['signal'] == 'short']
for rule in ['均线空头排列(日)', '4H均线空头', 'MACD空头(日)', 'RSI超买', '跌破20日新低',
             '放量下跌', '突破BOLL上轨(超买)', '过热']:
    mask = ss['risks'].fillna('').str.contains(rule)
    if mask.sum() < 15:
        continue
    r = ss[mask]['ret_7d'] * -1
    print(f"{rule:14s}: n={mask.sum():5d}  胜率={(r>0).mean()*100:5.1f}%  均值={r.mean()*100:+.2f}%")

# ===== 3. score 分桶 (LONG, 牛市) =====
print('\n===== LONG信号按score分桶(仅牛市, 7d) =====')
for lo, hi in ((72, 75), (75, 80), (80, 101)):
    sub = lb[(lb['score'] >= lo) & (lb['score'] < hi)]['ret_7d']
    if len(sub) < 15:
        continue
    print(f"score {lo}-{hi}: n={len(sub):5d}  胜率={(sub>0).mean()*100:5.1f}%  均值={sub.mean()*100:+.2f}%")

# ===== 4. ATR 波动率分桶 (LONG, 牛市) =====
print('\n===== LONG信号按ATR波动率分桶(仅牛市, 7d) =====')
lb2 = lb.dropna(subset=['atr_pct'])
for lo, hi, label in ((0, 3, '低波<3%'), (3, 6, '中波3-6%'), (6, 99, '高波>6%')):
    sub = lb2[(lb2['atr_pct'] >= lo) & (lb2['atr_pct'] < hi)]['ret_7d']
    if len(sub) < 15:
        continue
    print(f"{label}: n={len(sub):5d}  胜率={(sub>0).mean()*100:5.1f}%  均值={sub.mean()*100:+.2f}%")

# ===== 5. watch_long 是否值得看 =====
wl = df[df['signal'] == 'watch_long']
print(f"\n===== watch_long(n={len(wl)}): 7d胜率={(wl['ret_7d']>0).mean()*100:.1f}%  "
      f"均值={wl['ret_7d'].mean()*100:+.2f}% =====")

# ===== 6. 保存分析结果 =====
result = {'note': '详见终端输出', 'baseline_bull_7d': round(bl[bl['btc_bull']==1]['ret_7d'].mean()*100, 3),
          'baseline_bear_7d': round(bl[bl['btc_bull']==0]['ret_7d'].mean()*100, 3)}
with open(f'{OUT}/replay_analysis.json', 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)
print('\n分析完成')
