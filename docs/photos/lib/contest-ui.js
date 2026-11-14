/* Small pure helpers for the contest tiles, polling and this phone's id. */

/* The label on a moment's tile. Only a moment that differs from the rest
   gets one: the line above the grid already says whether the contest is open. */
export function tileChip(moment) {
  switch (moment.phase) {
    case 'voting': return 'Vote now';
    case 'closed':
    case 'revealed': return 'Closed';
    default: return '';
  }
}

/* Tiles sit in rows of `cols`, each at CSS order index*2. A tile's info strip
   goes right after the last tile of its row (an odd order), with its little
   arrow under the middle of that tile's column (caret, a percentage). */
export function detailPlace(index, count, cols = 3) {
  const last = Math.min(count, (Math.floor(index / cols) + 1) * cols) - 1;
  return { order: last * 2 + 1, caret: Math.round(((index % cols) + 0.5) / cols * 10000) / 100 };
}

/* Phones ask every 60 s, or every 20 s while any moment is being voted on,
   and not at all while the page is hidden. */
export function pollDelay(moments, visible) {
  if (!visible) return null;
  return moments.some((m) => m.phase === 'voting') ? 20000 : 60000;
}

export const DEVICE_KEY = 'tj-photos-device';

/* An anonymous id for this phone, so one phone gets one vote per moment. */
export function deviceId(storage, rand) {
  try {
    const have = storage.getItem(DEVICE_KEY);
    if (have && /^[0-9a-f]{16}$/.test(have)) return have;
  } catch (e) { /* fall through and make one */ }
  const bytes = new Uint8Array(8);
  if (rand) rand(bytes); else crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  try { storage.setItem(DEVICE_KEY, id); } catch (e) { /* private mode: new id each visit */ }
  return id;
}
