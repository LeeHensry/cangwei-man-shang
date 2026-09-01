#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
仓位满上 TopUp 线上监控检查脚本（GitHub Actions 每小时触发）

检查维度：
1. 服务可用性  - /api/version 是否可响应（冷启动重试 3 次）
2. 数据新鲜度  - K线/评分最新日期 vs 期望交易日（同步窗口内跳过）
3. 数据完整性  - pool/klines/indicators/finance 数量是否在合理区间
4. 信号合理性  - 最新评分信号分布是否异常（全部 sell）

报警方式：发现问题时用 gh 创建 GitHub Issue（标题固定去重，已有 open Issue 则跳过）
"""

import datetime
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

BASE_URL = os.environ.get("BASE_URL", "https://cangwei-man-shang.onrender.com")
ISSUE_TITLE = "[监控] 线上健康异常"

# ---- 阈值（按需调整） ----
FRESHNESS_ALERT_DAYS = 3    # 数据落后 >=3 自然日告警（周末 2 天 + 1 缓冲）
MIN_POOL = 100              # 股票池少于 100 只告警（正常 200）
MIN_KLINES = 10000          # K线少于 1 万条告警（正常 ~12.4 万）
SYNC_WINDOW_START = "15:30"  # 北京时间收盘同步窗口，窗口内跳过新鲜度检查
SYNC_WINDOW_END = "18:00"
# -------------------------


def beijing_now():
    return datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8)))


def in_sync_window():
    now = beijing_now()
    t = now.strftime("%H:%M")
    return SYNC_WINDOW_START <= t <= SYNC_WINDOW_END


def http_json(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": "monitor"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode())


def fetch_version():
    """服务可用性检查：冷启动可能较慢，重试 3 次"""
    last_err = None
    for i in range(3):
        try:
            status, data = http_json(f"{BASE_URL}/api/version", timeout=120)
            if status == 200 and data.get("version"):
                return True, data.get("version")
            last_err = f"HTTP {status}"
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
    return False, last_err


def fetch_health():
    status, data = http_json(f"{BASE_URL}/api/monitor/health", timeout=120)
    return data


def run_gh(args):
    """执行 gh 命令；gh 不可用（本地/CI 异常）时降级为警告，不崩溃"""
    try:
        return subprocess.run(["gh"] + args, capture_output=True, text=True)
    except FileNotFoundError:
        print("⚠️ gh CLI 不可用，跳过 Issue 操作")
        return None


def open_issue_exists():
    r = run_gh(["issue", "list", "--state", "open", "--search", f'"{ISSUE_TITLE}"', "--limit", "10"])
    if r is None:
        return False
    if r.returncode != 0:
        print(f"⚠️ 查询 Issue 失败: {r.stderr.strip()}")
        return False
    return ISSUE_TITLE in r.stdout


def create_issue(body):
    with open("/tmp/monitor_issue_body.md", "w", encoding="utf-8") as f:
        f.write(body)
    r = run_gh(["issue", "create", "--title", ISSUE_TITLE, "--body-file", "/tmp/monitor_issue_body.md"])
    if r is None:
        return
    if r.returncode == 0:
        print(f"✅ 已创建 Issue: {r.stdout.strip()}")
    else:
        print(f"❌ 创建 Issue 失败: {r.stderr.strip()}")


def build_body(problems, health, version, checked_at):
    lines = [f"## ⚠️ 线上服务健康异常", "", f"**检查时间**: {checked_at} (北京时间)", f"**服务版本**: {version}", ""]
    lines.append("### 发现问题")
    for i, p in enumerate(problems, 1):
        lines.append(f"{i}. **{p[0]}** — {p[1]}")
    lines.append("")
    lines.append("### 健康快照")
    db = health.get("db", {})
    f = health.get("freshness", {})
    s = health.get("signals", {})
    lines.append("| 指标 | 值 |")
    lines.append("|---|---|")
    rows = [
        ("pool 股票池", db.get("pool")), ("stock_info", db.get("stocks")),
        ("daily_kline", db.get("klines")), ("indicators", db.get("indicators")),
        ("scores", db.get("scores")),
        ("finance", db.get("finance")),
        ("K线最新日期", f.get("kline_latest")), ("评分最新日期", f.get("score_latest")),
        ("期望日期", f.get("expected")),
        ("信号分布", f"buy {s.get('buy')} / watch {s.get('watch')} / hold {s.get('hold')} / sell {s.get('sell')} / total {s.get('total')}"),
        ("同步状态", health.get("sync", {}).get("running")),
    ]
    for k, v in rows:
        lines.append(f"| {k} | {v} |")
    lines.append("")
    lines.append("---")
    lines.append("_此 Issue 由监控任务每小时自动检查创建，修复后请手动关闭；持续异常时不会重复创建。_")
    return "\n".join(lines)


def main():
    checked_at = beijing_now().strftime("%Y-%m-%d %H:%M")
    problems = []
    version = "unknown"

    # 1. 服务可用性
    ok, info = fetch_version()
    if ok:
        version = info
        print(f"✅ 服务可用, version={version}")
    else:
        problems.append(("服务不可用", f"/api/version 连续 3 次检查失败 ({info})"))
        print(f"❌ 服务不可用: {info}")

    # 2. 健康接口（服务不可用时也要尝试，可能只是 version 接口抖动）
    try:
        health = fetch_health()
    except Exception as e:
        health = None
        problems.append(("监控接口异常", f"/api/monitor/health 调用失败 ({type(e).__name__}: {e})"))
        print(f"❌ 监控接口异常: {e}")

    if health:
        db = health.get("db", {})
        f = health.get("freshness", {})
        s = health.get("signals", {})

        # 3. 数据新鲜度（同步窗口内跳过，避免误报）
        if not in_sync_window():
            for name, diff, latest in (("K线", f.get("kline_diff_days"), f.get("kline_latest")),
                                       ("评分", f.get("score_diff_days"), f.get("score_latest"))):
                if diff is None:
                    problems.append((f"{name}数据缺失", "最新日期为空（表无数据）"))
                elif diff >= FRESHNESS_ALERT_DAYS:
                    problems.append((f"{name}数据过期", f"最新 {latest}，期望 {f.get('expected')}，落后 {diff} 天"))
            print(f"ℹ️ 新鲜度: K线 {f.get('kline_diff_days')}天 / 评分 {f.get('score_diff_days')}天")
        else:
            print(f"ℹ️ 同步窗口内，跳过新鲜度检查")

        # 4. 数据完整性
        if db.get("pool", 0) < MIN_POOL:
            problems.append(("股票池不足", f"pool={db.get('pool')}（阈值 {MIN_POOL}）"))
        if db.get("klines", 0) < MIN_KLINES:
            problems.append(("K线数据量异常", f"klines={db.get('klines')}（阈值 {MIN_KLINES}）"))
        for name, key in (("指标", "indicators"), ("财务", "finance")):
            if db.get(key, 0) == 0:
                problems.append((f"{name}数据为空", f"{key}=0"))

        # 5. 信号合理性（覆盖不足 / 全部 sell）
        total = s.get("total", 0)
        if total < 50:
            problems.append(("评分覆盖不足", f"最新评分 {total} 只（期望 ≥50）"))
        elif s.get("buy", 0) + s.get("watch", 0) + s.get("hold", 0) == 0:
            problems.append(("信号分布异常", f"全部为 sell（buy/watch/hold 均为 0，total={total}）"))
        print(f"ℹ️ 信号: {s}")

        # 打印快照
        print(f"ℹ️ DB: pool={db.get('pool')} klines={db.get('klines')} indicators={db.get('indicators')} "
              f"scores={db.get('scores')} finance={db.get('finance')}")
        print(f"ℹ️ 同步: {health.get('sync')}")

    # 6. 报警
    if problems:
        print(f"⚠️ 发现 {len(problems)} 个问题，尝试创建 Issue...")
        if not open_issue_exists():
            create_issue(build_body(problems, health or {}, version, checked_at))
        else:
            print("ℹ️ 已存在相同标题的 open Issue，跳过（避免刷屏）")
        sys.exit(1)
    else:
        print("✅ 全部健康")
        sys.exit(0)


if __name__ == "__main__":
    main()
