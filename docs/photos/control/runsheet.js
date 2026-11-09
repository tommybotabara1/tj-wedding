/* The Run sheet: the night's steps in order, the next one highlighted, and the
   shortlist review that sits inside step 2. Pure functions from state to HTML. */
import { esc, btn, act, thumb, who, ownEntries, proposal, PHASE, shortlistRows } from './common.js';

/* Which steps are finished, worked out from the phases and the screen. */
export function progress(s) {
  const M = s.moments;
  const started = M.some((m) => m.phase !== 'entries');
  const voteable = (m) => m.phase === 'entries' && proposal(m).length >= 2;
  const opened = started && !M.some(voteable);
  const revealed = M.every((m) => m.phase === 'revealed');
  const done = [started, opened, revealed, revealed && s.screen.mode === 'wall'];
  return { done, next: done.indexOf(false) };
}

/* ---------- step 2: review each moment's proposed shortlist ---------- */

// Picks start as the proposal, but only when there is a real contest (2+).
export function picksFor(ui, m) {
  const have = new Set(m.candidates.map((c) => c.id));
  if (!ui.picks[m.id]) ui.picks[m.id] = proposal(m).length >= 2 ? proposal(m).map((c) => c.id) : [];
  ui.picks[m.id] = ui.picks[m.id].filter((id) => have.has(id));
  return ui.picks[m.id];
}

export function renderReview(s, ui, ids) {
  const ms = s.moments.filter((m) => m.phase === 'entries' && ids.includes(m.id));
  if (!ms.length) return '<p class="muted">Nothing left to open.</p><div class="btns">' + btn('Close this review', { do: 'review', arg: '' }) + '</div>';
  const cards = ms.map((m) => {
    const picks = picksFor(ui, m);
    const by = new Map(m.candidates.map((c) => [c.id, c]));
    const own = ownEntries(m).length;
    const note = own === 0 ? 'No entries yet. It can get "No winner" later.'
      : own === 1 ? 'Only one entry. Award it directly later, or add more here.'
      : proposal(m).length < 2 ? 'Fewer than two good-enough entries. Add more to hold a vote.' : '';
    const rows = picks.map((id, i) => {
      const c = by.get(id);
      return '<li>' + thumb(c) + '<span class="who"><span class="n">' + (i + 1) + '</span> ' + who(c) +
        (c.fit != null ? '<small>fit ' + c.fit + ' · quality ' + (c.quality == null ? '?' : c.quality) + '</small>' : '') + '</span>' +
        btn('Remove', { do: 'rv-del', arg: m.id + '|' + id, k: 'rv-del:' + id }) + '</li>';
    }).join('');
    const adding = ui.addFor === m.id;
    const more = m.candidates.filter((c) => !picks.includes(c.id));
    const addList = adding ? '<ul class="rows add">' + (more.length ? more.map((c) =>
      '<li>' + thumb(c) + '<span class="who">' + who(c) + '</span>' + btn('Add', { do: 'rv-add', arg: m.id + '|' + c.id, k: 'rv-add:' + c.id }) + '</li>').join('')
      : '<li class="muted">No other photos to add.</li>') + '</ul>' : '';
    return '<section class="review"><h3>' + esc(m.title) + '</h3>' + (note ? '<p class="muted">' + esc(note) + '</p>' : '') +
      (rows ? '<ul class="rows">' + rows + '</ul>' : '') +
      '<div class="btns">' +
      (picks.length < 5 ? btn(adding ? 'Done adding' : 'Add a photo', { do: 'rv-adding', arg: adding ? '' : m.id, k: 'rv-adding:' + m.id }) : '') +
      btn('Looks good, open voting', { do: 'open-one', arg: m.id, kind: 'primary', disabled: !picks.length }) + '</div>' + addList + '</section>';
  }).join('');
  const openable = ms.filter((m) => picksFor(ui, m).length).length;
  return cards + '<div class="btns">' +
    (ms.length > 1 ? btn('Open all' + (openable ? ' (' + openable + ')' : ''), { do: 'open-all', arg: ms.map((m) => m.id).join(','), kind: 'primary', disabled: !openable }) : '') +
    btn('Close this review', { do: 'review', arg: '' }) + '</div>';
}

/* ---------- step 3: one moment ---------- */

function tiePanel(m, leaders) {
  const hit = m.shortlist.filter((x) => leaders.includes(x.id));
  const none = m.tally.total === 0;
  return '<div class="tie" role="group" aria-label="Pick the winner"><p><b>' +
    (none ? 'Nobody voted. Tap the winner.' : 'It\'s a tie. Tap the winner.') + '</b></p><ul class="rows">' +
    hit.map((x) => '<li>' + thumb(x) + '<span class="who"><span class="n">#' + x.n + '</span> ' + who(x) + '</span>' +
      btn('Winner', { do: 'win', arg: m.id + '|' + x.id, kind: 'primary', k: 'win:' + x.id }) + '</li>').join('') + '</ul>' +
    (none ? btn('No winner', { do: 'win', arg: m.id + '|none' }) : '') + '</div>';
}

function momentBody(s, ui, m) {
  const own = ownEntries(m).length;
  const onShortlist = s.screen.mode === 'shortlist' && s.screen.moment === m.id;
  if (m.phase === 'revealed') {
    return '<p class="ok">' + (m.winner ? 'Winner: ' + esc(m.winner.guest || 'A guest') + ' (#' + m.winner.n + ')' : 'No winner on screen.') + '</p>';
  }
  if (m.phase === 'entries') {
    if (own === 1) return '<p class="muted">One entry, so there is nothing to vote on.</p><div class="btns">' + btn('Award directly', { do: 'win', arg: m.id + '|' + ownEntries(m)[0].id, kind: 'primary' }) + '</div>';
    if (own === 0) return '<p class="muted">No entries for this one.</p><div class="btns">' + btn('No winner', { do: 'win', arg: m.id + '|none', kind: 'primary' }) + '</div>';
    return '<p class="muted">Voting isn\'t open for this moment. Open it in step 2.</p>';
  }
  const showDone = onShortlist || m.phase === 'closed';
  const rows = shortlistRows(m);
  if (m.phase === 'voting') {
    return '<p>' + m.tally.total + ' votes so far</p>' + rows + '<div class="btns">' +
      btn(onShortlist ? 'Shortlist is on screen ✓' : 'Show the shortlist on screen', { do: 'act', arg: act({ action: 'screen', mode: 'shortlist', moment: m.id }), kind: showDone ? 'quiet' : 'primary', k: 'sl:' + m.id }) +
      btn('Close voting', { do: 'act', arg: act({ action: 'close-voting', moment: m.id }), kind: showDone ? 'primary' : 'quiet', k: 'cv:' + m.id }) + '</div>';
  }
  return '<p>Voting closed · ' + m.tally.total + ' votes</p>' + rows + (ui.tie[m.id] ? tiePanel(m, ui.tie[m.id]) : '') +
    '<div class="btns">' + btn('Reveal winner', { do: 'reveal', arg: m.id, kind: 'primary', k: 'rv:' + m.id }) + '</div>';
}

/* ---------- the sheet ---------- */

function step(n, p, title, what, inner) {
  const cls = 'step' + (p.done[n - 1] ? ' done' : '') + (p.next === n - 1 ? ' next' : '');
  return '<section class="' + cls + '"' + (p.next === n - 1 ? ' aria-current="step"' : '') + '><div class="mark" aria-hidden="true">' +
    (p.done[n - 1] ? '✓' : n) + '</div><div class="body"><h2>' + esc(title) + '</h2><p class="what">' + esc(what) + '</p>' + inner + '</div></section>';
}

export function renderRunSheet(s, ui) {
  const p = progress(s);
  const onWall = s.screen.mode === 'wall';
  const current = s.moments.find((m) => m.phase !== 'revealed');
  const entriesIds = s.moments.filter((m) => m.phase === 'entries').map((m) => m.id);
  const reviewIds = ui.review === 'all' ? entriesIds : ui.review ? [ui.review] : null;
  const wallBtn = (label, k, on) => '<div class="btns">' + btn(on ? 'The wall is on screen ✓' : label,
    { do: 'act', arg: act({ action: 'screen', mode: 'wall' }), kind: on ? 'quiet' : 'primary', k }) + '</div>';

  const s2 = reviewIds ? renderReview(s, ui, reviewIds)
    : '<div class="btns">' + btn('Open voting', { do: 'review', arg: 'all', kind: 'primary' }) + '</div>';
  const s3 = '<div class="moments">' + s.moments.map((m) => {
    const open = ui.open[m.id] != null ? ui.open[m.id] : m === current;
    const cls = 'moment' + (m === current ? ' now' : '') + (m.phase === 'revealed' ? ' done' : '');
    return '<article class="' + cls + '"><button type="button" class="head" data-do="expand" data-arg="' + esc(m.id) + '" data-k="expand:' + esc(m.id) +
      '" aria-expanded="' + open + '"><span class="t">' + (m.phase === 'revealed' ? '✓ ' : '') + esc(m.title) + '</span><span class="pill">' + PHASE[m.phase] + '</span></button>' +
      (open ? '<div class="in">' + momentBody(s, ui, m) + '</div>' : '') + '</article>';
  }).join('') + '</div>';

  return step(1, p, 'Before the program: the wall is on', 'Tap this before guests arrive, so the big screen shows photos as they come in.', wallBtn('Show the wall', 'wall1', onWall)) +
    step(2, p, 'When the host announces voting', 'Tap Open voting, check each moment\'s shortlist, then confirm. Guests can then vote from their phones.', s2) +
    step(3, p, 'At the awarding, one moment at a time', 'For each moment: show its shortlist, close voting, then reveal the winner.', s3) +
    step(4, p, 'After the awarding', 'Tap this once the last winner has been shown.', wallBtn('Back to the wall', 'wall4', onWall && p.done[2]));
}
