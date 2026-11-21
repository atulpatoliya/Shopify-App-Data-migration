"""App icon: a spreadsheet sheet with two-way sync arrows and a VIP crown.
Drawn at 4x and downscaled for smooth edges. Output: 1200x1200 PNG."""
import sys
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]
S = 4
W = 1200 * S


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


# Background: diagonal gradient, deep indigo -> teal
top, bottom = (35, 31, 92), (0, 128, 120)
n = 300
bg = Image.new("RGB", (n, n))
px = bg.load()
for y in range(n):
    for x in range(n):
        px[x, y] = lerp(top, bottom, (x + y) / (2 * (n - 1)))
bg = bg.resize((W, W), Image.BICUBIC)
img = bg.convert("RGBA")


def rr(draw, box, r, fill):
    draw.rounded_rectangle([v * S for v in box], radius=r * S, fill=fill)


# Layout: sheet centred, VIP crown badge top-right, sync badge bottom-left
SX0, SY0, SX1, SY1 = 300, 280, 900, 940

shadow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
ds = ImageDraw.Draw(shadow)
rr(ds, (SX0 + 10, SY0 + 30, SX1 + 10, SY1 + 30), 60, (0, 0, 0, 120))
for (bx, by) in ((SX1 - 10, SY0 + 10), (SX0 + 10, SY1 - 10)):
    ds.ellipse([(bx - 125) * S, (by - 110) * S, (bx + 125) * S, (by + 140) * S], fill=(0, 0, 0, 110))
shadow = shadow.filter(ImageFilter.GaussianBlur(30 * S))
img = Image.alpha_composite(img, shadow)
d = ImageDraw.Draw(img)

# Sheet with header
rr(d, (SX0, SY0, SX1, SY1), 60, (255, 255, 255, 255))
d.rounded_rectangle([SX0 * S, SY0 * S, SX1 * S, (SY0 + 150) * S], radius=60 * S,
                    corners=(True, True, False, False), fill=(226, 242, 239, 255))
line = (208, 216, 224, 255)
rows = [SY0 + 150, SY0 + 280, SY0 + 410, SY0 + 540]
for yy in rows:
    d.rectangle([SX0 * S, (yy - 3) * S, SX1 * S, (yy + 3) * S], fill=line)
cols = [SX0 + 200, SX0 + 400]
for xx in cols:
    d.rectangle([(xx - 3) * S, SY0 * S, (xx + 3) * S, SY1 * S], fill=line)

teal, indigo = (0, 128, 120, 255), (35, 31, 92, 255)
cells = [(0, 0, teal), (1, 0, indigo), (2, 0, teal),
         (0, 1, indigo), (1, 1, teal),
         (1, 2, indigo), (2, 2, indigo),
         (2, 3, teal)]
for ci, ri, c in cells:
    x0 = SX0 + ci * 200 + 32
    y0 = rows[ri] + 40 if ri < 3 else rows[3] + 40
    rr(d, (x0, y0, x0 + 136, y0 + 48), 16, c)

def badge(cx, cy, r, fill):
    d.ellipse([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], fill=fill)
    d.ellipse([(cx - r + 14) * S, (cy - r + 14) * S, (cx + r - 14) * S, (cy + r - 14) * S],
              outline=(255, 255, 255, 235), width=8 * S)

# VIP crown badge
cx, cy = SX1 - 10, SY0 + 10
badge(cx, cy, 125, (255, 196, 37, 255))
crown = [(cx - 68, cy + 42), (cx - 76, cy - 40), (cx - 30, cy + 4), (cx, cy - 58),
         (cx + 30, cy + 4), (cx + 76, cy - 40), (cx + 68, cy + 42)]
d.polygon([(x * S, y * S) for x, y in crown], fill=indigo)
rr(d, (cx - 70, cy + 50, cx + 70, cy + 76), 8, indigo)

# Sync (import / export) badge with two clean arrows
cx, cy = SX0 + 10, SY1 - 10
badge(cx, cy, 125, teal)
white = (255, 255, 255, 255)
def arrow(ax, up):
    head = [(ax, cy - 70), (ax + 46, cy - 18), (ax - 46, cy - 18)] if up else            [(ax, cy + 70), (ax + 46, cy + 18), (ax - 46, cy + 18)]
    stem = (ax - 15, cy - 22, ax + 15, cy + 62) if up else (ax - 15, cy - 62, ax + 15, cy + 22)
    d.polygon([(x * S, y * S) for x, y in head], fill=white)
    d.rectangle([v * S for v in stem], fill=white)
arrow(cx - 34, True)
arrow(cx + 34, False)

img = img.convert("RGB").resize((1200, 1200), Image.LANCZOS)
img.save(OUT, "PNG", optimize=True)
print("saved", OUT)
