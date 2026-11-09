/* A practice-only run through the whole contest, start to finish. Safe on
   production too, because everything happens inside practice mode and ends
   with practice-clear. Prints SMOKE OK, or the first step that failed.

     SMOKE_API   the Worker (default http://127.0.0.1:8787)

   Localhost reads ADMIN_PASSWORD and PHOTO_PASSWORD from .dev.vars. Any other
   API reads PHOTO_ADMIN_PASSWORD from the main checkout's .env (found through
   git); the guests' password is the public one. Passwords are never printed. */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = (process.env.SMOKE_API || 'http://127.0.0.1:8787').replace(/\/$/, '');
const here = path.dirname(fileURLToPath(import.meta.url));
const local = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(API);

function parseEnv(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

function passwords() {
  if (local) {
    const v = parseEnv(path.join(here, '..', '.dev.vars'));
    return { admin: v.ADMIN_PASSWORD, guest: v.PHOTO_PASSWORD || 'ToMyJeyan' };
  }
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: here, encoding: 'utf8' }).trim();
  const env = parseEnv(path.join(path.dirname(common), '.env'));
  return { admin: env.PHOTO_ADMIN_PASSWORD, guest: 'ToMyJeyan' };
}

const pw = passwords();
if (!pw.admin) { console.log('SMOKE FAILED: no admin password found'); process.exit(1); }

// A JPEG-shaped file of noise, about 30 KB.
function fixture() {
  const body = new Uint8Array(30 * 1024);
  for (let i = 0; i < body.length; i += 65536) crypto.getRandomValues(body.subarray(i, i + 65536));
  const out = new Uint8Array(body.length + 4);
  out.set([0xFF, 0xD8], 0);
  out.set(body, 2);
  out.set([0xFF, 0xD9], body.length + 2);
  return out;
}

async function call(method, route, { headers = {}, body, admin } = {}) {
  const h = { ...headers };
  if (admin) h['X-Admin-Password'] = pw.admin; else h['X-Photo-Password'] = pw.guest;
  if (body !== undefined && !(body instanceof Uint8Array)) { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  const r = await fetch(API + route, { method, headers: h, body });
  let j = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw new Error(`${method} ${route.split('?')[0]} answered ${r.status} ${(j && j.error) || ''}`.trim());
  return j;
}
const act = (a) => call('POST', '/admin/act', { admin: true, body: a });
const screen = () => call('GET', '/screen');
const ids = (s) => [
  ...s.wall.map((x) => x.id),
  ...(s.moment ? [...s.moment.shortlist.map((x) => x.id), ...(s.moment.winner ? [s.moment.winner.id] : [])] : []),
];
const check = (cond, what) => { if (!cond) throw new Error(what); };

const MOMENT = 'groufie';
const device = 'smoke-' + crypto.randomUUID().slice(0, 8);
let step = '';
let failed = null;
let practiceOn = false;

try {
  const jpeg = fixture();

  step = '1 practice-start';
  await act({ action: 'practice-start', by: 'smoke' });
  practiceOn = true;

  step = '2 /start';
  const s = await call('POST', '/start', { body: { name: 'smoke.jpg', type: 'image/jpeg', size: jpeg.length, guest: 'Smoke', device, moment: MOMENT } });
  const { entry, key, session } = s;
  check(entry && key && session, 'start gave no entry, key and session');
  check(s.moment === MOMENT, 'moment was not accepted in practice mode');

  step = '3 /copy';
  await call('POST', '/copy', { headers: { 'X-Entry': entry, 'X-Entry-Key': key, 'Content-Type': 'image/jpeg' }, body: jpeg });

  step = '4 /chunk';
  const done = await call('PUT', '/chunk', { headers: { 'X-Upload-Session': session, 'Content-Range': `bytes 0-${jpeg.length - 1}/${jpeg.length}` }, body: jpeg });
  check(done && done.done && done.file && done.file.id, 'the original did not finish');

  step = '5 show';
  await act({ action: 'show', entry, by: 'smoke' });

  step = '6 /screen lists the entry';
  await act({ action: 'screen', mode: 'wall', by: 'smoke' });
  check(ids(await screen()).includes(entry), 'the entry is not on the wall');

  step = '7 open-voting';
  await act({ action: 'open-voting', moment: MOMENT, shortlist: [entry], by: 'smoke' });

  step = '8 /vote';
  await call('POST', '/vote', { body: { device, moment: MOMENT, entry } });

  step = '9 close-voting';
  await act({ action: 'close-voting', moment: MOMENT, by: 'smoke' });

  step = '10 reveal';
  await act({ action: 'reveal', moment: MOMENT, by: 'smoke' });

  step = '11 /screen mode is winner';
  const sw = await screen();
  check(sw.mode === 'winner', 'screen mode is ' + sw.mode);
  check(sw.moment && sw.moment.winner && sw.moment.winner.id === entry, 'the winner is not the entry');

  step = '12 /remove';
  await call('POST', '/remove', { body: { entry, key } });

  step = '13 /screen no longer lists it';
  check(!ids(await screen()).includes(entry), 'the removed entry is still on the screen');
} catch (e) {
  failed = `${step}: ${e.message}`;
}

// Always leave the contest as it was found.
if (practiceOn) {
  try {
    step = '14 practice-clear';
    let r;
    let calls = 0;
    do {
      r = await act({ action: 'practice-clear', by: 'smoke' });
      calls++;
    } while (r.clearing && calls < 20);
    if (r.clearing) throw new Error('still clearing after 20 calls');
  } catch (e) {
    failed = failed || `${step}: ${e.message}`;
  }
}

if (failed) { console.log('SMOKE FAILED at step ' + failed); process.exit(1); }
console.log('SMOKE OK');
