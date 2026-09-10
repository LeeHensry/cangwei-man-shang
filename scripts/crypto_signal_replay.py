#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
加密货币信号历史回放（第一步：让数据说话）
==========================================
把线上 binance.js analyzeSymbol 的打分规则逐日回放到历史K线上，
产出每个信号发生时的特征 + 未来3/7天收益，用于评估规则真实胜率。

数据源: https://data-api.binance.vision (币安官方公开行情镜像, 无需Key)
规则源: /Users/mlamp/Workbuddy/2026-07-30-16-01-51/src/data/binance.js (严格同构)
输出:   data/crypto/replay_signals.csv  (信号明细, 供元标签训练)
        data/crypto/replay_summary.json (汇总统计)

用法: /Users/mlamp/.workbuddy/binaries/python/envs/default/bin/python scripts/crypto_signal_replay.py
"""
import json
import os
import sys
import time
import urllib.request

import numpy as np
import pandas as pd

BASE = '/Users/mlamp/WorkBuddy/2026-08-24-16-17-11'
OUT_DIR = f'{BASE}/data/crypto'
API = 'https://data-api.binance.vision'

# 与线上 HOT_PAIRS 一致（2026-09 版本, MATICUSDT/RNDRUSDT 已失效单独标记）
HOT_PAIRS = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT',
    'AVAXUSDT', 'DOTUSDT', 'LINKUSDT', 'MATICUSDT', 'LTCUSDT', 'UNIUSDT', 'ATOMUSDT',
    'NEARUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'SUIUSDT', 'SEIUSDT', 'TONUSDT',
    'PEPEUSDT', 'SHIBUSDT', 'WIFUSDT', 'FETUSDT', 'RNDRUSDT', 'INJUSDT',
]
KLINE_1D = 1100   # ~3.6年
KLINE_4H_BATCH = 1000
KLINE_4H_BATCHES = 7  # 7000根 4h ≈ 388天

# ===== 线上规则阈值（binance.js 原样） =====
TH_LONG, TH_SHORT, TH_WL, TH_WS = 72, 28, 60, 40


def http_get_json(url, retries=5):
    last_err = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            return json.loads(urllib.request.urlopen(req, timeout=20).read().decode())
        except Exception as e:
            last_err = e
            time.sleep(1.5 * (i + 1))  # 代理502时指数退避
    raise last_err


def cache_path(symbol, interval):
    return f'{OUT_DIR}/cache/{symbol}_{interval}.csv'


def fetch_klines_cached(symbol, interval, total):
    """带本地缓存的K线拉取, 断点续传"""
    cp = cache_path(symbol, interval)
    if os.path.exists(cp):
        df = pd.read_csv(cp, parse_dates=['date'])
        if len(df) >= total or len(df) < 500:  # 已缓存够 或 币种本身数据就少(如TON)
            return df
    df = fetch_klines(symbol, interval, total)
    if len(df):
        df.to_csv(cp, index=False)
    return df


def fetch_klines(symbol, interval, total):
    """分批拉取K线 → DataFrame"""
    rows, end_time = [], None
    while len(rows) < total:
        params = f'symbol={symbol}&interval={interval}&limit=1000'
        if end_time:
            params += f'&endTime={end_time}'
        data = http_get_json(f'{API}/api/v3/klines?{params}')
        if not data:
            break
        rows = data + rows
        end_time = data[0][0] - 1
        if len(data) < 1000:
            break
        time.sleep(0.08)
    df = pd.DataFrame(rows, columns=[
        'open_time', 'open', 'high', 'low', 'close', 'volume',
        'close_time', 'quote_volume', 'trades', 'tbb', 'tbq', 'ignore'])
    for c in ['open', 'high', 'low', 'close', 'volume', 'quote_volume']:
        df[c] = df[c].astype(float)
    df['date'] = pd.to_datetime(df['open_time'], unit='ms')
    return df[['date', 'open', 'high', 'low', 'close', 'volume', 'quote_volume']].reset_index(drop=True)


def daily_indicators(d):
    """日线全部指标, 向量化一次性计算（与线上逐点递归等价）"""
    c, v = d['close'], d['volume']
    ind = pd.DataFrame(index=d.index)
    for p in (5, 10, 20, 60):
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
    ind['boll_dn'] = ind['sma20'] - 2 * std20
    # ATR14
    tr = pd.concat([
        d['high'] - d['low'],
        (d['high'] - c.shift()).abs(),
        (d['low'] - c.shift()).abs()], axis=1).max(axis=1)
    ind['atr14'] = tr.ewm(alpha=1/14, adjust=False).mean()
    return ind


def score_day(i, d, ind, ind4h_last, prev_close):
    """按 binance.js 规则给第 i 天打分, 返回 (total, long_pts, short_pts, reasons, risks)"""
    c = d['close'].iloc[i]
    pct = (c / prev_close - 1) * 100 if prev_close else 0
    lp, sp, reasons, risks = 0, 0, [], []

    # 均线排列(日) ±15
    s5, s20, s60 = ind['sma5'].iloc[i], ind['sma20'].iloc[i], ind['sma60'].iloc[i]
    if all(pd.notna(x) for x in (s5, s20, s60)):
        if s5 > s20 > s60:
            lp += 15; reasons.append('均线多头排列(日)')
        elif s5 < s20 < s60:
            sp += 15; risks.append('均线空头排列(日)')
    # 4H均线 ±8
    if ind4h_last is not None:
        s5h, s20h = ind4h_last
        if pd.notna(s5h) and pd.notna(s20h):
            if s5h > s20h:
                lp += 8; reasons.append('4H均线多头')
            else:
                sp += 8; risks.append('4H均线空头')
    # MACD ±8
    dif, dea = ind['dif'].iloc[i], ind['dea'].iloc[i]
    if pd.notna(dif) and pd.notna(dea):
        if dif > dea:
            lp += 8; reasons.append('MACD多头(日)')
        else:
            sp += 8; risks.append('MACD空头(日)')
    # RSI ±12 / +4
    rsi = ind['rsi14'].iloc[i]
    if pd.notna(rsi):
        if rsi < 30:
            lp += 12; reasons.append(f'RSI超卖({rsi:.0f})')
        elif rsi > 75:
            sp += 12; risks.append(f'RSI超买({rsi:.0f})')
        elif 50 < rsi < 65:
            lp += 4; reasons.append(f'RSI偏强({rsi:.0f})')
    # 突破 ±10
    if i >= 21:
        high20 = d['high'].iloc[i-20:i].max()
        low20 = d['low'].iloc[i-20:i].min()
        if c > high20 and pct > 2:
            lp += 10; reasons.append('突破20日新高')
        if c < low20 and pct < -3:
            sp += 10; risks.append('跌破20日新低')
    # 量价 ±8
    vma20 = ind['vol_ma20'].iloc[i]
    if pd.notna(vma20) and vma20 > 0:
        vr = d['volume'].iloc[i] / vma20
        if vr > 2 and pct > 3:
            lp += 8; reasons.append(f'放量上涨(量比{vr:.1f})')
        elif vr > 2 and pct < -5:
            sp += 8; risks.append(f'放量下跌(量比{vr:.1f})')
    # BOLL ±5
    if pd.notna(ind['boll_up'].iloc[i]) and c > ind['boll_up'].iloc[i]:
        sp += 5; risks.append('突破BOLL上轨(超买)')
    if pd.notna(ind['boll_dn'].iloc[i]) and c < ind['boll_dn'].iloc[i]:
        lp += 5; reasons.append('跌破BOLL下轨(超卖)')
    # 24h极端 ±8/6
    if pct > 10:
        sp += 8; risks.append(f'24h涨{pct:.1f}%(过热)')
    if pct < -10:
        lp += 6; reasons.append(f'24h跌{pct:.1f}%(恐慌)')

    total = max(0, min(100, 50 + lp - sp))
    return total, lp, sp, reasons, risks, pct, rsi


def classify(total):
    if total >= TH_LONG:
        return 'long'
    if total <= TH_SHORT:
        return 'short'
    if total >= TH_WL:
        return 'watch_long'
    if total <= TH_WS:
        return 'watch_short'
    return 'hold'


def main():
    os.makedirs(f'{OUT_DIR}/cache', exist_ok=True)
    signals = []
    failed = []

    # 先拉BTC日线做环境状态
    print('拉取 BTC 日线(市场环境基准)...')
    btc = fetch_klines_cached('BTCUSDT', '1d', KLINE_1D)
    btc['sma20'] = btc['close'].rolling(20).mean()
    btc_map = dict(zip(btc['date'].dt.date, (btc['close'] > btc['sma20']).astype(int)))

    for pair in HOT_PAIRS:
        t0 = time.time()
        try:
            d = fetch_klines_cached(pair, '1d', KLINE_1D)
            if len(d) < 100:
                failed.append((pair, f'1d不足{len(d)}根'))
                continue
            # 4h: 拼接批次
            d4 = fetch_klines_cached(pair, '4h', KLINE_4H_BATCHES * KLINE_4H_BATCH)
            if len(d4) >= 30:
                d4['sma5'] = d4['close'].rolling(5).mean()
                d4['sma20'] = d4['close'].rolling(20).mean()
                d4['day'] = d4['date'].dt.date
                last4h = d4.groupby('day').tail(1).set_index('day')[['sma5', 'sma20']]
            else:
                last4h = pd.DataFrame(columns=['sma5', 'sma20'])
            ind = daily_indicators(d)

            prev_state = 'hold'
            for i in range(60, len(d) - 8):
                day = d['date'].iloc[i].date()
                prev_close = d['close'].iloc[i-1]
                i4 = last4h.loc[day].values if day in last4h.index else None
                total, lp, sp, reasons, risks, pct, rsi = score_day(
                    i, d, ind, i4, prev_close)
                sig = classify(total)
                if sig == prev_state:
                    continue  # 状态未变不重复计信号
                prev_state = sig
                if sig == 'hold':
                    continue
                c = d['close'].iloc[i]
                atr = ind['atr14'].iloc[i]
                high20 = d['high'].iloc[max(0, i-20):i].max()
                signals.append({
                    'pair': pair, 'date': str(day), 'signal': sig,
                    'score': total, 'price': c, 'pct_24h': round(pct, 2),
                    'rsi14': round(rsi, 1) if pd.notna(rsi) else None,
                    'atr_pct': round(atr / c * 100, 2) if pd.notna(atr) else None,
                    'dist_high20_pct': round((c / high20 - 1) * 100, 2) if high20 else None,
                    'btc_bull': btc_map.get(day),
                    'reasons': '|'.join(reasons[:5]), 'risks': '|'.join(risks[:5]),
                    'ret_3d': round(d['close'].iloc[i+3] / c - 1, 4),
                    'ret_7d': round(d['close'].iloc[i+7] / c - 1, 4),
                })
            print(f"  {pair}: {len(d)}天日线/{len(d4)}根4h, 信号{sum(1 for s in signals if s['pair']==pair)}个 "
                  f"({time.time()-t0:.1f}s)")
        except Exception as e:
            failed.append((pair, str(e)[:80]))
            print(f"  {pair}: 失败 - {e}")
        time.sleep(0.1)

    df = pd.DataFrame(signals)
    df.to_csv(f'{OUT_DIR}/replay_signals.csv', index=False, encoding='utf-8-sig')

    # ===== 汇总 =====
    summary = {'total_signals': len(df), 'failed_pairs': [f[0] for f in failed],
               'replay_period': f"{df['date'].min()} ~ {df['date'].max()}" if len(df) else None,
               'by_signal': {}, 'by_btc_state': {}, 'top_pairs': {}}
    for sig_type, dir_mult in (('long', 1), ('short', -1)):
        sub = df[df['signal'] == sig_type]
        if not len(sub):
            continue
        for n in (3, 7):
            r = sub[f'ret_{n}d'] * dir_mult
            summary['by_signal'].setdefault(sig_type, {})[f'{n}d'] = {
                'count': len(sub), 'win_rate': round((r > 0).mean() * 100, 1),
                'avg_ret': round(r.mean() * 100, 2),
                'median_ret': round(r.median() * 100, 2),
                'best': round(r.max() * 100, 1), 'worst': round(r.min() * 100, 1),
            }
        # 分BTC状态(7d)
        if sub['btc_bull'].notna().any():
            for state, label in ((1, 'btc_bull'), (0, 'btc_bear')):
                rs = sub[sub['btc_bull'] == state]['ret_7d'] * dir_mult
                if len(rs) >= 10:
                    summary['by_btc_state'].setdefault(sig_type, {})[label] = {
                        'count': len(rs), 'win_rate_7d': round((rs > 0).mean() * 100, 1),
                        'avg_ret_7d': round(rs.mean() * 100, 2)}
        # 币种排行(7d, 信号>=5个)
        g = sub.groupby('pair').apply(
            lambda x: pd.Series({'n': len(x),
                                 'win': (x['ret_7d'] * dir_mult > 0).mean() * 100,
                                 'avg': (x['ret_7d'] * dir_mult).mean() * 100}))
        g = g[g['n'] >= 5].sort_values('avg', ascending=False)
        summary['top_pairs'][sig_type] = g.round(1).to_dict('index')

    with open(f'{OUT_DIR}/replay_summary.json', 'w', encoding='utf-8') as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print('\n===== 回放汇总 =====')
    print(f"信号总数: {len(df)}  期间: {summary['replay_period']}")
    if failed:
        print(f"失败交易对: {[f[0] for f in failed]}")
    for sig_type in ('long', 'short'):
        info = summary['by_signal'].get(sig_type)
        if info:
            for n in (3, 7):
                x = info[f'{n}d']
                print(f"[{sig_type.upper():5s} {n}d] n={x['count']:4d}  胜率={x['win_rate']:5.1f}%  "
                      f"均值={x['avg_ret']:+.2f}%  中位={x['median_ret']:+.2f}%  "
                      f"最好={x['best']:+.1f}%  最差={x['worst']:+.1f}%")
    print('\nBTC状态拆解(7d):', json.dumps(summary['by_btc_state'], ensure_ascii=False))


if __name__ == '__main__':
    main()
