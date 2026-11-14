# Photo Contest and Live Wall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn tomyjeyan.com/photos into the wedding photo contest:
- six moments guests try to capture, plus plain sharing;
- a "Sent from this phone" list with Remove;
- Gemini checks every upload and builds the shortlists;
- guests vote on their phones;
- a big-screen page and a control page, with a run sheet and practice mode, for whoever runs the night.

**Architecture:**
- **Worker.** The existing Worker `workers/photo-upload` (upload.tomyjeyan.com) keeps today's upload calls unchanged. It gains:
  - a Cloudflare D1 database for entries, votes, moments and settings;
  - small JPEG copies stored in a second Drive folder;
  - a Gemini check run on each small copy;
  - signed media links;
  - a once-a-minute cron.
- **Pages.** Three static pages on GitHub Pages (`docs/photos/`, `docs/photos/screen/`, `docs/photos/control/`) talk only to the Worker. Contest storage is best-effort: if D1 fails, the upload still goes through as a plain share.
- **Testability.** Every outside call (Google, Gemini, the clock) goes through an injected `svc` object, so tests run against fakes.

**Tech Stack:**
- Worker: Cloudflare Workers (JS modules, `nodejs_compat`), D1, Cron Triggers.
- Google: Drive v3 REST (`drive.file` scope), Gemini API `generateContent`.
- Tests: vitest 5.1.0 + `@cloudflare/vitest-plugin` 1.6.1, wrangler 4.159.0.
- Pages: plain HTML/CSS and ES modules, with no build step. Pure page helpers are tested with `node --test` (Node 24).
- Tools: Python run with `py`, as the repo tools are.

**Spec:** `planning/specs/2026-11-09-photo-contest-design.md` (approved 2026-11-09). Read it first; this plan argues from it.

## Global Constraints

- **Secrets:** the repo is public. Secrets live only in the main checkout's `.env` and in Worker secrets, never in a commit, a log line, test output or the chat. Never print `.env`, `photo_oauth_client.json`, `credentials.json` or tokens.
- **Keep the live uploader working.** `GET /ping`, `POST /start`, `PUT /chunk` and `GET /status` keep their current request and response shapes. Today's live page must keep working against the new Worker.
- **Branch and deploy:** all work happens on branch `claude/wedding-photo-uploader-0f52c7`. Nothing goes to `master`, and nothing is deployed, created in Cloudflare, or pushed as a secret, until Task 12, and then only after Tommy says go.
- **Paid API calls:** real Gemini calls (paid tier) need Tommy's OK before each run (CLAUDE.md).
- **Free plan:** stay within the Workers free plan even though Tommy will buy Workers Paid. That means 10 ms CPU and 50 subrequests per request, and 100,000 requests a day. Don't resize images in the Worker; the phone does it.
- **Contest opening time:** opens automatically at `2026-12-26T16:00:00Z` (00:00 Dec 27, Philippine time). The setting `contest` can be `auto` (the default), `open` or `closed`. Practice mode counts as open.
- **Hashtag:** `#SoaringWithTJ` on the photos page (meta description, og:site_name, og:description, the "Posting online too?" line) and on the screen. The guests' password stays `ToMyJeyan`.
- **Moments.** Ids and order are fixed. Titles and hints are exact guest copy:

  | id | title | hint |
  |---|---|---|
  | `aisle` | Here comes the bride | Jeyan's walk down the church aisle. |
  | `entrance` | The grand entrance | Tommy and Jeyan's entrance to "I See the Light." |
  | `first-dance` | The first dance | "I Was Made for Lovin' You." |
  | `happy-tears` | Happy tears | The parents' dances, the speeches, the toast and the family messages. |
  | `showstopper` | Showstopper | The production number, the musical numbers, the Botabara Cousins and the TJR surprise. |
  | `groufie` | Groufie with the newlyweds | Your table's group selfie with Tommy and Jeyan. |

- **Fixed copy:**
  - moment button: "Send a shot for this moment";
  - statuses: "Opens December 27" / "Open" / "Voting now" / "Closed";
  - remove prompt: "Remove this? It comes off the screen and out of the contest." with buttons **Remove** and **Keep**. Inline, never `confirm()`;
  - list states: "Sent ✓" and "In the contest: <title>";
  - vote: "You voted for #<n>";
  - screen: "Vote now at tomyjeyan.com/photos", "<N> votes so far", "Winner · <title>" (e.g. "Winner · The grand entrance"; "Best <moment>" read badly for several titles);
  - control: "Waiting for a check", "Show new photos without checking", "Clear practice".
- **Shortlists:** up to 5 entries, each with fit ≥ 5, at most one per phone. They're ranked by fit + quality (highest first), then by who sent first.
- **Polling:** phones every 60 s, or every 20 s while any moment is voting, and only while the page is visible. The screen every 5 s. The control page every 5 s while open.
- **Small copy:** at most 1600 px on the long edge, JPEG quality 0.82. For a video, one frame at `min(1 s, duration / 3)`. The list's tiny thumbnail is 96 px, JPEG quality 0.6.
- **Gemini model:** the Worker var `GEMINI_MODEL`, default `gemini-3.1-flash-lite`. The key is Worker secret `GEMINI_API_KEY`.
- **Design and accessibility:** keep the look and accessibility rules of `docs/photos/index.html`: the tokens in its `:root`, Cormorant Garamond and Montserrat, 16 px inputs, visible focus, `prefers-reduced-motion`, white on `--rose-deep` for primary buttons.

## Review Focus

1. **A phone that can't make the small copy** (a HEIC on Android, a huge iPhone photo running out of memory, a video whose frame won't draw) must still send the original. The cron then uses Drive's thumbnail. *Test: Task 8 `uploader sends the original when the small copy fails`, and Task 4 `cron uses the Drive thumbnail when no small copy arrived`.*
2. **Remove tapped while the original is still uploading.** The page stops sending, and if the last piece lands anyway, the Worker moves it straight to the bin. *Test: Task 3 `remove before the last piece lands trashes the original when it arrives`.*
3. **Two control phones tapping the same step,** or one person double-tapping, must not double-open, double-reveal or crash. A wrong-phase action answers 409 `wrong-phase` and the page refreshes. *Test: Task 6 `actions are guarded by phase`.*
4. **A shortlisted entry that gets removed or hidden during voting** can't win, isn't counted, and disappears from phones and the screen. *Test: Task 5 `removed shortlisted entry is dropped from contest status`, and Task 6 `removed entry never wins a reveal`.*
5. **The opening-time boundary and practice mode.** One second before 2026-12-26T16:00:00Z, moments are closed for entries; at that instant they open. With practice on, they're open whatever the date. *Test: Task 2 `contestOpen boundaries`.*

---

## File map

**Worker (`workers/photo-upload/`)**

| File | Responsibility |
|---|---|
| `package.json`, `package-lock.json` | dev dependencies (vitest, `@cloudflare/vitest-plugin`, wrangler); scripts `test`, `dev`, `standin`, `smoke` |
| `vitest.config.js` | test pool setup, test bindings, D1 migrations |
| `wrangler.toml` | modify: `nodejs_compat`, D1 binding `DB`, cron `* * * * *`, vars `GEMINI_MODEL` and `CONTEST_OPENS_AT` |
| `migrations/0001_contest.sql` | schema plus the six seeded moments |
| `src/index.js` | `fetch` and `scheduled` entry points; builds `svc` and routes |
| `src/http.js` | Fail, json, CORS, norm, secret compare, clean, stamp, ids, hashing (moved out of today's index.js) |
| `src/google.js` | Drive: token, resumable upload, small-file create, trash, media, thumbnail |
| `src/upload.js` | `/start`, `/chunk`, `/status` handlers (today's logic, plus entry hooks) |
| `src/store.js` | every D1 query |
| `src/contest.js` | pure rules: open, on-wall, shortlist ranking, tally, phase guard |
| `src/entries.js` | entry hooks, `/copy`, `/remove` |
| `src/gemini.js` | prompt, request, verdict parsing |
| `src/checks.js` | `runCheck` and the cron batch |
| `src/media.js` | signed links and `/m/...` serving |
| `src/public.js` | `/contest`, `/vote`, `/screen` |
| `src/admin.js` | `/admin/state` and `/admin/act` |
| `test/*.test.js`, `test/helpers.js`, `test/apply-migrations.js` | vitest suites and fakes |
| `test/standin.mjs` | local stand-in for Google token, Drive and Gemini (port 8788) |
| `test/smoke.mjs` | end-to-end run against `wrangler dev` with the stand-in |
| `test/gemini-live.mjs` | runs the real prompt on a folder of sample photos (paid; ask first) |
| `.dev.vars.example` | which local vars to set (no real values) |

**Pages (`docs/photos/`)**

| File | Responsibility |
|---|---|
| `lib/api.js` | API base (`?api=` override on localhost), XHR `call()`, saved passwords |
| `lib/sent.js` | the "Sent from this phone" list in localStorage (pure) |
| `lib/shrink.js` | `fitWithin` (pure) and `makeSmallCopy` (DOM) |
| `lib/contest-ui.js` | `momentLabel`, `pollDelay`, `deviceId` (pure) |
| `index.html` | modify: moment cards, Just share, Sent list, Vote, hashtag, album block removed; script moves to `app.js` |
| `app.js` | photos page wiring: unlock, uploader, sent list, contest cards, voting, polling |
| `screen/index.html`, `screen/screen.js`, `screen/qr.svg` | big screen |
| `control/index.html`, `control/control.js` | control page |

**Elsewhere**
- `tests/photos/*.test.mjs`: node tests for `docs/photos/lib`.
- `tools/photo_contest_setup.py`: small-copies folder, admin password, media key, Gemini key check, `--push`.

---

### Task 1: Test harness and split the Worker into modules (no behaviour change)

**Files:**
- Create: `workers/photo-upload/package.json`, `vitest.config.js`, `src/http.js`, `src/google.js`, `src/upload.js`, `test/helpers.js`, `test/apply-migrations.js`, `test/upload.test.js`, `test/google.test.js`
- Modify: `workers/photo-upload/src/index.js` (becomes the router), `wrangler.toml`

**Interfaces:**
- Produces, in `src/http.js`:
  - `class Fail extends Error { constructor(status, code, detail?) }`
  - `json(obj, status, origin) → Response`
  - `corsHeaders(origin) → object`. Allow-Headers gains `X-Admin-Password, X-Entry, X-Entry-Key`.
  - `norm(s) → string` (unchanged)
  - `secretMatches(given, expected) → Promise<boolean>`: constant time on `norm()` of both, and false when `expected` is empty.
  - `clean(s, max)` and `stamp(date)` (unchanged)
  - `randomId(bytes = 9) → string` (base64url)
  - `sha256hex(text) → Promise<string>`
- Produces, in `src/google.js`: `makeGoogle(env, fetchImpl = fetch) → Google`, with:
  - `token() → Promise<string>`
  - `startUpload({name, parents, description, appProperties, type, size}) → Promise<string /* session url */>`
  - `sessionUrl(raw) → string` (validates, as today)
  - `putPiece(session, range, bytes) → Promise<{next}|{done:true, file:{id,name}}>`
  - `pieceStatus(session, total) → same`
  - `createSmall({name, parents, type, bytes}) → Promise<{id}>`: Drive multipart upload.
  - `trash(id) → Promise<void>`
  - `media(id, range?) → Promise<Response>`: Drive `alt=media`, passing `Range` through.
  - `thumbnail(id) → Promise<Uint8Array|null>`: `files.get(fields=thumbnailLink)`, then fetches it with the bearer token; null if there's none yet.

  Also exported: `resetTokenCache()`, for tests. Base URLs come from `env.GOOGLE_TOKEN_URL`, `env.GOOGLE_UPLOAD_BASE` and `env.GOOGLE_API_BASE`, defaulting to Google's real ones.
- Produces, in `src/index.js`: `handle(request, env, ctx, svc) → Promise<Response>` and `makeSvc(env) → {db: env.DB, google: makeGoogle(env), gemini: null /* Task 4 */, now: () => Date.now()}`. The default export's `fetch` calls `handle(req, env, ctx, makeSvc(env))`.
- Produces, in `test/helpers.js`:
  - `fakeGoogle()`: an in-memory Google. `files` is a Map `id → {name, parents, bytes, trashed}`. It records `calls` and has `finishOn(session)`.
  - `fakeGemini(verdictFn)`
  - `svcFor({google, gemini, now})`
  - `req(method, path, {json, body, headers, password = 'ToMyJeyan', admin})`: sets `Origin: https://tomyjeyan.com`.
  - `resetDb()`

- [ ] **Step 1: Add the dev dependencies and test config.**
  - `package.json`: `"private": true, "type": "module"`, devDependencies pinned exactly: `vitest@5.1.0`, `@cloudflare/vitest-plugin@1.6.1`, `wrangler@4.159.0`. Scripts: `"test": "vitest run"`, `"dev": "wrangler dev"`, `"standin": "node test/standin.mjs"`, `"smoke": "node test/smoke.mjs"`.
  - Run `npm install` in `workers/photo-upload`.
  - `vitest.config.js` uses `cloudflareTest({ wrangler: { configPath: './wrangler.toml' }, miniflare: { bindings: {...test values} } })` with `readD1Migrations('./migrations')` passed as binding `TEST_MIGRATIONS`, and `setupFiles: ['./test/apply-migrations.js']`.
  - Test bindings: `PHOTO_PASSWORD='ToMyJeyan'`, `ADMIN_PASSWORD='test admin'`, `MEDIA_KEY='test-media-key'`, `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN='x'`, `DRIVE_FOLDER_ID='guest-folder'`, `COPIES_FOLDER_ID='copies-folder'`, `GEMINI_API_KEY='test-gemini'`.
  - If an import name differs in the installed version, follow `node_modules/@cloudflare/vitest-plugin/README.md`. In this version, test APIs come from `cloudflare:test` and `env` from `cloudflare:workers`.
  - `apply-migrations.js` calls `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)`.
  - Create an empty `migrations/0001_contest.sql` holding only `SELECT 1;` (Task 2 fills it).
- [ ] **Step 2: Update `wrangler.toml`.**
  - Add `compatibility_flags = ["nodejs_compat"]`.
  - Add `[[d1_databases]] binding = "DB", database_name = "tj-photo-contest", database_id = "00000000-0000-0000-0000-000000000000", migrations_dir = "migrations"`. That id is a placeholder until Task 12.
  - Add `[triggers] crons = ["* * * * *"]`.
  - Add `[vars] GEMINI_MODEL = "gemini-3.1-flash-lite"` and `CONTEST_OPENS_AT = "2026-12-26T16:00:00Z"`.
- [ ] **Step 3: Write failing tests that pin today's behaviour.**
  - `upload.test.js`:
    - `rejects a wrong password with 403 password`;
    - `ping reports drive:true when configured`;
    - `start names the file "<stamp> · <guest> · <original>" in the guest folder`. The fake receives `parents: ['guest-folder']` and `appProperties.source === 'tomyjeyan-photos'`;
    - `start refuses non-photo/video with 415`;
    - `chunk passes Content-Range through and returns {next}`;
    - `status returns {done, file}`.
  - `google.test.js`, with a fake `fetchImpl`:
    - `putPiece maps 308 Range bytes=0-8388607 to next 8388608`;
    - `maps 404 to Fail 410 session-expired`;
    - `sessionUrl rejects a non-Drive address with bad-session`;
    - `token is cached until a minute before expiry`;
    - `createSmall sends multipart with parents`;
    - `media forwards Range`;
    - `thumbnail returns null when thumbnailLink is missing`.
- [ ] **Step 4: Confirm they fail.** Run `npx vitest run`. Expected: FAIL, because the modules don't exist.
- [ ] **Step 5: Move today's code into the modules.** Move it into `http.js`, `google.js` and `upload.js` with today's logic intact, and add `createSmall`, `trash`, `media` and `thumbnail`. Turn `index.js` into the router (`handle`) and `makeSvc`.
- [ ] **Step 6: Confirm they pass.** Run `npx vitest run`. Expected: all PASS.
- [ ] **Step 7: Commit.** `git add workers/photo-upload && git commit -m "Photos: split the upload Worker into modules, with tests"`. Confirm `node_modules/` stays ignored.

### Task 2: Database schema, store and contest rules

**Files:**
- Create: `migrations/0001_contest.sql` (replacing the placeholder), `src/store.js`, `src/contest.js`, `test/contest.test.js`, `test/store.test.js`

**Interfaces:**
- **Schema** (snake_case columns; rows are returned as plain objects):
  - `moments(id TEXT PK, sort INT, title, hint, brief, phase TEXT DEFAULT 'entries', shortlist TEXT DEFAULT '[]', winner TEXT)`. `phase` is one of `entries|voting|closed|revealed`. `winner` is an entry id, `'none'` or NULL.
  - `entries(id TEXT PK, device, guest DEFAULT '', moment NULL REFERENCES moments, kind 'photo'|'video', mime, size INT, session_key TEXT UNIQUE, drive_id, copy_id, token_hash, check_state DEFAULT 'pending', check_tries INT DEFAULT 0, copy_tries INT DEFAULT 0, fit INT, quality INT, note, operator NULL, removed_at INT, practice INT DEFAULT 0, created_at INT)`.
    - `check_state` is one of `pending|shown|held|error`.
    - `operator` is NULL, `'shown'` or `'hidden'`.
    - Indexes on `(removed_at, created_at)` and `(moment)`.
  - `votes(moment, device, entry, practice INT DEFAULT 0, at INT, PRIMARY KEY(moment, device))`
  - `settings(key PK, value)`
  - `log(at INT, by TEXT, what TEXT)`

  **Seeds:** the six moments from Global Constraints, with these Gemini briefs:
  - `aisle`: "The bride, Jeyan, walking down the church aisle in her wedding gown, often escorted; guests in pews, church interior."
  - `entrance`: "The newlyweds Tommy and Jeyan making their grand entrance into the reception hall together."
  - `first-dance`: "The newlyweds dancing together on the reception floor."
  - `happy-tears`: "An emotional moment: tears, hugs or laughter during the parents' dances, speeches, a toast or family messages."
  - `showstopper`: "A stage performance at the reception: a production number, singers, musicians, dancers or a surprise act."
  - `groufie`: "A group selfie of guests together with the bride (wedding gown) and groom (formal wear)."
- **`src/store.js`** (all take `db` first):
  - `DEFAULT_SETTINGS = {contest:'auto', screen:'{"mode":"wall"}', skip_check:'0', practice:'0', snapshot:'', gemini_ok:'', gemini_err:''}`
  - `getSettings(db) → {contest, screen:{mode, moment?}, skipCheck:boolean, practice:boolean, snapshot, geminiOk:number|null, geminiErr:number|null}`
  - `putSetting(db, key, value)`
  - `listMoments(db) → Moment[]`, with `shortlist` parsed to an array
  - `getMoment(db, id)`
  - `updateMoment(db, id, {phase?, shortlist?, winner?})`
  - `createEntry(db, row)`
  - `getEntry(db, id)`
  - `entriesByIds(db, ids)`
  - `attachOriginal(db, sessionKey, driveId) → Entry|null`
  - `setCopy(db, id, copyId)`
  - `setCheck(db, id, {state, fit, quality, note})`
  - `bumpTries(db, id, column /* 'check_tries'|'copy_tries' */)`
  - `markRemoved(db, id, now)`: also deletes that entry's votes.
  - `setOperator(db, id, value)`
  - `recentEntries(db, limit)`: not removed, `drive_id` set, newest first.
  - `momentEntries(db, momentId)`
  - `pendingChecks(db, before, limit)`: `copy_id` set, state `pending|error`, `check_tries < 3`, `created_at < before`.
  - `missingCopies(db, before, limit)`: `drive_id` set, `copy_id` NULL, `copy_tries < 3`.
  - `castVote(db, {moment, device, entry, practice, now})`: upsert.
  - `voteCounts(db, moment) → [{entry, n}]`
  - `myVotes(db, device) → {[moment]: entry}`
  - `addLog(db, by, what, now)`
  - `recentLog(db, n)`
  - `practiceEntries(db)`
  - `deletePractice(db)`: removes practice entries and practice votes.
- **`src/contest.js`** (pure):
  - `contestOpen(settings, nowMs, opensAtIso) → boolean`
  - `acceptingEntries(moment, open) → boolean`, which is `open && moment.phase === 'entries'`
  - `onWall(entry, settings) → boolean`
  - `rankShortlist(entries, n = 5, fitMin = 5) → string[]`
  - `tally(shortlist, counts /* [{entry,n}] */, gone /* Set of removed or hidden ids */) → {counts:{[id]:n}, total, leaders:string[]}`
  - `assertPhase(moment, allowed) → void`: throws `Fail(409, 'wrong-phase')`.

- [ ] **Step 1: Write failing tests in `test/contest.test.js`.**
  - `contestOpen boundaries`:
    - `auto` gives false at `Date.parse('2026-12-26T15:59:59Z')` and true at `Date.parse('2026-12-26T16:00:00Z')`;
    - `open` gives true in 2026-11;
    - `closed` gives false on Dec 27;
    - practice gives true in 2026-11 even with `closed`.
  - `onWall rules`:
    - removed → false;
    - no `copy_id` or no `drive_id` → false;
    - operator `'hidden'` → false even when shown;
    - operator `'shown'` → true even when held;
    - state `'shown'` → true;
    - `skipCheck` with `'pending'` or `'error'` → true;
    - `'held'` with `skipCheck` → false.
  - `rankShortlist`:
    - given 8 entries, it returns 5 ids ordered by fit + quality, then `created_at`;
    - drops fit 4, removed, hidden and held entries;
    - keeps an operator-shown entry if its fit is ≥ 5;
    - takes only the best entry from a device that sent 3.
  - `tally`:
    - counts only shortlist ids not in `gone`;
    - `leaders` holds all ids tied at the max;
    - `total` sums the counted votes.
  - `assertPhase` throws a Fail with status 409 and code `wrong-phase`.
- [ ] **Step 2: Write failing tests in `test/store.test.js`.**
  - Migrations seed exactly the six ids, in order.
  - `getSettings` returns `DEFAULT_SETTINGS` values on an empty table.
  - `castVote` twice for the same `(moment, device)` keeps one row with the second entry.
  - `markRemoved` deletes the entry's votes.
  - `attachOriginal` finds the entry by `session_key`.
- [ ] **Step 3: Confirm they fail.** Run `npx vitest run test/contest.test.js test/store.test.js`. Expected: FAIL.
- [ ] **Step 4: Implement.** Write the migration, `store.js` and `contest.js`. `resetDb()` in helpers clears entries, votes, log and settings, and resets moments to `entries`/`[]`/NULL.
- [ ] **Step 5: Confirm they pass.** Run `npx vitest run`. Expected: all PASS.
- [ ] **Step 6: Commit.** `git commit -m "Photos: contest database and rules"`.

### Task 3: Entries on upload, small copy, remove

**Files:**
- Create: `src/entries.js`, `test/entries.test.js`, and `src/checks.js` as a stub exporting `runCheck(env, svc, entryId, jpeg) → Promise<'skipped'>`. Task 4 gives it a real body.
- Modify: `src/upload.js` (call the hooks), `src/index.js` (routes `POST /copy` and `POST /remove`)

**Interfaces:**
- `POST /start` accepts the existing body plus `moment` (an id or empty) and `device` (≤ 40 chars of `[A-Za-z0-9-]`).
  - It responds with the existing `{session, name}` plus `entry: string|null`, `key: string|null` and `moment: string|null`.
  - `moment` is null when the id is unknown or not accepting entries (`acceptingEntries` with `contestOpen`). The page then shows it as a plain share.
  - `key` is 32 hex chars; only its `sha256hex` is stored.
- When `PUT /chunk` or `GET /status` returns `done`, it calls `onOriginalDone(svc, session, fileId)`. If that entry is already removed, the file is trashed right away.
- `POST /copy`:
  - headers `X-Entry`, `X-Entry-Key`, `Content-Type: image/jpeg`; body ≤ 1.5 MB;
  - stores the copy via `google.createSmall({name: '<entry>.jpg', parents: [env.COPIES_FOLDER_ID]})`, then `setCopy`, then `ctx.waitUntil(runCheck(env, svc, entry, bytes))`;
  - responds `{ok:true}`. Errors: 403 `entry-key`, 413 `too-big`, 404 `no-entry`.
- `POST /remove {entry, key}`: trashes `drive_id` and `copy_id` when set, marks the entry removed, and responds `{ok:true}`. Removing twice still answers ok.
- `entries.js` exports `startEntry(env, svc, body, sessionUrl) → {entry, key, moment}|{entry:null, key:null, moment:null}`, `onOriginalDone`, `saveCopy` and `removeEntry`. `startEntry` and `onOriginalDone` catch every D1 error, log `contest-store` with no detail that could hold secrets, and never throw.

- [ ] **Step 1: Write failing tests in `test/entries.test.js`.**
  - `start with an open moment returns entry, key and moment`: settings `contest='open'`; the row has `moment='groufie'`, `practice=0` and `token_hash` ≠ key.
  - `start before opening time stores the entry as a plain share`: `now` is 2026-11-20 and `contest='auto'`, so the response has `moment: null`.
  - `start for a moment in voting stores a plain share`.
  - `start still returns a session when D1 throws`. Pass `svc.db` as a stub whose `prepare` throws; the response has `session`, `entry: null`, status 200.
  - `copy with the wrong key is 403 entry-key`.
  - `copy stores into the copies folder`: the fake Google gets `parents: ['copies-folder']`, and the row's `copy_id` is set.
  - `remove trashes both files and drops votes`.
  - `remove before the last piece lands trashes the original when it arrives`: remove, then a final `/chunk` that returns done, and the fake shows that file trashed.
- [ ] **Step 2: Confirm they fail.** Run `npx vitest run test/entries.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `entries.js` and wire it into `upload.js` and `index.js`. `session_key` is `sha256hex(session url)`.
- [ ] **Step 4: Confirm they pass.** Run `npx vitest run`. Expected: all PASS, including Task 1's upload tests unchanged.
- [ ] **Step 5: Commit.** `git commit -m "Photos: record entries, small copies and removal"`.

### Task 4: Gemini check and the once-a-minute job

**Files:**
- Create: `src/gemini.js`, `src/checks.js`, `test/gemini.test.js`, `test/checks.test.js`
- Modify: `src/index.js` (`makeSvc` adds `gemini: makeGemini(env)`, and a `scheduled` export)

**Interfaces:**
- `makeGemini(env, fetchImpl = fetch) → {check({jpeg: Uint8Array, moment: Moment|null}) → Promise<{wallOk:boolean, fit:number|null, quality:number, note:string}>}`.
  - It POSTs to `${env.GEMINI_BASE || 'https://generativelanguage.googleapis.com'}/v1beta/models/${env.GEMINI_MODEL}:generateContent` with header `x-goog-api-key`. The body holds `inline_data` (base64 via `node:buffer` Buffer) plus the prompt text, with `generationConfig: {temperature: 0, responseMimeType: 'application/json', responseSchema: {type:'OBJECT', properties:{wedding:BOOLEAN, screen_ok:BOOLEAN, fit:INTEGER, quality:INTEGER, note:STRING}, required:[all five]}}`.
  - It throws `Fail(502, 'gemini')` on an HTTP error or unparsable text.
- `buildPrompt(moment) → string` must state:
  - this is a guest's photo from Tommy and Jeyan's Catholic wedding and reception in the Philippines;
  - `wedding` means it was taken at the wedding;
  - `screen_ok` is false for screenshots, documents, memes, accidental shots (pocket, floor, ceiling, nearly black, blurred beyond recognition), nudity, rude gestures, or anything a couple would be embarrassed to see on their wedding screen;
  - `quality` (0–10) covers sharpness, light, framing and emotion;
  - `fit` (0–10) is how well it shows the moment brief, and is 0 when no moment is given;
  - `note` is at most 12 words, for the operator.
- `parseVerdict(apiJson, hasMoment) → verdict`:
  - `wallOk = wedding && screen_ok`;
  - clamps numbers to 0–10;
  - `fit = null` without a moment;
  - `promptFeedback.blockReason` or `finishReason === 'SAFETY'` gives `{wallOk:false, fit:0, quality:0, note:'blocked by Gemini'}` (not an error).
- `runCheck(env, svc, entryId, jpeg?) → Promise<'shown'|'held'|'error'|'skipped'>`:
  - It fetches the copy via `google.media(copy_id)` when `jpeg` is absent, and skips removed entries.
  - On success: `setCheck` and `putSetting('gemini_ok', now)`.
  - On a Fail: `bumpTries`, state `error`, and `putSetting('gemini_err', now)`.
- `runCron(env, svc) → {checked:n, thumbs:n}`:
  - `pendingChecks(now - 60_000, 8)`, then `runCheck` for each;
  - `missingCopies(now - 120_000, 4)`, then `google.thumbnail(drive_id)`. If there are bytes: `createSmall`, then `setCopy`, then `runCheck`. Otherwise `bumpTries(copy_tries)`.
  - `scheduled(controller, env, ctx)` calls `ctx.waitUntil(runCron(env, makeSvc(env)))`.

- [ ] **Step 1: Write failing tests.**
  - `gemini.test.js`, with a fake fetch:
    - `sends the key in x-goog-api-key and the model in the path` (the key must not appear in the URL);
    - `parses a good verdict`;
    - `blocked prompt becomes wallOk false without throwing`;
    - `HTTP 429 throws Fail gemini`;
    - `no moment gives fit null`.
  - `checks.test.js`, with `fakeGemini`:
    - `runCheck marks shown and records gemini_ok`;
    - `runCheck error bumps check_tries and records gemini_err`;
    - `cron retries pending checks older than a minute only`;
    - `cron stops after 3 tries`;
    - `cron uses the Drive thumbnail when no small copy arrived` (the fake thumbnail returns bytes, so `copy_id` gets set and the check runs);
    - `copy upload triggers an immediate check`: run `/copy`, then `waitOnExecutionContext`, and the state is `shown`.
- [ ] **Step 2: Confirm they fail.** Run `npx vitest run test/gemini.test.js test/checks.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `gemini.js` and `checks.js`, and wire `makeSvc` and `scheduled`.
- [ ] **Step 4: Confirm they pass.** Run `npx vitest run`. Expected: all PASS.
- [ ] **Step 5: Commit.** `git commit -m "Photos: Gemini check and the once-a-minute catch-up"`.

### Task 5: Signed media links, contest status, voting, screen feed

**Files:**
- Create: `src/media.js`, `src/public.js`, `test/public.test.js`, `test/media.test.js`
- Modify: `src/index.js` (routes)

**Interfaces:**
- **`media.js`:**
  - `mediaUrl(origin, key, id, kind /* 'copy'|'orig' */, nowMs) → string`. It returns `${origin}/m/${id}/${kind}?e=${exp}&s=${sig}`, where `exp` = the next whole hour + 6 h, in epoch seconds, and `sig` = base64url HMAC-SHA256(`MEDIA_KEY`, `${id}.${kind}.${exp}`), first 22 chars.
  - `verifyMedia(key, id, kind, exp, sig, nowMs) → Promise<boolean>`
  - `serveMedia(request, env, svc, ctx) → Response`:
    - needs no password;
    - answers 404 for a bad or expired signature, or a removed entry;
    - `copy` is served from `caches.default` (keyed on `/m/<id>/copy` without the query), otherwise from `google.media(copy_id)`, stored with `Cache-Control: public, max-age=86400`;
    - `orig` streams `google.media(drive_id, Range)` with status and `Content-Range` passed through, and isn't cached.
- **Item shape**, used by `/contest`, `/screen` and `/admin`: `{id, n?, kind, guest, moment: title|null, copy: url, orig: url}`.
- **`GET /contest?device=<id>`** (guest password) returns `{open, practice, opensAt, moments:[{id, title, hint, phase, accepting, shortlist:Item[] (only when phase ≠ entries; minus removed or hidden; n = position 1–5), myVote: id|null, winner: Item|null (only when revealed; null for 'none')}]}`. There are no vote counts here.
- **`POST /vote {moment, entry, device}`** (guest password):
  - 409 `voting-closed` unless the phase is `voting`;
  - 400 `not-on-shortlist` if the entry isn't on the shortlist, or is removed or hidden;
  - stores with the current `practice` flag;
  - returns `{ok:true, myVote: entry}`.
- **`GET /screen`** (guest password) returns `{mode, moment: {id, title, shortlist:Item[], votes:total, winner:Item|null}|null, wall: Item[] (up to 40 newest onWall, newest first), at: nowMs}`.

- [ ] **Step 1: Write failing tests.**
  - `media.test.js`:
    - `signature round-trips`;
    - `expired link is 404`;
    - `tampered id is 404`;
    - `removed entry is 404`;
    - `orig forwards Range and returns 206 from the fake`.
  - `public.test.js`:
    - `contest status hides shortlist while taking entries`;
    - `shortlist items are numbered 1–5 in stored order`;
    - `myVote reflects this device only`;
    - `vote while not voting is 409 voting-closed`;
    - `vote for an entry off the shortlist is 400`;
    - `changing a vote keeps one vote`;
    - `removed shortlisted entry is dropped from contest status`. The others keep their original n (#1, #3, #4, #5), so numbers guests already saw on the screen stay true;
    - `screen wall lists only onWall entries, newest first, max 40`;
    - `screen shortlist mode carries the vote total but no per-entry counts`.
- [ ] **Step 2: Confirm they fail.** Run `npx vitest run test/media.test.js test/public.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `media.js` and `public.js`, and add the routes.
- [ ] **Step 4: Confirm they pass.** Run `npx vitest run`. Expected: all PASS.
- [ ] **Step 5: Commit.** `git commit -m "Photos: signed media, contest status, voting and screen feed"`.

### Task 6: Control-page API (phases, screen, moderation, practice, log)

**Files:**
- Create: `src/admin.js`, `test/admin.test.js`
- Modify: `src/index.js` (routes `GET /admin/state` and `POST /admin/act`)

**Interfaces:**
- **Auth:** header `X-Admin-Password` checked with `secretMatches(…, env.ADMIN_PASSWORD)`. Otherwise 403 `admin-password`. The guest password isn't needed.
- **`GET /admin/state`** returns:
  - `{settings:{contest, open, skipCheck, practice}, screen:{mode, moment}, moments:[…], waiting: Item+{state, note}[] (held, error, or pending older than 5 min; not removed), wall: Item[] (30 newest onWall), counts:{sent, onWall, waiting}, gemini:{lastOk, lastError}, log:[{at, by, what}] (last 10)}`;
  - each of the `moments` is `{id, title, phase, shortlist: Item+{votes}[], candidates: Item+{fit, quality, note}[], tally, winner}`;
  - `candidates` is `rankShortlist` order first, then every other non-removed entry with a `drive_id` from any moment or plain share, newest first, 30 at most.
- **`POST /admin/act {action, by, …}`** returns the new admin state and writes `addLog(by, '<what happened>')`. The actions:
  - `screen {mode: 'wall'|'shortlist'|'winner', moment?}`: shortlist and winner need a moment.
  - `open-voting {moment, shortlist: id[1..5]}`: from `entries` or `closed`. The ids must be non-removed entries with a `drive_id`.
  - `close-voting {moment}`: from `voting`.
  - `reveal {moment, winner?}`:
    - from `closed`, `winner` is optional unless `tally.leaders.length > 1`, in which case it must be one of the leaders. Otherwise 400 `pick-a-winner`, with the leaders in the error body;
    - from `entries`, `winner` is required: an id, or `'none'`. This is the direct award or the no-winner case;
    - it sets the phase to `revealed`, sets the winner, and sets the screen to `{mode:'winner', moment}`.
  - `hide {entry}`, `show {entry}` (operator overrides).
  - `remove {entry}`: the same as a guest remove (trash both files, mark removed).
  - `settings {contest?: 'auto'|'open'|'closed', skipCheck?: boolean}`.
  - `practice-start`: snapshots `listMoments` phases, shortlists and winners, plus the screen, into `snapshot`, then sets `practice='1'`.
  - `practice-clear`:
    - trashes the files of every practice entry;
    - calls `deletePractice`;
    - restores the snapshot, sets `practice='0'` and clears `snapshot`.
- `by` is the operator's name from the control page, clipped to 30 characters.

- [ ] **Step 1: Write failing tests in `test/admin.test.js`.**
  - `wrong admin password is 403`.
  - `guest password alone is 403`.
  - `actions are guarded by phase`:
    - `close-voting` while in `entries` gives 409 `wrong-phase`;
    - `open-voting` twice gives 409 the second time;
    - `reveal` twice gives 409 the second time.
  - `open-voting freezes the given shortlist`.
  - `reveal with a tie needs a winner from the leaders` (400 `pick-a-winner` without one; 400 for a non-leader).
  - `removed entry never wins a reveal`: the removed entry had the most votes, and the next leader wins.
  - `reveal from entries with winner none sets revealed with winner none`.
  - `reveal moves the screen to winner mode`.
  - `practice round trip`:
    - start practice;
    - create 2 entries and 1 vote (practice=1) and open voting;
    - clear practice;
    - the entries and votes are gone, the fake shows their files trashed, phases are back to `entries`, and practice is off;
    - a non-practice entry created before practice survives.
  - `every action writes a log line with by`.
  - `candidates include plain shares for topping up`.
- [ ] **Step 2: Confirm they fail.** Run `npx vitest run test/admin.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `admin.js` and add the routes.
- [ ] **Step 4: Confirm they pass.** Run `npx vitest run`. Expected: all PASS.
- [ ] **Step 5: Commit.** `git commit -m "Photos: control-page API with run-sheet actions and practice mode"`.

### Task 7: Local stand-in and smoke run

**Files:**
- Create: `test/standin.mjs`, `test/smoke.mjs`, `.dev.vars.example`
- Modify: `workers/photo-upload/src/index.js` header comment (the new endpoint list)

**Interfaces:**
- **`standin.mjs`:** a Node `http` server on `127.0.0.1:8788`, holding everything in memory:
  - `POST /token` returns `{access_token:'standin', expires_in:3600}`.
  - Resumable `POST /upload/drive/v3/files?uploadType=resumable` returns a `Location` session. A `PUT` to it returns 308 with Range until complete, then 200 `{id, name}`.
  - Multipart `POST /upload/drive/v3/files?uploadType=multipart` returns `{id}`.
  - `GET /drive/v3/files/:id?alt=media` returns the bytes, honouring Range.
  - `PATCH /drive/v3/files/:id` with `{trashed:true}`.
  - `GET /drive/v3/files/:id?fields=thumbnailLink` returns a link back to the stand-in.
  - `POST /v1beta/models/:model:generateContent` returns `screen_ok:false` when the decoded image is under 20 KB (a black frame compresses tiny), and otherwise `{wedding:true, screen_ok:true, fit:7, quality:6, note:'stand-in'}`.
  - `GET /_files` lists stored files, for checks.
- **`.dev.vars.example`** lists every var: the guest and admin passwords, `MEDIA_KEY`, the Google trio, the folders, and `GEMINI_API_KEY`, all with dummy values. It also points `GOOGLE_TOKEN_URL=http://127.0.0.1:8788/token`, `GOOGLE_UPLOAD_BASE=http://127.0.0.1:8788/upload`, `GOOGLE_API_BASE=http://127.0.0.1:8788` and `GEMINI_BASE=http://127.0.0.1:8788` at the stand-in. Copy it to `.dev.vars` (already gitignored).
- **`smoke.mjs`:** runs against `SMOKE_API` (default `http://127.0.0.1:8787`).
  - **Passwords:** read from `.dev.vars` for localhost. For any other API, they come from the main checkout's `.env` (`PHOTO_ADMIN_PASSWORD`, located via `git rev-parse --git-common-dir`), and are never printed.
  - **Practice only, so it's safe on production:**
    1. admin `practice-start`;
    2. `/start` for `groufie`;
    3. `/copy` with a 30 KB JPEG fixture (generated in the script, as noise pixels);
    4. `/chunk` for the whole file;
    5. admin `show {entry}`, so the result doesn't depend on Gemini's verdict;
    6. checks `/screen` lists the entry;
    7. admin `open-voting`;
    8. `/vote`;
    9. admin `close-voting`;
    10. `reveal`;
    11. checks `/screen` mode is `winner`;
    12. `/remove`;
    13. checks `/screen` no longer lists it;
    14. admin `practice-clear`.

    It prints `SMOKE OK` or the first failing step, and still runs `practice-clear` when a step fails.

- [ ] **Step 1: Write the stand-in, the vars example and the smoke script.**
- [ ] **Step 2: Start the local stack.** In separate terminals:
  - run `npm run standin`;
  - run `npx wrangler d1 migrations apply tj-photo-contest --local`, then `npm run dev`.
- [ ] **Step 3: Run `npm run smoke`.** Expected: `SMOKE OK`.
- [ ] **Step 4: Commit.** `git commit -m "Photos: local stand-in for Google and Gemini, and a smoke run"`.

### Task 8: The photos page (moments, Just share, Sent list, Vote, #SoaringWithTJ)

**Files:**
- Create: `docs/photos/lib/api.js`, `lib/sent.js`, `lib/shrink.js`, `lib/contest-ui.js`, `docs/photos/app.js`, `tests/photos/sent.test.mjs`, `tests/photos/shrink.test.mjs`, `tests/photos/contest-ui.test.mjs`
- Modify: `docs/photos/index.html`

**Interfaces:**
- **`lib/api.js`:**
  - `apiBase(loc) → string`: `https://upload.tomyjeyan.com`, or a localhost `?api=` value.
  - `call(base, method, path, {json, body, headers, progress, password, admin}) → Promise<{ok, status, body}>`: XHR, 120 s timeout, sets `X-Photo-Password` and/or `X-Admin-Password`.
  - `norm(s)`, which mirrors the Worker's.
- **`lib/sent.js`:**
  - `SENT_KEY = 'tj-photos-sent'`
  - `loadSent(storage) → SentItem[]`
  - `saveSent(storage, items)`: newest first, capped at 200, drops `thumb` from items past 60.
  - `upsertSent(items, item) → items`
  - `markRemoved(items, entry) → items`
  - `SentItem = {local, entry|null, key|null, moment|null, kind, thumb|null, at, state: 'sending'|'sent'|'failed'|'removed'}`
- **`lib/shrink.js`:**
  - `fitWithin(w, h, max = 1600) → {w, h}`: never upscales, rounds.
  - `makeSmallCopy(file, kind) → Promise<{copy: Blob, thumb: string}|null>`:
    - photos use `createImageBitmap(file, {imageOrientation: 'from-image'})`;
    - videos use a muted, playsinline `<video>` seeked to `min(1, duration/3)`;
    - `null` on any failure or after 10 s.
- **`lib/contest-ui.js`:**
  - `momentLabel(moment, open) → 'Opens December 27'|'Open'|'Voting now'|'Closed'`. `closed` and `revealed` both give "Closed"; not open with phase `entries` gives "Opens December 27".
  - `pollDelay(moments, visible) → ms|null`: 60000, or 20000 when any moment is in `voting`; `null` when not visible.
  - `deviceId(storage, rand = crypto.getRandomValues) → string`: 16 hex chars, kept at `tj-photos-device`.
- **`app.js`** keeps today's unlock (vault), queue, piece, retry and wake-lock logic and adds:
  - `moment` and `device` on `/start`;
  - making the small copy in parallel with the pieces, then `POST /copy` (failures ignored);
  - an inline Remove confirm, which cancels an in-progress upload (abort the XHR, drop it from the queue) before `POST /remove`;
  - moment cards and the Vote section built from `/contest`;
  - polling with `pollDelay` and `visibilitychange`.

**Markup changes in `index.html`:**
- Name label: drop "optional". New hint: "Needed for the contest, so we know who to crown."
- A **contest** section of six cards, in seed order: title, hint, `momentLabel`, and one button "Send a shot for this moment" (an `<input type=file accept="image/*,video/*">` without `capture`). Tapping with an empty name focuses the name field and shows "Add your name first so we know who won."
- A **Just share** section with today's three buttons.
- The **Sent from this phone** list replaces today's queue and is restored from `loadSent` on unlock.
- A **Vote** section, shown only when a moment is voting: five numbered thumbnails, a full-screen viewer (video plays `orig`), and a Vote button.
- Remove the `#album-wrap` block. Keep the vault, because unlock still decrypts it to check the password.
- Change the hashtag in the meta description, og:site_name, og:description and the line "Posting online too? Tag **#SoaringWithTJ**."
- Change `MESSAGES['drive-refused']` to "We can't take more right now. Please tell the coordinator!"

- [ ] **Step 1: Write failing node tests.**
  - `shrink.test.mjs`:
    - `fitWithin(4000,3000)` → `{w:1600,h:1200}`;
    - `fitWithin(1080,1920)` → `{w:900,h:1600}`;
    - `fitWithin(800,600)` → `{w:800,h:600}`.
  - `sent.test.mjs`:
    - a round trip through a fake storage;
    - the 200 cap;
    - thumbs dropped past 60;
    - `markRemoved` sets state;
    - a corrupt JSON value gives `[]`.
  - `contest-ui.test.mjs`:
    - `momentLabel` for all phases, open and not;
    - `pollDelay` gives 60000, 20000 and null;
    - `deviceId` is stable across calls and 16 hex chars.
- [ ] **Step 2: Confirm they fail.** Run `node --test tests/photos/` from the repo root. Expected: FAIL, because the modules are missing.
- [ ] **Step 3: Implement the lib modules.** Run `node --test tests/photos/`. Expected: PASS.
- [ ] **Step 4: Rebuild `index.html` and `app.js`** as described above. Use `<script type="module" src="app.js">`.
- [ ] **Step 5: Browser check against the local stack** (Task 7 stack running). Serve `docs/` with `py -m http.server 8000` via the preview tool and open `http://localhost:8000/photos/?api=http://127.0.0.1:8787`.
  1. Unlock with ToMyJeyan; there are six cards. With settings `contest='auto'`, all say "Opens December 27".
  2. Set admin `contest='open'`. Within 60 s, or on reload, the cards say "Open".
  3. Send a photo to Groufie. It becomes "Sent ✓", then "In the contest: Groufie with the newlyweds". It survives a reload.
  4. **Remove** shows the inline prompt. Removing makes the stand-in `/_files` show both files trashed.
  5. `uploader sends the original when the small copy fails`: pick a `.heic`-named JPEG with garbage bytes. The original still sends, and the console has no uncaught error.
  6. Open voting via the smoke script's admin call. The Vote section appears, a vote shows "You voted for #1", and changing it works.
  7. At 375 px width there's no horizontal scroll, and keyboard focus is visible on every control.
- [ ] **Step 6: Commit.** `git commit -m "Photos: contest moments, sent list with remove, voting, #SoaringWithTJ"`.

### Task 9: The big screen

**Files:**
- Create: `docs/photos/screen/index.html`, `docs/photos/screen/screen.js`, `docs/photos/screen/qr.svg`

**Interfaces:**
- Consumes `GET /screen` (Task 5) through `lib/api.js`. The password is entered once and saved as `tj-photos-pw`, the same key as the photos page. A 403 brings the password form back.
- `qr.svg`: run `py tools/make_photo_qr.py`, then copy `.tmp/photo-qr/photo-qr.svg`. Afterwards, `git diff planning/` must show no unintended change.

**Behaviour:**
- **Fixed 16:9 layout,** filling the viewport, with a "Full screen" button that hides itself once full screen. Uses the wake lock.
- **Wall mode:**
  - one large featured tile rotating every 8 s through the 12 newest;
  - a grid of up to 12 more;
  - each tile shows the guest name and the moment title (or nothing for plain shares);
  - videos show their frame with a play badge;
  - the corner carries `#SoaringWithTJ` and the QR with "Share yours at tomyjeyan.com/photos".
- **Shortlist mode:** the moment title, five numbered tiles, "Vote now at tomyjeyan.com/photos" with the QR, and "<N> votes so far".
- **Winner mode:** "Winner · <title>", the winning tile large (a video plays muted on a loop from `orig`), and the guest's name. For winner `none`: "No entries for this one."
- **Polling** every 5 s. On a network error it keeps the last good state and shows a small "Reconnecting…" note after 3 failures in a row. Images are preloaded before swapping.
- Same tokens and fonts as the photos page, with `noindex`.

- [ ] **Step 1: Build the page.**
- [ ] **Step 2: Browser check at 1920×1080 against the local stack:**
  - with 3 smoke entries the wall rotates;
  - admin `screen {mode:'shortlist', moment:'groufie'}` switches within 5 s and shows the vote total;
  - `reveal` shows the winner;
  - stop the Worker: the screen keeps the last state and shows "Reconnecting…";
  - start the Worker again: it recovers.
- [ ] **Step 3: Commit.** `git commit -m "Photos: big-screen wall, shortlist and winner"`.

### Task 10: The control page (run sheet, two phones, practice)

**Files:**
- Create: `docs/photos/control/index.html`, `docs/photos/control/control.js`

**Interfaces:**
- Consumes `GET /admin/state` and `POST /admin/act` (Task 6). The admin password is saved as `tj-photos-admin`. The operator's name is asked once ("Who's running this phone?") and saved as `tj-photos-operator`, then sent as `by`.

**Behaviour:**
- Built for one phone, with big buttons and no fiddly parts. Two tabs: **Run sheet** (the default) and **Everything**.
- **Run sheet:** the night's steps in order. The step that comes next is highlighted (worked out from phases and screen), and finished steps are ticked.
  1. "Before the program: the wall is on" with [Show the wall].
  2. "When the host announces voting" with [Open voting]. This opens a review of each moment's proposed shortlist (from `candidates`), with swap and add controls, then "Looks good, open voting" per moment, or "Open all".
  3. For each moment in order:
     - [Show the shortlist on screen];
     - [Close voting];
     - [Reveal winner]. On a 400 `pick-a-winner` it shows the tied entries to choose from.

     A moment with 1 entry offers "Award directly". A moment with 0 offers "No winner".
  4. "After the awarding" with [Back to the wall].
- **Everything:**
  - the screen mode buttons;
  - every moment's phase controls and real counts;
  - **Waiting for a check**, each with Show / Keep hidden;
  - **On the wall now**, each with Hide and Remove (inline confirm);
  - the switches: contest Auto/Open/Closed and "Show new photos without checking";
  - Gemini health ("Gemini last answered 2 min ago" or the last error time);
  - the last 10 log lines, for example "Coordinator · Reveal: The first dance · 8:42 PM".
- **Practice:**
  - a "Start practice" button;
  - while practice is on, a fixed banner on every view: "Practice: nothing here is real. Clear practice when you're done.";
  - "Clear practice" with an inline confirm.
- **Two phones:** state polls every 5 s and after every action, so a second phone (Tommy's) follows within 5 s and the log shows who did what. A 409 `wrong-phase` shows "Someone already did that. Updated." and refreshes.

- [ ] **Step 1: Build the page.**
- [ ] **Step 2: Browser check against the local stack, with two tabs as two phones (375 px):**
  - run the whole run sheet on smoke entries;
  - check the tie path: two entries, one vote each;
  - check the 1-entry "Award directly" path;
  - the second tab follows within 5 s, and a double reveal from the second tab shows "Someone already did that";
  - start practice, add entries from the photos page, clear practice, and confirm the stand-in shows those files trashed and phases are reset.
- [ ] **Step 3: Commit.** `git commit -m "Photos: control page with run sheet, two-phone sync and practice mode"`.

### Task 11: Setup tool, Tommy's accounts, real-Gemini sample check

**Files:**
- Create: `tools/photo_contest_setup.py`, `workers/photo-upload/test/gemini-live.mjs`

**Interfaces:**
- **`photo_contest_setup.py`** finds the main checkout as the parent of `git rev-parse --git-common-dir`, so it always reads and writes the main checkout's `.env`, even when it runs from a worktree. It uses the `PHOTO_GOOGLE_*` refresh token with scope `drive.file`, exactly as `photo_drive_setup.py` does. It prints only names and ok/fail, never values.
  1. Creates or reuses the folder "Tommy & Jeyan · Screen copies (safe to ignore)", and saves `PHOTO_COPIES_FOLDER_ID`.
  2. Generates `PHOTO_ADMIN_PASSWORD` if it's missing: 4 random words from a built-in list of 64 short words plus 2 digits, joined with spaces. It never prints it, and tells Tommy to read it from `.env`.
  3. Generates `PHOTO_MEDIA_KEY` if it's missing (`secrets.token_urlsafe(32)`).
  4. Checks `GEMINI_API_KEY` is in `.env` and calls the free models list (`GET /v1beta/models`) to confirm the key works and `gemini-3.1-flash-lite` is listed. If the model isn't listed, it prints the Flash-Lite names that are, so `GEMINI_MODEL` can be updated.
  5. `--push` sends `GEMINI_API_KEY`, `ADMIN_PASSWORD`, `MEDIA_KEY` and `COPIES_FOLDER_ID` to the Worker with `npx wrangler secret bulk`, fed JSON on stdin from `workers/photo-upload`. Values never touch disk or output. If `bulk` refuses stdin, it falls back to `secret put` per name, also over stdin.
- **`gemini-live.mjs <folder> [--moment <id>]`** runs `makeGemini` from `src/gemini.js` on each JPEG in the folder and prints `file → wallOk fit quality note`. It reads `GEMINI_API_KEY` from the main checkout's `.env` the same way.

- [ ] **Step 1: Write the tool and the script.**
- [ ] **Step 2: Tommy's steps (he does these himself; Claude only guides):**
  - In Google Cloud Billing, link a billing account to project `tj-wedding-photos-514217`, and add a budget of US$5 with email alerts.
  - In Google AI Studio → API keys, create a key in project `tj-wedding-photos-514217`, then paste `GEMINI_API_KEY=…` into the main checkout's `.env`.
  - Upgrade Cloudflare to Workers Paid before Dec 13.
- [ ] **Step 3: Run the setup tool.** Run `py tools/photo_contest_setup.py` (no push yet). Expected: four "ok" lines and no secret values in the output.
- [ ] **Step 4: Real sample check (ask Tommy first; about 30 calls, under US$0.05).**
  - Collect 20 wedding-style photos from the main checkout's `.tmp/invitation-assets`, plus 10 junk shots: black frame, a screenshot of the site, a blurred floor, a receipt.
  - Run `node test/gemini-live.mjs <folder>`.
  - Expected: every junk shot has wallOk false, and at least 18 of 20 wedding photos have wallOk true.
  - If not, adjust `buildPrompt`, rerun the Task 4 tests, and ask again before rerunning live.
- [ ] **Step 5: Commit.** `git commit -m "Photos: contest setup tool and a live Gemini sample check"`. Only the tool and script are committed, never `.env`.

### Task 12: Deploy, phone test, hand over

Every step here changes something live. **Ask Tommy before starting**, and again before step 4.

- [ ] **Step 1: Create the database.**
  - Run `npx wrangler d1 create tj-photo-contest`, then put the returned `database_id` into `wrangler.toml`. The id isn't a secret.
  - Run `npx wrangler d1 migrations apply tj-photo-contest --remote`.
  - Commit `"Photos: real contest database id"`.
- [ ] **Step 2: Deploy the Worker.**
  - Run `py tools/photo_contest_setup.py --push`, then `npx wrangler deploy` from `workers/photo-upload`.
  - Check that `GET /ping` returns `drive:true` and that the **current live page** still uploads: run the e2e upload script from the scratchpad (`e2e_upload_test.py`), which trashes its file. Expected: `END TO END OK`.
- [ ] **Step 3: Try it live in practice mode, before the pages ship.**
  - Use the control page locally (`http://localhost:8000/photos/control/`, against the default production API, with no `?api=`).
  - Run `npm run smoke` against production with `SMOKE_API=https://upload.tomyjeyan.com`. It starts and clears practice itself.
  - Expected: `SMOKE OK`; the Drive folders hold none of the practice files; the contest setting is still `auto`.
- [ ] **Step 4: Ship the pages** (ask Tommy). Merge the branch into `master` and push. Wait about a minute for GitHub Pages, then load tomyjeyan.com/photos/, /photos/screen/ and /photos/control/.
- [ ] **Step 5: Phone test with Tommy, in practice mode.** On the S23 Ultra and an iPhone:
  - a photo and a 4K video to a moment, and a gallery multi-pick to Just share;
  - Remove;
  - vote;
  - the run sheet on the coordinator's phone with Tommy's phone following;
  - the screen on a laptop.

  Then Clear practice.
- [ ] **Step 6: Hand over.**
  - Update the `wedding-photo-uploader` memory: the contest is live, plus the D1 name, the new secrets' names (not values), and how to run practice.
  - Offer Tommy a `workflows/photo_contest_night.md` SOP for the coordinator. **Only write it if he says yes.**
  - Remind him of the Dec 13 rehearsal and the Dec 20 freeze.

---

## Self-review notes

- **Coverage** against the spec's sections:
  - §3 decisions: Tasks 2, 3, 5, 6, 8.
  - §4 calls:
    - 2 (opens itself): Task 2;
    - 3 (entries until voting): Task 3;
    - 4 (one spot each): Task 2;
    - 5–6 (small copies, copies folder): Tasks 3, 8, 11;
    - 7 (hold, skip-check switch): Tasks 2, 4, 6, 10;
    - 8 (no rejection label): Task 8 copy;
    - 9 (counts hidden): Task 5;
    - 10 (ties): Task 6;
    - 11 (videos): Tasks 5, 8, 9;
    - 12 (passwords): Tasks 5, 6;
    - 13 (album off): Task 8;
    - 14 (model var): Tasks 1, 4, 11;
    - 15 (short shortlists): Tasks 6, 10;
    - 16 (one moment): schema;
    - 17 (operator remove): Task 6;
    - 18 (polling): Tasks 8–10.
  - §5.6 run sheet, two phones and practice: Tasks 6, 10.
  - §9 hashtag: Tasks 8, 9.
  - §5.5 secrets and folder: Task 11.
  - §8 rollout: Task 12.
- The rehearsal (Dec 13) and the freeze (Dec 20) are dates for Tommy, not tasks.
