# Milestone 1 experiments

Reproduce (Node 22, Python 3.11+):

```sh
npm i mupdf@1.28.1                       # in this directory
pip install pikepdf numpy pillow scikit-image pymupdf
python3 make_fixtures.py ./fixtures      # synthetic 300 DPI scans + OCR layer + links + outline
node exp_mupdf.mjs fixtures/color_flate.pdf out.pdf 90     # Stage A JS rewriter (q=0 → structural only)
node inspect.mjs fixtures/color_flate.pdf a && node inspect.mjs out.pdf b
python3 compare.py a b                   # pages/boxes/rotation/text/links/outline + SSIM/PSNR
python3 native.py                        # native pdf_rewrite_images via PyMuPDF (Stage B preview)
```

Results are recorded in `../../docs/milestone-1-feasibility.md` §6.
