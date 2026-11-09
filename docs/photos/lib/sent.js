/* The "Sent from this phone" list, kept in localStorage so a reload (or a
   second visit) still shows what this phone sent, and can still remove it. */

export const SENT_KEY = 'tj-photos-sent';
const MAX_ITEMS = 200;
const THUMBS = 60; // keeps the stored list small: older items lose their picture

/* SentItem = {local, entry|null, key|null, moment|null, kind,
               thumb|null, at, state: 'sending'|'sent'|'failed'|'removed'} */

export function loadSent(storage) {
  try {
    const v = JSON.parse(storage.getItem(SENT_KEY));
    return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && x.local) : [];
  } catch (e) {
    return [];
  }
}

export function saveSent(storage, items) {
  const out = items.slice().sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, MAX_ITEMS).map((it, i) => (i >= THUMBS && it.thumb ? { ...it, thumb: null } : it));
  try { storage.setItem(SENT_KEY, JSON.stringify(out)); } catch (e) { /* full or blocked: the list just won't survive a reload */ }
}

/* Replace the item with the same `local` id, or put a new one first. */
export function upsertSent(items, item) {
  const i = items.findIndex((x) => x.local === item.local);
  if (i < 0) return [item, ...items];
  const out = items.slice();
  out[i] = item;
  return out;
}

export function markRemoved(items, entry) {
  return items.map((x) => (x.entry === entry ? { ...x, state: 'removed' } : x));
}
