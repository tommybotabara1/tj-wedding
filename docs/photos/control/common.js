/* Small pieces shared by the control page's views: escaping, buttons, times,
   photo thumbnails and the per-moment counts the run sheet needs. */
import { apiBase, mediaUrl } from '../lib/api.js';

const BASE = apiBase(location);

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* A button the delegated click handler in control.js understands:
   data-do is the handler, data-arg its argument, data-k keeps keyboard focus
   on the same button when the view is redrawn. */
export function btn(label, o) {
  o = o || {};
  const k = o.k || (o.do + ':' + (o.arg == null ? '' : o.arg));
  return '<button type="button" class="btn ' + (o.kind || 'quiet') + '" data-do="' + esc(o.do) + '" data-arg="' +
    esc(o.arg == null ? '' : o.arg) + '" data-k="' + esc(k) + '"' +
    (o.pressed != null ? ' aria-pressed="' + !!o.pressed + '"' : '') + (o.disabled ? ' disabled' : '') + '>' + esc(label) + '</button>';
}

export const act = (payload) => JSON.stringify(payload);

export function ago(ms, now) {
  const m = Math.max(0, Math.round((now - ms) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  return h < 24 ? h + ' h ago' : Math.round(h / 24) + ' d ago';
}

export const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function thumb(item) {
  return '<img class="th" alt="" loading="lazy" src="' + esc(mediaUrl(BASE, item.copy)) + '">';
}

/* "Sam · The first dance" for any Item. */
export function who(item) {
  return '<b>' + esc(item.guest || 'A guest') + '</b>' + (item.kind === 'video' ? ' <span class="tag">video</span>' : '') +
    '<small>' + esc(item.moment || 'Plain share') + '</small>';
}

/* Entries sent for this moment, best first (candidates are ranked). */
export const ownEntries = (m) => m.candidates.filter((c) => c.moment === m.title);

/* What we'd propose for the shortlist: the Worker's own pick (m.proposed, up to
   five ids: eligible, rated good enough, one per phone), never recomputed here,
   so a held or hidden photo can't slip in. */
export function proposal(m) {
  const by = new Map(m.candidates.map((c) => [c.id, c]));
  return (m.proposed || []).map((id) => by.get(id)).filter(Boolean);
}

/* Whether the Worker will accept this candidate on a shortlist or as a direct
   award: checked fine (or shown by the operator) and not hidden. */
export const eligible = (c) => !c.hidden && (c.state === 'shown' || !!c.shown);

/* The one-word flag the Add list puts on a candidate that isn't ready. */
export function flag(c) {
  const w = c.hidden ? 'hidden' : c.shown || c.state === 'shown' ? '' : c.state === 'held' ? 'held' : 'not checked yet';
  return w ? '<small class="flag">' + w + '</small>' : '';
}

const STATE_TEXT = { shown: 'Checked, fine', held: 'Held back by the check', pending: 'Not checked yet', error: 'Not checked yet' };

/* A moment with one entry: its thumbnail and state beside Award directly, and
   No winner always offered next to it. k is a prefix that keeps focus on redraw. */
export function directAward(m, k) {
  const e = ownEntries(m)[0];
  const none = btn('No winner', { do: 'win', arg: m.id + '|none', k: k + 'nw:' + m.id });
  if (!e) return '<div class="btns">' + none + '</div>';
  const ok = eligible(e);
  const why = e.hidden ? "Hidden, so it can't be awarded."
    : ok ? '' : 'Not cleared yet. Show it under "Waiting for a check" first, or give No winner.';
  const text = e.hidden ? 'Hidden' : e.shown ? 'Shown by you' : STATE_TEXT[e.state] || '';
  return '<ul class="rows"><li>' + thumb(e) + '<span class="who">' + who(e) + '<small>' + esc(text) + '</small></span></li></ul>' +
    (why ? '<p class="muted">' + esc(why) + '</p>' : '') +
    '<div class="btns">' + btn('Award directly', { do: 'win', arg: m.id + '|' + e.id, kind: 'primary', disabled: !ok, k: k + 'aw:' + m.id }) + none + '</div>';
}

/* Reveal winner, with its inline "are you sure" (never confirm()). */
export function revealControl(ui, m, k) {
  if (ui.confirm === 'rv:' + m.id) {
    return '<span class="ask" role="alert">Put the winner on the big screen?</span>' +
      btn('Reveal', { do: 'reveal-go', arg: m.id, kind: 'primary', k: 'rvgo:' + m.id }) + btn('Cancel', { do: 'confirm', arg: '', k: 'rvno:' + m.id });
  }
  return btn('Reveal winner', { do: 'confirm', arg: 'rv:' + m.id, kind: 'primary', k });
}

export const PHASE = { entries: 'Not opened', voting: 'Voting now', closed: 'Voting closed', revealed: 'Winner revealed' };

/* One line per shortlist entry: "#2 Sam · 3 votes". */
export function shortlistRows(m) {
  if (!m.shortlist.length) return '';
  return '<ul class="rows">' + m.shortlist.map((x) =>
    '<li>' + thumb(x) + '<span class="who"><span class="n">#' + x.n + '</span> ' + who(x) + '</span><span class="votes">' +
    x.votes + (x.votes === 1 ? ' vote' : ' votes') + '</span></li>').join('') + '</ul>';
}

/* The tie panel: when a reveal needs a choice (a tie, or nobody voted), the
   entries to pick from, each with a Winner button. Used on both tabs. */
export function tiePanel(m, leaders) {
  const hit = m.shortlist.filter((x) => leaders.includes(x.id));
  const none = m.tally.total === 0;
  return '<div class="tie" role="group" aria-label="Pick the winner"><p><b>' +
    (none ? 'Nobody voted. Tap the winner.' : "It's a tie. Tap the winner.") + '</b></p><ul class="rows">' +
    hit.map((x) => '<li>' + thumb(x) + '<span class="who"><span class="n">#' + x.n + '</span> ' + who(x) + '</span>' +
      btn('Winner', { do: 'win', arg: m.id + '|' + x.id, kind: 'primary', k: 'win:' + x.id }) + '</li>').join('') + '</ul>' +
    (none ? btn('No winner', { do: 'win', arg: m.id + '|none' }) : '') + '</div>';
}

// "(#2)" after a winner's name, unless it was awarded directly and has no number.
export const winnerLine = (m) => m.winner ? 'Winner: ' + esc(m.winner.guest || 'A guest') + (m.winner.n ? ' (#' + m.winner.n + ')' : '') : 'No winner on screen.';
