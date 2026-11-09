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

/* What we'd propose for the shortlist: this moment's entries that Gemini rated
   good enough, top five. */
export const proposal = (m) => ownEntries(m).filter((c) => (c.fit || 0) >= 5).slice(0, 5);

export const PHASE = { entries: 'Not opened', voting: 'Voting now', closed: 'Voting closed', revealed: 'Winner revealed' };

/* One line per shortlist entry: "#2 Sam · 3 votes". */
export function shortlistRows(m) {
  if (!m.shortlist.length) return '';
  return '<ul class="rows">' + m.shortlist.map((x) =>
    '<li>' + thumb(x) + '<span class="who"><span class="n">#' + x.n + '</span> ' + who(x) + '</span><span class="votes">' +
    x.votes + (x.votes === 1 ? ' vote' : ' votes') + '</span></li>').join('') + '</ul>';
}
