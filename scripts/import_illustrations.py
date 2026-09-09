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
    # The giant fills the window and is cropped by it, so it needs the source's
    # full resolution.
    ("icon-only/04-running-icon.png", "giant-running.webp", 1024),
    # Small specks. The four that are drawn large get their own bigger files,
    # since upscaling a 96px one would show.
    ("icon-only/03-boxing-icon.png", "speck-boxing.webp", 96),
    ("icon-only/05-stretching-icon.png", "speck-stretching.webp", 96),
    ("icon-only/07-avocado-icon.png", "speck-avocado.webp", 96),
    # The moon is drawn small but its filigree needs the detail, so it is
    # exported far above its display size and at a higher quality.
    ("icon-only/12-moon-stars-icon.png", "speck-moon.webp", 512, 96),
    ("icon-only/09-water-glass-icon.png", "speck-water.webp", 224),
    ("icon-only/10-heart-icon.png", "speck-heart.webp", 256),
    ("icon-only/11-privacy-lock-icon.png", "speck-lock.webp", 224),
]


def main():
    if not SRC.exists():
        sys.exit(f"원본 폴더를 찾을 수 없습니다: {SRC}")
    OUT.mkdir(exist_ok=True)
    total = 0
    for entry in PLAN:
        source, name, size = entry[:3]
        quality = entry[3] if len(entry) > 3 else 88
        image = Image.open(SRC / source).convert("RGBA")
        image = image.resize((size, size), Image.LANCZOS)
        target = OUT / name
        image.save(target, "WEBP", quality=quality, method=6)
        total += target.stat().st_size
        print(f"  {name:<22} {size:>4}px  {target.stat().st_size:>7,} bytes")
    print(f"  {'합계':<22}       {total:>7,} bytes")


if __name__ == "__main__":
    main()
