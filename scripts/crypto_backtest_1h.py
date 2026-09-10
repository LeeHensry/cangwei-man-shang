#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v2.2 1H粒度回测: 8币(BTC/ETH/SOL/BCH/LTC/LINK/XRP/ADA)
=====================================================
信号语义(与日线版同构, 但逐1H K线评估):
  pct24   = 当前价 / 24h前价 - 1        (滚动24h涨幅)
  vr      = 当前1H成交量 / 同小时过去14天均值  (同小时基线, 消除日内季节性)
  breakout= close > 前20个已完成UTC日的最高价
  事件: E1 = vr>th & pct24>pct_th & breakout
        E2 = vr>th & pct24>pct_th
  背景(用上一已完成UTC日的日线指标): 日线多头排列 / MACD多头 / 4H SMA5>SMA20
  门控(strong_slope): BTC上一完成日 close>SMA20*1.03 且 SMA20上行
  冷却: 同币信号后 cooldown 小时内不再发信号

交易: 信号K线收盘判定 → 下一根1H开盘入场 → 逐1H检查SL/TP(先止损,保守)
      → SL=2×日ATR14(钳制2%-15%) / TP=0.75×SL / 7天(168根)到期平仓
      → 手续费单边0.1%; 风险预算3%净值, 名义敞口=3%/sl_pct 封顶100%
网格: 事件组合 × vr阈值 × 涨幅阈值 × 冷却时长 × (SL,RR) = 72组
输出: data/crypto/backtest_1h_report.json + 终端TOP榜(含分币/分年拆解)
"""
import json
import os
import itertools
import numpy as np
import pandas as pd

BASE = '/Users/mlamp/WorkBuddy/2026-08-24-16-17-11'
CACHE = f'{BASE}/data/crypto/cache'
OUT = f'{BASE}/data/crypto'

PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BCHUSDT', 'LTCUSDT',
         'LINKUSDT', 'XRPUSDT', 'ADAUSDT']

FEE = 0.001
RISK_PCT = 0.03
NOTIONAL_CAP = 1.0
EXPIRE_BARS = 7 * 24   # 168根1H = 7天


def load_1h(pair):
    d = pd.read_csv(f'{CACHE}/{pair}_1h.csv', parse_dates=['date'])
    d = d.sort_values('date').reset_index(drop=True)
    c, h, l, v = d['close'], d['high'], d['low'], d['volume']
    # 同小时14天基线量比(消除日内季节性): 按小时分组, 组内按时间滚动
    hour = d['date'].dt.hour
    df = pd.DataFrame({'date': d['date'], 'hour': hour, 'v': v}).sort_values('date').reset_index(drop=True)
    v_base = pd.Series(np.nan, index=df.index)
    for hh, g in df.groupby('hour'):
        v_base.loc[g.index] = g['v'].rolling(14, min_periods=7).mean().shift(1)
    vr = v / v_base

    pct24 = c / c.shift(24) - 1

    # 前20个已完成UTC日最高价 → 映射到每小时
    day = d['date'].dt.date
    daily_high = d.groupby(day)['high'].max()
    thr20 = daily_high.rolling(20).max().shift(1)   # shift1: 不含当日
    thr_map = thr20.to_dict()
    breakout = [c.iloc[i] > thr_map[day.iloc[i]] if day.iloc[i] in thr_map and pd.notna(thr_map[day.iloc[i]]) else False
                for i in range(len(d))]

    feats = {
        'date': d['date'].tolist(), 'day': day.tolist(),
        'open': d['open'].tolist(), 'high': h.tolist(), 'low': l.tolist(),
        'close': c.tolist(), 'vr': vr.tolist(), 'pct24': (pct24 * 100).tolist(),
        'breakout': breakout, 'year': d['date'].dt.year.tolist(),
    }
    return feats


def load_daily_ctx(pair):
    """日线指标(多头排列/MACD/ATR) 按 日 提供"""
    d = pd.read_csv(f'{CACHE}/{pair}_1d.csv', parse_dates=['date']).sort_values('date').reset_index(drop=True)
    c = d['close']
    sma5, sma20, sma60 = c.rolling(5).mean(), c.rolling(20).mean(), c.rolling(60).mean()
    ema12, ema26 = c.ewm(span=12, adjust=False).mean(), c.ewm(span=26, adjust=False).mean()
    dif = ema12 - ema26
    dea = dif.ewm(span=9, adjust=False).mean()
    tr = pd.concat([d['high'] - d['low'], (d['high'] - c.shift()).abs(),
                    (d['low'] - c.shift()).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1/14, adjust=False).mean()
    m = {}
    for i in range(len(d)):
        day = d['date'].iloc[i].date()
        m[day] = {
            'bull': pd.notna(sma60.iloc[i]) and sma5.iloc[i] > sma20.iloc[i] > sma60.iloc[i],
            'macd': pd.notna(dea.iloc[i]) and dif.iloc[i] > dea.iloc[i],
            'atr': atr.iloc[i],
        }
    return m


def load_4h_flag(pair):
    """4H SMA5>SMA20 按 4H bar open_time 提供"""
    d4 = pd.read_csv(f'{CACHE}/{pair}_4h.csv', parse_dates=['date']).sort_values('date').reset_index(drop=True)
    s5, s20 = d4['close'].rolling(5).mean(), d4['close'].rolling(20).mean()
    flag = (s5 > s20)
    times = d4['date'].tolist()
    return times, flag.fillna(False).tolist()


def load_btc_gate():
    d = pd.read_csv(f'{CACHE}/BTCUSDT_1d.csv', parse_dates=['date']).sort_values('date').reset_index(drop=True)
    sma20 = d['close'].rolling(20).mean()
    slope = sma20 - sma20.shift(5)
    return {d['date'].iloc[i].date(): bool(d['close'].iloc[i] > sma20.iloc[i] * 1.03 and slope.iloc[i] > 0)
            for i in range(len(d)) if pd.notna(sma20.iloc[i]) and pd.notna(slope.iloc[i])}


def precompute_coin(pair, btc_gate):
    """把信号所需的一切预计算成逐小时数组(用上一完成日指标, 无未来函数)"""
    f = load_1h(pair)
    dctx = load_daily_ctx(pair)
    t4, f4 = load_4h_flag(pair)
    n = len(f['date'])
    days = f['day']
    dates = f['date']

    # 日线ctx用上一完成日: day[i]的前一个出现过的交易日
    uniq_days = sorted(set(days))
    prev_day = {}
    for a, b in zip(uniq_days, uniq_days[1:]):
        prev_day[b] = a
    bull_arr, macd_arr, atr_arr = [False] * n, [False] * n, [np.nan] * n
    for i in range(n):
        pd_ = prev_day.get(days[i])
        if pd_ is None:
            continue
        ctx = dctx.get(pd_)
        if ctx:
            bull_arr[i], macd_arr[i], atr_arr[i] = ctx['bull'], ctx['macd'], ctx['atr']

    # 4H flag: 每个1H时刻取最后"已完结"的4H bar(open+4h <= t)
    j = 0
    flag4 = [False] * n
    for i in range(n):
        t = dates[i]
        while j < len(t4) and t4[j] + pd.Timedelta(hours=4) <= t:
            j += 1
        flag4[i] = f4[j - 1] if j > 0 else False

    gate_arr = [btc_gate.get(prev_day.get(days[i]), False) for i in range(n)]
    f['bull'], f['macd'], f['flag4'], f['gate'], f['atr'] = bull_arr, macd_arr, flag4, gate_arr, atr_arr
    return f


def gen_signals(f, cfg):
    idxs = []
    cooldown_until = -1
    for i in range(200, len(f['close'])):
        if i <= cooldown_until:
            continue
        vr, pct = f['vr'][i], f['pct24'][i]
        if pd.isna(vr) or pd.isna(pct):
            continue
        if not f['gate'][i]:
            continue
        if not (f['bull'][i] and f['macd'][i] and f['flag4'][i]):   # 三背景全要
            continue
        if vr < cfg['vr_th'] or pct < cfg['pct_th']:
            continue
        if cfg['events'] == 'E1' and not f['breakout'][i]:
            continue
        idxs.append(i)
        cooldown_until = i + cfg['cooldown_h']
    return idxs


def simulate(f, idxs, sl_mult, rr):
    trades = []
    n = len(f['close'])
    for i in idxs:
        if i + 1 >= n:
            continue
        entry = f['open'][i + 1]      # 下一根1H开盘入场
        atr = f['atr'][i]
        if not entry or entry <= 0 or pd.isna(atr) or atr <= 0:
            continue
        sl_pct = min(max(sl_mult * atr / entry, 0.02), 0.15)
        tp_pct = sl_pct * rr
        stop, target = entry * (1 - sl_pct), entry * (1 + tp_pct)
        exit_price, exit_j, reason = None, None, None
        end = min(i + 1 + EXPIRE_BARS, n)
        for j in range(i + 1, end):   # 入场K线的高低点有效(开盘入场)
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
        trades.append({'i': i, 'year': f['year'][i], 'entry_dt': str(f['date'][i]),
                       'hold_h': exit_j - (i + 1), 'reason': reason,
                       'net_pct': net * 100, 'pnl': net * notional * 100})
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
    btc_gate = load_btc_gate()
    feats = {}
    for p in PAIRS:
        ok = all(os.path.exists(f'{CACHE}/{p}_{iv}.csv') for iv in ('1d', '4h', '1h'))
        if ok:
            feats[p] = precompute_coin(p, btc_gate)
            print(f'  {p}: {len(feats[p]["close"])}根1H', flush=True)
        else:
            print(f'  {p}: 缺K线, 跳过', flush=True)
    pairs_used = list(feats.keys())

    grid = list(itertools.product(
        ['E1E2', 'E1'],      # events
        [2.0, 2.5],          # vr_th
        [3, 4],              # pct_th (%)
        [24, 48],            # cooldown_h
        [(2.0, 0.75), (2.0, 1.0), (1.5, 0.75)],   # (SL, RR)
    ))
    results = []
    for events, vr_th, pct_th, cd, (sl, rr) in grid:
        cfg = {'events': events, 'vr_th': vr_th, 'pct_th': pct_th, 'cooldown_h': cd}
        trades = []
        for p, f in feats.items():
            trades += simulate(f, gen_signals(f, cfg), sl, rr)
        s = stats(trades)
        if s:
            s.update({'events': events, 'vr': vr_th, 'pct': pct_th, 'cd_h': cd, 'SL': sl, 'RR': rr})
            results.append(s)

    results.sort(key=lambda r: (-r['win'], -r['avg_pnl']))
    with open(f'{OUT}/backtest_1h_report.json', 'w', encoding='utf-8') as fo:
        json.dump({'pairs': pairs_used, 'all': results[:40]}, fo, ensure_ascii=False, indent=2)

    print(f'\n===== 1H回测 TOP20 (共{len(results)}组) =====')
    print(f"{'事件':5s} {'vr':>4s} {'涨幅':>4s} {'冷却':>4s} {'SL':>4s} {'RR':>5s} "
          f"{'n':>5s} {'胜率':>6s} {'H1':>5s} {'H2':>5s} {'单均':>8s} {'净值':>7s} {'回撤':>6s} {'均持h':>6s}")
    for r in results[:20]:
        print(f"{r['events']:5s} {r['vr']:4.1f} {r['pct']:4d} {r['cd_h']:4d} {r['SL']:4.1f} {r['RR']:5.2f} "
              f"{r['n']:5d} {r['win']:5.1f}% {r['win_h1']:5.1f} {r['win_h2']:5.1f} "
              f"{r['avg_pnl']:+8.3f} {r['eq']:6.2f}x {r['mdd']:5.1f}% {r['avg_hold_h']:6.1f}")

    # TOP1 分币分年
    if results:
        best = results[0]
        cfg = {'events': best['events'], 'vr_th': best['vr'], 'pct_th': best['pct'], 'cooldown_h': best['cd_h']}
        trades2 = []
        for p, f in feats.items():
            for t in simulate(f, gen_signals(f, cfg), best['SL'], best['RR']):
                t['pair'] = p
                trades2.append(t)
        df = pd.DataFrame(trades2)
        for p, sub in df.groupby('pair'):
            w = (sub['net_pct'] > 0).mean() * 100
            print(f"  {p}: n={len(sub):3d} 胜率={w:5.1f}% 单均={sub['pnl'].mean():+.3f}% 累计={sub['pnl'].sum():+.1f}%")
        print(f"\n===== TOP1配置分年 =====")
        for y, sub in df.groupby('year'):
            w = (sub['net_pct'] > 0).mean() * 100
            print(f"  {y}: n={len(sub):4d} 胜率={w:5.1f}% 单均={sub['pnl'].mean():+.3f}%")


if __name__ == '__main__':
    main()
