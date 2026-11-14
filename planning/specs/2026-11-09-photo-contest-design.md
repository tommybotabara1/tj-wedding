# Photo contest and live wall: design

Date: 2026-11-09 · Status: **approved by Tommy, 2026-11-09**, with his notes folded into sections 5.6 and 9.
Builds on: the guest uploader that went live on 2026-11-09
(`docs/photos/index.html` → Worker `workers/photo-upload` at upload.tomyjeyan.com → Tommy's Drive folder).

Lives in `planning/`, not `docs/superpowers/`, because everything under `docs/` is the live website.

---

## 1. Why

Guests can already send photos and videos from tomyjeyan.com/photos straight to Tommy's Google Drive, with no sign-in. That leaves two gaps:

1. Guests can't see what they sent, and they can't take back a shot they didn't mean to send.
2. Nothing gives a guest a reason to use the page instead of keeping everything in their own camera roll.

The fix is to make sending part of the night. Guests try to capture six moments. Gemini picks a shortlist for each moment, the guests vote, and winners are awarded during the reception program. Meanwhile a live wall on the big screen shows what everyone is sending, and Gemini keeps irrelevant shots off it.

Tommy and Jeyan end up with far more of their day as the guests saw it, all in one Drive folder.

**Success looks like this:**
- Every one of the six moments gets enough entries for a shortlist of five.
- Nothing embarrassing or irrelevant reaches the big screen.
- The coordinator runs the awarding from their phone, without needing Tommy or Jeyan.
- Uploading stays at least as reliable as it is today.

## 2. Goals, non-goals, anti-goals

**Goals**
- Six contest moments on the photos page, each with its own button for taking or sending a photo or video.
- A "Sent from this phone" list showing what each guest sent, with a way to remove any of it.
- Gemini checks every upload. It keeps irrelevant shots off the wall and scores contest entries for a shortlist.
- Guests vote on their phones from each moment's shortlist.
- A big-screen page with three modes: the live wall, a moment's shortlist, and that moment's winner.
- A private control page for whoever runs the night: switch what the screen shows, open and close voting, adjust shortlists, hide anything instantly.

**Non-goals**
- Cheat-proof voting. One vote per phone per moment is enough for a wedding.
- Prizes, certificates or scoring beyond "who won each moment."
- Editing or filtering photos.
- A public gallery after the wedding. That's the separate post-wedding album plan.
- Face recognition, guest accounts, or any app install.

**Anti-goals.** Each of these counts as a failure even if everything else works:
- Uploading gets slower or flakier than it is today, or the contest parts break the plain uploader.
- Something embarrassing shows on the big screen.
- A guest needs a Google account, an app, or a second password.
- Tommy or Jeyan have to touch a phone during the reception.
- A secret ends up in the public repo, a log line or the chat.
- A bill surprises Tommy.

## 3. Decided by Tommy

These came from Tommy directly, or from the playback he confirmed on 2026-11-09 ("yup you got it").

- **The six moments**:

  | # | Moment | What guests try to catch | When |
  |---|---|---|---|
  | 1 | Here comes the bride | Jeyan's walk down the church aisle | Church, from ~1:00 PM |
  | 2 | The grand entrance | Tommy and Jeyan's entrance to "I See the Light" | Reception, Part 1 |
  | 3 | The first dance | "I Was Made for Lovin' You" | Part 1 |
  | 4 | Happy tears | The father–daughter and mother–son dances, the speeches, the toast, the family messages | All evening |
  | 5 | Showstopper | The "Soaring with TJ" production number, the special musical number, the Botabara Cousins, the TJR surprise | All evening |
  | 6 | Groufie with the newlyweds | A group selfie with Tommy and Jeyan | Dinner & Photos with the Couple |

  Everything else goes to the wall as a plain share, for example the cake slicing, Part 3 and the dance floor.
- **Announcing it:** guests hear about the contest before the program starts. There's a QR at the entrance and on every table, and the host announces it.
- **When winners are announced:** the awarding happens during the program. Tommy, Jeyan and the coordinator will pick the slot later, so **nothing in the system runs on the program clock.** Voting opens and closes when someone taps a button.
- **How winners are picked:** Gemini picks a shortlist of the **top 5** per moment. Guests vote, **one vote per phone per moment**, and the most votes wins. **Tommy and Jeyan break ties.**
- **Names:** contest entries need the guest's name, so they know who won. Plain shares don't.
- **The big screen** shows the live wall, plus the contest at awarding time.
- **Gemini filters** irrelevant photos off the wall.
- **Removing:** a guest can see what they sent from their phone and remove any of it. Removing takes it off the wall and out of the contest, and moves the file to the Drive bin, where Tommy can still recover it for 30 days.
- **Running the night:** the coordinator or a trusted friend uses a private control page on their phone. Tommy and Jeyan don't run anything.

## 4. My calls (Claude). Tommy can overrule any of these.

1. **This document lives in `planning/specs/`.** Anything under `docs/` is published on tomyjeyan.com.
2. **The contest opens by itself at 00:00 on Dec 27, Philippine time.** Until then the moment buttons say "Opens December 27." Plain sharing stays open all the time, as it is now. The control page can open or close the contest early, which is useful for testing.
3. **A moment takes entries until its voting opens.** After that, a photo for that moment still goes to Drive and the wall, but it isn't in the contest. That gives the church moment the whole afternoon for gallery uploads, in case signal at the church is bad.
4. **Unlimited entries, one spot on the shortlist each.** Guests can send as many shots as they like. A shortlist takes at most one entry per phone, the highest-scoring one, so a single eager guest can't fill all five spots.
5. **The phone makes a small copy of each upload:** about 1600 px on the long edge, as a JPEG. For a video it's one still frame. The wall, the vote lists and Gemini all use the small copy, never the original. This makes everything fast on venue signal and keeps Gemini cheap. The original still goes to Drive untouched.
6. **The small copies live in Drive too,** in a second folder kept apart from the guest folder so they don't clutter it, named along the lines of "Screen copies (safe to ignore)". This avoids extra Cloudflare products like R2 that need billing set up.
7. **Photos wait for Gemini's check before they show on the wall.** If Gemini is down, new photos wait in a "Waiting for a check" list on the control page, where the operator can approve them by hand. There's also an emergency switch, "Show new photos without checking," that's off by default.
8. **Guests are never told whether their photo made the wall.** Their list just says "Sent ✓" and, for contest entries, "In the contest: *moment*." A rejection label at a wedding would sting.
9. **Vote counts stay hidden** on phones and on the screen until the winner is revealed. The screen shows only "*N* votes so far." The control page sees the real counts. A guest can change their vote until voting closes.
10. **Ties:** the control page shows the tied entries and the operator picks one, after asking Tommy and Jeyan.
11. **Videos:** the wall and shortlist show a video's still frame with a play badge. Tapping it on a phone plays the original. A winning video plays muted on a loop on the big screen; the hall's sound system handles program audio, so sound from the screen is out of scope.
12. **The screen page uses the guests' password** (ToMyJeyan), since it only shows what everyone can already see. **The control page has its own password**, which is a Worker secret.
13. **The Google Photos album button comes off the photos page for now.** The album is empty and separate from Drive, and the current copy ("where everyone's photos are together") is misleading. It comes back after the wedding under the post-wedding plan.
14. **Gemini model:** use the cheapest current Flash-Lite model that reads images. On 2026-11-09 the pricing page listed `gemini-3.1-flash-lite` at US$0.25 per million input tokens. Keep the model name in a Worker setting rather than in the code, and confirm it against the API's model list once the key exists. One check is about 1,500 tokens, so roughly US$0.0005 per photo, or about US$0.50 for 1,000 uploads.
15. **Short shortlists:** a shortlist holds however many entries fit the moment, up to 5.
    - The operator can top it up with any other photo sent that night, including plain shares.
    - With only one entry, the operator can skip voting and award it directly.
    - With none, the moment is marked "no winner" and the awarding skips it.
16. **One moment per entry.** There's no moving an entry to another moment. A guest who picked the wrong one removes it and sends it again.
17. **The operator can remove too,** not only hide. The control page has Hide (off the screen) and Remove (off the screen, out of the contest, both files to the Drive bin). That covers a guest who cleared their phone or switched devices.
18. **Light polling,** because one night's traffic must stay well inside Cloudflare's free 100,000 requests a day. Expected load is about 130 guests from the guest list, so roughly 100 phones.
    - Phones check status every 60 s, and every 20 s only while a vote is open. Either way, only while the page is on screen.
    - The screen checks every 5 s.
    - The control page checks every 5 s, and only while it's open.

## 5. How it works

### 5.1 The photos page (`docs/photos/index.html`, same URL, same printed QR)

After the password, from top to bottom:

1. **Your name.** It's still remembered on the phone. The page says it's needed for the contest.
2. **The contest.** Six moment cards, in program order. Each card has:
   - the title and a one-line hint (table above);
   - one button, **"Send a shot for this moment."** It opens the phone's own menu (camera, video or gallery), using an `accept="image/*,video/*"` input without `capture`;
   - its status: "Opens December 27", "Open", "Voting now" or "Closed".

   Tapping a moment with no name filled in asks for the name first.
3. **Just share.** Today's three buttons (Take a photo, Record a video, From your gallery), for everything that isn't a contest moment.
4. **Sent from this phone.** Today's queue becomes a lasting list:
   - a thumbnail, "Photo" or "Video", the moment if any, and the status (Sending… / Sent ✓ / In the contest: …);
   - a **Remove** button that asks inline before it acts ("Remove this? It comes off the screen and out of the contest." with Remove / Keep). It must not use the browser's `confirm()`.
   - The list survives a reload: entry ids, removal keys and a tiny thumbnail are kept in the phone's local storage.
5. **Vote.** This appears when any moment's voting is open. For each open moment:
   - five numbered thumbnails; tapping one opens it full screen, and videos play;
   - a Vote button under each, then "You voted for #3" (changeable until voting closes).

The page checks contest status about every 20–30 seconds, and only while it's on screen. It keeps today's look and accessibility rules: the lantern-night palette, Cormorant/Montserrat, 16 px inputs, visible focus, reduced motion.

### 5.2 The Worker (`workers/photo-upload`, same domain)

The current upload endpoints keep working exactly as they do now. Contest parts are added around them, and **if the contest storage fails, the upload still goes through as a plain share.**

- **Storage:** Cloudflare D1 (SQLite), bound to the Worker. It holds:
  - entries: who, which moment, photo or video, Drive ids, check result and scores, hidden or removed, a hash of the removal key;
  - votes: one row per (moment, phone);
  - moments: title, hint, a brief for Gemini, phase, shortlist and winner;
  - a few settings: contest open, what's on screen, the skip-check switch.

  The free plan's limits (5 million rows read and 100,000 written per day) are far above what one night needs.
- **New calls:**
  - `/start` also takes the moment and a random phone id, and returns an entry id plus a removal key. The finishing piece records the Drive file id against the entry.
  - Uploading the small copy stores it in Drive, then runs Gemini's check right away.
  - Remove (needs the entry's removal key): moves the original and the small copy to the Drive bin.
  - Contest status: moments, phases, shortlists, and this phone's votes.
  - Vote.
  - Wall feed and screen state, for the screen page.
  - The control page's actions, behind the control password.
- **Media links:** images and videos are served through the Worker from Drive, with edge caching for small copies and range requests for videos. `<img>` and `<video>` tags can't send a password header, so the links are **signed and expire**. They can't be guessed, and they only exist for entries that are on the wall, shortlisted, or the guest's own.
- **A once-a-minute background job** catches anything that slipped through. It retries Gemini checks that failed. For a photo whose small copy never arrived, for example a format the phone couldn't shrink, it uses Drive's own thumbnail instead. Each run handles a small batch, to stay within per-run limits.
- **Gemini check:** the small copy and a short brief go to Gemini, which returns structured JSON:
  - is this from the wedding, and is it fine for a big screen;
  - for contest entries, how well it fits the moment (0–10) and its quality (0–10);
  - a few words of reason, for the operator only.

  Anything Gemini refuses or blocks is treated as "keep off the wall." So is anything it rates below 3 for quality: in the paid sample check (Nov 11) it called an all-black frame and a receipt "wedding photos" but rated both 2. The shortlist is the top 5 that fit the moment, ranked by fit plus quality, one per phone.

### 5.3 The big screen (`docs/photos/screen/`)

It's opened once on the venue laptop connected to the screen, unlocked with the guests' password, then left full screen. It checks every few seconds which mode to show:

- **Wall (the default):** a large featured photo rotating through the newest approved ones, plus a grid of recent ones. Each shows the guest's name and the moment. Same lantern-night look as the site.
- **Shortlist:** one moment's five entries, numbered, with "Vote now at tomyjeyan.com/photos," a QR to the photos page, and "*N* votes so far."
- **Winner:** that moment's winning shot, large, with "Winner · *moment title*" and the guest's name. "Best *moment*" read badly for several titles, such as "Best the grand entrance".

If the venue internet drops, the screen keeps cycling what it already has.

### 5.4 The control page (`docs/photos/control/`)

It's built for one phone in the coordinator's hand, with big buttons and nothing fiddly:

- **What's on screen:** Wall, Shortlist of a moment, or Winner of a moment, with the current mode highlighted.
- **Moments:**
  - **Open voting** builds the shortlist and shows it first, so the operator can swap any entry for another from that moment, ranked by Gemini's score. Confirming freezes it.
  - **Close voting**, with real counts.
  - **Reveal winner**, which puts the winner on the screen and handles ties.
  - Shortcuts: Open all / Close all.
- **Waiting for a check:** photos Gemini held back or couldn't check, each with Show / Keep hidden.
- **On the wall now:** recent photos, each with **Hide** (immediate).
- **Switches:** contest open, and the emergency "show new photos without checking."
- **Health:** counts (sent, on the wall, waiting) and when Gemini last answered.

### 5.5 Setup and secrets

The rules haven't changed: the repo is public, and secrets live only in the main checkout's `.env` and in Worker secrets.

- **New Worker secrets:**
  - `GEMINI_API_KEY`: Tommy creates it in Google AI Studio, ideally inside Cloud project `tj-wedding-photos-514217`, and pastes it into `.env` himself.
  - `ADMIN_PASSWORD`: for the control page. Tommy picks it, or a tool generates it into `.env`. It's never printed in the chat.
  - `MEDIA_KEY`: signs media links. Generated.
  - The id of the small-copies folder.
- `tools/photo_drive_setup.py`, or a sibling tool, pushes them the same way it pushes the Drive secrets, run from the main checkout.
- The D1 database and the cron trigger are declared in `wrangler.toml`. The free plan allows 5 cron triggers per account, and none are in use today.
- **Drive's `drive.file` scope** only lets the app touch files and folders it created. `photo_drive_setup.py` already creates the guest folder through the app (`folder()`), so it creates the small-copies folder the same way, with no new Google consent. Every original and small copy is uploaded by the Worker, so remove and the thumbnail fallback both work.
- Nothing uploaded before this change needs to be removable. The folder was emptied after the 2026-11-09 tests.

## 6. Constraints

- **Dates:** today is 2026-11-09 and the wedding is 2026-12-27, about seven weeks away.
- **The live uploader must keep working throughout.** Work happens on a branch and is tested locally (`npx wrangler dev`; the page accepts `?api=http://127.0.0.1:8787` from localhost). It goes to `master` only once it works. GitHub Pages deploys `master` `/docs` in about a minute.
- **Plans:**
  - Cloudflare is on the free plan today: 100,000 Worker requests per day and **10 ms of CPU time per request**. **Workers Paid is required for the wedding night** (amended 2026-11-10, see section 10). Plain uploading still works on the free plan.
  - Gemini runs on the paid tier, so guest photos aren't used to improve Google's products. The free tier would have used them and has low per-minute limits.
- **No secrets** in commits, logs or the chat.
- **WAT framework:** repeatable steps become tools in `tools/`. Workflows are only added or changed with Tommy's OK. Paid API calls need Tommy's OK before reruns.

## 7. Left to the builder

- Exact layouts and visual details within the existing palette and type, including the screen's mosaic and how the control page is arranged.
- The data schema, endpoint names and shapes, polling intervals, and image sizes and quality.
- The Gemini prompt wording and thresholds, tested on sample wedding-style photos and junk shots.
- How the small copy is made on the phone, including the video frame, and the fallbacks when it can't be.
- Code structure. The photos page may split its script into files under `docs/photos/`.
- The local stand-ins for Google and Gemini used in testing.

## 8. Testing and rollout

1. **Local:** the Worker under `wrangler dev` with a local D1 and stand-ins for Google token, Drive and Gemini. Pages served from localhost with `?api=`. Cover:
   - upload, then the small copy, then the check, then the wall;
   - remove;
   - vote and change the vote;
   - open, close and reveal;
   - Gemini down, then the hold-and-approve path;
   - D1 down, so upload still works as a plain share.
2. **Deploy the Worker.** Old calls are unchanged, so today's page keeps working. Then push the pages.
3. **Phones:** the S23 Ultra, plus an iPhone (not tested yet for the uploader). Photo, 4K video, gallery multi-pick, remove, vote.
4. **Real Gemini:** about 30 sample photos (good, junk, off-topic), once the key exists and Tommy has OK'd the spend.
5. **Rehearsal** with the coordinator on a laptop and a TV around Dec 13, running the whole awarding from their phone. Afterwards, clear the test entries.
6. **Freeze changes on Dec 20.** Only fixes after that.

## 9. Settled outside the code (Tommy, 2026-11-09)

- **Photos during the service:** the parish allows them for the whole wedding service, so the church moment stands as planned.
- **Hashtag:** **#SoaringWithTJ** is the official one. The photos page, its meta and share text, and the screen all switch from #ToMyJeyan to #SoaringWithTJ. The guests' password (ToMyJeyan) stays as it is.
- **The operator:** still to be picked. Tommy will teach whoever it is at the rehearsal, so the control page needs to support that (section 5.6).

### 5.6 Teaching the operator at the rehearsal (Tommy's request)

Tommy asked for the control page to be something he can use to show or direct whoever runs it at the rehearsal. *My reading, which Tommy can correct:*

- **Run sheet.** A guided view of the night, in order, where each step is one big button with a line of what it does and when to tap it:
  1. Before the program: the wall is on.
  2. When the host announces voting: open voting.
  3. At the awarding, for each moment in turn: show the shortlist → close voting → reveal the winner.
  4. Afterwards: back to the wall.

  The operator can follow it without remembering anything, and Tommy can talk them through it.
- **Two phones at once.** Tommy can open the control page on his own phone next to the operator's. Both stay in step within a few seconds and show who did what last (for example "Reveal: First dance, 8:42 PM"), so he can watch and direct.
- **Practice mode.** A switch that marks everything made while it's on (entries, votes, phases) as practice. "Clear practice" removes all of it in one tap and moves practice files to the Drive bin. This gives the rehearsal a full run of the awarding with real phones and the real screen, then leaves the night clean.

## 10. Open questions for Tommy

The reviewer check (2026-11-09) left two questions that only Tommy can answer:

1. **Gemini: paid tier or free tier?**
   - **Paid:** needs a billing account on Cloud project `tj-wedding-photos-514217`, plus a budget alert. Expected cost is under US$1 for the night. Guest photos aren't used by Google, and the grand-entrance rush gets checked within seconds.
   - **Free:** costs nothing, but Google may use the guests' photos to improve its products. Its per-minute limit means a rush of uploads backs up into "Waiting for a check", sometimes for minutes, and the operator has to approve more by hand.
2. **Cloudflare Workers Paid (US$5/month) for December, as insurance?**
   - With light polling, the night should fit in the free 100,000 requests a day. But if it doesn't, uploads stop working until midnight UTC (8 AM Philippine time).
   - Paid also lifts the 10 ms CPU limit per request.

**Tommy's answers (2026-11-09):**

1. **Gemini runs on the paid tier.**
   - Tommy adds billing to Cloud project `tj-wedding-photos-514217` himself.
   - The builder documents a budget alert on that project, about US$5, as a tripwire.
   - The key is created in that project.
2. **Workers Paid for December.**
   - Tommy upgrades the Cloudflare account himself before the Dec 13 rehearsal, and can cancel in January.
   - ~~Build it to fit the free plan anyway.~~ **Amended 2026-11-10 after the final review:** the free plan can't carry the night. Measured on a local D1, the control page and screen polling every 5 s, plus phones and the cron, read about 15 million database rows in one night. The free D1 limit is 5 million a day. Past that limit, the contest, screen and control page stop working mid-awarding, while uploads carry on as plain shares.
     - **Workers Paid is a hard prerequisite, and Task 12 checks the account is on it before go-live.**
     - The obvious waste was cut anyway with indexes and smaller scans, so plain uploading and quiet days still fit the free plan.
