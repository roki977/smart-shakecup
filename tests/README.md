# 自动测试（Playwright）

先 `pip install playwright && playwright install chromium`，在 tests/ 里运行。

网站部分：仓库根目录起 `python3 -m http.server 8765`

| 脚本 | 测什么 |
|---|---|
| live.py | 练习页在 5 种屏幕尺寸下是否溢出（应全为 0） |
| devtest.py | 接杯子后的数据流程：摇起来计时、放下 3 秒自动结算 |
| comm.py | 社区：发帖、评论、点赞、跟曲线练、自创配方 |
| cloudtest.py | 社区云端（用假的 Supabase 接口测） |
| debugtest.py | 调试台的各项检查 |
| t90test.py | 降温曲线相关计算 |
| game.py | 所有页面截图到 shots/，人工检查用 |

评分服务部分：仓库根目录起 `python3 调酒算法/server.py --port 8766`

| 脚本 | 测什么 |
|---|---|
| algotest.py | 演示数据跑完一轮：实时分、最终分、复盘问题都来自评分服务 |
| devalgo.py | 模拟固件发原始加速度包（含 8% 丢包），评分服务能算出结果 |

算法本身的单元测试在 `调酒算法/`、`调酒知识库/` 里：`python3 -m unittest discover`。
