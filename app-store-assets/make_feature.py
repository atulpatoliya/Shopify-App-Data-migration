"""Feature media image (1600x900) for the App Store listing.
Left: short headline. Right: a stylised spreadsheet with a VIP discount tag.
Run: python make_feature.py feature-1600x900.png"""
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = sys.argv[1]
S = 2
W, H = 1600 * S, 900 * S
INDIGO, TEAL, GOLD = (35, 31, 92), (0, 128, 120), (255, 196, 37)


def font(size, bold=False):
    names = ["segoeuib.ttf" if bold else "segoeui.ttf", "arialbd.ttf" if bold else "arial.ttf"]
    for n in names:
        try:
            return ImageFont.truetype(n, size * S)
        except OSError:
            pass
    return ImageFont.load_default()


# Soft diagonal gradient background
n = 200
g = Image.new("RGB", (n, n))
px = g.load()
for y in range(n):
    for x in range(n):
        t = (x * 0.7 + y * 0.3) / (n - 1)
        px[x, y] = tuple(int(a + (b - a) * t) for a, b in zip(INDIGO, TEAL))
img = g.resize((W, H), Image.BICUBIC).convert("RGBA")
d = ImageDraw.Draw(img)


def sc(*v):
    return [x * S for x in v]


# Headline (kept short: Shopify asks to avoid text-heavy media)
d.text(sc(110, 300), "Bulk edit products", font=font(66, True), fill="white")
d.text(sc(110, 385), "in Excel.", font=font(66, True), fill="white")
d.text(sc(110, 480), "Reward VIPs automatically.", font=font(40), fill=(214, 240, 236))

# Card shadow
sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(sh).rounded_rectangle(sc(880, 190, 1480, 750), radius=36 * S, fill=(0, 0, 0, 120))
img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(30 * S)))
d = ImageDraw.Draw(img)

# Spreadsheet card
x0, y0, x1, y1 = 870, 170, 1470, 730
d.rounded_rectangle(sc(x0, y0, x1, y1), radius=36 * S, fill="white")
d.rounded_rectangle(sc(x0, y0, x1, y0 + 90), radius=36 * S, corners=(True, True, False, False),
                    fill=(226, 242, 239))
cols = [x0, x0 + 260, x0 + 420, x1]
rows = [y0 + 90 + i * 92 for i in range(6)]
line = (214, 221, 228)
for yy in rows[:-1]:
    d.rectangle(sc(x0, yy - 1, x1, yy + 1), fill=line)
for xx in cols[1:-1]:
    d.rectangle(sc(xx - 1, y0, xx + 1, y1), fill=line)
# header labels
hdr = font(24, True)
for label, cx in (("Product", x0 + 30), ("Price", cols[1] + 30), ("VIP", cols[2] + 30)):
    d.text(sc(cx, y0 + 30), label, font=hdr, fill=INDIGO)
# rows: product bar + price + vip price
body = font(26)
data = [("$48.00", "$38.40"), ("$32.00", "$25.60"), ("$65.00", "$52.00"), ("$20.00", "$16.00"), ("$54.00", "$43.20")]
for i, (p, v) in enumerate(data):
    cy = rows[i] + 30
    d.rounded_rectangle(sc(x0 + 30, cy + 4, x0 + 30 + (170 - i * 18), cy + 30), radius=8 * S,
                        fill=(INDIGO if i % 2 else TEAL))
    d.text(sc(cols[1] + 30, cy), p, font=body, fill=(110, 110, 110))
    d.text(sc(cols[2] + 30, cy), v, font=font(26, True), fill=TEAL)

# VIP tag badge
bx, by, r = 1470, 180, 82
d.ellipse(sc(bx - r, by - r, bx + r, by + r), fill=GOLD)
d.ellipse(sc(bx - r + 10, by - r + 10, bx + r - 10, by + r - 10), outline="white", width=6 * S)
crown = [(bx - 44, by + 24), (bx - 50, by - 26), (bx - 20, by + 2), (bx, by - 38),
         (bx + 20, by + 2), (bx + 50, by - 26), (bx + 44, by + 24)]
d.polygon([(x * S, y * S) for x, y in crown], fill=INDIGO)
d.rounded_rectangle(sc(bx - 46, by + 30, bx + 46, by + 48), radius=5 * S, fill=INDIGO)

# Sync arrows chip
cx, cy, r = 870, 730, 70
d.ellipse(sc(cx - r, cy - r, cx + r, cy + r), fill=TEAL)
d.ellipse(sc(cx - r + 9, cy - r + 9, cx + r - 9, cy + r - 9), outline="white", width=5 * S)
for ax, up in ((cx - 20, True), (cx + 20, False)):
    if up:
        d.polygon([(ax * S, (cy - 40) * S), ((ax + 26) * S, (cy - 10) * S), ((ax - 26) * S, (cy - 10) * S)], fill="white")
        d.rectangle(sc(ax - 8, cy - 12, ax + 8, cy + 36), fill="white")
    else:
        d.polygon([(ax * S, (cy + 40) * S), ((ax + 26) * S, (cy + 10) * S), ((ax - 26) * S, (cy + 10) * S)], fill="white")
        d.rectangle(sc(ax - 8, cy - 36, ax + 8, cy + 12), fill="white")

img.convert("RGB").resize((1600, 900), Image.LANCZOS).save(OUT, "PNG", optimize=True)
print("saved", OUT)
