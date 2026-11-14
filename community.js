/* ---------- 社区 ----------
   大家分享三种内容：练习曲线（温度曲线 + 摇动范围 + 美味值）、自创配方、心得。
   别人的练习曲线可以一键设为参考曲线来练；自创配方可以直接拿来练。

   存储分两种，界面完全一样：
   - 本机模式（默认）：帖子存在这台设备的 localStorage，演示时不依赖网络；
   - 云端模式：community-config.js 里填了 Supabase 地址和 key，就读写云端，所有人看到同一个社区。
   开头那几条带“示例”标记的是演示用的示例内容，不是真实用户发的。 */

const CC = window.COMMUNITY_CONFIG || {};
const CLOUD = !!(CC.supabaseUrl && CC.anonKey);
const LOCAL_KEY = 'shakecup-community-v1', PROFILE_KEY = 'shakecup-profile-v1', LIKED_KEY = 'shakecup-liked-v1';
const KINDS = { run: '练习曲线', recipe: '自创配方', tip: '心得' };
const TAGS = ['新手', '进阶', '带蛋清', '无酒精', '低糖', '冰块', '手法', '求指点'];
const AMP_CM = 20;                         // 练习页内部幅度值 × 20 ≈ 单程厘米（和 device.js 的换算一致）
const LIMIT = { name: 16, title: 40, body: 1000, comment: 300 };

let commPosts = [], commNote = '';
let commFilter = { kind: 'all', drink: 'all', sort: 'new' };
let practiceRef = null;                    // 正在用的社区参考曲线：{ postId, title, author, curve, target, rhythm }

/* ---------- 小工具 ---------- */
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const AVATAR_COLORS = ['#e2b24a', '#e2675a', '#5fa8d3', '#7cc08a', '#b48ad6', '#e08a3c', '#4fb3a9'];
const hashStr = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const avatar = name => `<span class="avatar" style="--c:${AVATAR_COLORS[hashStr(name) % AVATAR_COLORS.length]}">${escapeHTML([...String(name || '?')][0])}</span>`;
const clientId = () => { let id = localStorage.getItem('shakecup-client'); if (!id) { id = Math.random().toString(36).slice(2, 12); try { localStorage.setItem('shakecup-client', id); } catch {} } return id; };
function getProfile() { return readJSON(PROFILE_KEY, null); }
function setProfile(name) { const p = { name: name.slice(0, LIMIT.name) }; writeJSON(PROFILE_KEY, p); return p; }
function ago(ts) {
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' 天前';
  return new Date(ts).toLocaleDateString('zh-CN');
}
const drinkName = p => p.recipe?.name || RECIPES.find(r => r.id === p.recipeId)?.name || '其他';
const quant = (arr, q) => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(q * (a.length - 1) + .5))] : 0; };

/* ---------- 曲线：压缩、统计、参考 ---------- */
/* 练习数据每 0.25 秒一帧，分享时压成每 0.5 秒一点，只留需要的字段 */
function compactCurve(list) {
  const out = []; let next = 0;
  for (const s of list) {
    if (s.t + 1e-6 < next && s !== list.at(-1)) continue;
    out.push({ t: +s.t.toFixed(2), temp: +s.temp.toFixed(2), reference: +(s.reference ?? s.temp).toFixed(2), hz: +(s.hz || 0).toFixed(2), amplitude: +(s.amplitude || 0).toFixed(3) });
    next = s.t + .5;
  }
  return out;
}
/* 摇动范围：只看在摇的那些点（节奏 > 0.5），取 10%~90% 分位，去掉起步和收尾 */
function curveStats(c) {
  const mv = c.filter(s => s.hz > .5), last = c.at(-1) || { t: 0, temp: 0 };
  const hz = mv.map(s => s.hz), amp = mv.map(s => s.amplitude * AMP_CM);
  return {
    finalTemp: last.temp, duration: last.t, startTemp: c[0]?.temp ?? last.temp,
    hzMid: quant(hz, .5), hzLo: quant(hz, .1), hzHi: quant(hz, .9),
    ampLo: quant(amp, .1), ampHi: quant(amp, .9), shakeTime: mv.length * .5
  };
}
/* 参考曲线：练习页和 device.js 都调用它。用社区曲线时，把那条曲线的形状
   缩放到“从这次的起始温度降到目标温度”；没用社区曲线就是原来的演示公式。 */
function referenceAt(t, T0, dur) {
  if (practiceRef) {
    const c = practiceRef.curve, c0 = c[0].temp, cEnd = c.at(-1).temp;
    let v = cEnd;
    if (t <= c[0].t) v = c0;
    else for (let i = 1; i < c.length; i++) if (c[i].t >= t) { const a = c[i - 1], b = c[i]; v = a.temp + (b.temp - a.temp) * (t - a.t) / ((b.t - a.t) || 1); break; }
    const span = (c0 - cEnd) || 1;
    return practiceRef.target + (v - cEnd) * (T0 - practiceRef.target) / span;
  }
  const p = Math.min(1, t / dur);
  return T0 - (T0 - target) * (1 - Math.pow(1 - p, 2.2));
}
function sparkSVG(c) {
  if (!c?.length) return '';
  const W = 220, H = 56, t1 = c.at(-1).t || 1, temps = c.map(s => s.temp), lo = Math.min(...temps) - 1, hi = Math.max(...temps) + 1;
  const pts = c.map(s => `${(s.t / t1 * W).toFixed(1)},${((hi - s.temp) / (hi - lo) * H).toFixed(1)}`).join(' ');
  const ref = c.map(s => `${(s.t / t1 * W).toFixed(1)},${((hi - s.reference) / (hi - lo) * H).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><polyline class="spark-ref" points="${ref}"/><polyline class="spark-now" points="${pts}"/></svg>`;
}

/* ---------- 示例内容 ----------
   用简单的冷却模型生成几条曲线：T(t) = T∞ + (T0 − T∞)·e^(−t/τ)，加一点手抖。
   都带 demo 标记，界面上会显示“示例”。 */
function seededRand(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function fakeCurve({ T0 = 22, Tinf = -6, tau = 4.2, dur = 13, hz = 3, hzJit = .2, amp = .7, ampJit = .06, pauses = [], early = 0, seed = 1, tgt = -6 }) {
  const r = seededRand(seed), out = [];
  for (let t = 0; t <= dur + 1e-6; t += .5) {
    const paused = pauses.some(([a, b]) => t >= a && t < b), moving = t >= .5 && !paused;
    const p = Math.min(1, t / 14);
    out.push({
      t, temp: +(Tinf + (T0 - Tinf) * Math.exp(-Math.max(0, t - .5 - early) / tau) + (r() - .5) * .15).toFixed(2),
      reference: +(T0 - (T0 - tgt) * (1 - Math.pow(1 - p, 2.2))).toFixed(2),
      hz: moving ? +(hz + (r() - .5) * 2 * hzJit).toFixed(2) : 0,
      amplitude: moving ? +(amp + (r() - .5) * 2 * ampJit).toFixed(3) : 0
    });
  }
  return out;
}
const DAY = 86400000;
function seedPosts() {
  const now = Date.now();
  const P = (o) => ({ demo: true, likes: 0, comments: [], tags: [], ...o, id: 'seed-' + o.id, createdAt: new Date(now - o.ago).toISOString() });
  return [
    P({ id: 'aj-wl', ago: .3 * DAY, kind: 'run', author: '调酒师阿杰', recipeId: 'white-lady', title: '白色佳人的参考曲线，可以拿去练', likes: 41,
      body: '在店里摇了五次，挑了最稳的一次。节奏一直保持每秒 3 下左右，幅度拉满整个手臂，13 秒左右温度就平了，再多摇也降不下去。想练稳定性的可以设成参考曲线跟着摇。',
      tags: ['进阶', '手法'], score: 95, target: -6.2, rhythm: 3.1, curve: fakeCurve({ Tinf: -6.4, tau: 3.6, dur: 13.5, hz: 3.1, hzJit: .12, amp: .75, seed: 3, tgt: -6.2 }),
      comments: [{ author: '小满', text: '跟着这条练了三次，第三次终于 82 了！', at: now - .2 * DAY }, { author: '调酒师阿杰', text: '收尾别急着停，等温度平了再放下。', at: now - .1 * DAY }] }),
    P({ id: 'xl-ws', ago: 1.1 * DAY, kind: 'run', author: '林小酒', recipeId: 'whiskey-sour', title: '第一次过 90 分！', likes: 23,
      body: '之前一直停得太早，这次听到“够冷了，可以停了”才放下。蛋清版的要比不加蛋清的多摇一会儿。', tags: ['新手', '带蛋清'],
      score: 91, target: -5.5, rhythm: 3, curve: fakeCurve({ Tinf: -5.6, tau: 4.4, dur: 14, hz: 2.9, hzJit: .25, amp: .68, seed: 7, tgt: -5.5 }),
      comments: [{ author: 'Momo', text: '蛋清版是先不加冰干摇吗？', at: now - .9 * DAY }] }),
    P({ id: 'gz-osm', ago: 2 * DAY, kind: 'recipe', author: '广州调酒社', title: '桂花威士忌酸（秋天限定）', likes: 35,
      body: '把糖浆换成桂花糖浆，香气很明显但不抢威士忌。蛋清一定要先干摇 10 秒再加冰摇。', tags: ['带蛋清'],
      recipe: { name: '桂花威士忌酸', en: 'Osmanthus Whiskey Sour', glass: 'rocks', glassName: '古典杯', color: '#e7b04a',
        parts: [['波本威士忌', 45], ['鲜柠檬汁', 25], ['桂花糖浆', 20], ['蛋清', 20]], deco: '干桂花少许',
        how: '所有材料先不加冰干摇 10 秒打发蛋清，再加满冰用力摇 12 秒，双重过滤倒入古典杯。' }, target: -5.5, rhythm: 3,
      comments: [] }),
    P({ id: 'momo-tip', ago: 3 * DAY, kind: 'tip', author: 'Momo', recipeId: 'daiquiri', title: '冰块别直接从冷冻室拿', likes: 18,
      body: '冷冻室的冰温度很低，表面干，摇出来温度会更低但稀释不够，喝起来很冲。拿出来放一两分钟、表面有点湿再用，每次都更稳定。', tags: ['冰块', '新手'], comments: [] }),
    P({ id: 'sm-mg', ago: 4 * DAY, kind: 'run', author: '小满', recipeId: 'margarita', title: '62 分，问题出在中间停了两次', likes: 7,
      body: '手酸了中间停了两下，曲线上能看到两个平台。大家怎么坚持 15 秒不停的？', tags: ['新手', '求指点'],
      score: 62, target: -5.8, rhythm: 3, curve: fakeCurve({ Tinf: -4.8, tau: 5.6, dur: 12, hz: 2.6, hzJit: .3, amp: .55, ampJit: .1, pauses: [[4, 5.5], [8, 9]], seed: 11, tgt: -5.8 }),
      comments: [{ author: '调酒师阿杰', text: '用手腕和小臂一起发力，肩膀放松；手小的话先用小号摇杯。', at: now - 3.5 * DAY }] }),
    P({ id: 'virgin', ago: 5 * DAY, kind: 'recipe', author: '广州调酒社', title: '青柠薄荷摇摇（无酒精）', likes: 29,
      body: '社团活动不方便用酒，就用这杯练手法，降温曲线和摇和酒差不多，适合新手。', tags: ['无酒精', '新手'],
      recipe: { name: '青柠薄荷摇摇', en: 'Virgin Lime Mint Shake', glass: 'coupe', glassName: '碟形杯', color: '#cfe8b0',
        parts: [['苹果汁', 60], ['鲜青柠汁', 25], ['糖浆', 20], ['薄荷叶', '6 片']], deco: '薄荷叶一片',
        how: '薄荷叶轻拍后放进摇杯，加入其余材料和满冰，用力摇 12 秒，滤入冰过的碟形杯。' }, target: -1.5, rhythm: 3, comments: [] }),
    P({ id: 'aj-tip', ago: 6 * DAY, kind: 'tip', author: '调酒师阿杰', recipeId: 'whiskey-sour', title: '摇多久？看曲线平没平', likes: 52,
      body: '很多人问到底摇 10 秒还是 15 秒。其实看温度曲线就知道：用力摇的话十几秒后曲线就平了，酒的温度和稀释基本不再变，再摇也没多大区别；没平就还没到位。用这个杯子练几次，就能记住“平了”的手感。', tags: ['手法', '进阶'], comments: [] }),
    P({ id: 'kk-cos', ago: 8 * DAY, kind: 'run', author: 'KK', recipeId: 'cosmopolitan', title: '幅度一直偏小，分数卡在 70', likes: 9,
      body: '宿舍空间小，不敢甩开摇。曲线降得比参考慢一截。下次试试站起来摇。', tags: ['求指点'],
      score: 71, target: -5.8, rhythm: 3, curve: fakeCurve({ Tinf: -4.6, tau: 6.2, dur: 15, hz: 3.2, hzJit: .2, amp: .38, ampJit: .05, seed: 23, tgt: -5.8 }), comments: [] })
  ];
}

/* ---------- 存储 ---------- */
const LocalStore = {
  read() { return readJSON(LOCAL_KEY, { posts: [], comments: {} }); },
  async list() {
    const st = this.read(), liked = readJSON(LIKED_KEY, []);
    return [...st.posts, ...seedPosts()].map(p => ({ ...p,
      comments: [...(p.comments || []), ...(st.comments[p.id] || [])],
      likes: (p.likes || 0) + (liked.includes(p.id) ? 1 : 0) }));
  },
  async create(post) { const st = this.read(); st.posts.unshift(post); if (!writeJSON(LOCAL_KEY, st)) throw new Error('浏览器存不下了'); return post; },
  async comment(id, c) { const st = this.read(); (st.comments[id] ||= []).push(c); writeJSON(LOCAL_KEY, st); },
  async like() {}
};
/* Supabase：直接调它的 REST 接口，不用额外的库。表结构见《社区云端设置.md》 */
const CloudStore = {
  h(extra = {}) { return { apikey: CC.anonKey, Authorization: 'Bearer ' + CC.anonKey, 'Content-Type': 'application/json', ...extra }; },
  url(path) { return CC.supabaseUrl.replace(/\/$/, '') + '/rest/v1/' + path; },
  async req(path, opt = {}) {
    const r = await fetch(this.url(path), { ...opt, headers: this.h(opt.headers) });
    if (!r.ok && r.status !== 409) throw new Error(`云端返回 ${r.status}`);
    return r.status === 204 || r.status === 409 ? null : r.json();
  },
  async list() {
    const rows = await this.req('posts?select=id,created_at,data,likes(count),comments(id,created_at,data)&order=created_at.desc&limit=200');
    const local = await LocalStore.list();                 // 示例内容和它们的本机点赞、评论
    const cloud = rows.map(r => ({ ...r.data, id: r.id, createdAt: r.created_at, likes: r.likes?.[0]?.count || 0,
      comments: (r.comments || []).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(c => ({ ...c.data, at: c.created_at })) }));
    return [...cloud, ...local.filter(p => p.demo)];
  },
  async create(post) {
    const { id, createdAt, likes, comments, ...data } = post;
    const [row] = await this.req('posts', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ data }) });
    return { ...post, id: row.id, createdAt: row.created_at };
  },
  async comment(id, c) {
    if (String(id).startsWith('seed-')) return LocalStore.comment(id, c);
    await this.req('comments', { method: 'POST', body: JSON.stringify({ post_id: id, data: { author: c.author, text: c.text } }) });
  },
  async like(id, on) {
    if (String(id).startsWith('seed-')) return;
    if (on) await this.req('likes', { method: 'POST', body: JSON.stringify({ post_id: id, client_id: clientId() }) });
    else await this.req(`likes?post_id=eq.${encodeURIComponent(id)}&client_id=eq.${clientId()}`, { method: 'DELETE' });
  }
};
const store = CLOUD ? CloudStore : LocalStore;

async function loadPosts() {
  try { commPosts = await store.list(); commNote = CLOUD ? '云端模式：大家看到的是同一个社区。' : '本机模式：你发的内容只存在这台设备上。配置云端后所有人都能看到。'; }
  catch (e) {
    commPosts = await LocalStore.list();
    commNote = `云端暂时连不上（${e.message}），先显示本机内容。`;
  }
}

/* ---------- 列表 ---------- */
function showCommunity() {
  if (running) return;
  $('#setup').hidden = true; $('#live').hidden = true; $('#codex').hidden = true; $('#community').hidden = false;
  document.documentElement.style.setProperty('--chill', 0);
  window.scrollTo({ top: 0 });
  renderFilters(); $('#feed').innerHTML = '<li class="feed-empty">加载中…</li>';
  loadPosts().then(renderFeed);
}
function renderFilters() {
  const kinds = [['all', '全部'], ...Object.entries(KINDS)];
  $('#comm-kinds').innerHTML = kinds.map(([k, n]) => `<button role="tab" data-kind="${k}" aria-selected="${commFilter.kind === k}">${n}</button>`).join('');
  $('#comm-drink').innerHTML = `<option value="all">所有酒</option>` + RECIPES.filter(r => r.shake).map(r => `<option value="${r.id}">${r.name}</option>`).join('') + `<option value="other">其他 / 自创</option>`;
  $('#comm-drink').value = commFilter.drink; $('#comm-sort').value = commFilter.sort;
  $$('#comm-kinds [data-kind]').forEach(b => b.onclick = () => { commFilter.kind = b.dataset.kind; renderFilters(); renderFeed(); });
  $('#comm-drink').onchange = e => { commFilter.drink = e.target.value; renderFeed(); };
  $('#comm-sort').onchange = e => { commFilter.sort = e.target.value; renderFeed(); };
}
/* 社区卡片：上半是这条内容最有代表性的图（曲线、配料刻度或酒的照片），下半是文字。
   三种内容的图高度不同，用瀑布流排，一屏能看到更多条。 */
function postVisual(p, st) {
  if (st) return `<span class="post-visual v-curve">${sparkSVG(p.curve)}<span class="post-score"><b>${p.score}</b>分</span></span>`;
  const r = p.recipe;
  if (r?.parts?.length) {
    const max = Math.max(1, ...r.parts.map(x => typeof x[1] === 'number' ? x[1] : 0));
    return `<span class="post-visual v-measure">${r.parts.slice(0, 5).map(([n, ml]) => typeof ml === 'number'
      ? `<span class="m-row"><span class="m-name">${escapeHTML(n)}</span><i style="--w:${(ml / max * 100).toFixed(0)}%"></i><span class="m-ml">${ml}<small>ml</small></span></span>`
      : `<span class="m-row m-extra"><span class="m-name">${escapeHTML(n)}</span><span class="m-ml">${escapeHTML(ml)}</span></span>`).join('')}</span>`;
  }
  const d = RECIPES.find(x => x.id === p.recipeId);
  return d ? `<span class="post-visual v-photo"><span class="post-arch" data-art="${d.id}">${drinkArt(d)}</span></span>` : '';
}
function postCard(p) {
  const st = p.curve ? curveStats(p.curve) : null;
  return `<li><button class="post-card k-${p.kind}" data-post="${escapeHTML(p.id)}">
    ${postVisual(p, st)}
    <span class="post-main">
      <span class="post-top"><span class="post-kind k-${p.kind}">${KINDS[p.kind]}</span><span class="post-drink">${escapeHTML(drinkName(p))}</span>${p.demo ? '<span class="post-demo" title="演示用的示例内容">示例</span>' : ''}</span>
      <span class="post-title">${escapeHTML(p.title)}</span>
      ${st ? `<span class="post-stats"><span>停在 ${deg(st.finalTemp)} ℃</span><span>${st.duration.toFixed(0)} 秒</span><span>${st.hzMid.toFixed(1)} 次/秒</span></span>` : ''}
      <span class="post-body">${escapeHTML(p.body || '')}</span>
      <span class="post-foot">${avatar(p.author)}<span class="post-author">${escapeHTML(p.author)}</span><span class="post-time">${ago(p.createdAt)}</span>
        <span class="post-meta"><span>♥ ${p.likes || 0}</span><span>评论 ${p.comments?.length || 0}</span></span></span>
    </span>
  </button></li>`;
}
/* 瀑布流：按顺序轮流放进各列，保持从左到右、从上到下的阅读顺序 */
let feedList = [];
const feedCols = () => { const w = $('#feed').clientWidth || innerWidth; return w >= 1100 ? 4 : w >= 760 ? 3 : w >= 480 ? 2 : 1; };
function layoutFeed() {
  const box = $('#feed');
  if (!feedList.length) { box.innerHTML = '<li class="feed-empty">这里还没有内容，来发第一条吧。</li>'; box.dataset.cols = 0; return; }
  const n = feedCols(), cols = Array.from({ length: n }, () => []);
  feedList.forEach((p, i) => cols[i % n].push(postCard(p)));
  box.dataset.cols = n;
  box.innerHTML = cols.map(c => `<li class="feed-col"><ul>${c.join('')}</ul></li>`).join('');
  $$('#feed [data-post]').forEach(b => b.onclick = () => openPost(b.dataset.post));
  if (typeof decorateArt === 'function') decorateArt(box);
}
addEventListener('resize', () => { const b = $('#feed'); if (b && Number(b.dataset.cols) && feedCols() !== Number(b.dataset.cols)) layoutFeed(); });
function renderFeed() {
  let list = commPosts.filter(p => (commFilter.kind === 'all' || p.kind === commFilter.kind) &&
    (commFilter.drink === 'all' || (commFilter.drink === 'other' ? !RECIPES.some(r => r.id === p.recipeId) : p.recipeId === commFilter.drink)));
  feedList = list.slice().sort(commFilter.sort === 'hot'
    ? (a, b) => (b.likes + 2 * (b.comments?.length || 0)) - (a.likes + 2 * (a.comments?.length || 0))
    : (a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  layoutFeed();
  $('#comm-note').textContent = commNote;
}

/* ---------- 详情 ---------- */
function openPost(id) {
  const p = commPosts.find(x => String(x.id) === String(id)); if (!p) return;
  const liked = readJSON(LIKED_KEY, []).includes(p.id);
  const st = p.curve ? curveStats(p.curve) : null, r = p.recipe;
  const statRow = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
  showModal(`<div class="post-detail">
    <p class="post-top"><span class="post-kind k-${p.kind}">${KINDS[p.kind]}</span><span class="post-drink">${escapeHTML(drinkName(p))}</span>${p.demo ? '<span class="post-demo">示例</span>' : ''}</p>
    <h2>${escapeHTML(p.title)}</h2>
    <p class="post-by">${avatar(p.author)}<span>${escapeHTML(p.author)}</span><span class="post-time">${ago(p.createdAt)}</span></p>
    ${st ? `<svg class="chart" id="p-chart" viewBox="0 0 600 260"></svg>
      <p class="fine chart-key"><span class="key-now"></span>温度　<span class="key-ref"></span>当时跟的参考</p>
      <dl class="post-statgrid">
        ${statRow('美味值', `<b>${p.score}</b> 分`)}
        ${statRow('停在', deg(st.finalTemp) + ' ℃')}
        ${statRow('目标', deg(p.target) + ' ℃')}
        ${statRow('一共', st.duration.toFixed(1) + ' 秒')}
        ${statRow('节奏范围', `${st.hzLo.toFixed(1)}–${st.hzHi.toFixed(1)} 次/秒`)}
        ${statRow('幅度范围', `${st.ampLo.toFixed(0)}–${st.ampHi.toFixed(0)} cm`)}
      </dl>
      ${p.parts ? `<div class="parts" id="p-parts"></div><p class="part-detail" id="p-part-detail"></p>` : ''}` : ''}
    ${r ? `<p class="rc-tags"><span>摇和</span><span>${escapeHTML(r.glassName || '')}</span>${p.target != null ? `<span>目标 ${deg(p.target)} ℃</span>` : ''}</p>
      <ul class="rc-parts">${r.parts.map(([n, ml]) => `<li><span>${escapeHTML(n)}</span><b>${typeof ml === 'number' ? ml + ' ml' : escapeHTML(ml)}</b></li>`).join('')}<li><span>装饰</span><b>${escapeHTML(r.deco || '无')}</b></li></ul>
      ${stepsHTML(r.how)}` : ''}
    ${p.body ? `<p class="post-text">${escapeHTML(p.body)}</p>` : ''}
    ${p.tags?.length ? `<p class="post-tags">${p.tags.map(t => `<span>#${escapeHTML(t)}</span>`).join('')}</p>` : ''}
    <div class="result-actions post-actions">
      ${p.kind === 'run' ? '<button class="primary" id="use-curve">用这条曲线练</button>' : ''}
      ${p.kind === 'recipe' ? '<button class="primary" id="use-recipe">用这个配方练</button>' : ''}
      <button class="secondary like${liked ? ' on' : ''}" id="like" aria-pressed="${liked}">♥ <span>${p.likes || 0}</span></button>
    </div>
    <h3 class="comments-title">评论 ${p.comments?.length || 0}</h3>
    <ul class="comments">${(p.comments || []).map(c => `<li>${avatar(c.author)}<div><b>${escapeHTML(c.author)}</b> <span class="fine">${ago(c.at)}</span><p>${escapeHTML(c.text)}</p></div></li>`).join('') || '<li class="fine">还没有评论。</li>'}</ul>
    <form class="comment-form" id="comment-form">
      ${getProfile() ? '' : `<input name="name" maxlength="${LIMIT.name}" placeholder="你的昵称" required>`}
      <input name="text" maxlength="${LIMIT.comment}" placeholder="说点什么…" required>
      <button class="secondary" type="submit">发送</button>
    </form>
  </div>`);
  if (st) {
    const opt = { duration: st.duration, target: p.target };
    drawChart($('#p-chart'), p.curve, opt);
    if (p.parts) { renderParts($('#p-parts'), $('#p-part-detail'), $('#p-chart'), p.curve, [], opt, p.parts, p.rhythm || 3); $('#p-part-detail').textContent = weakest(p.parts); }
  }
  $('#like').onclick = async () => {
    const set = new Set(readJSON(LIKED_KEY, [])), on = !set.has(p.id);
    on ? set.add(p.id) : set.delete(p.id); writeJSON(LIKED_KEY, [...set]);
    p.likes = (p.likes || 0) + (on ? 1 : -1);
    $('#like').classList.toggle('on', on); $('#like').setAttribute('aria-pressed', on); $('#like span').textContent = p.likes;
    try { await store.like(p.id, on); } catch {}
    renderFeed();
  };
  $('#comment-form').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target), prof = getProfile() || setProfile(String(f.get('name')).trim() || '匿名');
    const c = { author: prof.name, text: String(f.get('text')).trim().slice(0, LIMIT.comment), at: new Date().toISOString() };
    if (!c.text) return;
    try { await store.comment(p.id, c); } catch (err) { alertInModal('评论没发出去：' + err.message); return; }
    (p.comments ||= []).push(c); renderFeed(); openPost(p.id);
  };
  const uc = $('#use-curve'); if (uc) uc.onclick = () => usePostCurve(p);
  const ur = $('#use-recipe'); if (ur) ur.onclick = () => usePostRecipe(p);
  window.decorateArt?.($('#modal-content'));
}
function alertInModal(msg) { const el = document.createElement('p'); el.className = 'form-error'; el.textContent = msg; $('#modal-content').appendChild(el); }

/* ---------- 拿社区内容来练 ---------- */
function usePostCurve(p) {
  const st = curveStats(p.curve);
  practiceRef = { postId: p.id, title: p.title, author: p.author, curve: p.curve, target: p.target ?? st.finalTemp, rhythm: p.rhythm || +st.hzMid.toFixed(1) };
  const r = RECIPES.find(x => x.id === p.recipeId); if (r) recipe = r;
  mode = 'standard'; $$('[data-mode]').forEach(x => x.setAttribute('aria-selected', x.dataset.mode === 'standard')); $('#free-settings').hidden = true;
  $('#modal').close(); $('#community').hidden = true; showSetup(); renderRefChip();
}
function usePostRecipe(p) {
  const r = p.recipe;
  recipe = { id: 'custom-' + p.id, custom: true, name: r.name, en: r.en || '', shake: true, method: '摇和', glass: r.glass || 'coupe', glassName: r.glassName,
    color: r.color || '#e9b44c', garnish: 'none', note: p.body || '', parts: r.parts, deco: r.deco || '无', how: r.how || '' };
  practiceRef = null;
  $('#modal').close(); $('#community').hidden = true; showSetup(); renderRefChip();
}
function renderRefChip() {
  const box = $('#ref-chip');
  if (!practiceRef) { box.hidden = true; updateModeLabel(); return; }
  box.hidden = false;
  box.innerHTML = `${avatar(practiceRef.author)}<span><b>跟 ${escapeHTML(practiceRef.author)} 的曲线练</b><br>${escapeHTML(practiceRef.title)}，目标 ${deg(practiceRef.target)} ℃，${practiceRef.rhythm.toFixed(1)} 次/秒</span><button class="link" id="ref-clear">不用了</button>`;
  $('#ref-clear').onclick = () => { practiceRef = null; renderRefChip(); };
  updateModeLabel();
}
function updateModeLabel() {
  const span = $('[data-mode="standard"] span');
  if (span) span.textContent = practiceRef ? `跟 ${practiceRef.author} 的曲线，目标 ${deg(practiceRef.target)} ℃` : '目标 −2.0 ℃，节奏 3 Hz';
}

/* ---------- 发帖 ---------- */
function runSources() {
  const out = [];
  if (completed && samples.length) out.push({ key: 'now', label: `刚才这次：${recipe.name} ${finalScore} 分`, recipeId: recipe.id, score: finalScore, parts: finalParts, target, rhythm: desiredRhythm, samples });
  stored().forEach((v, i) => out.push({ key: 'saved-' + i, label: `收藏：${v.recipeName || '威士忌酸'} ${v.score} 分（${new Date(v.date).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}）`, recipeId: v.recipe || 'whiskey-sour', score: v.score, parts: v.parts, target: v.target, rhythm: v.rhythm || 3, samples: v.samples }));
  return out;
}
function openComposer(pre = {}) {
  const prof = getProfile(), srcs = runSources();
  const kind = pre.kind || (srcs.length ? 'run' : 'tip');
  const drinkOpts = RECIPES.filter(r => r.shake).map(r => `<option value="${r.id}">${r.name}</option>`).join('') + '<option value="other">其他</option>';
  const ingRow = (n = '', ml = '') => `<div class="ing-row"><input name="ing-n" maxlength="20" placeholder="材料" value="${escapeHTML(n)}"><input name="ing-ml" maxlength="10" placeholder="ml 或 几滴" value="${escapeHTML(ml)}"><button type="button" class="link ing-del" aria-label="删掉这行">✕</button></div>`;
  showModal(`<h2>分享到社区</h2>
  <form class="composer" id="composer">
    <div class="mode kind-tabs" role="tablist">${Object.entries(KINDS).map(([k, n]) => `<button type="button" role="tab" data-ckind="${k}" aria-selected="${k === kind}"><b>${n}</b><span>${{ run: '温度曲线、摇动范围、美味值', recipe: '材料、做法、目标温度', tip: '经验、技巧、问题' }[k]}</span></button>`).join('')}</div>
    <label>昵称<input name="name" maxlength="${LIMIT.name}" required value="${escapeHTML(prof?.name || '')}" placeholder="大家会看到这个名字"></label>
    <label>标题<input name="title" maxlength="${LIMIT.title}" required placeholder="一句话说说这条分享"></label>

    <fieldset data-for="run">
      <label>选一次练习${srcs.length ? '' : '<span class="fine">（还没有练习记录：先练一杯，或者在结果页收藏）</span>'}
        <select name="source">${srcs.map(s => `<option value="${s.key}">${escapeHTML(s.label)}</option>`).join('')}</select></label>
      <div class="composer-preview" id="cp-preview"></div>
    </fieldset>

    <fieldset data-for="recipe">
      <div class="two"><label>酒名<input name="r-name" maxlength="20" placeholder="比如 桂花威士忌酸"></label><label>英文名（可选）<input name="r-en" maxlength="40"></label></div>
      <p class="label">材料</p>
      <div id="ings">${ingRow()}${ingRow()}${ingRow()}</div>
      <button type="button" class="link" id="ing-add">+ 加一行</button>
      <div class="two"><label>杯型<select name="r-glass"><option value="coupe">碟形杯</option><option value="martini">马天尼杯</option><option value="rocks">古典杯</option><option value="highball">高球杯</option></select></label>
        <label>目标温度 ℃<input name="r-target" type="number" step=".5" min="-12" max="10" value="-5.5"></label></div>
      <label>装饰<input name="r-deco" maxlength="30" placeholder="没有就留空"></label>
      <label>做法<textarea name="r-how" maxlength="300" rows="3" placeholder="怎么摇、摇多久、怎么倒"></textarea></label>
    </fieldset>

    <fieldset data-for="tip"><label>关于哪杯酒<select name="tip-drink">${drinkOpts}</select></label></fieldset>

    <label>心得<textarea name="body" maxlength="${LIMIT.body}" rows="4" placeholder="这次哪里做得好、哪里没做好，有什么想问大家的"></textarea></label>
    <div class="tag-pick">${TAGS.map(t => `<label><input type="checkbox" name="tags" value="${t}"><span>#${t}</span></label>`).join('')}</div>
    <p class="fine">${CLOUD ? '发出后社区里所有人都能看到。' : '现在是本机模式：只有这台设备能看到。'}</p>
    <div class="result-actions"><button class="primary" type="submit">发布</button></div>
  </form>`);
  const form = $('#composer');
  let cur = kind;
  const setKind = k => {
    cur = k;
    $$('[data-ckind]').forEach(b => b.setAttribute('aria-selected', b.dataset.ckind === k));
    $$('#composer fieldset').forEach(f => { f.hidden = f.dataset.for !== k; f.disabled = f.dataset.for !== k; });
  };
  $$('[data-ckind]').forEach(b => b.onclick = () => setKind(b.dataset.ckind));
  setKind(kind);
  const preview = () => {
    const s = srcs.find(x => x.key === form.source.value); const box = $('#cp-preview');
    if (!s) { box.innerHTML = ''; return; }
    const c = compactCurve(s.samples), st = curveStats(c);
    box.innerHTML = `${sparkSVG(c)}<span class="post-stats"><span><b>${s.score}</b> 分</span><span>停在 ${deg(st.finalTemp)} ℃</span><span>${st.duration.toFixed(0)} 秒</span><span>节奏 ${st.hzLo.toFixed(1)}–${st.hzHi.toFixed(1)} 次/秒</span><span>幅度 ${st.ampLo.toFixed(0)}–${st.ampHi.toFixed(0)} cm</span></span>`;
  };
  if (form.source) { form.source.onchange = preview; if (pre.source) form.source.value = pre.source; preview(); }
  $('#ing-add').onclick = () => { $('#ings').insertAdjacentHTML('beforeend', ingRow()); bindDel(); };
  const bindDel = () => $$('.ing-del').forEach(b => b.onclick = () => { if ($$('.ing-row').length > 1) b.parentElement.remove(); });
  bindDel();

  form.onsubmit = async e => {
    e.preventDefault();
    $$('.form-error').forEach(x => x.remove());
    const f = new FormData(form), name = String(f.get('name')).trim(), title = String(f.get('title')).trim();
    if (!name || !title) return;
    setProfile(name);
    const post = { id: 'local-' + Date.now().toString(36), createdAt: new Date().toISOString(), kind: cur, author: name.slice(0, LIMIT.name), title: title.slice(0, LIMIT.title),
      body: String(f.get('body') || '').trim().slice(0, LIMIT.body), tags: f.getAll('tags'), likes: 0, comments: [] };
    if (cur === 'run') {
      const s = srcs.find(x => x.key === f.get('source'));
      if (!s) { alertInModal('先练一杯，才有曲线可以分享。'); return; }
      Object.assign(post, { recipeId: s.recipeId, score: s.score, parts: s.parts, target: s.target, rhythm: s.rhythm, curve: compactCurve(s.samples) });
    } else if (cur === 'recipe') {
      const ns = f.getAll('ing-n'), ms = f.getAll('ing-ml');
      const parts = ns.map((n, i) => [String(n).trim(), String(ms[i]).trim()]).filter(([n]) => n).map(([n, ml]) => [n, /^\d+(\.\d+)?$/.test(ml) ? Number(ml) : ml || '适量']);
      const rname = String(f.get('r-name')).trim();
      if (!rname || !parts.length) { alertInModal('酒名和至少一样材料要填。'); return; }
      const glass = f.get('r-glass');
      Object.assign(post, { recipeId: 'custom', target: Number(f.get('r-target')), rhythm: 3,
        recipe: { name: rname, en: String(f.get('r-en')).trim(), glass, glassName: GLASS[glass], parts, deco: String(f.get('r-deco')).trim() || '无', how: String(f.get('r-how')).trim() } });
    } else post.recipeId = f.get('tip-drink');
    const btn = form.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = '发布中…';
    try {
      const saved = await store.create(post);
      $('#modal').close();
      commFilter = { kind: 'all', drink: 'all', sort: 'new' };
      showCommunity();
      setTimeout(() => openPost(saved.id), 300);
    } catch (err) { btn.disabled = false; btn.textContent = '发布'; alertInModal('没发出去：' + err.message); }
  };
}

/* ---------- 绑定 ---------- */
$('#open-community').onclick = showCommunity;
$('#comm-post').onclick = () => openComposer();
$('#share-community').onclick = () => openComposer({ kind: 'run', source: 'now' });
