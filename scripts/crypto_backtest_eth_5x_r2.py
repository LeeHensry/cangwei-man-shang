#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v2.4-R2 ETH 5x 定向实验(第二轮)
================================
R1结论: 诚实并发口径下最高2.74x, 5x差一倍。
R2杠杆: ①门控降级 strong->soft(BTC>SMA20x1.03, 去掉斜率要求, 早牛市/更多时段放行)
        ②背景条件去掉4H均线flag4(3条即可) ③风险预算12/15/18% ④并发上限3/4
全部与R1同一仓位感知模拟器。
"""
import json
import itertools
import importlib.util
import pandas as pd
import numpy as np
import types

BASE = '/Users/mlamp/WorkBuddy/2026-08-24-16-17-11'
src = open(f'{BASE}/scripts/crypto_backtest_eth_5x.py').read().replace("if __name__ == '__main__':", "if False:")
mod = types.ModuleType('r1'); exec(compile(src, 'r1', 'exec'), mod.__dict__)
bt1h = mod.bt1h

PAIR = 'ETHUSDT'


def load_soft_gate():
    """软门控: BTC收盘>SMA20x1.03, 无斜率要求"""
    d = pd.read_csv(f'{mod.BASE}/data/crypto/cache/BTCUSDT_1d.csv',
                    parse_dates=['date']).sort_values('date').reset_index(drop=True)
    sma20 = d['close'].rolling(20).mean()
    return {d['date'].iloc[i].date(): bool(d['close'].iloc[i] > sma20.iloc[i] * 1.03)
            for i in range(len(d)) if pd.notna(sma20.iloc[i])}


def build_feats():
    btc_strong = bt1h.load_btc_gate()
    btc_soft = load_soft_gate()
    f = mod.enrich(bt1h.precompute_coin(PAIR, btc_strong))
    # 逐小时映射软门控
    f['gate_soft'] = [btc_soft.get(day, False) for day in f['day']]
    return f


def gen_signals2(f, cfg):
    """cfg新增: gate_key('gate'/'gate_soft'), need_flag4(bool)"""
    idxs = []
    cd_until = -1
    n = len(f['close'])
    for i in range(200, n):
        if i <= cd_until:
            continue
        vr, pct, ret1 = f['vr'][i], f['pct24'][i], f['ret1h'][i]
        bw = f['bw_rank'][i]
        if pd.isna(vr) or pd.isna(pct):
            continue
        if not f[cfg['gate_key']][i]:
            continue
        if not (f['bull'][i] and f['macd'][i]):
            continue
        if cfg['need_flag4'] and not f['flag4'][i]:
            continue
        hit = False
        if 'E2' in cfg['evts'] and vr > cfg['vr_th'] and pct > cfg['pct_th']:
            hit = True
        if not hit and 'E1' in cfg['evts'] and vr > cfg['vr_th'] and pct > cfg['pct_th'] and f['breakout'][i]:
            hit = True
        if not hit and 'E3' in cfg['evts'] and f['breakout'][i] and pct > cfg['pct_th']:
            hit = True
        if not hit and 'E4' in cfg['evts']:
            s = f['sma20h'][i]
            if (pd.notna(s) and s > 0 and pd.notna(ret1)
                    and 0.995 * s <= f['close'][i] <= 1.05 * s
                    and vr > 1.4 and ret1 > 0.3 and pct > 0):
                hit = True
        if not hit and 'E5' in cfg['evts']:
            if pd.notna(bw) and bw < 0.25 and f['breakout'][i] and vr > 1.3:
                hit = True
        if not hit:
            continue
        idxs.append(i)
        cd_until = i + cfg['cooldown_h']
    return idxs


def main():
    f = build_feats()
    span_h = len(f['close'])
    print(f'{PAIR}: {span_h}根1H', flush=True)

    grid = list(itertools.product(
        [['E1', 'E2', 'E3'], ['E1', 'E2', 'E3', 'E4', 'E5']],
        ['gate', 'gate_soft'],        # 门控
        [True, False],                # need_flag4
        [1.2, 1.5],                   # vr
        [(1.5, 1.0), (2.0, 1.0)],     # (SL,RR)
        [3, 4],                       # max_conc
        [0.12, 0.15, 0.18],           # risk
    ))
    print(f'R2网格: {len(grid)}组', flush=True)

    results = []
    for evts, gk, nf4, vr, (sl, rr), mc, risk in grid:
        cfg = {'evts': evts, 'vr_th': vr, 'pct_th': 1.5, 'cooldown_h': 6,
               'gate_key': gk, 'need_flag4': nf4}
        idxs = gen_signals2(f, cfg)
        trades, _ = mod.simulate_cap(f, idxs, sl, rr, mc, risk, 2.4, 168)
        s = mod.stats_all(trades, span_h)
        if s:
            s.update({'evts': '+'.join(evts), 'gate': gk.replace('gate_', ''), 'f4': nf4,
                      'vr': vr, 'SL': sl, 'RR': rr, 'mc': mc, 'risk': risk})
            results.append(s)

    hit5 = [r for r in results if r['ann'] >= 5.0]
    hit5.sort(key=lambda r: (-r['tpy'], r['mdd']))
    results.sort(key=lambda r: -r['ann'])
    with open(f'{BASE}/data/crypto/backtest_eth5x_r2_report.json', 'w') as fo:
        json.dump({'hit5_top': hit5[:30], 'ann_top': results[:20]}, fo,
                  ensure_ascii=False, indent=2, default=str)

    print(f"\n===== 年化>=5x: {len(hit5)}组 =====")
    print(f"{'事件':11s} {'门控':5s} {'4H':4s} {'vr':>4s} {'SL':>4s} {'RR':>5s} {'并发':>3s} {'风险':>5s} | "
          f"{'n':>4s} {'年单':>4s} {'胜率':>6s} {'H1':>5s} {'H2':>5s} {'单均':>7s} {'年化':>6s} {'回撤':>7s} {'均敞口':>6s}")
    for r in hit5[:20]:
        print(f"{r['evts']:11s} {r['gate']:5s} {str(r['f4']):4s} {r['vr']:4.1f} {r['SL']:4.1f} {r['RR']:5.2f} {r['mc']:3d} "
              f"{r['risk']:5.2f} | {r['n']:4d} {r['tpy']:4.0f} {r['win']:5.1f}% {r['win_h1']:5.1f} {r['win_h2']:5.1f} "
              f"{r['avg_pnl']:+7.3f} {r['ann']:5.2f}x {r['mdd']:6.1f}% {r['avg_notional']:6.2f}")

    print(f"\n===== 全榜年化TOP10 =====")
    for r in results[:10]:
        print(f"{r['evts']:11s} 门控{r['gate']} f4={r['f4']} vr{r['vr']} SL{r['SL']} RR{r['RR']} "
              f"并发{r['mc']} risk{r['risk']} | n={r['n']} 年单{r['tpy']:.0f} 胜率{r['win']}% "
              f"单均{r['avg_pnl']:+.3f} 年化{r['ann']}x 回撤{r['mdd']}%")

    if hit5:
        best = hit5[0]
        cfg = {'evts': best['evts'].split('+'), 'vr_th': best['vr'], 'pct_th': 1.5,
               'cooldown_h': 6, 'gate_key': 'gate_' + best['gate'], 'need_flag4': best['f4']}
        trades, _ = mod.simulate_cap(f, gen_signals2(f, cfg), best['SL'], best['RR'],
                                     best['mc'], best['risk'], 2.4, 168)
        df = pd.DataFrame(trades)
        print(f"\n===== 推荐(单数最多5x配置) 分年 =====")
        for y, sub in df.groupby(df['entry_dt'].dt.year):
            w = (sub['net_pct'] > 0).mean() * 100
            yeq = (1 + sub['pnl'] / 100).prod()
            print(f"  {y}: n={len(sub):4d} 胜率={w:5.1f}% 当年净值={yeq:.2f}x")
        df2 = df[~df['entry_dt'].dt.year.isin([2023, 2024])]
        if len(df2) > 10:
            eq2 = (1 + df2['pnl'] / 100).prod()
            t0, t1 = df2['entry_dt'].min(), df2['exit_dt'].max()
            yrs = max((t1 - t0).days / 365.25, 0.5)
            print(f"  剔除2023-24: n={len(df2)} 累计={eq2:.2f}x 年化={eq2 ** (1 / yrs):.2f}x")


if __name__ == '__main__':
    main()
