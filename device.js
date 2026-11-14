'use strict';
/* 杯子数据接口：ESP32 → MQTT 服务器（公网）→ 网页。
   消息格式见《接口说明.md》。没连杯子时，网页照常用模拟数据。

   数据流：
     MQTT 消息 → parseMessage() → 统一成一帧 { t, temp, hz, amplitude, ... }
               → 正在练习时交给 app.js 的 consumeSample()，界面和评分不用改。 */

const DEVICE_CFG_KEY = 'shakecup-device-v1';
const DEFAULT_CFG = { url: DEFAULT_BROKER, device: '', user: '', pass: '' };   // DEFAULT_BROKER 在 cup-data.js
const STALE_MS = 1500;          // 超过这么久没收到数据，判为信号中断
const AMP_CM_FOR_DEMO = 20;     // 设备上报的单程幅度（cm）÷ 20 ≈ 演示里的幅度值（0.7 ≈ 14 cm）
const REF_SECONDS = 14;         // 参考曲线：从开摇时的温度降到目标所用时间（演示值，待实测）

const dev = {
  client: null, cfg: null, state: 'off',   // off | connecting | waiting | live | lost | error
  lastAt: 0, lastMsg: null, rate: 0, rateCount: 0, rateFrom: 0,
  t0ms: null, temp0: null, lastSample: null, battery: null, error: '',
  acc: []                                    // 原始加速度缓冲（如果设备发的是原始数据）
};

function loadDeviceCfg() {
  try { const c = { ...DEFAULT_CFG, ...JSON.parse(localStorage.getItem(DEVICE_CFG_KEY) || '{}') }; c.url = brokerFor(c.url); return c; } catch { return { ...DEFAULT_CFG }; }
}
function saveDeviceCfg(c) { try { localStorage.setItem(DEVICE_CFG_KEY, JSON.stringify(c)); } catch {} }
const topicOf = (c, kind) => `shakecup/${c.device}/${kind}`;

/* 网页上能不能用真实数据开始练习 */
function deviceLive() { return dev.state === 'live' && Date.now() - dev.lastAt < STALE_MS; }

function setDeviceState(state, error = '') {
  dev.state = state; dev.error = error;
  const pill = $('#device-pill');
  const text = {
    off: '杯子：未连接', connecting: '杯子：连接中…', waiting: '杯子：等数据',
    live: `杯子：在线${dev.rate ? ' ' + dev.rate + ' 帧/秒' : ''}`, lost: '杯子：信号断了', error: '杯子：连不上'
  }[state];
  pill.textContent = text;
  const flag = document.querySelector('.demo-flag'); if (flag) flag.hidden = state === 'live';
  pill.dataset.state = state;
  document.body.classList.toggle('device-live', state === 'live');   // 3D 杯子的“校准”按钮只在接了杯子时出现
  // 准备页的提示跟着变
  const goHint = $('#go-hint');
  if (goHint) goHint.innerHTML = deviceLive()
    ? '杯子已连上，开始后就按真实数据走。<br>摇完点“这杯完成了”。'
    : '杯子还在做，这一版先放模拟的摇杯过程，你看着就行。<br>觉得够了，随时点“这杯完成了”。';
}

function connectDevice(cfg) {
  disconnectDevice();
  if (!window.mqtt) { setDeviceState('error', 'MQTT 库没加载上'); return; }
  dev.cfg = cfg; dev.t0ms = null; dev.acc = [];
  setDeviceState('connecting');
  const opts = { clientId: 'web-' + Math.random().toString(16).slice(2, 10), reconnectPeriod: 2000, connectTimeout: 8000, clean: true };
  if (cfg.user) { opts.username = cfg.user; opts.password = cfg.pass; }
  let client;
  try { client = mqtt.connect(cfg.url, opts); } catch (e) { setDeviceState('error', String(e.message || e)); return; }
  dev.client = client;
  client.on('connect', () => {
    client.subscribe([topicOf(cfg, 'data'), topicOf(cfg, 'status')], { qos: 0 });
    setDeviceState('waiting');
  });
  client.on('message', (topic, payload) => {
    let msg; try { msg = JSON.parse(payload.toString()); } catch { return; }
    if (topic.endsWith('/status')) {
      if (msg.online === false) setDeviceState('lost');
      if (typeof msg.bat === 'number') dev.battery = msg.bat;
      return;
    }
    onDeviceData(msg);
  });
  client.on('error', e => setDeviceState('error', String(e.message || e)));
  client.on('offline', () => { if (dev.state !== 'error') setDeviceState('connecting'); });
  client.on('close', () => { if (dev.state === 'live' || dev.state === 'waiting') setDeviceState('connecting'); });
}
function disconnectDevice() {
  if (dev.client) { try { dev.client.end(true); } catch {} }
  dev.client = null; setDeviceState('off');
}

/* pickTemp、motionFromAcc 在 cup-data.js 里，和调试台共用 */
function estimateMotion(msg) {
  const fs = msg.acc_hz || 50;
  msg.acc.forEach(a => dev.acc.push(a));
  const keep = Math.round(fs * 2);
  if (dev.acc.length > keep) dev.acc.splice(0, dev.acc.length - keep);
  const { hz, ampCm } = motionFromAcc(dev.acc, fs);
  return { hz, ampCm };
}

function onDeviceData(msg) {
  window.Cup3D?.feed(msg);                              // 3D 杯子：不管在不在练习都跟着动
  const now = Date.now();
  dev.lastAt = now; dev.lastMsg = msg;
  if (typeof msg.bat === 'number') dev.battery = msg.bat;
  // 统计到达频率，显示在顶栏
  if (!dev.rateFrom) dev.rateFrom = now;
  dev.rateCount++;
  if (now - dev.rateFrom >= 2000) { dev.rate = Math.round(dev.rateCount / ((now - dev.rateFrom) / 1000)); dev.rateCount = 0; dev.rateFrom = now; }
  if (dev.state !== 'live') setDeviceState('live'); else if (dev.rateCount === 0) setDeviceState('live');

  const temp = pickTemp(msg.temp);
  let hz = msg.hz, ampCm = msg.amp;
  if (Array.isArray(msg.acc) && msg.acc.length) ({ hz, ampCm } = estimateMotion(msg));
  if (!running || dev.t0ms === null) return;
  if (temp === null) return;                            // 这一帧温度无效就跳过

  const ms = typeof msg.ms === 'number' ? msg.ms : now;
  if (dev.t0ms === undefined) {
    // 还没开始摇：只显示温度，不计时，免得拿起杯子犹豫的时候参考曲线已经跑了
    if (!(hz > .5)) { $('#temp').textContent = deg(temp); $('#temp-note').textContent = '摇起来就开始计时'; return; }
    dev.t0ms = ms; dev.temp0 = temp;
    algoBegin(true, temp, msg, ms);                     // algorithm.js：评分服务从开摇这一包开始收数据
  }
  algoPacket(msg, hz > .5);
  const t = Math.max(0, (ms - dev.t0ms) / 1000);
  const reference = referenceAt(t, dev.temp0, REF_SECONDS);   // community.js：默认公式，或社区里选的参考曲线
  const s = {
    t, temp, reference,
    hz: Number.isFinite(hz) ? hz : 0,
    amplitude: Number.isFinite(ampCm) ? ampCm / AMP_CM_FOR_DEMO : 0,
    target, valid: msg.ok !== false, sourceEnded: false
  };
  dev.lastSample = s;
  consumeSample(s);
}

/* 练习时的看门狗：数据断了就补一帧“无效”，界面会提示信号中断 */
setInterval(() => {
  if (dev.state === 'live' && Date.now() - dev.lastAt > STALE_MS) setDeviceState('lost');
  if (running && usingDevice && dev.lastSample && Date.now() - dev.lastAt > STALE_MS) {
    const s = { ...dev.lastSample, t: dev.lastSample.t + (Date.now() - dev.lastAt) / 1000, valid: false };
    consumeSample(s);
  }
}, 500);

/* 开始练习时由 app.js 调用：返回 true 表示这次用真实数据 */
let usingDevice = false;
function startWithDevice() {
  usingDevice = deviceLive();
  if (usingDevice) { dev.t0ms = undefined; dev.temp0 = null; dev.lastSample = null; }
  else dev.t0ms = null;
  return usingDevice;
}
function stopDevice() { usingDevice = false; dev.t0ms = null; }

/* 分享连接：生成带服务器和设备 ID 的链接，别的设备扫码就能连上同一只杯子 */
function shareLink(c, withLogin) {
  const q = new URLSearchParams({ cup: c.device });
  if (c.url !== DEFAULT_CFG.url) q.set('mqtt', c.url);
  if (withLogin && c.user) { q.set('u', c.user); q.set('p', c.pass); }
  return location.origin + location.pathname + '?' + q.toString();
}
function qrSVG(text) {
  if (!window.qrcode) return '';
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
function renderShare(c) {
  const box = $('#dev-share'); if (!box) return;
  const withLogin = $('#share-login')?.checked;
  const link = shareLink(c, withLogin);
  $('#share-qr').innerHTML = qrSVG(link);
  $('#share-url').value = link;
}
/* 打开的是分享链接：读出参数，存好，再把参数从地址栏去掉 */
function readSharedLink() {
  const q = new URLSearchParams(location.search);
  if (!q.get('cup')) return null;
  const c = { ...loadDeviceCfg(), device: q.get('cup'), url: q.get('mqtt') || DEFAULT_CFG.url };
  if (q.get('u')) { c.user = q.get('u'); c.pass = q.get('p') || ''; }
  saveDeviceCfg(c);
  try { history.replaceState(null, '', location.pathname + location.hash); } catch {}
  return c;
}

/* 连接设置弹窗 */
function openDeviceDialog() {
  const c = loadDeviceCfg();
  const status = {
    off: '还没连接。', connecting: '正在连接服务器…', waiting: '已连上服务器，还没收到这只杯子的数据。检查杯子是否开机、设备 ID 是否一致。',
    live: `正在收数据，大约每秒 ${dev.rate || '…'} 帧${dev.battery != null ? `，电量 ${dev.battery}%` : ''}。`,
    lost: '杯子超过 1.5 秒没发数据了。', error: `连不上：${escapeHTML(dev.error)}`
  }[dev.state];
  const last = dev.lastMsg ? `<pre class="dev-last">${escapeHTML(JSON.stringify(dev.lastMsg))}</pre>` : '';
  showModal(`<h2>连接杯子</h2>
    <p class="fine">杯子把数据发到 MQTT 服务器，网页从同一个服务器收。两边填一样的设备 ID 就能对上。</p>
    <form id="dev-form" class="dev-form">
      <label>服务器地址（WebSocket）<input name="url" value="${escapeHTML(c.url)}" placeholder="wss://…/mqtt" required></label>
      <label>设备 ID<input name="device" value="${escapeHTML(c.device)}" placeholder="比如 cup-01" required pattern="[A-Za-z0-9_-]+"></label>
      <div class="dev-row">
        <label>用户名（可空）<input name="user" value="${escapeHTML(c.user)}" autocomplete="off"></label>
        <label>密码（可空）<input name="pass" type="password" value="${escapeHTML(c.pass)}" autocomplete="off"></label>
      </div>
      <p class="dev-status" data-state="${dev.state}">${status}</p>
      ${last}
      ${c.device ? `<div class="dev-share" id="dev-share">
        <div class="share-qr" id="share-qr"></div>
        <div class="share-side">
          <b>让别的设备也连上这只杯子</b>
          <p class="fine">手机扫码，或者把链接发过去，打开就自动连上 ${escapeHTML(c.device)}。</p>
          <input id="share-url" readonly>
          <button class="secondary" type="button" id="share-copy">复制链接</button>
          ${c.user ? '<label class="share-login"><input type="checkbox" id="share-login"> 链接里带上用户名和密码</label>' : ''}
        </div>
      </div>` : ''}
      <div class="result-actions">
        <button class="primary" type="submit">${dev.client ? '重新连接' : '连接'}</button>
        ${dev.client ? '<button class="secondary" type="button" id="dev-off">断开</button>' : ''}
      </div>
      <p class="fine">要看传感器原始数据、检查硬件，打开 <a href="debug.html${c.device ? '?cup=' + encodeURIComponent(c.device) : ''}" target="_blank" rel="noopener">调试台</a>。</p>
    </form>`);
  $('#dev-form').onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const cfg = { url: f.get('url').trim(), device: f.get('device').trim(), user: f.get('user').trim(), pass: f.get('pass') };
    saveDeviceCfg(cfg); connectDevice(cfg); $('#modal').close();
  };
  const off = $('#dev-off'); if (off) off.onclick = () => { disconnectDevice(); $('#modal').close(); };
  if (c.device) {
    renderShare(c);
    const login = $('#share-login'); if (login) login.onchange = () => renderShare(c);
    $('#share-copy').onclick = async () => {
      const b = $('#share-copy');
      try { await navigator.clipboard.writeText($('#share-url').value); b.textContent = '已复制'; }
      catch { $('#share-url').select(); b.textContent = '请手动复制'; }
    };
  }
}

$('#device-pill').onclick = openDeviceDialog;
setDeviceState('off');
// 打开的是分享链接就用链接里的设置；否则上次连过就自动重连
(() => { const c = readSharedLink() || loadDeviceCfg(); if (c.device) connectDevice(c); })();
