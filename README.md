# 微醺练习室

智能 Shake 杯的配套网页（HKUST(GZ) 创新创业黑客松）。纯静态网站，不需要构建。

- 本地预览：在这个文件夹里运行 `python3 -m http.server 8765`，打开 http://localhost:8765
- 带评分服务运行（推荐）：先 `python3 -m pip install -r 调酒算法/requirements.txt`，再运行 `python3 调酒算法/server.py --port 8766`，打开 http://127.0.0.1:8766 。操作符合度由评分服务计算（温度、节奏、动作幅度和参考比），结果页列出和参考差在哪几段。不开评分服务时（包括 GitHub Pages），练习页用网页自带的演示估算，页面上会写明。
- 图鉴 117 款来自知识库；每款有标准曲线（实测的存在知识库里，没实测的显示演示曲线）。接真杯子并开评分服务时，摇完可以把这一杯存为标准曲线。
- 评分算法在 `调酒算法/`（Python），配方知识库在 `调酒知识库/`，来自队友的交接包；规则和参考目前是演示用的合成值。网页用的图鉴数据是 `catalog.js`（117 款），知识库更新后运行 `python3 scripts/build_catalog.py` 重新生成。
- 线上地址：https://roki977.github.io/smart-shakecup/
- 部署：GitHub Pages 从 `gh-pages` 分支发布。改完代码后 `git push origin main main:gh-pages`，一两分钟后生效。必须是 https 网址，网页才能用 wss 连 MQTT 服务器收杯子数据。
- 本机服务器（现场演示推荐，延迟低、不怕没网）：`本机服务器/start-mac.command` / `start-windows.bat`，见《硬件接入指南》。
- 调试台：https://roki977.github.io/smart-shakecup/debug.html （看传感器原始数据）
- 社区：默认本机模式；开云端见 `社区云端设置.md`
- 硬件同学看 `硬件接入指南.md`；数据格式见 `接口说明.md`；没有硬件时用 `device-sim.html` 当假杯子。
- 练习页的实时 3D 杯子是 `cup3d.js`，由 `src/cup3d.js` 打包生成，改了源码要在 `src/` 里运行 `npm install && sh build.sh`。网站本身仍然不需要构建。

酒的照片和配方来自 IBA（国际调酒师协会）官网，照片版权归 IBA。
