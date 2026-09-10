#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v2.1 优化实验: 多空策略分离 + 网格搜索胜率>=60%配置
====================================================
核心思路:
1. LONG/SHORT 完全拆成两个独立策略(独立信号/冷却/几何参数)
2. 胜率两大杠杆同时搜:
   - 信号过滤: 事件组合/背景条件数/门控强度/币种趋势/RSI上限
   - TP/SL几何: SL倍数 × 盈亏比RR (RR越小胜率越高, 但要防"高胜率负期望"陷阱)
3. 防过拟合: 要求 n>=150 + 前后半段胜率都>=55%(稳定性)
输出: data/crypto/optimize_v21_report.json + 终端TOP榜
"""
import json
import os
import itertools
import numpy as np
import pandas as pd

BASE = '/Users/mlamp/WorkBuddy/2026-08-24-16-17-11'
CACHE = f'{BASE}/data/crypto/cache'
OUT = f'{BASE}/data/crypto'

PAIRS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT',
         'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT', 'MATICUSDT', 'LTCUSDT',
         'UNIUSDT', 'ATOMUSDT', 'NEARUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT',
         'SUIUSDT', 'SEIUSDT', 'TONUSDT', 'PEPEUSDT', 'SHIBUSDT', 'WIFUSDT',
         'FETUSDT', 'RNDRUSDT', 'INJUSDT']

FEE = 0.001
RISK_PCT = 0.03
NOTIONAL_CAP = 1.0
MAX_HOLD = 7
COOLDOWN = 2


def load_coin(pair):
    d = pd.read_csv(f'{CACHE}/{pair}_1d.csv', parse_dates=['date']).sort_values('date').reset_index(drop=True)
    c, v, h, l = d['close'], d['volume'], d['high'], d['low']
    sma5, sma20, sma60 = c.rolling(5).mean(), c.rolling(20).mean(), c.rolling(60).mean()
    ema12, ema26 = c.ewm(span=12, adjust=False).mean(), c.ewm(span=26, adjust=False).mean()
    dif = ema12 - ema26
    dea = dif.ewm(span=9, adjust=False).mean()
    delta = c.diff()
    up = delta.clip(lower=0).ewm(alpha=1/14, adjust=False).mean()
    dn = (-delta.clip(upper=0)).ewm(alpha=1/14, adjust=False).mean()
    rsi = 100 - 100 / (1 + up / dn.replace(0, np.nan))
    vma20 = v.rolling(20).mean()
    std20 = c.rolling(20).std()
    boll_up = sma20 + 2 * std20
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1/14, adjust=False).mean()
    pct = (c / c.shift() - 1) * 100
    vr = v / vma20
    h20 = h.rolling(20).max().shift()   # 前20日最高(不含当日)
    l20 = l.rolling(20).min().shift()
    breakout = c > h20
    breakdown = c < l20

    feats = {
        'date': d['date'].dt.date.tolist(),
        'year': d['date'].dt.year.tolist(),
        'close': c.tolist(), 'high': h.tolist(), 'low': l.tolist(),
        'atr': atr.tolist(), 'pct': pct.tolist(), 'vr': vr.tolist(),
        'breakout': breakout.tolist(), 'breakdown': breakdown.tolist(),
        'rsi': rsi.tolist(), 'boll_break': (c > boll_up).tolist(),
        'above_sma60': (c > sma60).tolist(),
        'bg1': (sma5 > sma20).where(sma20.notna() & sma60.notna() & (sma60 > sma20), False).fillna(False).tolist(),
        # bg1严格版: 多头排列
        'bull_align': ((sma5 > sma20) & (sma20 > sma60)).fillna(False).tolist(),
        'macd_up': (dif > dea).fillna(False).tolist(),
    }
    # 4H背景: 当日最后一根4H的 sma5>sma20
    d4 = pd.read_csv(f'{CACHE}/{pair}_4h.csv', parse_dates=['date']).sort_values('date')
    d4['sma5'] = d4['close'].rolling(5).mean()
    d4['sma20'] = d4['close'].rolling(20).mean()
    d4['day'] = d4['date'].dt.date
    l4 = d4.groupby('day').tail(1).set_index('day')
    feats['bg_4h'] = [(day in l4.index and pd.notna(l4.loc[day, 'sma5']) and
                       pd.notna(l4.loc[day, 'sma20']) and l4.loc[day, 'sma5'] > l4.loc[day, 'sma20'])
                      for day in feats['date']]
    return feats


def load_btc_env():
    btc = pd.read_csv(f'{CACHE}/BTCUSDT_1d.csv', parse_dates=['date']).sort_values('date').reset_index(drop=True)
    sma20 = btc['close'].rolling(20).mean()
    ratio = btc['close'] / sma20
    slope = sma20 - sma20.shift(5)
    return {day: {'ratio': r, 'slope_up': s > 0}
            for day, r, s in zip(btc['date'].dt.date, ratio, slope) if pd.notna(r) and pd.notna(s)}


ENV = load_btc_env()
GATES = {
    'hard': lambda e: e['ratio'] > 1.0,
    'strong': lambda e: e['ratio'] > 1.03,
    'strong_slope': lambda e: e['ratio'] > 1.03 and e['slope_up'],
}


def simulate(f, idxs, sl_mult, rr, direction='long'):
    """入场=信号次日收盘; 止损=sl_mult*ATR(钳制2%-15%); 止盈=sl*rr; 7天到期"""
    trades = []
    close, high, low, atr = f['close'], f['high'], f['low'], f['atr']
    n = len(close)
    for i in idxs:
        if i + 2 >= n:
            continue
        entry = close[i + 1]
        a = atr[i]
        if not entry or entry <= 0 or pd.isna(a) or a <= 0:
            continue
        sl_pct = min(max(sl_mult * a / entry, 0.02), 0.15)
        tp_pct = sl_pct * rr
        if direction == 'long':
            stop, target = entry * (1 - sl_pct), entry * (1 + tp_pct)
        else:
            stop, target = entry * (1 + sl_pct), entry * (1 - tp_pct)
        exit_price, exit_j, reason = None, None, None
        for j in range(i + 2, min(i + 2 + MAX_HOLD, n)):
            hi, lo = high[j], low[j]
            if direction == 'long':
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
            j = min(i + 1 + MAX_HOLD, n - 1)
            exit_price, exit_j, reason = close[j], j, 'expire'
        gross = (exit_price / entry - 1) * (1 if direction == 'long' else -1)
        net = gross - 2 * FEE
        notional = min(RISK_PCT / sl_pct, NOTIONAL_CAP)
        trades.append({'i': i, 'year': f['year'][i], 'net_pct': net * 100,
                       'pnl': net * notional * 100, 'reason': reason})
    return trades


def stats(trades):
    if not trades:
        return None
    df = pd.DataFrame(trades)
    win = (df['net_pct'] > 0).mean() * 100
    pnl = df['pnl']
    eq = (1 + pnl / 100).cumprod()
    dd = ((eq - eq.cummax()) / eq.cummax()).min() * 100
    half = len(df) // 2
    w1 = (df['net_pct'].iloc[:half] > 0).mean() * 100 if half else 0
    w2 = (df['net_pct'].iloc[half:] > 0).mean() * 100 if half else 0
    return {'n': len(df), 'win': round(win, 1), 'avg_pnl': round(pnl.mean(), 3),
            'sum_pnl': round(pnl.sum(), 1), 'eq': round(eq.iloc[-1], 2),
            'mdd': round(dd, 1), 'win_h1': round(w1, 1), 'win_h2': round(w2, 1)}


def gen_long_signals(f, cfg):
    """cfg: events, bg_min, gate, need_sma60, rsi_cap"""
    idxs = []
    cooldown = -1
    for i in range(60, len(f['close'])):
        if i <= cooldown:
            continue
        pct, vr = f['pct'][i], f['vr'][i]
        if pd.isna(pct) or pd.isna(vr):
            continue
        day = f['date'][i]
        e = ENV.get(day)
        if e is None or not GATES[cfg['gate']](e):
            continue
        if cfg['need_sma60'] and not f['above_sma60'][i]:
            continue
        rsi = f['rsi'][i]
        if cfg['rsi_cap'] and pd.notna(rsi) and rsi > cfg['rsi_cap']:
            continue
        bg = sum([f['bull_align'][i], f['macd_up'][i], f['bg_4h'][i]])
        if bg < cfg['bg_min']:
            continue
        evt = None
        if vr > 2 and pct > 3 and f['breakout'][i]:
            evt = 'E1'
        elif vr > 2 and pct > 3:
            evt = 'E2'
        elif f['breakout'][i] and pct > 2:
            evt = 'E3'
        if evt is None or evt not in cfg['events']:
            continue
        idxs.append(i)
        cooldown = i + COOLDOWN
    return idxs


def gen_short_signals(f, cfg):
    """S1过热反转变体: pct_min/rsi_min/需布林破轨/需量能/门控(BTC弱时才空?)"""
    idxs = []
    cooldown = -1
    for i in range(60, len(f['close'])):
        if i <= cooldown:
            continue
        pct = f['pct'][i]
        if pd.isna(pct) or pct < cfg['pct_min']:
            continue
        rsi = f['rsi'][i]
        cond_rsi = pd.notna(rsi) and rsi > cfg['rsi_min']
        cond_boll = f['boll_break'][i]
        if cfg['confirm'] == 'any' and not (cond_rsi or cond_boll):
            continue
        if cfg['confirm'] == 'rsi' and not cond_rsi:
            continue
        if cfg['confirm'] == 'both' and not (cond_rsi and cond_boll):
            continue
        if cfg['need_vol'] and not (pd.notna(f['vr'][i]) and f['vr'][i] > 2.5):
            continue
        day = f['date'][i]
        e = ENV.get(day)
        if e is not None and cfg['gate'] == 'btc_weak' and e['ratio'] > 1.0:
            continue
        idxs.append(i)
        cooldown = i + COOLDOWN
    return idxs


def main():
    all_feats = {}
    for p in PAIRS:
        if os.path.exists(f'{CACHE}/{p}_1d.csv') and os.path.exists(f'{CACHE}/{p}_4h.csv'):
            all_feats[p] = load_coin(p)
    print(f'币种: {len(all_feats)}')

    # ---------- LONG 网格 ----------
    long_grid = list(itertools.product(
        [('E1', 'E2', 'E3'), ('E1', 'E2'), ('E2',), ('E1',)],   # events
        [2, 3],                                                   # bg_min
        ['hard', 'strong', 'strong_slope'],                       # gate
        [True, False],                                            # need_sma60
        [None, 75],                                               # rsi_cap
        [(2.0, 2.0), (2.0, 1.0), (2.0, 0.75), (2.5, 1.0), (1.5, 1.0), (1.5, 0.75)],  # (SL, RR)
    ))
    long_results = []
    sig_cache = {}
    for events, bg_min, gate, need60, rsi_cap, (sl, rr) in long_grid:
        cfg = {'events': events, 'bg_min': bg_min, 'gate': gate,
               'need_sma60': need60, 'rsi_cap': rsi_cap}
        trades = []
        for p, f in all_feats.items():
            key = (events, bg_min, gate, need60, rsi_cap)
            if key not in sig_cache:
                sig_cache[key] = {pp: gen_long_signals(ff, cfg) for pp, ff in all_feats.items()}
            trades += simulate(f, sig_cache[key][p], sl, rr, 'long')
        s = stats(trades)
        if s:
            s.update({'events': '+'.join(events), 'bg': bg_min, 'gate': gate,
                      'sma60': need60, 'rsi_cap': rsi_cap, 'SL': sl, 'RR': rr})
            long_results.append(s)

    # ---------- SHORT 网格 (独立策略) ----------
    short_grid = list(itertools.product(
        [10, 12],                  # pct_min
        [75, 80],                  # rsi_min
        ['any', 'rsi', 'both'],    # confirm
        [False, True],             # need_vol
        ['any', 'btc_weak'],       # gate
        [(2.0, 1.0), (1.5, 1.0), (2.0, 0.75), (1.5, 0.75)],  # (SL, RR)
    ))
    short_results = []
    for pct_min, rsi_min, confirm, need_vol, gate, (sl, rr) in short_grid:
        cfg = {'pct_min': pct_min, 'rsi_min': rsi_min, 'confirm': confirm,
               'need_vol': need_vol, 'gate': gate}
        trades = []
        for p, f in all_feats.items():
            idxs = gen_short_signals(f, cfg)
            trades += simulate(f, idxs, sl, rr, 'short')
        s = stats(trades)
        if s:
            s.update({'pct_min': pct_min, 'rsi_min': rsi_min, 'confirm': confirm,
                      'need_vol': need_vol, 'gate': gate, 'SL': sl, 'RR': rr})
            short_results.append(s)

    # ---------- 输出 ----------
    lr = [r for r in long_results if r['n'] >= 150 and r['win'] >= 55 and r['win_h1'] >= 52 and r['win_h2'] >= 52]
    lr.sort(key=lambda r: (-r['win'], -r['avg_pnl']))
    sr = [r for r in short_results if r['n'] >= 100]
    sr.sort(key=lambda r: (-r['win'], -r['avg_pnl']))

    with open(f'{OUT}/optimize_v21_report.json', 'w', encoding='utf-8') as fo:
        json.dump({'long_top': lr[:30], 'short_top': sr[:20],
                   'long_all_count': len(long_results), 'short_all_count': len(short_results)},
                  fo, ensure_ascii=False, indent=2)

    print(f'\n===== LONG 合格配置(胜率>=55 & 前后半段均>=52 & n>=150): {len(lr)}/{len(long_results)} =====')
    print(f"{'事件':8s} {'bg':>3s} {'门控':13s} {'SMA60':>5s} {'RSI上限':>6s} {'SL':>4s} {'RR':>5s} "
          f"{'n':>5s} {'胜率':>6s} {'H1胜':>5s} {'H2胜':>5s} {'单均':>7s} {'净值':>7s} {'回撤':>6s}")
    for r in lr[:15]:
        print(f"{r['events']:8s} {r['bg']:3d} {r['gate']:13s} {str(r['sma60']):>5s} "
              f"{str(r['rsi_cap']):>6s} {r['SL']:4.1f} {r['RR']:5.2f} "
              f"{r['n']:5d} {r['win']:5.1f}% {r['win_h1']:5.1f} {r['win_h2']:5.1f} "
              f"{r['avg_pnl']:+7.3f} {r['eq']:6.2f}x {r['mdd']:5.1f}%")

    print(f'\n===== SHORT TOP10 (n>=100) =====')
    print(f"{'涨幅>':>5s} {'RSI>':>5s} {'确认':>6s} {'量能':>4s} {'门控':>9s} {'SL':>4s} {'RR':>5s} "
          f"{'n':>5s} {'胜率':>6s} {'单均':>8s} {'净值':>7s}")
    for r in sr[:10]:
        print(f"{r['pct_min']:5d} {r['rsi_min']:5d} {r['confirm']:>6s} {str(r['need_vol']):>4s} "
              f"{r['gate']:>9s} {r['SL']:4.1f} {r['RR']:5.2f} "
              f"{r['n']:5d} {r['win']:5.1f}% {r['avg_pnl']:+8.3f} {r['eq']:6.2f}x")


if __name__ == '__main__':
    main()
