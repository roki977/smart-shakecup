#!/bin/sh
# 重新打包 3D 杯子：在 src/ 目录里运行  npm install && sh build.sh
# 输出 ../cup3d.js（单文件、已压缩，只含用到的 three.js 部分），网页直接用普通 <script> 引入。
cd "$(dirname "$0")" && npx esbuild cup3d.js --bundle --minify --format=iife --target=es2020 \
  --legal-comments=eof --banner:js="/* 微醺练习室 3D 摇酒壶。源码 src/cup3d.js，用 src/build.sh 生成，别直接改这个文件。three.js MIT License */" \
  --outfile=../cup3d.js
