"""Generates the app icons (run once; outputs are committed)."""
import sys
from PIL import Image, ImageDraw
out = sys.argv[1]
def icon(size, maskable=False, preview=False):
    S = size * 4  # supersample
    im = Image.new("RGB", (S, S), (10, 102, 214))
    d = ImageDraw.Draw(im)
    for y in range(S):  # vertical gradient (blue for the app, orange for the preview build)
        t = y / S
        c = (int(255 - 20 * t), int(160 - 50 * t), int(40 - 20 * t)) if preview else (int(30 - 20 * t), int(130 - 40 * t), int(240 - 30 * t))
        d.line([(0, y), (S, y)], fill=c)
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
        d.polygon([(cx - a, base), (cx + a, base), (cx, base + sgn * a)], fill=(215, 105, 15) if preview else (10, 102, 214))
    if preview:  # diagonal "PREVIEW" band so it cannot be mistaken for the real app
        band = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        bd = ImageDraw.Draw(band)
        h = S * 0.17
        bd.rectangle([0, S * 0.5 - h / 2, S, S * 0.5 + h / 2], fill=(20, 20, 24, 235))
        from PIL import ImageFont
        try:
            f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", int(h * 0.62))
        except Exception:
            f = ImageFont.load_default()
        bd.text((S / 2, S * 0.5), "PREVIEW", font=f, fill=(255, 255, 255, 255), anchor="mm")
        band = band.rotate(-18, resample=Image.BICUBIC, center=(S / 2, S / 2))
        im = Image.alpha_composite(im.convert("RGBA"), band).convert("RGB")
    return im.resize((size, size), Image.LANCZOS)
icon(180).save(f"{out}/apple-touch-icon.png", optimize=True)
icon(192).save(f"{out}/icon-192.png", optimize=True)
icon(512).save(f"{out}/icon-512.png", optimize=True)
icon(512, maskable=True).save(f"{out}/icon-maskable-512.png", optimize=True)
icon(180, preview=True).save(f"{out}/preview-apple-touch-icon.png", optimize=True)
icon(192, preview=True).save(f"{out}/preview-icon-192.png", optimize=True)
icon(512, preview=True).save(f"{out}/preview-icon-512.png", optimize=True)
icon(512, maskable=True, preview=True).save(f"{out}/preview-icon-maskable-512.png", optimize=True)
