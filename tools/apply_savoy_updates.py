#!/usr/bin/env python3
"""
apply_savoy_updates.py — Lossless, surgical edit of TJ MARRIAGE.xlsx.

Why this exists:
    The canonical workbook carries 66 embedded images + 16 drawings (Receipts,
    Theme Pegs). An openpyxl load->save round-trip DROPS drawings (verified:
    16 -> 12). So we cannot use openpyxl to write back.

    Instead we edit only the specific <c> cells inside the two relevant
    worksheet XML parts, leave every other zip entry byte-for-byte intact,
    and re-zip. Cell styles (s="..") are preserved; edited text cells become
    inline strings so we never touch sharedStrings.xml.

Edits applied (one-time Savoy migration):
    Budget + Vendor Tracker
      Row 3  Reception Venue : Savoy Hotel Manila / Booked / 300,000 / note
      Row 4  Caterer         : Included in Savoy package / Booked / 0 / note
      Row 13 Prenup Shoot    : Done / balance 0 / save-the-date note
      Row 17 Lights & Sounds : vendor -> Savoy package (drop stale Gallio)
      Row 19 Cake            : vendor -> Savoy package (drop stale Ibarra's)
    Timeline  Task List
      Row 8  Book reception venue : Booked
      Row 9  Secure caterer       : Booked
      Row 15 Publish invitations  : Ongoing
      Row 23 Prenup shoot complete: Done

Usage:
    python tools/apply_savoy_updates.py <input.xlsx> <output.xlsx>
"""

import re
import sys
import zipfile

# sheet name -> list of (cellref, value, kind)  where kind in {"s","n"}
EDITS = {
    "Budget + Vendor Tracker": [
        ("B3", "Savoy Hotel Manila", "s"),
        ("C3", "Booked", "s"),
        ("D3", 300000, "n"),
        ("E3", 300000, "n"),
        ("F3", "Final Savoy Hotel Manila package for 120 pax at PHP 2,500/person. Catering is included in this row.", "s"),
        ("B4", "Included in Savoy Hotel Manila package", "s"),
        ("C4", "Booked", "s"),
        ("D4", 0, "n"),
        ("E4", 0, "n"),
        ("F4", "Included in the reception venue package. Do not double-count catering separately.", "s"),
        ("C13", "Done", "s"),
        ("E13", 0, "n"),
        ("F13", "Save-the-date video and prenup photos are complete.", "s"),
        ("B17", "Savoy Hotel Manila package / TBC", "s"),
        ("F17", "Confirm what AV, lights, and sounds are included in the Savoy package.", "s"),
        ("B19", "Savoy Hotel Manila package / TBC", "s"),
        ("F19", "Confirm cake or dessert inclusion with the final Savoy package.", "s"),
    ],
    "Timeline  Task List": [
        ("C8", "Booked", "s"),
        ("C9", "Booked", "s"),
        ("C15", "Ongoing", "s"),
        ("C23", "Done", "s"),
    ],
}

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def _xml_escape(text):
    return (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def _sheet_path_map(zf):
    """Return {sheet_name: 'xl/worksheets/sheetN.xml'} from workbook.xml + rels."""
    wb_xml = zf.read("xl/workbook.xml").decode("utf-8")
    rels_xml = zf.read("xl/_rels/workbook.xml.rels").decode("utf-8")

    # r:id -> target
    rid_target = {}
    for m in re.finditer(r'<Relationship\b[^>]*>', rels_xml):
        tag = m.group(0)
        rid = re.search(r'Id="([^"]+)"', tag)
        tgt = re.search(r'Target="([^"]+)"', tag)
        if rid and tgt:
            rid_target[rid.group(1)] = tgt.group(1)

    name_path = {}
    for m in re.finditer(r'<sheet\b[^>]*/?>', wb_xml):
        tag = m.group(0)
        name = re.search(r'name="([^"]+)"', tag)
        rid = re.search(r'r:id="([^"]+)"', tag)
        if name and rid and rid.group(1) in rid_target:
            target = rid_target[rid.group(1)]
            # Targets are relative to xl/
            if not target.startswith("xl/"):
                target = "xl/" + target.lstrip("/")
            name_path[name.group(1)] = target
    return name_path


def _replace_cell(sheet_xml, ref, value, kind):
    """Replace the <c r="ref" .../> element, preserving its style attribute."""
    # Match self-closing or full cell element for this exact ref.
    pattern = re.compile(r'<c r="' + re.escape(ref) + r'"([^>]*?)(?:/>|>.*?</c>)', re.DOTALL)
    m = pattern.search(sheet_xml)
    if not m:
        raise ValueError(f"Cell {ref} not found in sheet XML")
    attrs = m.group(1)
    s_match = re.search(r'\bs="(\d+)"', attrs)
    s_attr = f' s="{s_match.group(1)}"' if s_match else ""

    if kind == "n":
        new_cell = f'<c r="{ref}"{s_attr}><v>{value}</v></c>'
    else:
        new_cell = (f'<c r="{ref}"{s_attr} t="inlineStr">'
                    f'<is><t xml:space="preserve">{_xml_escape(str(value))}</t></is></c>')
    return sheet_xml[:m.start()] + new_cell + sheet_xml[m.end():]


def apply_updates(in_path, out_path):
    with zipfile.ZipFile(in_path, "r") as zin:
        name_path = _sheet_path_map(zin)
        # Build modified content for target sheets.
        modified = {}
        for sheet_name, edits in EDITS.items():
            if sheet_name not in name_path:
                raise ValueError(f"Sheet '{sheet_name}' not found. Have: {list(name_path)}")
            path = name_path[sheet_name]
            xml = zin.read(path).decode("utf-8")
            for ref, value, kind in edits:
                xml = _replace_cell(xml, ref, value, kind)
            modified[path] = xml.encode("utf-8")

        # Re-zip: copy every entry; swap in modified sheet XML.
        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = modified.get(item.filename) or zin.read(item.filename)
                zout.writestr(item, data)

    print(f"Applied {sum(len(v) for v in EDITS.values())} cell edits across {len(EDITS)} sheets.")
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python tools/apply_savoy_updates.py <input.xlsx> <output.xlsx>")
        sys.exit(1)
    apply_updates(sys.argv[1], sys.argv[2])
