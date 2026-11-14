"""标准曲线：真杯子摇一杯 → 存为标准曲线 → 图鉴里看到 → 跟这条练（演示数据）也能出分"""
from playwright.sync_api import sync_playwright
import json
JS = open('devalgo_ideal.py').read().split('JS = """')[1].split('"""')[0]
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:8766/'); pg.wait_for_timeout(1000)
    print('recipe', pg.evaluate('recipe.id'), pg.evaluate(JS, 0))
    pg.wait_for_function('!/…/.test(document.querySelector("#result-score").textContent)', timeout=30000); pg.wait_for_timeout(1500)
    print('final', pg.text_content('#result-score'), '| save button:', bool(pg.query_selector('#save-curve')))
    pg.evaluate("document.querySelector('#modal').open && document.querySelector('#modal').close()"); pg.click('#save-curve'); pg.fill('#curve-form [name=who]', '测试调酒师'); pg.fill('#curve-form [name=ice]', '方冰 6 块')
    pg.click('#curve-form button[type=submit]'); pg.wait_for_timeout(1000)
    print('after save:', pg.text_content('#save-curve'), '| error:', pg.evaluate("document.querySelector('#curve-error')?.textContent"))
    recs = json.load(open('../调酒知识库/标准曲线记录.json'))['records']
    print('records in file:', len(recs), recs and {k: len(v['points']) for k, v in recs[-1]['curves'].items()})
    pg.click('#again'); pg.wait_for_timeout(500)
    pg.evaluate("openRecipe('whiskey-sour')"); pg.wait_for_timeout(1200)
    print('modal curves:', pg.eval_on_selector_all('#rc-curve .curve-row b', 'x=>x.map(e=>e.textContent)'))
    pg.screenshot(path='/home/claude/shots/curve-modal.png')
    pg.click('[data-use-curve="0"]'); pg.wait_for_timeout(600)
    print('ref chip:', pg.text_content('#ref-chip').strip()[:60])
    pg.evaluate("chooseScenario = () => ({...scenarios[0]})")
    pg.click('#start'); pg.click('#prep-skip'); pg.click('#countdown-skip')
    pg.wait_for_function('document.querySelector("#confirm-finish").classList.contains("ready")', timeout=30000)
    pg.evaluate('finish()'); pg.wait_for_function('!/…/.test(document.querySelector("#result-score").textContent)', timeout=15000); pg.wait_for_timeout(1500)
    print('practice vs measured curve:', pg.text_content('#result-score'), '| ref id:', pg.evaluate('algo.last.payload.reference.id'), '| save shown for sim:', bool(pg.query_selector('#save-curve')))
    print('errors', errs); b.close()
