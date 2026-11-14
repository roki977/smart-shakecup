/* 实时 3D 摇酒壶：把杯子上 IMU 的数据画成一只跟着手动的摇酒壶。
   源码在这里，网页用的是打包后的 ../cup3d.js（运行 src/build.sh 重新生成）。

   对外接口（挂在 window.Cup3D 上）：
     Cup3D.mount(el)        在 el 里放一只 3D 杯子，返回 view（可以挂多只，比如练习页和调试台）
     Cup3D.feed(msg)        收到杯子的一帧 MQTT 数据（接口说明.md 的格式）就调用
     Cup3D.sample(s)        练习页每一帧（模拟或真实）调用：用来画霜，以及没有原始加速度时按节奏/幅度合成动作
     Cup3D.recalibrate()    把杯子现在的姿势当作“竖直”
     Cup3D.reset()          新一轮练习开始时清掉轨迹和粒子

   姿态怎么来：
     - 只有加速度：低通滤波得到重力方向 → 杯子的倾斜。绕竖直轴的转动测不出来。
     - 带陀螺仪（gyro，°/s）：互补滤波（Mahony），转得快的时候也跟得上。
   位移怎么来：去掉重力后的加速度 a，按简谐运动 x = −a / (2πf)² 换成位置，不做二重积分，所以不会漂。 */

import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, LatheGeometry, TorusGeometry, Vector2, Vector3, Quaternion,
  MeshStandardMaterial, MeshBasicMaterial, PMREMGenerator, Color, CanvasTexture, Points, BufferGeometry,
  BufferAttribute, PointsMaterial, PlaneGeometry, SRGBColorSpace, RepeatWrapping, AdditiveBlending, DoubleSide, MathUtils
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const UP = new Vector3(0, 1, 0);
const UNITS_PER_M = 8;          // 模型里杯子长约 2 个单位，真杯子约 25 cm
const MAX_OFFSET = 1.25;        // 画面里位移的上限（单位）
const PLAY_DELAY = 150;         // 数据一帧 100 ms 才到，延后 150 ms 播放，动作才连贯
const G = 9.81;

/* ---------------- 共享的动作状态（所有 view 看同一只杯子） ---------------- */
const M = {
  hist: [],                     // 最近 2 秒加速度（估重力用）
  queue: [],                    // 待播放的样本 { ms, a:[x,y,z], w:[x,y,z]|null }
  offset: null,                 // performance.now() 与设备 ms 的差
  lastMs: null, lastFeedAt: 0,
  hz: 0, ampCm: 0,              // 设备或网页算出来的节奏、幅度（用来把加速度换成位移）
  gLP: null,                    // 低通后的重力（传感器坐标，g）
  q: new Quaternion(),          // 传感器 → 世界（有陀螺仪时用）
  hasGyro: false, gyroBias: [0, 0, 0],
  axis: null,                   // 杯子长轴在传感器坐标里的方向（校准得到）
  calibrated: false, still: [],
  yaw: null,                    // 显示用的绕竖直轴转角，让杯子的倾斜总是朝左右，看得清
  dir: new Vector3(0, 1, 0),    // 当前杯子长轴（世界坐标，显示前）
  pos: new Vector3(),           // 当前位移（显示单位）
  dyn: 0,                       // 当前去重力加速度大小（g）
  axial: 0,                     // 沿杯子长轴的加速度（g）
  peak: [],                     // 最近 0.6 秒的 |a|，算力度
  hits: [],                     // 待发射的“冰块撞壁”事件 { end: ±1, power }
  prevAxial: 0, armed: 0,
  // 没有原始加速度时的合成动作
  syn: { hz: 0, amp: 0, phase: 0, on: false },
  temp: null, chill: 0,
  source: 'idle'                // idle | sensor | synth
};

function median3(a, b, c) { return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c)); }

/* 收到杯子的一帧数据 */
function feed(msg) {
  if (!msg) return;
  const now = performance.now();
  if (typeof msg.hz === 'number') M.hz = msg.hz;
  if (typeof msg.amp === 'number') M.ampCm = msg.amp;
  if (!Array.isArray(msg.acc) || !msg.acc.length) { M.devHzOnly = now; return; }
  const fs = msg.acc_hz || 50, step = 1000 / fs, n = msg.acc.length;
  const end = typeof msg.ms === 'number' ? msg.ms : now;
  const gyro = Array.isArray(msg.gyro) && msg.gyro.length === n ? msg.gyro : null;
  // 设备重启（ms 变小）或者断了很久：重新对时
  if (M.lastMs != null && (end < M.lastMs - 50 || end - M.lastMs > 3000)) { M.offset = null; M.queue.length = 0; }
  M.lastMs = end; M.lastFeedAt = now;
  for (let i = 0; i < n; i++) {
    const a = msg.acc[i]; if (!Array.isArray(a) || a.length < 3 || !a.every(Number.isFinite)) continue;
    const w = gyro && Array.isArray(gyro[i]) && gyro[i].every(Number.isFinite) ? gyro[i] : null;
    M.queue.push({ ms: end - (n - 1 - i) * step, a, w, dt: step / 1000 });
  }
  const want = now - end - PLAY_DELAY;
  if (M.offset == null || Math.abs(M.offset - want) > 400) M.offset = want;
  else M.offset += (want - M.offset) * .02;               // 网络抖动时慢慢跟
  if (M.queue.length > 200) M.queue.splice(0, M.queue.length - 200);
  // 网页侧再估一次节奏（设备发原始加速度时）
  if (window.motionFromAcc) {
    M.accWin = (M.accWin || []).concat(msg.acc).slice(-Math.round(fs * 2));
    const r = window.motionFromAcc(M.accWin, fs); M.hz = r.hz; M.ampCm = r.ampCm;
  }
}

/* 处理一个 IMU 样本：更新姿态、位移、撞壁事件 */
const _v = new Vector3(), _w = new Vector3(), _q = new Quaternion(), _q2 = new Quaternion();
function processSample(s) {
  const [ax, ay, az] = s.a, dt = s.dt;
  // 重力估计：摇的时候按整数个周期取平均，往复的加速度正好抵消；不摇时普通低通
  M.hist.push(s.a); if (M.hist.length > 100) M.hist.shift();
  const fsr = 1 / dt, per = M.hz > 1 ? Math.round(fsr / M.hz) : 0;
  const n = per ? Math.min(M.hist.length, per * Math.max(1, Math.floor(60 / per))) : 0;
  const gRaw = n >= per && per ? [0, 1, 2].map(i => { let t = 0; for (let j = M.hist.length - n; j < M.hist.length; j++) t += M.hist[j][i]; return t / n; }) : s.a;
  const k = 1 - Math.exp(-dt / (per ? .12 : .3));
  if (!M.gLP) M.gLP = [ax, ay, az];
  else for (let i = 0; i < 3; i++) M.gLP[i] += (gRaw[i] - M.gLP[i]) * k;

  // 静止检测：0.5 秒内 |a|≈1g 且几乎不动 → 可以校准“竖直”，也顺便估陀螺零偏
  M.still.push(s); if (M.still.length > 25) M.still.shift();
  const isStill = M.still.length === 25 && M.still.every(x => Math.abs(Math.hypot(...x.a) - 1) < .08) &&
    [0, 1, 2].every(i => { const xs = M.still.map(x => x.a[i]); return Math.max(...xs) - Math.min(...xs) < .08; });
  if (isStill) {
    const mean = [0, 1, 2].map(i => M.still.reduce((t, x) => t + x.a[i], 0) / 25);
    if (s.w) M.gyroBias = [0, 1, 2].map(i => M.still.reduce((t, x) => t + (x.w ? x.w[i] : 0), 0) / 25);
    if (!M.calibrated) { M.axis = new Vector3(...mean).normalize(); M.calibrated = true; M.yaw = null; }
  }
  if (!M.axis) M.axis = new Vector3(ax, ay, az).normalize();   // 还没校准：先把第一帧当竖直

  // 姿态：传感器 → 世界
  const gN = _v.set(...M.gLP).normalize();
  if (s.w) {
    if (!M.hasGyro) { M.q.setFromUnitVectors(gN, UP); M.hasGyro = true; }
    const d2r = Math.PI / 180;
    _w.set((s.w[0] - M.gyroBias[0]) * d2r, (s.w[1] - M.gyroBias[1]) * d2r, (s.w[2] - M.gyroBias[2]) * d2r);
    // Mahony：用（按周期平均后的）重力方向把倾斜慢慢拉回来，陀螺仪负责快速转动
    const pred = UP.clone().applyQuaternion(_q.copy(M.q).invert());
    _w.add(gN.clone().cross(pred).multiplyScalar(1.5));
    const ang = _w.length() * dt;
    if (ang > 1e-9) { _q2.setFromAxisAngle(_w.normalize(), ang); M.q.multiply(_q2).normalize(); }
  } else {
    M.q.setFromUnitVectors(gN, UP);
  }

  // 杯子长轴在世界里的方向
  const dir = M.axis.clone().applyQuaternion(M.q);
  // 去重力加速度（世界坐标，g）
  const dyn = new Vector3(ax, ay, az).applyQuaternion(M.q).sub(UP);
  // 显示用的转角：第一次明显倾斜时定下来，让倾斜方向朝画面左右
  const horiz = Math.hypot(dir.x, dir.z);
  if (M.yaw == null && horiz > .45) M.yaw = Math.atan2(dir.z, dir.x) - (dir.x >= 0 ? 0 : Math.PI);
  const yawQ = _q.setFromAxisAngle(UP, M.yaw || 0);
  dir.applyQuaternion(yawQ); dyn.applyQuaternion(yawQ);
  M.dir.lerp(dir, .5).normalize();

  // 位移：简谐运动 x = −a/ω²。节奏太低（没在摇）时 ω 取 1.5 Hz，避免放大噪声
  const f = Math.max(1.5, M.hz || 0), w2 = Math.pow(2 * Math.PI * f, 2);
  const p = dyn.clone().multiplyScalar(-G / w2 * UNITS_PER_M);
  if (p.length() > MAX_OFFSET) p.setLength(MAX_OFFSET);
  M.pos.lerp(p, .6);

  M.dyn = dyn.length();
  M.axial = dyn.dot(dir);
  pushPeak(M.dyn);
  detectHit(M.axial);
}

function pushPeak(v) {
  const now = performance.now();
  M.peak.push([now, v]);
  while (M.peak.length && M.peak[0][0] < now - 600) M.peak.shift();
}
/* 沿长轴的加速度到峰值（超过 1.2 g）的那一刻，杯子正停在一头折返，冰块撞到这一头 */
function detectHit(axial) {
  const mag = Math.abs(axial);
  if (mag > 1.2 && mag > M.armed) M.armed = mag;
  else if (M.armed && mag < M.armed * .8) {
    M.hits.push({ end: -Math.sign(M.prevAxial || axial), power: Math.min(1, (M.armed - 1) / 3) });
    M.armed = 0;
  }
  M.prevAxial = axial;
}
/* 力度分档（g）。参考动作 3 Hz、单程 14 cm 大约 5 g，落在“到位”中间。演示值，等实测后调 */
const FORCE_STEPS = [.3, 2.5, 7];
function forceLevel(f) { return f < FORCE_STEPS[0] ? 0 : f < FORCE_STEPS[1] ? 1 : f < FORCE_STEPS[2] ? 2 : 3; }
function force() { return M.peak.reduce((m, x) => Math.max(m, x[1]), 0); }

/* 练习页每一帧（模拟或真实）都会调用 */
function sample(s) {
  if (!s) return;
  if (Number.isFinite(s.temp)) M.temp = s.temp;
  if (Number.isFinite(s.target) && Number.isFinite(s.temp)) M.chill = MathUtils.clamp((22 - s.temp) / (22 - s.target), 0, 1);
  M.syn.hz = s.valid === false ? 0 : (s.hz > .2 ? s.hz : 0);
  M.syn.amp = Number.isFinite(s.amplitude) ? s.amplitude * 20 : 14;    // 网页内部幅度值 × 20 ≈ cm
  M.syn.at = performance.now();
}

/* 没有原始加速度时，按节奏和幅度合成动作：杯子斜举过肩，沿长轴推拉 */
const SYN_DIR = new Vector3(-.82, .57, 0).normalize();
let synAmpNow = 0, synHzNow = 0;
function synthStep(dt) {
  const fresh = performance.now() - (M.syn.at || 0) < 1500;
  const devHz = performance.now() - (M.devHzOnly || 0) < 1500;
  const hz = devHz ? M.hz : fresh ? M.syn.hz : 0;
  const amp = devHz ? M.ampCm : M.syn.amp;
  synHzNow += (hz - synHzNow) * Math.min(1, dt * 4);
  synAmpNow += ((hz > .2 ? amp : 0) - synAmpNow) * Math.min(1, dt * 3);
  M.syn.phase += 2 * Math.PI * synHzNow * dt;
  const A = synAmpNow / 100 * UNITS_PER_M * .55;              // 合成时画小一点，看着不晕
  const x = A * Math.sin(M.syn.phase);
  M.dir.lerp(SYN_DIR, Math.min(1, dt * 3)).normalize();
  M.pos.copy(M.dir).multiplyScalar(MathUtils.clamp(x, -MAX_OFFSET, MAX_OFFSET));
  const accG = -(synAmpNow / 100) * Math.pow(2 * Math.PI * synHzNow, 2) * Math.sin(M.syn.phase) / G;
  M.dyn = Math.abs(accG); M.axial = accG;
  pushPeak(M.dyn); detectHit(accG);
}

/* 每一帧动画推进一次（多个 view 共用，只推进一次） */
let lastStep = 0;
function step(now) {
  if (now === lastStep) return;
  const dt = lastStep ? Math.min(.1, (now - lastStep) / 1000) : 1 / 60;
  lastStep = now;
  const sensorLive = M.offset != null && now - M.lastFeedAt < 1000;
  if (sensorLive) {
    M.source = 'sensor';
    const play = now - M.offset;
    while (M.queue.length && M.queue[0].ms <= play) processSample(M.queue.shift());
  } else {
    M.source = (now - (M.syn.at || 0) < 1500 || now - (M.devHzOnly || 0) < 1500) ? 'synth' : 'idle';
    synthStep(dt);
  }
}

/* ---------------- 画面 ---------------- */
function noiseTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d'); x.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const r = Math.random() * 1.6 + .3, a = Math.random() * .7 + .15;
    x.fillStyle = `rgba(255,255,255,${a})`; x.beginPath();
    x.arc(Math.random() * 256, Math.random() * 256, r, 0, Math.PI * 2); x.fill();
  }
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.wrapS = t.wrapT = RepeatWrapping; t.repeat.set(3, 2);
  return t;
}
function blobTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}
function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const x = c.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 15);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.5, 'rgba(220,240,255,.7)'); g.addColorStop(1, 'rgba(220,240,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 32, 32);
  return new CanvasTexture(c);
}

/* 三段式（cobbler）摇酒壶的轮廓，(半径, 高度)，从下往上 */
function shakerParts() {
  const P = pts => pts.map(([r, y]) => new Vector2(r, y));
  const tin = P([[0, 0], [.33, 0], [.36, .03], [.37, .08], [.43, 1.12], [.445, 1.16], [.445, 1.19]]);
  const top = P([[.455, 1.1], [.46, 1.15], [.46, 1.33], [.44, 1.4], [.36, 1.5], [.24, 1.58], [.19, 1.63], [.19, 1.7]]);
  const cap = P([[.205, 1.66], [.21, 1.69], [.21, 1.9], [.2, 1.95], [.16, 1.99], [.08, 2.0], [0, 2.0]]);
  return { tin, top, cap };
}

class View {
  constructor(el) {
    this.el = el;
    this.canvas = document.createElement('canvas'); this.canvas.className = 'c3-canvas';
    this.stage = el.querySelector('.c3-stage') || el;
    this.stage.prepend(this.canvas);
    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.scene = new Scene();
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
    this.scene.environmentIntensity = .75;
    this.camera = new PerspectiveCamera(26, 4 / 3, .1, 50);
    this.camera.position.set(0, .35, 7.8); this.camera.lookAt(0, 0, 0);

    const { tin, top, cap } = shakerParts();
    this.steel = new MeshStandardMaterial({ color: 0xc9cfd6, metalness: 1, roughness: .24 });
    this.steelDark = new MeshStandardMaterial({ color: 0x9aa1aa, metalness: 1, roughness: .35 });
    this.frostMat = new MeshStandardMaterial({ color: 0xf4f9ff, map: noiseTexture(), transparent: true, opacity: 0, roughness: .9, metalness: 0, depthWrite: false });
    this.cup = new Group();
    const body = new Group(); body.position.y = -1;           // 让杯子中心在原点
    const seg = 48;
    const geos = [new LatheGeometry(tin, seg), new LatheGeometry(top, seg), new LatheGeometry(cap, seg)];
    geos.forEach(g => { body.add(new Mesh(g, this.steel)); const f = new Mesh(g, this.frostMat); f.scale.set(1.012, 1, 1.012); body.add(f); });
    [[.448, 1.17, .012], [.465, 1.33, .01], [.212, 1.67, .01]].forEach(([r, y, t]) => {
      const ring = new Mesh(new TorusGeometry(r, t, 8, seg), this.steelDark); ring.rotation.x = Math.PI / 2; ring.position.y = y; body.add(ring);
    });
    this.cup.add(body);
    this.scene.add(this.cup);
    this.geos = geos; this.body = body;

    // 拖影：最近几帧的位置，用半透明的同形状画出来
    this.ghosts = [1, 2, 3].map(i => {
      const g = new Group(), m = new MeshBasicMaterial({ color: 0x9fb6cc, transparent: true, opacity: 0, depthWrite: false });
      const b = new Group(); b.position.y = -1; geos.forEach(geo => b.add(new Mesh(geo, m))); g.add(b);
      g.userData = { mat: m, lag: i * 2 }; this.scene.add(g); return g;
    });
    this.hist = [];

    // 地面阴影
    this.shadow = new Mesh(new PlaneGeometry(2.4, .7), new MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, side: DoubleSide }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.position.y = -1.75; this.scene.add(this.shadow);

    // 冰屑粒子
    const N = 240; this.N = N;
    this.pPos = new Float32Array(N * 3); this.pVel = new Float32Array(N * 3); this.pLife = new Float32Array(N);
    const pg = new BufferGeometry(); pg.setAttribute('position', new BufferAttribute(this.pPos, 3));
    this.pMat = new PointsMaterial({ size: .09, map: dotTexture(), transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xdff2ff });
    this.points = new Points(pg, this.pMat); this.points.frustumCulled = false; this.scene.add(this.points);
    this.pNext = 0;
    for (let i = 0; i < N; i++) this.pPos[i * 3 + 1] = -99;

    this.hud = {
      src: el.querySelector('.c3-src'), temp: el.querySelector('.c3-temp'),
      bar: el.querySelector('.c3-force i'), ft: el.querySelector('.c3-force-t')
    };
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.stage);
    this.io = new IntersectionObserver(es => { this.visible = es[0].isIntersecting; }, { threshold: 0 }); this.io.observe(el);
    this.visible = true;
    this.themeObs = new MutationObserver(() => this.applyTheme()); this.themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.applyTheme(); this.resize();
  }
  applyTheme() {
    this.pixel = document.documentElement.dataset.theme === 'pixel';
    this.el.classList.toggle('c3-pixel', this.pixel);
    this.shadow.material.opacity = document.documentElement.dataset.theme === 'real' ? .0 : 1;
    this.resize();
  }
  resize() {
    const r = this.stage.getBoundingClientRect(), w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    // 像素风：用很低的分辨率渲染，再由 CSS 放大成方块
    this.renderer.setPixelRatio(this.pixel ? Math.max(.18, 110 / Math.max(w, 1)) : Math.min(2, devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 窄的时候拉远一点，保证摇到两头也在画面里
    this.camera.position.z = w / h < 1.25 ? 7.8 * 1.25 / (w / h) : 7.8;
    this.camera.updateProjectionMatrix();
  }
  emit(end, power) {
    const local = new Vector3(0, end * (end > 0 ? 1.0 : .95), 0);
    const world = local.clone().applyQuaternion(this.cup.quaternion).add(this.cup.position);
    const along = new Vector3(0, end, 0).applyQuaternion(this.cup.quaternion);
    const n = Math.round(6 + power * 16);
    for (let k = 0; k < n; k++) {
      const i = this.pNext; this.pNext = (this.pNext + 1) % this.N;
      this.pPos[i * 3] = world.x; this.pPos[i * 3 + 1] = world.y; this.pPos[i * 3 + 2] = world.z;
      const sp = 1.2 + power * 2.4;
      const v = new Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize().multiplyScalar(sp * .6).addScaledVector(along, sp * .7);
      this.pVel[i * 3] = v.x; this.pVel[i * 3 + 1] = v.y; this.pVel[i * 3 + 2] = v.z; this.pLife[i] = .35 + Math.random() * .25;
    }
  }
  frame(dt) {
    // 姿态和位置
    this.cup.quaternion.setFromUnitVectors(UP, M.dir);
    this.cup.position.copy(M.pos);
    this.hist.unshift({ p: M.pos.clone(), q: this.cup.quaternion.clone() }); if (this.hist.length > 8) this.hist.pop();
    const f = force(), fN = MathUtils.clamp(f / 8, 0, 1);
    this.ghosts.forEach((g, i) => {
      const h = this.hist[g.userData.lag]; if (!h) return;
      g.position.copy(h.p); g.quaternion.copy(h.q);
      g.userData.mat.opacity = this.pixel ? 0 : fN * (.11 - i * .035);
    });
    // 霜
    this.frostMat.opacity = Math.pow(M.chill, 1.8) * .42;     // 霜只盖一层，底下的不锈钢反光还看得见
    this.steel.roughness = .24 + M.chill * .18;
    // 阴影跟着走
    this.shadow.position.x = this.cup.position.x;
    this.shadow.scale.set(.6 + Math.abs(M.dir.x) * .7, 1, 1);
    // 冰块撞壁 → 冰屑
    for (const h of this._hits || []) this.emit(h.end, h.power);
    for (let i = 0; i < this.N; i++) {
      if (this.pLife[i] <= 0) { this.pPos[i * 3 + 1] = -99; continue; }
      this.pLife[i] -= dt;
      this.pVel[i * 3 + 1] -= 6 * dt;
      for (let k = 0; k < 3; k++) this.pPos[i * 3 + k] += this.pVel[i * 3 + k] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.pMat.size = this.pixel ? .16 : .09;

    // 文字
    const h = this.hud;
    if (h.bar) { h.bar.style.width = (fN * 100).toFixed(1) + '%'; h.bar.dataset.level = forceLevel(f); }
    if (h.ft) h.ft.textContent = M.source === 'idle' ? '力度 —' : `力度 ${['没动', '偏轻', '到位', '很用力'][forceLevel(f)]} ${f.toFixed(1)} g`;
    if (h.src) h.src.textContent = M.source === 'sensor' ? (M.calibrated ? '实时 · 杯子' : '实时 · 杯子（还没摆正）') : M.source === 'synth' ? '模拟动作' : '等数据';
    if (h.temp) h.temp.textContent = M.temp == null ? '' : (M.temp < 0 ? '−' : '') + Math.abs(M.temp).toFixed(1) + ' ℃';
    this.renderer.render(this.scene, this.camera);
  }
}

const views = [];
let raf = 0;
let lastTick = 0;
function loop(now) {
  raf = requestAnimationFrame(loop);
  tick(now);
}
/* 页面放在副屏或嵌入面板里时 requestAnimationFrame 可能不触发，用定时器兜底 */
setInterval(() => { const now = performance.now(); if (raf && now - lastTick > 200) tick(now); }, 50);
function tick(now) {
  lastTick = now;
  const prev = lastStep;
  step(now);
  const dt = prev ? Math.min(.1, (now - prev) / 1000) : 1 / 60;
  const hits = M.hits.splice(0);
  for (const v of views) {
    if (!v.visible || !v.el.offsetParent && document.fullscreenElement !== v.el) continue;
    v._hits = hits; v.frame(dt); v._hits = null;
  }
}

function supported() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}
function mount(el) {
  if (!supported()) return null;
  const v = new View(el); views.push(v);
  if (!raf) raf = requestAnimationFrame(loop);
  return v;
}
function recalibrate() {
  if (M.gLP) { M.axis = new Vector3(...M.gLP).normalize(); M.calibrated = true; M.yaw = null; }
}
function reset() {
  M.hits.length = 0; M.peak.length = 0; views.forEach(v => { v.hist.length = 0; v.pLife.fill(0); });
}

window.Cup3D = { mount, feed, sample, recalibrate, reset, supported, state: M };
