# Wedding Planning — Tommy & Jeyan

**Status:** Active
**Date:** December 27, 2026
**Venue:** Talisay Events Hall, Gallio Events Hall (BGC / Taguig)
**Church:** St. Therese

---

## Key Details

| Item | Detail |
|------|--------|
| Wedding date | December 27, 2026 |
| Reception venue | Gallio Events Hall — **Talisay Events Hall** (300 sqm, 9.8m × 33m) |
| Church | St. Therese — booked, ₱47,000 paid |
| Catering | Ibarra's — finalizing end of March |
| Guest count | **135 total** (116 confirmed / 132 pax, 19 optional) |
| Tables | 16 tables (avg 8 pax/table, max 12) |

---

## Tracker

Master checklist and budget: [Google Sheets](https://docs.google.com/spreadsheets/u/0/d/1XUmzEu2Z2kzwaIX-BAKi4zOKW1mDCTvx/edit?usp=sheets_home&ths=true&rtpof=true)

---

## Files in This Directory

| File | Description |
|------|-------------|
| `guest-list-clean.xlsx` | Master guest list — cols A–I (guest data), col J (Table #), cols K–M (legend + live summary formulas) |
| `seating-mockup.png` | Floor plan mockup of Talisay Events Hall with table layout |
| `TJ MARRIAGE.xlsx` | Original source spreadsheet (timeline, budget, vendor tracker, guest list, theme, schedule) |
| `Gallio-Floor-Layout.pdf` | Official floor plan PDF — all halls (Narra 800sqm, Acacia 500sqm, Talisay 300sqm, function rooms, garden) |

---

## Guest List Structure (`guest-list-clean.xlsx`)

**Columns A–I (main data):**

| Col | Header | Values |
|-----|--------|--------|
| A | # | Row number |
| B | Name | Guest name |
| C | Side | `Jeyan` / `Tommy` |
| D | Group | Family / JHS / SHS / College / PAL / Manulife / REBAP / Benilde / HS Elem / Deloitte / etc. |
| E | Role | `Guest` / `VIP / Principal Sponsor (Ninong/Ninang)` / `Entourage - Groomsmen` / `Entourage - Bridesmaid` / `Best Man` / `MOH` / `Candle` / `Veil` / `Cord` / `Ring` / `Flower Girl` |
| F | +1? | `Yes` / `No` |
| G | Pax | 1 or 2 |
| H | Status | `TBC` (confirmed) / `Optional / TBC` |
| I | Notes | Free text |
| J | Table # | 1–16 (auto-assigned, blank for optional guests) |

**Columns K–M (legend + summary):**
- K1–K6: Color legend labels
- K8–M17: Summary table with **live formulas** in L and M — updates automatically when A–I data changes
  - Row 9: Jeyan confirmed
  - Row 10: Tommy confirmed
  - Row 11: Subtotal confirmed
  - Row 13: Optional / TBC
  - Row 14: Total incl. optional
  - Row 16: VIPs / Principal Sponsors
  - Row 17: Entourage (confirmed)

**Cell color coding:**
- Orange `#FFE0B2` — VIP / Principal Sponsor
- Sage green `#D9EAD3` — Entourage
- Dusty rose `#F5EEFF` — Jeyan's guest
- Steel blue `#EEF5FF` — Tommy's guest
- Light gray `#F3F3F3` — Optional / TBC

**Table # color coding (col J) matches seating mockup:**
- `#FFE0B2` T01–T03 — VIP / Sponsors
- `#F4C2C2` T04–T06 — Jeyan Family
- `#AED6F1` T07–T09 — Tommy Family
- `#F9E4B7` T10–T11 — Jeyan JHS
- `#FADADD` T12 — Jeyan SHS / College
- `#A9DFBF` T13 — Jeyan Professional (PAL / Manulife / REBAP / Benilde)
- `#A9CCE3` T14–T15 — Tommy HS / Elem
- `#D5D8DC` T16 — Tommy College / Work

---

## Seating Plan (Talisay Events Hall)

**Room:** 9.8m wide × 33m long. Kitchen at top, entrance at bottom.
**Layout:** 2-column, 16 round tables (T01–T16), center aisle, buffet along right wall.

**Table order (top = nearest stage, bottom = entrance):**

| Table | Group | Pax |
|-------|-------|-----|
| T01 | VIP / Sponsors | 9 |
| T02 | VIP / Sponsors | 8 |
| T03 | VIP / Sponsors | 8 |
| T04 | Jeyan Family | 8 |
| T05 | Jeyan Family | 8 |
| T06 | Jeyan Family | 7 |
| T07 | Tommy Family | 9 |
| T08 | Tommy Family | 9 |
| T09 | Tommy Family | 8 |
| T10 | Jeyan JHS | 7 |
| T11 | Jeyan JHS | 7 |
| T12 | Jeyan SHS / College | 12 |
| T13 | Jeyan Professional | 10 |
| T14 | Tommy HS / Elem | 7 |
| T15 | Tommy HS / Elem | 6 |
| T16 | Tommy College / Work | 9 |

**Seating logic:**
- VIP / Principal Sponsors → own tables, nearest stage
- All other entourage roles (groomsmen, bridesmaids, candle, veil, etc.) → seated with their social circle group, NOT in a separate entourage table
- Jeyan Professional table merges PAL non-VIPs with Manulife / REBAP / Benilde contacts

---

## Tools (in `../../tools/`)

| Script | What it does |
|--------|-------------|
| `apply_guest_colors.py` | Re-applies color formatting to `guest-list-clean.xlsx` without touching data — run after manual edits |
| `seating_plan.py` | Regenerates `seating-mockup.png` floor plan from guest list data |
| `add_table_numbers.py` | Writes Table # to col J of `guest-list-clean.xlsx` based on seating logic |
| `add_summary_formulas.py` | Writes live COUNTIFS/SUMIFS formulas to cols L–M summary |
| `build_guest_list.py` | ⚠️ Regenerates `guest-list-clean.xlsx` FROM SCRATCH from `TJ MARRIAGE.xlsx` — only run if rebuilding from source |

> **Important:** Always run `apply_guest_colors.py` after manual edits to the guest list to restore formatting. Never run `build_guest_list.py` unless you want to wipe and rebuild the clean list from the original.

---

## Vendors

| Category | Vendor | Status | Notes |
|----------|--------|--------|-------|
| Church | St. Therese | ✅ Booked | ₱47,000 paid |
| Reception Venue | Gallio Events Hall (Talisay) | Pencil Booked | Finalizing end of March |
| Catering | Ibarra's | Finalizing | End of March |
| Photography | Paulo and Kiara | Shortlisted | Not yet booked |
| Videography | Uncle AJ | Shortlisted | Not yet booked |
| Hair & Makeup | Hershey | ✅ Booked | ₱14,500 paid |
| Emcee / Host | TBD | Booked | ₱15,000 actual |
| Florist | — | Not Booked | |
| Band / DJ | — | Not Booked | |
| Stylist / Designer | — | Not Booked | |
| Coordinator (OTD) | — | Not Booked | |
| Cake | — | Not Booked | |
| Transportation | — | Not Booked | |
| Invitations | — | Not Booked | |
| Souvenirs / Giveaways | — | Not Booked | |
| Photo Booth | — | Not Booked | |
| Accommodation | — | Not Booked | |

---

## Key Dates

| Deadline | Item |
|----------|------|
| March 31, 2026 | Finalize + sign Gallio contract |
| March 31, 2026 | Finalize + sign Ibarra's contract |
| April 2026 | Book photographer (Paulo & Kiara) + videographer (Uncle AJ) |
| June 2026 | Book on-the-day coordinator |
| August 2026 | Attire fittings |
| September 2026 | Send invitations |
| Mid-November 2026 | Final guest count to caterer |
| December 10, 2026 | Final coordination meeting |
| December 24, 2026 | Church rehearsal |
| **December 27, 2026** | **Wedding day** |

---

## Next Steps

- [ ] Finalize and sign contract with Gallio Events Hall — by March 31
- [ ] Finalize and sign contract with Ibarra's — by March 31
- [ ] Book photographer (Paulo and Kiara) + videographer (Uncle AJ)
- [ ] Book on-the-day coordinator
- [ ] Review seating plan table assignments and adjust as needed
- [ ] Confirm optional guests (19 pending)
