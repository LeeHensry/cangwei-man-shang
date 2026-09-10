#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v2.3-E: ETH单币收敛实验
========================
背景: 三币激进版TOP配置里BTC是弱势腿(胜率46.6%), ETH/SOL扛旗。
本实验: 只用ETH 1H数据, 参数空间在激进版有效区收敛, 检验ETH单币能否独立达成5x/年。
风控: 8%风险预算/单, 名义敞口上限160%(8x×20%), 与激进版一致。
"""
import json
import itertools
import importlib.util
import pandas as pd

BASE = '/Users/mlamp/WorkBuddy/2026-08-24-16-17-11'
spec = importlib.util.spec_from_file_location('bt1h', f'{BASE}/scripts/crypto_backtest_1h.py')
bt1h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bt1h)

# 激进风控参数
bt1h.RISK_PCT = 0.08
bt1h.NOTIONAL_CAP = 1.6

PAIR = 'ETHUSDT'


def gen_signals3(f, cfg):
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
    f = bt1h.precompute_coin(PAIR, btc_gate)
    f['dt'] = f['date']
    print(f'{PAIR}: {len(f["close"])}根1H, {f["date"][0]} ~ {f["date"][-1]}', flush=True)

    # 收敛网格: 激进版有效区, 去掉已证明无效的组合(vr2.5+pct4等严苛区)
    grid = list(itertools.product(
        ['E1E2', 'E1E2E3'],           # events (E1单独已证样本不足)
        [1.5, 2.0, 2.5],              # vr_th
        [2, 3],                       # pct_th
        [12, 24, 48],                 # cooldown_h
        [(2.0, 1.0), (1.5, 0.75), (2.0, 1.5), (1.5, 1.0), (2.5, 1.5), (2.0, 0.75)],  # (SL,RR)
    ))
    print(f'收敛网格: {len(grid)}组', flush=True)

    results = []
    for events, vr_th, pct_th, cd, (sl, rr) in grid:
        cfg = {'events': events, 'vr_th': vr_th, 'pct_th': pct_th, 'cooldown_h': cd}
        trades = []
        for t in bt1h.simulate(f, gen_signals3(f, cfg), sl, rr):
            t['dt'] = f['date'][t['i']]
            trades.append(t)
        s = stats_annual(trades)
        if s:
            s.update({'events': events, 'vr': vr_th, 'pct': pct_th, 'cd_h': cd, 'SL': sl, 'RR': rr})
            results.append(s)

    # 排序: ETH单币7年, n>=40算可用样本
    big = sorted([r for r in results if r['n'] >= 40], key=lambda r: -r['ann'])
    small = sorted([r for r in results if r['n'] < 40], key=lambda r: -r['ann'])
    with open(f'{BASE}/data/crypto/backtest_eth_only_report.json', 'w') as fo:
        json.dump({'big_sample_top': big[:25], 'small_sample_top': small[:10]}, fo,
                  ensure_ascii=False, indent=2)

    print(f"\n===== ETH单币(8%风险+8x杠杆) TOP15, 共{len(results)}组, n>=40的{len(big)}组 =====")
    print(f"{'事件':7s} {'vr':>4s} {'涨幅':>4s} {'冷却':>4s} {'SL':>4s} {'RR':>5s} "
          f"{'n':>5s} {'年单数':>5s} {'胜率':>6s} {'H1':>5s} {'H2':>5s} {'单均':>8s} {'累计':>7s} {'年化':>6s} {'回撤':>6s}")
    for r in big[:15]:
        print(f"{r['events']:7s} {r['vr']:4.1f} {r['pct']:4d} {r['cd_h']:4d} {r['SL']:4.1f} {r['RR']:5.2f} "
              f"{r['n']:5d} {r['trades_per_yr']:5.0f} {r['win']:5.1f}% {r['win_h1']:5.1f} {r['win_h2']:5.1f} "
              f"{r['avg_pnl']:+8.3f} {r['eq']:6.2f}x {r['ann']:5.2f}x {r['mdd']:5.1f}%")

    n5 = sum(1 for r in big if r['ann'] >= 5.0)
    print(f"\n年化>=5x的配置数: {n5}")

    if big:
        best = big[0]
        cfg = {'events': best['events'], 'vr_th': best['vr'], 'pct_th': best['pct'], 'cooldown_h': best['cd_h']}
        all_t = []
        for t in bt1h.simulate(f, gen_signals3(f, cfg), best['SL'], best['RR']):
            t['dt'] = f['date'][t['i']]
            all_t.append(t)
        df = pd.DataFrame(all_t)
        print(f"\n===== TOP1({best['events']} vr{best['vr']} pct{best['pct']} cd{best['cd_h']} "
              f"SL{best['SL']} RR{best['RR']}) 分年 =====")
        for y, sub in df.groupby(df['dt'].dt.year):
            w = (sub['net_pct'] > 0).mean() * 100
            yr_eq = (1 + sub['pnl'] / 100).prod()
            print(f"  {y}: n={len(sub):4d} 胜率={w:5.1f}% 单均={sub['pnl'].mean():+.3f}% 当年净值={yr_eq:.2f}x")
        if 'reason' in df:
            print('平仓原因分布:', df['reason'].value_counts().to_dict())

        # 去掉2023年看依赖度
        df_no23 = df[df['dt'].dt.year != 2023]
        if len(df_no23) > 10:
            eq2 = (1 + df_no23['pnl'] / 100).prod()
            dd2 = (((1 + df_no23['pnl'] / 100).cumprod() /
                    (1 + df_no23['pnl'] / 100).cumprod().cummax()) - 1).min() * 100
            t0, t1 = df_no23['dt'].iloc[0], df_no23['dt'].iloc[-1]
            yrs = (t1 - t0).days / 365.25
            print(f"\n剔除2023后: n={len(df_no23)} 累计={eq2:.2f}x 年化={eq2 ** (1 / yrs):.2f}x 回撤={dd2:.1f}%")


if __name__ == '__main__':
    main()
