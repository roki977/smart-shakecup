'use strict';
/* 测试数据集：接真杯子摇完一杯，自动把这一杯存下来，队友再标“正确数据”或“错误数据”。

   存在这台设备浏览器的 IndexedDB 里（不依赖网络，刷新、关页面都还在）。
   每一杯一条记录：
     { id, createdAt, device, recipe, recipeName, score, duration,
       label: null | 'good' | 'bad', note,
       samples: [{ t, temp, reference, hz, amplitude, valid }],   // 网页画曲线用的那一份
       packets: [[收到时间ms, 原始JSON文本], ...] }               // 杯子发来的原始包，原样保存
   导出 JSON（含原始包，给算法用）或 CSV（每个采样点一行，Excel 能开）；
   别的设备导出的 JSON 可以导入合并（同 id 不重复）。

   只记接了真杯子的练习；模拟数据不记。 */

const DS_DB = 'shakecup-dataset', DS_STORE = 'runs';
const DS_LABEL = { good: '正确数据', bad: '错误数据' };
const DS_MAX_PACKETS = 3000;            // 一杯最多存这么多包（10 包/秒约 5 分钟），防止忘了结束一直录

let dsDBp = null;
function dsDB() {
  return dsDBp ||= new Promise((ok, fail) => {
    if (!window.indexedDB) { fail(new Error('这个浏览器不能存数据')); return; }
    const req = indexedDB.open(DS_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DS_STORE, { keyPath: 'id' });
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}
async function dsTx(mode, fn) {
  const db = await dsDB();
  return new Promise((ok, fail) => {
    const tx = db.transaction(DS_STORE, mode), st = tx.objectStore(DS_STORE);
    let out; const r = fn(st);
    if (r) r.onsuccess = () => { out = r.result; };
    tx.oncomplete = () => ok(out);
    tx.onerror = () => fail(tx.error);
    tx.onabort = () => fail(tx.error || new Error('没存上（可能存满了）'));
  });
}
const dsPut = run => dsTx('readwrite', st => st.put(run));
const dsGet = id => dsTx('readonly', st => st.get(id));
const dsDel = id => dsTx('readwrite', st => st.delete(id));
const dsAll = async () => ((await dsTx('readonly', st => st.getAll())) || []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/* ---------- 录制：device.js 在开始 / 收包 / 结束时调用 ---------- */
let dsRec = null;        // 正在录的这一杯：{ packets, device, ... }
let dsLastId = null;     // 刚存下的那一杯（结果页标注用）

function dsBegin(device) {
  dsRec = { device: device || '', packets: [], startedAt: new Date().toISOString() };
  dsLastId = null;
}
function dsPacket(text) {
  if (dsRec && dsRec.packets.length < DS_MAX_PACKETS) dsRec.packets.push([Date.now(), text]);
}
function dsCancel() { dsRec = null; }

/* 这一杯结束（结果页出来时）：存下来，返回 id */
let dsPending = Promise.resolve(null);
function dsFinish(info) { return dsPending = dsSave(info); }
let dsLastError = '';
async function dsSave(info) {
  const r = dsRec; dsRec = null; dsLastError = '';
  if (!r || !r.packets.length) { dsLastError = '这一杯没有收到杯子的数据包。'; return null; }
  const run = {
    id: 'run-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    createdAt: r.startedAt, device: r.device,
    recipe: info.recipe, recipeName: info.recipeName, score: null,
    duration: info.samples.at(-1)?.t ?? 0,
    label: null, note: '',
    samples: info.samples.map(s => ({ t: +s.t.toFixed(2), temp: s.temp, reference: s.reference, hz: s.hz, amplitude: s.amplitude, valid: s.valid !== false })),
    packets: r.packets
  };
  try { await dsPut(run); dsLastId = run.id; dsRefreshCount(); return run.id; }
  catch (e) { console.warn('测试数据没存上', e); dsLastError = '浏览器不让存（' + (e?.message || e) + '）。无痕模式下存不了，换普通窗口试试。'; return null; }
}
/* 分数出来后补上（评分服务是异步的） */
async function dsSetScore(score) {
  await dsPending;
  if (!dsLastId) return;
  try { const run = await dsGet(dsLastId); if (run) { run.score = score; await dsPut(run); } } catch {}
}
async function dsUpdate(id, patch) {
  const run = await dsGet(id); if (!run) return null;
  Object.assign(run, patch); await dsPut(run); dsRefreshCount(); return run;
}

/* ---------- 顶栏计数 ---------- */
async function dsRefreshCount() {
  const btn = $('#open-dataset'); if (!btn) return;
  let all = [];
  try { all = await dsAll(); } catch {}
  const todo = all.filter(r => !r.label).length;
  $('#dataset-count').textContent = todo ? `${todo} 待标` : all.length;
  btn.dataset.empty = all.length ? '0' : '1';
}

/* ---------- 结果页：标这一杯 ---------- */
/* 结算时调用：真杯子就存下并显示标注；没存（模拟数据、出错）就写明原因 */
function dsAfterFinish(isDevice, info) {
  dsLabelBox(null);
  if (isDevice) {
    dsFinish(info).then(id => id ? dsGet(id).then(dsLabelBox) : dsNote('这一杯没存进测试数据：' + dsLastError));
  } else if (typeof dev !== 'undefined' && dev.client) {
    // 试过连杯子，但这一杯走的是模拟数据：说清楚，免得以为是坏了
    dsNote('这一杯用的是<b>模拟数据</b>，没有存进测试数据。要等顶栏显示“杯子：在线”再点开始练习，才会用真杯子的数据并存下来。');
  }
}
function dsNote(html) {
  const box = $('#ds-label'); if (!box) return;
  box.hidden = false; box.innerHTML = `<span class="fine">${html}</span>`;
}
function dsLabelBox(run) {
  const box = $('#ds-label'); if (!box) return;
  if (!run) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = `<b>这一杯的测试数据已存下</b>
    <div class="ds-choice" role="group" aria-label="标注">
      <button type="button" data-label="good" aria-pressed="${run.label === 'good'}">正确数据</button>
      <button type="button" data-label="bad" aria-pressed="${run.label === 'bad'}">错误数据</button>
    </div>
    <input class="ds-note" placeholder="备注（可空），比如：故意摇太慢、探头没插好" value="${escapeHTML(run.note || '')}" maxlength="200">
    <span class="fine ds-state"></span>`;
  bindLabel(box, run.id, () => { box.querySelector('.ds-state').textContent = '已保存。所有测试数据在顶栏“测试数据”里。'; });
}
function bindLabel(box, id, done) {
  box.querySelectorAll('[data-label]').forEach(b => b.onclick = async () => {
    const was = b.getAttribute('aria-pressed') === 'true';
    await dsUpdate(id, { label: was ? null : b.dataset.label });
    box.querySelectorAll('[data-label]').forEach(x => x.setAttribute('aria-pressed', String(!was && x === b)));
    done?.();
  });
  const note = box.querySelector('.ds-note');
  if (note) note.onchange = async () => { await dsUpdate(id, { note: note.value.trim() }); done?.(); };
}

/* ---------- 数据集弹窗：看曲线、改标注、导出 ---------- */
let dsFilter = 'all';
async function openDataset() {
  let all;
  try { all = await dsAll(); } catch (e) { showModal(`<h2>测试数据</h2><p>${escapeHTML(e.message)}</p>`); return; }
  const n = k => all.filter(r => (k === 'todo' ? !r.label : r.label === k)).length;
  const shown = all.filter(r => dsFilter === 'all' || (dsFilter === 'todo' ? !r.label : r.label === dsFilter));
  const when = d => new Date(d).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  showModal(`<h2>测试数据</h2>
    <p class="fine">接上杯子每摇完一杯自动存一条（存在这台设备的浏览器里）。看曲线，标成“正确数据”或“错误数据”，再导出给算法用。</p>
    <div class="ds-filter" role="group">
      ${[['all', '全部', all.length], ['todo', '待标', n('todo')], ['good', '正确', n('good')], ['bad', '错误', n('bad')]]
        .map(([k, t, c]) => `<button type="button" data-filter="${k}" aria-pressed="${dsFilter === k}">${t} ${c}</button>`).join('')}
    </div>
    <div class="ds-list">${shown.length ? shown.map(r => `
      <div class="ds-run" data-id="${r.id}" data-label="${r.label || ''}">
        <div class="ds-head">
          <b>${escapeHTML(r.recipeName || '')}</b>
          <span>${when(r.createdAt)} · ${escapeHTML(r.device || '')} · ${r.duration.toFixed(1)} 秒 · ${r.packets.length} 包${r.score != null ? ` · ${r.score} 分` : ''}</span>
          <button type="button" class="ds-del" title="删除这一条">删除</button>
        </div>
        <svg class="chart ds-chart" viewBox="0 0 600 210"></svg>
        <div class="ds-row">
          <div class="ds-choice" role="group">
            <button type="button" data-label="good" aria-pressed="${r.label === 'good'}">正确数据</button>
            <button type="button" data-label="bad" aria-pressed="${r.label === 'bad'}">错误数据</button>
          </div>
          <input class="ds-note" placeholder="备注" value="${escapeHTML(r.note || '')}" maxlength="200">
        </div>
      </div>`).join('') : `<p class="fine">${all.length ? '这一类还没有。' : '还没有测试数据。接上杯子（顶栏“杯子”），摇完一杯就会出现在这里。'}</p>`}
    </div>
    <div class="result-actions ds-actions">
      <button class="primary" type="button" id="ds-json" ${all.length ? '' : 'disabled'}>导出 JSON（含原始包）</button>
      <button class="secondary" type="button" id="ds-csv" ${all.length ? '' : 'disabled'}>导出 CSV</button>
      <label class="secondary ds-import">导入 JSON<input type="file" accept=".json,application/json" id="ds-file" hidden></label>
    </div>
    <p class="fine" id="ds-msg">导出的是${dsFilter === 'all' ? '全部' : '当前筛选的'} ${shown.length} 条。别的电脑导出的 JSON 可以导入合并，重复的不会多出来。</p>`);

  $$('#modal-content [data-filter]').forEach(b => b.onclick = () => { dsFilter = b.dataset.filter; openDataset(); });
  $$('#modal-content .ds-run').forEach(el => {
    const r = shown.find(x => x.id === el.dataset.id);
    requestAnimationFrame(() => drawChart(el.querySelector('svg'), r.samples, { duration: r.duration, target: r.samples.at(-1)?.reference ?? target }));
    bindLabel(el, r.id, () => { el.dataset.label = el.querySelector('[aria-pressed="true"]')?.dataset.label || ''; });
    el.querySelector('.ds-del').onclick = async () => {
      if (!confirmDelete(el)) return;
      await dsDel(r.id); dsRefreshCount(); openDataset();
    };
  });
  $('#ds-json').onclick = async () => dsDownload(dsFileName('json'), JSON.stringify({ format: 'shakecup-dataset-v1', exportedAt: new Date().toISOString(), runs: await dsFresh(shown) }, null, 1), 'application/json');
  $('#ds-csv').onclick = async () => dsDownload(dsFileName('csv'), dsCSV(await dsFresh(shown)), 'text/csv');
  $('#ds-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const runs = Array.isArray(data) ? data : data.runs;
      if (!Array.isArray(runs)) throw new Error('不是测试数据导出的文件');
      const have = new Set(all.map(r => r.id)); let added = 0;
      for (const r of runs) {
        if (!r?.id || !Array.isArray(r.samples) || !Array.isArray(r.packets) || have.has(r.id)) continue;
        await dsPut(r); added++;
      }
      dsRefreshCount(); dsFilter = 'all'; await openDataset();
      $('#ds-msg').textContent = `导入了 ${added} 条${runs.length - added ? `，${runs.length - added} 条已经有了或格式不对，跳过` : ''}。`;
    } catch (err) { $('#ds-msg').textContent = '导入失败：' + err.message; }
  };
}
/* 删除要点两次，免得误删（不用 confirm 弹窗） */
function confirmDelete(el) {
  const b = el.querySelector('.ds-del');
  if (b.dataset.armed) return true;
  b.dataset.armed = '1'; b.textContent = '再点一次删除';
  setTimeout(() => { delete b.dataset.armed; b.textContent = '删除'; }, 3000);
  return false;
}
/* 导出前重新读一遍，拿到弹窗打开后改过的标注 */
async function dsFresh(list) { return (await Promise.all(list.map(r => dsGet(r.id)))).filter(Boolean); }
function dsFileName(ext) { return `shakecup-dataset-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`; }
function dsDownload(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
/* CSV：每个采样点一行，标注和备注重复写在每一行，方便直接筛选 */
function dsCSV(runs) {
  const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = ['记录ID', '标注', '备注', '配方', '设备', '时间', '分数', 't秒', '温度℃', '参考℃', '节奏Hz', '幅度', '有效'];
  const rows = runs.flatMap(r => r.samples.map(s => [r.id, r.label ? DS_LABEL[r.label] : '未标', r.note, r.recipeName, r.device, r.createdAt, r.score,
    s.t, s.temp?.toFixed?.(2), s.reference?.toFixed?.(2), s.hz?.toFixed?.(2), s.amplitude?.toFixed?.(3), s.valid ? 1 : 0]));
  return '﻿' + [head, ...rows].map(r => r.map(q).join(',')).join('\n');   // 带 BOM，Excel 打开中文不乱码
}

$('#open-dataset').onclick = openDataset;
dsRefreshCount();
