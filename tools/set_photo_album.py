"""
set_photo_album.py: lock the photo album link on tomyjeyan.com/photos behind the
guests' password.

The site is static and the repo is public, so the album link can't sit in the
page as plain text. This encrypts it with the password instead (PBKDF2-SHA256
key, AES-256-GCM) and writes only the encrypted blob into docs/photos/index.html.
The page decrypts it in the guest's browser once they type the password; a
wrong password fails to decrypt, so there is nothing to read without it.

How strong that is depends on the password. "ToMyJeyan" is printed on the table
cards and is the couple's hashtag, so this keeps out people who only have the
link (someone sharing it online, bots), not a determined guesser.

The password is matched forgivingly, the same way here and in the page:
capitals, spaces and a leading # don't matter ("#ToMyJeyan", "to my jeyan").

Usage
  python tools/set_photo_album.py --album "https://photos.app.goo.gl/..."
  python tools/set_photo_album.py --album ""        # no album yet: the page
                                                    # unlocks to "opens on Dec 27"
  python tools/set_photo_album.py --album URL --password NewPassword

Changing the password: change PASSWORD below, rerun this with the album link,
then rerun tools/make_photo_qr.py so the printed card shows the new one.

Dependencies
  pip install cryptography
"""

import argparse
import base64
import hashlib
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "docs" / "photos" / "index.html"

PASSWORD = "ToMyJeyan"
# High enough to slow guessing, low enough to unlock in well under a second on
# an older phone. The page reads the count from the blob, so it can change.
ITERATIONS = 210_000

VAULT = re.compile(r'(<script type="application/json" id="vault">)(.*?)(</script>)', re.S)


def normalize(pw):
    """Mirror of norm() in the page's script. Keep the two in step."""
    s = unicodedata.normalize("NFKC", pw).lower()
    s = re.sub(r"\s+", "", s)
    return s.lstrip("#")


def seal(album, password):
    salt, iv = os.urandom(16), os.urandom(12)
    key = hashlib.pbkdf2_hmac("sha256", normalize(password).encode("utf-8"), salt, ITERATIONS, dklen=32)
    payload = json.dumps({"album": album}, separators=(",", ":")).encode("utf-8")
    ct = AESGCM(key).encrypt(iv, payload, None)  # ciphertext + 16-byte tag, as WebCrypto expects
    b64 = lambda b: base64.b64encode(b).decode("ascii")
    return {"v": 1, "iter": ITERATIONS, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}


def unseal(vault, password):
    d = lambda k: base64.b64decode(vault[k])
    key = hashlib.pbkdf2_hmac("sha256", normalize(password).encode("utf-8"), d("salt"), vault["iter"], dklen=32)
    return json.loads(AESGCM(key).decrypt(d("iv"), d("ct"), None))


def main():
    album = ARGS.album.strip()
    if album and not album.startswith("https://"):
        sys.exit("  x the album link should start with https://")

    vault = seal(album, ARGS.password)
    # Prove the round trip before touching the page: the right password opens
    # it, a wrong one doesn't.
    assert unseal(vault, ARGS.password) == {"album": album}
    assert unseal(vault, "  #" + ARGS.password.upper() + " ") == {"album": album}
    try:
        unseal(vault, ARGS.password + "x")
        sys.exit("  x a wrong password opened the vault; not writing it")
    except Exception:
        pass

    html = PAGE.read_text(encoding="utf-8")
    if not VAULT.search(html):
        sys.exit(f'  x {PAGE.relative_to(ROOT)} has no <script type="application/json" id="vault"> block')
    blob = json.dumps(vault, separators=(",", ":"))
    PAGE.write_text(VAULT.sub(lambda m: m.group(1) + blob + m.group(3), html, count=1),
                    encoding="utf-8", newline="\n")
    print(f"  ok locked {'the album link' if album else 'an empty album (page will say it opens on Dec 27)'} "
          f"behind the password into {PAGE.relative_to(ROOT)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--album", required=True, help='the shared album link, or "" if there isn\'t one yet')
    ap.add_argument("--password", default=PASSWORD, help=f"what guests type (default {PASSWORD})")
    ARGS = ap.parse_args()
    main()
