"""Generate a packed base64 set of land-only dot coordinates for the journey.html globe.

Downloads a public-domain land/water mask (three-globe example texture, MIT-licensed
repo; imagery derived from NASA Blue Marble which is public domain), fibonacci-samples
the sphere, keeps points that fall on land, and packs each point as lat/lon quantized
to 12 bits each (3 bytes per dot) -> base64.

Output: .tmp/land_dots_b64.txt  (paste into journey.html LAND_B64)
Usage:  python tools/make_land_dots.py [target_dot_count]
"""
import base64
import io
import math
import sys
import urllib.request

MASK_URLS = [
    "https://unpkg.com/three-globe/example/img/earth-water.png",
    "https://raw.githubusercontent.com/vasturiano/three-globe/master/example/img/earth-water.png",
]

def fetch_mask():
    last = None
    for url in MASK_URLS:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            print(f"fetched {url} ({len(data)} bytes)")
            return data
        except Exception as e:  # noqa: BLE001 - try next mirror
            last = e
            print(f"failed {url}: {e}")
    raise SystemExit(f"could not fetch any mask: {last}")

def main():
    n_samples = 16000
    target = int(sys.argv[1]) if len(sys.argv) > 1 else 5600

    from PIL import Image  # pillow

    img = Image.open(io.BytesIO(fetch_mask())).convert("L")
    w, h = img.size
    px = img.load()

    def is_water(lat, lon):
        x = min(w - 1, max(0, int((lon + 180.0) / 360.0 * w)))
        y = min(h - 1, max(0, int((90.0 - lat) / 180.0 * h)))
        return px[x, y] > 127

    # determine polarity: mid-Pacific must be water, central Arabia must be land
    pacific_white = is_water(0, -160)
    arabia_white = is_water(24, 45)
    if pacific_white and not arabia_white:
        water_is_white = True
    elif arabia_white and not pacific_white:
        water_is_white = False
    else:
        raise SystemExit("mask polarity ambiguous; inspect the image")
    print(f"mask {w}x{h}, water_is_white={water_is_white}")

    golden = math.pi * (3 - math.sqrt(5))
    land = []
    for i in range(n_samples):
        y = 1 - (i / (n_samples - 1)) * 2
        lat = math.degrees(math.asin(y))
        lon = math.degrees((golden * i) % (2 * math.pi)) - 180
        white = is_water(lat, lon)
        on_land = (not white) if water_is_white else white
        if on_land:
            land.append((lat, lon))

    print(f"land points: {len(land)} / {n_samples}")
    if len(land) > target:
        step = len(land) / target
        land = [land[int(i * step)] for i in range(target)]
    print(f"kept: {len(land)}")

    buf = bytearray()
    for lat, lon in land:
        la = max(0, min(4095, round((lat + 90.0) / 180.0 * 4095)))
        lo = max(0, min(4095, round((lon + 180.0) / 360.0 * 4095)))
        buf += bytes(((la >> 4) & 0xFF, ((la & 0xF) << 4) | (lo >> 8), lo & 0xFF))

    b64 = base64.b64encode(bytes(buf)).decode("ascii")
    out = ".tmp/land_dots_b64.txt"
    with open(out, "w", encoding="ascii") as f:
        f.write(b64)
    print(f"wrote {out}: {len(b64)} chars ({len(buf)} bytes, {len(land)} dots)")

if __name__ == "__main__":
    main()
