import asyncio, sys
from playwright.async_api import async_playwright
sizes=[(1280,800),(1440,900),(768,1024),(390,844),(375,667)]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); errs=[]
        for th in sys.argv[1:] or ['real','pixel']:
            for vw,vh in sizes:
                pg = await b.new_page(viewport={'width':vw,'height':vh})
                pg.on('pageerror', lambda e: errs.append(str(e)))
                await pg.goto('http://localhost:8765/'); await pg.evaluate(f"localStorage.clear();localStorage.setItem('shakecup-theme','{th}')"); await pg.reload(); await pg.wait_for_timeout(600)
                await pg.evaluate("() => { previousScenario = 0; window.__noCount = 1 }")
                await pg.click('#start'); await pg.wait_for_timeout(8500)
                over = await pg.evaluate("() => document.documentElement.scrollHeight - innerHeight")
                print(th, vw, vh, 'overflow px:', over)
                await pg.screenshot(path=f'shots/live-{th}-{vw}.png')
                await pg.close()
        print(errs); await b.close()
asyncio.run(main())
