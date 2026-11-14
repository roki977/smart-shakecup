"""真杯子 + 评分服务：模拟固件发原始加速度包（50 Hz、单位 g、每包 5 个样本），看评分服务能不能算出结果。"""
import sys
from playwright.sync_api import sync_playwright
JS = """async (drop) => {
  dev.state = 'live'; dev.lastAt = Date.now();
  start(); document.querySelector('#countdown-skip').click();
  let ms = 5000, seq = 0, k = 0;
  const send = (shake, temp) => {
    const acc = [];
    for (let i = 0; i < 5; i++, k++) {
      const ph = 2 * Math.PI * 3 * k / 50;
      acc.push(shake ? [1.2 * Math.sin(ph), 0.05 * Math.cos(ph), 1 + 0.1 * Math.sin(2 * ph)] : [0, 0, 1]);
    }
    ms += 100;
    if (Math.random() < drop) return;          // 公共服务器丢包
    dev.lastAt = Date.now();
    onDeviceData({ v: 1, seq: seq++, ms, temp: [temp, temp + .2, temp - .1], acc_hz: 50, acc });
  };
  for (let i = 0; i < 10; i++) send(false, 22);
  for (let i = 0; i < 140; i++) send(true, 20 - i * 22 / 140);
  for (let i = 0; i < 60; i++) { send(false, -2); await new Promise(r => setTimeout(r, 5)); }
  return { running, completed, t: samples.at(-1).t };
}"""
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900}); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    for drop in [0, 0.08]:
        pg.goto('http://127.0.0.1:8766/'); pg.wait_for_timeout(1000)
        print('drop', drop, pg.evaluate(JS, drop))
        pg.wait_for_function('!/…/.test(document.querySelector("#result-score").textContent)', timeout=30000); pg.wait_for_timeout(1500)
        r = pg.evaluate('algo.last && algo.last.result')
        print('  final:', pg.text_content('#result-score'), '|', r and r['final'], '| source:', r and r['source'])
        print('  summary:', pg.text_content('#result-summary'))
        print('  issues:', pg.eval_on_selector_all('.issues b', 'xs=>xs.map(x=>x.textContent)'))
        fr = [f for f in (r or {}).get('frames', []) if f['features']['A']['value'] is not None]
        if fr: print('  sample frame:', {k: round(v['value'], 2) for k, v in fr[len(fr)//2]['features'].items()})
    print('errors', errs); b.close()
