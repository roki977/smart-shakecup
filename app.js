'use strict';
/* 微醺练习室：模拟数据驱动的摇杯练习原型。
   数据流：chooseScenario → demoSample(t) → consumeSample(s) → finish() → 复盘。
   接真实硬件时，只需让适配层产出同样字段的样本并交给 consumeSample()。 */

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let activeScenario = null, previousScenario = -1, awaitingFinish = false;
let mode = 'standard', target = -2, desiredRhythm = 3;
let timer = null, samples = [], events = [], lastEvent = '';
let running = false, completed = false, finalScore = 0, finalParts = null;
let sound = false, audio = null, savedThisRun = false;
const storeKey = 'amber-practice-v1';
const ROOM = 22;

/* ---------- 配方与图鉴 ----------
   用量参考 IBA 官方配方。shake: true 的酒可以用杯子练、能解锁；
   其余是搅拌或直调，先收进图鉴，杯子暂时教不了。 */
const UNLOCK_SCORE = 80, MASTER_TIMES = 3;
const RECIPES = [
  { id: 'whiskey-sour', name: '威士忌酸', en: 'Whiskey Sour', shake: true, method: '摇和', glass: 'rocks', glassName: '柯布勒杯（加冰喝用古典杯）', color: '#e9b44c', garnish: 'orange',
    note: '酸、甜、酒感三样摆平，摇和入门最常练的一杯。',
    parts: [['波本威士忌', 45], ['鲜柠檬汁', 25], ['糖浆', 20], ['蛋清（可选）', '几滴']], deco: '半片橙子、马拉斯奇诺樱桃，可加橙皮',
    how: '全部材料倒进加满冰的摇杯，用力摇匀，滤进柯布勒杯。加蛋清的话要摇得更用力，把泡沫打起来。' },
  { id: 'daiquiri', name: '大吉利', en: 'Daiquiri', shake: true, method: '摇和', glass: 'coupe', glassName: '鸡尾酒杯', color: '#f0e9b8', garnish: 'none',
    note: '朗姆、青柠、糖，就三样东西，比例和摇的功夫全看得出来。',
    parts: [['古巴白朗姆', 60], ['鲜青柠汁', 20], ['细砂糖', '2 吧勺']], deco: '无',
    how: '材料放进摇杯先搅拌，让糖化开；再加冰摇和，滤进冰过的鸡尾酒杯。' },
  { id: 'margarita', name: '玛格丽特', en: 'Margarita', shake: true, method: '摇和', glass: 'coupe', glassName: '鸡尾酒杯', color: '#e3edb0', garnish: 'salt',
    note: '龙舌兰配橙味利口酒和青柠，杯口可以沾半圈盐。',
    parts: [['100% 龙舌兰', 50], ['橙味利口酒（Triple Sec）', 20], ['鲜榨青柠汁', 15]], deco: '半圈盐边（可选）',
    how: '全部材料加冰摇和，滤进冰过的鸡尾酒杯。' },
  { id: 'white-lady', name: '白色佳人', en: 'White Lady', shake: true, method: '摇和', glass: 'coupe', glassName: '鸡尾酒杯', color: '#eef0e2', garnish: 'none',
    note: '金酒、橙味利口酒、柠檬，清爽带一点橙香，颜色接近乳白。',
    parts: [['金酒', 40], ['橙味利口酒（Triple Sec）', 30], ['鲜柠檬汁', 20]], deco: '无',
    how: '全部材料加冰用力摇匀，滤进冰过的鸡尾酒杯。' },
  { id: 'cosmopolitan', name: '大都会', en: 'Cosmopolitan', shake: true, method: '摇和', glass: 'martini', glassName: '大号鸡尾酒杯', color: '#e8a0a8', garnish: 'lemon-twist',
    note: '柑橘伏特加加蔓越莓汁，粉色那一杯。',
    parts: [['柑橘伏特加', 40], ['蔓越莓汁', 30], ['君度', 15], ['鲜青柠汁', 15]], deco: '柠檬皮卷',
    how: '全部材料倒进加满冰的摇杯，摇匀后滤进大号鸡尾酒杯。' },
  { id: 'sidecar', name: '边车', en: 'Sidecar', shake: true, method: '摇和', glass: 'coupe', glassName: '鸡尾酒杯', color: '#df9f45', garnish: 'none',
    note: '干邑版的酸酒，琥珀色，橙香和柠檬酸平衡。',
    parts: [['干邑', 50], ['橙味利口酒（Triple Sec）', 20], ['鲜柠檬汁', 20]], deco: '无',
    how: '全部材料加冰摇匀，滤进冰过的鸡尾酒杯。' },
  { id: 'old-fashioned', name: '古典', en: 'Old Fashioned', shake: false, method: '杯中搅拌', glass: 'rocks', glassName: '古典杯', color: '#c56d22', garnish: 'orange',
    note: '威士忌、方糖、苦精，在杯里慢慢搅开。',
    parts: [['波本或黑麦威士忌', 45], ['方糖', '1 块'], ['安格斯图拉苦精', '几滴'], ['清水', '几滴']], deco: '橙片或橙皮、鸡尾酒樱桃',
    how: '方糖放进古典杯，淋上苦精和几滴水，压到化开；加满冰块，倒入威士忌，轻轻搅拌。' },
  { id: 'dry-martini', name: '干马天尼', en: 'Dry Martini', shake: false, method: '搅拌', glass: 'martini', glassName: '马天尼杯', color: '#eef3ee', garnish: 'olive',
    note: '金酒加一点干味美思，冰着搅，越冷越好。',
    parts: [['金酒', 60], ['干味美思', 10]], deco: '柠檬皮喷油，或按需放青橄榄',
    how: '材料倒进放了冰块的调酒杯，充分搅拌，滤进冰过的马天尼杯。' },
  { id: 'negroni', name: '尼格罗尼', en: 'Negroni', shake: false, method: '杯中直调', glass: 'rocks', glassName: '古典杯', color: '#c22b2c', garnish: 'orange',
    note: '金酒、金巴利、甜味美思各三分之一，苦和甜都很直接。',
    parts: [['金酒', 30], ['金巴利', 30], ['甜味美思', 30]], deco: '半片橙子',
    how: '全部材料直接倒进加满冰的冰古典杯，轻轻搅拌。' },
  { id: 'mojito', name: '莫吉托', en: 'Mojito', shake: false, method: '杯中直调', glass: 'highball', glassName: '高球杯', color: '#d9efcf', garnish: 'mint',
    note: '薄荷、青柠、朗姆，最后补苏打水，直接在杯里调。',
    parts: [['古巴白朗姆', 45], ['鲜青柠汁', 20], ['薄荷', '6 枝'], ['白蔗糖', '2 茶匙'], ['苏打水', '补满']], deco: '薄荷枝、青柠片',
    how: '薄荷和糖、青柠汁一起轻压混合，加一点苏打水后装满冰，倒入朗姆，补满苏打水，轻轻搅匀。' }
];
/* 知识库里的 117 款（catalog.js，由 scripts/build_catalog.py 生成）。
   上面 10 款是手写的中文说明和实拍照片，保留；同一款酒再挂上知识库的步骤、来源和配方版本。 */
RECIPES.forEach(r => r.photo = true);
for (const c of window.CATALOG || []) {
  const mine = RECIPES.find(r => r.id === c.id);
  if (mine) Object.assign(mine, { kb: c.kb, steps: c.steps, source: c.source, recipeVersion: c.recipeVersion, reference: c.reference, shakeStep: c.shakeStep, partsSource: c.partsSource, branches: c.branches });
  else RECIPES.push({ ...c, how: c.steps.join('；') });
}
const FEATURED = RECIPES.filter(r => r.photo && r.shake);   // 主界面底部那排：有实拍照片的 6 款
const SHAKEN = RECIPES.filter(r => r.shake);
const GLASS = { coupe: '碟形杯', martini: '马天尼杯', rocks: '古典杯', highball: '高球杯' };
let recipe = RECIPES[0];
const codexKey = 'amber-codex-v1';
function codexState() { try { return JSON.parse(localStorage.getItem(codexKey) || '{}'); } catch { return {}; } }
function saveCodex(st) { try { localStorage.setItem(codexKey, JSON.stringify(st)); } catch {} }
const isUnlocked = (st, id) => (st[id]?.best || 0) >= UNLOCK_SCORE;
const isMastered = (st, id) => (st[id]?.passes || 0) >= MASTER_TIMES;

/* 酒杯插画：按杯型和酒色生成 */
function drinkArt(r) {
  const c = r.color, ink = '#2a1b10', glassFill = 'rgba(255,255,255,.35)';
  let g = '', rimY = 0, rimX1 = 0, rimX2 = 0;
  if (r.glass === 'coupe') {
    rimY = 44; rimX1 = 22; rimX2 = 98;
    g += `<path d="M22 44q4 34 38 36q34-2 38-36z" fill="${glassFill}"/>`;
    g += `<path d="M27 52q6 24 33 25q27-1 33-25z" fill="${c}"/>`;
    g += `<path d="M22 44q4 34 38 36q34-2 38-36z" fill="none" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/>`;
    g += `<path d="M60 80v34M42 118q18-6 36 0" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`;
  } else if (r.glass === 'martini') {
    rimY = 36; rimX1 = 18; rimX2 = 102;
    g += `<path d="M18 36h84L60 82z" fill="${glassFill}"/>`;
    g += `<path d="M27 44h66L60 79z" fill="${c}"/>`;
    g += `<path d="M18 36h84L60 82z" fill="none" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/>`;
    g += `<path d="M60 82v32M42 118q18-6 36 0" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`;
  } else if (r.glass === 'rocks') {
    rimY = 52; rimX1 = 30; rimX2 = 90;
    g += `<path d="M30 52h60l-3 62q0 6-6 6H39q-6 0-6-6z" fill="${glassFill}"/>`;
    g += `<path d="M31.5 72h57l-2 42q0 4-4 4h-45q-4 0-4-4z" fill="${c}"/>`;
    g += `<rect x="40" y="66" width="18" height="18" rx="3" fill="#fff" opacity=".55" transform="rotate(-10 49 75)"/><rect x="60" y="74" width="17" height="17" rx="3" fill="#fff" opacity=".45" transform="rotate(8 68 82)"/>`;
    g += `<path d="M30 52h60l-3 62q0 6-6 6H39q-6 0-6-6z" fill="none" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/>`;
    g += `<path d="M33 112h54" stroke="${ink}" stroke-width="5" opacity=".9"/>`;
  } else {
    rimY = 22; rimX1 = 38; rimX2 = 82;
    g += `<path d="M38 22h44l-3 94q0 4-4 4H45q-4 0-4-4z" fill="${glassFill}"/>`;
    g += `<path d="M39.5 40h41l-2.6 75q0 3-3 3H45q-3 0-3-3z" fill="${c}"/>`;
    g += `<circle cx="52" cy="90" r="2" fill="#fff" opacity=".8"/><circle cx="64" cy="76" r="1.6" fill="#fff" opacity=".8"/><circle cx="58" cy="104" r="1.8" fill="#fff" opacity=".8"/><circle cx="70" cy="96" r="1.4" fill="#fff" opacity=".8"/>`;
    g += `<path d="M38 22h44l-3 94q0 4-4 4H45q-4 0-4-4z" fill="none" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/>`;
  }
  // 装饰
  const gx = rimX2 - 6, gy = rimY;
  const wheel = (fill, pith) => `<g transform="translate(${gx} ${gy - 4})"><circle r="13" fill="${pith}" stroke="${ink}" stroke-width="2.5"/><circle r="9.5" fill="${fill}"/><path d="M0-9.5V9.5M-9.5 0H9.5M-6.7-6.7l13.4 13.4M6.7-6.7L-6.7 6.7" stroke="${pith}" stroke-width="1.6"/></g>`;
  const rim = color => `<path d="M${rimX1} ${rimY}H${rimX2}" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="1.5 3"/>`;
  const peel = `<path d="M${gx - 8} ${gy - 12}q10-6 16 2q-6 4-4 10q-8-4-12-12z" fill="#f0993a" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round"/>`;
  switch (r.garnish) {
    case 'lemon': g += wheel('#f1cc3a', '#f8eab0'); break;
    case 'salt': g += rim('#ffffff'); break;
    case 'lemon-twist': g += peel.replace('#f0993a', '#f1cc3a'); break;
    case 'lime': g += wheel('#8cc152', '#e3f1c7'); break;
    case 'salt-lime': g += rim('#ffffff') + wheel('#8cc152', '#e3f1c7'); break;
    case 'sugar-orange': g += rim('#f6ead2') + peel; break;
    case 'orange': g += peel; break;
    case 'cherry': g += `<path d="M60 ${rimY + 26}q4-14 14-20" fill="none" stroke="${ink}" stroke-width="2"/><circle cx="58" cy="${rimY + 30}" r="7" fill="#b0141f" stroke="${ink}" stroke-width="2.2"/>`; break;
    case 'olive': g += `<path d="M44 ${rimY - 14}L70 ${rimY + 26}" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><ellipse cx="64" cy="${rimY + 16}" rx="7" ry="5.5" fill="#7d8a3a" stroke="${ink}" stroke-width="2.2" transform="rotate(56 64 ${rimY + 16})"/>`; break;
    case 'mint': g += `<path d="M70 ${rimY + 4}q-2-14 6-22" fill="none" stroke="#3f6b2c" stroke-width="2.5"/><path d="M76 ${rimY - 18}q12-4 14 6q-10 4-14-6zM72 ${rimY - 8}q-12-6-14 4q10 5 14-4z" fill="#5f9a3e" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>` + wheel('#8cc152', '#e3f1c7').replace(`translate(${gx} ${gy - 4})`, `translate(${rimX1 + 6} ${rimY + 6}) scale(.8)`); break;
  }
  return `<svg viewBox="0 0 120 130" aria-hidden="true">${g}</svg>`;
}

function renderRecipe() {
  $('#recipe-name').textContent = recipe.name;
  $('#recipe-en').textContent = recipe.en;
  $('#setup-art').innerHTML = drinkArt(recipe);
  $('#setup-art').dataset.art = recipe.id;
  $('#setup-art').classList.remove('has-photo');
  $('#recipe-lede').textContent = recipe.note;
  // 配料：每样一行，右边一条细线伸向杯子，线长按用量
  const max = Math.max(...recipe.parts.map(p => typeof p[1] === 'number' ? p[1] : 0));
  $('#pour').innerHTML = recipe.parts.map(([n, ml], i) =>
    typeof ml === 'number'
      ? `<div style="--ml:${ml};--max:${max};--i:${i}"><dt>${escapeHTML(n)}</dt><dd><b>${ml}</b>ml</dd><i aria-hidden="true"></i></div>`
      : `<div class="pour-extra" style="--i:${i}"><dt>${escapeHTML(n)}</dt><dd>${escapeHTML(ml)}</dd></div>`).join('');
  $('#recipe-deco').textContent = recipe.deco && recipe.deco !== '无' ? `装饰：${recipe.deco}` : '不加装饰';
  $('#switch-recipe').textContent = `全部 ${RECIPES.filter(r => !r.custom).length} 款`;
  $('#setup-steps').innerHTML = (recipe.steps?.length ? recipe.steps : stepsOf(recipe.how)).map(x => `<li>${escapeHTML(x)}</li>`).join('');
  const st = codexState()[recipe.id];
  $('#unlock-hint').textContent = recipe.custom ? '社区里的自创配方，练习成绩不进图鉴。'
    : !st?.best ? `摇出 ${UNLOCK_SCORE} 分，这杯收进图鉴。`
    : st.best < UNLOCK_SCORE ? `最好成绩 ${st.best} 分，再拿到 ${UNLOCK_SCORE} 分就能解锁。`
    : (st.passes || 0) >= MASTER_TIMES ? `已练熟，最好成绩 ${st.best} 分。`
    : `已解锁，最好成绩 ${st.best} 分。再拿 ${MASTER_TIMES - st.passes} 次 ${UNLOCK_SCORE} 分以上就算练熟。`;
  renderStrip();
  updateCodexCount();
}
/* 底部的酒单：点一杯就换，杯子从暗处浮现 */
function renderStrip() {
  const st = codexState(), list = FEATURED.includes(recipe) ? FEATURED : [recipe, ...FEATURED];
  $('#drink-strip').innerHTML = list.map(r => `<li><button class="strip-item${isUnlocked(st, r.id) ? ' open' : ''}" data-pick="${r.id}" aria-current="${r.id === recipe.id}" aria-label="${escapeHTML(r.name)}">
      <span class="strip-art" data-art="${r.id}">${drinkArt(r)}</span><span class="strip-name">${escapeHTML(r.name)}</span></button></li>`).join('');
  $$('#drink-strip [data-pick]').forEach(b => b.onclick = () => {
    const r = list.find(x => x.id === b.dataset.pick);
    if (!r || r.id === recipe.id) return;
    recipe = r;
    if (typeof practiceRef !== 'undefined' && practiceRef) { practiceRef = null; renderRefChip(); }
    renderRecipe(); revealStage();
  });
}
function revealStage() {
  const s = $('#stage'); s.classList.remove('reveal'); void s.offsetWidth; s.classList.add('reveal');
}
function updateCodexCount() {
  const st = codexState(), n = SHAKEN.filter(r => isUnlocked(st, r.id)).length;
  $('#codex-count').textContent = `${n}/${SHAKEN.length}`;
}

function cardHTML(r, st) {
  const s = st[r.id], open = isUnlocked(st, r.id);
  const badge = !r.shake ? '' : isMastered(st, r.id) ? '练熟' : open ? `最好 ${s.best}` : s?.best ? `最好 ${s.best}` : '';
  return `<li><button class="card${isMastered(st, r.id) ? ' mastered' : ''}" data-recipe="${r.id}" style="--drink:${r.color}">
    <span class="card-art" data-art="${r.id}">${drinkArt(r)}</span>
    <span class="card-name">${escapeHTML(r.name)}</span><span class="card-en">${escapeHTML(r.en)}</span>
    <span class="card-tags"><span>${r.method}</span>${r.parts.slice(0, 3).map(p => `<span>${escapeHTML(p[0])}</span>`).join('')}</span>
    ${badge ? `<span class="card-badge">${badge}</span>` : ''}</button></li>`;
}
/* 图鉴：一个列表，搜索 + 按做法筛选。卡片多，分批画，滚到底再画下一批 */
const codexView = { f: 'all', q: '', shown: 0, list: [] };
const CODEX_BATCH = 24;
function codexMatches(r, st) {
  const f = codexView.f;
  if (f === 'shake' && !r.shake) return false;
  if (f === 'stir' && r.method !== '搅拌') return false;
  if (f === 'other' && (r.shake || r.method === '搅拌')) return false;
  if (f === 'mine' && !st[r.id]?.best) return false;
  const q = codexView.q.trim().toLowerCase();
  return !q || [r.name, r.en, ...r.parts.map(p => p[0]), ...(r.partsSource || [])].some(x => String(x).toLowerCase().includes(q));
}
function renderCodex() {
  const st = codexState();
  codexView.list = RECIPES.filter(r => !r.custom && codexMatches(r, st))
    .sort((a, b) => (b.photo ? 1 : 0) - (a.photo ? 1 : 0));        // 有照片的排前面
  codexView.shown = 0;
  $('#shelf').innerHTML = '';
  $('#codex-found').textContent = codexView.list.length ? `${codexView.list.length} 款` : '没找到。换个词试试，酒名中英文、配料都能搜。';
  $('#codex-done').textContent = SHAKEN.filter(r => isUnlocked(st, r.id)).length;
  $('#codex-total').textContent = SHAKEN.length;
  moreCodex();
}
function moreCodex() {
  const st = codexState(), next = codexView.list.slice(codexView.shown, codexView.shown + CODEX_BATCH);
  if (!next.length) return;
  codexView.shown += next.length;
  $('#shelf').insertAdjacentHTML('beforeend', next.map(r => cardHTML(r, st)).join(''));
  $$('#shelf [data-recipe]').forEach(b => b.onclick = () => openRecipe(b.dataset.recipe));
  if (typeof decorateArt === 'function') decorateArt($('#shelf'));
}
addEventListener('scroll', () => {
  if (!$('#codex').hidden && innerHeight + scrollY > document.body.scrollHeight - 600) moreCodex();
}, { passive: true });
$('#codex-q').oninput = e => { codexView.q = e.target.value; renderCodex(); };
$$('#codex-filter [data-f]').forEach(b => b.onclick = () => {
  codexView.f = b.dataset.f;
  $$('#codex-filter [data-f]').forEach(x => x.setAttribute('aria-selected', x === b));
  renderCodex();
});
/* 做法拆成编号步骤：先按句号、分号拆；只有一句就按逗号拆 */
function stepsOf(how) {
  let parts = String(how || '').split(/[；。]/).map(x => x.trim()).filter(Boolean);
  if (parts.length === 1) parts = parts[0].split('，').map(x => x.trim()).filter(Boolean);
  return parts;
}
function stepsHTML(how) {
  const st = stepsOf(how);
  return st.length ? `<p class="divider-title"><span>调制步骤</span></p><ol class="rc-steps">${st.map(x => `<li>${escapeHTML(x)}</li>`).join('')}</ol>` : '';
}
function openRecipe(id) {
  const r = RECIPES.find(x => x.id === id), st = codexState(), s = st[id];
  const status = !r.shake ? '' : !s?.best ? `<p class="fine">还没摇过。摇出 ${UNLOCK_SCORE} 分解锁。</p>`
    : `<p class="fine">最好成绩 ${s.best} 分，${s.passes || 0} 次 ${UNLOCK_SCORE} 分以上${isMastered(st, id) ? '，已练熟' : ''}。</p>`;
  const steps = r.steps?.length ? r.steps : stepsOf(r.how);
  const src = r.source?.url
    ? `<p class="fine rc-src">来源：<a href="${r.source.url}" target="_blank" rel="noopener">${escapeHTML(r.source.publisher || '原文')}</a>${r.source.checked ? `，${r.source.checked} 核对` : ''}。步骤由知识库从原文整理，还没经调酒师逐条审过。</p>`
    : '<p class="fine rc-src">配方来自 IBA（国际调酒师协会）官方酒单。</p>';
  showModal(`<div class="recipe-card" style="--drink:${r.color}">
      <div class="rc-photo"><div class="rc-art" data-art="${r.id}">${drinkArt(r)}</div></div>
      <div class="rc-body">
        <h2>${escapeHTML(r.name)}<span>${escapeHTML(r.en)}</span></h2>
        <p class="rc-tags"><span>${r.method}</span><span>${r.glassName || GLASS[r.glass]}</span></p>
        <p>${escapeHTML(r.note)}</p>
        <ul class="rc-parts">${r.parts.map(([n, ml]) => `<li><span>${escapeHTML(n)}</span><b>${typeof ml === 'number' ? ml + ' ml' : escapeHTML(ml)}</b></li>`).join('')}
          <li><span>${r.decoSource ? '装饰（来源原文）' : '装饰'}</span><b>${escapeHTML(r.deco)}</b></li></ul>
        ${steps.length ? `<p class="divider-title"><span>调制步骤</span></p><ol class="rc-steps">${steps.map(x => `<li>${escapeHTML(x)}</li>`).join('')}</ol>` : ''}
        <p class="divider-title"><span>标准曲线</span></p>
        <div class="rc-curve" id="rc-curve">${curveCardHTML(r, null)}</div>
        ${src}
        ${status}
        ${r.shake ? `<button class="primary" id="practice-this">用杯子练这杯</button>` : `<p class="fine">这杯不用摇，杯子目前只教摇和。</p>`}
      </div></div>`);
  if (r.shake) $('#practice-this').onclick = () => { recipe = r; practiceRef = null; renderRefChip(); $('#modal').close(); showSetup(); };
  loadStandardCurves(r).then(list => { const box = $('#rc-curve'); if (box && $('#modal').open) { box.innerHTML = curveCardHTML(r, list); bindCurveCard(r, list); } });
}

function showSetup() {
  $('#community').hidden = true; $('#codex').hidden = true; $('#live').hidden = true; $('#setup').hidden = false;
  renderRecipe(); revealStage(); window.scrollTo({ top: 0 });
}
function showCodex() {
  if (running) return;
  $('#setup').hidden = true; $('#live').hidden = true; $('#community').hidden = true; $('#codex').hidden = false;
  document.documentElement.style.setProperty('--chill', 0);
  renderCodex(); window.scrollTo({ top: 0 });
}

/* 结算后更新图鉴；第一次过线时放一次解锁动画 */
function recordResult(score) {
  dsSetScore(score);
  if (recipe.custom) return;                              // 社区里的自创配方不进图鉴
  const st = codexState(), before = isUnlocked(st, recipe.id), wasMaster = isMastered(st, recipe.id);
  const s = st[recipe.id] ||= { best: 0, passes: 0 };
  s.best = Math.max(s.best, score);
  if (score >= UNLOCK_SCORE) s.passes = (s.passes || 0) + 1;
  saveCodex(st); updateCodexCount();
  const note = $('#unlock-note');
  if (!before && isUnlocked(st, recipe.id)) {
    note.textContent = `${recipe.name} 已收进图鉴。`;
    setTimeout(() => showUnlock(recipe, '解锁了'), 700);
  } else if (!wasMaster && isMastered(st, recipe.id)) {
    note.textContent = `第 ${MASTER_TIMES} 次 ${UNLOCK_SCORE} 分以上，${recipe.name} 练熟了。`;
    setTimeout(() => showUnlock(recipe, '练熟了'), 700);
  } else if (isUnlocked(st, recipe.id)) {
    note.textContent = isMastered(st, recipe.id) ? `${recipe.name} 已练熟，最好成绩 ${s.best} 分。` : `已解锁。还差 ${MASTER_TIMES - s.passes} 次 ${UNLOCK_SCORE} 分以上就算练熟。`;
  } else {
    note.textContent = `还差 ${UNLOCK_SCORE - score} 分解锁${recipe.name}。`;
  }
}
function showUnlock(r, title) {
  showModal(`<div class="unlock" style="--drink:${r.color}">
    <p class="unlock-title">${title}</p>
    <div class="unlock-art" data-art="${r.id}">${drinkArt(r)}</div>
    <h2>${r.name}<span>${r.en}</span></h2>
    <div class="result-actions"><button class="primary" id="u-codex">去图鉴看看</button><button class="secondary" id="u-close">好的</button></div>
  </div>`);
  $('#u-codex').onclick = () => { $('#modal').close(); reset(); showCodex(); };
  $('#u-close').onclick = () => $('#modal').close();
}

/* ---------- 小工具 ---------- */
const deg = v => (v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
const clock = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
function stored() { try { return JSON.parse(localStorage.getItem(storeKey) || '[]'); } catch { return []; } }
function countSaved() { $('#saved-count').textContent = stored().length; }
function showModal(html) { $('#modal-content').innerHTML = html; $('#modal').showModal(); }
function escapeHTML(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function chime() {
  if (!sound) return;
  try {
    audio ||= new AudioContext(); audio.resume();
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * .12;
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.035, t + .03); g.gain.exponentialRampToValueAtTime(.001, t + .7);
      o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + .8);
    });
  } catch {}
}
/* 页面底色随温度变冷：室温 → 目标温度 映射到 0 → 1 */
function setChill(temp) {
  const c = Math.max(0, Math.min(1, (ROOM - temp) / (ROOM - target)));
  document.documentElement.style.setProperty('--chill', c.toFixed(3));
}

/* ---------- 温度曲线 ---------- */
function drawChart(svg, data, opt = {}) {
  // 视图尺寸跟随实际像素宽度，手机上字号不会被缩小
  const px = svg.clientWidth || 600;
  const W = Math.round(Math.max(300, Math.min(600, px))), L = 36, R = 12, T = 12, B = 28;
  // 专注模式下按屏幕高度定曲线高度，保证整页一屏放下
  const fitPx = svg.closest('.practicing') ? Math.max(130, Math.min(300, innerHeight * (innerWidth > 900 ? .27 : .22))) : 0;
  const H = fitPx ? Math.round(fitPx * W / px) : W < 480 ? 210 : 260;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const tgt = opt.target ?? target;
  const span = Math.max(opt.duration || 0, data.at(-1)?.t || 0, 10);
  const lo = Math.floor(Math.min(tgt, ...data.map(d => d.temp), ...data.map(d => d.reference)) - 2);
  const hi = ROOM + 2;
  const x = t => L + t / span * (W - L - R);
  const y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  const line = key => data.map(d => x(d.t).toFixed(1) + ',' + y(d[key]).toFixed(1)).join(' ');

  let g = '';
  (opt.bands || []).forEach(([a, b]) => { g += `<rect class="band" x="${x(a)}" y="${T}" width="${Math.max(3, x(b) - x(a))}" height="${H - T - B}"/>`; });
  const step = (hi - lo) > 16 ? 8 : 4;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-t" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v < 0 ? '−' + (-v) : v}°</text>`;
  }
  const tStep = span > 30 || W < 480 ? 10 : 5;
  for (let t = 0; t <= span; t += tStep) g += `<text class="axis-t" x="${x(t)}" y="${H - 8}" text-anchor="middle">${t}s</text>`;
  g += `<line class="tgt" x1="${L}" x2="${W - R}" y1="${y(tgt)}" y2="${y(tgt)}"/><text class="tgt-t" x="${opt.gap ? L + 6 : W - R}" y="${y(tgt) - 6}" text-anchor="${opt.gap ? 'start' : 'end'}">目标 ${deg(tgt)}°</text>`;
  if (data.length > 1) {
    g += `<polyline class="ref" points="${line('reference')}"/><polyline class="now" points="${line('temp')}"/>`;
  }
  if (data.length) {
    const last = data.at(-1);
    g += `<circle class="head" cx="${x(last.t)}" cy="${y(last.temp)}" r="6"/>`;
  }
  (opt.events || []).forEach(e => { g += `<circle class="ev" cx="${x(e.t)}" cy="${y(e.temp)}" r="3.5"/>`; });
  if (opt.gap) {
    const gx = x(opt.gap.t) - 10, y1 = y(opt.gap.temp), y2 = y(tgt);
    g += `<path class="gap" d="M${gx - 5} ${y1}H${gx}V${y2}H${gx - 5}"/><text class="gap-t" x="${gx - 8}" y="${(y1 + y2) / 2 + 4}" text-anchor="end">差 ${Math.abs(opt.gap.temp - tgt).toFixed(1)}°</text>`;
  }
  if (opt.markerT != null) g += `<line class="marker" x1="${x(opt.markerT)}" x2="${x(opt.markerT)}" y1="${T}" y2="${H - B}"/>`;
  svg.innerHTML = g;
}

/* ---------- 模拟数据源 ---------- */
const scenarios = [
  { name: '稳定操作', duration: 13, offset: 0.15, tempo: 1, amp: .72, kind: 'steady' },
  { name: '节奏偏慢', duration: 15, offset: 3.4, tempo: .65, amp: .68, kind: 'slow' },
  { name: '幅度不足', duration: 14, offset: 2.1, tempo: 1, amp: .34, kind: 'small' },
  { name: '频繁停顿', duration: 16, offset: 2.8, tempo: .92, amp: .64, kind: 'pause' },
  { name: '后程偏离', duration: 15, offset: -1.6, tempo: 1.35, amp: .86, kind: 'overshoot' }
];
function chooseScenario() {
  let i; do { i = Math.floor(Math.random() * scenarios.length); } while (i === previousScenario);
  previousScenario = i; return { ...scenarios[i] };
}
function demoSample(t, scenario = activeScenario) {
  const q = scenario || scenarios[0], p = Math.min(1, t / q.duration), end = target + q.offset;
  const reference = referenceAt(t, ROOM, q.duration);   // 用了社区参考曲线时，参考跟着那条曲线走
  const temp = ROOM - (ROOM - end) * (1 - Math.pow(1 - p, 2.2));
  let hz = desiredRhythm * q.tempo, amplitude = q.amp;
  if (t < 1) hz = 0;
  if (q.kind === 'steady' && p > .25 && p < .38) hz = desiredRhythm * .72;
  if (q.kind === 'slow' && p > .65) hz = desiredRhythm * .95;
  if (q.kind === 'small' && p > .66) amplitude = .68;
  if (q.kind === 'pause' && ((p > .25 && p < .34) || (p > .51 && p < .62) || (p > .78 && p < .84))) hz = 0;
  if (q.kind === 'overshoot' && p < .4) hz = desiredRhythm;
  if (hz > 0) hz += Math.sin(t * 1.7) * .06;
  return { t, temp, reference, hz, amplitude, target, valid: true, sourceEnded: t >= q.duration };
}

/* ---------- 判断当前该提示什么 ----------
   返回 [阶段, 标题, 说明, 短名, 语气]；语气用于提示卡颜色：go / warn / hold */
function decide(s) {
  if (!s.valid) return ['signal', '信号断了', '等数据恢复，这段时间不打分。', '信号中断', 'warn'];
  if (s.t < 1.5 && !s.hz) return ['ready', '握好杯子', '一手托底，一手按住杯盖。', '准备', 'go'];
  if (s.hz < .2) return ['pause', '动作停了', '温度还会自己变一点，但操作符合度先不动，等你接着摇。', '暂停', 'hold'];
  if (s.hz < desiredRhythm * .8) return ['slow', '再快一点', '比参考节奏慢。先把手速提上去，过几秒再看温度有没有跟着降。', '节奏偏慢', 'warn'];
  if (s.amplitude < .5) return ['amplitude', '摇的幅度大一些', '节奏够了，但来回的距离太短，冰块撞得不够。', '幅度偏小', 'warn'];
  if (s.temp < target - .8) return ['overshoot', '已经比目标还冷', '再摇只会多化冰，酒会变淡。可以停了。', '低于目标', 'warn'];
  if (s.hz > desiredRhythm * 1.2) return ['fast', '慢一点', '比你选的节奏快了，放慢点，稳住比快重要。', '节奏偏快', 'warn'];
  if (Math.abs(s.temp - target) <= .65) return ['settle', '快到目标温度了', '保持现在的动作，差不多就可以点完成。', '接近目标', 'hold'];
  const p = s.t / activeScenario.duration;
  if ((activeScenario.kind === 'slow' || activeScenario.kind === 'small') && p > .66 && p < .77)
    return ['observe', '调整到位了', '动作已经变了，温度要过几秒才会反应，先别急着改。', '观察响应', 'hold'];
  return ['shake', '节奏对了，保持住', '动作连贯就行，不用突然加力。', '稳定摇和', 'go'];
}

/* ---------- 操作符合度：四项分数 ----------
   停手温度 50、降温曲线 20、节奏 20、幅度 10。误差尺度都是演示值，未经实测标定。
   每一项返回得分，以及“哪些时间段在扣分”，结果页点某一项就把这些时间段标在曲线上。 */
const PARTS = [
  { key: 'end', name: '停手温度', max: 50 },
  { key: 'curve', name: '降温曲线', max: 20 },
  { key: 'rhythm', name: '节奏', max: 20 },
  { key: 'amp', name: '幅度', max: 10 }
];
const fits = {
  curve: (x) => Math.max(0, 1 - Math.abs(x.temp - x.reference) / 5),
  rhythm: (x, r) => Math.max(0, 1 - Math.abs(x.hz - r) / r),
  amp: x => x.hz < .2 ? 0 : Math.max(0, 1 - Math.abs(x.amplitude - .7) / .7)
};
// 判定为“这一帧在扣分”的门槛：曲线差 1.5 ℃ 以上、节奏差 20% 以上（含停顿）、幅度偏小或停住
const isBad = {
  curve: x => Math.abs(x.temp - x.reference) > 1.5,
  rhythm: (x, r) => Math.abs(x.hz - r) / r > .2,
  amp: x => x.hz < .2 || x.amplitude < .5
};
function scoreParts(list, last, tgt, rhythm) {
  const moving = list.filter(x => x.t >= 1 && x.t <= last.t && x.valid !== false);
  const average = fn => moving.length ? moving.reduce((sum, x) => sum + fn(x, rhythm), 0) / moving.length : 0;
  const raw = {
    end: 50 * Math.max(0, 1 - Math.abs(last.temp - tgt) / 8),
    curve: 20 * average(fits.curve),
    rhythm: 20 * average(fits.rhythm),
    amp: 10 * average(fits.amp)
  };
  const total = Math.round(Math.max(0, Math.min(100, raw.end + raw.curve + raw.rhythm + raw.amp)));
  // 各项取整后加起来要等于总分：先向下取整，差的分数给小数部分最大的几项
  const pts = Object.fromEntries(PARTS.map(p => [p.key, Math.floor(raw[p.key])]));
  let left = total - Object.values(pts).reduce((a, b) => a + b, 0);
  [...PARTS].sort((a, b) => (raw[b.key] % 1) - (raw[a.key] % 1)).forEach(p => { if (left > 0 && pts[p.key] < p.max) { pts[p.key]++; left--; } });
  return { total, pts, endTemp: last.temp, endT: last.t };
}
/* 把连续的扣分帧合并成时间段；间隔不到 0.5 秒的两段合成一段 */
function badBands(list, key, rhythm, until) {
  const bands = [];
  for (const x of list) {
    if (x.t < 1 || x.t > until || x.valid === false || !isBad[key](x, rhythm)) continue;
    const prev = bands.at(-1);
    if (prev && x.t - prev[1] <= .5) prev[1] = x.t; else bands.push([x.t, x.t]);
  }
  return bands.map(([a, b]) => [Math.max(0, a - .125), b + .125]);
}
function partDetail(key, data, parts, tgt, rhythm) {
  const p = PARTS.find(x => x.key === key), got = parts.pts[key];
  if (key === 'end') {
    const diff = parts.endTemp - tgt;
    return { bands: [], gap: { t: parts.endT, temp: parts.endTemp },
      text: `停手温度 ${got}/${p.max}：停在 ${deg(parts.endTemp)} ℃，目标 ${deg(tgt)} ℃，` +
        (Math.abs(diff) < .3 ? '基本正好。' : `${diff > 0 ? '还高' : '低了'} ${Math.abs(diff).toFixed(1)} ℃。这一项每差 1 ℃ 大约扣 6 分，` + (diff > 0 ? '再多摇一会儿就能补上。' : '下次早一点停手，多摇只是在加水。')) };
  }
  const bands = badBands(data, key, rhythm, parts.endT);
  const secs = bands.reduce((s, [a, b]) => s + b - a, 0);
  const head = `${p.name} ${got}/${p.max}：`;
  if (!bands.length) return { bands, text: head + '没有明显扣分的时间段。' };
  const where = `曲线上标红的 ${bands.length} 段，一共约 ${secs.toFixed(1)} 秒`;
  if (key === 'curve') {
    const inBand = data.filter(x => bands.some(([a, b]) => x.t >= a && x.t <= b));
    const warmer = inBand.reduce((s, x) => s + x.temp - x.reference, 0) > 0;
    return { bands, text: head + where + (warmer ? '，温度比参考降得慢。通常是摇得慢或幅度不够，冰和酒撞得少。' : '，温度比参考降得快，最后容易摇过头。') };
  }
  if (key === 'rhythm') return { bands, text: head + where + `，节奏和参考 ${rhythm.toFixed(1)} Hz 差了两成以上（停顿也算在内）。` };
  return { bands, text: head + where + '，来回距离偏短，或者停住了。' };
}
/* 结果页和“我的练习”回看共用：四项分数的列表，点一项在曲线上标出扣分时段 */
function renderParts(box, detail, svg, data, ev, opt, parts, rhythm) {
  box.innerHTML = '<p class="parts-title">每项得分</p>' + PARTS.map(p =>
    `<button data-part="${p.key}" aria-pressed="false"><span class="pn">${p.name}</span><span class="pbar"><i style="width:${parts.pts[p.key] / p.max * 100}%"></i></span><span class="pv"><b>${parts.pts[p.key]}</b>/${p.max}</span></button>`).join('');
  box.querySelectorAll('button').forEach(b => b.onclick = () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    document.querySelectorAll('[data-part], .events button').forEach(x => x.setAttribute('aria-pressed', 'false'));
    if (!on) { drawChart(svg, data, { ...opt, events: ev }); detail.textContent = weakest(parts); return; }
    b.setAttribute('aria-pressed', 'true');
    const d = partDetail(b.dataset.part, data, parts, opt.target, rhythm);
    drawChart(svg, data, { ...opt, events: ev, bands: d.bands, gap: d.gap });
    detail.textContent = d.text;
  });
}

/* 默认提示：丢分最多的那一项 */
function weakest(parts) {
  const p = [...PARTS].sort((a, b) => (b.max - parts.pts[b.key]) - (a.max - parts.pts[a.key]))[0];
  const lost = p.max - parts.pts[p.key];
  return lost <= 2 ? '四项都没怎么丢分。点一项可以在曲线上看细节。' : `丢分最多的是“${p.name}”，少了 ${lost} 分。点它，曲线上会标出是哪一段。`;
}

/* ---------- 解放双手：屏幕常亮、语音、节拍、放下自动结算 ---------- */
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && running) keepAwake(true); });

/* 语音：提示变了、并且稳定 0.75 秒才说，两句之间至少隔 2.5 秒，免得一直念 */
const SAY = { slow: '快一点', fast: '慢一点', amplitude: '幅度再大一点', overshoot: '够冷了，可以停了', settle: '快到目标了，保持', pause: '接着摇', signal: '信号断了' };
const FIXES = ['slow', 'fast', 'amplitude', 'pause'];
let voiceState = { pending: '', since: 0, said: '', at: 0 };
function speak(text) {
  if (!sound || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN'; u.rate = 1.15; speechSynthesis.speak(u);
  } catch {}
}
function voiceCue(stage, t) {
  const v = voiceState;
  if (stage !== v.pending) { v.pending = stage; v.since = t; return; }
  if (t - v.since < .75 || stage === v.said || performance.now() - v.at < 2500) return;
  // “保持住”只在纠正过之后说一次，算是给反馈
  const text = SAY[stage] || (stage === 'shake' && FIXES.includes(v.said) ? '好，保持住' : null);
  if (!text) return;
  v.said = stage; v.at = performance.now(); speak(text);
}
/* 节拍声：节奏偏快或偏慢时，按目标节奏轻轻地响，跟着声音调手速 */
let metro = null;
function metronome(on) {
  if (on && sound && !metro) {
    metro = setInterval(() => {
      try {
        audio ||= new AudioContext();
        const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
        o.frequency.value = 1320; g.gain.setValueAtTime(.05, t); g.gain.exponentialRampToValueAtTime(.001, t + .05);
        o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + .06);
      } catch {}
    }, 1000 / desiredRhythm);
  } else if (!on && metro) { clearInterval(metro); metro = null; }
}
/* 接真实杯子时：摇满 4 秒之后，停住 3 秒就当作放下杯子，自动结算 */
const AUTO_FINISH_AFTER = 4, AUTO_FINISH_IDLE = 3;
let motion = { first: null, last: null };

/* ---------- 每来一帧数据 ---------- */
function consumeSample(s) {
  samples.push(s);
  window.Cup3D?.sample(s);
  const [stage, title, desc, name, tone] = decide(s);

  $('#elapsed').textContent = clock(s.t);
  $('#temp').textContent = deg(s.temp);
  $('#freq').textContent = s.hz < .2 ? '0.0' : s.hz.toFixed(1);
  setChill(s.temp);

  // 网页自带的演示估算：没连评分服务时用它。连上了就由 algorithm.js 显示评分服务的结果
  if (s.valid !== false && s.hz > .2) { finalParts = scoreParts(samples, s, target, desiredRhythm); finalScore = finalParts.total; }
  algoSample(s);
  if (!algoScoring()) {
    $('#score').textContent = finalScore;
    $('#progress-fill').style.width = finalScore + '%';
    $('.meter').setAttribute('aria-valuenow', finalScore);
  }

  updateTeaching(s, stage);
  let cueTitle = title, cueDesc = desc;
  if (s.hz > .2 && s.valid !== false) { motion.first ??= s.t; motion.last = s.t; }
  const idle = motion.last == null ? 0 : s.t - motion.last;
  const autoArmed = activeScenario.kind === 'device' && motion.first != null && motion.last - motion.first >= AUTO_FINISH_AFTER;
  if (autoArmed && idle >= 1 && s.valid !== false) {
    cueTitle = '放下了？';
    cueDesc = `${Math.max(1, Math.ceil(AUTO_FINISH_IDLE - idle))} 秒后自动结算。接着摇就继续。`;
  }
  $('#cue-title').textContent = cueTitle;
  $('#cue-desc').textContent = cueDesc;
  voiceCue(stage, s.t);
  metronome(running && ['slow', 'fast'].includes(stage));
  $('#cue-kind').textContent = name;
  $('.cue').dataset.tone = tone;

  const live = $('#live');
  live.classList.toggle('shaking', s.hz > .2);
  live.style.setProperty('--period', (1 / Math.max(s.hz, .5)).toFixed(3) + 's');

  const step = ['ready', 'shake', 'settle'].includes(stage) ? stage
    : ['slow', 'fast', 'overshoot', 'amplitude', 'observe', 'pause'].includes(stage) ? 'adjust' : 'shake';
  $$('[data-step]').forEach(x => x.classList.toggle('active', x.dataset.step === step));

  if (stage !== lastEvent) { events.push({ t: s.t, stage, name, temp: s.temp, title }); lastEvent = stage; }
  drawChart($('#chart'), samples, { duration: activeScenario.duration });

  // 数据源停了不等于完成；只有用户确认才算。真实杯子放下 3 秒算确认。
  if (s.sourceEnded) waitForConfirmation();
  else if (autoArmed && idle >= AUTO_FINISH_IDLE && s.valid !== false) finish();
}

function updateTeaching(s, stage) {
  const lessons = {
    ready:     ['ready', '双手握稳', '确认杯盖扣紧'],
    shake:     ['steady', '均匀往复', '每一下距离差不多'],
    slow:      ['quick', '加快', '幅度不变，缩短每一下的间隔'],
    fast:      ['slow', '放慢', '幅度不变，拉长每一下的间隔'],
    amplitude: ['wide', '拉开距离', '节奏不变，手臂多伸展一些'],
    observe:   ['steady', '保持刚才的调整', '给温度几秒反应'],
    pause:     ['pause', '停住，别放下', '杯子拿稳，准备接着摇'],
    settle:    ['steady', '保持', '别突然加力'],
    overshoot: ['pause', '停手', '已经够冷了']
  };
  const l = lessons[stage] || lessons.ready;
  $('#teaching').dataset.action = l[0];
  $('#teach-title').textContent = l[1];
  $('#teach-detail').textContent = l[2];

  const prev = samples.length > 4 ? samples[samples.length - 5] : null;
  const rate = prev ? (prev.temp - s.temp) / (s.t - prev.t) : 0;
  $('#temp-note').textContent = !prev ? '刚开始记录'
    : rate > .03 ? `每秒降 ${rate.toFixed(2)} ℃`
    : rate < -.03 ? `每秒回升 ${Math.abs(rate).toFixed(2)} ℃`
    : '温度基本不动';

  const fn = $('#freq-note');
  const [fText, fTone] = s.hz < .2 ? ['没在摇', '']
    : Math.abs(s.hz - desiredRhythm) < .2 ? [`和参考 ${desiredRhythm.toFixed(1)} Hz 一致`, 'ok']
    : s.hz > desiredRhythm ? [`比参考 ${desiredRhythm.toFixed(1)} Hz 快`, 'warn']
    : [`比参考 ${desiredRhythm.toFixed(1)} Hz 慢`, 'warn'];
  fn.textContent = fText; fn.className = 'note ' + fTone;

  const an = $('#amplitude-note');
  $('#amplitude').textContent = s.hz < .2 ? '暂停' : s.amplitude < .5 ? '偏小' : '够大';
  an.textContent = s.hz < .2 ? '等你接着摇' : s.amplitude < .5 ? '来回距离再拉开些' : '冰块能撞到两头';
  an.className = 'note ' + (s.hz < .2 ? '' : s.amplitude < .5 ? 'warn' : 'ok');

  $('#change-feedback').textContent = {
    slow: '先改动作，再看温度：加快之后，降温应该会变快。',
    fast: '先改动作，再看温度：放慢之后，曲线会更贴近参考。',
    amplitude: '幅度拉开以后，冰和酒混得更充分，降温更稳。',
    observe: '动作变化已经识别到，温度的反应会慢半拍。',
    overshoot: '现在再摇，只是在往酒里加水。',
    pause: '暂停的这段会算进过程分里。'
  }[stage] || '';
}

function waitForConfirmation() {
  clearInterval(timer); timer = null; awaitingFinish = true; metronome(false);
  $('#live').classList.remove('shaking');
  $('#cue-kind').textContent = '记录结束';
  $('.cue').dataset.tone = 'hold';
  $('#cue-title').textContent = '摇得差不多了';
  $('#cue-desc').textContent = '点“这杯完成了”，看看这杯怎么样。';
  $('#change-feedback').textContent = '';
  $('#finish-hint').textContent = '点一下看结果。';
  $('#confirm-finish').classList.add('ready');
  $('#teaching').dataset.action = 'pause';
  $('#teach-title').textContent = '停手';
  $('#teach-detail').textContent = '去结算这一杯';
}

/* ---------- 流程 ---------- */
function setPracticing(on) {
  document.body.classList.toggle('practicing', on);
  $('#live').classList.toggle('practicing', on);
}
function start() {
  activeScenario = chooseScenario(); awaitingFinish = false;
  const ref = mode === 'standard' ? practiceRef : null;     // 社区里选的参考曲线（community.js）
  target = mode === 'free' ? Number($('#target').value) : ref ? ref.target : -2;
  desiredRhythm = mode === 'free' ? Number($('#rhythm').value) : ref ? ref.rhythm : 3;
  samples = []; events = []; lastEvent = ''; finalScore = 0; finalParts = null;
  running = true; completed = false; savedThisRun = false;
  window.Cup3D?.reset();
  motion = { first: null, last: null }; voiceState = { pending: '', since: 0, said: '', at: 0 };
  keepAwake(true);

  $('#scenario-label').textContent = '这次：' + activeScenario.name;
  $('#target-show').textContent = deg(target) + ' ℃';
  $('#confirm-finish').classList.remove('ready');
  $('#finish-hint').textContent = '觉得够了就点，按这一刻打分。';
  $('#setup').hidden = true; $('#live').hidden = false; $('#guide').hidden = false; $('#result').hidden = true;
  setPracticing(true);
  $$('[data-mode]').forEach(b => b.disabled = true);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  countdownThen(begin);
}

/* 进入练习页后先倒数 3 秒，让人把手机放好、拿起杯子；想马上开始可以点“现在开始” */
let countdown = null;
function countdownThen(go) {
  const box = $('#countdown'), num = $('#countdown-num');
  let n = 3;
  const done = () => { clearInterval(countdown); countdown = null; box.hidden = true; go(); };
  const show = () => { num.textContent = n; num.classList.remove('tick'); void num.offsetWidth; num.classList.add('tick'); speak(String(n)); };
  $('#cue-kind').textContent = '准备'; $('.cue').dataset.tone = 'go';
  $('#cue-title').textContent = '拿起杯子'; $('#cue-desc').textContent = '倒数结束就开始。';
  $('#change-feedback').textContent = '';
  drawChart($('#chart'), [], { duration: 15 });
  box.hidden = false; show();
  $('#countdown-skip').onclick = done;
  $('#countdown-cancel').onclick = reset;
  countdown = setInterval(() => { n--; if (n <= 0) done(); else show(); }, 1000);
}
function cancelCountdown() { if (countdown) { clearInterval(countdown); countdown = null; } $('#countdown').hidden = true; }

function begin() {
  if (!running) return;
  if (startWithDevice()) {
    // 真实数据：等杯子的消息推进，界面先摆好准备状态
    activeScenario = { name: '真实数据', duration: 15, kind: 'device' };
    $('#scenario-label').textContent = '这次：真实数据';
    $('#cue-kind').textContent = '准备'; $('.cue').dataset.tone = 'go';
    $('#cue-title').textContent = '握好杯子，开始摇';
    $('#cue-desc').textContent = '摇起来才开始计时。摇完放下杯子，3 秒后自动结算。';
    $('#finish-hint').textContent = '放下杯子 3 秒会自动结算，也可以直接点。';
    speak('摇起来就开始计时');
    $('#change-feedback').textContent = '';
    $('#teaching').dataset.action = 'ready';
    drawChart($('#chart'), [], { duration: 15 });
    return;
  }
  let tick = 0;
  algoBegin(false, ROOM);
  consumeSample(demoSample(0));
  timer = setInterval(() => { tick++; consumeSample(demoSample(tick * .25)); }, 250);
}

/* 评分服务在算，并且没出错 */
function algoScoring() { return !!(algo.s && !algo.s.error); }

function finish() {
  if (!running || !samples.length) return;
  clearInterval(timer); timer = null; running = false; completed = true; stopDevice();
  metronome(false); keepAwake(false);
  // dataset.js：接真杯子的这一杯存进测试数据，结果页可以标“正确 / 错误”
  dsAfterFinish(activeScenario.kind === 'device', { recipe: recipe.id, recipeName: recipe.name, samples });
  const last = samples.at(-1);
  $('#live').classList.remove('shaking');
  $('#guide').hidden = true; $('#result').hidden = false;
  setPracticing(false);
  $$('[data-mode]').forEach(b => b.disabled = false);

  $('#final-temp').textContent = deg(last.temp) + ' ℃';
  $('#final-time').textContent = last.t.toFixed(1) + ' 秒';
  $('#final-scenario').textContent = activeScenario.name;
  $('#save').disabled = false; $('#save').textContent = '收藏这次练习';
  $('#save-state').textContent = '';
  renderEvents($('#events'), $('#event-detail'), $('#chart'), samples, events, { duration: last.t, target });
  drawChart($('#chart'), samples, { duration: last.t, events });
  chime();

  if (algoScoring()) {
    // 结果以评分服务为准：先显示“正在算”，拿到冻结结果再填
    $('#result-score').textContent = '…';
    $('#result-summary').textContent = '评分服务正在汇总这一轮。';
    $('#parts').innerHTML = ''; $('#part-detail').textContent = '';
    $('#save').disabled = true;
    algoFinish().then(r => {
      if (!r) { showLocalResult(last, '评分服务没有返回结果，下面是网页的演示估算。'); return; }
      const v = r.final?.value;
      finalScore = v == null ? null : Math.round(v);
      $('#result-score').textContent = v == null ? '—' : finalScore;
      $('#result-summary').textContent = v == null
        ? '这一轮没有出完整分数：' + (r.final?.reason || '数据或时长不够。') + ' 下面列出已经确认的偏差。'
        : finalScore >= 90 ? '全程很贴近参考。' : finalScore >= 60 ? '有几段偏离了参考，下面标出了是哪几段。' : '偏离参考的时间比较长，先从下面第一条改起。';
      renderAlgoResult(r);
      $('#save').disabled = v == null;
      if (v != null) { recordResult(finalScore); setTimeout(() => speak(`${finalScore} 分`), 300); }
      showResultFx();
    });
    return;
  }
  showLocalResult(last);
}

/* 网页自带的演示估算（没连评分服务时） */
function showLocalResult(last, note) {
  $('#result-score').textContent = finalScore;
  const early = activeScenario.kind !== 'device' && last.t < activeScenario.duration;
  const verdict = finalScore >= 90 ? '整体很贴近参考，温度也停在了目标附近。'
    : finalScore >= 70 ? '有几段动作或温度偏离了参考，过程回看里能找到是哪几段。'
    : '离目标还差不少，在过程回看里找找是哪一段先开始偏的。';
  $('#result-summary').textContent = (note ? note + ' ' : '') + (early ? '你提前收手了。' : '') + verdict;
  $('#save').disabled = false;
  recordResult(finalScore);
  finalParts ||= scoreParts(samples, last, target, desiredRhythm);
  renderParts($('#parts'), $('#part-detail'), $('#chart'), samples, events, { duration: last.t, target }, finalParts, desiredRhythm);
  $('#part-detail').textContent = weakest(finalParts) + ' 这是网页的演示估算，没有连评分服务。';
  if (note) showResultFx();
  setTimeout(() => speak(`${finalScore} 分`), 900);
}

function reset() {
  cancelCountdown(); algoStop();
  clearInterval(timer); timer = null; running = false; completed = false; stopDevice(); dsCancel(); dsLabelBox(null);
  metronome(false); keepAwake(false); try { speechSynthesis.cancel(); } catch {}
  setPracticing(false);
  $('#live').classList.remove('shaking');
  $('#setup').hidden = false; $('#live').hidden = true; $('#codex').hidden = true; $('#community').hidden = true;
  $$('[data-mode]').forEach(b => b.disabled = false);
  document.documentElement.style.setProperty('--chill', 0);
  renderRecipe();
}

/* 回看：点一条事件，曲线上画一条竖线 */
function renderEvents(list, detail, svg, data, ev, opt) {
  list.innerHTML = ev.map((e, i) =>
    `<li><button data-i="${i}" aria-pressed="false"><span class="t">${e.t.toFixed(1)} s</span><span class="n">${escapeHTML(e.name)}</span><span class="c">${deg(e.temp)} ℃</span></button></li>`
  ).join('');
  detail.textContent = '曲线上的小圆点就是这些时刻。';
  list.querySelectorAll('button').forEach(b => b.onclick = () => {
    const e = ev[Number(b.dataset.i)];
    document.querySelectorAll('[data-part]').forEach(x => x.setAttribute('aria-pressed', 'false'));
    list.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
    drawChart(svg, data, { ...opt, events: ev, markerT: e.t });
    detail.textContent = `${e.t.toFixed(1)} 秒，${deg(e.temp)} ℃，${e.title}。`;
  });
}

/* ---------- 绑定 ---------- */
$('#start').onclick = start;
$('#confirm-finish').onclick = finish;
$('#cancel').onclick = reset;
$('#again').onclick = reset;
$('.brand').onclick = e => { e.preventDefault(); if (!running) reset(); };
$('#open-codex').onclick = showCodex;
$('#switch-recipe').onclick = showCodex;

$$('[data-mode]').forEach(b => b.onclick = () => {
  if (running) return;
  mode = b.dataset.mode;
  $$('[data-mode]').forEach(x => x.setAttribute('aria-selected', x === b));
  $('#free-settings').hidden = mode !== 'free';
});
$('#target').oninput = () => $('#target-value').textContent = deg(Number($('#target').value)) + ' ℃';
$('#rhythm').oninput = () => $('#rhythm-value').textContent = Number($('#rhythm').value).toFixed(1) + ' Hz';

$('#sound').title = '打开后：语音提示、节奏不对时响节拍、结算时报分';
$('#sound').onclick = () => {
  sound = !sound;
  $('#sound').textContent = '声音：' + (sound ? '开' : '关');
  $('#sound').setAttribute('aria-pressed', sound);
  if (sound) chime();
};

$('#close-modal').onclick = () => $('#modal').close();
$('#modal').addEventListener('click', e => {
  if (e.target !== $('#modal')) return;
  const r = e.target.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close();
});

$('#help').onclick = () => showModal(`
  <h2>项目介绍</h2>
  <p>我们在 HKUST(GZ) 黑客松做了一个会“教人摇酒”的杯子，这是它的配套网页。</p>
  <p>杯子能测酒液温度，也能记下你摇得多快、多大力。网页把这些实时画出来，告诉你该快一点、慢一点，还是可以停了。</p>
  <p>杯子还在做，所以现在放的是五段模拟的摇杯过程，每次随机一段。</p>
  <p>图鉴里收了 10 杯经典鸡尾酒，其中 6 杯摇和酒可以用杯子练。摇出 80 分就解锁这杯，同一杯三次 80 分以上就算练熟。</p>`);

$('#score-info').onclick = () => showModal(algo.available ? `
  <h2>操作符合度怎么算</h2>
  <p>看你这杯摇得跟参考有多像。比三样东西：酒液温度、摇动节奏、动作幅度（加速度的有效值）。</p>
  <p>在参考的容差以内不扣分；超出越多、持续越久，扣得越多。温度占的比重最大，节奏和幅度其次。</p>
  <p>练习中显示的是<b>当前</b>这一小段的符合度，改正后会回升；结束时给的是<b>整杯</b>的分数，前面的偏差会留在里面，所以两者可能不一样。</p>
  <p>数据不够（刚开始、信号断了、节奏认不清）时显示“—”，不会当成 0 分。参考和规则现在是演示用的合成值，还没有调酒师实测标定。</p>`
  : `
  <h2>操作符合度怎么算</h2>
  <p>简单说，就是看你这杯摇得跟参考有多像。</p>
  <p>一半看结果：停手时温度离目标有多近。另一半看过程：降温曲线贴不贴参考占 20%，节奏稳不稳占 20%，幅度够不够占 10%。</p>
  <p>中途停下来，分数会先停住。收手太早或者摇过头，都会扣分。</p>
  <p>这是网页里的演示估算。用评分服务打开网站（见 README）时，改由评分服务计算。</p>`);

$('#save').onclick = () => {
  if (savedThisRun) return;
  try {
    const all = stored();
    all.unshift({ date: new Date().toISOString(), recipe: recipe.id, recipeName: recipe.name, mode, target, rhythm: desiredRhythm, score: finalScore, parts: algoRecord().by === 'service' ? null : finalParts, scoring: algoRecord(), scenario: activeScenario.name, samples, events, datasetId: activeScenario.kind === 'device' ? dsLastId : null });
    localStorage.setItem(storeKey, JSON.stringify(all.slice(0, 20)));
    savedThisRun = true;
    $('#save').textContent = '已收藏'; $('#save').disabled = true;
    $('#save-state').textContent = '在右上角“我的练习”里可以找到。';
    countSaved();
  } catch {
    $('#save-state').textContent = '没存上：这个浏览器不让存，或者存满了。';
  }
};

$('#collection').onclick = () => {
  const all = stored();
  showModal('<h2>我的练习</h2>' + (all.length
    ? all.map((v, i) => `<div class="saved"><b>${v.score ?? '—'}</b><div>${escapeHTML(v.recipeName || '威士忌酸')}，${v.mode === 'free' ? '自己定' : '跟参考练'}<br><span>${new Date(v.date).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}，${escapeHTML(v.scenario || '')}，${v.scoring?.by === 'service' ? '评分服务' : '网页估算'}</span></div><button class="secondary" data-index="${i}">回看</button></div>`).join('')
    : '<p>还没有收藏。</p>'));
  $$('#modal-content [data-index]').forEach(b => b.onclick = () => {
    const v = all[Number(b.dataset.index)];
    const opt = { duration: v.samples.at(-1)?.t || 10, target: v.target };
    showModal(`<h2>回看：${v.score} 分</h2><p class="fine">${escapeHTML(v.scenario || '')}，目标 ${deg(v.target)} ℃</p><svg class="chart" id="m-chart" viewBox="0 0 600 260"></svg><div class="parts" id="m-parts"></div><p class="part-detail" id="m-part-detail"></p><ol class="events" id="m-events"></ol><p class="event-detail" id="m-detail"></p>`);
    drawChart($('#m-chart'), v.samples, { ...opt, events: v.events });
    // 评分服务打的分按当时冻结的结果显示，不用现在的规则重算
    if (v.scoring?.by === 'service') {
      $('#m-parts').innerHTML = (v.scoring.issues || []).map(x => `<p class="saved-issue"><b>${x.start.toFixed(1)}–${x.end.toFixed(1)} 秒</b> ${escapeHTML(x.observation)}</p>`).join('') || '<p class="fine">没有超出参考容差的地方。</p>';
      $('#m-part-detail').textContent = `评分服务，规则 ${v.scoring.rule}（${v.scoring.policy}、${v.scoring.mapping}），参考 ${v.scoring.reference}，${v.scoring.source === 'measured' ? '杯子实测' : '演示数据'}。`;
      renderEvents($('#m-events'), $('#m-detail'), $('#m-chart'), v.samples, v.events, opt);
      return;
    }
    const rhythm = v.rhythm || 3, parts = v.parts || (v.samples.length ? scoreParts(v.samples, v.samples.at(-1), v.target, rhythm) : null);
    if (parts) { renderParts($('#m-parts'), $('#m-part-detail'), $('#m-chart'), v.samples, v.events, opt, parts, rhythm); $('#m-part-detail').textContent = weakest(parts); }
    renderEvents($('#m-events'), $('#m-detail'), $('#m-chart'), v.samples, v.events, opt);
  });
};

countSaved();
renderRecipe();
revealStage();

/* ---------- 实时 3D 杯子 ----------
   练习页右上那一格可以在“我的杯子”（3D，跟着传感器动）和“示范”（标准动作动画）之间切换。
   浏览器不支持 WebGL 时只留示范。 */
const VIEW_KEY = 'shakecup-demo-view';
function setDemoView(v) {
  $('#teaching').dataset.view = v;
  $$('.demo-switch [data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  try { localStorage.setItem(VIEW_KEY, v); } catch {}
}
function setupCup3D() {
  const box = $('#cup3d');
  const view = window.Cup3D && Cup3D.mount(box);
  if (!view) { box.remove(); $('.demo-switch').remove(); $('#teaching').dataset.view = 'teach'; return; }
  let v = 'live'; try { v = localStorage.getItem(VIEW_KEY) || 'live'; } catch {}
  setDemoView(v);
  $$('.demo-switch [data-view]').forEach(b => b.onclick = () => setDemoView(b.dataset.view));
  box.querySelector('.c3-cal').onclick = () => Cup3D.recalibrate();
  // 手机上练习时没有切换按钮：点画面切到示范，点示范切回来
  const narrow = () => matchMedia('(max-width: 900px)').matches && $('#live').classList.contains('practicing');
  box.querySelector('.c3-stage').onclick = () => { if (narrow()) setDemoView('teach'); };
  $('#teaching .demo-stage').onclick = () => { if (narrow()) setDemoView('live'); };
  // 放大：手机上整页铺满（iPhone 不支持元素全屏），电脑上再请求真正的全屏
  const full = box.querySelector('.c3-full');
  const setMax = on => {
    box.classList.toggle('c3-max', on);
    full.setAttribute('aria-label', on ? '缩小' : '放大');
    document.body.classList.toggle('c3-maxed', on);
  };
  full.onclick = () => {
    const on = !box.classList.contains('c3-max');
    setMax(on);
    if (on) box.requestFullscreen?.().catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && box.classList.contains('c3-max')) setMax(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && box.classList.contains('c3-max')) setMax(false); });
}
document.addEventListener("DOMContentLoaded", setupCup3D);   // cup3d.js 在 app.js 之后加载
