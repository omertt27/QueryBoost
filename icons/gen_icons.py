"""
QueryBoost icon generator.
Draws the ⚡ bolt logo on a deep-purple rounded-square background.
Outputs: icon16.png, icon32.png, icon48.png, icon128.png
"""

import math, os
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
SIZES = [16, 32, 48, 128]

# ── Brand colours ────────────────────────────────────────────
BG_TOP    = (80,  54, 220)   # #5036DC  – deep violet
BG_BOT    = (138, 92, 246)   # #8A5CF6  – bright purple
BOLT_TOP  = (255, 240, 100)  # warm yellow
BOLT_BOT  = (255, 200,  40)  # amber
SHADOW    = (30,  20,  80, 120)  # translucent dark

def lerp_colour(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))

def draw_rounded_rect_gradient(draw, size, radius_frac=0.22):
    """Fill the whole canvas with a top→bottom gradient, clipped to a rounded square."""
    s = size
    r = max(2, int(s * radius_frac))
    # Build mask
    mask = Image.new("L", (s, s), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=255)

    # Gradient layer
    grad = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    for y in range(s):
        t = y / (s - 1)
        c = lerp_colour(BG_TOP, BG_BOT, t) + (255,)
        gd.line([(0, y), (s - 1, y)], fill=c)

    result = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    result.paste(grad, mask=mask)
    return result

def bolt_points(size):
    """
    Returns the polygon points for a lightning bolt centred in `size`×`size`.
    The bolt is drawn as a classic 7-point zigzag shape.
    """
    s = size
    # Proportional bolt geometry (designed at 128, scaled down)
    REF = 128.0

    # Raw points at REF size (origin = top-left of canvas)
    raw = [
        (72, 10),   # top-right of upper arm
        (44, 58),   # inner top of crossbar
        (62, 58),   # inner bottom of crossbar  ← right of centre notch
        (38, 118),  # bottom tip
        (56, 70),   # inner bottom
        (38, 70),   # left of centre notch
        (62, 10),   # top-left of upper arm
    ]

    scale = s / REF
    cx_raw = sum(p[0] for p in raw) / len(raw)
    cy_raw = sum(p[1] for p in raw) / len(raw)
    cx_target = s / 2
    cy_target = s / 2 + s * 0.03  # nudge very slightly down for visual balance

    return [
        (cx_target + (p[0] - cx_raw) * scale,
         cy_target + (p[1] - cy_raw) * scale)
        for p in raw
    ]

def draw_bolt_gradient(img, size):
    """Draw the bolt with a top→bottom gradient using scanline fill over a mask."""
    # 1. Create a mask of the bolt shape at 2× for anti-alias, then downscale
    scale = 4
    big = size * scale
    mask = Image.new("L", (big, big), 0)
    md = ImageDraw.Draw(mask)

    REF = 128.0
    raw = [
        (72, 10), (44, 58), (62, 58),
        (38, 118), (56, 70), (38, 70), (62, 10),
    ]
    sc = big / REF
    cx_raw = sum(p[0] for p in raw) / len(raw)
    cy_raw = sum(p[1] for p in raw) / len(raw)
    cx_t = big / 2
    cy_t = big / 2 + big * 0.03
    pts_big = [
        (cx_t + (p[0] - cx_raw) * sc, cy_t + (p[1] - cy_raw) * sc)
        for p in raw
    ]
    md.polygon(pts_big, fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)

    # 2. Gradient fill layer
    grad = Image.new("RGBA", (size, size))
    gd = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / max(size - 1, 1)
        c = lerp_colour(BOLT_TOP, BOLT_BOT, t) + (255,)
        gd.line([(0, y), (size - 1, y)], fill=c)

    # 3. Composite bolt onto base image
    bolt_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bolt_layer.paste(grad, mask=mask)
    img.alpha_composite(bolt_layer)

def draw_bolt_shadow(img, size):
    """Subtle drop shadow under the bolt — only for larger sizes."""
    if size < 32:
        return
    offset = max(1, size // 40)
    scale = 4
    big = size * scale
    mask = Image.new("L", (big, big), 0)
    md = ImageDraw.Draw(mask)

    REF = 128.0
    raw = [
        (72, 10), (44, 58), (62, 58),
        (38, 118), (56, 70), (38, 70), (62, 10),
    ]
    sc = big / REF
    cx_raw = sum(p[0] for p in raw) / len(raw)
    cy_raw = sum(p[1] for p in raw) / len(raw)
    cx_t = big / 2 + offset * scale
    cy_t = big / 2 + big * 0.03 + offset * scale
    pts_big = [
        (cx_t + (p[0] - cx_raw) * sc, cy_t + (p[1] - cy_raw) * sc)
        for p in raw
    ]
    md.polygon(pts_big, fill=180)
    mask = mask.resize((size, size), Image.LANCZOS)

    shadow_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow_layer)
    shadow_layer.paste(Image.new("RGBA", (size, size), (20, 10, 60, 100)), mask=mask)
    # Composite shadow *under* everything: insert before bolt
    # We do it by compositing onto a copy and returning
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    base.alpha_composite(shadow_layer)
    base.alpha_composite(img)
    img.paste(base)

def make_icon(size):
    # Step 1: gradient rounded-square background
    img = draw_rounded_rect_gradient(None, size)  # returns RGBA image

    # Step 2: shadow (only visible on 32+)
    if size >= 32:
        draw_bolt_shadow(img, size)

    # Step 3: bolt on top
    draw_bolt_gradient(img, size)

    return img

# ── Fix: draw_rounded_rect_gradient returns image, not draws on canvas ───────
# Patch it so the rest of the pipeline works correctly.

def make_icon_v2(size):
    # Background
    bg = draw_rounded_rect_gradient(None, size)

    # Compose on white checker to preview, but save as RGBA
    # Shadow pass (separate layer blended in)
    if size >= 32:
        offset = max(1, size // 40)
        scale_f = 4
        big = size * scale_f
        mask_s = Image.new("L", (big, big), 0)
        md_s = ImageDraw.Draw(mask_s)
        REF = 128.0
        raw = [
            (72, 10), (44, 58), (62, 58),
            (38, 118), (56, 70), (38, 70), (62, 10),
        ]
        sc = big / REF
        cx_raw = sum(p[0] for p in raw) / len(raw)
        cy_raw = sum(p[1] for p in raw) / len(raw)
        cx_t = big / 2 + offset * scale_f
        cy_t = big / 2 + big * 0.03 + offset * scale_f
        pts_big = [
            (cx_t + (p[0] - cx_raw) * sc, cy_t + (p[1] - cy_raw) * sc)
            for p in raw
        ]
        md_s.polygon(pts_big, fill=200)
        mask_s = mask_s.resize((size, size), Image.LANCZOS)
        shadow_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        shadow_layer.paste(Image.new("RGBA", (size, size), (15, 5, 50, 110)), mask=mask_s)
        bg.alpha_composite(shadow_layer)

    # Bolt pass
    scale_f = 4
    big = size * scale_f
    mask_b = Image.new("L", (big, big), 0)
    md_b = ImageDraw.Draw(mask_b)
    REF = 128.0
    raw = [
        (72, 10), (44, 58), (62, 58),
        (38, 118), (56, 70), (38, 70), (62, 10),
    ]
    sc = big / REF
    cx_raw = sum(p[0] for p in raw) / len(raw)
    cy_raw = sum(p[1] for p in raw) / len(raw)
    cx_t = big / 2
    cy_t = big / 2 + big * 0.03
    pts_big = [
        (cx_t + (p[0] - cx_raw) * sc, cy_t + (p[1] - cy_raw) * sc)
        for p in raw
    ]
    md_b.polygon(pts_big, fill=255)
    mask_b = mask_b.resize((size, size), Image.LANCZOS)

    grad = Image.new("RGBA", (size, size))
    gd = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / max(size - 1, 1)
        c = lerp_colour(BOLT_TOP, BOLT_BOT, t) + (255,)
        gd.line([(0, y), (size - 1, y)], fill=c)

    bolt_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bolt_layer.paste(grad, mask=mask_b)
    bg.alpha_composite(bolt_layer)

    # Add a subtle inner highlight ring at the top (only 48+)
    if size >= 48:
        r = max(2, int(size * 0.22))
        highlight = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        hd = ImageDraw.Draw(highlight)
        hd.rounded_rectangle(
            [1, 1, size - 2, size // 2],
            radius=r,
            fill=(255, 255, 255, 18),
        )
        bg.alpha_composite(highlight)

    return bg

for size in SIZES:
    icon = make_icon_v2(size)
    path = os.path.join(OUT_DIR, f"icon{size}.png")
    icon.save(path, "PNG", optimize=True)
    print(f"  ✓  icon{size}.png  ({size}×{size})")

print("\nAll icons generated.")
