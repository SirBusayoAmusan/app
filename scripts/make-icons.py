#!/usr/bin/env python3
"""Generate the CreatorTools favicon + PWA icon set.

The mark is the one the app already carried inline (index.html / manifest):
two overlapping circles — lavender #ecdcff meeting violet #7c5cff — on a dark
squircle tile, with the lens tinted so the overlap survives at 16 px.

Everything is drawn from primitives at 4x supersampling, so the output is
crisp and reproducible; no image model is involved.

Optical sizing matters more than pixel purity here:
  * 16 / 32 px      -> "small" variant: bigger circles, fewer visual tones
  * 192 / 512 "any" -> squircle tile, transparent corners
  * maskable        -> full-bleed square, mark inside the 80% safe zone
  * apple-touch     -> full-bleed opaque square (iOS applies its own mask)
"""
from __future__ import annotations

import math
import os

from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")
ICONS = os.path.join(PUBLIC, "icons")
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")

SS = 4  # supersample factor

INK_TOP = (34, 34, 38)
INK_BOTTOM = (23, 23, 26)
LILAC_LIGHT = (236, 220, 255)
LILAC_MID = (201, 184, 255)
LILAC_VIVID = (124, 92, 255)

# kind -> (circle radius, centre offset from midline) as a fraction of the tile
GEOMETRY = {
    "normal": (0.220, 0.118),
    # 16 px is brutal: the circles must stay fat AND clearly apart, or the mark
    # reads as one blob. Chosen by rendering variants and comparing at 12x zoom.
    "small": (0.250, 0.150),
    "apple": (0.185, 0.100),
    "maskable": (0.150, 0.080),
}


def vertical_gradient(size: int) -> Image.Image:
    grad = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        grad.putpixel(
            (0, y),
            tuple(round(INK_TOP[i] + (INK_BOTTOM[i] - INK_TOP[i]) * t) for i in range(3)),
        )
    return grad.resize((size, size), Image.BICUBIC).convert("RGBA")


def squircle_mask(size: int, samples: int = 2048, exponent: float = 5.0) -> Image.Image:
    """Apple-ish squircle: superellipse |x|^n + |y|^n = 1, rasterised as a polygon."""
    a = size / 2.0
    cx = cy = size / 2.0
    pts = []
    for i in range(samples):
        t = 2.0 * math.pi * i / samples
        ct, st = math.cos(t), math.sin(t)
        x = a * (abs(ct) ** (2.0 / exponent)) * (1 if ct >= 0 else -1)
        y = a * (abs(st) ** (2.0 / exponent)) * (1 if st >= 0 else -1)
        pts.append((cx + x, cy + y))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    return mask


def circle_mask(size: int, cx: float, cy: float, r: float) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    return mask


def mark_layer(size: int, kind: str) -> Image.Image:
    """Two overlapping circles with the intersection tinted."""
    r_ratio, offset_ratio = GEOMETRY[kind]
    r = r_ratio * size
    off = offset_ratio * size
    cy = size / 2.0
    left_cx, right_cx = size / 2.0 - off, size / 2.0 + off

    left = circle_mask(size, left_cx, cy, r)
    right = circle_mask(size, right_cx, cy, r)

    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    layer.paste(Image.new("RGBA", (size, size), LILAC_LIGHT + (255,)), (0, 0), left)
    layer.paste(Image.new("RGBA", (size, size), LILAC_VIVID + (255,)), (0, 0), right)
    lens = ImageChops.darker(left, right)
    layer.paste(Image.new("RGBA", (size, size), LILAC_MID + (255,)), (0, 0), lens)
    return layer


def render(size: int, kind: str = "normal", *, rounded: bool = True, ss: int = SS) -> Image.Image:
    S = size * ss
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bg_mask = squircle_mask(S) if rounded else Image.new("L", (S, S), 255)
    img.paste(vertical_gradient(S), (0, 0), bg_mask)
    img = Image.alpha_composite(img, mark_layer(S, kind))
    return img.resize((size, size), Image.LANCZOS)


def write_svg() -> None:
    """Vector twin of the raster mark (64-unit viewBox, same geometry)."""
    size, r, off = 64.0, 0.220 * 64, 0.118 * 64
    cy = size / 2
    lx, rx = size / 2 - off, size / 2 + off
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="CreatorTools">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#222226"/>
      <stop offset="1" stop-color="#17171a"/>
    </linearGradient>
    <clipPath id="left">
      <circle cx="{lx:.2f}" cy="{cy:.2f}" r="{r:.2f}"/>
    </clipPath>
  </defs>
  <rect width="64" height="64" fill="url(#tile)"/>
  <circle cx="{lx:.2f}" cy="{cy:.2f}" r="{r:.2f}" fill="#ecdcff"/>
  <circle cx="{rx:.2f}" cy="{cy:.2f}" r="{r:.2f}" fill="#7c5cff"/>
  <g clip-path="url(#left)">
    <circle cx="{rx:.2f}" cy="{cy:.2f}" r="{r:.2f}" fill="#c9b8ff"/>
  </g>
</svg>
"""
    with open(os.path.join(PUBLIC, "favicon.svg"), "w", encoding="utf-8") as fh:
        fh.write(svg)

    # Safari pinned tab: monochrome silhouette, colour applied by the browser.
    pinned = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="{lx:.2f}" cy="{cy:.2f}" r="{r:.2f}" fill="#000"/>
  <circle cx="{rx:.2f}" cy="{cy:.2f}" r="{r:.2f}" fill="#000"/>
</svg>
"""
    with open(os.path.join(ICONS, "safari-pinned-tab.svg"), "w", encoding="utf-8") as fh:
        fh.write(pinned)


def font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    path = os.path.join(ASSETS, f"Inter-{weight}.ttf")
    if os.path.exists(path):
        return ImageFont.truetype(path, size)
    for fallback in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if os.path.exists(fallback):
            return ImageFont.truetype(fallback, size)
    return ImageFont.load_default()


def og_image() -> None:
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), (23, 23, 26))
    # soft radial lift in the upper-left so the card is not a flat slab
    glow = Image.new("L", (W, H), 0)
    gd = ImageDraw.Draw(glow)
    for i in range(26):
        alpha = int(7 * (1 - i / 26))
        gd.ellipse([-260 - i * 22, -300 - i * 22, 620 + i * 22, 560 + i * 22], fill=alpha)
    img = Image.composite(Image.new("RGB", (W, H), (44, 44, 52)), img, glow)

    # The icon tile is a shade lighter than the card with a hairline violet
    # edge, otherwise a dark tile on a dark card reads as an empty hole.
    tsize, tss = 184, 4
    S = tsize * tss
    tile = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(tile).rounded_rectangle(
        [0, 0, S - 1, S - 1], radius=int(0.28 * S), fill=(44, 44, 53, 255)
    )
    tile = Image.alpha_composite(tile, mark_layer(S, "normal"))
    tile = tile.resize((tsize, tsize), Image.LANCZOS)
    ImageDraw.Draw(tile).rounded_rectangle(
        [1, 1, tsize - 2, tsize - 2], radius=int(0.28 * tsize), outline=(124, 92, 255, 110), width=2
    )
    tx, ty = 84, (H - tsize) // 2
    glow_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for i in range(16):
        alpha = int(5 * (1 - i / 16))
        ImageDraw.Draw(glow_layer).ellipse(
            [tx - 40 - i * 16, ty - 40 - i * 16, tx + tsize + 40 + i * 16, ty + tsize + 40 + i * 16],
            fill=(124, 92, 255, alpha),
        )
    img = Image.alpha_composite(img.convert("RGBA"), glow_layer).convert("RGB")
    img.paste(tile, (tx, ty), tile)

    d = ImageDraw.Draw(img)
    x = 84 + 184 + 52
    f_word = font("600", 74)
    f_tag = font("400", 36)
    f_pill = font("600", 25)

    d.text((x, 196), "CreatorTools", font=f_word, fill=(255, 255, 255))
    d.text((x, 300), "Stop guessing what to sell.", font=f_tag, fill=(185, 182, 196))

    label = "Evidence-backed opportunity intelligence"
    pad_x, pill_h = 26, 60
    tw = d.textlength(label, font=f_pill)
    py = 372
    d.rounded_rectangle(
        [x, py, x + tw + pad_x * 2, py + pill_h], radius=pill_h // 2, fill=(38, 38, 46)
    )
    d.text((x + pad_x, py + (pill_h - 30) // 2 - 2), label, font=f_pill, fill=(201, 184, 255))

    d.text(
        (84, H - 70),
        "Local-first  ·  Evidence with sources  ·  Your API keys stay in your browser",
        font=font("400", 24),
        fill=(126, 124, 138),
    )
    img.save(os.path.join(PUBLIC, "og-image.png"), optimize=True)


def main() -> None:
    os.makedirs(ICONS, exist_ok=True)

    # Favicons (PNG) — full-bleed squares with the optically enlarged mark.
    # 16 px needs the heaviest supersampling: 4x leaves visibly ragged diagonals.
    render(16, "small", rounded=False, ss=16).save(os.path.join(PUBLIC, "favicon-16x16.png"))
    render(32, "small", rounded=False, ss=8).save(os.path.join(PUBLIC, "favicon-32x32.png"))

    # Multi-resolution .ico for legacy tabs, bookmarks and Windows shortcuts.
    # NB: Pillow skips requested sizes larger than the base image, so the base
    # frame must be the largest one (48) with the smaller frames appended.
    frames = {
        16: render(16, "small", rounded=False, ss=16),
        32: render(32, "small", rounded=False, ss=8),
        48: render(48, "normal", rounded=False, ss=8),
    }
    ico_path = os.path.join(PUBLIC, "favicon.ico")
    frames[48].save(
        ico_path,
        format="ICO",
        append_images=[frames[32], frames[16]],
        sizes=[(16, 16), (32, 32), (48, 48)],
    )

    # Apple touch icon: full-bleed opaque square, iOS supplies the mask.
    render(180, "apple", rounded=False).save(os.path.join(PUBLIC, "apple-touch-icon.png"))

    # PWA "any" icons: squircle tile with transparent corners.
    render(192, "normal").save(os.path.join(ICONS, "icon-192.png"))
    render(512, "normal").save(os.path.join(ICONS, "icon-512.png"))

    # Maskable: full-bleed, mark pulled into the safe zone.
    render(192, "maskable", rounded=False).save(os.path.join(ICONS, "maskable-192.png"))
    render(512, "maskable", rounded=False).save(os.path.join(ICONS, "maskable-512.png"))

    write_svg()
    og_image()

    print("icons written to public/ and public/icons/")


if __name__ == "__main__":
    main()
