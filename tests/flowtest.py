"""练习时的完整步骤（flow.js）：准备步骤自己点完成 → 摇和 → 收尾步骤，不强制顺序；手机上不横向溢出。
仓库根目录先起 python3 -m http.server 8765，再在 tests/ 里运行。"""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); errs = []
        pg = await b.new_page(viewport={'width': 1280, 'height': 900}); pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8765/'); await pg.wait_for_timeout(600)
        # 步骤多的一款：找一个摇和前至少两步的
        rid = await pg.evaluate("RECIPES.find(r => r.shake && flowOf(r).findIndex(x => x.sensor) >= 2).id")
        await pg.evaluate(f"recipe = RECIPES.find(r => r.id === '{rid}'); renderRecipe()")
        await pg.click('#start'); await pg.wait_for_timeout(300)
        print(rid, 'prep:', await pg.evaluate("[flow.phase, $$('.fr').map(x => x.className.replace('fr ', '')).join(' | ')]"))
        # 不按顺序：先点第 2 步标完成，当前步应该还是第 1 步
        await pg.click('.fr[data-i="1"] button'); await pg.wait_for_timeout(200)
        print('out of order:', await pg.evaluate("[flowCurrent(), $('#prep-title').textContent]"))
        while await pg.evaluate("flow.phase === 'prep'"):
            await pg.click('#prep-done'); await pg.wait_for_timeout(150)
        print('to shake:', await pg.evaluate("[flow.phase, running, !$('#countdown').hidden]"))
        await pg.click('#countdown-skip'); await pg.wait_for_timeout(2000)
        await pg.evaluate("finish()"); await pg.wait_for_timeout(800)
        print('after:', await pg.evaluate("[flow.phase, $('#flow-hint').textContent]"))
        # 没有前置步骤的（自己搭 / 社区配方走默认流程也有加料，这里用直接 start() 的路径）
        await pg.click('#again'); await pg.wait_for_timeout(300)
        await pg.evaluate("start()"); await pg.wait_for_timeout(300)
        print('direct start():', await pg.evaluate("[flow.phase, $$('.fr.done').length]"))
        await pg.evaluate("reset()")
        for w, h in [(390, 844), (375, 667)]:
            m = await b.new_page(viewport={'width': w, 'height': h}); await m.goto('http://localhost:8765/'); await m.wait_for_timeout(500)
            await m.click('#start'); await m.wait_for_timeout(300)
            print(w, 'overflow', await m.evaluate("document.documentElement.scrollWidth - innerWidth"))
            await m.close()
        print('errors', errs); await b.close()
asyncio.run(main())
