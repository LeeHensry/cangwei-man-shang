#!/usr/bin/env bash
set -x
echo "========= [BUILD START] $(date) ========="
echo "PWD=$PWD"
echo "Node: $(node -v)"
echo "npm: $(npm -v)"
ls -la
echo "--- 安装后端依赖 ---"
npm install --loglevel=error
if [ $? -ne 0 ]; then echo "后端 npm install 失败"; exit 1; fi
echo "--- 后端 node_modules ---"
ls node_modules/ 2>/dev/null | head -10
echo "--- 进入web目录安装前端依赖 ---"
cd web
pwd
ls -la
npm install --loglevel=error
if [ $? -ne 0 ]; then echo "前端 npm install 失败"; exit 1; fi
echo "--- 检查 vite 是否安装 ---"
ls node_modules/.bin/vite 2>&1
ls node_modules/vite/package.json 2>&1 && node -e "console.log('vite version:', require('./node_modules/vite/package.json').version)"
echo "--- 执行 vite build ---"
npm run build
BUILD_RC=$?
echo "vite build exit code: $BUILD_RC"
echo "--- 构建产物 ---"
ls -la dist/ 2>&1
ls -la dist/assets/ 2>&1
if [ ! -f dist/index.html ]; then
  echo "BUILD FAILED: dist/index.html 不存在"
  exit 1
fi
cd ..
echo "========= [BUILD SUCCESS] $(date) ========="
