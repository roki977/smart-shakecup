'use strict';
/* 游戏感的小反馈：结果页分数滚动、星级、闪光；解锁弹窗闪光。
   不改 app.js 的流程，只看页面变化来触发。系统设置了“减少动态效果”就不放动画。 */

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* 在一个元素周围放一圈闪光粒子 */
function sparkle(el, n = 14) {
  if (!el || reduceMotion()) return;
  const r = el.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'fx-layer';
  layer.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px`;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    const a = (i / n) * Math.PI * 2 + Math.random() * .4, d = 50 + Math.random() * Math.max(60, r.width * .45);
    s.style.setProperty('--dx', Math.cos(a) * d + 'px');
    s.style.setProperty('--dy', Math.sin(a) * d * .7 + 'px');
    s.style.setProperty('--s', (.6 + Math.random() * .8).toFixed(2));
    s.style.animationDelay = Math.random() * 120 + 'ms';
    layer.appendChild(s);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1300);
}

/* 数字从 0 滚到目标值 */
function countUp(el, to, ms = 900) {
  if (reduceMotion()) { el.textContent = to; return; }
  const t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(to * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* 星级：60 分 1 星，80 分 2 星，90 分 3 星 */
const starsFor = score => score >= 90 ? 3 : score >= 80 ? 2 : score >= 60 ? 1 : 0;
function showResultFx() {
  const scoreEl = $('#result-score'), score = Number(scoreEl.textContent) || 0, n = starsFor(score);
  countUp(scoreEl, score);
  const box = $('#stars');
  box.innerHTML = [0, 1, 2].map(i => `<span class="star${i < n ? ' on' : ''}" style="--i:${i}">★</span>`).join('');
  box.setAttribute('aria-label', `${n} 星`);
  if (n) setTimeout(() => sparkle($('.big-score'), 10 + n * 4), 650);
}

/* 结果页出现时触发 */
new MutationObserver(() => {
  const res = $('#result');
  if (!res.hidden && !res.dataset.fx) { res.dataset.fx = '1'; showResultFx(); }
  if (res.hidden) delete res.dataset.fx;
}).observe($('#result'), { attributes: true, attributeFilter: ['hidden'] });

/* 解锁 / 练熟弹窗出现时，在酒的照片周围放闪光 */
new MutationObserver(() => {
  const art = $('#modal-content .unlock-art');
  if (art && !art.dataset.fx) { art.dataset.fx = '1'; setTimeout(() => sparkle(art, 18), 500); }
}).observe($('#modal-content'), { childList: true });

/* 切换页面时的进场动画：每次从隐藏变成显示，重新播放一次 */
for (const v of document.querySelectorAll('.view')) {
  new MutationObserver(() => {
    if (v.hidden || reduceMotion()) return;
    v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
  }).observe(v, { attributes: true, attributeFilter: ['hidden'] });
}
