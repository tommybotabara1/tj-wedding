/* The control page. One phone, big buttons. It keeps the last state from
   GET /admin/state, polls it every 5 s while visible, and sends every tap to
   POST /admin/act, which answers with the new state. Views live in runsheet.js
   and everything.js; this file is the password and name gate, polling, taps,
   practice clearing and the frame around the views. */
import { apiBase, call } from '../lib/api.js';
import { esc, btn, clock } from './common.js';
import { renderRunSheet, picksFor } from './runsheet.js';
import { renderEverything } from './everything.js';

const PW_KEY = 'tj-photos-admin';
const OP_KEY = 'tj-photos-operator';
const POLL_MS = 5000;
const BASE = apiBase(location);

const store = {
  get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
};
const $ = (id) => document.getElementById(id);

let admin = store.get(PW_KEY);
let operator = store.get(OP_KEY);
let S = null;          // last good /admin/state
let offline = false;
let busy = false;      // one action at a time, so a double tap can't double up
let seq = 0;           // a poll that started before an action must not overwrite its answer
let gateMsg = '';
let drawn = '';        // signature of what is on screen, to skip identical redraws
let timer = 0;
let noteTimer = 0;

// View state. Everything the screen shows is state + ui, so a redraw loses nothing.
const ui = { tab: 'run', confirm: null, review: null, addFor: null, picks: {}, open: {}, tie: {}, clearing: null, clearFail: false };

const api = (method, path, json) => call(BASE, method, path, { admin, json });

function note(msg) {
  const n = $('note');
  clearTimeout(noteTimer);
  n.textContent = msg;
  n.hidden = !msg;
  if (msg) noteTimer = setTimeout(() => note(''), 7000);
}

/* ---------- talking to the Worker ---------- */

async function refresh() {
  const my = ++seq;
  const r = await api('GET', '/admin/state');
  if (my !== seq) return;
  if (r.status === 403) return lock("That password didn't work.");
  if (r.ok) { S = r.body; offline = false; } else offline = true;
  draw();
}

function lock(msg) {
  admin = '';
  store.del(PW_KEY);
  gateMsg = msg || '';
  S = null;
  draw();
}

async function post(payload) {
  seq++;
  const r = await api('POST', '/admin/act', { ...payload, by: operator });
  if (r.ok) { S = r.body; offline = false; }
  return r;
}

async function exclusive(fn) {
  if (busy) return;
  busy = true;
  document.body.classList.add('busy');
  try { await fn(); } finally { busy = false; document.body.classList.remove('busy'); draw(); }
}

// Says what went wrong in plain words and refreshes, so the phone is never left stale.
async function failed(r) {
  if (r.status === 403) return lock("That password didn't work.");
  if (r.status === 409) note('Someone already did that. Updated.');
  else if (r.status === 0) { note("Couldn't reach the server. Try again."); return; }
  else note("That didn't work. Updated.");
  await refresh();
}

const act = (payload) => exclusive(async () => {
  const r = await post(payload);
  if (r.ok) { ui.confirm = null; note(''); } else await failed(r);
});

// Reveal from closed. A tie, or nobody voting, answers 400 pick-a-winner with the entries to choose from.
const reveal = (moment, winner) => exclusive(async () => {
  const r = await post({ action: 'reveal', moment, ...(winner ? { winner } : {}) });
  if (r.ok) { delete ui.tie[moment]; note(''); return; }
  if (r.status === 400 && r.body && r.body.error === 'pick-a-winner') { ui.tie[moment] = r.body.leaders || []; return; }
  delete ui.tie[moment];
  await failed(r);
});

// Opens each moment that has picks and carries on past the ones that can't open.
// A moment with one entry is awarded directly; one with none gets "No winner".
const openVoting = (ids) => exclusive(async () => {
  const opened = [], direct = [], none = [], unready = [], refused = [];
  for (const id of ids) {
    const m = S.moments.find((x) => x.id === id);
    if (!m || m.phase !== 'entries') continue;
    const picks = picksFor(ui, m);
    if (!picks.length) { (m.entryCount === 0 ? none : m.entryCount === 1 ? direct : unready).push(m.title); continue; }
    const r = await post({ action: 'open-voting', moment: id, shortlist: picks });
    if (r.ok) { opened.push(m.title); delete ui.picks[id]; continue; }
    if (r.status === 0 || r.status === 403) { await failed(r); return; }
    refused.push(m.title);
  }
  if (ids.length > 1 || ui.review !== 'all') ui.review = null;
  ui.addFor = null;
  const bits = [];
  if (opened.length) bits.push('Voting open for ' + opened.length + (opened.length === 1 ? ' moment.' : ' moments.'));
  if (direct.length) bits.push('Award directly: ' + direct.join(', ') + '.');
  if (none.length) bits.push('No entries: ' + none.join(', ') + '.');
  if (unready.length) bits.push('Needs picks: ' + unready.join(', ') + '.');
  if (refused.length) { bits.push('Someone already changed: ' + refused.join(', ') + '.'); await refresh(); }
  note(bits.join(' '));
});

// Clearing runs in passes. Keep going while the count drops; stop if it stalls.
const clearPractice = () => exclusive(async () => {
  ui.confirm = null;
  ui.clearFail = false;
  let prev = Infinity;
  for (;;) {
    ui.clearing = prev === Infinity ? '' : prev;
    draw();
    const r = await post({ action: 'practice-clear' });
    if (!r.ok) { ui.clearing = null; await failed(r); return; }
    const left = r.body.clearing && r.body.clearing.remaining;
    if (!left) { ui.clearing = null; note('Practice cleared.'); return; }
    if (left >= prev) { ui.clearing = null; ui.clearFail = true; return; }
    prev = left;
  }
});

/* ---------- taps ---------- */

const HANDLERS = {
  tab: (a) => { ui.tab = a; },
  act: (a) => act(JSON.parse(a)),
  reveal: (a) => reveal(a),
  win: (a) => { const [m, w] = a.split('|'); return reveal(m, w); },
  review: (a) => { ui.review = a || null; ui.addFor = null; if (a === 'all') ui.tab = 'run'; },
  'open-all-review': () => { ui.review = 'all'; ui.tab = 'run'; },
  'rv-adding': (a) => { ui.addFor = a || null; },
  'rv-del': (a) => { const [m, id] = a.split('|'); ui.picks[m] = (ui.picks[m] || []).filter((x) => x !== id); },
  'rv-add': (a) => { const [m, id] = a.split('|'); const p = ui.picks[m] || []; if (p.length < 5 && !p.includes(id)) p.push(id); ui.picks[m] = p; if (p.length >= 5) ui.addFor = null; },
  'open-one': (a) => openVoting([a]),
  'open-all': (a) => openVoting(a.split(',')),
  'close-all': () => exclusive(async () => {
    for (const m of S.moments.filter((x) => x.phase === 'voting')) {
      const r = await post({ action: 'close-voting', moment: m.id });
      if (!r.ok) { await failed(r); return; }
    }
  }),
  expand: (a) => { const m = S.moments.find((x) => x.id === a); const cur = ui.open[a] != null ? ui.open[a] : m === S.moments.find((x) => x.phase !== 'revealed'); ui.open[a] = !cur; },
  confirm: (a) => { ui.confirm = a || null; },
  'clear-practice': clearPractice,
  name: () => { operator = ''; drawn = ''; },
};

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-do]');
  if (!b || b.disabled || busy && b.dataset.do !== 'tab') return;
  const h = HANDLERS[b.dataset.do];
  if (!h) return;
  h(b.dataset.arg);
  draw();
});

/* ---------- drawing ---------- */

function gate() {
  const needPw = !admin;
  $('app').innerHTML = '<form class="gate" id="gate"><h1>Photo contest control</h1>' +
    (gateMsg ? '<p class="err" role="alert">' + esc(gateMsg) + '</p>' : '') +
    (needPw ? '<label for="pw">Control password</label><input id="pw" type="password" autocomplete="current-password" autocapitalize="off" required>' : '') +
    (!operator ? '<label for="op">Who\'s running this phone?</label><input id="op" type="text" maxlength="30" autocomplete="given-name" value="" required placeholder="Your name">' : '') +
    '<button class="btn primary" type="submit">Continue</button></form>';
  const first = $('pw') || $('op');
  if (first) first.focus();
  $('gate').onsubmit = (ev) => {
    ev.preventDefault();
    const pw = $('pw') && $('pw').value.trim();
    const op = $('op') && $('op').value.trim();
    if (needPw && pw) { admin = pw; store.set(PW_KEY, pw); }
    if (!operator && op) { operator = op; store.set(OP_KEY, op); }
    gateMsg = '';
    drawn = '';
    if (admin && operator) { S = null; draw(); refresh(); schedule(); } else draw();
  };
}

function banner(s) {
  if (!s.settings.practice) return '';
  let inner;
  if (ui.clearing !== null) inner = '<span>Clearing practice…' + (ui.clearing ? ' ' + ui.clearing + ' left' : '') + '</span>';
  else if (ui.confirm === 'clear') inner = '<span>Clear all practice photos, votes and results?</span><span class="btns">' +
    btn('Clear practice', { do: 'clear-practice', kind: 'dark' }) + btn('Cancel', { do: 'confirm', arg: '', kind: 'darkline', k: 'clr-no' }) + '</span>';
  else inner = (ui.clearFail ? '<span>Some practice photos couldn\'t be binned. Tap Clear practice again in a minute.</span>' : '') +
    btn('Clear practice', { do: 'confirm', arg: 'clear', kind: 'dark', k: 'clr' });
  return '<div class="practice" role="status"><b>Practice: nothing here is real. Clear practice when you\'re done.</b>' + inner + '</div>';
}

function frame(s) {
  const last = s.log[0];
  const tabs = [['run', 'Run sheet'], ['all', 'Everything']].map(([id, l]) =>
    '<button type="button" role="tab" class="tab" data-do="tab" data-arg="' + id + '" data-k="tab:' + id + '" aria-selected="' + (ui.tab === id) + '">' + l + '</button>').join('');
  const top = '<div id="top">' + banner(s) + '<div class="bar"><span class="me">Running: <b>' + esc(operator) + '</b></span>' +
    '<button type="button" class="link" data-do="name" data-k="name">Change</button></div>' +
    '<div class="tabs" role="tablist">' + tabs + '</div>' +
    (offline ? '<p class="off" role="status">Can\'t reach the server. Showing the last update.</p>' : '') +
    '</div>';
  const lastLine = last ? '<p class="last">Last: ' + esc(last.by) + ' · ' + esc(last.what) + ' · ' + esc(clock(last.at)) + '</p>' : '';
  const view = ui.tab === 'run' ? renderRunSheet(s, ui) : renderEverything(s, ui, Date.now());
  return top + '<main role="tabpanel">' + lastLine + view + '</main>';
}

function draw() {
  if (!admin || !operator) { drawn = ''; gate(); return; }
  if (!S) { $('app').innerHTML = '<p class="loading">Loading…</p>'; drawn = ''; return; }
  // Signed photo links change on every poll; leave them out so an unchanged screen isn't redrawn.
  const sig = JSON.stringify([S, ui, offline, operator, Math.floor(Date.now() / 60000)], (k, v) => (k === 'copy' || k === 'orig') ? undefined : v);
  if (sig === drawn) return;
  drawn = sig;
  const was = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.k;
  $('app').innerHTML = frame(S);
  if (was) { const n = $('app').querySelector('[data-k="' + CSS.escape(was) + '"]'); if (n && !n.disabled) n.focus({ preventScroll: true }); }
}

/* ---------- polling ---------- */

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!document.hidden && admin && operator && !busy) await refresh();
    schedule();
  }, POLL_MS);
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && admin && operator && !busy) { refresh(); schedule(); }
});

draw();
if (admin && operator) refresh();
schedule();
