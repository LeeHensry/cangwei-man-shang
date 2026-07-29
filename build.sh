#!/bin/bash
set -e
echo "=== [build] 安装后端依赖 ==="
npm install
echo "=== [build] 后端node_modules版本 ==="
node -e "console.log('better-sqlite3:', require('better-sqlite3').VERSION)"
echo "=== [build] 安装前端依赖 ==="
cd web
npm install
echo "=== [build] 前端依赖检查 ==="
ls node_modules/.bin/vite 2>&1
echo "=== [build] 执行前端构建 ==="
npm run build
echo "=== [build] 构建产物 ==="
ls -la dist/
echo "=== [build] assets文件 ==="
ls -la dist/assets/ 2>&1 | head
echo "=== [build] 构建完成 ==="
