#!/bin/bash
# Run score batches in sequence
for i in $(seq 1 20); do
  result=$(curl -s --max-time 55 -X POST "https://cangwei-man-shang.onrender.com/api/sync/step?step=score-batch&batchSize=10" 2>&1)
  progress=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{d.get(\"progress\",\"?\")} done={d.get(\"done\")}')" 2>&1)
  echo "batch $i: $progress"
  if echo "$result" | grep -q '"done":true'; then echo "ALL DONE!"; break; fi
  sleep 0.5
done
