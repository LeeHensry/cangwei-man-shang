#!/bin/bash
# 等待Render部署到指定版本
TARGET=${1:-v1.7.5}
echo "等待部署 $TARGET (最多8分钟)..."
for i in $(seq 1 60); do
  sleep 8
  v=$(curl -s --max-time 20 https://cangwei-man-shang.onrender.com/api/version 2>&1)
  echo "[$i] $v"
  if echo "$v" | grep -q "$TARGET"; then
    bt=$(echo "$v" | grep -o '"build_time":"[^"]*"' | cut -d'"' -f4)
    echo "部署完成! $TARGET build_time=$bt"
    exit 0
  fi
done
echo "超时未检测到 $TARGET"
exit 1
