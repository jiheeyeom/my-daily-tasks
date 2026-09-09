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
CHARMS = ROOT / "image icon" / "web-assets"
RUNNERS = ROOT / "image icon" / "runner-7lock-colorways"
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
    ("icon-only/12-moon-stars-icon.png", "speck-moon.webp", 512, 96, True),
    ("icon-only/09-water-glass-icon.png", "speck-water.webp", 224),
    ("icon-only/10-heart-icon.png", "speck-heart.webp", 256),
    ("icon-only/11-privacy-lock-icon.png", "speck-lock.webp", 224),
]


# Charms decorating the page edges. These keep their own aspect ratio, so the
# number is the longest side rather than a square.
CHARM_PLAN = [
    ("03-silver-clear-keyring.png", "charm-side-left.webp", 900),
    ("02-silver-puffy-bow.png", "charm-side-right.webp", 900),
    ("01-silver-charm-chain.png", "charm-top.webp", 1100),
    # Drawn at 340px, so 560 is still a comfortable oversample and costs
    # little; the chalk hatching is what makes this one expensive.
    ("04-mom-exercise-chalk-note.png", "charm-note.webp", 560),
    ("05-silver-formula-car.png", "charm-car.webp", 760),
]


# The runner behind the page, in the colourway that suits each theme: the
# cooler one carries on a dark ground, the brighter one on a light.
RUNNER_PLAN = [
    ("runner-7lock-aurora.png", "runner-light.webp", 1600),
    ("runner-7lock-moonlight.png", "runner-dark.webp", 1600),
]


def convert_runners():
    if not RUNNERS.exists():
        print(f"  건너뜀 · 폴더 없음: {RUNNERS.name}")
        return 0
    total = 0
    for source, name, longest in RUNNER_PLAN:
        image = Image.open(RUNNERS / source).convert("RGBA")
        image = image.crop(image.getchannel("A").getbbox())
        scale = longest / max(image.size)
        image = image.resize(
            (round(image.width * scale), round(image.height * scale)), Image.LANCZOS
        )
        target = OUT / name
        image.save(target, "WEBP", quality=78, method=6)
        total += target.stat().st_size
        print(f"  {name:<22} {image.width:>4}x{image.height:<4} {target.stat().st_size:>7,} bytes")
    return total


def convert_charms():
    if not CHARMS.exists():
        print(f"  건너뜀 · 폴더 없음: {CHARMS.name}")
        return 0
    total = 0
    for source, name, longest in CHARM_PLAN:
        image = Image.open(CHARMS / source).convert("RGBA")
        image = image.crop(image.getchannel("A").getbbox())
        scale = longest / max(image.size)
        image = image.resize(
            (round(image.width * scale), round(image.height * scale)), Image.LANCZOS
        )
        target = OUT / name
        # They are drawn at a third to a half opacity behind everything else,
        # so a lower quality is invisible here and saves most of their weight.
        image.save(target, "WEBP", quality=68, method=6)
        total += target.stat().st_size
        print(f"  {name:<22} {image.width:>4}x{image.height:<4} {target.stat().st_size:>7,} bytes")
    return total


def main():
    if not SRC.exists():
        sys.exit(f"원본 폴더를 찾을 수 없습니다: {SRC}")
    OUT.mkdir(exist_ok=True)
    total = 0
    for entry in PLAN:
        source, name, size = entry[:3]
        quality = entry[3] if len(entry) > 3 else 88
        trim = entry[4] if len(entry) > 4 else False
        image = Image.open(SRC / source).convert("RGBA")
        if trim:
            # Some pieces are drawn small inside a large transparent frame, so
            # the rendered size overstates how much of them you actually see.
            # Cropping to the drawn area and re-centring makes the CSS width
            # mean the artwork's width. Squared off so width == height holds.
            box = image.getchannel("A").getbbox()
            image = image.crop(box)
            side = max(image.size)
            square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            square.paste(image, ((side - image.width) // 2, (side - image.height) // 2))
            image = square
        image = image.resize((size, size), Image.LANCZOS)
        target = OUT / name
        image.save(target, "WEBP", quality=quality, method=6)
        total += target.stat().st_size
        print(f"  {name:<22} {size:>4}px  {target.stat().st_size:>7,} bytes")
    total += convert_charms()
    total += convert_runners()
    print(f"  {'합계':<22}       {total:>7,} bytes")


if __name__ == "__main__":
    main()
