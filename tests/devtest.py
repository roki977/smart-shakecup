import asyncio
from playwright.async_api import async_playwright
JS = """async () => {
  const log = [];
  dev.state = 'live'; dev.lastAt = Date.now();
  start(); document.querySelector('#countdown-skip').click();
  log.push('after start: running=' + running + ' cue=' + document.querySelector('#cue-title').textContent);
  let ms = 1000, seq = 0;
  const send = (hz, temp) => { dev.lastAt = Date.now(); onDeviceData({ v: 1, seq: seq++, ms, temp, hz, amp: 14 }); ms += 100; };
  // 拿着不摇 2 秒
  for (let i = 0; i < 20; i++) send(0, 22);
  log.push('idle 2s: samples=' + samples.length + ' temp=' + document.querySelector('#temp').textContent + ' note=' + document.querySelector('#temp-note').textContent);
  // 摇 6 秒，温度从 20 降到 0
  for (let i = 0; i < 60; i++) send(3, 20 - i / 3);
  log.push('shook 6s: samples=' + samples.length + ' t=' + samples.at(-1).t.toFixed(1) + ' score=' + finalScore);
  // 放下：停 1.5 秒
  for (let i = 0; i < 15; i++) send(0, 0);
  log.push('down 1.5s: running=' + running + ' cue=' + document.querySelector('#cue-title').textContent + ' / ' + document.querySelector('#cue-desc').textContent);
  for (let i = 0; i < 16; i++) send(0, 0);
  log.push('down 3.1s: running=' + running + ' completed=' + completed + ' resultHidden=' + document.querySelector('#result').hidden + ' practicing=' + document.body.classList.contains('practicing'));
  return log;
}"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width':390,'height':844}); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8765/'); await pg.wait_for_timeout(500)
        for line in await pg.evaluate(JS): print(line)
        await pg.screenshot(path='shots/devtest.png', full_page=True)
        print('errors', errs); await b.close()
asyncio.run(main())
