# Gift QR codes

Drop your payment QR images here to make them appear in the invitation's **Send a Gift** popup.
Each tile shows an "Add QR" placeholder until the matching file exists.

Expected filenames (PNG or JPG; square images look best):

| Tile | File |
|------|------|
| BPI | `bpi.png` |
| BDO | `bdo.png` |
| UnionBank | `unionbank.png` |
| PNB | `pnb.png` |
| GCash | `gcash.png` |

How to export each QR:
- **GCash:** Home → tap your QR / "Show QR" → screenshot, or share the QR image.
- **Banks (BPI/BDO/UnionBank/PNB):** in each app look for "Receive money", "QR", or "QRPH" and save/share the QR image.

After adding the files, commit them and deploy. The tiles fill in automatically — no code changes needed.
(If you use `.jpg` instead of `.png`, update the matching `<img src="images/qr/…">` in `docs/invitation.html`.)
