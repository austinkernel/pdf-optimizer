import pymupdf, os, sys, time
cases = [
 ("color_flate", dict(dpi_threshold=None, quality=90)),
 ("color_jpeg97", dict(dpi_threshold=None, quality=90)),
 ("color_jpeg97", dict(dpi_threshold=225, dpi_target=200, quality=85)),
 ("bw_flate", dict(bitonal=True, color=False, gray=False, lossless=True, lossy=True)),
]
for name, kw in cases:
    d = pymupdf.open(f"fixtures/{name}.pdf"); t=time.time()
    try:
        d.rewrite_images(**kw)
    except Exception as e:
        print(name, kw, "ERR", e); continue
    out = f"out/native_{name}_{abs(hash(str(kw)))%1000}.pdf"
    d.save(out, garbage=3, deflate=True, use_objstms=1)
    filt = set()
    for x in pymupdf.open(out).get_page_images(0, full=True): pass
    import pikepdf
    with pikepdf.open(out) as p:
        filt = sorted({str(o.get('/Filter')) for o in p.objects if isinstance(o, pikepdf.Stream) and o.get('/Subtype')=='/Image'})
    print(f"{name:13} {str(kw):70} {os.path.getsize(f'fixtures/{name}.pdf')/1e6:7.2f}MB -> {os.path.getsize(out)/1e6:6.2f}MB  {time.time()-t:4.1f}s  {filt}")
