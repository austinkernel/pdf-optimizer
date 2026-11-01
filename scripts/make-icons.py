"""Generates the app icons (run once; outputs are committed)."""
import sys
from PIL import Image, ImageDraw
out = sys.argv[1]
def icon(size, maskable=False):
    S = size * 4  # supersample
    im = Image.new("RGB", (S, S), (10, 102, 214))
    d = ImageDraw.Draw(im)
    for y in range(S):  # vertical gradient
        t = y / S
        d.line([(0, y), (S, y)], fill=(int(30 - 20 * t), int(130 - 40 * t), int(240 - 30 * t)))
    pad = S * (0.26 if maskable else 0.2)
    w = S - 2 * pad
    x0, y0, x1, y1 = pad + w * 0.12, pad, pad + w * 0.88, S - pad
    fold = w * 0.22
    d.polygon([(x0, y0), (x1 - fold, y0), (x1, y0 + fold), (x1, y1), (x0, y1)], fill=(255, 255, 255))
    d.polygon([(x1 - fold, y0), (x1 - fold, y0 + fold), (x1, y0 + fold)], fill=(200, 220, 245))
    cx = (x0 + x1) / 2
    lw = S * 0.035
    for k in range(3):  # text lines
        yy = y0 + w * (0.30 + 0.12 * k)
        d.rounded_rectangle([x0 + w * 0.12, yy, x1 - w * 0.12, yy + lw], radius=lw / 2, fill=(170, 190, 215))
    # compress arrows (pointing inward)
    a = w * 0.13
    for sgn, base in ((1, y0 + w * 0.70), (-1, y1 - w * 0.06)):
        d.polygon([(cx - a, base), (cx + a, base), (cx, base + sgn * a)], fill=(10, 102, 214))
    return im.resize((size, size), Image.LANCZOS)
icon(180).save(f"{out}/apple-touch-icon.png", optimize=True)
icon(192).save(f"{out}/icon-192.png", optimize=True)
icon(512).save(f"{out}/icon-512.png", optimize=True)
icon(512, maskable=True).save(f"{out}/icon-maskable-512.png", optimize=True)
