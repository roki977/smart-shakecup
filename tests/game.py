import asyncio, sys
from playwright.async_api import async_playwright
OUT = 'shots/g'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); errs = []
        for nm, vw, vh in [('desk', 1280, 860), ('phone', 390, 844)]:
            pg = await b.new_page(viewport={'width': vw, 'height': vh}); pg.on('pageerror', lambda e: errs.append(f'{nm}: {e}'))
            pg.on('console', lambda m: m.type == 'error' and errs.append(f'{nm} console: {m.text}'))
            await pg.goto('http://localhost:8765/'); await pg.evaluate("localStorage.clear(); localStorage.setItem('amber-codex-v1', JSON.stringify({'whiskey-sour':{best:92,passes:3},'daiquiri':{best:84,passes:1}}))"); await pg.reload(); await pg.wait_for_timeout(900)
            await pg.screenshot(path=f'{OUT}-{nm}-1setup.png', full_page=True)
            await pg.click('#open-codex'); await pg.wait_for_timeout(900)
            await pg.screenshot(path=f'{OUT}-{nm}-2codex.png', full_page=True)
            await pg.click('[data-recipe="whiskey-sour"]'); await pg.wait_for_timeout(700)
            await pg.screenshot(path=f'{OUT}-{nm}-3recipe.png')
            await pg.click('#practice-this'); await pg.wait_for_timeout(400)
            await pg.evaluate("() => { previousScenario = 1; }")
            await pg.click('#start'); await pg.wait_for_timeout(5200)
            await pg.screenshot(path=f'{OUT}-{nm}-4live.png')
            await pg.evaluate("() => { clearInterval(timer); for (let i=22;i<=56;i++) consumeSample(demoSample(i*.25)); finish(); }"); await pg.wait_for_timeout(2200)
            await pg.evaluate("() => document.querySelector('#modal').open && document.querySelector('#modal').close()")
            await pg.screenshot(path=f'{OUT}-{nm}-5result.png', full_page=True)
            await pg.evaluate("() => { reset(); }")
            await pg.click('#open-community'); await pg.wait_for_timeout(900)
            await pg.screenshot(path=f'{OUT}-{nm}-6comm.png', full_page=nm == 'desk')
            await pg.evaluate("() => showUnlock(RECIPES[1], '解锁了')"); await pg.wait_for_timeout(800)
            await pg.screenshot(path=f'{OUT}-{nm}-7unlock.png')
            await pg.close()
        print('errors', errs); await b.close()
asyncio.run(main())
