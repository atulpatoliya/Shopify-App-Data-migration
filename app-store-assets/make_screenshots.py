"""Turns raw admin screenshots into 1600x900 App Store screenshots.

- Removes the dark Shopify admin sidebar
- Keeps the app header (breadcrumb + buttons) but moves it next to the content
- Crops to the content cards and pads to 16:9 on a white background
Run: python make_screenshots.py
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "screenshots")

# source, output name, max content height (to cut floating bars), white-out boxes
JOBS = [
    ("Screenshot_21.png", "01-dashboard.png", None, [(1095, 980, 1135, 1005)]),
    ("Screenshot_1.png", "02-export.png", 1060, [(1255, 750, 1285, 782)]),
    ("Screenshot_2.png", "03-import.png", None, []),
    ("Screenshot_3.png", "04-import-history.png", None, []),
    ("Screenshot_4.png", "05-scheduled-exports.png", None, [(1690, 0, 1876, 17)]),
    ("Screenshot_5.png", "06-vip-pricing.png", None, []),
    ("Screenshot_6.png", "07-plans.png", None, []),
    ("Screenshot_7.png", "08-help.png", None, []),
]

WHITE_T = 245  # pixels brighter than this count as background


def is_dark_column(img, x, y0, y1):
    px = img.load()
    samples = [px[x, y] for y in range(y0, y1, 25)]
    return sum(1 for p in samples if sum(p[:3]) / 3 < 60) > len(samples) * 0.6


def find_sidebar_edge(img):
    """x where the dark admin sidebar ends (0 if none)."""
    w, h = img.size
    x = 0
    while x < min(400, w) and is_dark_column(img, x, 80, h - 80):
        x += 1
    return x + 2 if x > 50 else 0


def bbox_nonwhite(img, box):
    region = img.crop(box).convert("L").point(lambda v: 255 if v < WHITE_T else 0)
    b = region.getbbox()
    if not b:
        return None
    return (b[0] + box[0], b[1] + box[1], b[2] + box[0], b[3] + box[1])


def header_height(img):
    """The app header ends at the first light divider line below y=30."""
    w, h = img.size
    px = img.load()
    for y in range(30, min(120, h)):
        row = [px[x, y] for x in range(w // 3, 2 * w // 3, 10)]
        avg = sum(sum(p[:3]) / 3 for p in row) / len(row)
        if 225 < avg < 250:
            return y + 1
    return 58


# Measured layout of the two capture sizes.
LAYOUT = {
    2098: {"left": 228, "top": 6, "header": 54, "right_trim": 0},   # with admin sidebar
    1876: {"left": 12, "top": 9, "header": 57, "right_trim": 0},      # app frame only
}
LEFT_HEAD_W = 560   # breadcrumb area kept from the header
RIGHT_HEAD_W = 430  # buttons area kept from the header


def process(src, dst, max_h, whiteouts):
    img = Image.open(os.path.join(HERE, src)).convert("RGB")
    d = ImageDraw.Draw(img)
    for box in whiteouts:
        d.rectangle(box, fill="white")
    L = LAYOUT[img.width]
    img = img.crop((L["left"], L["top"], img.width - 2, img.height))
    w, h = img.size
    hh = L["header"] - L["top"]
    bottom = min(h, (max_h - L["top"]) if max_h else h)

    # Content cards: horizontal/vertical extent below the header.
    cx0, _, cx1, cy1 = bbox_nonwhite(img, (0, hh + 4, w - 30, bottom))
    pad = 40
    x0, x1 = max(0, cx0 - pad), min(w, cx1 + pad)
    width = max(x1 - x0, LEFT_HEAD_W + RIGHT_HEAD_W + 40)
    x0 = max(0, (cx0 + cx1) // 2 - width // 2)
    x1 = min(w, x0 + width)
    content = img.crop((x0, hh, x1, min(bottom, cy1 + pad)))
    cw = content.width

    # Rebuild the header: breadcrumb left, page buttons right.
    head = Image.new("RGB", (cw, hh), "white")
    head.paste(img.crop((0, 0, LEFT_HEAD_W, hh)), (0, 0))
    head.paste(img.crop((w - RIGHT_HEAD_W, 0, w, hh)), (cw - RIGHT_HEAD_W, 0))
    ImageDraw.Draw(head).line([(0, hh - 1), (cw, hh - 1)], fill=(227, 227, 227))

    body = Image.new("RGB", (cw, hh + content.height), "white")
    body.paste(head, (0, 0))
    body.paste(content, (0, hh))

    bw, bh = body.size
    tw = max(bw, round(bh * 16 / 9))
    th = round(tw * 9 / 16)
    final = Image.new("RGB", (tw, th), "white")
    final.paste(body, ((tw - bw) // 2, 0))
    final.resize((1600, 900), Image.LANCZOS).save(os.path.join(OUT_DIR, dst), "PNG", optimize=True)
    return dst


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    for f in os.listdir(OUT_DIR):
        if f.endswith(".png"):
            os.remove(os.path.join(OUT_DIR, f))
    for src, dst, max_h, wo in JOBS:
        if os.path.exists(os.path.join(HERE, src)):
            print("saved", process(src, dst, max_h, wo))
