#!/bin/bash
for i in $(seq 1 30); do
  sleep 6
  v=$(curl -s --max-time 20 https://cangwei-man-shang.onrender.com/api/version 2>&1)
  echo "[$i] $v"
  if echo "$v" | grep -q "v1.7.2"; then echo "DEPLOYED!"; break; fi
done
