/* 杯子数据的解析：练习页（device.js）和调试台（debug.html）共用同一份，
   保证调试台上看到的数，就是练习页实际会用的数。 */

/* 温度：可以是一个数，也可以是多路探头的数组；取有效值（-30 ~ 60 ℃）的中位数 */
const TEMP_MIN = -30, TEMP_MAX = 60;
function tempValid(x) { return typeof x === 'number' && Number.isFinite(x) && x > TEMP_MIN && x < TEMP_MAX; }
function pickTemp(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (!Array.isArray(v)) return null;
  const ok = v.filter(tempValid).sort((a, b) => a - b);
  if (!ok.length) return null;
  const m = ok.length >> 1;
  return ok.length % 2 ? ok[m] : (ok[m - 1] + ok[m]) / 2;
}

/* 由最近一段原始加速度估算节奏和幅度。
   buf: [[ax, ay, az], ...]，单位 g，采样率 fs。取起伏最大的那个轴（基本就是摇壶的长轴），
   数过零次数得到节奏，再按简谐运动 A = a峰 / (2πf)² 估单程幅度。 */
const MOTION_MIN_RMS = 0.15;   // 起伏小于这个（g）当作没在摇
function motionFromAcc(buf, fs) {
  if (buf.length < fs) return { hz: 0, ampCm: 0, axis: -1, rms: 0 };
  let best = null;
  for (let k = 0; k < 3; k++) {
    const xs = buf.map(a => a[k]), mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const d = xs.map(x => x - mean), rms = Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
    if (!best || rms > best.rms) best = { d, rms, k };
  }
  if (best.rms < MOTION_MIN_RMS) return { hz: 0, ampCm: 0, axis: best.k, rms: best.rms };
  let crossings = 0;
  for (let i = 1; i < best.d.length; i++) if ((best.d[i - 1] < 0) !== (best.d[i] < 0)) crossings++;
  const hz = crossings / 2 / (best.d.length / fs);
  const peak = best.rms * Math.SQRT2 * 9.81;              // m/s²
  const ampCm = hz > 0.3 ? peak / Math.pow(2 * Math.PI * hz, 2) * 100 : 0;
  return { hz, ampCm, axis: best.k, rms: best.rms };
}

/* 用哪台 MQTT 服务器。
   网页从 https 打开（GitHub Pages）：默认公共测试服务器。
   网页从 http 打开（本机服务器方案，start-mac.command / start-windows.bat 起的）：
   默认连同一台电脑上的 Mosquitto，ws://<网页的主机名>:9001，不用手动填。 */
const PUBLIC_BROKER = 'wss://broker.emqx.io:8084/mqtt';
const LOCAL_MODE = location.protocol === 'http:';
const DEFAULT_BROKER = LOCAL_MODE ? `ws://${location.hostname}:9001` : PUBLIC_BROKER;
/* 本机模式下存过的还是公共服务器（以前在这个地址用过）：换成本机的 */
function brokerFor(url) { return !url || (LOCAL_MODE && url === PUBLIC_BROKER) ? DEFAULT_BROKER : url; }
