# Lanterns Revision 2: Mobile-First, Life-Story Path, Save-the-Date Day

## Context

Feedback round on `docs/lanterns.html` (the primary invitation) after the Launch Shore/finale revamp. The couple wants: (1) mobile treated as the primary experience, with desktop still correct; (2) the lantern-path opening to tell their life story with photo flashes (placeholders now, photos sourced later) and the two lanterns to *fly together* after meeting rather than becoming one; (3) "The Day" rebuilt on their save-the-date photo instead of the illustrated beach; (4) a slimmer gallery; (5) a simpler finale that fixes the broken desktop choreography; (6) footer link removal.

**Diagnosis behind the finale complaint (measured live):** frame rate is fine (~140fps); the flaw is choreography — the T & J lanterns converge *above* the viewport (off-screen by 60% scroll), so the meeting is never seen, and the lantern sea empties from 16 on-screen to 5 by the 75% mark, leaving the emotional back half on a bare sky.

**User decisions locked in:** crop the baked "SAVE THE DATE" caption out of view; warm dusk CSS grade on the photo; 4 life stages per person; gallery removals are save-the-date + journey-10 (lands at 7 tiles; close the grid with a wide tile).

Everything is in the single file `docs/lanterns.html` (inline CSS + one JS IIFE, GSAP/ScrollTrigger/Lenis, canvas sky). Branch: `revamp/lanterns-launch-shore` (continue on it). Execution via the same subagent-driven flow; a repo copy of this plan goes to `planning/plans/2026-07-03-lanterns-revision-2.md` (specs/plans never live under `docs/` — it's the Pages deploy root).

## W1 — Lantern path becomes "two lives, one sky"

The pinned `#path` scene currently: two arcs draw + tracer lanterns rise, word-lanterns light up, photo medallion blooms at the merge, single tracer continues.

- **Placeholder photo system.** New folder `docs/images/story/` with a README naming the expected files. Frames use the existing QR-tile pattern (`onerror` → `.missing` class → dashed placeholder box with its label text), so the couple drops files in later and they appear without code changes. Expected files:
  - `t-child` `t-school` `t-college` `t-work` (Tommy: childhood ~4-8yo, high school, college, working years)
  - `j-child` `j-school` `j-college` `j-work` (same for Jeyan)
  - `us-meet` (earliest photo together — becomes the merge medallion)
  - `us-met-1`, `us-met-2` (two favorites from the first year together), all `.webp`
- **Memory frames during the rise (t0.4–5.2 of the scrub):** eight small tilted polaroid frames (label caption under each, e.g. "Tommy · childhood"), T's four flashing up the left arc, J's four up the right, alternating, each fading in/out over ~1.2 scrub units at increasing heights. Desktop ~110px wide, mobile ~72px.
- **Merge medallion:** keep the existing `#merge-medallion` mechanics; swap `journey-04` for `story/us-meet.webp` + placeholder fallback.
- **After the meet — fly together:** replace the single `#tracerM` lantern with a *pair* of smaller lanterns riding the merged arc side by side (small x-offset, gentle counter-sway). Word-lantern "Home" and captions unchanged.
- **Together-photo flashes during the joint flight (t5.8–9.2):** `us-met-1` and `us-met-2` frames flash beside the merged path.
- **Mobile scaling (user-requested):** `.chip` word-lanterns 90→64px, tracer pair smaller, memory frames 72px, all positioned clear of the dock corner; medallion 172→140px on ≤640px.
- **Reduced/static:** memory frames render as a static labeled grid above the captions (the collapsed layout already stacks children); pair tracer hidden like tracers are today.

## W2 — "The Day" on the save-the-date photo

- **Remove the illustrated beach entirely:** `.beach` and all children (moon, moonglade/glints, sea, sand, foam, clouds, palm, guitar, bonfire, `.b-lan`s), their keyframes (`drift`, `glint`, `swash`, `b-rise`) and reduced rules. Keep `flick` (used by all lantern flames). Remove `.shore-photo` ("the joy we pack") completely.
- **New backdrop:** full-bleed `savethedate.webp` in `.beach-frame`, `object-fit:cover`, `object-position` tuned (~`50% 35%`) so the couple stays centered and the baked caption band never enters the crop — verified at 375, 768, 1280, 1440 and short 1280×700.
- **Warm dusk grade (CSS-only, file untouched):** filter in the vein of `brightness(.84) saturate(.92) sepia(.15)` plus top/bottom gradient scrims (reuse the `.bridge-veil` pattern) and a soft warm radial. Heading/script-accent/cards sit on top unchanged; AA-check the heading and `.sub` against the graded photo, tune scrim until they pass.
- Cards, copy, and layout otherwise unchanged.

## W3 — Gallery to 7 with a wide closer

- Remove the `savethedate` wide tile (photo now lives in The Day) and the `journey-10` "Same horizon" tile.
- Seven tiles remain; make the last one (`Steady lights`, journey-03) the wide 16:9 closer (`tile wide`) so desktop reads 3+3+wide and mobile 2-col+wide — no orphan row. Renumber `No. 01–07`. Lightbox adjusts automatically via `.tile-open`.

## W4 — Finale: simplify and put the meeting on screen

- **Remove** `#dawn-photo` (HTML/CSS/tweens, its ≥1280 media rules, reduced rule) and the `#next-micro` line (HTML, CSS incl. its gold color rules + reduced override, its reveal tween and t8.7 color tween). Update `copyEls` accordingly.
- **Visible convergence:** retarget the T/J tweens so their meeting point lands ~24% from the viewport top, on screen (current target overshoots above the fold — recompute the `y` functions; keep `invalidateOnRefresh`).
- **Fly together, not fade into a glow** (mirrors W1's motif): after meeting, keep both lanterns visible drifting gently upward as a pair with `#union-glow` as a halo behind them; fade pair + glow together at ~t9.6 into the dawn wash.
- **Keep the sky populated:** split the 17 sea lanterns into two cohorts — one rising slowly across the whole pin (shorter travel), one parked with the existing `floaty` sway — so ≥8 remain on screen at t9.
- Copy beats and the RSVP release are untouched (minus micro). Mobile: T/J pair scaled ~.6 on ≤640px so the meet fits above the copy block (copy top ≈9% on mobile — verify).
- Reduced/static: parked T/J stay as today; no micro, no photo.

## W5 — Footer

- Remove the `<small><a href="invitation.html">View the full invitation →</a></small>` line.

## W6 — Page-wide mobile polish pass

After W1–W5 land: a dedicated 375px/414px sweep of every act (gate, curtain, path, bridge, day, gallery, map, promise, finale) fixing spacing/scale/dock clearances found along the way, then re-verify desktop 1280×800, 1440×860, and 1280×700.

## Photo shopping list for the couple (also written to `docs/images/story/README.md`)

11 photos: Tommy ×4 (childhood, high school, college, working), Jeyan ×4 (same stages), earliest photo together (`us-meet` — the medallion), 2 favorites from your first year (`us-met-1/2`). Portrait or square crops, ~800px long side is plenty. Drop them into `docs/images/story/` with those names and they appear automatically.

## Verification

Playwright (preview screenshots are broken in this environment): per-workstream beats at 1280×800 / 1440×860 / 375×812 / 1280×700 — specifically: memory frames flash in sequence and never touch the dock; caption band of savethedate never visible at any width; finale meet visibly on screen at ~60–75% scroll with ≥8 sea lanterns at t9; heading AA on the graded photo (computed contrast); reduced-motion emulation pass (static frames grid, no tweens); RSVP release regression with stubbed fetch; `detect.mjs` re-run; zero console errors / failed requests.

## Execution notes

Subagent-driven (implementer + reviewer per workstream, fix waves batched), same ledger `.superpowers/sdd/progress.md`. W1 and W4 are the two big tasks; W2/W3/W5 are mechanical; W6 is verification-heavy. Commit style unchanged (`lanterns: …` + Co-Authored-By trailer).
