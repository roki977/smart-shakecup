'use strict';
/* 两套皮肤：写实（real）和像素（pixel）。页面结构、功能只有一套，切换的只是外观。
   - 写实：酒的图优先用 photos/<配方id>.jpg 实拍照片，没有照片时用插画。
   - 像素：插画先画成 SVG，再压成低分辨率、颜色收敛到调色板，按整数倍放大显示。 */

const THEME_KEY = 'shakecup-theme';
const PX_INK = '#2e2448';
const theme = () => document.documentElement.dataset.theme === 'pixel' ? 'pixel' : 'real';

/* ---------- 像素化工具 ---------- */
const hexRGB = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
function nearestColor(pal, r, g, b) {
  let best = pal[0], bd = Infinity;
  for (const p of pal) { const d = (p[0] - r) ** 2 * 3 + (p[1] - g) ** 2 * 4 + (p[2] - b) ** 2 * 2; if (d < bd) { bd = d; best = p; } }
  return best;
}
/* 把 SVG 栅格化成 w×h，画到 ctx 的 (dx, dy)，透明处不覆盖 */
async function pixelizeSVG(ctx, svg, w, h, dx = 0, dy = 0) {
  svg = svg.replace(/#2a1b10/gi, PX_INK);
  if (!/xmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
  const t = tmp.getContext('2d'); t.drawImage(img, 0, 0, w, h);
  const src = t.getImageData(0, 0, w, h);
  const pal = [...new Set((svg.match(/#[0-9a-fA-F]{6}/g) || []).map(s => s.toLowerCase()))].map(hexRGB);
  const dst = ctx.getImageData(dx, dy, w, h);
  for (let i = 0; i < src.data.length; i += 4) {
    const a = src.data[i + 3]; if (a < 110) continue;
    const k = 255 / a, c = nearestColor(pal, src.data[i] * k, src.data[i + 1] * k, src.data[i + 2] * k);
    dst.data[i] = c[0]; dst.data[i + 1] = c[1]; dst.data[i + 2] = c[2]; dst.data[i + 3] = 255;
  }
  ctx.putImageData(dst, dx, dy);
}
function drawDitherSky(ctx, w, h, stops) {
  const cols = stops.map(hexRGB), img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const f = y / (h - 1) * (cols.length - 1), i = Math.min(cols.length - 2, Math.floor(f)), frac = f - i;
    for (let x = 0; x < w; x++) {
      const c = frac * 16 > BAYER[y & 3][x & 3] + .5 ? cols[i + 1] : cols[i];
      const o = (y * w + x) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
function scaleCanvas(c, k) { c.style.width = c.width * k + 'px'; c.style.height = c.height * k + 'px'; }

/* ---------- 准备页的沙漠场景（像素） ---------- */
const DESERT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180" shape-rendering="crispEdges">
  <circle cx="232" cy="98" r="34" fill="none" stroke="#fbe6bb" stroke-width="3"/>
  <circle cx="232" cy="98" r="24" fill="#fff3cf"/>
  <path d="M180 24h86v3h-86zM204 30h50v2h-50zM40 40h60v3H40zM56 46h30v2H56z" fill="#f6ead3"/>
  <path d="M0 120V94h20l6-8h40l8 12h26l6 22z" fill="#b8a2cf"/>
  <path d="M176 120l6-26h22l4-10h48l8 12h34l6 24z" fill="#b8a2cf"/>
  <path d="M96 120l10-18h28l6-6h22l8 24z" fill="#9b85bd"/>
  <path d="M0 118h320v62H0z" fill="#ebc28d"/>
  <path d="M0 128q60-10 130 2t190-4v54H0z" fill="#f3d4a4"/>
  <path d="M0 150q90-16 170 0t150-6v36H0z" fill="#e2b07d"/>
  <path d="M8 133h54v2H8z" fill="#a993c2"/>
  <path d="M62 124h4v10h-4zM61 121h6v4h-6z" fill="#5c4a80"/>
  <path d="M63 119h2v2h-2z" fill="#f6c49c"/>
  <path d="M138 140h182v40H138z" fill="#b8693f"/>
  <path d="M132 134h188v8H132z" fill="#dc9d52"/>
  <path d="M132 134h188v2H132z" fill="#f2c47e"/>
  <path d="M138 142h182v3H138z" fill="#8e4c35"/>
  <path d="M150 152h40v2h-40zM210 160h60v2h-60zM160 170h50v2h-50z" fill="#a35b38"/>
  <path d="M131 133h190v1H131zM131 133h1v10h-1zM137 142h1v38h-1z" fill="${PX_INK}"/>
  <path d="M166 92h12v6h-12z" fill="#e4ecee"/>
  <path d="M163 98h18l3 9h-24z" fill="#cfdade"/>
  <path d="M159 107h26l-3 27h-20z" fill="#e4ecee"/>
  <path d="M176 98h3l3 9h-4zM178 107h5l-2 27h-4z" fill="#a7b8c2"/>
  <path d="M162 110h2v20h-2z" fill="#ffffff"/>
  <path d="M165 91h14v1h-14zM165 91h1v7h-1zM178 91h1v7h-1zM162 97h20v1H162zM159 106h26v1H159zM158 107h1v27h-1zM185 107h1v27h-1zM161 133h22v1h-22z" fill="${PX_INK}"/>
  <path d="M287 126q8-6 16 0q-8 7-16 0z" fill="#f1cc3a" stroke="${PX_INK}" stroke-width="1"/>
</svg>`;
async function renderSetupScene() {
  const c = $('#setup-scene'); if (!c) return;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 320, 180);
  drawDitherSky(ctx, 320, 120, ['#7fc1c6', '#a7d6cf', '#cfe5cb', '#f2dbb0', '#f6c39a']);
  await pixelizeSVG(ctx, DESERT_SVG, 320, 180);
  // 把当前这杯酒放到吧台上（插画 120×130 → 44×48，杯底落在台面）
  await pixelizeSVG(ctx, drinkArt(recipe), 44, 48, 214, 87);
  fitScene();
}
function fitScene() {
  const c = $('#setup-scene'); if (!c || theme() !== 'pixel') return;
  const box = c.parentElement.clientWidth;
  if (box < 640) { c.style.width = '100%'; c.style.height = 'auto'; return; }
  scaleCanvas(c, Math.max(1, Math.floor(box / 320)));
}
addEventListener('resize', fitScene);

/* ---------- 动作示范（像素）：画一次，再用 steps() 动画整体推拉 ---------- */
const DEMO_PX_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100">
  <g transform="translate(8 0) rotate(-18 72 50)" stroke="${PX_INK}" stroke-width="2.5" stroke-linejoin="round">
    <path fill="#e4ecee" d="M70 35L104 38q3 .3 3 3v18q0 2.7-3 3L70 65z"/>
    <path fill="#cfdade" d="M70 34v32q-9 0-13-6q-3-4-5-6v-8q2-2 5-6q4-6 13-6z"/>
    <path fill="#cfdade" d="M52 45h-5v10h5z"/>
    <rect fill="#e4ecee" x="38" y="43" width="10" height="14" rx="3"/>
    <path fill="#f2c9a0" stroke-width="3.6" transform="translate(44 50) scale(.66) translate(-44 -50)" d="M58 31q-8 0-8 8v19q0 11 10 11h14a3.6 3.6 0 0 0 0-7a3.6 3.6 0 0 0 0-7a3.6 3.6 0 0 0 0-7a3.6 3.6 0 0 0-1-6.5q4-1 8-1q4 0 4-3.5q0-3.5-5-4z"/>
    <path fill="#f2c9a0" stroke-width="3.6" transform="translate(-14 0) translate(126 50) scale(.66) translate(-126 -50)" d="M120 33q8 0 8 8v17q0 11-10 11h-12a3.6 3.6 0 0 1 0-7a3.6 3.6 0 0 1 0-7a3.6 3.6 0 0 1 0-7a3.6 3.6 0 0 1 1-6.5q-5-1-9-1q-4 0-4-3.5q0-3.5 5-4z"/>
  </g>
</svg>`;
let demoDone = false;
async function renderDemo() {
  const c = $('.demo-px'); if (!c || demoDone) return;
  await pixelizeSVG(c.getContext('2d'), DEMO_PX_SVG, 80, 50);
  demoDone = true;
}

/* ---------- 酒的图：像素画 / 实拍照片 ---------- */
const photoCache = {};
function photoFor(id) {
  if (!(id in photoCache)) photoCache[id] = new Promise(res => {
    const img = new Image(); img.onload = () => res(img.src); img.onerror = () => res(null);
    img.src = `photos/${id}.jpg`;
  });
  return photoCache[id];
}
async function decorateArt(root = document) {
  const boxes = [...root.querySelectorAll('[data-art]')];
  for (const box of boxes) {
    const r = RECIPES.find(x => x.id === box.dataset.art); if (!r) continue;
    if (theme() === 'pixel') {
      if (box.querySelector('canvas.px-art')) continue;
      const c = document.createElement('canvas'); c.className = 'px-art'; c.width = 40; c.height = 44;
      box.appendChild(c);
      await pixelizeSVG(c.getContext('2d'), drinkArt(r), 40, 44);
    } else {
      if (box.querySelector('img.photo')) continue;
      const src = await photoFor(r.id);
      if (src && !box.querySelector('img.photo')) {
        const img = document.createElement('img'); img.className = 'photo'; img.src = src; img.alt = '';
        box.appendChild(img); box.classList.add('has-photo');
      }
    }
  }
}

/* 在原有的渲染函数之后补上图片处理 */
for (const name of ['renderRecipe', 'renderCodex']) {
  const orig = window[name];
  window[name] = function (...a) { const out = orig.apply(this, a); decorateArt(); if (name === 'renderRecipe' && theme() === 'pixel') renderSetupScene(); return out; };
}
{
  const origModal = window.showModal;
  window.showModal = function (html) { origModal(html); decorateArt($('#modal')); };
}

/* ---------- 切换 ---------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch {}
  $('#theme-toggle').textContent = '风格：' + (t === 'pixel' ? '像素' : '写实');
  $('#theme-toggle').setAttribute('aria-label', '切换到' + (t === 'pixel' ? '写实' : '像素') + '风格');
  if (t === 'pixel') { renderSetupScene(); renderDemo(); }
  decorateArt();
  if (!$('#codex').hidden) renderCodex();
}
$('#theme-toggle').onclick = () => applyTheme(theme() === 'pixel' ? 'real' : 'pixel');
applyTheme(theme());
