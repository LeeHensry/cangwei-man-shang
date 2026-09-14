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
日志 : data/crypto/paper/run_log.jsonl (每次运行一行, 可回溯调度连续性)
补跑 : 记录 last_processed_bar, 下次运行从其后逐根回放缺失K线(漏跑自动补齐,
       按时间顺序"先平仓后开仓", 不越界使用未来K线)
运行 : 每小时1次(自动化调度), 处理区间 = [上次处理点+1, 最新已收盘K线]
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


def check_exits(state, f, upto_idx=None):
    """按1H高低点检查未平仓位的止损/止盈/到期(保守口径: 先止损)

    upto_idx: 只处理到该下标(含)为止的K线。补跑历史时按时间顺序逐根推进,
              避免"用未来K线判定过去持仓"的越界。
    """
    d = pd.Series(pd.to_datetime(f['date']))
    if upto_idx is None:
        upto_idx = len(d) - 1
    lows, highs, closes = f['low'], f['high'], f['close']
    still, closed = [], []
    for pos in state['positions']:
        entry_t = pd.Timestamp(pos['entry_time'])
        exp_t = pd.Timestamp(pos['expire_time'])
        mask = (d > entry_t) & (d <= min(exp_t, d.iloc[upto_idx]))
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
    return closed


def append_run_log(entry):
    """每次运行追加一行JSONL, 用于回溯调度连续性与补跑情况"""
    with open(f'{PAPER}/run_log.jsonl', 'a') as fo:
        fo.write(json.dumps(entry, ensure_ascii=False) + '\n')


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
    cache_rows = {}
    for pair, itv in [('ETHUSDT', '1h'), ('ETHUSDT', '4h'), ('ETHUSDT', '1d'),
                      ('BTCUSDT', '1d')]:
        cache_rows[f'{pair}_{itv}'] = update_cache(pair, itv)

    # 2) 重建特征(与回测同源)
    r2, ls = load_modules()
    f = build_all_feats(r2, ls)
    d = pd.Series(pd.to_datetime(f['date']))
    last_idx = len(f['close']) - 1
    last_t = str(d.iloc[last_idx])

    # 3) 全序列信号(与回测同一套代码/参数, 整段重算保证口径一致)
    longs = set(r2.gen_signals2(f, CFG['long']))
    shorts = set(ls.gen_short_signals(f, CFG['short']))

    # 4) 确定待处理区间: 从上次处理点之后逐根回放(漏跑自动补齐)
    prev_raw = state.get('last_processed_bar') or state.get('last_bar')
    prev_idx = None
    if prev_raw:
        m = d.index[d == pd.Timestamp(prev_raw)]
        if len(m):
            prev_idx = int(m[0])
    if prev_idx is None:
        # 首次运行/对齐失败: 只判定最新一根(不追溯历史, 避免凭空造出历史仓位)
        start_idx, missed = last_idx, 0
        mode = 'init' if not prev_raw else 'reinit'
    else:
        start_idx = prev_idx + 1
        missed = max(0, last_idx - prev_idx - 1)
        mode = 'backfill' if missed > 0 else 'normal'

    events, opens, closes, bars = [], [], [], []
    sig_L, sig_S = [], []
    for i in range(start_idx, last_idx + 1):
        bar_t = d.iloc[i]
        # 4a) 平仓检查(截至本根K线, 先于开仓)
        for c in check_exits(state, f, upto_idx=i):
            closes.append(c)
            events.append(f"CLOSE {c['side']} {c['reason']} @ {str(c['exit_time'])[:16]} "
                          f"net={c['net_pct']:+.2f}% equity={c['equity_after']:,.2f}")
        # 4b) 熔断闸
        if state.get('pause_until') and bar_t < pd.Timestamp(state['pause_until']):
            bars.append({'bar': str(bar_t), 'signal': [], 'skip': 'paused'})
            continue
        # 4c) 信号闸 + 去重闸 + 并发闸
        sig_key = str(bar_t)
        here = []
        if i in longs:
            here.append('L'); sig_L.append(sig_key)
        if i in shorts:
            here.append('S'); sig_S.append(sig_key)
        for side in here:
            if f'{side}@{sig_key}' in state['opened_signals']:
                continue                                  # 去重: 该K线已处理过
            if len(state['positions']) >= CFG['max_conc']:
                continue                                  # 并发闸
            open_position(state, f, i, side)
            state['opened_signals'].append(f'{side}@{sig_key}')
            pos = state['positions'][-1]
            opens.append({'side': side, 'time': sig_key, 'entry': pos['entry'],
                          'stop': pos['stop'], 'target': pos['target'],
                          'notional': pos['notional']})
            events.append(f"OPEN {side} @ {sig_key[:16]} entry={pos['entry']} "
                          f"stop={pos['stop']} target={pos['target']} "
                          f"notional={pos['notional']}")
        bars.append({'bar': sig_key, 'signal': here})

    state['last_run'] = datetime.now().isoformat()
    state['last_bar'] = last_t
    state['last_processed_bar'] = last_t
    state['run_count'] = state.get('run_count', 0) + 1
    state['bars_evaluated_total'] = state.get('bars_evaluated_total', 0) + len(bars)
    json.dump(state, open(spath, 'w'), indent=2, ensure_ascii=False)

    # 5) 运行日志(一行一次, 可回溯调度连续性与漏跑补齐)
    append_run_log({
        'run_at': state['last_run'], 'run_count': state['run_count'], 'mode': mode,
        'last_bar': last_t, 'prev_bar': prev_raw,
        'from_bar': str(d.iloc[start_idx]) if start_idx <= last_idx else None,
        'bars_processed': len(bars), 'missed_bars': missed,
        'backfilled': missed > 0,
        'signals_L': sig_L[-50:], 'signals_S': sig_S[-50:],
        'opens': opens,
        'closes': [{'side': c['side'], 'reason': c['reason'],
                    'exit_time': c['exit_time'], 'net_pct': c['net_pct']} for c in closes],
        'equity': round(state['equity'], 2), 'positions': len(state['positions']),
        'pause_until': state.get('pause_until'), 'cache_rows': cache_rows,
    })

    # 6) 输出运行报告
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

    # 调度健康面板(读run_log统计补跑情况)
    log_path = f'{PAPER}/run_log.jsonl'
    if os.path.exists(log_path):
        rows = []
        for ln in open(log_path).read().split('\n'):
            if ln.strip():
                try:
                    rows.append(json.loads(ln))
                except Exception:
                    pass
        recent = rows[-24:]
        bf = [r for r in recent if r.get('backfilled')]
        lines += [
            "## 调度与补跑",
            "",
            f"- 累计运行: {state.get('run_count', 0)} 次 | 累计判定K线: {state.get('bars_evaluated_total', 0)} 根",
            f"- 最近 {len(recent)} 次运行中漏跑补齐 {len(bf)} 次" +
            (f" (最近一次 {str(bf[-1]['run_at'])[:16]}, 补 {bf[-1]['missed_bars']} 根K线)" if bf else " (调度连续, 无缺口)"),
            "",
            "| 运行时间 | 模式 | 处理根数 | 缺口中 | 信号 | 事件 | 净值 |",
            "|---|---|---|---|---|---|---|",
        ]
        for r in recent[-6:]:
            sig = (f"L{len(r.get('signals_L', []))}/S{len(r.get('signals_S', []))}"
                   if (r.get('signals_L') or r.get('signals_S')) else "-")
            ev = f"开{len(r.get('opens', []))}/平{len(r.get('closes', []))}"
            lines.append(f"| {str(r['run_at'])[:16]} | {r.get('mode', '-')} | {r.get('bars_processed', 0)} | "
                         f"{r.get('missed_bars', 0)} | {sig} | {ev} | {r.get('equity', 0):,.2f} |")
        lines += [""]

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
