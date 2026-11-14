'use strict';
/* 练习时的完整步骤：准备、加料、加冰、摇和、过滤、装饰……只列这杯配方有的步骤（app.js 的 flowOf）。

   - 摇和之前的步骤（加料、加冰等）：杯子测不到，用户做完自己点“做好了”。顺序不强制，点上面任意一步也能标完成。
   - 摇和：杯子测（或模拟数据），和原来一样，摇完放下自动结算。
   - 摇和之后的步骤（过滤、装饰等）：分数在摇和结束时已经定了，这些只是提醒做完，点一下标完成，不影响分数。

   页面顶上一条步骤条，标出已完成、当前、下一步。 */

const flow = { steps: [], done: new Set(), si: -1, phase: 'idle' };

function flowInit(r) {
  flow.steps = flowOf(r);
  flow.si = flow.steps.findIndex(x => x.sensor);
  flow.done = new Set();
  flow.phase = 'idle';
}
const prePart = () => flow.steps.map((x, i) => i).filter(i => i < flow.si);
const postPart = () => flow.steps.map((x, i) => i).filter(i => i > flow.si);
const firstTodo = list => list.find(i => !flow.done.has(i));

/* 当前步：准备阶段是第一个没做的前置步骤；摇和阶段是摇和；之后是第一个没做的收尾步骤 */
function flowCurrent() {
  if (flow.phase === 'prep') return firstTodo(prePart()) ?? flow.si;
  if (flow.phase === 'shake') return flow.si;
  if (flow.phase === 'after') return firstTodo(postPart()) ?? -1;
  return -1;
}
function flowNext(cur) {
  if (cur < 0) return -1;
  for (let i = cur + 1; i < flow.steps.length; i++) if (!flow.done.has(i)) return i;
  return -1;
}

function renderFlow() {
  const rail = $('#flow-rail'); if (!rail) return;
  const cur = flowCurrent(), next = flowNext(cur);
  const clickable = i => (flow.phase === 'prep' && i < flow.si) || (flow.phase === 'after' && i > flow.si);
  rail.innerHTML = flow.steps.map((x, i) => {
    const state = flow.done.has(i) ? 'done' : i === cur ? 'current' : i === next ? 'next' : 'todo';
    const tag = state === 'current' ? '现在' : state === 'next' ? '下一步' : state === 'done' ? '完成' : '';
    const inner = `<span class="fr-n" aria-hidden="true">${state === 'done' ? '✓' : i + 1}</span>
      <span class="fr-body"><span class="fr-k">${x.kind}${x.sensor ? '<em>杯子测</em>' : ''}${tag ? `<small>${tag}</small>` : ''}</span><span class="fr-t">${escapeHTML(x.text)}</span></span>`;
    return `<li class="fr ${state}${x.sensor ? ' sensor' : ''}" data-i="${i}">${clickable(i)
      ? `<button type="button" aria-pressed="${flow.done.has(i)}" title="${flow.done.has(i) ? '点一下取消完成' : '点一下标为完成'}">${inner}</button>`
      : `<div>${inner}</div>`}</li>`;
  }).join('');
  rail.querySelectorAll('button').forEach(b => b.onclick = () => {
    const i = Number(b.closest('li').dataset.i);
    flow.done.has(i) ? flow.done.delete(i) : flow.done.add(i);
    flowChanged();
  });
  // 当前步滚进视野（窄屏上步骤条是横向滚动的）
  rail.querySelector('.current')?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });

  const post = postPart(), left = post.filter(i => !flow.done.has(i));
  $('#flow-hint').textContent =
    flow.phase === 'shake' ? (post.length ? `杯子在测摇和。${post.map(i => flow.steps[i].kind).join('、')}摇完再做。` : '杯子在测摇和。')
    : flow.phase === 'after' ? (!post.length ? '这杯做完了。'
      : left.length ? `摇和结束，分数已经定了。接着${left.map(i => flow.steps[i].kind).join('、')}，做完在上面点一下（不影响分数）。`
      : '全部步骤做完了，干杯。')
    : '';
}

/* 准备阶段的大卡片：当前这一步 + 下一步 */
function renderPrep() {
  const cur = flowCurrent(), x = flow.steps[cur], nx = flow.steps[flowNext(cur)];
  $('#prep-kind').textContent = x.kind;
  $('#prep-title').textContent = x.text;
  $('#prep-next').textContent = nx ? `下一步：${nx.kind}${nx.sensor ? '（杯子测）' : ''}` : '';
  const pre = prePart();
  $('#prep-done').textContent = pre.filter(i => !flow.done.has(i)).length > 1 ? '做好了，下一步' : '做好了，开始摇';
}

function flowChanged() {
  if (flow.phase === 'prep') {
    if (prePart().every(i => flow.done.has(i))) { flowToShake(); return; }
    renderPrep();
  }
  renderFlow();
}

/* 点“开始练习”：有前置步骤就先过一遍，没有就直接进摇和 */
function startFlow() {
  flowInit(recipe);
  if (flow.si <= 0) { flowToShake(); return; }
  flow.phase = 'prep';
  $('#setup').hidden = true; $('#codex').hidden = true; $('#community').hidden = true;
  $('#live').hidden = false; $('#live').classList.add('prepping');
  $('#prep').hidden = false; $('#guide').hidden = true; $('#result').hidden = true;
  document.body.classList.add('practicing');
  renderPrep(); renderFlow();
  window.scrollTo({ top: 0 });
}
function flowToShake() {
  $('#prep').hidden = true; $('#live').classList.remove('prepping');
  start();                      // app.js：倒数、开始测
}
function prepSkip() { if (flow.phase === 'prep') flowToShake(); }

/* 接到 app.js 的流程上：开始测 → 摇和阶段；结算 → 收尾阶段；返回 → 清掉 */
{
  const origStart = start, origFinish = finish, origReset = reset;
  start = function (...a) {
    if (flow.phase === 'idle' || !flow.steps.length || flow.phase === 'after') flowInit(recipe);   // 直接调 start()（测试、再摇一杯）也有步骤条
    prePart().forEach(i => flow.done.add(i));         // 前置步骤视为做过（跳过的也算，不强制顺序）
    flow.phase = 'shake';
    const out = origStart.apply(this, a);
    renderFlow(); return out;
  };
  finish = function (...a) {
    const out = origFinish.apply(this, a);
    if (completed && flow.phase === 'shake') { flow.done.add(flow.si); flow.phase = 'after'; renderFlow(); }
    return out;
  };
  reset = function (...a) {
    flow.phase = 'idle'; flow.done = new Set();
    $('#prep').hidden = true; $('#live').classList.remove('prepping');
    $('#flow-rail').innerHTML = ''; $('#flow-hint').textContent = '';
    return origReset.apply(this, a);
  };
}

$('#start').onclick = startFlow;
$('#prep-done').onclick = () => { const cur = flowCurrent(); if (cur >= 0 && cur < flow.si) flow.done.add(cur); flowChanged(); };
$('#prep-skip').onclick = prepSkip;
$('#prep-cancel').onclick = () => reset();
$('#cancel').onclick = () => reset();
$('#again').onclick = () => reset();
