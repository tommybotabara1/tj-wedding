/* The Everything tab: every control in one place, for when the run sheet is
   not enough, and the view Tommy watches while someone else runs the night. */
import { esc, btn, act, ago, clock, thumb, who, directAward, revealControl, PHASE, shortlistRows, tiePanel, winnerLine } from './common.js';
import { renderReview } from './runsheet.js';

const sec = (title, inner, extra) => '<section class="card"><h2>' + esc(title) + '</h2>' + (extra || '') + inner + '</section>';

function screenSection(s) {
  const { mode, moment } = s.screen;
  const rows = s.moments.filter((m) => m.phase !== 'entries').map((m) => '<div class="srow"><span class="t">' + esc(m.title) + '</span><span class="btns">' +
    btn('Shortlist', { do: 'act', arg: act({ action: 'screen', mode: 'shortlist', moment: m.id }), pressed: mode === 'shortlist' && moment === m.id, disabled: m.phase === 'entries', k: 'scs:' + m.id }) +
    btn('Winner', { do: 'act', arg: act({ action: 'screen', mode: 'winner', moment: m.id }), pressed: mode === 'winner' && moment === m.id, disabled: m.phase !== 'revealed', k: 'scw:' + m.id }) + '</span></div>').join('');
  return sec('On the big screen', '<div class="btns">' + btn('Wall', { do: 'act', arg: act({ action: 'screen', mode: 'wall' }), pressed: mode === 'wall', k: 'scwall' }) + '</div>' +
    (rows || '<p class="muted">The shortlist and winner buttons show up here once its voting opens.</p>'));
}

function momentCard(s, ui, m) {
  const count = m.entryCount;
  let ctl = '';
  let direct = '';
  if (m.phase === 'entries') {
    ctl = btn('Open voting', { do: 'review', arg: m.id, kind: 'primary', k: 'ev-open:' + m.id });
    if (count === 1) direct = directAward(m, 'ev-');
    else if (count === 0) ctl += btn('No winner', { do: 'win', arg: m.id + '|none', k: 'ev-nw:' + m.id });
  } else if (m.phase === 'voting') {
    ctl = btn('Close voting', { do: 'act', arg: act({ action: 'close-voting', moment: m.id }), kind: 'primary', k: 'ev-cv:' + m.id });
  } else if (m.phase === 'closed') {
    ctl = revealControl(ui, m, 'ev-rv:' + m.id);
  }
  const win = m.phase === 'revealed' ? '<p class="ok">' + winnerLine(m) + '</p>' : '';
  return '<article class="moment"><div class="head static"><span class="t">' + esc(m.title) + '</span><span class="pill">' + PHASE[m.phase] + '</span></div><div class="in">' +
    '<p class="muted">' + count + (count === 1 ? ' entry sent' : ' entries sent') + (m.phase === 'voting' || m.phase === 'closed' ? ' · ' + m.tally.total + ' votes' : '') + '</p>' +
    shortlistRows(m) + win + (m.phase === 'closed' && ui.tie[m.id] ? tiePanel(m, ui.tie[m.id]) : '') + (ui.review === m.id ? renderReview(s, ui, [m.id]) : direct + '<div class="btns">' + ctl + '</div>') + '</div></article>';
}

function momentsSection(s, ui) {
  const voting = s.moments.some((m) => m.phase === 'voting');
  const toOpen = s.moments.some((m) => m.phase === 'entries');
  const all = '<div class="btns">' +
    (toOpen ? btn('Open all', { do: 'open-all-review', arg: '' }) : '') +
    (voting ? btn('Close all', { do: 'close-all', arg: '' }) : '') + '</div>';
  return sec('Moments', s.moments.map((m) => momentCard(s, ui, m)).join(''), (toOpen || voting) ? all : '');
}

function waitingSection(s) {
  const label = { held: 'Held back by the check', error: 'The check failed', pending: 'Still being checked' };
  const rows = s.waiting.map((e) => '<li>' + thumb(e) + '<span class="who">' + who(e) + '<small>' + esc(label[e.state] || e.state) + (e.note ? ': ' + esc(e.note) : '') + '</small></span>' +
    '<span class="btns">' + btn('Show', { do: 'act', arg: act({ action: 'show', entry: e.id }), kind: 'primary', k: 'sh:' + e.id }) +
    btn('Keep hidden', { do: 'act', arg: act({ action: 'hide', entry: e.id }), k: 'kh:' + e.id }) + '</span></li>').join('');
  return sec('Waiting for a check (' + s.waiting.length + ')', rows ? '<ul class="rows stack">' + rows + '</ul>' : '<p class="muted">Nothing is waiting.</p>');
}

function wallSection(s, ui) {
  const rows = s.wall.map((e) => {
    const asking = ui.confirm === 'rm:' + e.id;
    const acts = asking
      ? '<span class="ask" role="alert">Remove this? It comes off the screen and out of the contest.</span><span class="btns">' +
        btn('Remove', { do: 'act', arg: act({ action: 'remove', entry: e.id }), kind: 'danger', k: 'rmgo:' + e.id }) + btn('Keep', { do: 'confirm', arg: '', k: 'rmno:' + e.id }) + '</span>'
      : '<span class="btns">' + btn('Hide', { do: 'act', arg: act({ action: 'hide', entry: e.id }), k: 'hd:' + e.id }) +
        btn('Remove', { do: 'confirm', arg: 'rm:' + e.id, k: 'rm:' + e.id }) + '</span>';
    return '<li>' + thumb(e) + '<span class="who">' + who(e) + '</span>' + acts + '</li>';
  }).join('');
  return sec('On the wall now', rows ? '<ul class="rows stack">' + rows + '</ul>' : '<p class="muted">Nothing on the wall yet.</p>');
}

function switchesSection(s) {
  const c = s.settings;
  const set = (v) => act({ action: 'settings', contest: v });
  const seg = [['auto', 'Auto'], ['open', 'Open'], ['closed', 'Closed']].map(([v, l]) => btn(l, { do: 'act', arg: set(v), pressed: c.contest === v, k: 'ct:' + v })).join('');
  return sec('Switches',
    '<p class="lbl">Contest</p><div class="btns seg" role="group" aria-label="Contest">' + seg + '</div>' +
    '<p class="muted">Entries are ' + (c.open ? 'open' : 'closed') + ' right now. Auto opens at midnight on December 27.</p>' +
    '<p class="lbl">Show new photos without checking</p><div class="btns">' +
    btn(c.skipCheck ? 'On: new photos show at once' : 'Off: photos wait for the check', { do: 'act', arg: act({ action: 'settings', skipCheck: !c.skipCheck }), pressed: c.skipCheck, kind: c.skipCheck ? 'primary' : 'quiet', k: 'skip' }) + '</div>' +
    '<p class="muted">For emergencies, if the check is down. Held photos still wait.</p>');
}

function healthSection(s, now) {
  const g = s.gemini;
  const line = g.lastError && g.lastError > (g.lastOk || 0) ? 'Gemini failed ' + ago(g.lastError, now) + ' (' + clock(g.lastError) + ')'
    : g.lastOk ? 'Gemini last answered ' + ago(g.lastOk, now) : 'Gemini hasn\'t been asked yet';
  const n = s.counts;
  return sec('Health', '<p>' + esc(line) + '</p><p class="muted">' + n.sent + ' sent · ' + n.onWall + ' on the wall · ' + n.waiting + ' waiting</p>');
}

function practiceSection(s, ui) {
  if (s.settings.practice) return sec('Practice', '<p class="muted">Practice is on. Use Clear practice at the top when you\'re done.</p>');
  const asking = ui.confirm === 'pstart';
  return sec('Practice', '<p class="muted">For a rehearsal. Everything made while it\'s on is marked practice and cleared in one tap. Practice is off-limits on the wedding day.</p>' +
    (asking
      ? '<div class="btns"><span class="ask" role="alert">Start practice? Everything sent until you clear it is treated as practice.</span>' +
        btn('Start', { do: 'act', arg: act({ action: 'practice-start' }), kind: 'primary', k: 'pgo' }) + btn('Cancel', { do: 'confirm', arg: '', k: 'pno' }) + '</div>'
      : '<div class="btns">' + btn('Start practice', { do: 'confirm', arg: 'pstart', kind: 'primary', k: 'pstart' }) + '</div>'));
}

function logSection(s) {
  const rows = s.log.map((l) => '<li>' + esc(l.by) + ' · ' + esc(l.what) + ' · ' + esc(clock(l.at)) + '</li>').join('');
  return sec('Latest', rows ? '<ol class="log">' + rows + '</ol>' : '<p class="muted">Nothing yet.</p>');
}

export function renderEverything(s, ui, now) {
  return screenSection(s) + momentsSection(s, ui) + waitingSection(s) + wallSection(s, ui) + switchesSection(s) +
    healthSection(s, now) + practiceSection(s, ui) + logSection(s);
}
