import asyncio, math
from playwright.async_api import async_playwright
JS = """async () => {
  setState('waiting');
  let seq = 0, ms = 1000;
  const send = (temp) => { const m = { v: 1, seq: seq++, ms, temp: [temp], hz: 0, amp: 0 }; onMessage('x/data', { toString: () => JSON.stringify(m), length: 50 }); ms += 100; };
  for (let i = 0; i < 15; i++) send(22);
  document.querySelector('#t90').click();
  const out1 = document.querySelector('#t90-out').textContent;
  for (let i = 0; i < 5; i++) send(22);
  for (let i = 0; i < 80; i++) send(0 + 22 * Math.exp(-(i / 10) / 1.0));   // τ = 1 s
  return [out1, document.querySelector('#t90-out').textContent];
}"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8765/debug.html'); await pg.wait_for_timeout(300)
        for l in await pg.evaluate(JS): print(l)
        print('errors', errs); await b.close()
asyncio.run(main())
