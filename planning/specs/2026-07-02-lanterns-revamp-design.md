# Lanterns Revamp: Launch Shore, Finale Release, Photos Everywhere

**Date:** 2026-07-02
**Target:** `docs/lanterns.html` only (the primary invitation going forward)
**Status:** Approved by user (all three sections)

## Context

`docs/lanterns.html` is the night-sky lantern invitation for Tommy & Jeyan (Dec 27, 2026). Three approved changes:

1. The daylight beach section ("The Day") feels out of place in the night world. The beach is personally meaningful to the couple, so it stays, but moves to night.
2. The finale ("RSVP to the Journey") lacks a wow moment.
3. The couple's photos should be woven into every act, not confined to the "Pieces of Us" gallery.

Photo inventory: `journey-02` (hand-kiss with ring), `journey-03` (portrait, gazing), `journey-04` (her looking up at him under lights), `journey-05` (laughing embrace), `journey-06` (foreheads together) are unused; all are night shots with bokeh light fields that match the page's world. Each gets exactly one home (no duplicates).

## 1. The Launch Shore (night beach)

**Concept:** this shore is where all the lanterns in the page's sky come from.

Changes inside `.beach` / `.beach-frame` (section `#day`):

- **Sun → Moon.** Replace `.sun` with a `.moon`: ~90px ivory disc (`--moon` tones), soft halo. Below it, a **moonglade**: a vertical shimmering column of moonlight on the sea (recolor/repurpose the existing `.glints` element: ivory/soft-amber, low opacity, keep its gentle drift animation).
- **Sky band.** `.beach` gradient shifts from sunset orange to deep espresso → plum horizon (blend toward the fixed canvas sky). Clouds stay but faint and moonlit (low opacity, cool-ivory tint).
- **Sea.** Darker: warm-dark teal-charcoal gradient. The `::after` light streaks recolor to faint ivory/amber. `.foam` stays as a soft moonlit swash.
- **Remove** the two `svg.bird` elements and `svg.shades`. Birds don't fly at night; the sunglasses are a daylight prop.
- **Keep** the palm and guitar silhouettes (night beach serenade).
- **Add a bonfire** near the guitar: small amber radial glow + flame flicker (reuse the existing `flick` keyframes). Explains the warm light on the sand; echoes the lantern amber. Static glow under reduced motion.
- **Promote the rising lanterns.** Extend the existing `.b-lan` set (~4 more), clustered above the shoreline as a visible launch point; they originate near the sand line and rise out of the section (adjust `b-rise` origin). Static, visible, non-animated under reduced motion (current behavior).
- **Keepsake photo** (`journey-05`, laughing embrace): a small tilted print with a warm paper frame. Desktop: absolutely positioned on the sand (left-of-center, clear of palm, guitar, and cards). Mobile (≤640px): the absolute version hides; a centered tilted print renders between the section heading and the detail cards instead.
- **Cards unchanged.** The four frosted-glass `.dcard`s already fit the night.
- **Copy:** script accent changes from "where the sky meets the sea" to "where our sky begins". Heading stays "The Day".
- **Contrast guard:** re-check heading + `.dcard` text against the darker scene (AA: 4.5:1 body, 3:1 large); tune `.beach-scrim` if needed.

## 2. Finale: "Add your light to our sky"

**Remove the plane.** Delete `#route-svg`, `#plane`, `#dest`, their CSS, and their timeline tweens (`primeDraw(['route-path','route-glow'])`, MotionPath tween). The plane duplicated the map's route-plane and muddied the lantern metaphor. (MotionPathPlugin stays; the lantern-path tracers still use it.)

**Scroll spectacle (pinned phase, scrub-driven, transform/opacity only):**

- **Sea of lanterns.** `#next-lans` grows from 9 to ~16–18 DOM lanterns with varied scale/opacity, staggered rising through the pinned phase (canvas sky continues behind).
- **Convergence.** `#nlanT` / `#nlanJ` rise and travel toward center, meeting just above the copy. As they meet, a new `#union-glow` (one larger warm glow) fades in over their overlapping halos: two lights becoming one. The individual lanterns ease down in scale/opacity as the union glow takes over.
- **Dawn moves to the exit.** `.sky-dawn` / `.sky-warm` tweens shift late (≈ t8.5→10 of the 10-unit timeline) so the pinned scene stays night for the spectacle and dawn breaks only as the guest scrolls out into the ivory footer. The "morning after" arc survives.
- **Dawn photo** (`journey-06`, foreheads together): during the dawn phase, an arched-vignette photo fades in top-center (where `#dawn-cap` sat) — a contained medallion, not full-bleed, so countdown/copy contrast is never at risk. `#dawn-cap` ("Dawn breaks.") is removed in its favor.
- **Copy order** in `.next-copy`: micro line (unchanged) → h2 "The best part of the journey is still ahead." → join line → date-stamp → countdown (caption "until forever" unchanged) → new script line **"Add your light to our sky."** directly above the RSVP button.

**Participation (RSVP-success reward):**

- On successful RSVP submit (yes or no), the success message shows (~1.6s), the panel closes, then a **guest lantern** rises: a `.chip`-style lantern with the guest's first name glowing inside (same build as the T/J monogram lanterns), fixed-position overlay, bottom → top over ~4s with gentle sway, plus a `Sky.liftoff()` burst behind it. Works from anywhere on the page (the sky canvas is global).
- Name handling: first word of the name field, trimmed; if longer than 12 characters, fall back to the first initial. Text content only (no HTML injection — set via `textContent`).
- Success copy gains a nod: "…Your light is in our sky."
- z-index: above content, below dialogs/gate (use the existing semantic scale; ~55).
- **Reduced motion / no GSAP:** no release animation; the panel stays open with the success message (current behavior). The finale scene statics to the existing reduced layout (lanterns parked, warm sky, copy visible).

## 3. Photos woven into every act

| Placement | Photo | Treatment |
|---|---|---|
| Lantern path, at the arc-merge beat | `journey-04` | `#merge-glow` becomes a **merge medallion**: circular photo ~180px with a lantern-glow ring (amber box-shadow, 1px warm border). Blooms in at the merge (where the glow currently pulses), holds, then gently fades as the single path continues. Reduced motion: shown statically above the captions in the collapsed layout. |
| Launch Shore | `journey-05` | Keepsake print (Section 1). |
| Finale dawn | `journey-06` | Arched dawn vignette (Section 2). |
| Gallery | `journey-02`, `journey-03` | Two new tiles; gallery grows 7 → 9 (clean 3×3 on desktop ≥840px). `savethedate` stays the wide closer; "No. 0x" numbering re-flows 01–09. Captions: **"The yes"** (02), **"Steady lights"** (03). |

Rules for every new photo: descriptive `alt` text in the page's voice; `loading="lazy" decoding="async"`; explicit dimensions or aspect-ratio to prevent layout shift; new gallery tiles join the existing lightbox rotation automatically via `.tile-open`.

Gate and hero stay photo-free deliberately: the monogram lanterns and pure type are identity moments, and bridge/promise already carry photos.

## Edge cases

- **Reduced motion:** every new element has a static fallback (bonfire glow static, medallion/vignette visible, no release animation). Maintain the existing `html.reduced` / `html:not(.js-anim)` pattern.
- **No GSAP (CDN failure):** finale copy and photos must be visible via the `html:not(.js-anim)` static layout; release animation skipped.
- **Long/unusual guest names:** truncation rule above; `textContent` only.
- **Mobile:** all new absolute elements need ≤640px positions that clear the fixed dock (bottom-right ~170×130px zone) and avoid horizontal overflow.
- **Weight:** no new image assets; all five photos already ship in `docs/images/`.

## Verification

Per section: desktop + 375px screenshots, reduced-motion pass (`html.reduced` forced), console/network clean, `detect.mjs` re-run, interaction tests (RSVP success release with a stubbed endpoint response, lightbox rotation with 9 tiles).

## Out of scope

`invitation.html` (stale Savoy venue + lost parents entries — tracked separately), access-code parity, gift QR images, FAQ contact placeholders.

## Note on spec location

Specs live in `planning/specs/`, not `docs/` — `docs/` is the GitHub Pages deploy root and anything in it publishes to the live site.
