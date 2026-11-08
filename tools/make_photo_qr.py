"""
make_photo_qr.py: the QR code guests scan to share their photos and videos.

The code points at https://tomyjeyan.com/photos/ (docs/photos/index.html), never
straight at the album. That page holds the album link, so the album can change, or
a different upload service can replace it, without reprinting a single card.

What it does
  1. Builds the QR for the URL with segno at error correction Q: about a quarter of
     the code can be smudged, glared or folded and it still scans.
  2. Decodes the PNG it just wrote with zxing-cpp and stops if the result is not the
     exact URL. A printed code that doesn't scan is the one failure nobody can fix
     at the reception.
  3. Writes the code into planning/photo-card.html between the qr:start / qr:end
     markers, so the printable card always carries the code that was just checked,
     and the guests' password (PASSWORD in set_photo_album.py) between pw:start /
     pw:end. The card lives in planning/, which never deploys, because it shows
     the password.
  4. With --render, prints that card to PDF and PNG with headless Chrome, then
     decodes the card PNG as well, so the code is checked in the final layout too.

Outputs (.tmp/photo-qr/)
  photo-qr.svg     the code alone, vector, for a stylist or printer's own layout
  photo-qr.png     the code alone, 2000 px on white, same use
  photo-card.pdf   the 4R (4 x 6 in) table card, ready to print       (--render)
  photo-card.png   the same card at 300 dpi, what photo shops ask for  (--render)

Usage
  python tools/make_photo_qr.py
  python tools/make_photo_qr.py --render
  python tools/make_photo_qr.py --render --chrome "C:/Program Files/Google/Chrome/Application/chrome.exe"

Dependencies
  pip install segno zxing-cpp pillow cryptography
"""

import argparse
import io
import os
import platform
import re
import shutil
import subprocess
import sys
from html import escape
from pathlib import Path

import segno

from set_photo_album import PASSWORD

ROOT = Path(__file__).resolve().parent.parent
PRINT_PAGE = ROOT / "planning" / "photo-card.html"
OUT_DIR = ROOT / ".tmp" / "photo-qr"

# The trailing slash matters: GitHub Pages answers /photos with a redirect to
# /photos/, and a scan should land on the page in one hop.
DEFAULT_URL = "https://tomyjeyan.com/photos/"
INK = "#2e2b27"      # --ink in the invitation
QUIET_ZONE = 4       # modules of light margin the QR spec requires around the code

# 4R card in CSS px (96 per inch) and the scale that turns it into 300 dpi.
CARD_W, CARD_H = 384, 576
DPI_SCALE = 300 / 96

MARK_START = "<!-- qr:start -->"
MARK_END = "<!-- qr:end -->"
PW_START = "<!-- pw:start -->"
PW_END = "<!-- pw:end -->"


def build(url):
    qr = segno.make(url, error="q", boost_error=False, micro=False)
    return qr


def decode_png(png_bytes):
    """Return the text of every QR found in the image, or None if no decoder."""
    try:
        import zxingcpp
        from PIL import Image
    except ImportError:
        return None
    img = Image.open(io.BytesIO(png_bytes)).convert("L")
    return [r.text for r in zxingcpp.read_barcodes(img)]


def check(png_bytes, url, what):
    found = decode_png(png_bytes)
    if found is None:
        print(f"  ! {what}: not verified, install zxing-cpp and pillow to check scans")
        return
    if found != [url]:
        sys.exit(f"  x {what}: decoded {found!r}, expected [{url!r}]. Not writing a code that misreads.")
    print(f"  ok {what} scans as {url}")


def inline_svg(qr):
    # No width/height (the card sizes it in CSS), no fill behind it (the card's
    # paper is the light quiet zone), one path, crisp edges at any print scale.
    svg = qr.svg_inline(
        scale=1, border=QUIET_ZONE, dark=INK, light=None,
        svgclass="qr-svg", lineclass=None, omitsize=True,
    )
    return svg.replace("<svg ", '<svg role="img" aria-label="QR code for tomyjeyan.com/photos" '
                       'shape-rendering="crispEdges" ', 1)


def fill(html, start, end, content):
    pattern = re.compile(re.escape(start) + r".*?" + re.escape(end), re.S)
    if not pattern.search(html):
        sys.exit(f"  x {PRINT_PAGE.relative_to(ROOT)} has no {start} ... {end} block")
    return pattern.sub(lambda _: f"{start}{content}{end}", html, count=1)


def write_into_page(svg):
    html = PRINT_PAGE.read_text(encoding="utf-8")
    new = fill(html, MARK_START, MARK_END, svg)
    new = fill(new, PW_START, PW_END, escape(PASSWORD))
    if new != html:
        PRINT_PAGE.write_text(new, encoding="utf-8", newline="\n")
        print(f"  ok wrote the code and the password ({PASSWORD}) into {PRINT_PAGE.relative_to(ROOT)}")
    else:
        print(f"  ok {PRINT_PAGE.relative_to(ROOT)} already carries this code and password ({PASSWORD})")


def find_chrome(explicit):
    if explicit:
        return explicit
    if os.environ.get("CHROME_PATH"):
        return os.environ["CHROME_PATH"]
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "msedge"):
        hit = shutil.which(name)
        if hit:
            return hit
    for p in (
        "/opt/pw-browsers/chromium",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    ):
        if Path(p).exists():
            return p
    return None


def chrome(binary, *args):
    cmd = [binary, "--headless", "--disable-gpu", "--hide-scrollbars",
           # long enough for the two Google Fonts to arrive before the snapshot
           "--virtual-time-budget=15000", *args]
    # Chrome refuses to start as root without this (containers, CI)
    if platform.system() == "Linux" and hasattr(os, "geteuid") and os.geteuid() == 0:
        cmd.insert(1, "--no-sandbox")
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)


def render(binary):
    page = PRINT_PAGE.as_uri()
    pdf = OUT_DIR / "photo-card.pdf"
    png = OUT_DIR / "photo-card.png"
    chrome(binary, "--no-pdf-header-footer", f"--print-to-pdf={pdf}", page)
    print(f"  ok {pdf.relative_to(ROOT)}")
    # ?bare drops the on-screen preview chrome so the window is exactly the card
    chrome(binary, f"--window-size={CARD_W},{CARD_H}", f"--force-device-scale-factor={DPI_SCALE}",
           f"--screenshot={png}", page + "?bare")
    print(f"  ok {png.relative_to(ROOT)}")
    check(png.read_bytes(), ARGS.url, "printed card")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    qr = build(ARGS.url)
    print(f"QR for {ARGS.url}: version {qr.version}, error correction {qr.error}, "
          f"{qr.symbol_size(scale=1, border=0)[0]} modules a side")

    svg_path = OUT_DIR / "photo-qr.svg"
    qr.save(svg_path, kind="svg", scale=10, border=QUIET_ZONE, dark=INK, light="#ffffff", xmldecl=False)
    buf = io.BytesIO()
    side = qr.symbol_size(scale=1, border=QUIET_ZONE)[0]
    qr.save(buf, kind="png", scale=max(1, 2000 // side), border=QUIET_ZONE, dark=INK, light="#ffffff")
    png_bytes = buf.getvalue()
    check(png_bytes, ARGS.url, "code")
    (OUT_DIR / "photo-qr.png").write_bytes(png_bytes)
    print(f"  ok {svg_path.relative_to(ROOT)} and photo-qr.png")

    write_into_page(inline_svg(qr))

    if ARGS.render:
        binary = find_chrome(ARGS.chrome)
        if not binary:
            sys.exit("  x no Chrome or Edge found. Pass --chrome PATH, or open planning/photo-card.html "
                     "in a browser and Print > Save as PDF (paper 4 x 6 in, margins none).")
        render(binary)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--url", default=DEFAULT_URL, help=f"what the code opens (default {DEFAULT_URL})")
    ap.add_argument("--render", action="store_true", help="also print the card to PDF and PNG")
    ap.add_argument("--chrome", help="path to Chrome or Edge, if it isn't found on its own")
    ARGS = ap.parse_args()
    main()
