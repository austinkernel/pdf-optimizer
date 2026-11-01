"""Synthetic 'scanned' PDFs: page-sized raster + invisible OCR text (Tr 3) + link annot + outline."""
import io, sys, zlib, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import pikepdf
from pikepdf import Name, Dictionary, Array, Stream

OUT = sys.argv[1]
DPI = 300
W_PT, H_PT = 612, 792
W, H = W_PT * DPI // 72, H_PT * DPI // 72
rng = np.random.default_rng(1)
try:
    FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", 42)
except Exception:
    FONT = ImageFont.load_default()
WORDS = "the quick brown fox jumps over lazy dog invoice total amount due payment reference account statement".split()

def scan_page(mode, seed):
    random.seed(seed)
    img = Image.new("RGB", (W, H), (246, 243, 236))
    d = ImageDraw.Draw(img)
    lines = []
    y = 200
    while y < H - 900:
        words = [random.choice(WORDS) for _ in range(9)]
        txt = " ".join(words)
        d.text((180, y), txt, fill=(25, 25, 30), font=FONT)
        lines.append((180, y, txt))
        y += 70
    if mode in ("color", "gray"):
        # photo-like region: smooth gradient + texture
        yy, xx = np.mgrid[0:700, 0:1400]
        photo = np.stack([(xx / 1400 * 200 + 30), (yy / 700 * 180 + 40), ((xx + yy) % 255)], -1)
        photo += rng.normal(0, 12, photo.shape)
        img.paste(Image.fromarray(np.clip(photo, 0, 255).astype(np.uint8)), (550, H - 850))
        d.ellipse((200, H - 800, 480, H - 520), outline=(180, 30, 40), width=12)  # red stamp
    img = img.filter(ImageFilter.GaussianBlur(0.8))
    arr = np.asarray(img).astype(np.float32) + rng.normal(0, 4, (H, W, 3))  # sensor noise
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    if mode == "gray":
        img = img.convert("L")
    elif mode == "bw":
        img = img.convert("L").point(lambda v: 255 if v > 150 else 0, "1")
    return img, lines

def image_xobject(pdf, img, enc):
    if enc == "jpeg":
        b = io.BytesIO(); img.save(b, "JPEG", quality=97, subsampling=0); data = b.getvalue(); flt = Name.DCTDecode
    elif img.mode == "1":
        data = zlib.compress(img.tobytes(), 6); flt = Name.FlateDecode
    else:
        data = zlib.compress(img.tobytes(), 6); flt = Name.FlateDecode
    cs = {"RGB": Name.DeviceRGB, "L": Name.DeviceGray, "1": Name.DeviceGray}[img.mode]
    s = Stream(pdf, data)
    s.stream_dict = Dictionary(Type=Name.XObject, Subtype=Name.Image, Width=img.width, Height=img.height,
                               ColorSpace=cs, BitsPerComponent=1 if img.mode == "1" else 8, Filter=flt)
    return pdf.make_indirect(s)

def build(name, mode, enc, pages=3):
    pdf = pikepdf.new()
    font = pdf.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name.Helvetica))
    for p in range(pages):
        img, lines = scan_page(mode, p)
        xo = image_xobject(pdf, img, enc)
        ops = [f"q {W_PT} 0 0 {H_PT} 0 0 cm /Im0 Do Q", "BT 3 Tr /F1 10 Tf"]
        for (x, y, t) in lines:
            ops.append(f"1 0 0 1 {x*72/DPI:.2f} {H_PT - (y+40)*72/DPI:.2f} Tm ({t}) Tj")
        ops.append("ET")
        page = pdf.add_blank_page(page_size=(W_PT, H_PT))
        page.Resources = Dictionary(XObject=Dictionary(Im0=xo), Font=Dictionary(F1=font))
        page.Contents = pdf.make_stream("\n".join(ops).encode())
        page.Annots = pdf.make_indirect(Array([pdf.make_indirect(Dictionary(Type=Name.Annot, Subtype=Name.Link,
            Rect=[50, 50, 200, 70], Border=[0, 0, 0], A=Dictionary(S=Name.URI, URI=pikepdf.String("https://example.com/p%d" % p))))]))
    with pdf.open_outline() as ol:
        for i in range(pages):
            ol.root.append(pikepdf.OutlineItem(f"Section {i+1}", i))
    pdf.docinfo["/Title"] = name
    pdf.save(f"{OUT}/{name}.pdf")

build("color_flate", "color", "flate")
build("color_jpeg97", "color", "jpeg")
build("gray_jpeg97", "gray", "jpeg")
build("bw_flate", "bw", "flate")
