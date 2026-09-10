#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v2.3 激进版实验: 目标年化5x, 杠杆8x, 回撤可接受
================================================
改动(vs v2.2定稿):
  - 风险预算 3% -> 8% 净值/单
  - 名义敞口上限 = 8x × 20%保证金 = 160% 净值 (原5x=100%)
  - 网格放宽: 加回E3事件 / vr阈值降到1.5 / 24h涨幅降到2% / 冷却最短12h
  - 新增RR=1.5组合(更高盈亏比搏更高单笔期望)
排序: 年化收益优先, 报告回撤; 检验5x目标可达性
"""
import json
import itertools
import importlib.util
import pandas as pd

spec = importlib.util.spec_from_file_location('bt1h', '/Users/mlamp/WorkBuddy/2026-08-24-16-17-11/scripts/crypto_backtest_1h.py')
bt1h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bt1h)

# 激进风控参数(直接改模块全局, simulate()引用同名字段)
bt1h.RISK_PCT = 0.08
bt1h.NOTIONAL_CAP = 1.6   # 8x × 20%

TRIO = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
EXPIRE = bt1h.EXPIRE_BARS


def gen_signals3(f, cfg):
    """支持E1E2/E1/E1E2E3三种事件组合"""
    idxs = []
    cd_until = -1
    for i in range(200, len(f['close'])):
        if i <= cd_until:
            continue
        vr, pct = f['vr'][i], f['pct24'][i]
        if pd.isna(vr) or pd.isna(pct):
            continue
        if not (f['gate'][i] and f['bull'][i] and f['macd'][i] and f['flag4'][i]):
            continue
        ev = None
        if vr > cfg['vr_th'] and pct > cfg['pct_th']:
            ev = 'E1' if f['breakout'][i] else 'E2'
        elif cfg['events'] == 'E1E2E3' and f['breakout'][i] and pct > 2:
            ev = 'E3'
        if ev is None:
            continue
        if cfg['events'] == 'E1' and ev != 'E1':
            continue
        idxs.append(i)
        cd_until = i + cfg['cooldown_h']
    return idxs


def stats_annual(trades):
    if not trades:
        return None
    df = pd.DataFrame(trades)
    eq = (1 + df['pnl'] / 100).cumprod()
    dd = ((eq - eq.cummax()) / eq.cummax()).min() * 100
    # 年化: 用首尾交易时间跨度
    t0, t1 = df['dt'].iloc[0], df['dt'].iloc[-1]
    years = max((t1 - t0).days / 365.25, 0.5)
    ann = eq.iloc[-1] ** (1 / years)
    half = len(df) // 2
    return {'n': len(df), 'win': round((df['net_pct'] > 0).mean() * 100, 1),
            'avg_pnl': round(df['pnl'].mean(), 3),
            'eq': round(eq.iloc[-1], 2), 'ann': round(ann, 2), 'years': round(years, 1),
            'mdd': round(dd, 1),
            'win_h1': round((df['net_pct'].iloc[:half] > 0).mean() * 100, 1) if half else 0,
            'win_h2': round((df['net_pct'].iloc[half:] > 0).mean() * 100, 1) if half else 0,
            'trades_per_yr': round(len(df) / years, 0)}


def main():
    btc_gate = bt1h.load_btc_gate()
    feats = {p: bt1h.precompute_coin(p, btc_gate) for p in TRIO}
    # 给trades补日期
    for p, f in feats.items():
        f['dt'] = f['date']

    grid = list(itertools.product(
        ['E1E2', 'E1E2E3'],          # events
        [1.5, 2.0, 2.5],             # vr_th
        [2, 3, 4],                   # pct_th
        [12, 24, 48],                # cooldown_h
        [(2.0, 1.0), (1.5, 1.0), (2.0, 1.5), (1.5, 0.75), (2.5, 1.5)],  # (SL,RR)
    ))
    print(f'网格规模: {len(grid)}组', flush=True)

    results = []
    for events, vr_th, pct_th, cd, (sl, rr) in grid:
        cfg = {'events': events, 'vr_th': vr_th, 'pct_th': pct_th, 'cooldown_h': cd}
        trades = []
        for p, f in feats.items():
            for t in bt1h.simulate(f, gen_signals3(f, cfg), sl, rr):
                t['dt'] = f['date'][t['i']]
                trades.append(t)
        s = stats_annual(trades)
        if s:
            s.update({'events': events, 'vr': vr_th, 'pct': pct_th, 'cd_h': cd, 'SL': sl, 'RR': rr})
            results.append(s)

    # 排序: 年化降序(要求n>=100)
    big = sorted([r for r in results if r['n'] >= 100], key=lambda r: -r['ann'])
    with open('/Users/mlamp/WorkBuddy/2026-08-24-16-17-11/data/crypto/backtest_aggressive_report.json', 'w') as fo:
        json.dump({'top': big[:25]}, fo, ensure_ascii=False, indent=2)

    print(f"\n===== 激进版(8%风险预算+8x杠杆) TOP15, 共{len(results)}组, n>=100的{len(big)}组 =====")
    print(f"{'事件':7s} {'vr':>4s} {'涨幅':>4s} {'冷却':>4s} {'SL':>4s} {'RR':>5s} "
          f"{'n':>5s} {'年单数':>5s} {'胜率':>6s} {'H1':>5s} {'H2':>5s} {'单均':>8s} {'累计':>7s} {'年化':>6s} {'回撤':>6s}")
    for r in big[:15]:
        print(f"{r['events']:7s} {r['vr']:4.1f} {r['pct']:4d} {r['cd_h']:4d} {r['SL']:4.1f} {r['RR']:5.2f} "
              f"{r['n']:5d} {r['trades_per_yr']:5.0f} {r['win']:5.1f}% {r['win_h1']:5.1f} {r['win_h2']:5.1f} "
              f"{r['avg_pnl']:+8.3f} {r['eq']:6.2f}x {r['ann']:5.2f}x {r['mdd']:5.1f}%")

    n5 = sum(1 for r in big if r['ann'] >= 5.0)
    print(f"\n年化>=5x的配置数: {n5}")
    if big:
        # TOP1 分年
        best = big[0]
        cfg = {'events': best['events'], 'vr_th': best['vr'], 'pct_th': best['pct'], 'cooldown_h': best['cd_h']}
        all_t = []
        for p, f in feats.items():
            for t in bt1h.simulate(f, gen_signals3(f, cfg), best['SL'], best['RR']):
                t['pair'] = p
                t['year'] = f['dt'][t['i']].year
                all_t.append(t)
        df = pd.DataFrame(all_t)
        print(f"\n===== TOP1({best['events']} vr{best['vr']} pct{best['pct']} cd{best['cd_h']} SL{best['SL']} RR{best['RR']}) 分币 =====")
        for p, sub in df.groupby('pair'):
            w = (sub['net_pct'] > 0).mean() * 100
            print(f"  {p}: n={len(sub):3d} 胜率={w:5.1f}% 单均={sub['pnl'].mean():+.3f}% 累计={sub['pnl'].sum():+.1f}%")
        print('===== TOP1 分年 =====')
        for y, sub in df.groupby('year'):
            w = (sub['net_pct'] > 0).mean() * 100
            yr_eq = (1 + sub['pnl'] / 100).prod()
            print(f"  {y}: n={len(sub):4d} 胜率={w:5.1f}% 单均={sub['pnl'].mean():+.3f}% 当年净值={yr_eq:.2f}x")


if __name__ == '__main__':
    main()
