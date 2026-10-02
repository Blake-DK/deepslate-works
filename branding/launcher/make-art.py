#!/usr/bin/env python3
"""The launcher's pixel art (planner, 2026-10-02; docs/21).

Everything here is drawn from scratch, nothing is copied from the game. Run it from the repo root with Pillow installed
(`python3 branding/launcher/make-art.py`); it writes the PNGs next to itself. The seed is fixed so a rerun gives the same
pictures. Pixel art is drawn at 1x and scaled up with NEAREST so the pixels stay square.
"""
import os
import random

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
rnd = random.Random(3899835)

# Deepslate greys (branding/logo-options/README.md) and the portal's copper.
SLATE = [(0x1C, 0x1F, 0x24), (0x23, 0x27, 0x2D), (0x2B, 0x30, 0x37), (0x34, 0x3A, 0x42), (0x3E, 0x44, 0x4D), (0x4A, 0x51, 0x5B), (0x56, 0x5C, 0x66)]
COPPER = (0xE8, 0x83, 0x3A)
COPPER_HI = (0xFF, 0xB2, 0x6B)
COPPER_LO = (0xB8, 0x65, 0x2C)
GRASS = [(0x3F, 0x7A, 0x3B), (0x4C, 0x8F, 0x45), (0x5B, 0xA3, 0x52)]
CHERRY = [(0xE9, 0x9A, 0xC3), (0xF2, 0xB5, 0xD6), (0xD9, 0x7F, 0xB0)]
SKY = [(0x0B, 0x10, 0x1C), (0x11, 0x18, 0x29), (0x18, 0x22, 0x38), (0x22, 0x2E, 0x4A)]
LEAF = [(0x2E, 0x5D, 0x2C), (0x37, 0x70, 0x34), (0x44, 0x85, 0x3E)]
TRUNK = (0x4A, 0x36, 0x28)


def save(img, name, scale):
    big = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
    big.save(os.path.join(HERE, name), optimize=True)
    print(name, big.size)


def deepslate_tile(size=16, seed=1):
    """A 16x16 deepslate tile with horizontal strata. Tiles seamlessly: the strata wrap and no feature crosses the edge."""
    r = random.Random(seed)
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        band = SLATE[2 + ((y // 3) % 3) - 1]
        for x in range(size):
            c = band
            if r.random() < 0.18:
                c = SLATE[max(0, min(6, SLATE.index(band) + r.choice((-1, 1))))]
            px[x, y] = c
    # a few darker cracks, 2 to 4 pixels long, never touching the edge
    for _ in range(5):
        x, y, n = r.randint(1, size - 5), r.randint(1, size - 2), r.randint(2, 4)
        for i in range(n):
            px[x + i, y] = SLATE[0]
    return img


def hero(w=300, h=84, seed=7):
    """The Play tab's banner: night sky, far mountains, a cherry grove and plains in the middle, a deepslate cave in the
    foreground with copper ore glinting in it. 300x84 at 1x, saved at 4x (1200x336) and shown stretched to the window's width."""
    r = random.Random(seed)
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    px = img.load()
    # sky
    for y in range(h):
        d.line([(0, y), (w, y)], fill=SKY[min(3, y * 4 // h)])
    for _ in range(70):
        x, y = r.randint(0, w - 1), r.randint(0, h // 2)
        px[x, y] = (0xC8, 0xD2, 0xE6) if r.random() < 0.7 else COPPER_HI
    # moon
    d.ellipse([w - 48, 8, w - 36, 20], fill=(0xE6, 0xE2, 0xD6))
    d.ellipse([w - 45, 6, w - 34, 17], fill=SKY[0])
    # two rows of mountains: a far pale row and a nearer dark one, snow on the tallest peaks
    def ridge(base, lo, hi, step_lo, step_hi, colour, snow=None):
        pts = [(0, h)]
        x = 0
        while x < w:
            step = r.randint(step_lo, step_hi)
            peak = base - r.randint(lo, hi)
            pts += [(x + step // 2, peak), (x + step, base - r.randint(0, 5))]
            if snow and base - peak > hi - 8:
                for yy in range(int(peak), int(peak) + 4):
                    half = (yy - int(peak)) + 1
                    d.line([(x + step // 2 - half, yy), (x + step // 2 + half, yy)], fill=snow)
            x += step
        pts.append((w, h))
        return pts
    far = ridge(h * 0.60, 14, 40, 26, 50, (0x25, 0x2E, 0x40))
    d.polygon(far, fill=(0x25, 0x2E, 0x40))
    near_pts = ridge(h * 0.64, 6, 24, 18, 36, (0x1A, 0x20, 0x2C))
    d.polygon(near_pts, fill=(0x1A, 0x20, 0x2C))
    # snow on the far row, drawn after both rows so it is not covered
    for i in range(1, len(far) - 1, 2):
        x, y = far[i]
        if h * 0.60 - y > 30:
            for yy in range(int(y), int(y) + 4):
                half = yy - int(y) + 1
                d.line([(x - half, yy), (x + half, yy)], fill=(0xC9, 0xD3, 0xDE))
    # ground band: grass then earth
    gy = int(h * 0.66)
    for y in range(gy, gy + 4):
        for xx in range(w):
            px[xx, y] = GRASS[r.randint(0, 2)] if y < gy + 2 else GRASS[0]
    for y in range(gy + 4, gy + 9):
        for xx in range(w):
            px[xx, y] = (0x5A, 0x43, 0x30) if r.random() < 0.85 else (0x6B, 0x52, 0x3B)
    # trees: oaks on the left, a cherry grove right of the middle, one big oak near the cave
    def tree(tx, kind, big=False):
        th = r.randint(7, 10) if big else r.randint(5, 7)
        for yy in range(gy - th, gy):
            px[tx, yy] = TRUNK
            if big:
                px[tx + 1, yy] = TRUNK
        cols = CHERRY if kind == "cherry" else LEAF
        cw, ch = (r.randint(11, 13), r.randint(7, 8)) if big else (r.randint(7, 9), r.randint(5, 6))
        cx, cy = tx + (1 if big else 0), gy - th - ch // 2 + 1
        for yy in range(cy - ch // 2, cy + ch // 2 + 1):
            for xx in range(cx - cw // 2, cx + cw // 2 + 1):
                dx, dy = (xx - cx) / (cw / 2), (yy - cy) / (ch / 2)
                if 0 <= xx < w and 0 <= yy < h and dx * dx + dy * dy <= 1.05 and r.random() < 0.92:
                    shade = 2 if dy < -0.3 else (0 if dy > 0.4 else 1)
                    px[xx, yy] = cols[shade]
    for tx in (30, 52, 70):
        tree(tx, "oak")
    tree(120, "oak", big=True)
    for tx in (176, 192, 207, 223, 240):
        tree(tx, "cherry")
    for tx in (268, 284):
        tree(tx, "oak")
    # the foreground cave: deepslate from y = gy + 9 down, with a cave mouth on the left
    for y in range(gy + 9, h):
        band = SLATE[1 + ((y // 3) % 3)]
        for xx in range(w):
            c = band
            if r.random() < 0.2:
                c = SLATE[max(0, min(6, SLATE.index(band) + r.choice((-1, 1))))]
            px[xx, y] = c
    # copper ore glints in the deepslate
    for _ in range(22):
        ox, oy = r.randint(2, w - 4), r.randint(gy + 10, h - 3)
        px[ox, oy] = COPPER
        px[ox + 1, oy] = COPPER_LO if r.random() < 0.7 else COPPER
        if r.random() < 0.6:
            px[ox, oy + 1] = COPPER_HI
        if r.random() < 0.4:
            px[ox + 1, oy + 1] = COPPER
    # a lit cave mouth bottom left, with a torch glow
    d.rectangle([8, gy + 9, 40, h], fill=SLATE[0])
    d.rectangle([11, gy + 12, 37, h], fill=(0x0E, 0x10, 0x13))
    # torch on the cave wall and its glow on the floor
    px[24, h - 6] = (0x6B, 0x52, 0x3B); px[24, h - 7] = COPPER; px[24, h - 8] = COPPER_HI; px[23, h - 8] = COPPER; px[25, h - 8] = COPPER
    for xx in range(14, 35):
        for yy in range(h - 3, h):
            if r.random() < 0.6:
                px[xx, yy] = (0x4A, 0x36, 0x24) if abs(xx - 24) > 5 else (0x6B, 0x4A, 0x2E)
    return img


def button_tile(size=16, light=(0x35, 0x8F, 0x5B), mid=(0x2E, 0x7D, 0x5B), dark=(0x1F, 0x5C, 0x42)):
    """The Play button's face: a bevelled block, green like the game's Play. Stretched by WPF with a 3 px nine-grid."""
    img = Image.new("RGB", (size, size), mid)
    px = img.load()
    r = random.Random(11)
    for y in range(size):
        for x in range(size):
            if y < 2 or x < 2:
                px[x, y] = light
            elif y >= size - 3 or x >= size - 2:
                px[x, y] = dark
            elif r.random() < 0.12:
                px[x, y] = light if r.random() < 0.5 else dark
    return img


if __name__ == "__main__":
    save(deepslate_tile(), "deepslate-tile.png", 1)      # 16x16, the source
    save(deepslate_tile(), "deepslate-tile@3x.png", 3)   # 48x48, what the app tiles (already scaled, so WPF never smooths it)
    save(deepslate_tile(), "deepslate-tile@4x.png", 4)   # for the docs and the HTML mock-up
    save(hero(), "hero.png", 4)                          # 1200x336
    save(button_tile(), "play-button.png", 4)            # 64x64, nine-grid 12 px
    print("done")
