# Photobook images

Drop the photographs for the **"Our Photobook"** panel in this folder.

## What to put here

- **Any number of photos.** The panel's grid reflows, so 12 or 60 both work.
- **Any orientation.** Portrait, landscape and square all sit correctly in the
  grid; each is cropped to a square thumbnail and shown whole when tapped.
- **Straight off the phone or camera is fine.** JPG, PNG, HEIC or WEBP.
  Do not resize or compress them first — that gets done here.

## Naming

Whatever the camera called them is fine (`IMG_2291.jpg`, `DSC_0042.JPG`).
If a particular order matters, prefix them and they'll be used in that order:

```
01-first-date.jpg
02-graduation.jpg
03-hong-kong.jpg
```

## What happens next

Tell Claude once the files are in, and they get:

1. **converted to WEBP and compressed** — the finale's attire artwork went from
   12.9MB to 1.5MB this way with no visible difference, and the same treatment
   applies here. Full-size phone photos are 3–8MB each; a 40-photo album shipped
   raw would be over 200MB, which no guest on mobile data will wait for.
2. **resized to two versions** — a small square thumbnail for the grid and a
   larger one for the full-screen view, so the panel opens instantly and the big
   file only loads when a photo is actually tapped.
3. **written into the panel markup**, with alt text for each.

Originals are archived outside `docs/` so they never deploy.

## Please don't

- Don't put anything here you would not want a guest to see. Everything in
  `docs/` is published to tomyjeyan.com and is publicly reachable.
- Don't commit the raw originals — only the compressed versions belong in git.
