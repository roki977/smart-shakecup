/* 调试台：连上杯子，把每一帧原样显示出来，并自动检查数据是否正常。
   温度和动作的解析用 cup-data.js，和练习页完全一样。 */
const $ = s => document.querySelector(s);
const CFG_KEY = 'shakecup-device-v1';                  // 和练习页共用：这里连过，练习页会自动填好
const DEFAULT_URL = 'wss://broker.emqx.io:8084/mqtt';
const KEEP_MS = 60000, ACC_KEEP_MS = 5000;
const PROBE_COLORS = ['var(--p1)', 'var(--p2)', 'var(--p3)'];

const S = {
  client: null, state: 'off', error: '', connectedAt: 0, status: null,
  frames: [],            // 最近 60 秒：{ at, seq, ms, temps, med, hz, amp, gMean, gMax, accN, size }
  acc: [],               // 最近 5 秒原始加速度：{ at, a: [x, y, z] }
  motionBuf: [],         // 练习页同款：最近 2 秒，用来算节奏
  total: 0, lost: 0, reorder: 0, reboots: 0, badJson: 0, lastSeq: null, lastSize: 0, maxSize: 0,
  missing: [], accHz: null, paused: false, log: [],
  rec: null,             // 录制中：[[...], ...]
  t90: null              // 反应速度测试状态
};

/* ---------- 连接 ---------- */
function loadCfg() {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch {}
  const q = new URLSearchParams(location.search);
  if (q.get('cup')) c.device = q.get('cup');
  if (q.get('mqtt')) c.url = q.get('mqtt');
  return { url: c.url || DEFAULT_URL, device: c.device || '', user: c.user || '', pass: c.pass || '' };
}
function fillForm(c) { $('#url').value = c.url; $('#device').value = c.device; $('#user').value = c.user; $('#pass').value = c.pass; }
function setState(state, error = '') {
  S.state = state; S.error = error;
  const pill = $('#pill');
  pill.className = 'pill ' + state;
  pill.textContent = { off: '未连接', connecting: '连接服务器中…', waiting: '已连服务器，等杯子数据', live: '在线', lost: '杯子掉线', error: '出错' }[state];
  $('#connect').textContent = state === 'off' || state === 'error' ? '连接' : '断开';
}
function connect(c) {
  disconnect();
  if (!c.device) { $('#device').focus(); return; }
  try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch {}
  resetStats();
  setState('connecting');
  const opts = { clientId: 'debug-' + Math.random().toString(16).slice(2, 10), reconnectPeriod: 2000, connectTimeout: 8000, clean: true };
  if (c.user) { opts.username = c.user; opts.password = c.pass; }
  try { S.client = mqtt.connect(c.url, opts); } catch (e) { setState('error', String(e.message || e)); return; }
  const base = `shakecup/${c.device}/`;
  S.client.on('connect', () => {
    S.connectedAt = Date.now();
    S.client.subscribe([base + 'data', base + 'status'], { qos: 0 });
    setState(S.frames.length ? 'live' : 'waiting');
  });
  S.client.on('message', (topic, payload) => onMessage(topic, payload));
  S.client.on('error', e => setState('error', String(e.message || e)));
  S.client.on('offline', () => { if (S.state !== 'error') setState('connecting'); });
}
function disconnect() {
  if (S.client) { try { S.client.end(true); } catch {} }
  S.client = null; setState('off');
}
function resetStats() {
  Object.assign(S, { frames: [], acc: [], motionBuf: [], total: 0, lost: 0, reorder: 0, reboots: 0, badJson: 0, lastSeq: null,
    lastSize: 0, maxSize: 0, missing: [], accHz: null, log: [], status: null, connectedAt: 0 });
  $('#devstatus').textContent = '';
}

/* ---------- 收到一帧 ---------- */
function onMessage(topic, payload) {
  const text = payload.toString(), at = Date.now();
  pushLog(at, topic, text);
  let msg;
  try { msg = JSON.parse(text); } catch { S.badJson++; return; }
  if (topic.endsWith('/status')) {
    S.status = msg;
    if (msg.online === false) setState('lost');
    const bits = [msg.online === false ? '杯子报告掉线' : '杯子报告上线'];
    if (msg.fw) bits.push('固件 ' + msg.fw);
    if (typeof msg.bat === 'number' && msg.bat >= 0) bits.push('电量 ' + msg.bat + '%');
    $('#devstatus').textContent = bits.join(' · ');
    return;
  }
  if (S.state !== 'live') setState('live');
  window.Cup3D?.feed(msg);
  S.total++;
  S.lastSize = payload.length; S.maxSize = Math.max(S.maxSize, payload.length);

  // 格式检查
  S.missing = ['v', 'seq', 'ms', 'temp'].filter(k => !(k in msg));
  const hasAcc = Array.isArray(msg.acc) && msg.acc.length, hasHz = typeof msg.hz === 'number';
  if (!hasAcc && !hasHz) S.missing.push('acc 或 hz/amp');

  // 序号：丢帧、乱序、重启
  if (typeof msg.seq === 'number') {
    if (S.lastSeq !== null) {
      const gap = msg.seq - S.lastSeq;
      if (gap > 1) S.lost += gap - 1;
      else if (gap <= 0) { if (msg.seq < S.lastSeq - 50) S.reboots++; else S.reorder++; }
    }
    S.lastSeq = msg.seq;
  }

  // 温度
  const temps = typeof msg.temp === 'number' ? [msg.temp] : Array.isArray(msg.temp) ? msg.temp : [];
  const med = pickTemp(msg.temp);
  if (med !== null) window.Cup3D?.sample({ temp: med, target: -2 });

  // 动作：和练习页一样，用最近 2 秒原始加速度算
  let hz = msg.hz ?? null, amp = msg.amp ?? null, gMean = null, gMax = null, axis = -1;
  if (hasAcc) {
    const fs = msg.acc_hz || 50; S.accHz = fs;
    const step = 1000 / fs, n = msg.acc.length;
    msg.acc.forEach((a, i) => {
      S.acc.push({ at: at - (n - 1 - i) * step, a });
      S.motionBuf.push(a);
    });
    const keep = Math.round(fs * 2);
    if (S.motionBuf.length > keep) S.motionBuf.splice(0, S.motionBuf.length - keep);
    const m = motionFromAcc(S.motionBuf, fs);
    hz = m.hz; amp = m.ampCm; axis = m.axis;
    const mags = msg.acc.map(a => Math.hypot(a[0], a[1], a[2]));
    gMean = mags.reduce((s, x) => s + x, 0) / mags.length; gMax = Math.max(...mags);
  }

  const f = { at, seq: msg.seq, ms: msg.ms, temps, med, hz, amp, gMean, gMax, axis, accN: hasAcc ? msg.acc.length : 0, size: payload.length,
    off: typeof msg.ms === 'number' ? at - msg.ms : null, pub: msg.pub ?? null, rd: msg.rd ?? null };
  S.frames.push(f);
  while (S.frames.length && S.frames[0].at < at - KEEP_MS) S.frames.shift();
  while (S.acc.length && S.acc[0].at < at - ACC_KEEP_MS) S.acc.shift();

  if (S.rec) S.rec.push([new Date(at).toISOString(), msg.seq, msg.ms, temps[0] ?? '', temps[1] ?? '', temps[2] ?? '',
    med ?? '', hz?.toFixed(2) ?? '', amp?.toFixed(1) ?? '', gMean?.toFixed(3) ?? '', gMax?.toFixed(3) ?? '']);
  stepT90(f);
  if (!S.paused) $('#last').textContent = '{\n' + Object.entries(msg).map(([k, v]) => `  "${k}": ${JSON.stringify(v)}`).join(',\n') + '\n}';
}
function pushLog(at, topic, text) {
  S.log.push(`${new Date(at).toLocaleTimeString('zh-CN', { hour12: false })}.${String(at % 1000).padStart(3, '0')}  ${topic.split('/').pop()}  ${text.length > 160 ? text.slice(0, 160) + '…' : text}`);
  if (S.log.length > 40) S.log.shift();
}

/* ---------- 延迟：数据晚到了多少、晚在哪一段 ----------
   浏览器收到时间 at 减去板子时间 ms，差值里有一个固定的时钟差（未知），加上网络延迟。
   最近 60 秒里最小的那个差值，近似“最快一次的传输”；当前差值比它多出来的部分 = 额外延迟（排队）。
   如果它一直往上涨，说明链路一秒钟送不完一秒钟的数据，数据在路上越积越多。
   板子发帧间隔（相邻两帧 ms 之差）大于 100 ms，说明是板子自己的循环慢（多半是读传感器卡住）。 */
function latency() {
  const now = Date.now(), w = S.frames.filter(x => x.at > now - 60000 && x.off !== null);
  if (w.length < 10) return null;
  const base = Math.min(...w.map(x => x.off));
  const cur = w.slice(-5).reduce((t, x) => t + x.off, 0) / Math.min(5, w.length) - base;
  const old10 = w.filter(x => x.at < now - 8000 && x.at > now - 12000);
  const trend = old10.length ? cur - (old10.reduce((t, x) => t + x.off, 0) / old10.length - base) : null;   // 近 10 秒涨了多少
  const r = w.filter(x => x.at > now - 3000), gaps = r.slice(1).map((x, i) => x.ms - r[i].ms).filter(g => g > 0);
  const boardGap = gaps.length ? gaps.reduce((t, x) => t + x, 0) / gaps.length : null;
  const lastF = S.frames.at(-1);
  return { extra: cur, trend, boardGap, pub: lastF.pub, rd: lastF.rd, maxPub: Math.max(...r.map(x => x.pub ?? 0)) };
}

/* ---------- 自动检查 ---------- */
function checks() {
  const now = Date.now(), out = [];
  const add = (level, title, why = '') => out.push({ level, title, why });
  const last = S.frames.at(-1);

  if (S.state === 'off') { add('wait', '连接服务器', '填好设备 ID，点“连接”'); return out; }
  if (S.state === 'error') add('bad', '连接服务器失败', S.error + '。检查服务器地址（网页要用 wss://…:8084/mqtt）');
  else if (S.state === 'connecting') add('wait', '正在连接服务器…', '一直连不上：换个网络，或服务器暂时不可用');
  else add('ok', '已连上服务器');

  if (!S.total) {
    const waited = S.connectedAt ? (now - S.connectedAt) / 1000 : 0;
    if (waited > 8) add('bad', `连上 ${Math.round(waited)} 秒了，还没收到杯子数据`, '两边设备 ID 是否一字不差（区分大小写）；串口里有没有“MQTT 已连上”');
    else if (S.connectedAt) add('wait', '等杯子数据…');
    return out;
  }
  const age = (now - last.at) / 1000;
  if (age > 1.5) add('bad', `${age.toFixed(1)} 秒没收到新数据`, '板子断电、重启，或热点信号差');
  else add('ok', '正在收到杯子数据');

  if (S.missing.length) add('bad', '数据格式缺字段：' + S.missing.join('、'), '对照《接口说明》');
  else add('ok', '数据格式正确');
  if (S.badJson) add('warn', `${S.badJson} 帧不是合法 JSON`, '多半是一帧超过了 MQTT 缓冲，被截断');

  const recent = S.frames.filter(f => f.at > now - 3000);
  const fps = recent.length / 3;
  if (S.total >= 30) {
    if (fps >= 8 && fps <= 12) add('ok', `帧率 ${fps.toFixed(1)} 帧/秒`);
    else add(fps >= 5 ? 'warn' : 'bad', `帧率 ${fps.toFixed(1)} 帧/秒（应约 10）`, '读传感器太慢会拖慢整体；热点信号差也会');
    const lossPct = S.lost / (S.total + S.lost) * 100;
    add(lossPct < 2 ? 'ok' : lossPct < 20 ? 'warn' : 'bad', `丢帧 ${lossPct.toFixed(1)}%（${S.lost} 帧）`, lossPct < 2 ? '' : lossPct < 20 ? '公共测试服务器本身会丢 5%~15%，练习页能承受；正式演示建议换自己的服务器' : '丢得太多：把板子拿近手机热点，或换服务器');
  } else add('wait', '帧率和丢帧：再等几秒');
  if (S.reboots) add('warn', `板子重启过 ${S.reboots} 次`, '供电不稳或程序崩溃，看串口');
  const L = latency();
  if (L) {
    if (L.boardGap !== null && L.boardGap > 150) add('bad', `板子每 ${L.boardGap.toFixed(0)} ms 才发一帧（应 100 ms）`,
      '是板子自己慢：读传感器卡住了循环。' + (L.rd !== null ? `这一帧读温度用了 ${L.rd} ms。` : '') + '见《硬件接入指南》“延迟大”一节');
    if (L.extra > 1500) add('bad', `数据比最快时晚了 ${(L.extra / 1000).toFixed(1)} 秒`,
      (L.trend !== null && L.trend > 300 ? '而且还在越积越多：' : '') + '网络一秒钟送不完一秒钟的数据，在路上排队。' +
      (L.maxPub > 50 ? `板子发一帧要 ${L.maxPub} ms，堵在板子到服务器这一段（热点信号/出国线路）。` : '') + '换国内或本机的服务器最有效');
    else if (L.extra > 500) add('warn', `数据比最快时晚了 ${(L.extra / 1000).toFixed(1)} 秒`, '有排队，网络不太稳');
    else add('ok', `额外延迟 ${Math.round(L.extra)} ms`);
  }

  // 温度
  const valid = last.temps.filter(tempValid);
  if (last.med === null) add('bad', '所有温度探头都读不到', '收到的是 null 或超出 -30~60 ℃，检查接线和 readTemps()');
  else {
    const badN = last.temps.length - valid.length;
    add(badN ? 'warn' : 'ok', badN ? `${badN} 路探头读不到，其余正常` : `温度探头 ${valid.length} 路都有读数`, badN ? '读不到的那路练习页会自动跳过' : '');
  }
  if (valid.length >= 2) {
    const spread = Math.max(...valid) - Math.min(...valid);
    add(spread < 1 ? 'ok' : spread < 3 ? 'warn' : 'bad', `探头之间相差 ${spread.toFixed(2)} ℃`,
      spread < 1 ? '' : '放在同一杯水里应该相差不到 1 ℃；差太多先用冰水（0 ℃）校准');
  }
  const jumps = S.frames.filter(f => f.at > now - 10000).reduce((n, f, i, arr) => n + (i && f.med !== null && arr[i - 1].med !== null && Math.abs(f.med - arr[i - 1].med) > 3 ? 1 : 0), 0);
  if (jumps) add('warn', `最近 10 秒温度跳变 ${jumps} 次`, '一帧变化超过 3 ℃：接触不良，或冰块撞到探头');

  // 加速度
  if (S.acc.length) {
    const lastSec = S.frames.filter(f => f.at > now - 1500 && f.gMean !== null);
    const moving = last.hz > .5 || (last.gMax - last.gMean) > .3;
    const g = lastSec.length ? lastSec.reduce((s, f) => s + f.gMean, 0) / lastSec.length : null;
    if (g === null) add('wait', '加速度：还没数据');
    else if (g < .05) add('bad', '加速度全是 0', '加速度计没读到：检查接线、I²C 地址、readAccel()');
    else if (g > 7 && g < 12) add('bad', `静止合加速度 ${g.toFixed(1)}，像是 m/s²`, '固件里要除以 9.81，换成 g');
    else if (moving) add('wait', '加速度单位：放平静止几秒再检查');
    else add(g > .85 && g < 1.15 ? 'ok' : 'warn', `静止合加速度 ${g.toFixed(2)} g`, g > .85 && g < 1.15 ? '单位正确' : '静止时应约 1 g，检查量程设置');
    const expect = S.accHz ? Math.round(S.accHz / 10) : null;
    if (expect && Math.abs(last.accN - expect) > 1) add('warn', `每帧 ${last.accN} 组加速度，按 ${S.accHz} Hz 应约 ${expect} 组`, '采样定时不准');
  } else if (typeof last.hz === 'number') add('ok', '板子自己算节奏（hz/amp）');

  if (S.maxSize > 1000) add('bad', `一帧最大 ${S.maxSize} 字节`, '超过固件的 1024 字节缓冲会被截断');
  else if (S.maxSize > 800) add('warn', `一帧最大 ${S.maxSize} 字节，接近 1024 上限`);
  return out;
}
function renderChecks() {
  $('#checks').innerHTML = checks().map(c =>
    `<li class="${c.level}"><span class="mark">${{ ok: '✓', warn: '!', bad: '✗', wait: '…' }[c.level]}</span><div><b>${c.title}</b>${c.why ? `<span class="why">${c.why}</span>` : ''}</div></li>`).join('');
}

/* ---------- 数据链路 ---------- */
function renderLink() {
  const now = Date.now(), f = S.frames, last = f.at(-1);
  const recent = f.filter(x => x.at > now - 3000);
  const gaps = recent.slice(1).map((x, i) => x.at - recent[i].at);
  const mean = gaps.length ? gaps.reduce((s, x) => s + x, 0) / gaps.length : 0;
  const jitter = gaps.length ? Math.sqrt(gaps.reduce((s, x) => s + (x - mean) ** 2, 0) / gaps.length) : 0;
  // 板子时钟和浏览器时钟比一比：每帧 ms 的增量应该和实际经过的时间差不多
  let clock = '--';
  const w = f.filter(x => x.at > now - 10000 && typeof x.ms === 'number');
  if (w.length > 10) { const r = (w.at(-1).ms - w[0].ms) / (w.at(-1).at - w[0].at); clock = (r * 100).toFixed(0) + '%'; }
  const rows = [
    ['已收到', S.total + ' 帧'],
    ['帧率（近 3 秒）', (recent.length / 3).toFixed(1) + ' 帧/秒'],
    ['到达间隔抖动', gaps.length ? `±${jitter.toFixed(0)} ms` : '--', jitter > 80 ? 'warn' : ''],
    ['最新一帧距今', last ? ((now - last.at) / 1000).toFixed(1) + ' 秒' : '--', last && now - last.at > 1500 ? 'bad' : ''],
    ...(() => { const L = latency(); return [
      ['额外延迟（排队）', L ? `${Math.round(L.extra)} ms` + (L.trend !== null ? `（10 秒内 ${L.trend >= 0 ? '+' : ''}${Math.round(L.trend)}）` : '') : '--', L && L.extra > 1500 ? 'bad' : L && L.extra > 500 ? 'warn' : ''],
      ['板子发帧间隔', L && L.boardGap !== null ? `${L.boardGap.toFixed(0)} ms` : '--', L && L.boardGap > 150 ? 'bad' : ''],
      ['板子发一帧耗时', L && L.pub !== null ? `${L.pub} ms（3 秒内最大 ${L.maxPub}）` : '--', L && L.maxPub > 50 ? 'warn' : ''],
      ['板子读温度耗时', L && L.rd !== null ? `${L.rd} ms` : '--', L && L.rd > 30 ? 'warn' : '']
    ]; })(),
    ['丢帧 / 乱序', `${S.lost} / ${S.reorder}`, S.lost ? 'warn' : ''],
    ['板子重启', S.reboots + ' 次', S.reboots ? 'warn' : ''],
    ['帧序号 seq', last?.seq ?? '--'],
    ['板子时间 ms', last?.ms ?? '--'],
    ['板子时钟 / 实际', clock],
    ['加速度采样率', S.accHz ? S.accHz + ' Hz' : (last && typeof last.hz === 'number' ? '板子自己算' : '--')],
    ['每帧加速度组数', last ? last.accN : '--'],
    ['一帧大小（最新/最大）', last ? `${S.lastSize} / ${S.maxSize} B` : '--', S.maxSize > 1000 ? 'bad' : S.maxSize > 800 ? 'warn' : ''],
    ['非法 JSON', S.badJson, S.badJson ? 'warn' : '']
  ];
  $('#link').innerHTML = rows.map(([k, v, c]) => `<dt>${k}</dt><dd class="${c || ''}">${v}</dd>`).join('');
}

/* ---------- 温度、动作 ---------- */
const fmt = (v, d = 2) => v === null || v === undefined || !Number.isFinite(v) ? '--' : v.toFixed(d);
function renderTemp() {
  const last = S.frames.at(-1);
  $('#t-med').innerHTML = `${fmt(last?.med)}<small>℃</small>`;
  const w = S.frames.filter(f => f.med !== null && f.at > Date.now() - 2000);
  const rate = w.length > 3 ? (w.at(-1).med - w[0].med) / ((w.at(-1).at - w[0].at) / 1000) : null;
  $('#t-rate').innerHTML = `${rate === null ? '--' : (rate > 0 ? '+' : '') + rate.toFixed(2)}<small>℃/s</small>`;
  const temps = last ? last.temps : [];
  $('#probes').innerHTML = temps.map((t, i) => {
    const ok = tempValid(t);
    return `<span class="probe ${ok ? '' : 'bad'}" style="border-left-color:${PROBE_COLORS[i] || 'var(--dim)'}"><em>探头 ${i + 1}</em>${ok ? t.toFixed(2) + ' ℃' : t === null ? '读不到 (null)' : '超范围 ' + t}</span>`;
  }).join('') || '<span class="probe"><em>还没有数据</em></span>';
  const n = Math.max(1, ...S.frames.map(f => f.temps.length));
  const series = [];
  for (let i = 0; i < n && n > 1; i++) series.push({ color: PROBE_COLORS[i], width: 1.2, data: S.frames.filter(f => tempValid(f.temps[i])).map(f => [f.at, f.temps[i]]) });
  series.push({ color: 'var(--med)', width: 2.2, data: S.frames.filter(f => f.med !== null).map(f => [f.at, f.med]) });
  drawChart($('#c-temp'), series, { span: KEEP_MS, minRange: 2, unit: '℃', digits: 1 });
  $('#temp-legend').innerHTML = (n > 1 ? Array.from({ length: n }, (_, i) => `<span><i style="background:${PROBE_COLORS[i]}"></i>探头 ${i + 1}</span>`).join('') : '') +
    '<span><i style="background:var(--med)"></i>中位数（练习页用这个）</span>';
}
function renderMotion() {
  const last = S.frames.at(-1);
  $('#m-hz').innerHTML = `${fmt(last?.hz, 1)}<small>次/秒</small>`;
  $('#m-amp').innerHTML = `${fmt(last?.amp, 1)}<small>cm</small>`;
  $('#m-g').innerHTML = `${fmt(last?.gMean)}<small>g</small>`;
  $('#m-axis').textContent = last && last.axis >= 0 ? 'xyz'[last.axis] : '--';
  const ser = [0, 1, 2].map(k => ({ color: PROBE_COLORS[k], width: 1.2, data: S.acc.map(p => [p.at, p.a[k]]) }));
  ser.push({ color: 'var(--med)', width: 1.6, data: S.acc.map(p => [p.at, Math.hypot(...p.a)]) });
  drawChart($('#c-acc'), ser, { span: ACC_KEEP_MS, minRange: 2.5, unit: 'g', digits: 1 });
}

/* ---------- 画图：canvas 折线，时间轴从右往左 ---------- */
const cssVar = v => v.startsWith('var(') ? getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim() : v;
function drawChart(cv, series, { span, minRange, unit, digits }) {
  const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const L = 46, R = 8, T = 20, B = 20, now = Date.now();
  const vals = series.flatMap(s => s.data.map(p => p[1]));
  let lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1;
  if (hi - lo < minRange) { const c = (hi + lo) / 2; lo = c - minRange / 2; hi = c + minRange / 2; }
  const pad = (hi - lo) * .08; lo -= pad; hi += pad;
  const x = t => L + (1 - (now - t) / span) * (W - L - R), y = v => T + (hi - v) / (hi - lo) * (H - T - B);
  g.font = '11px ui-monospace, Menlo, monospace'; g.fillStyle = cssVar('var(--dim)'); g.strokeStyle = cssVar('var(--rule)'); g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const v = lo + (hi - lo) * i / 4, yy = Math.round(y(v)) + .5;
    g.beginPath(); g.moveTo(L, yy); g.lineTo(W - R, yy); g.stroke();
    g.textAlign = 'right'; g.fillText(v.toFixed(digits), L - 6, yy + 4);
  }
  g.textAlign = 'center';
  const stepS = span > 20000 ? 10 : 1;
  for (let s = 0; s <= span / 1000; s += stepS) g.fillText(s ? `-${s}s` : '现在', x(now - s * 1000), H - 5);
  g.textAlign = 'left'; g.fillText(unit, 4, 12);
  series.forEach(s => {
    if (s.data.length < 2) return;
    g.strokeStyle = cssVar(s.color); g.lineWidth = s.width; g.beginPath();
    s.data.forEach(([t, v], i) => { const px = x(t), py = y(v); i ? g.lineTo(px, py) : g.moveTo(px, py); });
    g.stroke();
  });
}

/* ---------- 录制 CSV ---------- */
const REC_HEAD = ['浏览器时间', 'seq', '板子ms', '探头1', '探头2', '探头3', '温度中位数', '节奏Hz', '幅度cm', '合加速度均值g', '合加速度最大g'];
$('#rec').onclick = () => {
  if (!S.rec) { S.rec = []; $('#rec').textContent = '停止并下载'; $('#rec').classList.add('on'); return; }
  const rows = S.rec; S.rec = null;
  $('#rec').textContent = '开始录制'; $('#rec').classList.remove('on');
  if (!rows.length) { $('#rec-out').textContent = '没录到数据'; return; }
  const csv = '﻿' + [REC_HEAD, ...rows].map(r => r.join(',')).join('\n');   // 带 BOM，Excel 打开中文不乱码
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `shakecup-${$('#device').value || 'cup'}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  a.click();
  $('#rec-out').textContent = `已下载 ${rows.length} 帧，约 ${(rows.length / 10).toFixed(0)} 秒`;
};
setInterval(() => { if (S.rec) $('#rec-out').textContent = `录制中：${S.rec.length} 帧`; }, 500);

/* ---------- 探头反应速度 t90 ----------
   1. 记下基线（点开始前 1 秒的平均）；2. 读数偏离基线超过 0.3 ℃，记为起点；
   3. 连续 2 秒波动小于 0.1 ℃，记为稳定值；4. t90 = 读数第一次走完 90% 变化的时刻 − 起点。
   一阶响应 t90 ≈ 2.3τ，τ 就是滞后补偿 T真 ≈ T读 + τ·dT/dt 里的那个时间常数。 */
const pickSeries = f => { const p = $('#t90-probe').value; return p === 'med' ? f.med : (tempValid(f.temps[+p]) ? f.temps[+p] : null); };
const tOf = f => typeof f.ms === 'number' ? f.ms : f.at;   // 优先用板子时间，不受网络抖动影响
$('#t90').onclick = () => {
  if (S.t90) { S.t90 = null; $('#t90').textContent = '开始'; $('#t90-out').textContent = '已取消'; return; }
  const base = S.frames.filter(f => f.at > Date.now() - 1000).map(pickSeries).filter(v => v !== null);
  if (!base.length) { $('#t90-out').textContent = '先连上杯子、有温度读数再测'; return; }
  S.t90 = { base: base.reduce((s, v) => s + v, 0) / base.length, pts: [], start: null };
  $('#t90').textContent = '取消';
  $('#t90-out').textContent = `基线 ${S.t90.base.toFixed(2)} ℃。现在把探头插进另一杯水…`;
};
function stepT90(f) {
  const st = S.t90; if (!st) return;
  const v = pickSeries(f); if (v === null) return;
  const t = tOf(f);
  if (st.start === null) { if (Math.abs(v - st.base) > .3) { st.start = t; st.pts.push([t, v]); $('#t90-out').textContent = '检测到变化，等读数稳定…'; } return; }
  st.pts.push([t, v]);
  const tail = st.pts.filter(p => p[0] > t - 2000);
  if (t - st.start > 2500 && tail.length > 8 && Math.max(...tail.map(p => p[1])) - Math.min(...tail.map(p => p[1])) < .1) {
    const fin = tail.reduce((s, p) => s + p[1], 0) / tail.length, goal = st.base + .9 * (fin - st.base);
    const hit = st.pts.find(p => (fin > st.base ? p[1] >= goal : p[1] <= goal));
    const t90 = (hit[0] - st.start) / 1000, tau = t90 / Math.LN10;
    $('#t90-out').innerHTML = `${st.base.toFixed(2)} → ${fin.toFixed(2)} ℃：<b>t90 = ${t90.toFixed(2)} 秒</b>，τ ≈ ${tau.toFixed(2)} 秒。` +
      (t90 <= 2 ? ' 够快。' : t90 <= 4 ? ' 偏慢，网页可以用 τ 做滞后补偿。' : ' 太慢，摇酒十几秒里跟不上，建议换更细的探头。');
    S.t90 = null; $('#t90').textContent = '开始';
  } else if (t - st.start > 30000) { $('#t90-out').textContent = '30 秒还没稳定，已停止'; S.t90 = null; $('#t90').textContent = '开始'; }
}

/* ---------- 原始数据 ---------- */
$('#pause').onclick = () => { S.paused = !S.paused; $('#pause').textContent = S.paused ? '继续' : '暂停'; };
function renderLog() { if (!S.paused) $('#log').textContent = S.log.slice().reverse().join('\n'); }

/* ---------- 启动 ---------- */
$('#conn').onsubmit = e => {
  e.preventDefault();
  if (S.state !== 'off' && S.state !== 'error') { disconnect(); return; }
  connect({ url: $('#url').value.trim() || DEFAULT_URL, device: $('#device').value.trim(), user: $('#user').value.trim(), pass: $('#pass').value });
};
const cfg = loadCfg(); fillForm(cfg);
if (new URLSearchParams(location.search).get('cup')) { history.replaceState(null, '', location.pathname); connect(cfg); }
setState(S.client ? S.state : 'off');
// 用定时器刷新而不是 requestAnimationFrame：调试台常放在副屏或嵌入面板里，那种情况下动画帧可能不触发
setInterval(() => { renderTemp(); renderMotion(); }, 100);
setInterval(() => { renderChecks(); renderLink(); renderLog(); }, 500);

/* 3D 杯子 */
if (window.Cup3D && Cup3D.mount($('#cup3d'))) $('#c3-cal').onclick = () => Cup3D.recalibrate();
else { $('#cup3d').innerHTML = '<p class="tip">这个浏览器不支持 WebGL，3D 画不出来。</p>'; $('#c3-cal').remove(); }
