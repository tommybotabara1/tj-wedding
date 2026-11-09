/* Sending, and the "Sent from this phone" list.

   Each file goes straight to the couple's Google Drive through the Worker, in
   8 MB pieces; a piece that fails is retried, and the file resumes from wherever
   Drive got to. One file at a time: a reception's mobile signal shared by a
   hundred phones does better with one steady upload than several fighting.

   Alongside the pieces the phone makes a small copy (shrink.js) and sends it to
   /copy. That is best-effort: if it can't be made or sent, the original still
   goes and the Worker falls back to Drive's own thumbnail. */

import { call } from './lib/api.js';
import { loadSent, saveSent, upsertSent, markRemoved } from './lib/sent.js';
import { makeSmallCopy } from './lib/shrink.js';

const CHUNK = 8 * 1024 * 1024; // a multiple of 256 KB, as Drive requires
const MAX_COPY = 1.5 * 1024 * 1024; // the Worker refuses a bigger small copy

const MESSAGES = {
  'too-big': 'Too large to send from here (over 4 GB).',
  'not-photo-or-video': 'Only photos and videos can be sent.',
  'bad-size': "This file is empty and can't be sent.",
  'not-configured': "Sending isn't open yet. Try again on the day.",
  'drive-refused': "We can't take more right now. Please tell the coordinator!",
  'password': 'Please reload this page and type the password again.',
};

const ICON_VIDEO = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6.5" width="12.5" height="11" rx="2"/><path d="m15.5 10.5 5-3v9l-5-3z"/></svg>';
const ICON_PHOTO = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 4.5-4.5 3.5 3.5 2.5-2.5 5 4.5"/></svg>';

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Some phones leave file.type empty for videos; go by the extension then.
function typeOf(file) {
  if (file.type) return file.type;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return {
    mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/x-m4v', '3gp': 'video/3gpp', webm: 'video/webm',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif',
    webp: 'image/webp', gif: 'image/gif',
  }[ext] || '';
}

function mb(n) {
  return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(n < 104857600 ? 1 : 0) + ' MB';
}

/* env: {base, storage, list, section, tally, announce, getPassword(), getGuest(),
         device, titleOf(momentId)} */
export function createUploader(env) {
  const { base, storage, list } = env;
  let items = loadSent(storage); // SentItem[], newest first
  const runtime = new Map();     // local id → {file, next, session, ...} for items sent in this visit
  const queue = [];
  let running = false;
  let sentCount = 0;
  let lock = null;
  let seq = 0;

  const rt = (it) => runtime.get(it.local);
  const find = (local) => items.find((x) => x.local === local);
  const persist = () => saveSent(storage, items);
  const say = (t) => { env.announce.textContent = ''; setTimeout(() => { env.announce.textContent = t; }, 30); };

  /* ---------- the list ---------- */

  function setItem(it, patch) {
    const next = { ...it, ...patch };
    items = upsertSent(items, next);
    return next;
  }

  function lineFor(it) {
    const r = rt(it);
    switch (it.state) {
      case 'sending': return r && r.text ? r.text : 'Sending…';
      case 'sent': return 'Sent ✓';
      case 'removed': return 'Removed';
      default: return (r && r.why) || "This one didn't finish. Pick it again to send.";
    }
  }

  function render(it) {
    let li = list.querySelector('[data-local="' + it.local + '"]');
    if (!li) {
      li = document.createElement('li');
      li.className = 'item';
      li.setAttribute('data-local', it.local);
      li.tabIndex = -1;
      li.innerHTML = '<span class="thumb"></span><span class="what"><span class="nm"></span>' +
        '<span class="st"></span><span class="in"></span><span class="bar"><i></i></span></span><span class="act"></span>';
      // keep the list newest first
      const at = items.findIndex((x) => x.local === it.local);
      const after = items.slice(at + 1).map((x) => list.querySelector('[data-local="' + x.local + '"]')).find(Boolean);
      list.insertBefore(li, after || null);
    }
    const r = rt(it);
    const state = it.state === 'sent' ? 'done' : it.state === 'sending' && r && r.waiting ? 'waiting' : it.state;
    li.setAttribute('data-state', state);
    li.querySelector('.nm').textContent = (it.kind === 'video' ? 'Video' : 'Photo') + (it.size ? ' · ' + mb(it.size) : '');
    li.querySelector('.st').textContent = lineFor(it);
    const inEl = li.querySelector('.in');
    inEl.textContent = it.state === 'sent' && it.moment ? 'In the contest: ' + env.titleOf(it.moment) : '';
    inEl.hidden = !inEl.textContent;
    if (r && r.frac != null) li.querySelector('.bar i').style.width = Math.round(r.frac * 100) + '%';

    const thumb = li.querySelector('.thumb');
    if (it.thumb) {
      if (!thumb.firstChild || thumb.firstChild.tagName !== 'IMG' || thumb.firstChild.src !== it.thumb) {
        thumb.innerHTML = '';
        const img = new Image();
        img.alt = '';
        img.src = it.thumb;
        thumb.appendChild(img);
      }
    } else if (!thumb.firstChild) {
      thumb.innerHTML = it.kind === 'video' ? ICON_VIDEO : ICON_PHOTO;
    }

    renderActions(it, li);
    env.section.hidden = false;
  }

  function button(cls, text, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderActions(it, li) {
    const act = li.querySelector('.act');
    const old = li.querySelector('.ask');
    if (old) old.remove();
    act.innerHTML = '';
    const r = rt(it);
    if (it.state === 'failed' && r && r.retryable) {
      act.appendChild(button('retry', 'Try again', () => {
        const cur = find(it.local);
        r.waiting = true;
        r.why = '';
        r.cancelled = false;
        r.text = 'Waiting…';
        render(setItem(cur, { state: 'sending' }));
        queue.push(cur.local);
        pump();
      }));
    }
    if (it.entry && it.key && it.state !== 'removed') {
      act.appendChild(button('mini', 'Remove', () => ask(it, li)));
    }
  }

  /* The inline Remove confirm. Never confirm(): it is easy to dismiss by
     accident and some in-app browsers block it. */
  function ask(it, li) {
    const act = li.querySelector('.act');
    act.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'ask';
    box.setAttribute('role', 'group');
    const msg = document.createElement('span');
    msg.textContent = 'Remove this? It comes off the screen and out of the contest.';
    const yes = button('mini danger', 'Remove', () => removeItem(it.local, li));
    const keep = button('mini', 'Keep', () => {
      box.remove();
      renderActions(find(it.local), li);
      const again = li.querySelector('.act .mini');
      if (again) again.focus();
    });
    box.append(msg, yes, keep);
    li.appendChild(box);
    keep.focus();
  }

  /* ---------- removing ---------- */

  function removeItem(local, li) {
    const it = find(local);
    if (!it) return;
    const r = rt(it);
    if (r) {
      r.cancelled = true;                       // stop sending: the loop checks this
      if (r.handle && r.handle.abort) r.handle.abort();
      const qi = queue.indexOf(local);
      if (qi >= 0) queue.splice(qi, 1);
    }
    const box0 = li.querySelector('.ask');
    if (box0) box0.querySelector('span').textContent = 'Removing…';
    call(base, 'POST', '/remove', { json: { entry: it.entry, key: it.key }, password: env.getPassword() })
      .then((res) => {
        if (res.ok) {
          items = markRemoved(items, it.entry);
          persist();
          const cur = find(local);
          render(cur);
          li.focus();
          say('Removed.');
        } else {
          // Still on the Worker's side: the upload (if any) was stopped, so let
          // them resume it, and ask again.
          let cur = find(local);
          if (r) {
            r.cancelled = false;
            if (cur.state === 'sending') {
              r.retryable = true;
              r.why = 'Stopped before it finished.';
              cur = setItem(cur, { state: 'failed' });
            }
          }
          render(cur);
          ask(cur, li);
          li.querySelector('.ask span').textContent = "Couldn't remove it. Check your signal and try again. " +
            'Remove this? It comes off the screen and out of the contest.';
        }
      });
  }

  /* ---------- sending ---------- */

  function add(file, momentId) {
    const type = typeOf(file);
    const kind = type.indexOf('video/') === 0 ? 'video' : 'photo';
    const local = 'l' + Date.now().toString(36) + (seq++).toString(36);
    let it = { local, entry: null, key: null, moment: null, kind, thumb: null, at: Date.now(), state: 'sending', size: file.size };
    items = upsertSent(items, it);
    runtime.set(local, { file, type, wantMoment: momentId || '', next: 0, session: null, waiting: true, frac: 0, text: 'Waiting…' });
    persist();
    render(it);
    queue.push(local);
    pump();
  }

  function send(local) {
    const r = runtime.get(local);
    const file = r.file, size = file.size;
    let tries = 0;
    const get = () => find(local);
    const update = (patch, rpatch) => {
      Object.assign(r, rpatch || {});
      const cur = get();
      if (cur) render(setItem(cur, patch || {}));
    };
    r.waiting = false;
    update({}, { text: 'Sending…', frac: r.next / size });

    // The small copy is made while the original goes up.
    if (!r.small) {
      r.small = makeSmallCopy(file, get().kind).then((sc) => {
        if (sc && !r.cancelled) update({ thumb: sc.thumb });
        return sc;
      });
    }
    function sendCopy() {
      const it = get();
      if (r.copyStarted || !it || !it.entry || !it.key) return;
      r.copyStarted = true;
      r.small.then((sc) => {
        if (!sc || r.cancelled || sc.copy.size > MAX_COPY) return null;
        return call(base, 'POST', '/copy', {
          password: env.getPassword(),
          headers: { 'X-Entry': it.entry, 'X-Entry-Key': it.key, 'Content-Type': 'image/jpeg' },
          body: sc.copy,
        });
      }).catch(() => {}); // a missing small copy is fine
    }

    function begin() {
      return call(base, 'POST', '/start', {
        password: env.getPassword(),
        json: { name: file.name, type: r.type, size, guest: env.getGuest(), moment: r.wantMoment, device: env.device },
      }).then((res) => {
        if (!res.ok) return res;
        r.session = res.body.session;
        r.next = 0;
        update({ entry: res.body.entry || null, key: res.body.key || null, moment: res.body.moment || null });
        persist();
        if (r.cancelled) return { ok: false, cancelled: true, body: {} };
        sendCopy();
        return piece();
      });
    }
    function piece() {
      if (r.cancelled) return Promise.resolve({ ok: false, cancelled: true, body: {} });
      const end = Math.min(r.next + CHUNK, size);
      const from = r.next;
      r.handle = {};
      return call(base, 'PUT', '/chunk', {
        password: env.getPassword(),
        handle: r.handle,
        headers: { 'X-Upload-Session': r.session, 'Content-Range': 'bytes ' + from + '-' + (end - 1) + '/' + size },
        body: file.slice(from, end),
        progress: (loaded) => {
          const f = Math.min(1, (from + loaded) / size);
          update({}, { text: 'Sending… ' + Math.floor(f * 100) + '%', frac: f });
        },
      }).then((res) => {
        r.handle = null;
        if (!res.ok) return res;
        tries = 0;
        if (res.body.done) return res;
        r.next = res.body.next;
        return piece();
      });
    }
    function step() {
      if (r.cancelled) return finish('cancelled');
      return (r.session ? piece() : begin()).then((res) => {
        if (r.cancelled) return finish('cancelled');
        if (res.ok) return finish('ok');
        const code = res.body && res.body.error;
        if (MESSAGES[code]) { r.retryable = code === 'not-configured'; return finish('failed', MESSAGES[code]); }
        if (res.status === 410) { r.session = null; r.next = 0; } // Drive closed the session: start over
        if (++tries > 6) { r.retryable = true; return finish('failed', "Didn't send. Check your signal, then tap Try again."); }
        update({}, { text: 'Connection hiccup, retrying…', frac: r.next / size });
        // 1, 2, 4, 8, 16, 30 seconds, then ask Drive how much it already has.
        return wait(Math.min(30000, 1000 * Math.pow(2, tries - 1))).then(() => {
          if (r.cancelled) return finish('cancelled');
          if (!r.session) return step();
          return call(base, 'GET', '/status?size=' + size, { password: env.getPassword(), headers: { 'X-Upload-Session': r.session } }).then((s) => {
            if (s.ok && s.body.done) return finish('ok');
            if (s.ok) r.next = s.body.next;
            else if (s.status === 410) { r.session = null; r.next = 0; }
            return step();
          });
        });
      });
    }
    function finish(how, why) {
      if (how === 'cancelled') return;
      if (how === 'ok') {
        sentCount++;
        update({ state: 'sent' }, { frac: 1 });
        persist();
        env.tally.hidden = false;
        env.tally.textContent = sentCount === 1 ? 'Sent to us. Thank you!' : sentCount + ' sent to us. Thank you!';
        say('Sent.');
      } else {
        update({ state: 'failed' }, { why });
        persist();
        say(why);
      }
    }
    return step();
  }

  function pump() {
    if (running) return;
    const local = queue.shift();
    if (!local) { release(); return; }
    const it = find(local);
    if (!it || it.state === 'removed' || (rt(it) && rt(it).cancelled)) { pump(); return; }
    running = true;
    awake();
    send(local).then(() => { running = false; pump(); });
  }

  // Keep the screen on while something is sending (where the phone allows it).
  function awake() {
    if (lock || !('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then((l) => {
      lock = l;
      l.addEventListener('release', () => { lock = null; });
    }, () => {});
  }
  function release() { if (lock) { lock.release(); lock = null; } }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && running) awake();
  });
  window.addEventListener('beforeunload', (e) => {
    if (running || queue.length) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------- on unlock: bring back what this phone sent before ---------- */

  function restore() {
    // Anything that was mid-send when the page closed can't resume (the file is gone).
    items = items.map((it) => (it.state === 'sending' ? { ...it, state: 'failed' } : it));
    items.slice().reverse().forEach(render);
    env.section.hidden = items.length === 0;
  }

  /* The contest's titles can change what a card says once they load. */
  function refreshTitles() { items.forEach(render); }

  return { add, restore, refreshTitles, isBusy: () => running || queue.length > 0 };
}
