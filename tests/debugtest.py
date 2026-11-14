import asyncio, sys
from playwright.async_api import async_playwright
# 模拟固件 FAKE_SENSORS：静止 2 秒、摇 12 秒、放下；可选注入故障
FEED = """async ({ secs, fault }) => {
  S.state = 'waiting'; S.connectedAt = Date.now(); setState('waiting');
  let seq = 0, ms = 5000;
  for (let i = 0; i < secs * 10; i++) {
    const t = (i / 10) % 19, shaking = t >= 2 && t < 14;
    let temp = t < 2 ? 22 : t < 14 ? 22 - 25 * (1 - Math.exp(-(t - 2) / 4.5)) / (1 - Math.exp(-12 / 4.5)) : -3;
    const acc = [];
    for (let k = 0; k < 5; k++) { const tt = (ms + k * 20) / 1000; acc.push([shaking ? +(5 * Math.sin(2 * Math.PI * 3 * tt)).toFixed(3) : 0.01, 0.02, 1]); }
    let temps = [+temp.toFixed(2), +(temp + .2).toFixed(2), +(temp - .1).toFixed(2)];
    if (fault === 'probe') temps[2] = null;
    if (fault === 'units') acc.forEach(a => { a[0] *= 9.81; a[1] *= 9.81; a[2] *= 9.81; });
    if (fault === 'drop' && i % 7 === 3) { seq++; ms += 100; continue; }
    const m = { v: 1, seq: seq++, ms, temp: temps, acc_hz: 50, acc };
    onMessage('shakecup/test/data', { toString: () => JSON.stringify(m), length: JSON.stringify(m).length });
    ms += 100;
    await new Promise(r => setTimeout(r, 4));
    S.frames.at(-1).at = Date.now() - (secs * 10 - i) * 100;   // 把时间轴摊开成真实节奏
  }
  S.frames.forEach(f => {}); 
}"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); errs = []
        for fault, w, h, stop in [('none', 1400, 1000, 9), ('probe', 1400, 1000, 1), ('units', 1400, 1000, 1), ('drop', 390, 844, 9)]:
            pg = await b.new_page(viewport={'width': w, 'height': h}); pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto('http://localhost:8765/debug.html'); await pg.wait_for_timeout(300)
            await pg.evaluate(FEED, {'secs': stop, 'fault': fault})
            # 让最后一帧显得“刚到”
            await pg.evaluate("() => { const n = S.frames.length; S.frames.forEach((f, i) => f.at = Date.now() - (n - 1 - i) * 100); S.acc.forEach((p, i) => p.at = Date.now() - (S.acc.length - 1 - i) * 20); }")
            await pg.wait_for_timeout(700)
            await pg.screenshot(path=f'shots/debug-{fault}.png', full_page=True)
            print(fault, await pg.evaluate("() => [...document.querySelectorAll('#checks li')].map(l => l.className + ': ' + l.querySelector('b').textContent).join(' | ')"))
            await pg.close()
        print('errors', errs); await b.close()
asyncio.run(main())
