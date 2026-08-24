#!/bin/bash
for i in 1 2 3 4 5; do
  v=$(curl -s --max-time 40 https://cangwei-man-shang.onrender.com/api/version 2>&1)
  echo "wake $i: $v"
  sleep 2
done
