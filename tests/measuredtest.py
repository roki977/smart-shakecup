"""白色佳人实测温度参考（references.js + curves.js）：默认选上、图鉴里能看能换、参考有缺口不跨着连、点“不用了”不再自动选。"""
import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 1280, 'height': 900})
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8765/'); await pg.wait_for_timeout(700)
        await pg.click('[data-pick="white-lady"]'); await pg.wait_for_timeout(500)
        print('default ref:', await pg.evaluate("[practiceRef?.title, practiceRef?.absolute]"))
        # 缺口：两点相距 > 0.5 秒的地方没有参考值
        print('gap null:', await pg.evaluate("(() => { const c = practiceRef.curve; for (let i = 1; i < c.length; i++) if (c[i].t - c[i-1].t > .5) return [c[i-1].t, c[i].t, measuredAt(c, (c[i-1].t + c[i].t) / 2)]; })()"))
        print('outside range:', await pg.evaluate("[measuredAt(practiceRef.curve, -1), measuredAt(practiceRef.curve, 999)]"))
        await pg.evaluate("openRecipe('white-lady')"); await pg.wait_for_timeout(600)
        print('codex rows:', await pg.evaluate("$$('#rc-curve .curve-row.measured').length"))
        await pg.click('[data-use-measured="1"]'); await pg.wait_for_timeout(300)
        print('switched:', await pg.evaluate("practiceRef.title"))
        await pg.click('#ref-clear'); await pg.evaluate("renderRecipe()")
        print('dismissed stays off:', await pg.evaluate("practiceRef"))
        await pg.click('[data-pick="whiskey-sour"]'); await pg.wait_for_timeout(300)
        print('other drink no ref:', await pg.evaluate("practiceRef"))
        print('errors', errs); await b.close()
asyncio.run(main())
