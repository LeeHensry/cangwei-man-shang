#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
加密货币 v1 vs v2 四组对照回测（含真实持仓模拟）
================================================
组A: v1信号(总分制) + v1固定风控(5%/12%)
组B: v1信号 + ATR风控(2x/4x)          → 隔离风控改进贡献
组C: v2事件信号 + 硬门控(BTC<SMA20禁多) + ATR风控
组D: v2事件信号 + 分级门控(深熊仅E1,仓位减半) + ATR风控  ← 用户倾向

持仓模拟: 信号日收盘入场 → 逐日检查 high/low 触价(同日双触保守算止损)
          → 2xATR止损 / 4xATR止盈 / 14天到期平仓 → 单边0.1%手续费
输出: data/crypto/backtest_v2_report.json + 终端对照表
"""
import json
import os
import pandas as pd
import numpy as np

BASE = '/Users/mlamp/WorkBuddy/2026-08-24-16-17-11'
CACHE = f'{BASE}/data/crypto/cache'
OUT = f'{BASE}/data/crypto'

PAIRS_ALL = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT',
             'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT', 'MATICUSDT', 'LTCUSDT',
             'UNIUSDT', 'ATOMUSDT', 'NEARUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT',
             'SUIUSDT', 'SEIUSDT', 'TONUSDT', 'PEPEUSDT', 'SHIBUSDT', 'WIFUSDT',
             'FETUSDT', 'RNDRUSDT', 'INJUSDT']
TRIO = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']

FEE = 0.001           # 单边手续费
RISK_PCT = 0.03       # 单笔风险预算 3% 净值
LEV_CAP = 5.0         # 杠杆上限
MARGIN_PCT = 0.20     # 保证金比例(名义敞口封顶 = 净值×20%×5 = 100%)
ATR_STOP, ATR_TGT = 2.0, 4.0
MAX_HOLD = 7
COOLDOWN = 2          # 平仓后冷却天数

TH_LONG, TH_SHORT = 72, 28  # v1 阈值


def load_data(pair):
    d = pd.read_csv(f'{CACHE}/{pair}_1d.csv', parse_dates=['date'])
    d = d.sort_values('date').reset_index(drop=True)
    c, v = d['close'], d['volume']
    ind = pd.DataFrame(index=d.index)
    for p in (5, 20, 60):
        ind[f'sma{p}'] = c.rolling(p).mean()
    ind['ema12'] = c.ewm(span=12, adjust=False).mean()
    ind['ema26'] = c.ewm(span=26, adjust=False).mean()
    ind['dif'] = ind['ema12'] - ind['ema26']
    ind['dea'] = ind['dif'].ewm(span=9, adjust=False).mean()
    delta = c.diff()
    up = delta.clip(lower=0).ewm(alpha=1/14, adjust=False).mean()
    dn = (-delta.clip(upper=0)).ewm(alpha=1/14, adjust=False).mean()
    ind['rsi14'] = 100 - 100 / (1 + up / dn.replace(0, np.nan))
    ind['vol_ma20'] = v.rolling(20).mean()
    std20 = c.rolling(20).std()
    ind['boll_up'] = ind['sma20'] + 2 * std20
    tr = pd.concat([d['high'] - d['low'], (d['high'] - c.shift()).abs(),
                    (d['low'] - c.shift()).abs()], axis=1).max(axis=1)
    ind['atr14'] = tr.ewm(alpha=1/14, adjust=False).mean()
    # 4H背景
    d4 = pd.read_csv(f'{CACHE}/{pair}_4h.csv', parse_dates=['date']).sort_values('date')
    d4['sma5'] = d4['close'].rolling(5).mean()
    d4['sma20'] = d4['close'].rolling(20).mean()
    d4['day'] = d4['date'].dt.date
    l4 = d4.groupby('day').tail(1).set_index('day')[['sma5', 'sma20']]
    return d, ind, l4


def load_btc_state():
    btc = pd.read_csv(f'{CACHE}/BTCUSDT_1d.csv', parse_dates=['date']).sort_values('date')
    btc['sma20'] = btc['close'].rolling(20).mean()
    m = {}
    for _, row in btc.iterrows():
        if pd.isna(row['sma20']):
            continue
        day = row['date'].date()
        m[day] = {'ratio': row['close'] / row['sma20'],
                  'hard_ok': row['close'] > row['sma20'],
                  'tier_ok': row['close'] >= row['sma20'] * 0.97}
    return m


def gen_signals(pair, d, ind, l4, btc_state):
    """逐日生成两类信号清单: v1(总分) 与 v2(事件)"""
    v1, v2 = [], []
    cooldown_until = -1
    for i in range(60, len(d)):
        day = d['date'].iloc[i].date()
        c = d['close'].iloc[i]
        prev_c = d['close'].iloc[i - 1]
        pct = (c / prev_c - 1) * 100
        bs = btc_state.get(day, {})

        # ---------- v1 总分(复刻binance.js, 4H均线±8) ----------
        lp = sp = 0
        s5, s20, s60 = ind['sma5'].iloc[i], ind['sma20'].iloc[i], ind['sma60'].iloc[i]
        if all(pd.notna(x) for x in (s5, s20, s60)):
            if s5 > s20 > s60:
                lp += 15
            elif s5 < s20 < s60:
                sp += 15
        if day in l4.index:
            s5h, s20h = l4.loc[day, 'sma5'], l4.loc[day, 'sma20']
            if pd.notna(s5h) and pd.notna(s20h):
                lp += 8 if s5h > s20h else 0
                sp += 0 if s5h > s20h else 8
        dif, dea = ind['dif'].iloc[i], ind['dea'].iloc[i]
        if pd.notna(dif) and pd.notna(dea):
            lp += 8 if dif > dea else 0
            sp += 0 if dif > dea else 8
        rsi = ind['rsi14'].iloc[i]
        if pd.notna(rsi):
            if rsi < 30:
                lp += 12
            elif rsi > 75:
                sp += 12
            elif 50 < rsi < 65:
                lp += 4
        if i >= 21:
            h20 = d['high'].iloc[i-20:i].max()
            l20 = d['low'].iloc[i-20:i].min()
            if c > h20 and pct > 2:
                lp += 10
            if c < l20 and pct < -3:
                sp += 10
        vma20 = ind['vol_ma20'].iloc[i]
        vr = d['volume'].iloc[i] / vma20 if pd.notna(vma20) and vma20 > 0 else 0
        if vr > 2 and pct > 3:
            lp += 8
        elif vr > 2 and pct < -5:
            sp += 8
        if pd.notna(ind['boll_up'].iloc[i]) and c > ind['boll_up'].iloc[i]:
            sp += 5
        if pct > 10:
            sp += 8
        if pct < -10:
            lp += 6
        total = max(0, min(100, 50 + lp - sp))
        if total >= TH_LONG:
            v1.append({'i': i, 'dir': 'long'})
        elif total <= TH_SHORT:
            v1.append({'i': i, 'dir': 'short'})

        # ---------- v2 事件 ----------
        if i < cooldown_until:
            continue
        bg_flags = [
            (s5 > s20 > s60) if all(pd.notna(x) for x in (s5, s20, s60)) else False,
            pd.notna(dif) and pd.notna(dea) and dif > dea,
            day in l4.index and pd.notna(l4.loc[day, 'sma5']) and
            pd.notna(l4.loc[day, 'sma20']) and l4.loc[day, 'sma5'] > l4.loc[day, 'sma20'],
        ]
        bg_count = sum(bg_flags)
        breakout = i >= 21 and c > d['high'].iloc[i-20:i].max()
        if bs.get('tier_ok', False):
            long_zone, half = True, False
        elif bs.get('hard_ok', False):
            long_zone, half = True, False  # 硬门控视角: >SMA20即可
        else:
            long_zone, half = False, False
        deep_bear = not bs.get('tier_ok', False)

        long_evt = None
        if vr > 2 and pct > 3 and breakout:
            long_evt = 'E1'
        elif vr > 2 and pct > 3:
            long_evt = 'E2'
        elif breakout and pct > 2:
            long_evt = 'E3'
        if long_evt and (bg_count >= (1 if long_evt == 'E1' else 2)):
            # 分级门控: 深熊只允许E1; 硬门控: 深熊全禁
            if deep_bear:
                long_evt = 'E1' if long_evt == 'E1' else None
            if long_evt:
                v2.append({'i': i, 'dir': 'long', 'evt': long_evt, 'half': deep_bear})
                cooldown_until = i + COOLDOWN
                continue
        # SHORT: S1 过热反转
        if pct > 10 and (pd.notna(rsi) and rsi > 75 or
                         (pd.notna(ind['boll_up'].iloc[i]) and c > ind['boll_up'].iloc[i])):
            v2.append({'i': i, 'dir': 'short', 'evt': 'S1', 'half': False})
            cooldown_until = i + COOLDOWN
    return v1, v2


def simulate(pair, d, ind, sigs, mode, half_ok=True):
    """持仓模拟. mode='v1'(固定5%/12%) 或 'atr'(2x/4x ATR)"""
    trades = []
    busy_until = -1
    for s in sigs:
        i, dr = s['i'], s['dir']
        if i <= busy_until or i + 1 >= len(d) - 1:
            continue
        entry = d['close'].iloc[i + 1]  # 次日收盘入场(信号日收盘后决策)
        atr = ind['atr14'].iloc[i]
        if mode == 'v1':
            sl_pct, tp_pct = 0.05, 0.12
        else:
            if pd.isna(atr) or atr <= 0:
                continue
            sl_pct = min(max(ATR_STOP * atr / entry, 0.02), 0.15)
            tp_pct = sl_pct * 2
        stop = entry * (1 - sl_pct) if dr == 'long' else entry * (1 + sl_pct)
        target = entry * (1 + tp_pct) if dr == 'long' else entry * (1 - tp_pct)
        exit_price, exit_day, reason = None, None, None
        for j in range(i + 2, min(i + 2 + MAX_HOLD, len(d))):
            hi, lo = d['high'].iloc[j], d['low'].iloc[j]
            if dr == 'long':
                if lo <= stop:
                    exit_price, exit_day, reason = stop, j, 'stop'
                    break
                if hi >= target:
                    exit_price, exit_day, reason = target, j, 'target'
                    break
            else:
                if hi >= stop:
                    exit_price, exit_day, reason = stop, j, 'stop'
                    break
                if lo <= target:
                    exit_price, exit_day, reason = target, j, 'target'
                    break
        if exit_price is None:
            j = min(i + 1 + MAX_HOLD, len(d) - 1)
            exit_price, exit_day, reason = d['close'].iloc[j], j, 'expire'
        gross = (exit_price / entry - 1) * (1 if dr == 'long' else -1)
        net = gross - 2 * FEE
        # 风险预算名义敞口
        if mode == 'v1':
            notional_pct = 1.0  # v1: 全额名义(对照基准)
        else:
            notional_pct = min(RISK_PCT / sl_pct, MARGIN_PCT * LEV_CAP)
            if half_ok and s.get('half'):
                notional_pct *= 0.5
        trades.append({'pair': pair, 'date': str(d['date'].iloc[i].date()), 'dir': dr,
                       'evt': s.get('evt', 'v1'), 'entry': entry,
                       'hold_days': exit_day - i - 1, 'reason': reason,
                       'gross_pct': gross * 100, 'net_pct': net * 100,
                       'notional_pct': notional_pct * 100,
                       'pnl_pct': net * notional_pct * 100})
        busy_until = exit_day + COOLDOWN
    return trades


def summarize(trades, label):
    if not trades:
        return {'label': label, 'count': 0}
    df = pd.DataFrame(trades)
    pnl = df['pnl_pct']
    eq = (1 + pnl / 100).cumprod()
    dd = ((eq - eq.cummax()) / eq.cummax()).min()
    wins = df[df['net_pct'] > 0]['net_pct']
    losses = df[df['net_pct'] <= 0]['net_pct']
    return {
        'label': label, 'count': len(df),
        'win_rate': round((df['net_pct'] > 0).mean() * 100, 1),
        'avg_pnl': round(pnl.mean(), 2),
        'median_pnl': round(pnl.median(), 2),
        'profit_factor': round(wins.sum() / abs(losses.sum()), 2) if len(losses) and losses.sum() != 0 else None,
        'worst_trade': round(df['pnl_pct'].min(), 1),
        'best_trade': round(df['pnl_pct'].max(), 1),
        'avg_hold': round(df['hold_days'].mean(), 1),
        'stop_rate': round((df['reason'] == 'stop').mean() * 100, 1),
        'target_rate': round((df['reason'] == 'target').mean() * 100, 1),
        'expire_rate': round((df['reason'] == 'expire').mean() * 100, 1),
        'equity_multiple': round(eq.iloc[-1], 2),
        'max_dd': round(dd * 100, 1),
    }


def main():
    btc_state = load_btc_state()
    groups = {'A_v1+v1风控': [], 'B_v1+ATR风控': [], 'C_v2硬门控+ATR': [], 'D_v2分级门控+ATR': []}
    trio_detail = {g: [] for g in groups}
    ok, failed = [], []
    for pair in PAIRS_ALL:
        if not os.path.exists(f'{CACHE}/{pair}_1d.csv') or not os.path.exists(f'{CACHE}/{pair}_4h.csv'):
            failed.append(pair)
            continue
        d, ind, l4 = load_data(pair)
        v1, v2 = gen_signals(pair, d, ind, l4, btc_state)
        # C 组需要硬门控: 用硬门控重生成v2信号(tier_ok→hard_ok)
        # 简化: gen_signals同时产出分级门控信号(D); C组在D基础上过滤掉深熊期信号
        v2_hard = [s for s in v2 if not (s['dir'] == 'long' and s.get('half'))]
        groups['A_v1+v1风控'] += simulate(pair, d, ind, v1, 'v1')
        groups['B_v1+ATR风控'] += simulate(pair, d, ind, v1, 'atr')
        groups['C_v2硬门控+ATR'] += simulate(pair, d, ind, v2_hard, 'atr')
        groups['D_v2分级门控+ATR'] += simulate(pair, d, ind, v2, 'atr')
        if pair in TRIO:
            for g, t in groups.items():
                trio_detail[g].append({'pair': pair, 'n': sum(1 for x in t if x['pair'] == pair)})
        ok.append(pair)

    report = {'pairs_used': ok, 'pairs_missing': failed,
              'groups': {g: summarize(t, g) for g, t in groups.items()},
              'long_vs_short_D': {}}
    # D组多空拆解
    dtr = pd.DataFrame(groups['D_v2分级门控+ATR'])
    if len(dtr):
        for dr, sub in dtr.groupby('dir'):
            report['long_vs_short_D'][dr] = {
                'count': len(sub), 'win_rate': round((sub['net_pct'] > 0).mean() * 100, 1),
                'avg_pnl': round(sub['pnl_pct'].mean(), 2),
                'worst': round(sub['net_pct'].min(), 1)}
        report['D_by_evt'] = dtr.groupby('evt').apply(
            lambda x: pd.Series({'n': len(x), 'win': round((x['net_pct'] > 0).mean() * 100, 1),
                                 'avg_pnl': round(x['pnl_pct'].mean(), 2)})).to_dict('index')
        report['D_trio'] = dtr[dtr['pair'].isin(TRIO)].groupby('pair').apply(
            lambda x: pd.Series({'n': len(x), 'win': round((x['net_pct'] > 0).mean() * 100, 1),
                                 'avg_pnl': round(x['pnl_pct'].mean(), 2),
                                 'sum_pnl': round(x['pnl_pct'].sum(), 1)})).to_dict('index')
    with open(f'{OUT}/backtest_v2_report.json', 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2, default=str)

    print(f"币种: {len(ok)}个  缺缓存: {failed or '无'}\n")
    print(f"{'组别':22s} {'单数':>5s} {'胜率':>6s} {'单均':>7s} {'盈亏比':>6s} {'最差单':>7s} "
          f"{'止损率':>6s} {'止盈率':>6s} {'净值倍数':>7s} {'最大回撤':>7s}")
    for g in groups:
        s = report['groups'][g]
        if s['count'] == 0:
            print(f"{g:22s} 无信号")
            continue
        print(f"{g:22s} {s['count']:5d} {s['win_rate']:5.1f}% {s['avg_pnl']:+6.2f}% "
              f"{str(s['profit_factor']):>6s} {s['worst_trade']:+6.1f}% "
              f"{s['stop_rate']:5.1f}% {s['target_rate']:5.1f}% "
              f"{s['equity_multiple']:6.2f}x {s['max_dd']:6.1f}%")
    print('\nD组多空拆解:', json.dumps(report['long_vs_short_D'], ensure_ascii=False))
    if 'D_by_evt' in report:
        print('D组按事件:', json.dumps(report['D_by_evt'], ensure_ascii=False))
    if report.get('D_trio'):
        print('D组三币(BTC/ETH/SOL):', json.dumps(report['D_trio'], ensure_ascii=False))


if __name__ == '__main__':
    main()
