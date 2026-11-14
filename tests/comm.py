import asyncio
from playwright.async_api import async_playwright
OUT = 'shots/comm'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); errs = []
        for th in ['real', 'pixel']:
            for nm, vw, vh in [('desk', 1280, 900), ('phone', 390, 844)]:
                pg = await b.new_page(viewport={'width': vw, 'height': vh}); pg.on('pageerror', lambda e: errs.append(f'{th}-{nm}: {e}'))
                await pg.goto('http://localhost:8765/'); await pg.evaluate(f"localStorage.clear(); localStorage.setItem('shakecup-theme','{th}')"); await pg.reload(); await pg.wait_for_timeout(500)
                await pg.click('#open-community'); await pg.wait_for_timeout(700)
                await pg.screenshot(path=f'{OUT}-{th}-{nm}-feed.png', full_page=nm == 'desk')
                await pg.click('[data-post="seed-aj-wl"]'); await pg.wait_for_timeout(500)
                await pg.screenshot(path=f'{OUT}-{th}-{nm}-post.png')
                if th == 'real' and nm == 'desk':
                    # 评论 + 点赞
                    await pg.fill('#comment-form input[name=name]', '测试同学'); await pg.fill('#comment-form input[name=text]', '跟着练试试'); await pg.click('#comment-form button')
                    await pg.wait_for_timeout(500); await pg.click('#like'); await pg.wait_for_timeout(200)
                    print('comment+like:', await pg.evaluate("() => [document.querySelector('.comments-title').textContent, document.querySelector('#like span').textContent, document.querySelector('#like').className]"))
                    # 用这条曲线练
                    await pg.click('#use-curve'); await pg.wait_for_timeout(500)
                    await pg.screenshot(path=f'{OUT}-{th}-{nm}-refchip.png')
                    print('chip:', await pg.evaluate("() => [document.querySelector('#recipe-name').textContent, document.querySelector('#ref-chip').innerText.replace(/\\n/g,' '), document.querySelector('[data-mode=standard] span').textContent]"))
                    await pg.evaluate("() => { previousScenario = 1; start(); cancelCountdown(); clearInterval(timer); for (let i=1;i<=56;i++) consumeSample(demoSample(i*.25)); }")
                    print('practice target/rhythm/ref:', await pg.evaluate("() => [target, desiredRhythm, samples[0].reference.toFixed(2), samples[28].reference.toFixed(2), samples.at(-1).reference.toFixed(2), practiceRef.curve.at(-1).temp]"))
                    await pg.evaluate("() => { finish(); document.querySelector('#modal').open && document.querySelector('#modal').close(); }"); await pg.wait_for_timeout(400)
                    await pg.screenshot(path=f'{OUT}-{th}-{nm}-result.png', full_page=True)
                    # 分享这次
                    await pg.click('#share-community'); await pg.wait_for_timeout(400)
                    await pg.fill('#composer input[name=title]', '跟阿杰的曲线练的第一杯'); await pg.fill('#composer textarea[name=body]', '中间节奏掉了一下，下次注意。')
                    await pg.click('.tag-pick label:nth-child(1) span')
                    await pg.screenshot(path=f'{OUT}-{th}-{nm}-composer.png')
                    await pg.click('#composer button[type=submit]'); await pg.wait_for_timeout(900)
                    await pg.screenshot(path=f'{OUT}-{th}-{nm}-newpost.png')
                    print('new post modal:', await pg.evaluate("() => document.querySelector('.post-detail h2')?.textContent"))
                    # 发一个自创配方
                    await pg.evaluate("() => document.querySelector('#modal').close()")
                    await pg.click('#comm-post'); await pg.wait_for_timeout(300)
                    await pg.click('[data-ckind=recipe]')
                    await pg.fill('#composer input[name=title]', '荔枝金酒酸'); await pg.fill('#composer input[name=r-name]', '荔枝金酒酸')
                    rows = await pg.query_selector_all('.ing-row')
                    for r, (n, ml) in zip(rows, [('金酒', '45'), ('鲜柠檬汁', '20'), ('荔枝糖浆', '20')]):
                        ins = await r.query_selector_all('input'); await ins[0].fill(n); await ins[1].fill(ml)
                    await pg.fill('#composer textarea[name=r-how]', '加冰摇 12 秒，滤入碟形杯。')
                    await pg.screenshot(path=f'{OUT}-{th}-{nm}-composer-recipe.png')
                    await pg.click('#composer button[type=submit]'); await pg.wait_for_timeout(900)
                    await pg.click('#use-recipe'); await pg.wait_for_timeout(500)
                    print('custom recipe setup:', await pg.evaluate("() => [document.querySelector('#recipe-name').textContent, [...document.querySelectorAll('#pour dt')].map(d=>d.textContent).join('/')]"))
                    await pg.screenshot(path=f'{OUT}-{th}-{nm}-custom.png')
                    await pg.click('#open-community'); await pg.wait_for_timeout(600)
                    print('feed count:', await pg.evaluate("() => document.querySelectorAll('#feed .post-card').length"))
                    await pg.screenshot(path=f'{OUT}-{th}-{nm}-feed2.png', full_page=True)
                await pg.close()
        print('errors', errs); await b.close()
asyncio.run(main())
