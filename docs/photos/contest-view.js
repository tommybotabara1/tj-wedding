/* The contest on the page: the six moment cards, the Vote section and the
   full-screen viewer, all built from the Worker's GET /contest and refreshed by
   polling (60 s, or 20 s while any moment is being voted on, and only while the
   page is visible). */

import { call, mediaUrl } from './lib/api.js';
import { momentLabel, pollDelay } from './lib/contest-ui.js';

const ICON_PLAY = '<svg class="play" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';

/* env: {base, section, momentsEl, voteSection, voteBody, viewer, viewerTitle, viewerStage,
         viewerVote, viewerClose, getPassword(), getGuest(), device, onPick(file, momentId),
         needName(), onData()} */
export function createContest(env) {
  let data = null;          // the last /contest answer
  let driveOpen = true;     // false while /ping says the Worker can't reach Drive
  let timer = null;
  let loading = false;
  let started = false;
  let voteKey = '';
  const cards = new Map();  // moment id → {li, state, btn, input}
  const status = new Map(); // moment id → the line under its thumbnails
  let viewing = null;       // {moment, item, n}

  const moments = () => (data ? data.moments : []);
  const titleOf = (id) => {
    const m = moments().find((x) => x.id === id);
    return m ? m.title : 'a moment';
  };

  /* ---------- the six cards ---------- */

  function buildCard(m) {
    const li = document.createElement('li');
    li.className = 'moment';
    li.setAttribute('data-id', m.id);
    const inputId = 'moment-' + m.id;
    li.innerHTML = '<div class="mhead"><h3 class="mt"></h3><span class="mstate"></span></div><p class="mhint"></p>' +
      '<input class="pick" type="file" accept="image/*,video/*" id="' + inputId + '" />' +
      '<label class="btn" for="' + inputId + '">Send a shot for this moment</label>';
    li.querySelector('.mt').textContent = m.title;
    li.querySelector('.mhint').textContent = m.hint;
    const input = li.querySelector('input');
    // No name, no picker: a win needs a name on it.
    input.addEventListener('click', (e) => {
      if (!env.getGuest()) { e.preventDefault(); env.needName(); }
    });
    input.addEventListener('change', () => {
      Array.prototype.slice.call(input.files || []).forEach((f) => env.onPick(f, m.id));
      input.value = ''; // so the same photo can be picked again
    });
    return { li, state: li.querySelector('.mstate'), label: li.querySelector('label'), input };
  }

  function renderCards() {
    const ids = moments().map((m) => m.id).join();
    if (ids !== env.momentsEl.getAttribute('data-ids')) {
      env.momentsEl.innerHTML = '';
      cards.clear();
      moments().forEach((m) => {
        const c = buildCard(m);
        cards.set(m.id, c);
        env.momentsEl.appendChild(c.li);
      });
      env.momentsEl.setAttribute('data-ids', ids);
    }
    moments().forEach((m) => {
      const c = cards.get(m.id);
      const can = !!m.accepting && driveOpen;
      c.state.textContent = momentLabel(m, data.open);
      c.li.setAttribute('data-phase', m.phase);
      c.li.setAttribute('data-open', can ? 'yes' : 'no');
      c.input.disabled = !can;
      c.label.classList.toggle('closed', !can);
    });
    env.section.hidden = moments().length === 0;
  }

  /* ---------- voting ---------- */

  function thumbFor(m, it) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'vthumb';
    b.setAttribute('data-entry', it.id);
    b.setAttribute('aria-pressed', m.myVote === it.id ? 'true' : 'false');
    b.setAttribute('aria-label', (it.kind === 'video' ? 'Video' : 'Photo') + ' number ' + it.n + (m.myVote === it.id ? ', your vote' : ''));
    const img = new Image();
    img.alt = '';
    img.src = mediaUrl(env.base, it.copy);
    img.onerror = () => img.remove(); // the number is still there to tap
    const num = document.createElement('span');
    num.className = 'num';
    num.setAttribute('aria-hidden', 'true');
    num.textContent = it.n;
    b.append(img, num);
    if (it.kind === 'video') b.insertAdjacentHTML('beforeend', ICON_PLAY);
    b.addEventListener('click', () => openViewer(m.id, it));
    li.appendChild(b);
    return li;
  }

  function renderVote() {
    const voting = moments().filter((m) => m.phase === 'voting' && m.shortlist && m.shortlist.length);
    const key = JSON.stringify(voting.map((m) => [m.id, m.myVote, m.shortlist.map((x) => x.id)]));
    env.voteSection.hidden = voting.length === 0;
    if (key === voteKey) return;
    voteKey = key;
    env.voteBody.innerHTML = '';
    voting.forEach((m) => {
      const g = document.createElement('div');
      g.className = 'vgroup';
      g.innerHTML = '<h3></h3><p class="hint">Tap one to see it bigger, then vote. You can change your vote while voting is open.</p>' +
        '<ul class="vthumbs"></ul><p class="vstatus" role="status"></p>';
      g.querySelector('h3').textContent = m.title;
      const ul = g.querySelector('ul');
      m.shortlist.forEach((it) => ul.appendChild(thumbFor(m, it)));
      g.querySelector('.vstatus').textContent = statusLine(m);
      g.setAttribute('data-id', m.id);
      env.voteBody.appendChild(g);
    });
    // The entry being looked at may have been taken off the list.
    if (viewing && env.viewer.open) {
      const m = voting.find((x) => x.id === viewing.moment);
      if (!m || !m.shortlist.some((x) => x.id === viewing.item.id)) closeViewer();
      else syncViewerButton();
    }
  }

  function statusLine(m) {
    if (status.has(m.id)) return status.get(m.id);
    const mine = m.myVote && m.shortlist.find((x) => x.id === m.myVote);
    return mine ? 'You voted for #' + mine.n : '';
  }

  function setStatus(momentId, text) {
    status.set(momentId, text);
    const el = env.voteBody.querySelector('.vgroup[data-id="' + momentId + '"] .vstatus');
    if (el) el.textContent = text;
  }

  /* ---------- the full-screen viewer ---------- */

  function openViewer(momentId, it) {
    viewing = { moment: momentId, item: it };
    env.viewerTitle.textContent = '#' + it.n + ' · ' + titleOf(momentId);
    env.viewerStage.innerHTML = '';
    if (it.kind === 'video') {
      const v = document.createElement('video');
      v.controls = true;
      v.playsInline = true;
      v.autoplay = true;
      v.poster = mediaUrl(env.base, it.copy);
      v.src = mediaUrl(env.base, it.orig);
      v.setAttribute('aria-label', 'Video number ' + it.n);
      env.viewerStage.appendChild(v);
    } else {
      const img = new Image();
      img.alt = 'Photo number ' + it.n;
      img.src = mediaUrl(env.base, it.copy);
      env.viewerStage.appendChild(img);
    }
    syncViewerButton();
    if (env.viewer.showModal) env.viewer.showModal(); else env.viewer.setAttribute('open', '');
    env.viewerClose.focus();
  }

  function closeViewer() {
    const v = env.viewerStage.querySelector('video');
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    env.viewerStage.innerHTML = '';
    if (env.viewer.close) env.viewer.close(); else env.viewer.removeAttribute('open');
    // Back to the thumbnail it came from (rebuilt after a vote, so look it up).
    if (viewing) {
      const back = env.voteBody.querySelector('.vgroup[data-id="' + viewing.moment + '"] .vthumb[data-entry="' + viewing.item.id + '"]');
      if (back) back.focus();
    }
    viewing = null;
  }

  function syncViewerButton() {
    if (!viewing) return;
    const m = moments().find((x) => x.id === viewing.moment);
    const mine = m && m.myVote === viewing.item.id;
    env.viewerVote.textContent = mine ? 'You voted for #' + viewing.item.n : 'Vote for #' + viewing.item.n;
    env.viewerVote.disabled = !!mine;
  }

  function cast() {
    if (!viewing) return;
    const { moment, item } = viewing;
    env.viewerVote.disabled = true;
    call(env.base, 'POST', '/vote', { password: env.getPassword(), json: { moment, entry: item.id, device: env.device } }).then((r) => {
      if (r.ok) {
        const m = moments().find((x) => x.id === moment);
        if (m) m.myVote = item.id;
        status.delete(moment);
        voteKey = ''; // rebuild so the thumbnails and line show the new vote
        renderVote();
        syncViewerButton();
        closeViewer();
        return;
      }
      const code = r.body && r.body.error;
      const msg = code === 'voting-closed' ? 'Voting just closed for this one.'
        : code === 'not-on-shortlist' ? 'That one was taken off the list. Pick another.'
        : "Couldn't send your vote. Check your signal and try again.";
      setStatus(moment, msg);
      closeViewer();
      if (code) refresh();
    });
  }

  env.viewerVote.addEventListener('click', cast);
  env.viewerClose.addEventListener('click', closeViewer);
  env.viewer.addEventListener('cancel', (e) => { e.preventDefault(); closeViewer(); }); // Esc

  /* ---------- polling ---------- */

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!started) return;
    const d = pollDelay(moments(), document.visibilityState === 'visible');
    if (d != null) timer = setTimeout(refresh, d);
  }

  function refresh() {
    if (loading) return Promise.resolve();
    loading = true;
    return call(env.base, 'GET', '/contest?device=' + encodeURIComponent(env.device), { password: env.getPassword() }).then((r) => {
      loading = false;
      if (r.ok && r.body && Array.isArray(r.body.moments)) {
        data = r.body;
        renderCards();
        renderVote();
        env.onData();
      }
      schedule();
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (!started) return;
    if (document.visibilityState === 'visible') refresh(); else schedule();
  });

  return {
    start() { started = true; return refresh(); },
    refresh,
    titleOf,
    setDriveOpen(open) { driveOpen = open; if (data) renderCards(); },
  };
}
