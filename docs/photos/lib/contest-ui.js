/* Small pure helpers for the contest cards, polling and this phone's id. */

export function momentLabel(moment, open) {
  switch (moment.phase) {
    case 'voting': return 'Voting now';
    case 'closed':
    case 'revealed': return 'Closed';
    default: return open ? 'Open' : 'Opens December 27';
  }
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
