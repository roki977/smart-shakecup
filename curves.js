'use strict';
/* 标准曲线：每款酒“标准做法下，温度 T、节奏 f、动作幅度 A 随时间怎么走”。

   两种来源，界面上分得很清楚：
   - 实测：调酒师用杯子摇的记录，存在 调酒知识库/标准曲线记录.json（评分服务的 /api/references 读写）。
     刚录的是“待审核”，审核通过才算标准。练习时可以选任意一条跟着练。
   - 演示：还没有实测时，按做法合成一条（摇和、搅拌、直调各一套参数），只用来演示，不冒充调酒师数据。

   录入：接真杯子并且开了评分服务，摇完在结果页点“存为标准曲线”。 */

const DEMO_CURVE = {
  摇和: { dur: 12, T0: 22, end: -2, f: 3, A: 7 },
  搅拌: { dur: 30, T0: 22, end: 0, f: 1.5, A: 1.5 },
  搅棒调和: { dur: 20, T0: 22, end: 1, f: 2, A: 2 },
  搅拌机: { dur: 20, T0: 22, end: 2, f: null, A: null },
  杯中直调: { dur: 20, T0: 22, end: 4, f: null, A: null },
  直接倒入: { dur: 20, T0: 22, end: 6, f: null, A: null }
};
function demoCurve(r) {
  const p = DEMO_CURVE[r.method] || DEMO_CURVE['直接倒入'];
  // 加蛋清、奶油的摇得更久
  const dur = r.shake && r.parts.some(x => /蛋|奶油/.test(x[0])) ? 15 : p.dur;
  const T = Array.from({ length: 41 }, (_, i) => {
    const t = dur * i / 40, q = Math.min(1, t / dur);
    return { t: +t.toFixed(2), value: +(p.T0 - (p.T0 - p.end) * (1 - Math.pow(1 - q, 2.2))).toFixed(2), valid: true };
  });
  return { kind: 'demo', dur, T, f: p.f, A: p.A, end: p.end };
}

/* 读这款酒的实测记录。没开评分服务返回 null */
async function loadStandardCurves(r) {
  if (!algo.available || !r.kb) return null;
  try {
    const out = await (await fetch('api/references?recipe_id=' + encodeURIComponent(r.kb), { cache: 'no-store' })).json();
    return (out.records || []).filter(x => x.status !== 'rejected');
  } catch { return null; }
}

const validPts = c => (c?.points || []).filter(p => p.valid && Number.isFinite(p.value));
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : null; };

/* 小图：只画温度，节奏和幅度写成数字 */
function curveSVG(T) {
  if (!T.length) return '';
  const W = 260, H = 70, t1 = T.at(-1).t || 1, vs = T.map(p => p.value), lo = Math.min(...vs) - 1, hi = Math.max(...vs) + 1;
  const pts = T.map(p => `${(p.t / t1 * W).toFixed(1)},${((hi - p.value) / (hi - lo) * H).toFixed(1)}`).join(' ');
  return `<svg class="curve-mini" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}
function curveFacts(T, f, A, dur) {
  const out = [];
  if (T.length) out.push(`${deg(T[0].value)} → ${deg(T.at(-1).value)} ℃`);
  out.push(`${dur.toFixed(0)} 秒`);
  if (f != null) out.push(`节奏 ${f.toFixed(1)} 次/秒`);
  if (A != null) out.push(`动作幅度 ${A.toFixed(1)} m/s²`);
  return out.map(x => `<span>${x}</span>`).join('');
}

function curveCardHTML(r, list) {
  const sameVersion = (list || []).filter(x => x.recipe_version === r.recipeVersion);
  const rows = sameVersion.map((x, i) => {
    const T = validPts(x.curves.T), f = median(validPts(x.curves.f).map(p => p.value)), A = median(validPts(x.curves.A).map(p => p.value));
    return `<li class="curve-row">${curveSVG(T)}<div><b>${x.status === 'approved' ? '实测标准曲线' : '实测记录（待审核）'}</b>
      <span class="curve-by">${escapeHTML(x.bartender_id)}，${(x.captured_at || '').slice(0, 10)}</span>
      <span class="curve-facts">${curveFacts(T, f, A, T.at(-1)?.t || 0)}</span>
      ${!r.shake ? '' : x.curves.f && x.curves.A ? `<button class="link" data-use-curve="${i}">跟这条练</button>` : '<span class="curve-by">只有温度记录，摇和起点还没确认，暂时不能跟着练。</span>'}</div></li>`;
  }).join('');
  const d = demoCurve(r);
  const demo = `<li class="curve-row demo">${curveSVG(d.T)}<div><b>演示曲线</b>
      <span class="curve-by">按“${r.method}”的做法合成，不是调酒师实测。</span>
      <span class="curve-facts">${curveFacts(d.T, d.f, d.A, d.dur)}</span></div></li>`;
  const note = list === null
    ? '<p class="fine">开评分服务（见 README）后，这里能看到调酒师录的实测曲线，也能用杯子录新的。</p>'
    : !sameVersion.length ? `<p class="fine">这款还没有实测曲线。${r.shake ? '接上杯子、开着评分服务摇一杯，结果页可以存为标准曲线。' : ''}</p>`
    : '';
  return `<ul class="curves">${rows}${sameVersion.some(x => x.status === 'approved') ? '' : demo}</ul>${note}`;
}
function bindCurveCard(r, list) {
  const same = (list || []).filter(x => x.recipe_version === r.recipeVersion);
  $$('#rc-curve [data-use-curve]').forEach(b => b.onclick = () => {
    recipe = r; practiceRef = recordToRef(same[Number(b.dataset.useCurve)]);
    $('#modal').close(); showSetup(); renderRefChip();
  });
}

/* 实测记录 → 练习用的参考（和社区曲线同一个格式），另外带上 f / A 原始点给评分服务 */
function recordToRef(x) {
  // 记录开头约 2 秒是特征预热（没有值），从第一个有效点算起当作第 0 秒
  const t0 = Math.min(...['T', 'f', 'A'].map(j => validPts(x.curves[j])[0]?.t ?? Infinity));
  const shift = c => validPts(c).map(p => ({ ...p, t: +(p.t - t0).toFixed(3) }));
  const T = shift(x.curves.T), f = shift(x.curves.f), A = shift(x.curves.A);
  const at = (pts, t) => { let v = null; for (const p of pts) { if (p.t > t) break; v = p.value; } return v; };
  const rhythm = median(f.map(p => p.value)) ?? 3;
  return {
    id: x.id, postId: null, author: x.bartender_id, title: x.status === 'approved' ? '实测标准曲线' : '实测记录（待审核）',
    target: T.at(-1).value, rhythm,
    curve: T.map(p => ({ t: p.t, temp: p.value, reference: p.value, hz: at(f, p.t) ?? 0, amplitude: (at(A, p.t) ?? 0) / SIM_A_REF * .7 })),
    fA: { f, A }
  };
}

/* 结果页：真杯子 + 评分服务的一轮，可以存成标准曲线（待审核） */
function offerSaveCurve(r) {
  const a = algo.last;
  if (!a?.measured || !recipe.kb || recipe.custom) return '';
  return `<button class="secondary save-curve" id="save-curve">存为标准曲线</button>`;
}
function bindSaveCurve() {
  const b = $('#save-curve'); if (!b) return;
  b.onclick = () => {
    showModal(`<h2>存为${escapeHTML(recipe.name)}的标准曲线</h2>
      <p>把刚才这一杯的温度、节奏、动作幅度存进知识库，状态是“待审核”。审核通过前，练习时可以选它，但不会当成正式标准。</p>
      <form class="composer" id="curve-form">
        <label>调酒师（名字或编号）<input name="who" required maxlength="40"></label>
        <div class="two"><label>冰<input name="ice" placeholder="例如 方冰 6 块" maxlength="60"></label>
        <label>杯子<input name="glass" placeholder="例如 不锈钢摇壶 700 ml" maxlength="60"></label></div>
        <label>备注<textarea name="note" rows="2" maxlength="300" placeholder="原料品牌、室温、哪里和配方不一样"></textarea></label>
        <p class="form-error" id="curve-error"></p>
        <button class="primary" type="submit">保存</button>
      </form>`);
    $('#curve-form').onsubmit = async e => {
      e.preventDefault();
      const f = new FormData(e.target), res = a => a?.result;
      const r = res(algo.last); if (!r) return;
      const pts = j => {
        let last = -1;
        return r.frames.filter(x => x.t > last && (last = x.t, true)).map(x => {
          const v = x.features[j]?.value; return { t: +x.t.toFixed(3), value: v == null ? null : +v.toFixed(4), valid: v != null };
        });
      };
      const record = {
        id: 'ref-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), session_id: algo.last.id,
        recipe_id: recipe.kb, recipe_version: recipe.recipeVersion,
        bartender_id: String(f.get('who')).trim(), captured_at: new Date().toISOString(),
        origin: 'measured', status: 'pending_review', feature_version: algo.last.payload.algorithm.feature_version,
        conditions: { ingredients: recipe.parts, ice: f.get('ice') || null, glass: f.get('glass') || null, note: f.get('note') || null,
          liquid_probe: LIQUID_PROBE, rule_version: algo.last.payload.algorithm.version },
        curves: { T: { unit: 'degC', time_unit: 's', points: pts('T') }, f: { unit: 'Hz', time_unit: 's', points: pts('f') }, A: { unit: 'm/s2', time_unit: 's', points: pts('A') } }
      };
      try { await algoCall('references', record); }
      catch (err) { $('#curve-error').textContent = '没存上：' + err.message; return; }
      $('#modal').close();
      $('#save-curve').disabled = true; $('#save-curve').textContent = '已存为标准曲线（待审核）';
    };
  };
}
