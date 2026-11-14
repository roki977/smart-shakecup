# 微醺练习室

智能 Shake 杯的配套网页（HKUST(GZ) 创新创业黑客松）。纯静态网站，不需要构建。

- 本地预览：在这个文件夹里运行 `python3 -m http.server 8765`，打开 http://localhost:8765
- 部署：整个文件夹推到 GitHub 仓库，Settings → Pages → Source 选 `main` 分支、根目录。必须是 https 网址，网页才能用 wss 连 MQTT 服务器收杯子数据。
- 杯子数据格式见 `接口说明.md`；没有硬件时用 `device-sim.html` 当假杯子。

酒的照片和配方来自 IBA（国际调酒师协会）官网，照片版权归 IBA。
