/* A real Gemini sample check (paid; ask Tommy first). Runs the Worker's own
   makeGemini on every JPEG in a folder and prints one line per file:

     file -> wallOk fit quality note

   Usage: node test/gemini-live.mjs <folder> [--moment <id>]

   GEMINI_API_KEY (and optional GEMINI_MODEL, default gemini-3.1-flash-lite) come
   from the main checkout's .env, found through git. The key, the request and
   raw error bodies are never printed. */

import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeGemini } from '../src/gemini.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/* The moments as the Worker has them. Titles, hints and the Gemini briefs are
   copied verbatim from migrations/0001_contest.sql, so this checks the same
   prompt the Worker sends on the night. Keep them in step with that file. */
const MOMENTS = {
  aisle: {
    title: 'Here comes the bride', hint: "Jeyan's walk down the church aisle.",
    brief: 'The bride, Jeyan, walking down the church aisle in her wedding gown, often escorted; guests in pews, church interior.',
  },
  entrance: {
    title: 'The grand entrance', hint: "Tommy and Jeyan's entrance to \"I See the Light.\"",
    brief: 'The newlyweds Tommy and Jeyan making their grand entrance into the reception hall together.',
  },
  'first-dance': {
    title: 'The first dance', hint: "\"I Was Made for Lovin' You.\"",
    brief: 'The newlyweds dancing together on the reception floor.',
  },
  'happy-tears': {
    title: 'Happy tears', hint: "The parents' dances, the speeches, the toast and the family messages.",
    brief: "An emotional moment: tears, hugs or laughter during the parents' dances, speeches, a toast or family messages.",
  },
  showstopper: {
    title: 'Showstopper', hint: 'The production number, the musical numbers, the Botabara Cousins and the TJR surprise.',
    brief: 'A stage performance at the reception: a production number, singers, musicians, dancers or a surprise act.',
  },
  groufie: {
    title: 'Groufie with the newlyweds', hint: "Your table's group selfie with Tommy and Jeyan.",
    brief: 'A group selfie of guests together with the bride (wedding gown) and groom (formal wear).',
  },
};

function parseEnv(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

function mainEnv() {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: here, encoding: 'utf8' }).trim();
    return parseEnv(path.join(path.dirname(common), '.env'));
  } catch {
    return {};
  }
}

const args = process.argv.slice(2);
let momentId = null;
const rest = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--moment') momentId = args[++i];
  else rest.push(args[i]);
}
const folder = rest[0];
if (!folder) { console.log('Usage: node test/gemini-live.mjs <folder> [--moment <id>]'); process.exit(1); }
if (momentId && !MOMENTS[momentId]) { console.log('Unknown moment. Choose one of: ' + Object.keys(MOMENTS).join(', ')); process.exit(1); }

const env = mainEnv();
if (!env.GEMINI_API_KEY) {
  console.log('Missing GEMINI_API_KEY in the main checkout .env. Create a key in Google AI Studio, add GEMINI_API_KEY=... to .env, then run this again.');
  process.exit(1);
}

let files;
try {
  files = readdirSync(folder).filter((f) => /\.jpe?g$/i.test(f)).sort();
} catch {
  console.log('Cannot read the folder: ' + folder);
  process.exit(1);
}
if (!files.length) { console.log('No JPEG files in ' + folder); process.exit(1); }

const gemini = makeGemini({ GEMINI_API_KEY: env.GEMINI_API_KEY, GEMINI_MODEL: env.GEMINI_MODEL || 'gemini-3.1-flash-lite' });
const moment = momentId ? MOMENTS[momentId] : null;

let ok = 0;
let failed = 0;
for (const f of files) {
  try {
    const v = await gemini.check({ jpeg: readFileSync(path.join(folder, f)), moment });
    if (v.wallOk) ok++;
    console.log(`${f} → ${v.wallOk} ${v.fit ?? '-'} ${v.quality} ${v.note || ''}`);
  } catch (e) {
    failed++;
    // Only the Worker's own short status text (e.g. "HTTP 429"): never a raw body.
    console.log(`${f} → error ${e && e.detail ? e.detail : 'failed'}`);
  }
}
console.log(`${files.length} files: ${ok} wallOk true, ${files.length - ok - failed} false, ${failed} errors`);
process.exit(failed ? 1 : 0);
