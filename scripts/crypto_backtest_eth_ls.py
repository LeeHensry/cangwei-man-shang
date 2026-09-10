#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v2.5 ETH 多空组合实验 (目标: 7/3 多空风险配比, 抓双向大波动)
=============================================================
思路: 行情好坏=年内有无大波动率(涨跌都算), 策略要双向收割。
LONG侧: 定稿A配置(软门控+E1-E5+SL1.5RR1.0+并发4+risk15%) + 连亏3笔停168h熔断
SHORT侧(全新): 三族信号
  S-mirror 趋势跟空: 熊市背景(ETH日线空头排列+MACD死叉+BTC<SMA20) + 放量下跌/破20日低
  S-fade  回抽反抽: 熊市背景 + 反抽至1H-SMA20承压回落
  S-overheat 过热反转: 无门控 + 24h暴涨>10% + 量能/超买确认 (日线回放曾67%胜)
组合: 多空共用并发池(4)与熔断, 风险配比 long15% : short6.5% ≈ 7:3
"""
import json
import itertools
import importlib.util
import types
import numpy as np
import pandas as pd

BASE = '/Users/mlamp/WorkBuddy/2026-08-24-16-17-11'
src = open(f'{BASE}/scripts/crypto_backtest_eth_5x_r2.py').read().replace("if __name__ == '__main__':", "if False:")
r2 = types.ModuleType('r2'); exec(compile(src, 'r2', 'exec'), r2.__dict__)
r1 = r2.mod
bt1h = r2.bt1h

PAIR = 'ETHUSDT'
FEE = bt1h.FEE


def build_short_feats(f):
    """补做空所需特征: 破20日低/日线空头/4H空头/BOLL上轨超买/熊市门控"""
    c = pd.Series(f['close'])
    # 破20日低(前20个已完成UTC日最低价, shift1不含当日)
    day = f['day']
    d_low = pd.Series({'d': day, 'l': pd.Series(f['low'])}).set_index('d')['l'] if False else \
        pd.Series(f['low']).groupby(pd.Series(day)).min()
    thr_low = d_low.rolling(20).min().shift(1).to_dict()
    f['breakdown'] = [bool(day[i] in thr_low and pd.notna(thr_low[day[i]])
                           and f['close'][i] < thr_low[day[i]]) for i in range(len(c))]
    # 日线空头背景: 非多头排列 且 MACD死叉
    dctx = bt1h.load_daily_ctx(PAIR)
    f['bear'] = [(day[i] in dctx and (not dctx[day[i]]['bull']) and (not dctx[day[i]]['macd']))
                 for i in range(len(c))]
    # BTC熊市门控: BTC收盘<SMA20(无斜率, 无×1.03缓冲)
    d = pd.read_csv(f'{BASE}/data/crypto/cache/BTCUSDT_1d.csv', parse_dates=['date']).sort_values('date')
    sma20 = d['close'].rolling(20).mean()
    bear_map = {d['date'].iloc[i].date(): bool(d['close'].iloc[i] < sma20.iloc[i])
                for i in range(len(d)) if pd.notna(sma20.iloc[i])}
    f['btc_bear'] = [bear_map.get(day_i, False) for day_i in day]
    # BOLL上轨超买(1H)
    sma20h = pd.Series(f['sma20h'])
    std20 = c.rolling(20).std()
    f['overbought'] = (c > sma20h + 2 * std20).tolist()
    return f


def gen_short_signals(f, cfg):
    """做空信号: cfg={'families':['mirror','fade','overheat'], 'vr_th', 'pct_th', 'cooldown_h'}"""
    idxs = []
    cd_until = -1
    n = len(f['close'])
    fams = cfg['families']
    for i in range(200, n):
        if i <= cd_until:
            continue
        vr, pct, ret1 = f['vr'][i], f['pct24'][i], f['ret1h'][i]
        if pd.isna(vr) or pd.isna(pct):
            continue
        hit = False
        if 'mirror' in fams:
            # 趋势跟空: 熊市背景 + 放量下跌(或破位加速)
            if (f['bear'][i] and f['btc_bear'][i] and
                    ((vr > cfg['vr_th'] and pct < -cfg['pct_th']) or
                     (f['breakdown'][i] and pct < -cfg['pct_th']))):
                hit = True
        if not hit and 'fade' in fams:
            # 回抽反抽: 熊市背景 + 反抽至1H-SMA20附近承压回落
            s = f['sma20h'][i]
            if (f['bear'][i] and f['btc_bear'][i] and pd.notna(s) and s > 0 and pd.notna(ret1)
                    and 0.95 * s <= f['close'][i] <= 1.005 * s
                    and vr > 1.4 and ret1 < -0.3 and pct < 0):
                hit = True
        if not hit and 'overheat' in fams:
            # 过热反转: 无门控, 24h暴涨>10% + 超买或放量确认
            if pct > 10 and (f['overbought'][i] or vr > 2.0):
                hit = True
        if not hit:
            continue
        idxs.append(i)
        cd_until = i + cfg['cooldown_h']
    return idxs


def portfolio_sim(f, long_idxs, short_idxs, p):
    """多空组合模拟: 共用并发池+全局连亏熔断
    p = {'mc', 'risk_L', 'risk_S', 'sl_L', 'rr_L', 'sl_S', 'rr_S', 'ncap', 'expire', 'loss_n', 'pause_h'}"""
    # 展开为事件流: (bar, side, sl_mult, rr, risk)
    events = ([(i, 'L', p['sl_L'], p['rr_L'], p['risk_L']) for i in long_idxs] +
              [(i, 'S', p['sl_S'], p['rr_S'], p['risk_S']) for i in short_idxs])
    events.sort(key=lambda e: e[0])
    n = len(f['close'])
    active = []          # [entry_bar, exit_bar]
    consec_stops = 0
    pause_until = -1
    trades = []
    for i, side, sl_mult, rr, risk in events:
        if i + 1 >= n or i < pause_until:
            continue
        entry = f['open'][i + 1]
        atr = f['atr'][i]
        if not entry or entry <= 0 or pd.isna(atr) or atr <= 0:
            continue
        sl_pct = min(max(sl_mult * atr / entry, 0.02), 0.15)
        tp_pct = sl_pct * rr
        if side == 'L':
            stop, target = entry * (1 - sl_pct), entry * (1 + tp_pct)
        else:
            stop, target = entry * (1 + sl_pct), entry * (1 - tp_pct)
        exit_price, exit_j, reason = None, None, None
        end = min(i + 1 + p['expire'], n)
        for j in range(i + 1, end):
            lo, hi = f['low'][j], f['high'][j]
            if side == 'L':
                if lo <= stop:
                    exit_price, exit_j, reason = stop, j, 'stop'; break
                if hi >= target:
                    exit_price, exit_j, reason = target, j, 'target'; break
            else:
                if hi >= stop:
                    exit_price, exit_j, reason = stop, j, 'stop'; break
                if lo <= target:
                    exit_price, exit_j, reason = target, j, 'target'; break
        if exit_price is None:
            exit_j, exit_price, reason = end - 1, f['close'][end - 1], 'expire'
        active = [a for a in active if a[1] >= i + 1]
        if len(active) >= p['mc']:
            continue
        active.append([i + 1, exit_j])
        gross = (exit_price / entry - 1) if side == 'L' else (entry / exit_price - 1)
        net = gross - 2 * FEE
        notional = min(risk / sl_pct, p['ncap'])
        if reason == 'stop':
            consec_stops += 1
            if consec_stops >= p['loss_n']:
                pause_until = exit_j + p['pause_h']
                consec_stops = 0
        else:
            consec_stops = 0
        trades.append({'i': i, 'side': side, 'entry_dt': f['date'][i], 'exit_dt': f['date'][exit_j],
                       'hold_h': exit_j - (i + 1), 'reason': reason,
                       'net_pct': net * 100, 'pnl': net * notional * 100})
    return trades


def stats_portfolio(trades, span_h):
    if not trades:
        return None
    df = pd.DataFrame(trades).sort_values('entry_dt').reset_index(drop=True)
    eq = (1 + df['pnl'] / 100).cumprod()
    dd = ((eq - eq.cummax()) / eq.cummax()).min() * 100
    t0, t1 = df['entry_dt'].iloc[0], df['exit_dt'].iloc[-1]
    years = max((t1 - t0).days / 365.25, 0.5)
    ann = eq.iloc[-1] ** (1 / years)
    out = {'n': len(df), 'win': round((df['net_pct'] > 0).mean() * 100, 1),
           'avg_pnl': round(df['pnl'].mean(), 3), 'eq': round(eq.iloc[-1], 2),
           'ann': round(ann, 2), 'mdd': round(dd, 1), 'tpy': round(len(df) / years, 0)}
    for side, key in [('L', 'L'), ('S', 'S')]:
        sub = df[df['side'] == side]
        out[f'n_{key}'] = len(sub)
        if len(sub):
            out[f'win_{key}'] = round((sub['net_pct'] > 0).mean() * 100, 1)
            out[f'pnl_{key}'] = round(sub['pnl'].sum(), 1)
        else:
            out[f'win_{key}'] = 0
            out[f'pnl_{key}'] = 0
    return out, df


def main():
    f = build_short_feats(r2.build_feats())
    span = len(f['close'])
    print(f'{PAIR}: {span}根1H', flush=True)

    # LONG定稿信号
    long_cfg = {'evts': ['E1', 'E2', 'E3', 'E4', 'E5'], 'vr_th': 1.5, 'pct_th': 1.5,
                'cooldown_h': 6, 'gate_key': 'gate_soft', 'need_flag4': True}
    long_idxs = r2.gen_signals2(f, long_cfg)
    print(f'LONG信号: {len(long_idxs)}', flush=True)

    base_p = {'mc': 4, 'risk_L': 0.15, 'risk_S': 0.065, 'sl_L': 1.5, 'rr_L': 1.0,
              'ncap': 2.4, 'expire': 168, 'loss_n': 3, 'pause_h': 168}

    print("\n===== 空头单测(独立组合: 只做空) =====")
    grid_s = list(itertools.product(
        [['mirror'], ['mirror', 'fade'], ['mirror', 'fade', 'overheat'], ['overheat']],
        [1.5, 2.0],      # vr_th
        [1.5, 2.0],      # pct_th(跌幅)
        [1.5, 2.0],      # SL
    ))
    s_results = []
    for fams, vr, pct, sl in grid_s:
        cfg = {'families': fams, 'vr_th': vr, 'pct_th': pct, 'cooldown_h': 6}
        sidx = gen_short_signals(f, cfg)
        p = dict(base_p)
        p.update({'sl_S': sl, 'rr_S': 1.0, 'risk_S': 0.15})   # 单测时空头独享15%
        trades = portfolio_sim(f, [], sidx, p)
        if not trades:
            continue
        st, df = stats_portfolio(trades, span)
        st.update({'fam': '+'.join(f[0].upper() + f[1:] for f in fams), 'vr': vr, 'pct': pct, 'SL': sl})
        s_results.append(st)
    s_results.sort(key=lambda r: -r['ann'])
    print(f"{'事件族':26s} {'vr':>4s} {'跌幅':>4s} {'SL':>4s} | {'n':>4s} {'胜率':>6s} {'单均':>7s} {'年化':>6s} {'回撤':>7s}")
    for r in s_results[:10]:
        print(f"{r['fam']:26s} {r['vr']:4.1f} {r['pct']:4.1f} {r['SL']:4.1f} | "
              f"{r['n']:4d} {r['win']:5.1f}% {r['avg_pnl']:+7.3f} {r['ann']:5.2f}x {r['mdd']:6.1f}%")

    # 组合实验: 取空头单测较好的族, 跑多空组合
    print("\n===== 多空组合(7:3风险配比, 共用并发池+熔断) =====")
    combo_grid = list(itertools.product(
        [['mirror', 'overheat'], ['mirror', 'fade', 'overheat'], ['mirror'], ['mirror', 'fade']],
        [1.5, 2.0], [1.5, 2.0], [1.5, 2.0], [1.0, 1.5]))
    c_results = []
    for fams, vr, pct, sl, rr in combo_grid:
        cfg = {'families': fams, 'vr_th': vr, 'pct_th': pct, 'cooldown_h': 6}
        sidx = gen_short_signals(f, cfg)
        p = dict(base_p)
        p.update({'sl_S': sl, 'rr_S': rr})
        trades = portfolio_sim(f, long_idxs, sidx, p)
        if not trades:
            continue
        st, df = stats_portfolio(trades, span)
        st.update({'fam': '+'.join(fams), 'vr': vr, 'pct': pct, 'SL': sl, 'RR': rr})
        c_results.append((st, df))
    c_results.sort(key=lambda x: -x[0]['ann'])
    print(f"{'事件族':30s} {'vr':>4s} {'跌幅':>4s} {'SL':>4s} {'RR':>5s} | "
          f"{'n':>4s} {'胜率':>6s} {'年化':>6s} {'回撤':>7s} | 空头n/胜/累计pnl")
    for st, _ in c_results[:12]:
        print(f"{st['fam']:30s} {st['vr']:4.1f} {st['pct']:4.1f} {st['SL']:4.1f} {st['RR']:5.2f} | "
              f"{st['n']:4d} {st['win']:5.1f}% {st['ann']:5.2f}x {st['mdd']:6.1f}% | "
              f"{st['n_S']:3d}/{st['win_S']:5.1f}%/{st['pnl_S']:+.1f}%")

    # 基准: 纯多头(A+熔断)
    p = dict(base_p)
    p.update({'sl_S': 2.0, 'rr_S': 1.0})
    lonl_only = portfolio_sim(f, long_idxs, [], p)
    st_l, _ = stats_portfolio(lonl_only, span)
    print(f"\n纯多头基准: n={st_l['n']} 胜率={st_l['win']}% 年化={st_l['ann']}x 回撤={st_l['mdd']}%")

    if c_results:
        best_st, best_df = c_results[0]
        print(f"\n===== 最优组合 分年 (空头{best_st['fam']} vr{best_st['vr']} pct{best_st['pct']} "
              f"SL{best_st['SL']} RR{best_st['RR']}) =====")
        for y, sub in best_df.groupby(best_df['entry_dt'].dt.year):
            w = (sub['net_pct'] > 0).mean() * 100
            yeq = (1 + sub['pnl'] / 100).prod()
            s_sub = sub[sub['side'] == 'S']
            s_txt = f" 空头n={len(s_sub)} pnl={s_sub['pnl'].sum():+.1f}%" if len(s_sub) else ""
            print(f"  {y}: n={len(sub):4d} 胜率={w:5.1f}% 当年净值={yeq:.2f}x{s_txt}")
        df2 = best_df[~best_df['entry_dt'].dt.year.isin([2023, 2024])]
        if len(df2) > 10:
            eq2 = (1 + df2['pnl'] / 100).prod()
            t0, t1 = df2['entry_dt'].min(), df2['exit_dt'].max()
            yrs = max((t1 - t0).days / 365.25, 0.5)
            print(f"  剔除2023-24: n={len(df2)} 累计={eq2:.2f}x 年化={eq2 ** (1 / yrs):.2f}x")

    with open(f'{BASE}/data/crypto/backtest_eth_ls_report.json', 'w') as fo:
        json.dump({'short_only': s_results[:15],
                   'combo': [{'stats': st} for st, _ in c_results[:15]]},
                  fo, ensure_ascii=False, indent=2, default=str)


if __name__ == '__main__':
    main()
