#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v2.4 ETH单币 5x 专项实验
=========================
目标: ETH年化5x, 加大下单数
杠杆: ①新事件E4(回踩企稳)/E5(波动收缩突破)提升信号频率 ②冷却12h->6h
      ③到期168h->96h ④风险预算8/10/12% ⑤并发仓位上限(2/3)真实化——
      之前版本并发无上限是虚高口径, 本次改为仓位感知模拟(仓位满则跳过信号)
新增诚实指标: 平均/最大并发仓位数、平均名义敞口、剔除2023-24压力测试
"""
import json
import itertools
import importlib.util
import numpy as np
import pandas as pd

BASE = '/Users/mlamp/WorkBuddy/2026-08-24-16-17-11'
spec = importlib.util.spec_from_file_location('bt1h', f'{BASE}/scripts/crypto_backtest_1h.py')
bt1h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bt1h)

PAIR = 'ETHUSDT'


def enrich(f):
    """在precompute基础上补1H粒度新特征: sma20h/boll带宽分位/1h涨幅"""
    c = pd.Series(f['close'])
    sma20h = c.rolling(20).mean()
    std20 = c.rolling(20).std()
    bw = (4 * std20) / sma20h                     # BOLL带宽
    bw_rank = bw.rolling(480, min_periods=240).rank(pct=True)  # 20天分位
    ret1h = c.pct_change() * 100
    f['sma20h'] = sma20h.tolist()
    f['bw_rank'] = bw_rank.tolist()
    f['ret1h'] = ret1h.tolist()
    return f


def gen_signals(f, cfg):
    """事件驱动+全局冷却。事件集由cfg['evts']控制: E1/E2/E3/E4/E5"""
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
        # 基础门控: BTC强门控+日线多头+MACD+4H均线
        if not (f['gate'][i] and f['bull'][i] and f['macd'][i] and f['flag4'][i]):
            continue
        hit = False
        if 'E2' in cfg['evts'] and vr > cfg['vr_th'] and pct > cfg['pct_th']:
            hit = True
        if not hit and 'E1' in cfg['evts'] and vr > cfg['vr_th'] and pct > cfg['pct_th'] and f['breakout'][i]:
            hit = True
        if not hit and 'E3' in cfg['evts'] and f['breakout'][i] and pct > cfg['pct_th']:
            hit = True
        if not hit and 'E4' in cfg['evts']:
            # 回踩企稳: 贴近上行SMA20(1H)且未过度拉伸 + 放量回升
            s = f['sma20h'][i]
            if (pd.notna(s) and s > 0 and pd.notna(ret1)
                    and 0.995 * s <= f['close'][i] <= 1.05 * s
                    and vr > 1.5 and ret1 > 0.3 and pct > 0):
                hit = True
        if not hit and 'E5' in cfg['evts']:
            # 波动收缩突破: BOLL带宽20天分位<25% + 破20日高 + 放量
            if pd.notna(bw) and bw < 0.25 and f['breakout'][i] and vr > 1.3:
                hit = True
        if not hit:
            continue
        idxs.append(i)
        cd_until = i + cfg['cooldown_h']
    return idxs


def simulate_cap(f, idxs, sl_mult, rr, max_conc, risk, ncap, expire):
    """仓位感知模拟: 并发持仓达上限则跳过信号; 返回成交trades+被跳过数"""
    trades, skipped = [], 0
    n = len(f['close'])
    active = []   # [entry_bar, exit_bar]
    for i in idxs:
        if i + 1 >= n:
            continue
        entry = f['open'][i + 1]
        atr = f['atr'][i]
        if not entry or entry <= 0 or pd.isna(atr) or atr <= 0:
            continue
        sl_pct = min(max(sl_mult * atr / entry, 0.02), 0.15)
        tp_pct = sl_pct * rr
        stop, target = entry * (1 - sl_pct), entry * (1 + tp_pct)
        exit_price, exit_j, reason = None, None, None
        end = min(i + 1 + expire, n)
        for j in range(i + 1, end):
            if f['low'][j] <= stop:
                exit_price, exit_j, reason = stop, j, 'stop'; break
            if f['high'][j] >= target:
                exit_price, exit_j, reason = target, j, 'target'; break
        if exit_price is None:
            exit_j, exit_price, reason = end - 1, f['close'][end - 1], 'expire'
        # 并发检查: 信号时刻i+1已活跃的仓位
        active = [a for a in active if a[1] >= i + 1]
        if len(active) >= max_conc:
            skipped += 1
            continue
        active.append([i + 1, exit_j])
        gross = exit_price / entry - 1
        net = gross - 2 * bt1h.FEE
        notional = min(risk / sl_pct, ncap)
        trades.append({'i': i, 'entry_dt': f['date'][i], 'exit_dt': f['date'][exit_j],
                       'hold_h': exit_j - (i + 1), 'reason': reason,
                       'net_pct': net * 100, 'pnl': net * notional * 100,
                       'notional': notional, 'sl_pct': sl_pct})
    return trades, skipped


def stats_all(trades, span_h):
    if not trades:
        return None
    df = pd.DataFrame(trades).sort_values('entry_dt').reset_index(drop=True)
    eq = (1 + df['pnl'] / 100).cumprod()
    dd = ((eq - eq.cummax()) / eq.cummax()).min() * 100
    t0, t1 = df['entry_dt'].iloc[0], df['exit_dt'].iloc[-1]
    years = max((t1 - t0).days / 365.25, 0.5)
    ann = eq.iloc[-1] ** (1 / years)
    half = len(df) // 2
    # 并发统计(按小时占用)
    occ = np.zeros(span_h, dtype=int)
    for _, t in df.iterrows():
        occ[t['i']:t['i'] + t['hold_h'] + 1] += 1
    avg_notional = (df['notional'] * df['hold_h']).sum() / max(df['hold_h'].sum(), 1)
    return {'n': len(df), 'win': round((df['net_pct'] > 0).mean() * 100, 1),
            'avg_pnl': round(df['pnl'].mean(), 3),
            'eq': round(eq.iloc[-1], 2), 'ann': round(ann, 2), 'years': round(years, 1),
            'mdd': round(dd, 1),
            'win_h1': round((df['net_pct'].iloc[:half] > 0).mean() * 100, 1) if half else 0,
            'win_h2': round((df['net_pct'].iloc[half:] > 0).mean() * 100, 1) if half else 0,
            'tpy': round(len(df) / years, 0),
            'avg_hold': round(df['hold_h'].mean(), 1),
            'max_conc': int(occ.max()) if len(occ) else 0,
            'avg_conc': round(float(occ.mean()), 2),
            'avg_notional': round(float(avg_notional), 2)}


def main():
    btc_gate = bt1h.load_btc_gate()
    f = enrich(bt1h.precompute_coin(PAIR, btc_gate))
    span_h = len(f['close'])
    print(f'{PAIR}: {span_h}根1H, {f["date"][0]} ~ {f["date"][-1]}', flush=True)

    grid = list(itertools.product(
        [['E1', 'E2', 'E3'], ['E1', 'E2', 'E3', 'E4', 'E5']],   # 事件集
        [1.2, 1.5],                  # vr_th
        [1.5, 2.0],                  # pct_th
        [6, 12],                     # cooldown_h
        [(2.0, 1.0), (1.5, 1.0), (2.0, 1.5), (1.5, 0.75)],  # (SL,RR)
        [2, 3],                      # max_concurrent
        [0.08, 0.10, 0.12],          # RISK_PCT
        [96, 168],                   # expire bars
    ))
    print(f'网格: {len(grid)}组', flush=True)

    results = []
    for evts, vr, pct, cd, (sl, rr), mc, risk, exp in grid:
        bt1h.RISK_PCT = risk
        bt1h.NOTIONAL_CAP = 2.4
        cfg = {'evts': evts, 'vr_th': vr, 'pct_th': pct, 'cooldown_h': cd}
        idxs = gen_signals(f, cfg)
        trades, skipped = simulate_cap(f, idxs, sl, rr, mc, risk, 2.4, exp)
        s = stats_all(trades, span_h)
        if s:
            s.update({'evts': '+'.join(evts), 'vr': vr, 'pct': pct, 'cd': cd,
                      'SL': sl, 'RR': rr, 'mc': mc, 'risk': risk, 'exp': exp})
            results.append(s)

    # 达标5x的里挑单数最多; 全量榜按年化
    hit5 = [r for r in results if r['ann'] >= 5.0]
    hit5.sort(key=lambda r: (-r['tpy'], r['mdd']))
    results.sort(key=lambda r: -r['ann'])
    with open(f'{BASE}/data/crypto/backtest_eth5x_report.json', 'w') as fo:
        json.dump({'hit5_top': hit5[:30], 'ann_top': results[:20]}, fo,
                  ensure_ascii=False, indent=2, default=str)

    print(f"\n===== 年化>=5x: {len(hit5)}组 =====")
    print(f"{'事件':11s} {'vr':>4s} {'涨幅':>4s} {'cd':>3s} {'SL':>4s} {'RR':>5s} {'并发':>3s} "
          f"{'风险':>5s} {'到期':>4s} | {'n':>4s} {'年单':>4s} {'胜率':>6s} {'H1':>5s} {'H2':>5s} "
          f"{'单均':>7s} {'年化':>6s} {'回撤':>7s} {'均持h':>6s} {'均敞口':>6s}")
    for r in hit5[:20]:
        print(f"{r['evts']:11s} {r['vr']:4.1f} {r['pct']:4.1f} {r['cd']:3d} {r['SL']:4.1f} {r['RR']:5.2f} {r['mc']:3d} "
              f"{r['risk']:5.2f} {r['exp']:4d} | {r['n']:4d} {r['tpy']:4.0f} {r['win']:5.1f}% {r['win_h1']:5.1f} {r['win_h2']:5.1f} "
              f"{r['avg_pnl']:+7.3f} {r['ann']:5.2f}x {r['mdd']:6.1f}% {r['avg_hold']:6.1f} {r['avg_notional']:6.2f}")

    print(f"\n===== 全榜年化TOP10 =====")
    for r in results[:10]:
        print(f"{r['evts']:11s} vr{r['vr']} pct{r['pct']} cd{r['cd']} SL{r['SL']} RR{r['RR']} "
              f"并发{r['mc']} risk{r['risk']} exp{r['exp']} | n={r['n']} 年单{r['tpy']:.0f} "
              f"胜率{r['win']}% 单均{r['avg_pnl']:+.3f} 年化{r['ann']}x 回撤{r['mdd']}%")

    if hit5:
        best = hit5[0]
        print(f"\n===== 推荐单数最多配置 分年: {best['evts']} vr{best['vr']} pct{best['pct']} cd{best['cd']} "
              f"SL{best['SL']} RR{best['RR']} 并发{best['mc']} risk{best['risk']} exp{best['exp']} =====")
        cfg = {'evts': best['evts'].split('+'), 'vr_th': best['vr'], 'pct_th': best['pct'],
               'cooldown_h': best['cd']}
        idxs = gen_signals(f, cfg)
        trades, _ = simulate_cap(f, idxs, best['SL'], best['RR'], best['mc'],
                                 best['risk'], 2.4, best['exp'])
        df = pd.DataFrame(trades)
        for y, sub in df.groupby(df['entry_dt'].dt.year):
            w = (sub['net_pct'] > 0).mean() * 100
            yeq = (1 + sub['pnl'] / 100).prod()
            print(f"  {y}: n={len(sub):4d} 胜率={w:5.1f}% 当年净值={yeq:.2f}x")
        # 剔除2023-2024压力
        df2 = df[~df['entry_dt'].dt.year.isin([2023, 2024])]
        if len(df2) > 10:
            eq2 = (1 + df2['pnl'] / 100).prod()
            t0, t1 = df2['entry_dt'].min(), df2['exit_dt'].max()
            yrs = max((t1 - t0).days / 365.25, 0.5)
            print(f"  剔除2023-24后: n={len(df2)} 累计={eq2:.2f}x 年化={eq2 ** (1 / yrs):.2f}x")


if __name__ == '__main__':
    main()
