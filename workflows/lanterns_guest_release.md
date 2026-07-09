# Lanterns Invitation: Guest Release

## The guest-facing product

Send guests the public URL, not a downloaded `.html` file:

`https://tommybotabara1.github.io/tj-wedding/lanterns.html`

`lanterns.html` is the page entry point, but it depends on the `docs/images/`
assets, ambient audio, web fonts, and the live RSVP service. A hosted URL keeps
those working, makes the RSVP form usable, and gives WhatsApp, Messenger, and
iMessage a stable link preview. The live URL returned HTTP 200 on July 10,
2026.

## Before sending

1. Confirm the ceremony timing: guests are asked to be seated by `1:00 PM`,
   and the ceremony begins at `1:30 PM`.
2. Push the reviewed `docs/` changes to the repository's deployment branch.
   The repository's current remote default branch is `master`; confirm GitHub
   Pages is set to publish `/docs` from that branch before the release.
3. Wait for the Pages deployment, then open the public URL in a private mobile
   browser. Check the welcome, Menu, maps, RSVP panel, and the final RSVP CTA.
4. Make one controlled test RSVP using a name beginning with `__`, then check
   the RSVP Sheet and the couple-notification inbox. Delete the test row after
   confirming delivery.

## RSVP architecture

The page is intentionally static at the front end. It sends RSVPs to a Google
Apps Script web app, which writes to the `RSVPs` Google Sheet and sends couple
and guest email notifications. The configured endpoint health check returned
`{"status":"ok"}` on July 10, 2026. Do not publish the Sheet itself; guests
only need the invitation URL.

This is the right level of infrastructure for the wedding. It has no server to
maintain, but responses remain in a spreadsheet you own. The public endpoint
does not identify an invitee by itself, so keep the link private and use the
existing reconciliation workflow for duplicates or name variations.

## Keep the site useful without turning it into an app

Keep these small, durable additions:

- Before the day: the RSVP, maps, attire, FAQ, and a single clear contact path.
- On the day: one short guest notice for arrival/parking plus links to maps and
  a shared photo album.
- After the day: replace the RSVP prompt with a thank-you note, photo album,
  highlight video, and a way to update an RSVP only if needed.

Avoid live chat, a public guestbook, login accounts, a public seating plan, or
custom real-time updates. They create privacy, moderation, and wedding-day
support work without improving the core guest experience.
