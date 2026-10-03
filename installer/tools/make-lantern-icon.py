#!/usr/bin/env python3
"""installer/DeepslateWorks.ico from branding/logo-options/6-lantern.svg, the logo Alex picked (planner, 2026-10-03).

The exe's own icon (what Explorer, the taskbar and a pinned tile show for DeepslateWorks.exe itself) is a resource baked
in at build time, so it cannot follow the logo picked in Admin -> Branding the way logo.ico in the home folder does for
the window and the shortcuts. This draws the lantern with Pillow (no SVG renderer on the build machines), supersampled
4x and scaled down, at every size Windows asks for, and writes the .ico with PNG frames.

    python3 installer/tools/make-lantern-icon.py installer/DeepslateWorks.ico
"""
import struct
import sys

from PIL import Image, ImageDraw

SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]


def lantern(size, ss=4):
    """The shapes of 6-lantern.svg (a 64-unit box) at `size` px."""
    n = size * ss
    k = n / 64.0
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = lambda x, y, w, h: [x * k, y * k, (x + w) * k, (y + h) * k]
    # the glow: a soft orange disc behind the body
    d.ellipse(r(15, 18, 34, 34), fill=(0xFF, 0x8A, 0x3D, 46))
    # the handle: an arc, stroke 3
    d.arc(r(26, 6, 12, 12), 180, 360, fill=(0x6B, 0x71, 0x7B), width=max(1, int(3 * k)))
    # the cap
    d.rounded_rectangle(r(22, 12, 20, 6), radius=2 * k, fill=(0x3A, 0x3F, 0x47))
    # the body with its edge
    d.rounded_rectangle(r(19, 18, 26, 34), radius=4 * k, fill=(0x2E, 0x32, 0x38), outline=(0x6B, 0x71, 0x7B), width=max(1, int(2 * k)))
    # the panes
    d.rounded_rectangle(r(24, 23, 16, 24), radius=2 * k, fill=(0xFF, 0x9A, 0x45))
    d.rounded_rectangle(r(28, 27, 8, 16), radius=2 * k, fill=(0xFF, 0xD3, 0xA0))
    d.line([32 * k, 23 * k, 32 * k, 47 * k], fill=(0x2E, 0x32, 0x38), width=max(1, int(2 * k)))
    # the base
    d.rounded_rectangle(r(20, 52, 24, 5), radius=2 * k, fill=(0x3A, 0x3F, 0x47))
    return img.resize((size, size), Image.LANCZOS)


def ico(frames):
    pngs = []
    for im in frames:
        from io import BytesIO
        b = BytesIO(); im.save(b, "PNG", optimize=True); pngs.append(b.getvalue())
    hdr = struct.pack("<HHH", 0, 1, len(frames))
    off = 6 + 16 * len(frames)
    ents = b""
    for im, p in zip(frames, pngs):
        s = im.width
        ents += struct.pack("<BBBBHHII", 0 if s >= 256 else s, 0 if s >= 256 else s, 0, 0, 1, 32, len(p), off)
        off += len(p)
    return hdr + ents + b"".join(pngs)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "DeepslateWorks.ico"
    data = ico([lantern(s) for s in SIZES])
    open(out, "wb").write(data)
    print(out, len(data), "bytes,", len(SIZES), "frames")
