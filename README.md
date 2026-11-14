# 微醺练习室

智能 Shake 杯的配套网页（HKUST(GZ) 创新创业黑客松）。纯静态网站，不需要构建。

- 本地预览：在这个文件夹里运行 `python3 -m http.server 8765`，打开 http://localhost:8765
- 线上地址：https://roki977.github.io/smart-shakecup/
- 部署：GitHub Pages 从 `gh-pages` 分支发布。改完代码后 `git push origin main main:gh-pages`，一两分钟后生效。必须是 https 网址，网页才能用 wss 连 MQTT 服务器收杯子数据。
- 杯子数据格式见 `接口说明.md`；没有硬件时用 `device-sim.html` 当假杯子。

酒的照片和配方来自 IBA（国际调酒师协会）官网，照片版权归 IBA。
