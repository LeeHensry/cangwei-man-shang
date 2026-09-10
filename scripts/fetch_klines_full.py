#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全量K线拉取: 8币 × (1d/4h/1h) × 2019-06-01起
- 数据源: data-api.binance.vision (币安官方公开镜像)
- 断点续传: 已有文件从最后一条时间戳继续append
- 重试: 5次指数退避, 应对代理502
用法: python3 fetch_klines_full.py
"""
import csv
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

BASE = '/Users/mlamp/WorkBuddy/2026-08-24-16-17-11'
CACHE = f'{BASE}/data/crypto/cache'
API = 'https://data-api.binance.vision/api/v3/klines'

# 用法: python3 fetch_klines_full.py [pairs逗号分隔] [intervals逗号分隔]
# 默认: 8币 × 1d,4h,1h
PAIRS = (sys.argv[1].split(',') if len(sys.argv) > 1 else
         ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BCHUSDT', 'LTCUSDT',
          'LINKUSDT', 'XRPUSDT', 'ADAUSDT'])
_IV = (sys.argv[2].split(',') if len(sys.argv) > 2 else ['1d', '4h', '1h'])
INTERVALS = {'1d': 86400000, '4h': 14400000, '1h': 3600000,
             '15m': 900000, '5m': 300000, '1m': 60000}
START_MS = int(datetime(2019, 6, 1, tzinfo=timezone.utc).timestamp() * 1000)
LIMIT = 1000
DELAY = 0.25


def http_get(url):
    for i in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            return json.loads(urllib.request.urlopen(req, timeout=20).read().decode())
        except Exception as e:
            if i == 4:
                raise
            wait = 2 ** (i + 1)
            print(f'    重试{i+1}/5 ({e}), 等{wait}s', flush=True)
            time.sleep(wait)


import json


def last_open_time(path, interval_ms):
    """已有文件的最后K线openTime(ms); 无文件返回None"""
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        return None
    with open(path) as f:
        lines = f.read().strip().split('\n')
        if len(lines) < 2:
            return None
        last = lines[-1].split(',')[0]
        try:
            dt = datetime.strptime(last, '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
        except ValueError:
            dt = datetime.strptime(last, '%Y-%m-%d').replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000) + interval_ms


def fetch_pair_interval(pair, interval):
    interval_ms = INTERVALS[interval]
    path = f'{CACHE}/{pair}_{interval}.csv'
    start = last_open_time(path, interval_ms)
    mode = 'a'
    if start is None:
        start = START_MS
        mode = 'w'
        n_existing = 0
    else:
        n_existing = sum(1 for _ in open(path)) - 1
    fetched = 0
    with open(path, mode, newline='') as f:
        w = csv.writer(f)
        if mode == 'w':
            w.writerow(['date', 'open', 'high', 'low', 'close', 'volume', 'quote_volume'])
        while start < time.time() * 1000:
            url = f'{API}?symbol={pair}&interval={interval}&startTime={start}&limit={LIMIT}'
            data = http_get(url)
            if not data:
                break
            for k in data:
                ts = datetime.fromtimestamp(k[0] / 1000, tz=timezone.utc)
                date_str = ts.strftime('%Y-%m-%d %H:%M:%S') if interval != '1d' else ts.strftime('%Y-%m-%d')
                w.writerow([date_str, k[1], k[2], k[3], k[4], k[5], k[7]])
            fetched += len(data)
            start = data[-1][0] + interval_ms
            if len(data) < LIMIT:
                break
            time.sleep(DELAY)
    print(f'  {pair} {interval}: +{fetched}根 (原有{n_existing})', flush=True)


def main():
    os.makedirs(CACHE, exist_ok=True)
    for pair in PAIRS:
        for interval in _IV:
            print(f'拉取 {pair} {interval}...', flush=True)
            try:
                fetch_pair_interval(pair, interval)
            except Exception as e:
                print(f'  !! {pair} {interval} 失败: {e}', flush=True)
    print('DONE', flush=True)


if __name__ == '__main__':
    main()
