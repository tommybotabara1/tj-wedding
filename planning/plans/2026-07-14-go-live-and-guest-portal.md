# Go-Live Plan + Guest Portal (program & table lookup)

> **STATUS — Jul 31, 2026: Phase A is complete. The invitation is live at
> https://tomyjeyan.com and ready to send.**
>
> Done: A1 domain (bought on Cloudflare, DNS + HTTPS wired, `docs/CNAME`) ·
> A2 FAQ contacts (Elaine M. Botabara, done Jul 26) · A3 old pages retired —
> `invitation.html`, `journey.html` **and** `soaring.html` now redirect ·
> A4 production RSVP smoke test (submit, sheet read-back, update-in-place, all
> four emails — passed).
>
> Also done, and not in the original plan: the planner dashboard was moved off
> the public site root (it was exposing vendor names and budget figures at
> `/`), the invitation was moved from `lanterns.html` to the site root so the
> printed URL needs no path, the attire artwork went 12.9MB → 1.47MB, and the
> share card was retitled from "soaring with TJ".
>
> **Still open, both on the couple:** A5 real-device pass (iPhone + Galaxy) and
> A6 proof-read — use `planning/proofread-invitation.md`, which has every
> guest-facing line in reading order.
>
> Carried forward: the RSVP button fails AA contrast (white on `--rose`,
> 3.5:1) and 78 captions sit at 10px. Both were knowingly shipped as-is; worth
> revisiting after the send.
>
> Phase B (program + table lookup) is untouched and still the plan.

**Goal:** officially send the invite (~4 weeks out) with everything guest-ready, and add a post-RSVP layer so confirmed guests can return for the detailed program and their reception table assignment.

**Decisions locked (Jul 14, 2026):**
- Table lookup: guest **types their name**, typo-tolerant match, returns only their own assignment.
- Seating data: the **Guest List tab's existing Table column** in the planner workbook is the source of truth.
- Program: a normal menu panel **visible to everyone** once the couple finalizes the running order.
- Invites go out **about a month from now** → domain must be settled well before anything is printed.

---

## Phase A — Go-live checklist (order matters; A1–A2 gate the send date)

### A1. Custom domain — ✅ DONE Jul 31, 2026 (tomyjeyan.com, Cloudflare)
Printed cards / QR codes must carry the final URL, so this blocks materials.
1. Couple buys the domain (Namecheap or Cloudflare, ~US$10–15/yr).
2. Claude wires it: repo Settings → Pages → custom domain (creates `docs/CNAME`), DNS records (`CNAME www → tommybotabara1.github.io`, apex A 185.199.108–111.153), enforce HTTPS, update `og:url`/canonical in lanterns.html, verify share preview.
3. Fallback: if skipping the domain, commit to `https://tommybotabara1.github.io/tj-wedding/lanterns.html` everywhere.

### A2. FAQ contact cards — ✅ DONE Jul 26, 2026 (Elaine M. Botabara)
Provide RSVP Desk and day-of Coordinator names + numbers; Claude replaces the two
"Name &amp; number to follow" cards in `docs/lanterns.html` (~line 2272).
The last guest-facing placeholder on the site.

### A3. Retire the old invitation.html — ✅ DONE Jul 30–31 (also journey.html + soaring.html)
`docs/invitation.html` still shows Savoy + an outdated entourage. Replace its content
with a meta-refresh + JS redirect to `lanterns.html` so stale links land on the real
invite. (Keep the file in git history in case it is ever wanted again.)

### A4. Production RSVP smoke test — ✅ DONE Jul 30, 2026 (passed end to end)
On the LIVE url: submit a test RSVP with name prefixed `__` (reconcile_rsvps.py skips
those) → verify Sheet row, couple notification email, guest confirmation email → note
results, leave the row (harmless) or delete. Also re-verify the Apps Script deployment
is on the current version (workflows/rsvp_setup.md gotcha).

### A5. Real-device pass — ⬜ OPEN (couple; iPhone *and* the Galaxy S23)
Private-tab first visit: drag-entry (music should start on release — fix deployed
Jul 10), scroll every act, one QR download, one attire card enlarge.

### A6. Final proof-read — ⬜ OPEN (couple; see planning/proofread-invitation.md)
Dates, times, venue spellings, entourage names, FAQ answers — read once slowly.
Claude can generate a flat text dump of all guest-facing copy to make this easy.

### Optional — the QR compression is still open; the attire artwork was compressed Jul 30 (12.9MB → 1.47MB)
- Compress the six QR screenshots (~4.4MB → ~1MB, same q82 treatment as attire).
- AI-regenerated landscape image for The Day section (`docs/images/theday.webp`).

---

## Phase B — Guest portal: program + table lookup (build NOW, data arrives later)

Build and ship before invites go out so it's tested; the portal degrades gracefully
while seating is unassigned ("Seating will be posted closer to the day").

### B1. Backend: `lookup` action in the existing Apps Script (tools/apps_script_rsvp.js)
- Extend `doGet` (or POST) with `action=lookup&name=...`.
- Opens the planner workbook (`GOOGLE_DRIVE_FILE_ID` — script runs as the couple's
  account, same Drive), reads the Guest List tab **by header names** (Name, Table,
  nickname column if present — same header-based parsing philosophy as
  generate_site.py).
- Matching: normalize (case/spaces/diacritics), token-overlap scoring against full
  names + nicknames; require ≥2 characters and reject empty/1-token dumps so the
  endpoint can never enumerate the list. Exactly one confident match → return it;
  several → return disambiguation candidates as first name + last initial only;
  none → not-found message pointing to the RSVP Desk contact.
- Response: `{ status, guestName, table, partyTable? }` with `table:null` meaning
  "not yet assigned". Optionally cross-check the RSVPs sheet to flag un-RSVP'd guests
  ("we don't have your RSVP yet — the form is right here").
- Cache the sheet read with CacheService (~5 min) so a burst of guests on the day
  doesn't hammer SpreadsheetApp.
- **Redeploy the EXISTING deployment to a new version** (the #1 gotcha in
  workflows/rsvp_setup.md), verify with a curl to the /exec URL.

### B2. Frontend: "On the Day" panel in docs/lanterns.html
- New menu entry + map-pin style consistent with existing panels (reuse the dialog
  system, ccard/pass styling).
- Top half: **the program** — static markup, typeset from the couple's running order;
  until supplied, shows the itinerary-level schedule already on the site.
- Bottom half: **Find your table** — one name input + button (reuses RSVP form
  styling), fetches the lookup, renders states: found (table card, big number,
  celebratory copy), unassigned, ambiguous (tappable candidates), not found,
  network error. Same `text/plain` POST trick as the RSVP form to avoid CORS
  preflight.
- Remember the last successful lookup in localStorage → returning guests see their
  table instantly, with a "not you?" reset.
- Static fallback: reduced-motion/no-JS guests still see the program (plain panel).

### B3. Content + data (couple, any time before the week itself)
- Send the detailed running order when finalized → Claude typesets it.
- Fill the Table column in the Guest List tab as seating firms up. Agreed format:
  plain table number or name, one value per guest row; blank = unassigned.

### B4. Verification
- Stubbed states in the browser (all five UI states at 375px + desktop).
- Real lookup against the live sheet with 2–3 names incl. a typo'd one.
- Confirm the RSVP form is untouched end-to-end.

---

## Phase C — already planned, nothing to do now
- RSVP season ops: Sheet + email notifications live; `reconcile_rsvps.py` for
  matching against the guest list.
- After Dec 27: swap RSVP CTA → thank-you + Google Photos album (saved in memory).

## Suggested order of execution
1. This week: A1 domain purchase (couple) · Claude builds B1+B2 in parallel.
2. Next: A2 contacts, A3 redirect, then A4 smoke test on the final URL.
3. Week before sending: A5 phone pass + A6 proof-read.
4. Send the invites. Seating data and program content can keep flowing into the
   sheet/panel afterwards without any redeploys (sheet) / one small deploy (program).
