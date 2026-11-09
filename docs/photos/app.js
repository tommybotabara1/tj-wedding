/* tomyjeyan.com/photos: the password step, then the contest and the uploader.

     lib/        small tested pieces (api, sent list, small copy, labels)
     upload.js   sending files and the "Sent from this phone" list
     contest-view.js   moment cards, voting and polling
   Uploads go straight to the couple's Google Drive through the Worker at
   upload.tomyjeyan.com; no Google sign-in for the guest. */

import { apiBase, call, norm } from './lib/api.js';
import { deviceId } from './lib/contest-ui.js';
import { createUploader } from './upload.js';
import { createContest } from './contest-view.js';

const KEY = 'tj-photos-pw';
const NAME_KEY = 'tj-photos-name';
const $ = (id) => document.getElementById(id);

const form = $('lock');
const input = $('pw');
const btn = $('unlock');
const err = $('pw-err');
const unlocked = $('unlocked');
const guest = $('guest');
const guestErr = $('guest-err');
const shoot = $('shoot');
const upSoon = $('up-soon');
const tip = $('tip');
const inputs = ['in-photo', 'in-video', 'in-pick'].map($);

const base = apiBase(location);
let password = '';
let vault = {};
try { vault = JSON.parse($('vault').textContent); } catch (e) { /* no vault: unlock will refuse */ }

function bytes(b64) {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* Resolves for the right password, rejects for a wrong one (AES-GCM refuses to
   decrypt with the wrong key). What's inside the vault no longer matters: it is
   only the password check. */
function open(pw) {
  const subtle = window.crypto && window.crypto.subtle;
  if (!subtle || !vault.ct) return Promise.reject(new Error('unsupported'));
  return subtle.importKey('raw', new TextEncoder().encode(norm(pw)), 'PBKDF2', false, ['deriveKey'])
    .then((k) => subtle.deriveKey(
      { name: 'PBKDF2', salt: bytes(vault.salt), iterations: vault.iter, hash: 'SHA-256' },
      k, { name: 'AES-GCM', length: 256 }, false, ['decrypt']))
    .then((key) => subtle.decrypt({ name: 'AES-GCM', iv: bytes(vault.iv) }, key, bytes(vault.ct)));
}

/* ---------- your name ---------- */

try { guest.value = localStorage.getItem(NAME_KEY) || ''; } catch (e) { /* no storage */ }
guest.addEventListener('change', () => {
  try { localStorage.setItem(NAME_KEY, guest.value.trim()); } catch (e) { /* no storage */ }
});
guest.addEventListener('input', () => {
  if (guestErr.textContent) { guestErr.textContent = ''; guest.removeAttribute('aria-invalid'); }
});
function needName() {
  guestErr.textContent = 'Add your name first so we know who won.';
  guest.setAttribute('aria-invalid', 'true');
  guest.focus();
}

/* ---------- the pieces ---------- */

/* localStorage can throw (private mode, blocked site data): fall back to memory. */
function safeStorage() {
  try {
    localStorage.setItem('tj-photos-t', '1');
    localStorage.removeItem('tj-photos-t');
    return localStorage;
  } catch (e) {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
  }
}
const store = safeStorage();
const device = deviceId(store);
const getPassword = () => password;
const getGuest = () => guest.value.trim();

const contest = createContest({
  base, device, getPassword, getGuest, needName,
  section: $('contest'), momentsEl: $('moments'),
  voteSection: $('vote'), voteBody: $('vote-body'),
  viewer: $('viewer'), viewerTitle: $('viewer-t'), viewerStage: $('viewer-stage'),
  viewerVote: $('viewer-vote'), viewerClose: $('viewer-close'),
  onPick: (file, momentId) => uploader.add(file, momentId),
  onData: () => uploader.refreshTitles(),
});

const uploader = createUploader({
  base, device, storage: store, getPassword, getGuest,
  list: $('sent'), section: $('sent-sec'), tally: $('tally'), announce: $('announce'),
  titleOf: (id) => contest.titleOf(id),
});

inputs.forEach((inp) => {
  inp.addEventListener('change', () => {
    Array.prototype.slice.call(inp.files || []).forEach((f) => uploader.add(f, ''));
    inp.value = ''; // so the same photo can be picked again
  });
});

/* Is sending open? Until the Worker is set up (or if it can't reach Drive),
   the buttons rest as placeholders and say when to come back. */
function checkOpen() {
  return call(base, 'GET', '/ping', { password }).then((r) => {
    const open = r.ok && r.body.drive === true;
    shoot.classList.toggle('closed', !open);
    inputs.forEach((inp) => { inp.disabled = !open; });
    upSoon.hidden = open;
    tip.hidden = !open;
    contest.setDriveOpen(open);
  });
}

function show(pw) {
  password = norm(pw);
  form.hidden = true;
  unlocked.hidden = false;
  uploader.restore();
  contest.start();
  return checkOpen();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const pw = input.value;
  if (!norm(pw)) {
    err.textContent = 'Type the password from the photo card at your table.';
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Checking…';
  open(pw).then(() => {
    try { localStorage.setItem(KEY, norm(pw)); } catch (x) { /* no storage */ }
    show(pw);
    guest.focus({ preventScroll: true });
  }, (x) => {
    btn.disabled = false;
    btn.textContent = 'Unlock';
    input.setAttribute('aria-invalid', 'true');
    err.textContent = x && x.message === 'unsupported'
      ? "This browser can't open the album. Try Chrome or Safari, or message us on our socials."
      : "That's not quite it. Check the photo card at your table and try again.";
    input.select();
  });
});
input.addEventListener('input', () => {
  if (err.textContent) { err.textContent = ''; input.removeAttribute('aria-invalid'); }
});

/* Coming back to add more? Skip the password if it worked here before. */
let saved = null;
try { saved = localStorage.getItem(KEY); } catch (e) { /* no storage */ }
if (saved) {
  open(saved).then(() => show(saved), () => {
    try { localStorage.removeItem(KEY); } catch (x) { /* no storage */ }
  });
}
