"""测试数据集（dataset.js）：模拟杯子摇两杯 → 自动存下 → 结果页标注 → 弹窗筛选、导出、删除、导入。
仓库根目录先起 python3 -m http.server 8765，再在 tests/ 里运行。"""
import asyncio, json
from playwright.async_api import async_playwright

SHAKE = """async ({ endTemp }) => {
  dev.state = 'live'; dev.lastAt = Date.now(); dev.cfg = { device: 'test-cup' };
  start(); document.querySelector('#countdown-skip').click();
  let ms = 1000, seq = 0;
  const send = (hz, temp) => { dev.lastAt = Date.now(); const m = { v: 1, seq: seq++, ms, temp: [temp, temp + .1, null], hz, amp: 14 }; onDeviceData(m, JSON.stringify(m)); ms += 100; };
  for (let i = 0; i < 10; i++) send(0, 22);
  for (let i = 0; i < 60; i++) send(3, 20 - i * (20 - endTemp) / 60);
  for (let i = 0; i < 32; i++) send(0, endTemp);
  await new Promise(r => setTimeout(r, 400));
  const dlg = document.querySelector('#modal'); if (dlg.open) dlg.close();   // 解锁图鉴的弹窗
  return { completed, box: !document.querySelector('#ds-label').hidden, text: document.querySelector('#ds-label').textContent.trim().slice(0, 20) };
}"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); errs = []
        ctx = await b.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
        pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8765/'); await pg.wait_for_timeout(600)
        print('topbar hidden before any data:', await pg.evaluate("getComputedStyle(document.querySelector('#open-dataset')).display"))

        print('run 1', await pg.evaluate(SHAKE, {'endTemp': -2}))
        await pg.click('#ds-label [data-label="good"]'); await pg.fill('#ds-label .ds-note', '标准动作'); await pg.press('#ds-label .ds-note', 'Tab')
        await pg.wait_for_timeout(200)
        await pg.screenshot(path='shots/dataset-result.png', full_page=True)
        await pg.evaluate("reset()")
        print('run 2', await pg.evaluate(SHAKE, {'endTemp': 8}))
        await pg.click('#ds-label [data-label="bad"]'); await pg.wait_for_timeout(200)
        await pg.evaluate("reset()")
        # 模拟数据不应该进数据集
        await pg.evaluate("dev.state = 'off'; start(); document.querySelector('#countdown-skip').click()")
        await pg.wait_for_timeout(1500); await pg.evaluate("finish()"); await pg.wait_for_timeout(300)
        print('demo run shows label box:', await pg.evaluate("!document.querySelector('#ds-label').hidden"))
        await pg.evaluate("reset()")
        # 连着杯子（但掉线了）却跑成了模拟数据：结果页要说明没存
        await pg.evaluate("dev.client = {}; dev.state = 'lost'; start(); document.querySelector('#countdown-skip').click()")
        await pg.wait_for_timeout(1500); await pg.evaluate("finish()"); await pg.wait_for_timeout(300)
        print('demo-after-connect note:', await pg.evaluate("document.querySelector('#ds-label').hidden ? 'HIDDEN' : document.querySelector('#ds-label').textContent.slice(0, 30)"))
        await pg.evaluate("reset(); dev.client = null; dev.state = 'off'")

        runs = await pg.evaluate("dsAll().then(a => a.map(r => [r.label, r.note, r.score, r.packets.length, r.samples.length, r.device]))")
        print('stored', runs)
        print('count badge:', await pg.text_content('#dataset-count'))

        await pg.click('#open-dataset'); await pg.wait_for_timeout(400)
        print('modal runs:', await pg.locator('.ds-run').count())
        await pg.screenshot(path='shots/dataset-modal.png', full_page=True)
        await pg.click('[data-filter="bad"]'); await pg.wait_for_timeout(300)
        print('bad filter runs:', await pg.locator('.ds-run').count())
        await pg.click('[data-filter="all"]'); await pg.wait_for_timeout(300)

        async with pg.expect_download() as d: await pg.click('#ds-json')
        path = await (await d.value).path(); data = json.load(open(path))
        print('json:', data['format'], len(data['runs']), [r['label'] for r in data['runs']], 'raw packet ok:', json.loads(data['runs'][0]['packets'][0][1])['v'] == 1)
        async with pg.expect_download() as d: await pg.click('#ds-csv')
        csv = open(await (await d.value).path(), encoding='utf-8-sig').read().splitlines()
        print('csv:', csv[0]); print('csv rows:', len(csv) - 1)

        # 删除（点两次）再导入
        first = pg.locator('.ds-run').first
        await first.locator('.ds-del').click(); await first.locator('.ds-del').click(); await pg.wait_for_timeout(400)
        print('after delete:', await pg.locator('.ds-run').count())
        await pg.set_input_files('#ds-file', path); await pg.wait_for_timeout(500)
        print('after import:', await pg.locator('.ds-run').count(), '|', await pg.text_content('#ds-msg'))

        m = await ctx.new_page(); await m.set_viewport_size({'width': 390, 'height': 844})
        await m.goto('http://localhost:8765/'); await m.wait_for_timeout(500)
        await m.click('#open-dataset'); await m.wait_for_timeout(400)
        print('mobile overflow:', await m.evaluate("document.querySelector('dialog').scrollWidth - document.querySelector('dialog').clientWidth"))
        await m.screenshot(path='shots/dataset-mobile.png', full_page=True)
        print('errors', errs); await b.close()
asyncio.run(main())
