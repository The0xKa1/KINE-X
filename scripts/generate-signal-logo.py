#!/usr/bin/env python3
"""Generate the final KINE//X "signal slice" logo (concept C) as real assets.

The mark is the Archivo Black "X" sliced into five horizontal bands, each
band displaced sideways; the middle band stays hot orange — a motion signal
caught mid-transmission. Glyph outlines come from the local
public/fonts/archivo-black.woff2, so every SVG is self-contained vector.

Outputs:
  assets/brand/kinex-mark.svg        master, ink+orange on transparent
  assets/brand/kinex-mark-tile.svg   paper tile version (favicon / touch icon)
  public/brand/...                   served copies + rasterized PNGs
"""

import subprocess
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "public/fonts/archivo-black.woff2"
BRAND = ROOT / "assets/brand"
PUBLIC = ROOT / "public/brand"

INK = "#111111"
HOT = "#ff4d00"
PAPER = "#f7f1e5"

# five bands across the cap height: (band index, dx in font units, hot?)
BANDS = [
    (0, 0, False),
    (1, -35, False),
    (2, 27, True),
    (3, -18, False),
    (4, 10, False),
]
CAP = 716  # Archivo Black cap height in font units
PAD_X = 80  # horizontal padding so displaced bands never clip


def x_glyph():
    font = TTFont(FONT)
    glyph_set = font.getGlyphSet()
    name = font.getBestCmap()[ord("X")]
    pen = SVGPathPen(glyph_set)
    glyph_set[name].draw(pen)
    return pen.getCommands(), glyph_set[name].width


def mark_svg():
    """The mark on its own tight canvas (transparent background)."""
    d, adv = x_glyph()
    w = adv + PAD_X * 2
    h = CAP
    band_h = CAP / len(BANDS)

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">',
        "<defs>",
    ]
    for i, _, _ in BANDS:
        # band index 0 is the TOP slice in screen space (y-down)
        parts.append(
            f'<clipPath id="b{i}"><rect x="0" y="{i * band_h:.2f}" '
            f'width="{w}" height="{band_h + 0.5:.2f}"/></clipPath>'
        )
    parts.append("</defs>")

    for i, dx, hot in BANDS:
        color = HOT if hot else INK
        # flip y-up font units into y-down screen space, then displace
        parts.append(
            f'<g clip-path="url(#b{i})">'
            f'<path d="{d}" fill="{color}" '
            f'transform="translate({PAD_X + dx} {h}) scale(1 -1)"/>'
            f"</g>"
        )
    parts.append("</svg>")
    return "".join(parts)


def tile_svg():
    """Square paper tile with the mark centered — favicon / touch icon."""
    d, adv = x_glyph()
    w = adv + PAD_X * 2
    h = CAP
    side = 1000
    scale = (side * 0.78) / max(w, h)
    tx = (side - w * scale) / 2
    ty = (side - h * scale) / 2
    inner = mark_svg()
    # strip the outer <svg> wrapper, keep the body (defs + bands)
    body = inner[len(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">'):-len("</svg>")]
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {side} {side}">'
        f'<rect width="{side}" height="{side}" fill="{PAPER}" rx="150"/>'
        f'<g transform="translate({tx:.1f} {ty:.1f}) scale({scale:.4f})">'
        f"{body}</g></svg>"
    )


def main():
    BRAND.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)

    master = mark_svg()
    tile = tile_svg()

    for path in (BRAND / "kinex-mark.svg", PUBLIC / "kinex-mark.svg"):
        path.write_text(master, encoding="utf-8")
    for path in (BRAND / "kinex-mark-tile.svg", PUBLIC / "kinex-mark-tile.svg"):
        path.write_text(tile, encoding="utf-8")
    print("wrote SVG masters")

    for size, name in ((32, "favicon-32.png"), (180, "apple-touch-icon.png"),
                       (192, "icon-192.png"), (512, "icon-512.png")):
        out = PUBLIC / name
        subprocess.run(
            ["rsvg-convert", "-w", str(size), str(PUBLIC / "kinex-mark-tile.svg"), "-o", str(out)],
            check=True,
        )
        print("wrote", out)


if __name__ == "__main__":
    main()
