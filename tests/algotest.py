"""评分服务接入：用 server.py 打开网站，演示数据跑完一轮，看实时分和结果是不是来自评分服务。"""
import sys
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8766/'
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    reqs = []; pg.on('request', lambda r: reqs.append(r.url) if '/api/' in r.url else None)
    pg.goto(URL); pg.wait_for_timeout(1200)
    print('available:', pg.evaluate('algo.available'), '| recipes:', pg.evaluate('RECIPES.length'), '|', pg.text_content('#score-source'))
    pg.click('#start'); pg.click('#prep-skip'); pg.click('#countdown-skip')
    for i in range(8):
        pg.wait_for_timeout(2000)
        print(f'{2*(i+1)}s score:', pg.text_content('#score'), '|', pg.text_content('#score-source'), '| scenario:', pg.evaluate('activeScenario.name'))
    pg.wait_for_function('document.querySelector("#confirm-finish").classList.contains("ready") || !running', timeout=20000)
    pg.evaluate('finish()')
    pg.wait_for_function('!/…/.test(document.querySelector("#result-score").textContent)', timeout=15000)
    pg.wait_for_timeout(1200)
    print('result:', pg.text_content('#result-score'), '|', pg.text_content('#result-summary'))
    print('issues:', pg.eval_on_selector_all('.issues b', 'xs => xs.map(x => x.textContent)'))
    print('detail:', pg.text_content('#part-detail'))
    print('local score was:', pg.evaluate('finalParts?.total'), '| stars:', pg.eval_on_selector_all('.star.on', 'x=>x.length'))
    if pg.query_selector('[data-issue]'):
        pg.click('[data-issue="0"]'); print('bands drawn:', pg.eval_on_selector_all('#chart .band', 'x=>x.length'))
    pg.screenshot(path='shots/algo-result.png', full_page=True)
    print('api calls:', len(reqs), sorted(set(u.split('/api/')[1].split('/')[0] + ('/' + u.rsplit('/', 1)[1] if u.count('/') > 4 else '') for u in reqs))[:6])
    print('errors', errs)
    b.close()
