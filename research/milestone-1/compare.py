import json, sys, numpy as np
from PIL import Image
from skimage.metrics import structural_similarity as ssim, peak_signal_noise_ratio as psnr
a, b = sys.argv[1], sys.argv[2]
A, B = json.load(open(a + ".json")), json.load(open(b + ".json"))
checks = {k: A[k] == B[k] for k in ("pages", "boxes", "rot", "text", "links", "outline", "title")}
s, p, worst = [], [], 0
for i in range(A["pages"]):
    x = np.asarray(Image.open(f"{a}_p{i}.png").convert("L")); y = np.asarray(Image.open(f"{b}_p{i}.png").convert("L"))
    s.append(ssim(x, y, data_range=255)); p.append(psnr(x, y, data_range=255))
    worst = max(worst, int(np.abs(x.astype(int) - y.astype(int)).max()))
    blank = y.std() < 1.0
print(f"{b.split('/')[-1]:22} " + " ".join(f"{k}={'OK' if v else 'FAIL'}" for k, v in checks.items()) +
      f"  textChars={sum(map(len,B['text']))}  SSIM(min)={min(s):.4f}  PSNR(min)={min(p):.2f}dB  maxAbsDiff={worst}")
