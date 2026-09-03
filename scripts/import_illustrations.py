"""Resize the illustration set into the web-sized files the app ships.

    python3 scripts/import_illustrations.py

Sources live in "image icon/health-illustration-set-complete/" and are NOT
committed: 24 PNGs at 1024px come to about 15MB. Only the WebP files under
images/ are, at roughly 143KB for the lot.

The set has two variants of each subject. The icon-only cutouts read clearly at
26px, so they serve as section marks; the versions inside a glass orb need room
for the sphere and its sparkles, so they are used only where a large piece fits.
"""

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "image icon" / "health-illustration-set-complete"
OUT = ROOT / "images"

# (source, output, rendered size in CSS pixels x2 for high-density screens)
PLAN = [
    ("icon-only/06-fruit-bowl-icon.png", "mark-meal.webp", 128),
    ("icon-only/02-yoga-tree-pose-icon.png", "mark-workout.webp", 128),
    ("icon-only/09-water-glass-icon.png", "mark-weight.webp", 128),
    ("icon-only/11-privacy-lock-icon.png", "mark-checkup.webp", 128),
    ("icon-only/10-heart-icon.png", "mark-balance.webp", 128),
    ("icon-only/04-running-icon.png", "mark-weekly.webp", 128),
    ("orb/01-meditation.png", "hero-health.webp", 440),
    ("orb/10-heart.png", "hero-auth.webp", 360),
    ("orb/08-coffee-tea.png", "hero-balance.webp", 320),
]


def main():
    if not SRC.exists():
        sys.exit(f"원본 폴더를 찾을 수 없습니다: {SRC}")
    OUT.mkdir(exist_ok=True)
    total = 0
    for source, name, size in PLAN:
        image = Image.open(SRC / source).convert("RGBA")
        image = image.resize((size, size), Image.LANCZOS)
        target = OUT / name
        image.save(target, "WEBP", quality=88, method=6)
        total += target.stat().st_size
        print(f"  {name:<22} {size:>4}px  {target.stat().st_size:>7,} bytes")
    print(f"  {'합계':<22}       {total:>7,} bytes")


if __name__ == "__main__":
    main()
