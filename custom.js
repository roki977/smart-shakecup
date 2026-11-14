'use strict';
/* 自己定：自己搭一杯摇和的酒。选原料类别、品种、用量，再定目标温度。

   - 不限于改现有酒款：可以从空白开始加，也可以“从刚才那杯开始”改。
   - 主界面左边的配料、酒名、制作步骤跟着实时变。
   - 没有实测参考：参考线是按目标温度画的通用降温线（app.js 的默认公式），分数是网页估算，页面上写明；成绩不进图鉴。
   - 草稿存在这台设备上，下次打开还在。 */

const OWN_KEY = 'shakecup-own-recipe-v1';
const OWN_KINDS = {
  基酒: ['金酒', '伏特加', '白朗姆', '黑朗姆', '波本威士忌', '黑麦威士忌', '苏格兰威士忌', '龙舌兰', '梅斯卡尔', '干邑', '皮斯科'],
  利口酒: ['君度', '橙味利口酒', '咖啡利口酒', '杏仁利口酒', '接骨木花利口酒', '马拉斯奇诺', '金巴利', '阿佩罗', '甜味美思', '干味美思'],
  糖浆: ['糖浆（1:1）', '浓糖浆（2:1）', '蜂蜜糖浆', '杏仁糖浆', '红石榴糖浆', '姜糖浆'],
  果汁: ['鲜柠檬汁', '鲜青柠汁', '橙汁', '西柚汁', '菠萝汁', '蔓越莓汁'],
  其他: ['蛋清', '苦精', '奶油', '苏打水', '姜汁啤酒']
};
const OWN_DEFAULT_ML = { 基酒: 45, 利口酒: 15, 糖浆: 15, 果汁: 25, 其他: '' };

let ownBase = null;                       // 切到“自己定”之前看的那杯，切回来时还原
let own = loadOwn();

function loadOwn() {
  try { const v = JSON.parse(localStorage.getItem(OWN_KEY)); if (v?.parts) return v; } catch {}
  return { name: '', parts: [{ cat: '基酒', name: '金酒', ml: 45 }, { cat: '果汁', name: '鲜柠檬汁', ml: 25 }, { cat: '糖浆', name: '糖浆（1:1）', ml: 20 }] };
}
function saveOwn() { try { localStorage.setItem(OWN_KEY, JSON.stringify(own)); } catch {} }

/* 现有配方的一行原料 → 猜个类别（只用来预填下拉框，猜不中就放“其他”） */
function guessCat(n) {
  for (const [cat, list] of Object.entries(OWN_KINDS)) if (list.some(x => n.includes(x.replace(/（.*）/, '')))) return cat;
  if (/金酒|伏特加|朗姆|威士忌|龙舌兰|干邑|白兰地|皮斯科|梅斯卡尔/.test(n)) return '基酒';
  if (/糖浆|蜂蜜|糖/.test(n)) return '糖浆';
  if (/汁/.test(n)) return '果汁';
  if (/利口|味美思|金巴利|阿佩罗|君度|苦艾/.test(n)) return '利口酒';
  return '其他';
}

/* 把编辑器里的内容变成一个配方对象，和图鉴里的配方同一个格式 */
function ownRecipe() {
  const parts = own.parts.filter(p => p.name.trim()).map(p => {
    const v = String(p.ml ?? '').trim();
    return [p.name.trim(), /^\d+(\.\d+)?$/.test(v) ? Number(v) : v || '适量'];
  });
  return { id: 'own', custom: true, own: true, name: own.name.trim() || '我的配方', en: 'My Recipe', shake: true, method: '摇和',
    glass: 'coupe', glassName: '鸡尾酒杯', color: '#e9b44c', garnish: 'none', deco: '无',
    note: '自己搭的配方。', parts: parts.length ? parts : [['还没加原料', '']], how: '' };
}

function renderOwnEditor() {
  $('#own-name').value = own.name;
  $('#own-parts').innerHTML = own.parts.map((p, i) => `
    <div class="own-row" data-i="${i}">
      <select class="own-cat" aria-label="原料类别">${Object.keys(OWN_KINDS).map(c => `<option${c === p.cat ? ' selected' : ''}>${c}</option>`).join('')}</select>
      <input class="own-kind" list="own-kinds-${i}" value="${escapeHTML(p.name)}" placeholder="选或输入" aria-label="品种" maxlength="20">
      <datalist id="own-kinds-${i}">${(OWN_KINDS[p.cat] || []).map(x => `<option value="${escapeHTML(x)}">`).join('')}</datalist>
      <span class="own-ml"><input class="own-amt" inputmode="decimal" value="${escapeHTML(String(p.ml ?? ''))}" placeholder="${p.cat === '其他' ? '如 2 滴' : 'ml'}" aria-label="用量" maxlength="10"><small>${/^\d+(\.\d+)?$/.test(String(p.ml ?? '')) || p.ml === '' ? 'ml' : ''}</small></span>
      <button type="button" class="own-del" aria-label="删掉这一样">×</button>
    </div>`).join('');
  $$('#own-parts .own-row').forEach(row => {
    const i = Number(row.dataset.i), p = own.parts[i];
    row.querySelector('.own-cat').onchange = e => {
      p.cat = e.target.value;
      if (!OWN_KINDS[p.cat].includes(p.name)) p.name = OWN_KINDS[p.cat][0];
      if (p.ml === '' || p.ml == null) p.ml = OWN_DEFAULT_ML[p.cat];
      ownChanged(true);
    };
    row.querySelector('.own-kind').oninput = e => { p.name = e.target.value; ownChanged(); };
    row.querySelector('.own-amt').oninput = e => { p.ml = e.target.value; ownChanged(); };
    row.querySelector('.own-del').onclick = () => { own.parts.splice(i, 1); ownChanged(true); };
  });
}
/* 改了内容：存草稿，主界面跟着变；redraw 表示编辑器本身也要重画（加删行、换类别） */
function ownChanged(redraw) {
  saveOwn();
  if (redraw) renderOwnEditor();
  // 边改边看：不重播配料的入场动画（不然每打一个字配料都要重新淡入）
  if (mode === 'free') { $('#stage').classList.remove('reveal'); recipe = ownRecipe(); renderRecipe(); }
}

function enterOwn() {
  if (!recipe.own) ownBase = recipe;
  practiceRef = null; renderRefChip();
  renderOwnEditor();
  recipe = ownRecipe(); renderRecipe();
}
function leaveOwn() {
  if (recipe.own) { recipe = ownBase || RECIPES[0]; renderRecipe(); }
}

$('#own-name').oninput = e => { own.name = e.target.value; ownChanged(); };
$('#own-add').onclick = () => { own.parts.push({ cat: '其他', name: '', ml: '' }); ownChanged(true); $$('#own-parts .own-kind').at(-1)?.focus(); };
$('#own-clear').onclick = () => { own = { name: '', parts: [{ cat: '基酒', name: '', ml: 45 }] }; ownChanged(true); };
$('#own-copy').onclick = () => {
  const from = ownBase || RECIPES[0];
  own = { name: `我的${from.name}`, parts: from.parts.map(([n, ml]) => ({ cat: guessCat(n), name: n, ml: typeof ml === 'number' ? ml : ml })) };
  ownChanged(true);
};

/* 模式切换：替换 app.js 里的处理，进出“自己定”时换配方 */
$$('[data-mode]').forEach(b => b.onclick = () => {
  if (running) return;
  const was = mode;
  mode = b.dataset.mode;
  $$('[data-mode]').forEach(x => x.setAttribute('aria-selected', x === b));
  $('#free-settings').hidden = mode !== 'free';
  if (mode === 'free' && was !== 'free') enterOwn();
  if (mode !== 'free' && was === 'free') leaveOwn();
});

/* 底部酒单换一杯：回到“跟参考练” */
{
  const orig = window.renderStrip;
  window.renderStrip = function (...a) {
    const out = orig.apply(this, a);
    $$('#drink-strip [data-pick]').forEach(b => {
      const inner = b.onclick;
      b.onclick = () => {
        if (mode === 'free') {
          if (b.dataset.pick === 'own') return;
          ownBase = RECIPES.find(x => x.id === b.dataset.pick) || ownBase;
          $('[data-mode="standard"]').click();
          return;
        }
        inner?.();
      };
    });
    return out;
  };
}
