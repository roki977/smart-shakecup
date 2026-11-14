'use strict';
/* 接评分服务（调酒算法/server.py）。

   评分只在一个地方算：评分服务。网页只负责把数据送过去、把它算出的结果显示出来，不在网页里另抄一份公式。
   - 用 `python3 调酒算法/server.py` 打开网站时，同一个地址下有 /api，这里会自动用上。
   - 从 GitHub Pages 或普通静态服务器打开时没有 /api，练习页退回网页自带的演示估算，并在页面上写明。

   送什么数据：
   - 接了杯子：把杯子发来的原始包（加速度 + 温度）原样转给评分服务，由它算温度 T、节奏 f、动作幅度 A。
   - 没接杯子：演示数据本来就是按 T / 节奏 / 幅度生成的，换算成特征帧直接送，来源标“模拟”。

   规则和参考都是演示用的合成值（parameter_status: synthetic_not_calibrated），不是调酒师实测标定。
   评分策略和分数映射按算法交接文档显式写死，不能省略。 */

const ALGO_POLICY = 'tolerance-excess-v2';
const ALGO_MAPPING = 'reciprocal-v2';
const ALGO_STAGE_END = 12;        // 摇和阶段参与评价到第 12 秒（从开摇算）；摇不满就只出“部分记录”
const ALGO_REF_LENGTH = 40;       // 参考曲线给到 40 秒，摇得再久也有参考可比
const LIQUID_PROBE = 0;           // 杯子 temp 数组里哪一路是液温探头。硬件定下来后改这里
const SIM_STEP = 0.25;            // 演示数据每 0.25 秒一帧

const algo = { available: false, kb: null, s: null };

/* 打开页面时探一下有没有评分服务，顺便读知识库索引 */
(async () => {
  try {
    const r = await fetch('api/health', { cache: 'no-store', signal: AbortSignal.timeout(1500) });
    algo.available = r.ok && (await r.json()).status === 'ok';
  } catch { algo.available = false; }
  try { algo.kb = (await (await fetch('data/kb-index.json')).json()).recipes; } catch { algo.kb = null; }
  updateScoreSource();
})();

function updateScoreSource(text) {
  const el = $('#score-source'); if (!el) return;
  el.textContent = text || (algo.available ? '由评分服务计算' : '网页演示估算，未连评分服务');
}

/* 模拟数据的幅度值 → 加速度有效幅度 A（m/s²），只用于演示数据。
   简谐运动里加速度和 频率² × 位移 成正比；按队友合成参考的量级，标准动作（3 次/秒、幅度 0.7）取 7 m/s²。 */
const SIM_A_REF = 7;
function simAcc(hz, amplitude) {
  if (!(hz > .2)) return 0;
  return SIM_A_REF * (amplitude / .7) * Math.pow(hz / 3, 2);
}

function kbEntry(r) { return algo.kb?.['iba-' + r.id] || null; }

/* 这一轮的规则。演示和真杯子只在“允许多少丢帧”上不同：公共服务器会丢 5–15% 的包 */
function algoRules(measured, featureVersion, recipeVersion) {
  return {
    version: 'shakecup-site-v1', parameter_status: 'synthetic_not_calibrated',
    recipe_version: recipeVersion, feature_version: featureVersion,
    scoring_policy: ALGO_POLICY, score_mapping: ALGO_MAPPING,
    r1: 2, r2: 1, anchor_loss: 1, anchor_score: 80,
    error_window_s: 1, max_frame_gap_s: measured ? .35 : SIM_STEP + .05, reference_max_gap_s: .3,
    window_min_coverage: measured ? .9 : .98, final_min_coverage: measured ? .9 : .98,
    on_s: .6, off_s: .4, recovery_ratio: .8, merge_gap_s: .3, feedback_limit: 5,
    stages: [{ id: 'shake', evaluate_from_s: 2, end_s: ALGO_STAGE_END, beta: 1, channels: ['T', 'f', 'A'],
      tolerance: { T: .45, f: .2, A: .75 }, scale: { T: 1.5, f: .5, A: 1.5 } }]
  };
}
/* 杯子原始数据的特征提取配置（50 Hz 加速度、10 Hz 温度） */
const DEVICE_FEATURES = {
  version: 'hp-rms-acf-site-v1', window_s: 2, hop_s: .1, resample_hz: 100, recovery_window_s: 1,
  max_imu_gap_s: .15, max_temperature_age_s: .35, highpass_hz: .1,
  frequency_min_hz: 1, frequency_max_hz: 8, rest_rms: .12,
  min_autocorrelation: .65, min_spectral_concentration: .3, harmonic_tolerance: .15
};

/* 参考：温度按当前参考曲线（默认公式或社区里选的那条），节奏和幅度按这次的目标 */
function algoReference(id, featureVersion, recipeVersion, T0) {
  const pts = fn => Array.from({ length: ALGO_REF_LENGTH * 10 + 1 }, (_, i) => ({ t: i / 10, value: +fn(i / 10).toFixed(4), valid: true }));
  const aRef = simAcc(desiredRhythm, .7);           // 目标节奏、标准幅度时的 A
  return { id, recipe_version: recipeVersion, feature_version: featureVersion,
    stages: { shake: { T: pts(t => referenceAt(t, T0, activeScenario.kind === 'device' ? REF_SECONDS : activeScenario.duration)), f: pts(() => desiredRhythm), A: pts(() => aRef) } } };
}

async function algoCall(path, body) {
  const r = await fetch('api/' + path, body === undefined ? { cache: 'no-store' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(out.error || `评分服务返回 ${r.status}`), { status: r.status });
  return out;
}

/* 开始一轮。measured：真杯子；T0：开摇时的温度。
   真杯子要在第一包到时才建会话：时间原点要取在这包第一个加速度样本之前（firstMsg），t0ms 是网页这边的计时起点 */
function algoBegin(measured, T0, firstMsg, t0ms) {
  algo.s = null;
  if (!algo.available) { updateScoreSource(); return; }
  const kb = recipe.custom ? null : kbEntry(recipe);
  const recipeVersion = kb?.recipe_version || 'site-' + recipe.id;
  const featureVersion = measured ? DEVICE_FEATURES.version : 'site-sim-v1';
  const refId = practiceRef ? 'community-' + practiceRef.id : 'site-default-curve-v1';
  const payload = {
    algorithm: algoRules(measured, featureVersion, recipeVersion),
    reference: algoReference(refId, featureVersion, recipeVersion, T0),
    source: measured ? 'measured' : 'simulated', start_t: 0,
    recipe_id: kb ? 'iba-' + recipe.id : null,
    stage_steps: kb?.shake_step ? { shake: kb.shake_step } : {}
  };
  const s = algo.s = { id: null, measured, queue: [], busy: false, frame: null, closed: false, error: null, payload, tOffset: 0 };
  if (measured) {
    const n = Array.isArray(firstMsg.acc) ? firstMsg.acc.length : 1, hz = firstMsg.acc_hz || 50;
    const epoch = firstMsg.ms - Math.ceil(n * 1000 / hz) - 1;
    payload.feature_config = DEVICE_FEATURES;
    // 固件：加速度单位 g；包里的 ms 是打包发出的时刻，对应这包最后一个样本
    payload.device = { epoch_ms: epoch, acc_unit: 'g', packet_time: 'last', probe: LIQUID_PROBE };
    s.tOffset = (t0ms - epoch) / 1000;       // 评分服务的时间 − 网页曲线的时间
  }
  s.ready = algoCall('sessions', payload).then(r => { s.id = r.id; algoPump(); })
    .catch(e => { s.error = e.message; updateScoreSource('评分服务出错，改用网页估算'); });
  updateScoreSource(measured ? '由评分服务计算（杯子实测数据）' : '由评分服务计算（演示数据）');
}

/* 演示数据：一帧 = 一组 T / f / A */
function algoSample(s) {
  const a = algo.s; if (!a || a.measured || a.closed || !(s.t > 0)) return;
  a.queue.push({ frames: [{ t: +s.t.toFixed(3), T: s.valid === false ? null : s.temp, f: s.hz > .2 ? s.hz : 0,
    A: simAcc(s.hz, s.amplitude), feature_version: 'site-sim-v1', quality: {} }] });
  algoPump();
}
/* 真杯子：原始包原样转发（只转带原始加速度的包；旧固件只发 hz/amp 的包评分服务不收）。
   没在摇的包先扣着：接着摇就一起补发（中途停顿照常算）；直接结束就丢掉，
   这样“放下杯子等 3 秒自动结算”那几秒不会被当成停摇扣分。 */
function algoPacket(msg, shaking) {
  const a = algo.s; if (!a || !a.measured || a.closed || typeof msg.ms !== 'number' || !Array.isArray(msg.acc)) return;
  a.hold ||= [];
  if (!shaking) { a.hold.push(msg); return; }
  for (const m of a.hold.splice(0)) a.queue.push({ packet: m });
  a.queue.push({ packet: msg });
  algoPump();
}

/* 一次只发一个请求，按顺序送 */
async function algoPump() {
  const a = algo.s; if (!a || !a.id || a.busy || !a.queue.length) return;
  a.busy = true;
  try {
    while (a.queue.length && algo.s === a) {
      // 演示帧可以攒在一起发
      let body = a.queue.shift();
      if (body.frames) while (a.queue[0]?.frames) body = { frames: body.frames.concat(a.queue.shift().frames) };
      const f = await algoCall(`sessions/${a.id}/data`, body);
      if (algo.s !== a) break;
      a.frame = f; showAlgoFrame(f);
    }
  } catch (e) { a.error = e.message; updateScoreSource('评分服务出错：' + e.message); }
  a.busy = false;
}

/* 练习中：美味值一格显示评分服务给的“当前符合度”。没有可靠值时显示 —，不填 0 */
function showAlgoFrame(f) {
  if (!running) return;
  const v = f.current?.value;
  $('#score').textContent = v == null ? '—' : Math.round(v);
  $('#progress-fill').style.width = (v ?? 0) + '%';
  $('.meter').setAttribute('aria-valuenow', v == null ? 0 : Math.round(v));
  if (v == null) updateScoreSource(f.connection === 'lost' ? '数据断了，暂不评分' : '数据还不够，暂无法可靠估计');
  else updateScoreSource(algo.s?.measured ? '当前符合度，评分服务（杯子实测）' : '当前符合度，评分服务（演示数据）');
}

/* 结束：先把排队的数据送完，再请求完整结果；条件不够就要“部分记录” */
async function algoFinish() {
  const a = algo.s; if (!a) return null;
  a.closed = true;
  try {
    await a.ready;
    if (!a.id) return null;
    while (a.queue.length || a.busy) { await new Promise(r => setTimeout(r, 50)); if (!a.busy) algoPump(); }
    let r;
    try { r = await algoCall(`sessions/${a.id}/finish`, { intent: 'complete' }); }
    catch (e) { if (e.status !== 400) throw e; r = await algoCall(`sessions/${a.id}/finish`, { intent: 'partial' }); }
    a.result = r; algo.last = a; return r;
  } catch (e) { a.error = e.message; return null; }
}
function algoStop() { if (algo.s) algo.s.closed = true; algo.s = null; }

/* 复盘：评分服务给出的问题（最多 3 条），每条能在曲线上标出对应时段 */
const ALGO_CHANNEL = { T: '温度', f: '节奏', A: '动作幅度' };
function renderAlgoResult(r) {
  const final = r.final?.value;
  const issues = r.guidance?.issues || [];
  const box = $('#parts');
  box.innerHTML = issues.length
    ? `<p class="issues-title">和参考差在哪</p><ol class="issues">${issues.map((x, i) => `<li><button data-issue="${i}" aria-pressed="false">
        <span class="issue-when">${x.start.toFixed(1)}–${x.end.toFixed(1)} 秒</span><b>${escapeHTML(x.observation)}</b><span class="issue-do">${escapeHTML(x.action)}</span></button></li>`).join('')}</ol>`
    : `<p class="issues-title">${final == null ? '' : '全程都在参考容差内。'}</p>`;
  const limits = [];
  if (final == null) limits.push(r.final?.reason || '这次没有出完整分数。');
  if (r.recordQuality?.length || r.guidance?.record_quality?.length) limits.push('有几段数据不太可靠（预热、断档或节奏不清），这几段不算作操作问题。');
  limits.push('参考和规则是演示用的合成值，还没有调酒师实测标定。');
  $('#part-detail').textContent = limits.join(' ');
  box.querySelectorAll('[data-issue]').forEach(b => b.onclick = () => {
    const x = issues[Number(b.dataset.issue)];
    box.querySelectorAll('[data-issue]').forEach(y => y.setAttribute('aria-pressed', y === b));
    const last = samples.at(-1);
    const off = algo.last?.tOffset || 0;
    drawChart($('#chart'), samples, { duration: last.t, events, bands: x.intervals.map(v => [v.start - off, v.end - off]) });
  });
}
