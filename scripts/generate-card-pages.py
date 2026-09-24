#!/usr/bin/env python3
"""Write docs/go/C001.html–C500.html from the L11 forwarder template.

Card pages are not flyer pins. This script does not modify dest.js or any L page.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "docs" / "go" / "L11.html"
OUT_DIR = ROOT / "docs" / "go"
TEMPLATE_ID = "L11"
COUNT = 500


def main() -> None:
    template = TEMPLATE.read_text(encoding="utf-8")
    if template.count(TEMPLATE_ID) != 2:
        raise SystemExit(f"{TEMPLATE} should mention {TEMPLATE_ID} exactly twice")
    for n in range(1, COUNT + 1):
        card_id = f"C{n:03d}"
        path = OUT_DIR / f"{card_id}.html"
        path.write_text(template.replace(TEMPLATE_ID, card_id), encoding="utf-8")
    print(f"wrote {COUNT} card pages in {OUT_DIR}")


if __name__ == "__main__":
    main()
