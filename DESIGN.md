---
name: Soaring with TJ
description: Light, airy, travel-themed wedding invitation for Tommy & Jeyan
colors:
  cream: "#f7f3ec"
  paper: "#fbf8f2"
  white: "#fffdfa"
  ink: "#3a3733"
  soft: "#5c554d"
  muted: "#6e655a"
  line: "#e6ddcf"
  sage: "#9caa8f"
  sage-deep: "#788869"
  sage-text: "#566848"
  rose: "#cf9a93"
  rose-deep: "#b27c75"
  rose-text: "#945a52"
  kraft: "#cbb89f"
  gold: "#c4a86e"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(40px, 7vw, 78px)"
    fontWeight: 400
    lineHeight: 1.04
    letterSpacing: "-0.01em"
  hero:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(58px, 12vw, 132px)"
    fontWeight: 300
    lineHeight: 1.04
    letterSpacing: "-0.01em"
  script:
    fontFamily: "Tangerine, Fraunces, cursive"
    fontSize: "clamp(54px, 10vw, 104px)"
    fontWeight: 700
    lineHeight: 0.7
  body:
    fontFamily: "Jost, Segoe UI, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 300
    lineHeight: 1.7
    letterSpacing: "0.01em"
  label:
    fontFamily: "Jost, Segoe UI, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "0.26em"
rounded:
  none: "0"
  full: "9999px"
spacing:
  xs: "8px"
  sm: "14px"
  md: "22px"
  section: "clamp(80px, 12vw, 150px)"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.cream}"
    rounded: "{rounded.none}"
    padding: "0 28px"
    height: "50px"
  button-primary-hover:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 28px"
    height: "50px"
  pass-card:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
  pass-header-ceremony:
    backgroundColor: "{colors.sage}"
    textColor: "{colors.white}"
  pass-header-reception:
    backgroundColor: "{colors.rose}"
    textColor: "{colors.white}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "14px"
---

# Design System: Soaring with TJ

## 1. Overview

**Creative North Star: "The Boarding Pass to Forever"**

The invitation reads like a beautifully printed travel document for one specific flight: Tommy & Jeyan's journey into marriage. The aesthetic is **dreamy minimalist** — warm cream paper, generous air, and quiet ornament — with a travel narrative threaded through every section (boarding-pass cards, dashed flight-path dividers, a small plane that flies down the page as you scroll). Light does the heavy lifting; photography is the emotional center. It is unmistakably theirs, not a template.

It explicitly rejects three things: the default cream "editorial" wedding template (big serif + Inter + eyebrow caps), dark luxe navy-and-gold, and overcrowded, overly colorful, floral-maximalist layouts. Restraint is the brief — when a flourish doesn't earn its place, it goes.

**Key Characteristics:**
- Warm cream/white canvas with sage + dusty rose as the only accents
- High-contrast serif display (Fraunces) against a clean geometric sans (Jost), with a script (Tangerine) used only for the tagline
- A consistent travel-document motif: boarding passes, itineraries, flight paths, "our next chapter"
- Photography-led, ruthlessly curated to couple-only frames
- Motion-rich but reduced-motion safe; mobile-first

## 2. Colors

A soft, sun-warmed palette: a cream paper base with two muted botanical accents (sage and dusty rose) and a kraft/gold pairing reserved for the travel-document details.

### Primary
- **Sage** (#9caa8f): The lead accent — ceremony boarding pass, dividers, active states, swatch. **Sage Deep** (#788869) for icons and large script on light (≥3:1). **Sage Text** (#566848) for *small* text/labels/links on light, where it clears 4.5:1.

### Secondary
- **Dusty Rose** (#cf9a93): The warm counter-accent — reception boarding pass, the script tagline, romantic emphasis. **Rose Deep** (#b27c75) for large rose display (hero tagline, ≥3:1). **Rose Text** (#945a52) for *small* rose text and error messages on light, where it clears 4.5:1.

### Tertiary
- **Kraft** (#cbb89f) and **Gold** (#c4a86e): Reserved for the travel-document chrome — boarding-pass strips, hairline frames, the small diamond rule. Used sparingly; they signal "ticket," not "luxury."

### Neutral
- **Cream** (#f7f3ec): Page background. **Paper** (#fbf8f2) / **White** (#fffdfa): Raised surfaces (cards, inputs).
- **Ink** (#3a3733): Primary text and the solid button. **Soft** (#5c554d): Secondary prose. **Muted** (#8c8276): Labels and meta only — never long body copy on cream.
- **Line** (#e6ddcf): Hairline borders and dashed rules.

### Named Rules
**The Two-Accent Rule.** Only sage and dusty rose carry color; kraft/gold is chrome, not a third accent. No section introduces a new hue. Color stays under ~10% of any screen — the cream and the photos are the design.

**The Contrast Floor.** Body copy uses Soft (#5c554d) or darker on cream. Muted (#6e655a) is for ≤4-word labels — it now clears 4.5:1 on cream/paper/white so labels stay legible. Colored *small* text uses Sage Text / Rose Text (not the lighter -Deep tones). Boarding-pass header strips carry **ink text on the pastel fill** (light strip → dark text), matching the kraft "fund" strip; never white-on-pastel, which fails AA.

## 3. Typography

**Display Font:** Fraunces (with Georgia, serif)
**Body Font:** Jost (with Segoe UI, Arial, sans-serif)
**Script Font:** Tangerine — used *only* for the "soaring with TJ" tagline and footer, never for body or labels.

A two-axis pairing: a high-contrast optical serif for names and headings against a clean geometric sans for everything functional. Hierarchy comes from scale and weight, not extra families (cap: 3). Display weights stay light (300–400); the hero is the only true shout and is capped by `clamp()`. Labels are short, uppercase, and widely tracked (0.26em). No all-caps body copy. Use `text-wrap: balance` on headings.

- **Hero** — Fraunces 300, clamp(58px, 12vw, 132px): the couple's names only.
- **Display / Section heads** — Fraunces 400, clamp(40px, 7vw, 78px).
- **Script accent** — Tangerine 700: the tagline, sparingly.
- **Body** — Jost 300, 16px / 1.7, capped ~65–75ch.
- **Label / eyebrow** — Jost 400, 11px, 0.26em uppercase, in sage-text (AA-safe) or muted. Eyebrows are used **sparingly** — only where a label genuinely earns its place (the hero's formal opener and the save-the-date card), never as a tracked-caps kicker above every section heading. Section cadence is carried by the heading + diamond rule, with an occasional script accent ("so far", "our colors") for variation.

## 4. Elevation

Predominantly **flat with soft, ambient lift** — there is no hard drop-shadow vocabulary. Cards and boarding passes sit just above the cream on long, very soft shadows (`0 30px 80px rgba(74,64,52,.12)` for primary surfaces, a lighter `0 12px 34px rgba(74,64,52,.10)` for secondary). Shadows are atmospheric (a sense of paper resting on paper), never structural or crisp. Depth is otherwise conveyed by hairline `line` borders and tonal layering (cream → paper → white). A semantic z-index scale governs gate → topbar → mobile-nav → intro → music → lightbox.

## 5. Components

- **Buttons** — Rectangular (no radius), 50px tall, 0.26em uppercase. Primary: solid Ink on cream, inverting to outline-on-hover with a 2px lift. Ghost: hairline border that fills with Ink on hover.
- **Boarding-pass cards** (itinerary, gift fund) — White card, hairline border, a colored top strip (sage for ceremony, rose for reception, kraft for the gift "fund"), monospace-feel field labels (DATE / TIME / DRESS), a perforated dashed footer with circular notches and a decorative barcode. The signature component.
- **Photo frames** — The hero is an arched "portal" (tall rounded top, square base) with a thin kraft hairline and inset cream ring; gallery tiles are square-cornered with a subtle zoom-on-hover and a `+` affordance opening a keyboard-navigable lightbox.
- **Flight-path divider** — A centered dashed rule with a small plane/dove/ring glyph between sections.
- **The Flight Path (signature)** — The page's one extraordinary moment. A document-tall SVG ribbon in the left gutter (desktop ≥1100px) that *draws itself* as you scroll: a solid sage trail behind a banking plane (riding inside a soft glow), with the faint dashed future path ahead. Paired with a full-viewport **sky wash** that shifts dawn-lavender → golden-hour from top to bottom of the scroll. The ribbon is desktop-only; the sky journey runs on every viewport (cheap, phone-safe). rAF-throttled, with a reduced-motion fallback (full static path, plane parked, sky frozen at mid-day). This is the literal embodiment of "Soaring with TJ" and the page's deliberate focus moment — do not add a second competing showpiece.
- **Inputs** — Paper fill, hairline border, square corners; focus shifts the border to sage. Attending choice is a two-button toggle that fills sage when selected.
- **Nav** — Transparent over the hero, frosting to translucent cream on scroll; numbered links (01–06) with an underline that grows on hover/active; collapses to a full-screen serif menu on mobile.

## 6. Do's and Don'ts

**Do**
- Lead with the couple's photos; keep them couple-only and well-curated.
- Keep color to sage + dusty rose; let cream and air dominate.
- Let the travel motif recur (boarding passes, flight path, "our next chapter") so it reads as one journey.
- Provide a reduced-motion alternative for every animation; keep type legible and contrast ≥4.5:1.
- Write copy that sounds hand-written for Tommy & Jeyan.

**Don't**
- Don't reach for the default cream-editorial template look, or flip to dark navy-and-gold.
- Don't add a third accent hue, nested cards, or heavy drop shadows.
- Don't crowd sections or over-floral the page — restraint is the brief.
- Don't set body copy in muted gray, all-caps, or wider than ~75ch.
- Don't let a travel metaphor become a gimmick; cut any motif that doesn't earn its place.
