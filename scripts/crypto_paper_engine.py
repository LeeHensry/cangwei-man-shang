#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ETH 多空模拟盘引擎 v2.5 (paper trading)
========================================
定稿配置(回测口径完全一致, 复用回测脚本的特征与信号函数):
  LONG : E1-E5 + 软门控(BTC>SMA20x1.03) + vr>1.5 + 24h涨幅>1.5% + 冷却6h
         + 三背景(bull/macd/flag4) + SL=1.5xATR / TP=RR1.0 + 到期168h
  SHORT: mirror趋势跟空(ETH日线空头+MACD死叉+BTC<SMA20) + vr>2.0 / 24h跌幅>2%
         + 冷却6h + SL=1.5xATR / TP=RR1.0 + 到期168h
  风险 : 5:5配比 risk_L=15% / risk_S=6.5%, 名义敞口 min(risk/sl_pct, 2.4)
  并发 : 多空共用上限4仓 | 熔断: 连续3笔止损 -> 暂停168h
账户 : 虚拟10000 USDT 起步, 复利记账 equity *= (1 + net*notional)
状态 : data/crypto/paper/state.json (幂等, 重跑安全)
运行 : 每小时1次(自动化调度), 信号=最近一根已收盘1H K线
"""
import json
import os
import time
import urllib.request
from datetime import datetime, timezone, timedelta

import pandas as pd

BASE = '/Users/mlamp/WorkBuddy/2026-08-24-16-17-11'
CACHE = f'{BASE}/data/crypto/cache'
PAPER = f'{BASE}/data/crypto/paper'
API = 'https://data-api.binance.vision/api/v3/klines'

# ---- 定稿参数(与回测 portfolio_sim 5:5 校准版完全一致) ----
CFG = {
    'long': {'evts': ['E1', 'E2', 'E3', 'E4', 'E5'], 'vr_th': 1.5, 'pct_th': 1.5,
             'cooldown_h': 6, 'gate_key': 'gate_soft', 'need_flag4': True},
    'short': {'families': ['mirror'], 'vr_th': 2.0, 'pct_th': 2.0, 'cooldown_h': 6},
    'sl': 1.5, 'rr': 1.0, 'risk_L': 0.15, 'risk_S': 0.065,
    'ncap': 2.4, 'max_conc': 4, 'expire_h': 168,
    'loss_n': 3, 'pause_h': 168,
    'start_equity': 10000.0,
}

INTERVAL_MS = {'1d': 86400000, '4h': 14400000, '1h': 3600000}


def http_json(url, retries=5):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            return json.loads(urllib.request.urlopen(req, timeout=20).read().decode())
        except Exception:
            if i == retries - 1:
                raise
            time.sleep(2 + 2 * i)


def update_cache(pair, interval):
    """增量更新K线缓存, 只保留已收盘K线"""
    path = f'{CACHE}/{pair}_{interval}.csv'
    cols = ['date', 'open', 'high', 'low', 'close', 'volume']
    now_ms = int(time.time() * 1000)
    start_ms = 0
    old = None
    if os.path.exists(path):
        old = pd.read_csv(path, parse_dates=['date'])
        start_ms = int(old['date'].iloc[-1].timestamp() * 1000) + INTERVAL_MS[interval]
    rows = []
    cur = max(start_ms, 0)
    while True:
        batch = http_json(f'{API}?symbol={pair}&interval={interval}&startTime={cur}&limit=1000')
        if not batch:
            break
        rows += batch
        cur = batch[-1][0] + INTERVAL_MS[interval]
        if len(batch) < 1000 or cur >= now_ms:
            break
    new = pd.DataFrame(rows, columns=['ot', 'open', 'high', 'low', 'close', 'volume',
                                      'ct', 'qv', 'n', 'tb', 'tq', 'ig'])
    if new.empty:
        return 0
    new['date'] = pd.to_datetime(new['ot'], unit='ms', utc=True).dt.tz_convert(None)
    for c in ['open', 'high', 'low', 'close', 'volume']:
        new[c] = new[c].astype(float)
    new = new[cols]
    # 丢弃未收盘的最后一根
    new = new[new['date'].astype('int64') // 10**6 + INTERVAL_MS[interval] <= now_ms]
    if old is not None:
        new = pd.concat([old, new]).drop_duplicates('date').sort_values('date').reset_index(drop=True)
    new.to_csv(path, index=False)
    return len(new)


def load_modules():
    """加载回测模块(禁用main), 取得特征与信号函数"""
    import types
    src = open(f'{BASE}/scripts/crypto_backtest_eth_5x_r2.py').read() \
        .replace("if __name__ == '__main__':", "if False:")
    r2 = types.ModuleType('r2'); exec(compile(src, 'r2', 'exec'), r2.__dict__)
    src = open(f'{BASE}/scripts/crypto_backtest_eth_ls.py').read() \
        .replace("if __name__ == '__main__':", "if False:")
    ls = types.ModuleType('ls'); exec(compile(src, 'ls', 'exec'), ls.__dict__)
    return r2, ls


def build_all_feats(r2, ls):
    f = ls.build_short_feats(r2.build_feats())
    return f


def gen_latest_signals(f, r2, ls):
    """对最近一根已收盘K线判定多空信号(整段历史重算, 口径与回测一致)"""
    n = len(f['close'])
    last = n - 1
    longs = r2.gen_signals2(f, CFG['long'])
    shorts = ls.gen_short_signals(f, CFG['short'])
    return (last in set(longs), last in set(shorts))


def open_position(state, f, i, side):
    entry = f['close'][i]          # 信号K线收盘价入场(≈回测的下一根开盘)
    atr = f['atr'][i]
    if not entry or entry <= 0 or pd.isna(atr) or atr <= 0:
        return
    sl_pct = min(max(CFG['sl'] * atr / entry, 0.02), 0.15)
    tp_pct = sl_pct * CFG['rr']
    risk = CFG['risk_L'] if side == 'L' else CFG['risk_S']
    notional = min(risk / sl_pct, CFG['ncap'])
    if side == 'L':
        stop, target = entry * (1 - sl_pct), entry * (1 + tp_pct)
    else:
        stop, target = entry * (1 + sl_pct), entry * (1 - tp_pct)
    state['positions'].append({
        'side': side, 'entry_time': str(f['date'][i]),
        'entry': round(entry, 4), 'notional': round(notional, 4),
        'stop': round(stop, 4), 'target': round(target, 4),
        'expire_time': str(f['date'][i] + timedelta(hours=CFG['expire_h'])),
        'sl_pct': round(sl_pct, 4),
    })


def check_exits(state, f):
    """按1H高低点检查未平仓位的止损/止盈/到期(保守口径: 先止损)"""
    d = pd.Series(pd.to_datetime(f['date']))
    lows, highs, closes = f['low'], f['high'], f['close']
    still, closed = [], []
    for pos in state['positions']:
        entry_t = pd.Timestamp(pos['entry_time'])
        exp_t = pd.Timestamp(pos['expire_time'])
        mask = (d > entry_t) & (d <= min(exp_t, d.iloc[-1]))
        idxs = d.index[mask]
        exit_price, exit_t, reason = None, None, None
        for j in idxs:
            lo, hi = lows[j], highs[j]
            if pos['side'] == 'L':
                if lo <= pos['stop']:
                    exit_price, exit_t, reason = pos['stop'], d[j], 'stop'; break
                if hi >= pos['target']:
                    exit_price, exit_t, reason = pos['target'], d[j], 'target'; break
            else:
                if hi >= pos['stop']:
                    exit_price, exit_t, reason = pos['stop'], d[j], 'stop'; break
                if lo <= pos['target']:
                    exit_price, exit_t, reason = pos['target'], d[j], 'target'; break
        if exit_price is None and len(idxs) and d.iloc[idxs[-1]] >= exp_t:
            exit_price, exit_t, reason = closes[idxs[-1]], d.iloc[idxs[-1]], 'expire'
        if exit_price is None:
            still.append(pos)
            continue
        gross = (exit_price / pos['entry'] - 1) if pos['side'] == 'L' \
            else (pos['entry'] / exit_price - 1)
        net = gross - 2 * 0.0004
        pnl = net * pos['notional'] * 100
        state['equity'] *= (1 + net * pos['notional'])
        closed.append({**pos, 'exit_time': str(exit_t), 'exit': round(exit_price, 4),
                       'reason': reason, 'net_pct': round(net * 100, 3),
                       'pnl_pct': round(pnl, 3),
                       'equity_after': round(state['equity'], 2)})
        if reason == 'stop':
            state['consec_stops'] += 1
            if state['consec_stops'] >= CFG['loss_n']:
                state['pause_until'] = str(pd.Timestamp(exit_t) + timedelta(hours=CFG['pause_h']))
                state['consec_stops'] = 0
        else:
            state['consec_stops'] = 0
    state['positions'] = still
    state['trades'] += closed


def run():
    os.makedirs(PAPER, exist_ok=True)
    spath = f'{PAPER}/state.json'
    if os.path.exists(spath):
        state = json.load(open(spath))
    else:
        state = {'equity': CFG['start_equity'], 'positions': [], 'trades': [],
                 'consec_stops': 0, 'pause_until': None, 'opened_signals': [],
                 'created_at': datetime.now().isoformat()}

    # 1) 更新K线缓存(ETH三周期 + BTC日线)
    for pair, itv in [('ETHUSDT', '1h'), ('ETHUSDT', '4h'), ('ETHUSDT', '1d'),
                      ('BTCUSDT', '1d')]:
        update_cache(pair, itv)

    # 2) 重建特征(与回测同源)
    r2, ls = load_modules()
    f = build_all_feats(r2, ls)
    last_t = str(pd.Timestamp(f['date'][-1]))

    # 3) 平仓检查
    check_exits(state, f)

    # 4) 信号判定(熔断/并发/去重后开仓)
    events = []
    if not (state['pause_until'] and pd.Timestamp(last_t) < pd.Timestamp(state['pause_until'])):
        is_l, is_s = gen_latest_signals(f, r2, ls)
        open_cnt = len(state['positions'])
        sig_key = f'{last_t}'
        if is_l and sig_key not in state['opened_signals'] and open_cnt < CFG['max_conc']:
            open_position(state, f, len(f['close']) - 1, 'L')
            state['opened_signals'].append(f'L@{sig_key}')
            events.append(f'OPEN LONG @ {last_t}')
            open_cnt += 1
        if is_s and sig_key not in state['opened_signals'] and open_cnt < CFG['max_conc']:
            open_position(state, f, len(f['close']) - 1, 'S')
            state['opened_signals'].append(f'S@{sig_key}')
            events.append(f'OPEN SHORT @ {last_t}')
    else:
        events.append(f"PAUSED until {state['pause_until']} (连亏熔断)")

    state['last_run'] = datetime.now().isoformat()
    state['last_bar'] = last_t
    json.dump(state, open(spath, 'w'), indent=2, ensure_ascii=False)

    # 5) 输出运行报告
    write_report(state, f, events)
    return state


def write_report(state, f, events):
    eq = state['equity']
    trades = state['trades']
    wins = [t for t in trades if t['net_pct'] > 0]
    ret = (eq / CFG['start_equity'] - 1) * 100
    open_pos = state['positions']
    lines = [
        f"# ETH 多空模拟盘日报 v2.5 (5:5配比)",
        f"",
        f"- 运行时间: {state['last_run']}  |  最新1H K线: {state['last_bar']}",
        f"- 账户净值: **{eq:,.2f} USDT** (起步 {CFG['start_equity']:,.0f}, 收益率 {ret:+.2f}%)",
        f"- 已平仓: {len(trades)} 笔, 胜率 {(len(wins)/len(trades)*100 if trades else 0):.1f}%",
        f"- 持仓中: {len(open_pos)} 仓" +
        (f" -> {', '.join(p['side'] + ' @' + str(p['entry']) for p in open_pos)}" if open_pos else ""),
        f"- 连亏计数: {state['consec_stops']}/{CFG['loss_n']}" +
        (f" | 熔断暂停至 {state['pause_until']}" if state['pause_until'] else ""),
        f"",
    ]
    if events:
        lines += ["## 本次运行事件", ""] + [f"- {e}" for e in events] + [""]
    if trades:
        lines += ["## 最近10笔平仓", "",
                  "| 方向 | 入场时间 | 入场 | 出场 | 出场时间 | 原因 | 净收益% | 账户盈亏% | 净值 |",
                  "|---|---|---|---|---|---|---|---|---|"]
        for t in trades[-10:]:
            lines.append(f"| {t['side']} | {t['entry_time'][:16]} | {t['entry']} | {t['exit']} | "
                         f"{t['exit_time'][:16]} | {t['reason']} | {t['net_pct']:+.2f} | "
                         f"{t['pnl_pct']:+.2f} | {t['equity_after']:,.2f} |")
    open(f'{PAPER}/report.md', 'w').write('\n'.join(lines))
    # 净值曲线CSV
    with open(f'{PAPER}/equity_curve.csv', 'w') as fo:
        fo.write('exit_time,pnl_pct,equity\n')
        fo.write(f',0,{CFG["start_equity"]:.2f}\n')
        for t in trades:
            fo.write(f"{t['exit_time']},{t['pnl_pct']},{t['equity_after']:.2f}\n")


if __name__ == '__main__':
    st = run()
    print(f"equity={st['equity']:.2f} positions={len(st['positions'])} "
          f"closed={len(st['trades'])} last_bar={st['last_bar']}")
