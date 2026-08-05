const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// 文本清洗 / 分段 / 说话人识别 / 文章 markup 都在 reader-core.js（与静态导出共用同一份）
const { esc, readMinutes, pickTranscripts, articleHTML } = ReaderCore;

const MEDIA_ICON = { audio: '🎧', video: '🎬', text: '📄' };

// 默认头像/封面配色：低饱和粉彩底 + 同色系深色前景（柔和、不刺眼）
// [浅色底, 深色前景, 封面渐变深端]
const PALETTE = [
  ['#E8EEFB', '#3B5BDB', '#D6E0F5'], // 蓝
  ['#FBEAEA', '#C0392B', '#F5D6D6'], // 红
  ['#E6F4EA', '#1E7E45', '#D3EBDB'], // 绿
  ['#FDF3E3', '#B9770E', '#F8E8CC'], // 琥珀
  ['#F1EAFB', '#6741D9', '#E4D8F5'], // 紫
  ['#E7F5F8', '#0B7285', '#D2ECF1'], // 青
  ['#FBEAF3', '#A61E6E', '#F5D6E8'], // 玫红
  ['#EFF1F3', '#495057', '#E2E5E9'], // 石墨
];
function paletteFor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function gradientFor(name) {
  const [light, , deep] = paletteFor(name);
  return `linear-gradient(150deg, ${light}, ${deep})`;
}

const state = { media: '', unwatched: false, hastext: false, recent: false, person: '', tag: '', q: '' };
// 首页视图：time = 全部按时间倒序混排（方便顺着看进度），company = 按机构货架
let homeView = localStorage.getItem('homeView') || 'time';
const expanded = new Set(JSON.parse(localStorage.getItem('expandedShelves') || '[]')); // 记住展开的公司
let all = [], persons = [];
// 阅读偏好：字号档位 + 衬线/黑体 + 栏宽 + 语言，全部持久化
const SIZE_STEPS = [15, 16, 17, 18, 19, 20, 21, 22, 24];
const WIDTH_STEPS = [{ w: 680, label: '标准' }, { w: 860, label: '宽' }, { w: 1060, label: '超宽' }];
const readerPrefs = Object.assign(
  { size: matchMedia('(max-width: 680px)').matches ? 17 : 19, font: 'sans', width: 680 },
  JSON.parse(localStorage.getItem('readerPrefs') || '{}')
);
let readerLangPref = localStorage.getItem('readerLang') || 'zh';

// 静态部署（GitHub Pages）：数据读导出的 JSON
const IS_STATIC = !!window.__STATIC__;
// 「已看」是纯前端功能：状态只存本浏览器 localStorage，覆盖数据里导出时的基线，不回传服务器
const watchedLS = JSON.parse(localStorage.getItem('watchedOverride') || '{}');

// ---------- 数据 ----------
async function loadAll() {
  [all, persons] = await Promise.all([
    fetch(IS_STATIC ? '/api/interviews.json' : '/api/interviews').then(r => r.json()),
    fetch(IS_STATIC ? '/api/persons.json' : '/api/persons').then(r => r.json()),
  ]);
  for (const i of all) {
    if (watchedLS[i.id] != null) i.watched = watchedLS[i.id];
    i._tags = i.tags ? JSON.parse(i.tags) : [];
  }
  renderPersons();
  render();
}

function daysAgo(dateStr) {
  if (!dateStr) return Infinity;
  return (Date.now() - new Date(dateStr).getTime()) / 86400000;
}

function filtered() {
  return all.filter(i =>
    (!state.media || i.media_type === state.media) &&
    (!state.unwatched || !i.watched) &&
    (!state.hastext || i.status !== 'collected') &&
    (!state.recent || daysAgo(i.published_date) <= 92) &&
    (!state.person || i.person === state.person) &&
    (!state.tag || i._tags.includes(state.tag)) &&
    (!state.q || [i.title, i.title_zh, i.summary, i.person, i.company, i.host, i.role, i._tags.join(' ')]
      .join(' ').toLowerCase().includes(state.q))
  );
}

const byDateDesc = (a, b) => (b.published_date || '').localeCompare(a.published_date || '');

// ---------- 人物条 ----------
function renderPersons() {
  $('#persons-row').innerHTML = persons.map(p => {
    const [light, deep] = paletteFor(p.person);
    return `
    <button class="person-chip ${state.person === p.person ? 'active' : ''}" data-person="${esc(p.person)}">
      <span class="avatar" style="background:${light};color:${deep}">${esc(initials(p.person))}</span>
      <span class="pc-name">${esc(p.person)}</span>
    </button>`;
  }).join('');
}

function initials(name) {
  if (/[一-鿿]/.test(name)) return name.slice(0, 1);
  return name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

// ---------- 卡片 ----------
function coverHTML(i, cls = 'cover') {
  const badges = `
    ${i.duration ? `<span class="duration">${esc(i.duration)}</span>` : ''}
    <button class="eye" data-eye="${i.id}" title="${i.watched ? '标记未看' : '标记已看'}">${i.watched ? '↺' : '✓'}</button>`;
  if (i.thumb) {
    return `<div class="${cls}"><img src="${esc(i.thumb)}" loading="lazy" alt="" />${badges}</div>`;
  }
  const [, deep] = paletteFor(i.person);
  return `<div class="${cls} fallback" style="background:${gradientFor(i.person)}">
    <span class="fb-person" style="color:${deep}">${esc(i.person)}</span>${badges}</div>`;
}

function cardHTML(i) {
  const isNew = !i.watched && daysAgo(i.published_date) <= 45;
  return `
    <div class="card ${i.watched ? 'is-watched' : ''}" data-id="${i.id}">
      ${coverHTML(i)}
      <div class="card-info">
        <div class="card-title">${isNew ? '<span class="dot-new"></span>' : ''}${esc(i.title_zh || i.title)}</div>
        <div class="card-meta">
          ${i.published_date ? `<span class="card-date">${esc(i.published_date)}</span> · ` : ''}${esc(i.person)}
        </div>
      </div>
    </div>`;
}

// ---------- 列表 ----------
function render() {
  const items = filtered();
  const af = [];
  if (state.person) {
    const p = persons.find(x => x.person === state.person);
    af.push(`<span class="af-person">${esc(state.person)}</span>${p?.role ? `<span class="af-role">${esc(p.role)}</span>` : ''}`);
  }
  if (state.tag) af.push(`<span class="af-tag"># ${esc(state.tag)}</span>`);
  $('#active-filter').innerHTML = af.length
    ? `<div class="af-inner">${af.join('')}<button class="af-clear" id="af-clear">✕ 清除筛选</button></div>` : '';
  $('#af-clear')?.addEventListener('click', () => { state.person = ''; state.tag = ''; renderPersons(); render(); });

  if (!items.length) {
    $('#shelves').innerHTML = '<p class="empty">没有匹配的访谈</p>';
    return;
  }

  // 选中人物或 tag 时：平铺网格，按时间倒序
  if (state.person || state.tag) {
    $('#shelves').innerHTML = `<div class="grid">${items.sort(byDateDesc).map(cardHTML).join('')}</div>`;
    return;
  }

  // 按时间视图（默认）：全部混排、时间倒序，按月份分节方便定位读到哪了
  if (homeView === 'time') {
    const months = new Map();
    for (const i of items.sort(byDateDesc)) {
      const key = i.published_date ? i.published_date.slice(0, 7) : '';
      if (!months.has(key)) months.set(key, []);
      months.get(key).push(i);
    }
    $('#shelves').innerHTML = [...months.entries()].map(([m, list]) => {
      const title = m ? `${m.slice(0, 4)} 年 ${Number(m.slice(5, 7))} 月` : '未知时间';
      const unread = list.filter(i => !i.watched).length;
      return `
      <section class="shelf">
        <div class="shelf-head">
          <span class="shelf-title">${title}</span>
          <span class="shelf-count">${list.length} 场${unread ? ` · ${unread} 未看` : ' · 已看完'}</span>
        </div>
        <div class="grid shelf-grid">${list.map(cardHTML).join('')}</div>
      </section>`;
    }).join('');
    return;
  }

  // 按机构视图：公司货架，架内按时间倒序；可单独展开某公司为平铺网格
  const shelves = new Map();
  for (const i of items) {
    const key = i.company || '其他';
    if (!shelves.has(key)) shelves.set(key, []);
    shelves.get(key).push(i);
  }
  const ordered = [...shelves.entries()].sort((a, b) => b[1].length - a[1].length);
  $('#shelves').innerHTML = ordered.map(([company, list]) => {
    const open = expanded.has(company);
    return `
    <section class="shelf">
      <div class="shelf-head">
        <span class="shelf-title">${esc(company)}</span>
        <span class="shelf-count">${list.length} 场</span>
        ${list.length > 1 ? `
        <button class="shelf-toggle ${open ? 'open' : ''}" data-shelf="${esc(company)}">
          ${open ? '收起' : '显示全部'}<svg viewBox="0 0 12 12" width="9" height="9"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M3 4.5L6 7.5l3-3"/></svg>
        </button>` : ''}
      </div>
      <div class="${open ? 'grid shelf-grid' : 'shelf-row'}">${list.sort(byDateDesc).map(cardHTML).join('')}</div>
    </section>`;
  }).join('');
}

// ---------- 已看切换（纯前端：只写 localStorage，首次使用弹提示） ----------
function setWatched(id, val) {
  const i = all.find(x => x.id === Number(id));
  if (!i || i.watched === val) return;
  i.watched = val;
  watchedLS[id] = val;
  localStorage.setItem('watchedOverride', JSON.stringify(watchedLS));
  watchedNotice();
  renderPersons();
  render();
  if (reader.id === Number(id)) { reader.item.watched = val; renderReaderControls(); }
}
const toggleWatched = (id) => setWatched(id, all.find(x => x.id === Number(id))?.watched ? 0 : 1);

// 首次标记时提示一次：记录只存在本地浏览器
function watchedNotice() {
  if (localStorage.getItem('watchedNoticeSeen')) return;
  localStorage.setItem('watchedNoticeSeen', '1');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>「已看」记录只保存在这台设备的浏览器里，不会上传。清除浏览器数据或换设备后会重置。</span>
    <button class="toast-ok">知道了</button>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const dismiss = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 350); };
  el.querySelector('.toast-ok').addEventListener('click', dismiss);
  setTimeout(dismiss, 8000);
}

// ---------- 阅读器：文本清洗、分段、说话人识别 ----------
// 全部收敛到 reader-core.js（Node/浏览器共用），这里不再保留副本

// ---------- 阅读器：状态 ----------
const reader = { id: null, item: null, tr: {}, lang: 'zh', chars: 0, saveTimer: 0, raf: false, autoWatched: false, speakers: null, spkHidden: new Set() };
const rposKey = () => `rpos:${reader.id}:${reader.lang}`;

// ---------- 阅读器：打开 / 渲染 ----------
async function openArticle(id, push = true) {
  const i = await fetch(IS_STATIC ? `/api/interviews/${id}.json` : '/api/interviews/' + id).then(r => r.json());
  if (watchedLS[i.id] != null) i.watched = watchedLS[i.id];
  reader.id = Number(id);
  reader.item = i;
  reader.autoWatched = false;
  reader.spkHidden = new Set();
  reader.tr = pickTranscripts(i.transcripts);
  reader.lang = reader.tr[readerLangPref] ? readerLangPref : (reader.tr.zh ? 'zh' : 'en');
  if (push) history.pushState({ reader: reader.id }, '', '/i/' + reader.id + '/');

  renderArticle();
  const el = $('#reader');
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('open'));
  document.body.classList.add('reader-open');
  restorePos();
}

function renderArticle() {
  const i = reader.item;
  const t = reader.tr[reader.lang];

  const { html, chars, speakers } = articleHTML(i, t, reader.lang, readerPrefs);
  reader.chars = chars;
  reader.speakers = speakers;
  // 换语言重渲染后：只保留新稿里仍存在的说话人（中英文稿名字一致时筛选状态得以延续）
  reader.spkHidden = new Set([...reader.spkHidden].filter(s => speakers?.includes(s)));
  $('#r-article').innerHTML = html;
  applySpkFilter();

  $('#r-top-title').textContent = i.title_zh || i.title;
  $('#r-article').style.maxWidth = readerPrefs.width + 'px';
  renderReaderControls();
  $('#r-top').classList.remove('condensed');
  $('#reader').classList.remove('chrome-hidden');
  $('#r-progress-bar').style.transform = 'scaleX(0)';
}

// 说话人筛选：隐藏被关掉的说话人的段落（无标签的开场白/旁白段不受影响）
function applySpkFilter() {
  const bar = $('#r-article .r-spk-bar');
  if (!bar) return;
  bar.querySelectorAll('.spk-chip').forEach(b =>
    b.classList.toggle('on', !reader.spkHidden.has(b.dataset.spkf)));
  $$('#r-article p[data-spk]').forEach(p =>
    p.classList.toggle('spk-hide', reader.spkHidden.has(p.dataset.spk)));
}

function toggleSpeaker(name) {
  if (reader.spkHidden.has(name)) reader.spkHidden.delete(name);
  else {
    reader.spkHidden.add(name);
    // 不允许全部隐藏：只剩最后一个人时点它 = 恢复全部显示
    if (reader.speakers && reader.spkHidden.size >= reader.speakers.length) reader.spkHidden.clear();
  }
  applySpkFilter();
}

// 语言切换 / 已看 / Aa 三组控件，同步渲染进顶栏（桌面）和底栏（移动）
function renderReaderControls() {
  const hasBoth = reader.tr.zh && reader.tr.en;
  const seg = hasBoth ? `<div class="seg">
      <button class="seg-btn ${reader.lang === 'zh' ? 'on' : ''}" data-rlang="zh">中文</button>
      <button class="seg-btn ${reader.lang === 'en' ? 'on' : ''}" data-rlang="en">原文</button>
    </div>` : '';
  const w = reader.item?.watched;
  const watch = `<button class="rc-btn ${w ? 'done' : ''}" data-rwatch>${w ? '✓ 已看' : '标记已看'}</button>`;
  const aa = `<button class="rc-btn rc-aa" data-raa aria-label="阅读设置">Aa</button>`;
  $('#r-controls-top').innerHTML = seg + watch + aa;
  $('#r-controls-bottom').innerHTML = `${seg || '<span></span>'}<span class="r-remain"></span>${watch}${aa}`;
}

// ---------- 阅读器：关闭 & 历史栈 ----------
function closeReader(fromPop = false) {
  const el = $('#reader');
  if (el.hidden || reader.id == null) return;
  savePos();
  hideAa();
  el.classList.remove('open');
  document.body.classList.remove('reader-open');
  reader.id = null;
  setTimeout(() => { if (reader.id == null) { el.hidden = true; $('#r-article').innerHTML = ''; } }, 300);
  if (!fromPop && history.state?.reader) history.back();
}

window.addEventListener('popstate', (e) => {
  if (e.state?.reader) openArticle(e.state.reader, false);
  else closeReader(true);
});

// ---------- 阅读器：滚动（进度 / 顶栏坍缩 / chrome 隐藏 / 自动已看） ----------
const rScroll = $('#r-scroll');
let rLastY = 0, rAcc = 0;

rScroll.addEventListener('scroll', () => {
  if (!reader.raf) { reader.raf = true; requestAnimationFrame(readerScrollTick); }
}, { passive: true });

function readerScrollTick() {
  reader.raf = false;
  if (reader.id == null) return;
  const y = rScroll.scrollTop;
  const max = rScroll.scrollHeight - rScroll.clientHeight;
  const prog = max > 0 ? Math.min(1, y / max) : 1;

  $('#r-progress-bar').style.transform = `scaleX(${prog})`;
  $('#r-top').classList.toggle('condensed', y > 130);

  const remain = (reader.chars && prog < 0.99) ? `剩余 ${readMinutes(reader.chars * (1 - prog), reader.lang)} 分钟` : '';
  $$('.r-remain').forEach(el => el.textContent = remain);

  // 下滑隐藏 chrome，上滑立即召回；顶部强制显示。累计 24px 才切换，防抖
  const dy = y - rLastY; rLastY = y;
  if (y < 64) { rAcc = 0; $('#reader').classList.remove('chrome-hidden'); }
  else if (dy) {
    rAcc = (dy > 0) === (rAcc > 0) ? rAcc + dy : dy;
    if (rAcc > 24) $('#reader').classList.add('chrome-hidden');
    else if (rAcc < -24) $('#reader').classList.remove('chrome-hidden');
  }

  clearTimeout(reader.saveTimer);
  reader.saveTimer = setTimeout(savePos, 500);

  if (prog > 0.98 && reader.chars && !reader.item.watched && !reader.autoWatched) {
    reader.autoWatched = true;
    setWatched(reader.id, 1);
  }
}

// ---------- 阅读器：记住阅读位置（段落锚点，字号/换语言不失效） ----------
function savePos() {
  if (reader.id == null) return;
  if (rScroll.scrollTop < 200) { try { localStorage.removeItem(rposKey()); } catch {} return; }
  const readLine = rScroll.getBoundingClientRect().top + 76;
  let anchor = null;
  for (const p of $('#r-article').querySelectorAll('p[data-pi]')) {
    const r = p.getBoundingClientRect();
    if (r.bottom > readLine) { anchor = { i: +p.dataset.pi, off: (readLine - r.top) / Math.max(r.height, 1) }; break; }
  }
  if (!anchor) return;
  try {
    localStorage.setItem(rposKey(), JSON.stringify({ anchor, ratio: rScroll.scrollTop / rScroll.scrollHeight, ts: Date.now() }));
  } catch {}
}

function restorePos() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(rposKey()) || 'null'); } catch {}
  rScroll.scrollTop = 0;
  rLastY = 0;
  if (!saved?.anchor) return;
  // 双 rAF 等首帧布局完成后再按锚段定位；直接跳转不做动画
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const p = $('#r-article').querySelector(`p[data-pi="${saved.anchor.i}"]`);
    if (p) {
      p.scrollIntoView();
      rScroll.scrollTop += p.getBoundingClientRect().height * saved.anchor.off - 76;
    } else {
      rScroll.scrollTop = saved.ratio * rScroll.scrollHeight;
    }
    rLastY = rScroll.scrollTop;
  }));
}

document.addEventListener('visibilitychange', () => { if (document.hidden) savePos(); });
window.addEventListener('pagehide', savePos);

// ---------- 阅读器：Aa 设置面板 ----------
function showAa() {
  $('#aa-panel').innerHTML = `
    <div class="aa-row">
      <button class="aa-step" data-asize="-1">A−</button>
      <span class="aa-size-now">${readerPrefs.size}</span>
      <button class="aa-step" data-asize="1">A+</button>
    </div>
    <div class="aa-row seg">
      <button class="seg-btn ${readerPrefs.font !== 'sans' ? 'on' : ''}" data-afont="serif">衬线</button>
      <button class="seg-btn ${readerPrefs.font === 'sans' ? 'on' : ''}" data-afont="sans">黑体</button>
    </div>
    <div class="aa-row seg">
      ${WIDTH_STEPS.map(s => `<button class="seg-btn ${readerPrefs.width === s.w ? 'on' : ''}" data-awidth="${s.w}">${s.label}</button>`).join('')}
    </div>`;
  $('#aa-panel').hidden = false;
  $('#aa-backdrop').hidden = false;
}
function hideAa() { $('#aa-panel').hidden = true; $('#aa-backdrop').hidden = true; }

function applyPrefs() {
  localStorage.setItem('readerPrefs', JSON.stringify(readerPrefs));
  const body = $('#r-body');
  if (body) {
    body.style.fontSize = readerPrefs.size + 'px';
    body.classList.toggle('sans', readerPrefs.font === 'sans');
  }
  $('#r-article').style.maxWidth = readerPrefs.width + 'px';
}

// ---------- 阅读器：事件 ----------
$('#r-back').addEventListener('click', () => closeReader());
$('#aa-backdrop').addEventListener('click', hideAa);
// 点击坍缩后的顶栏标题 = 回到顶部（iOS 惯例）
$('#r-top-title').addEventListener('click', () => { rScroll.scrollTo({ top: 0, behavior: 'smooth' }); });

$('#reader').addEventListener('click', (e) => {
  const langBtn = e.target.closest('[data-rlang]');
  if (langBtn && langBtn.dataset.rlang !== reader.lang) {
    savePos();
    reader.lang = langBtn.dataset.rlang;
    readerLangPref = reader.lang;
    localStorage.setItem('readerLang', readerLangPref);
    renderArticle();
    restorePos();
    return;
  }
  if (e.target.closest('[data-rwatch]')) { toggleWatched(reader.id); return; }
  const spkChip = e.target.closest('[data-spkf]');
  if (spkChip) { toggleSpeaker(spkChip.dataset.spkf); return; }
  if (e.target.closest('[data-raa]')) { $('#aa-panel').hidden ? showAa() : hideAa(); return; }
  const sizeBtn = e.target.closest('[data-asize]');
  if (sizeBtn) {
    const idx = SIZE_STEPS.indexOf(readerPrefs.size);
    const next = SIZE_STEPS[Math.min(SIZE_STEPS.length - 1, Math.max(0, (idx === -1 ? 4 : idx) + Number(sizeBtn.dataset.asize)))];
    readerPrefs.size = next;
    applyPrefs();
    $('#aa-panel .aa-size-now').textContent = next;
    return;
  }
  const fontBtn = e.target.closest('[data-afont]');
  if (fontBtn) {
    readerPrefs.font = fontBtn.dataset.afont;
    applyPrefs();
    showAa();
    return;
  }
  const widthBtn = e.target.closest('[data-awidth]');
  if (widthBtn) {
    readerPrefs.width = Number(widthBtn.dataset.awidth);
    applyPrefs();
    showAa();
    return;
  }
  const tag = e.target.closest('.tag');
  if (tag) {
    state.tag = tag.dataset.tag;
    state.person = '';
    closeReader();
    renderPersons();
    render();
  }
});

// ---------- 全局事件 ----------
$('#chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  if (chip.dataset.view) {
    if (homeView === chip.dataset.view) return;
    homeView = chip.dataset.view;
    localStorage.setItem('homeView', homeView);
    syncViewChips();
  } else if (chip.dataset.toggle) {
    chip.classList.toggle('active');
    state[chip.dataset.toggle === 'hastext' ? 'hastext' : chip.dataset.toggle] = chip.classList.contains('active');
  } else {
    $$('.chip[data-media]').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.media = chip.dataset.media;
  }
  render();
});

function syncViewChips() {
  $$('.chip[data-view]').forEach(c => c.classList.toggle('active', c.dataset.view === homeView));
}
syncViewChips();

$('#persons-row').addEventListener('click', (e) => {
  const pc = e.target.closest('.person-chip');
  if (!pc) return;
  state.person = state.person === pc.dataset.person ? '' : pc.dataset.person;
  state.tag = '';
  renderPersons();
  render();
});

let timer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(timer);
  timer = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); render(); }, 200);
});

$('#shelves').addEventListener('click', (e) => {
  const toggle = e.target.closest('.shelf-toggle');
  if (toggle) {
    const c = toggle.dataset.shelf;
    expanded.has(c) ? expanded.delete(c) : expanded.add(c);
    localStorage.setItem('expandedShelves', JSON.stringify([...expanded]));
    render();
    return;
  }
  const eye = e.target.closest('.eye');
  if (eye) { e.stopPropagation(); toggleWatched(eye.dataset.eye); return; }
  const card = e.target.closest('.card');
  if (card) openArticle(card.dataset.id);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#aa-panel').hidden) hideAa();
  else closeReader();
});

loadAll().then(() => {
  // 直接访问 /i/123/（分享/刷新/搜索引擎着陆）或旧版 hash 链接 #/i/123 时进入阅读页；
  // 旧 hash 统一归一化为真实路径。先垫一层首页历史，让「返回」能回到列表而不是退出站点。
  const m = location.pathname.match(/^\/i\/(\d+)\/?$/) || location.hash.match(/^#\/i\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    history.replaceState(null, '', '/');
    history.pushState({ reader: id }, '', '/i/' + id + '/');
    openArticle(id, false);
  }
});
