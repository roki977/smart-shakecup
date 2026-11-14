'use strict';
/* 酒的图：优先用 photos/<配方id>.jpg 实拍照片（IBA 官网，统一裁成 4:5 黑底），
   没有照片（比如社区里的自创配方）时显示 drinkArt() 画的插画。
   外观全部在 theme-night.css 里，这里只负责把照片塞进带 data-art 的框。 */

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
    if (box.querySelector('img.photo')) continue;
    const src = await photoFor(r.id);
    if (src && !box.querySelector('img.photo')) {
      const img = document.createElement('img'); img.className = 'photo'; img.src = src; img.alt = '';
      box.appendChild(img); box.classList.add('has-photo');
    }
  }
}

/* 在原有的渲染函数之后补上照片 */
for (const name of ['renderRecipe', 'renderCodex']) {
  const orig = window[name];
  window[name] = function (...a) { const out = orig.apply(this, a); decorateArt(); return out; };
}
{
  const origModal = window.showModal;
  window.showModal = function (html) { origModal(html); decorateArt($('#modal')); };
}
decorateArt();
