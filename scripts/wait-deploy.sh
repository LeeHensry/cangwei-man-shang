#!/bin/bash
TARGET=${1:-v1.7.4}
for i in $(seq 1 30); do
  sleep 8
  v=$(curl -s --max-time 20 https://cangwei-man-shang.onrender.com/api/version 2>&1)
  echo "[$i] $v"
  if echo "$v" | grep -q "$TARGET"; then echo "DEPLOYED $TARGET!"; exit 0; fi
done
echo "Timeout"
