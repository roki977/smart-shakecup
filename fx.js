'use strict';
/* 只在用户做完一件事时给反馈：结果页分数从 0 走到最终值，星级依次亮起。
   不放环境动画。系统设置了“减少动态效果”就直接显示结果。 */

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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
}

new MutationObserver(() => {
  const res = $('#result');
  if (!res.hidden && !res.dataset.fx) { res.dataset.fx = '1'; showResultFx(); }
  if (res.hidden) delete res.dataset.fx;
}).observe($('#result'), { attributes: true, attributeFilter: ['hidden'] });
