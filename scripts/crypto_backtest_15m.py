#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v2.3 三币(BTC/ETH/SOL) 15m粒度优化实验
======================================
模式A: 15m信号 + 15m执行   (信号判定也细化到15分钟)
模式B: 1H信号 + 15m执行    (信号仍按1H判定, 只升级执行精度 → 隔离入场提前量的收益)

策略语义与1H版同构:
  E1 = vr>th & pct24>pct_th & breakout(前20个已完成UTC日高)
  E2 = vr>th & pct24>pct_th
  背景(上一完成日): 日线多头排列 + MACD多头 + 4H SMA5>SMA20  (三条全要)
  门控: BTC上一完成日 close>SMA20*1.03 且 SMA20上行
  vr = 当前15m量 / 同(小时,分钟)过去14天均值
  pct24 = 24h滚动涨幅 (96根15m)
交易: 信号K线收盘 → 下一根开盘入场; SL=SL_mult×日ATR14(钳2%-15%)/TP=RR×SL
      逐15m检查(先止损保守); 7天(672根)到期平仓; 单边0.1%手续费
      风险预算3%净值, 名义敞口=3%/sl_pct 封顶100%
输出: data/crypto/backtest_15m_report.json + 终端TOP榜(分币/分年)
"""
import json
import os
import importlib.util
import itertools
import numpy as np
import pandas as pd

BASE = '/Users/mlamp/WorkBuddy/2026-08-24-16-17-11'
CACHE = f'{BASE}/data/crypto/cache'
OUT = f'{BASE}/data/crypto'

TRIO = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
FEE = 0.001
RISK_PCT = 0.03
NOTIONAL_CAP = 1.0
EXPIRE_BARS = 7 * 24 * 4   # 672根15m = 7天

# 复用1H引擎的日线/4H/门控计算
spec = importlib.util.spec_from_file_location('bt1h', f'{BASE}/scripts/crypto_backtest_1h.py')
bt1h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bt1h)


def precompute_15m(pair, btc_gate):
    d = pd.read_csv(f'{CACHE}/{pair}_15m.csv', parse_dates=['date']).sort_values('date').reset_index(drop=True)
    c, h, l, v = d['close'], d['high'], d['low'], d['volume']
    # 同(小时,分钟)14天基线量比
    hm = d['date'].dt.strftime('%H:%M')
    df = pd.DataFrame({'date': d['date'], 'hm': hm, 'v': v}).sort_values('date').reset_index(drop=True)
    v_base = pd.Series(np.nan, index=df.index)
    for g, sub in df.groupby('hm'):
        v_base.loc[sub.index] = sub['v'].rolling(14, min_periods=7).mean().shift(1)
    vr = (v / v_base).tolist()
    pct24 = (c / c.shift(96) - 1).mul(100).tolist()

    day = d['date'].dt.date
    daily_high = d.groupby(day)['high'].max()
    thr20 = daily_high.rolling(20).max().shift(1)
    thr_map = thr20.to_dict()
    breakout = [c.iloc[i] > thr_map[day.iloc[i]] if pd.notna(thr_map.get(day.iloc[i])) else False
                for i in range(len(d))]

    dates = d['date'].tolist()
    dctx = bt1h.load_daily_ctx(pair)
    t4, f4 = bt1h.load_4h_flag(pair)
    uniq_days = sorted(set(day))
    prev_day = dict(zip(uniq_days[1:], uniq_days[:-1]))

    n = len(d)
    bull, macd, atr_arr, gate = [False] * n, [False] * n, [np.nan] * n, [False] * n
    for i in range(n):
        pd_ = prev_day.get(day[i])
        if pd_ is None:
            continue
        ctx = dctx.get(pd_)
        if ctx:
            bull[i], macd[i], atr_arr[i] = ctx['bull'], ctx['macd'], ctx['atr']
        gate[i] = btc_gate.get(pd_, False)

    j = 0
    flag4 = [False] * n
    for i in range(n):
        t = dates[i]
        while j < len(t4) and t4[j] + pd.Timedelta(hours=4) <= t:
            j += 1
        flag4[i] = f4[j - 1] if j > 0 else False

    return {'date': dates, 'open': d['open'].tolist(), 'high': h.tolist(),
            'low': l.tolist(), 'close': c.tolist(), 'vr': vr, 'pct24': pct24,
            'breakout': breakout, 'bull': bull, 'macd': macd, 'flag4': flag4,
            'gate': gate, 'atr': atr_arr, 'year': d['date'].dt.year.tolist()}


def candidates_of(f):
    """粗筛: 门控+三背景+数值有效的bar, 大幅减少逐配置扫描量"""
    out = []
    for i in range(200 * 4, len(f['close'])):
        if f['gate'][i] and f['bull'][i] and f['macd'][i] and f['flag4'][i] \
                and f['vr'][i] is not None and pd.notna(f['vr'][i]) and pd.notna(f['pct24'][i]):
            out.append(i)
    return out


def gen_signals_15m(f, cands, cfg):
    """cfg: events('E1E2'/'E1'), vr_th, pct_th, cooldown_bars"""
    idxs = []
    cooldown_until = -1
    for i in cands:
        if i <= cooldown_until:
            continue
        if f['vr'][i] < cfg['vr_th'] or f['pct24'][i] < cfg['pct_th']:
            continue
        if cfg['events'] == 'E1' and not f['breakout'][i]:
            continue
        idxs.append(i)
        cooldown_until = i + cfg['cooldown_bars']
    return idxs


def simulate_15m(f, idxs, sl_mult, rr):
    trades = []
    n = len(f['close'])
    for i in idxs:
        e = i + 1
        if e >= n:
            continue
        entry = f['open'][e]
        atr = f['atr'][i]
        if not entry or entry <= 0 or pd.isna(atr) or atr <= 0:
            continue
        sl_pct = min(max(sl_mult * atr / entry, 0.02), 0.15)
        tp_pct = sl_pct * rr
        stop, target = entry * (1 - sl_pct), entry * (1 + tp_pct)
        exit_price, exit_j, reason = None, None, None
        end = min(e + EXPIRE_BARS, n)
        for j in range(e, end):
            lo, hi = f['low'][j], f['high'][j]
            if lo <= stop:
                exit_price, exit_j, reason = stop, j, 'stop'; break
            if hi >= target:
                exit_price, exit_j, reason = target, j, 'target'; break
        if exit_price is None:
            j = end - 1
            exit_price, exit_j, reason = f['close'][j], j, 'expire'
        gross = exit_price / entry - 1
        net = gross - 2 * FEE
        notional = min(RISK_PCT / sl_pct, NOTIONAL_CAP)
        trades.append({'i': i, 'year': f['year'][i], 'hold_h': (exit_j - e) / 4.0,
                       'reason': reason, 'net_pct': net * 100, 'pnl': net * notional * 100})
    return trades


def simulate_exec15(f1h_sig, f15, pair, idxs_1h, sl_mult, rr):
    """模式B: 1H信号, 15m执行. 1H信号bar收盘后, 首根15m(=该1H收盘时刻)开盘入场"""
    # 1H信号时刻 = bar open + 1h; 对应15m bar open = 该时刻
    t2i = {t: i for i, t in enumerate(f15['date'])}
    trades = []
    n15 = len(f15['close'])
    for i in idxs_1h:
        t_entry = f1h_sig['date'][i] + pd.Timedelta(hours=1)
        e = t2i.get(t_entry)
        if e is None or e >= n15:
            continue
        entry = f15['open'][e]
        atr = f1h_sig['atr'][i]
        if not entry or entry <= 0 or pd.isna(atr) or atr <= 0:
            continue
        sl_pct = min(max(sl_mult * atr / entry, 0.02), 0.15)
        tp_pct = sl_pct * rr
        stop, target = entry * (1 - sl_pct), entry * (1 + tp_pct)
        exit_price, exit_j, reason = None, None, None
        end = min(e + EXPIRE_BARS, n15)
        for j in range(e, end):
            lo, hi = f15['low'][j], f15['high'][j]
            if lo <= stop:
                exit_price, exit_j, reason = stop, j, 'stop'; break
            if hi >= target:
                exit_price, exit_j, reason = target, j, 'target'; break
        if exit_price is None:
            j = end - 1
            exit_price, exit_j, reason = f15['close'][j], j, 'expire'
        gross = exit_price / entry - 1
        net = gross - 2 * FEE
        notional = min(RISK_PCT / sl_pct, NOTIONAL_CAP)
        trades.append({'year': f1h_sig['year'][i], 'hold_h': (exit_j - e) / 4.0,
                       'reason': reason, 'net_pct': net * 100, 'pnl': net * notional * 100})
    return trades


def stats(trades):
    if not trades:
        return None
    df = pd.DataFrame(trades)
    half = len(df) // 2
    eq = (1 + df['pnl'] / 100).cumprod()
    dd = ((eq - eq.cummax()) / eq.cummax()).min() * 100
    return {'n': len(df), 'win': round((df['net_pct'] > 0).mean() * 100, 1),
            'avg_pnl': round(df['pnl'].mean(), 3), 'sum_pnl': round(df['pnl'].sum(), 1),
            'eq': round(eq.iloc[-1], 2), 'mdd': round(dd, 1),
            'win_h1': round((df['net_pct'].iloc[:half] > 0).mean() * 100, 1) if half else 0,
            'win_h2': round((df['net_pct'].iloc[half:] > 0).mean() * 100, 1) if half else 0,
            'avg_hold_h': round(df['hold_h'].mean(), 1)}


def main():
    btc_gate = bt1h.load_btc_gate()
    f15s, f1hs, cands = {}, {}, {}
    for p in TRIO:
        f15s[p] = precompute_15m(p, btc_gate)
        f1hs[p] = bt1h.precompute_coin(p, btc_gate)
        cands[p] = candidates_of(f15s[p])
        print(f'  {p}: 15m={len(f15s[p]["close"])}根, 1H={len(f1hs[p]["close"])}根, 候选bar={len(cands[p])}', flush=True)

    grid = list(itertools.product(
        ['E1E2', 'E1'], [2.0, 2.5], [3, 4], [24, 48],
        [(1.5, 0.75), (1.5, 1.0), (1.0, 0.75), (2.0, 0.75)]))

    def run_mode(mode):
        res = []
        for events, vr_th, pct_th, cd_h, (sl, rr) in grid:
            cfg = {'events': events, 'vr_th': vr_th, 'pct_th': pct_th, 'cooldown_bars': cd_h * 4}
            cfg1h = {'events': events, 'vr_th': vr_th, 'pct_th': pct_th, 'cooldown_h': cd_h}
            trades = []
            for p in TRIO:
                if mode == 'A':
                    trades += simulate_15m(f15s[p], gen_signals_15m(f15s[p], cands[p], cfg), sl, rr)
                else:
                    idxs = bt1h.gen_signals(f1hs[p], cfg1h)
                    trades += simulate_exec15(f1hs[p], f15s[p], p, idxs, sl, rr)
            s = stats(trades)
            if s:
                s.update({'events': events, 'vr': vr_th, 'pct': pct_th, 'cd_h': cd_h, 'SL': sl, 'RR': rr})
                res.append(s)
        res.sort(key=lambda r: (-r['win'], -r['avg_pnl']))
        return res

    print('\n跑模式A(15m信号+15m执行)...', flush=True)
    resA = run_mode('A')
    print('跑模式B(1H信号+15m执行)...', flush=True)
    resB = run_mode('B')

    with open(f'{OUT}/backtest_15m_report.json', 'w', encoding='utf-8') as fo:
        json.dump({'modeA_top': resA[:15], 'modeB_top': resB[:15]}, fo, ensure_ascii=False, indent=2)

    for name, res in (('模式A: 15m信号+15m执行', resA), ('模式B: 1H信号+15m执行', resB)):
        print(f'\n===== {name} TOP10 (共{len(res)}组) =====')
        print(f"{'事件':5s} {'vr':>4s} {'涨幅':>4s} {'冷却h':>5s} {'SL':>4s} {'RR':>5s} "
              f"{'n':>5s} {'胜率':>6s} {'H1':>5s} {'H2':>5s} {'单均':>8s} {'净值':>7s} {'回撤':>6s} {'均持h':>6s}")
        for r in res[:10]:
            print(f"{r['events']:5s} {r['vr']:4.1f} {r['pct']:4d} {r['cd_h']:5d} {r['SL']:4.1f} {r['RR']:5.2f} "
                  f"{r['n']:5d} {r['win']:5.1f}% {r['win_h1']:5.1f} {r['win_h2']:5.1f} "
                  f"{r['avg_pnl']:+8.3f} {r['eq']:6.2f}x {r['mdd']:5.1f}% {r['avg_hold_h']:6.1f}")

    # 各模式TOP1分币分年
    for name, res, mode in (('A', resA, 'A'), ('B', resB, 'B')):
        if not res:
            continue
        best = res[0]
        cfg = {'events': best['events'], 'vr_th': best['vr'], 'pct_th': best['pct'], 'cooldown_bars': best['cd_h'] * 4}
        cfg1h = {'events': best['events'], 'vr_th': best['vr'], 'pct_th': best['pct'], 'cooldown_h': best['cd_h']}
        all_t = []
        for p in TRIO:
            if mode == 'A':
                ts = simulate_15m(f15s[p], gen_signals_15m(f15s[p], cands[p], cfg), best['SL'], best['RR'])
            else:
                idxs = bt1h.gen_signals(f1hs[p], cfg1h)
                ts = simulate_exec15(f1hs[p], f15s[p], p, idxs, best['SL'], best['RR'])
            all_t += [dict(t, pair=p) for t in ts]
        df = pd.DataFrame(all_t)
        print(f'\n===== 模式{name} TOP1 分币 =====')
        for p, sub in df.groupby('pair'):
            w = (sub['net_pct'] > 0).mean() * 100
            print(f"  {p}: n={len(sub):3d} 胜率={w:5.1f}% 单均={sub['pnl'].mean():+.3f}% 累计={sub['pnl'].sum():+.1f}%")
        print(f'===== 模式{name} TOP1 分年 =====')
        for y, sub in df.groupby('year'):
            w = (sub['net_pct'] > 0).mean() * 100
            print(f"  {y}: n={len(sub):4d} 胜率={w:5.1f}% 单均={sub['pnl'].mean():+.3f}%")


if __name__ == '__main__':
    main()
