---
target: docs/invitation.html
total_score: 30
p0_count: 0
p1_count: 1
timestamp: 2026-06-07T07-49-39Z
slug: docs-invitation-html
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Live countdown, "Sending…" + success states, active nav, scroll-tracking plane all present |
| 2 | Match System / Real World | 3 | Travel metaphor reads naturally; "First Journey Fund" needs the paragraph to decode as a cash gift |
| 3 | User Control and Freedom | 3 | Lightbox Esc/arrows, mobile menu close, form cancel-by-leaving; no edit-after-submit on RSVP |
| 4 | Consistency and Standards | 4 | Tight, cohesive design system; boarding-pass motif applied uniformly |
| 5 | Error Prevention | 3 | Name + attending validated, party size constrained by select; email only type-guarded |
| 6 | Recognition Rather Than Recall | 3 | Labeled nav + icons; access code is recall-by-necessity (privately shared) |
| 7 | Flexibility and Efficiency | 3 | Anchor nav, keyboard lightbox; little else needed for this surface |
| 8 | Aesthetic and Minimalist Design | 3 | Genuinely airy and restrained; eyebrow-on-every-section and clip-art figures are the only noise |
| 9 | Error Recovery | 2 | Form error is generic ("contact us directly" with no contact); error text fails contrast (3.43:1) |
| 10 | Help and Documentation | 3 | "Arrive early" / "unplugged" notes act as inline help; appropriate for the surface |
| **Total** | | **30/40** | **Good — solid foundation, address contrast + slop tells** |

## Anti-Patterns Verdict

**LLM assessment:** This does NOT read as obvious AI slop at a glance — the boarding-pass system, the live countdown, the arched photo portal, and the curated couple-only imagery give it real identity and emotional center. It clears the brand bar far better than the cream-editorial template it replaced. The remaining tells are scaffolding, not substance:
- **Eyebrow above every single section** (6/6): "TOGETHER WITH THEIR FAMILIES", "BEFORE FOREVER", "THE CELEBRATION", "WITH GRATITUDE", "WHAT TO WEAR", "RESERVE YOUR SEAT". This is the textbook tracked-uppercase-eyebrow grammar the skill bans as an absolute. One named kicker is voice; six is AI cadence.
- **Numbered nav (01–06)** stacks onto the same scaffold feel. Defensible as wayfinding, but combined with the eyebrows it doubles down.
- **Repeated two-up card grids** (passes, notes, attire) — content justifies the pairs, but the **attire SVG icon-people** land squarely on the project's own "clip-art / stocky icon-people" anti-reference.

**Deterministic scan** (`detect.mjs`, 6 findings):
- `overused-font` — **Fraunces** (line 26). On the brand reflex-reject list. Real tell, but identity is already committed in DESIGN.md, and it was a deliberate departure from the banned Cormorant+Inter build. Surface, don't force.
- `numbered-section-markers` — 01–06 sequence. Agrees with the LLM read above.
- `layout-transition` ×2 — `transition: padding` on topbar (line 149), `transition: width` on nav underline (line 161). Minor jank risk.
- `broken-image` — lightbox `<img>` with empty src (line 751). **False positive**: intentionally empty until a photo is opened, has alt text.

Where they agree: the numbered-marker/scaffold read. Where the detector missed: the eyebrow-on-every-section pattern (the bigger tell) and the contrast cluster below. False positive: the lightbox image.

## Overall Impression

A genuinely lovely, on-brand invitation that already does the hard part — it feels personal and unhurried, photography leads, and the travel motif is coherent rather than costume. The single biggest opportunity is **contrast**: the page sets itself an explicit "Contrast Floor" in DESIGN.md and then breaks it in several label/header/error spots. Fixing that plus trimming the eyebrow scaffolding would take this from "Good" to "ship-with-confidence."

## What's Working

1. **The boarding-pass system is the signature, and it earns it.** Sage/rose header strips, dashed perforation with circular notches, field labels, and a faux barcode read unmistakably as a travel document without tipping into gimmick. This is the most distinctive, least-AI part of the page.
2. **Restraint is real.** Cream canvas, two accents, generous air, couple-only photos. The arched "portal" hero frame and the Ken Burns drift give the photography weight. Body prose (`--soft` #5c554d) passes contrast at 6.63:1 and reads cleanly.
3. **It behaves well.** No horizontal overflow at 390px, names wrap gracefully, keyboard-navigable lightbox, reduced-motion path, live countdown, and a real RSVP success state.

## Priority Issues

- **[P1] Contrast floor is breached in labels, pass headers, and error text.** Measured ratios on the real tokens: boarding-pass header text (white on sage **2.45:1**, white on rose **2.41:1**), section eyebrows (`--sage-deep` on cream **3.44:1**), all small `--muted` labels/captions (**3.41:1** on cream), and the form/gate error text (`--rose-deep` **3.43:1**). All fall under the 4.5:1 AA floor the project committed to. Body prose is fine; this is specifically the small uppercase chrome and — most importantly — the **error message**, where low contrast actively hurts recovery.
  **Fix:** Darken the pass-header text (or deepen the strip fill) to clear 4.5:1; bump eyebrow/label colors toward `--soft`/ink end; darken error text to a true `--rose-deep`/ink that clears 4.5:1. None of this changes the airy look.
  **Suggested command:** `/impeccable colorize` (or `/impeccable audit` for the full a11y sweep)

- **[P2] Eyebrow above every section is the dominant slop tell.** 6 of 6 sections open with a tracked-uppercase kicker. It's the one pattern keeping the page legibly "templated."
  **Fix:** Keep it on at most one or two sections as deliberate voice, or replace with a different per-section cadence (a script accent, a flight-path label, or nothing). Let the section headings + script accents carry the rhythm.
  **Suggested command:** `/impeccable typeset`

- **[P2] Attire icon-people hit the project's own anti-reference.** The two SVG figure illustrations read as clip-art and are near-duplicates between the Guests/Entourage cards — exactly the "stocky icon-people" the brief rejects.
  **Fix:** Replace with a real attire/palette photo, a couple silhouette in the portal style, or a pure-typographic treatment leaning on the swatch palette (which already works).
  **Suggested command:** `/impeccable layout` or `/impeccable delight`

- **[P2] Save-the-date card is unbalanced.** The portrait image forces the card to ~864px tall, leaving the right column's text floating in a large empty white field (verified in-browser).
  **Fix:** Cap the media height (`max-height` / fixed aspect on the image cell) so the text column doesn't strand, or move text beneath a contained image on a single column.
  **Suggested command:** `/impeccable layout`

- **[P3] Error copy points nowhere.** "Something went wrong. Please try again or contact us directly." gives no contact path. Two body sentences also use em dashes (attire + save-the-date copy), which the copy rules ban.
  **Fix:** Add a real fallback (a name + messenger/email) and swap em dashes for commas/periods.
  **Suggested command:** `/impeccable clarify`

## Persona Red Flags

**Casey (Distracted Mobile User):** Primary action ("Kindly RSVP") sits at the top of a long page; on mobile the RSVP form is a long scroll away with no persistent jump-to-RSVP affordance once past the hero. Countdown and form state are not persisted if she leaves mid-RSVP (no autosave). Touch targets and wrapping are good.

**Sam (Accessibility-Dependent):** The contrast failures above are her blockers — pass-header labels and error text especially. Lightbox is keyboard-navigable and focusable; reduced-motion is honored; alt text is descriptive. Verify focus-visible styling on the toggle buttons and that the success message is announced (consider `aria-live`).

**Jordan (First-Timer / non-tech-savvy guest — project persona):** Mostly well served — plain language, clear date/venue/attire. Two friction points: "Our First Journey Fund" requires reading the paragraph to understand it's a cash gift, and after a successful RSVP there's no obvious "what next." The gate ("That code didn't match") is clear and kind.

## Minor Observations

- Cream vs Ivory swatches are nearly indistinguishable side by side; consider labeling or nudging one.
- `transition: padding` on the topbar animates layout on scroll; prefer transform-based compaction.
- Nav has 6 top-level items (just over the ≤5 guideline) — fine here, but it's the ceiling.
- Lightbox is missing a focus trap; Tab can escape behind the overlay.

## Questions to Consider

- What if exactly one section carried the kicker, and the rest found their own rhythm — would the page feel more hand-written?
- Could the attire palette itself (those swatches) become the visual, retiring the icon-people entirely?
- Does the error state deserve the same care as the success state — a real human to contact when the form fails?
