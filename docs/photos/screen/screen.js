/* The big screen: wall, a moment's shortlist, or its winner. Polls GET /screen
   every 5 s, keeps the last good state when the network drops, and preloads
   photos before swapping them in. */
import { apiBase, norm, call, mediaUrl } from '../lib/api.js';

const PW_KEY = 'tj-photos-pw';
const POLL_MS = 5000;
const ROTATE_MS = 8000;
const FEATURED = 12;
const GRID = 12;
const BASE = apiBase(location);

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const store = {
  get() { try { return localStorage.getItem(PW_KEY) || ''; } catch (e) { return ''; } },
  set(v) { try { localStorage.setItem(PW_KEY, v); } catch (e) { /* private mode */ } },
  del() { try { localStorage.removeItem(PW_KEY); } catch (e) { /* ignore */ } },
};

let password = store.get();
let failures = 0;
let state = null;       // last good /screen body
let shownKey = '';      // what the stage is showing
let rotateIdx = 0;
let rotateTimer = 0;
let pollTimer = 0;
let polling = false;

/* ---------- scale the 1920x1080 stage to the window ---------- */
function fit() {
  stage.style.setProperty('--s', Math.min(innerWidth / 1920, innerHeight / 1080));
}
addEventListener('resize', fit);
fit();

/* ---------- small DOM helpers ---------- */
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function qrBox(cls) {
  const d = el('div', cls);
  const i = document.createElement('img');
  i.src = 'qr.svg';
  i.alt = 'QR code for tomyjeyan.com/photos';
  d.appendChild(i);
  return d;
}
const src = (u) => mediaUrl(BASE, u);

function tile(item, opts) {
  opts = opts || {};
  const t = el('figure', 'tile');
  if (opts.video && item.kind === 'video') {
    const v = document.createElement('video');
    v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
    v.setAttribute('muted', '');
    v.poster = src(item.copy);
    v.src = src(item.orig);
    t.appendChild(v);
    v.play().catch(() => {});
  } else {
    const i = document.createElement('img');
    i.src = src(item.copy);
    i.alt = '';
    t.appendChild(i);
    if (item.kind === 'video') t.appendChild(el('span', 'play'));
  }
  if (item.n && !opts.video) t.appendChild(el('span', 'num', String(item.n)));
  if (opts.caption !== false) {
    const c = el('figcaption', 'cap', item.guest || '');
    if (item.moment) c.appendChild(el('small', '', item.moment));
    t.appendChild(c);
  }
  return t;
}

/* Wait for every image, but never hold the screen hostage to a slow one. */
function preload(urls) {
  return Promise.all(urls.map((u) => new Promise((res) => {
    const i = new Image();
    i.onload = i.onerror = () => res();
    setTimeout(res, 8000);
    i.src = u;
  })));
}

/* ---------- renderers ---------- */
function renderWall() {
  const items = state.wall || [];
  const root = el('section', 'mode');
  root.id = 'wall';
  if (!items.length) {
    root.appendChild(el('p', 'empty', 'Photos from tonight will appear here'));
  } else {
    const feat = items.slice(0, FEATURED);
    rotateIdx = rotateIdx % feat.length;
    const f = tile(feat[rotateIdx]);
    f.classList.add('feature');
    root.appendChild(f);
    const grid = el('div', 'grid');
    items.filter((x) => x.id !== feat[rotateIdx].id).slice(0, GRID).forEach((x) => grid.appendChild(tile(x)));
    root.appendChild(grid);
  }
  const corner = el('div', 'corner');
  corner.appendChild(qrBox('qr'));
  const txt = el('div');
  txt.appendChild(el('p', 'tag', '#SoaringWithTJ'));
  txt.appendChild(el('p', 'share', 'Share yours at tomyjeyan.com/photos'));
  corner.appendChild(txt);
  root.appendChild(corner);
  return root;
}

function renderShortlist() {
  const m = state.moment;
  const root = el('section', 'mode');
  root.id = 'shortlist';
  const head = el('div', 'head');
  head.appendChild(el('p', 'kicker', 'Vote for your favourite'));
  head.appendChild(el('h1', 'big', m.title));
  root.appendChild(head);
  const row = el('div', 'row');
  m.shortlist.forEach((x) => row.appendChild(tile(x)));
  root.appendChild(row);
  const foot = el('div', 'foot');
  foot.appendChild(qrBox('qr'));
  const txt = el('div');
  txt.appendChild(el('p', 'vote', 'Vote now at tomyjeyan.com/photos'));
  txt.appendChild(el('p', 'count', m.votes === 1 ? '1 vote so far' : m.votes + ' votes so far'));
  foot.appendChild(txt);
  root.appendChild(foot);
  return root;
}

function renderWinner() {
  const m = state.moment;
  const root = el('section', 'mode');
  root.id = 'winner';
  const head = el('div', 'head');
  head.appendChild(el('h1', 'big', 'Winner · ' + m.title));
  root.appendChild(head);
  if (m.winner) {
    root.appendChild(tile(m.winner, { video: true, caption: false }));
    root.appendChild(el('p', 'name', m.winner.guest || ''));
  } else {
    root.appendChild(el('p', 'none', 'No entries for this one.'));
  }
  return root;
}

/* Shortlist and winner need a moment; without one the screen falls back to the wall. */
function modeOf(s) {
  return (s.mode === 'shortlist' || s.mode === 'winner') && s.moment ? s.mode : 'wall';
}

/* What must change for the stage to differ. Signed URLs are left out, so a
   fresh signature alone never redraws the screen. */
function keyOf(s) {
  const m = s.moment;
  const mode = modeOf(s);
  if (mode === 'shortlist') return ['s', m.id, m.votes, m.shortlist.map((x) => x.id).join(',')].join('|');
  if (mode === 'winner') return ['w', m.id, m.winner ? m.winner.id : 'none'].join('|');
  return ['a', (s.wall || []).map((x) => x.id).join(',')].join('|');
}

function urlsOf(s) {
  const m = s.moment;
  const mode = modeOf(s);
  if (mode === 'shortlist') return m.shortlist.map((x) => x.copy);
  if (mode === 'winner') return m.winner ? [m.winner.copy] : [];
  return (s.wall || []).slice(0, FEATURED + GRID).map((x) => x.copy);
}

let drawing = 0;
let drawingKey = ''; // the key being preloaded right now, if any
async function draw() {
  const s = state;
  if (!s) return;
  const mode = modeOf(s);
  const key = keyOf(s) + (mode === 'wall' ? '#' + rotateIdx : '');
  if (key === shownKey) { drawing++; drawingKey = ''; return; } // what's up is already right: drop any older draw
  // The same draw is already loading. Starting it again would cancel it every
  // poll, and a slow photo would then keep the screen from ever changing.
  if (key === drawingKey) return;
  const ticket = ++drawing;
  drawingKey = key;
  await preload(urlsOf(s).map(src));
  if (ticket !== drawing) return;
  drawingKey = '';
  const node = mode === 'shortlist' ? renderShortlist() : mode === 'winner' ? renderWinner() : renderWall();
  stage.replaceChildren(node);
  shownKey = key;
  startRotation(mode);
}

function startRotation(mode) {
  clearInterval(rotateTimer);
  if (mode !== 'wall') return;
  rotateTimer = setInterval(() => {
    const n = Math.min(FEATURED, state && state.wall ? state.wall.length : 0);
    if (n < 2) return;
    rotateIdx = (rotateIdx + 1) % n;
    draw();
  }, ROTATE_MS);
}

/* ---------- polling ---------- */
function showGate(msg) {
  clearTimeout(pollTimer);
  $('gate').hidden = false;
  $('gateMsg').textContent = msg || '';
  $('pw').focus();
}

async function poll() {
  if (polling) return;
  polling = true;
  const r = await call(BASE, 'GET', '/screen', { password, timeout: 8000 });
  polling = false;
  if (r.status === 403) {
    store.del();
    password = '';
    failures = 0;
    $('note').hidden = true;
    showGate('That password does not match.');
    return;
  }
  if (r.ok && r.body && r.body.mode) {
    failures = 0;
    $('note').hidden = true;
    state = r.body;
    draw();
  } else if (++failures >= 3) {
    $('note').hidden = false;
  }
  pollTimer = setTimeout(poll, POLL_MS);
}

$('gateForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = norm($('pw').value);
  if (!v) return;
  password = v;
  store.set(v);
  $('pw').value = '';
  $('gate').hidden = true;
  $('gateMsg').textContent = '';
  poll();
});

/* ---------- full screen and wake lock ---------- */
let lock = null;
async function keepAwake() {
  try {
    if (navigator.wakeLock && !lock) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    }
  } catch (e) { lock = null; }
}
function syncFs() {
  $('fs').hidden = !!document.fullscreenElement || !document.documentElement.requestFullscreen;
}
$('fs').addEventListener('click', async () => {
  try { await document.documentElement.requestFullscreen(); } catch (e) { /* refused */ }
  keepAwake();
});
document.addEventListener('fullscreenchange', syncFs);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
syncFs();
keepAwake();

if (password) poll(); else showGate('');
