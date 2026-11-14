'use strict';
/* 酒的图：用配方的 photo 地址（手写的 10 款是 photos/<id>.jpg，其余是 photos/cocktails/ 里的来源照片），
   没有照片（社区里的自创配方、自己搭的配方）或加载失败时显示 drinkArt() 画的插画。
   外观全部在 theme-night.css 里，这里只负责把照片塞进带 data-art 的框。 */

const photoCache = {};
function photoFor(url) {
  if (!(url in photoCache)) photoCache[url] = new Promise(res => {
    const img = new Image(); img.onload = () => res(img.src); img.onerror = () => res(null);
    img.src = url;
  });
  return photoCache[url];
}
async function decorateArt(root = document) {
  const boxes = [...root.querySelectorAll('[data-art]')];
  for (const box of boxes) {
    const r = RECIPES.find(x => x.id === box.dataset.art); if (!r?.photo) continue;
    if (box.querySelector('img.photo')) continue;
    const src = await photoFor(r.photo);
    if (src && !box.querySelector('img.photo')) {
      const img = document.createElement('img'); img.className = r.featured ? 'photo' : 'photo src'; img.src = src; img.alt = '';
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
