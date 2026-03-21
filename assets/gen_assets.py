"""
QueryBoost — Asset Generator
Produces:
  assets/logo.png          512×512  high-res standalone logo
  assets/social-preview.png  1280×640  GitHub repo social card
"""

import os, math
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
os.makedirs(ASSETS, exist_ok=True)

# ── Colours ──────────────────────────────────────────────────
BG_TOP   = (52,  30, 180)   # deep violet
BG_BOT   = (110, 60, 230)   # bright purple
BOLT_TOP = (255, 245, 100)  # warm yellow
BOLT_BOT = (255, 190,  30)  # amber
GLOW_COL = (130,  80, 255, 60)  # soft purple glow
WHITE    = (255, 255, 255, 255)
DIM      = (180, 170, 220, 200)

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))

# ─────────────────────────────────────────────────────────────
# SHARED: render a bolt logo onto any square canvas
# ─────────────────────────────────────────────────────────────

BOLT_RAW = [
    (72, 10),
    (44, 58),
    (62, 58),
    (38, 118),
    (56, 70),
    (38, 70),
    (62, 10),
]
BOLT_CX = sum(p[0] for p in BOLT_RAW) / len(BOLT_RAW)
BOLT_CY = sum(p[1] for p in BOLT_RAW) / len(BOLT_RAW)
BOLT_REF = 128.0


def bolt_scaled(size, offset_x=0, offset_y=0, scale_extra=1.0):
    sc = (size / BOLT_REF) * scale_extra
    cx_t = size / 2 + offset_x
    cy_t = size / 2 + size * 0.03 + offset_y
    return [
        (cx_t + (p[0] - BOLT_CX) * sc,
         cy_t + (p[1] - BOLT_CY) * sc)
        for p in BOLT_RAW
    ]


def draw_gradient_bg(size, radius_frac=0.20):
    """Rounded-square gradient background."""
    r = max(4, int(size * radius_frac))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size-1, size-1], radius=r, fill=255)

    grad = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / (size - 1)
        c = lerp(BG_TOP, BG_BOT, t) + (255,)
        gd.line([(0, y), (size-1, y)], fill=c)

    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(grad, mask=mask)
    return out


def draw_glow(img, size, radius_frac=0.38):
    """Radial glow in centre of icon."""
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    for step in range(12):
        t = step / 11
        r_now = int(size * radius_frac * (1 - t * 0.7))
        alpha = int(45 * (1 - t))
        col = (130, 80, 255, alpha)
        layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(layer).ellipse(
            [size//2 - r_now, size//2 - r_now,
             size//2 + r_now, size//2 + r_now],
            fill=col
        )
        glow = Image.alpha_composite(glow, layer)
    img.alpha_composite(glow)


def draw_bolt_on(img, size, scale_extra=1.0, ox=0, oy=0):
    """Render anti-aliased gradient bolt onto img."""
    SF = 4
    big = size * SF
    mask = Image.new("L", (big, big), 0)
    sc = (big / BOLT_REF) * scale_extra
    cx_t = big / 2 + ox * SF
    cy_t = big / 2 + big * 0.03 + oy * SF
    pts = [
        (cx_t + (p[0] - BOLT_CX) * sc,
         cy_t + (p[1] - BOLT_CY) * sc)
        for p in BOLT_RAW
    ]
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)

    grad = Image.new("RGBA", (size, size))
    gd = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / max(size-1, 1)
        gd.line([(0, y), (size-1, y)], fill=lerp(BOLT_TOP, BOLT_BOT, t) + (255,))

    bolt = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bolt.paste(grad, mask=mask)
    img.alpha_composite(bolt)


def draw_highlight(img, size):
    """Subtle white sheen at the top of the icon square."""
    r = max(4, int(size * 0.20))
    h = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(h).rounded_rectangle(
        [2, 2, size-3, size//2], radius=r, fill=(255, 255, 255, 16)
    )
    img.alpha_composite(h)


def draw_bolt_shadow(img, size, scale_extra=1.0, ox=0, oy=0):
    """Soft drop shadow behind bolt."""
    offset = max(1, size // 36)
    SF = 4
    big = size * SF
    mask = Image.new("L", (big, big), 0)
    sc = (big / BOLT_REF) * scale_extra
    cx_t = big / 2 + (ox + offset) * SF
    cy_t = big / 2 + big * 0.03 + (oy + offset) * SF
    pts = [
        (cx_t + (p[0] - BOLT_CX) * sc,
         cy_t + (p[1] - BOLT_CY) * sc)
        for p in BOLT_RAW
    ]
    ImageDraw.Draw(mask).polygon(pts, fill=200)
    mask = mask.resize((size, size), Image.LANCZOS)
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow.paste(Image.new("RGBA", (size, size), (10, 0, 40, 100)), mask=mask)
    img.alpha_composite(shadow)


# ─────────────────────────────────────────────────────────────
# 1.  logo.png  512×512
# ─────────────────────────────────────────────────────────────

def make_logo(size=512):
    img = draw_gradient_bg(size, radius_frac=0.22)
    draw_glow(img, size, radius_frac=0.42)
    draw_bolt_shadow(img, size, scale_extra=0.92)
    draw_bolt_on(img, size, scale_extra=0.92)
    draw_highlight(img, size)
    return img


logo = make_logo(512)
logo_path = os.path.join(ASSETS, "logo.png")
logo.save(logo_path, "PNG", optimize=True)
print(f"  ✓  {logo_path}  (512×512)")


# ─────────────────────────────────────────────────────────────
# 2.  social-preview.png  1280×640
#     Layout: dark background · big centred icon · wordmark · tagline
# ─────────────────────────────────────────────────────────────

def make_social(width=1280, height=640):
    card = Image.new("RGBA", (width, height), (0, 0, 0, 0))

    # ── Dark background with subtle vertical gradient ──
    bg = Image.new("RGBA", (width, height))
    bgd = ImageDraw.Draw(bg)
    for y in range(height):
        t = y / (height - 1)
        c = lerp((10, 8, 22), (18, 14, 38), t) + (255,)
        bgd.line([(0, y), (width-1, y)], fill=c)
    card.alpha_composite(bg)

    # ── Decorative glow blob (top-left and bottom-right) ──
    for cx, cy, rad, alpha in [
        (200, 160, 260, 28),
        (1100, 500, 220, 22),
        (640, 300, 340, 15),
    ]:
        gblob = Image.new("RGBA", (width, height), (0,0,0,0))
        for step in range(10):
            t2 = step / 9
            r2 = int(rad * (1 - t2 * 0.6))
            a2 = int(alpha * (1 - t2))
            layer = Image.new("RGBA", (width, height), (0,0,0,0))
            ImageDraw.Draw(layer).ellipse(
                [cx-r2, cy-r2, cx+r2, cy+r2],
                fill=(100, 60, 240, a2)
            )
            gblob = Image.alpha_composite(gblob, layer)
        card.alpha_composite(gblob)

    # ── Grid lines (very faint) ──
    grid = Image.new("RGBA", (width, height), (0,0,0,0))
    gd2 = ImageDraw.Draw(grid)
    for x in range(0, width, 80):
        gd2.line([(x,0),(x,height)], fill=(255,255,255,6))
    for y in range(0, height, 80):
        gd2.line([(0,y),(width,y)], fill=(255,255,255,6))
    card.alpha_composite(grid)

    # ── Icon (centred-left area) ──
    icon_size = 220
    icon = make_logo(icon_size)
    ix = width // 2 - icon_size // 2
    iy = height // 2 - icon_size // 2 - 30
    card.alpha_composite(icon, (ix, iy))

    # ── Text ──
    draw = ImageDraw.Draw(card)

    # Try to load a system font; fall back gracefully
    def try_font(size):
        for path in [
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/SFNSDisplay.ttf",
            "/System/Library/Fonts/SFNS.ttf",
            "/Library/Fonts/Arial Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
        ]:
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
        return ImageFont.load_default()

    font_title = try_font(88)
    font_tag   = try_font(34)
    font_sub   = try_font(26)

    # Title "QueryBoost"
    title = "QueryBoost"
    bb = draw.textbbox((0, 0), title, font=font_title)
    tw = bb[2] - bb[0]
    tx = (width - tw) // 2
    ty = iy + icon_size + 24

    # Shadow
    draw.text((tx+3, ty+4), title, font=font_title, fill=(20, 10, 50, 160))
    # Gradient text via mask trick
    text_mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(text_mask).text((tx, ty), title, font=font_title, fill=255)
    text_grad = Image.new("RGBA", (width, height), (0,0,0,0))
    tgd = ImageDraw.Draw(text_grad)
    for y in range(height):
        t3 = max(0.0, min(1.0, (y - ty) / max(1, bb[3]-bb[1])))
        c3 = lerp((220, 200, 255), (160, 120, 255), t3) + (255,)
        tgd.line([(0, y), (width-1, y)], fill=c3)
    text_layer = Image.new("RGBA", (width, height), (0,0,0,0))
    text_layer.paste(text_grad, mask=text_mask)
    card.alpha_composite(text_layer)

    # Tagline
    tag = "Silent AI query enhancement"
    bb2 = draw.textbbox((0, 0), tag, font=font_tag)
    tx2 = (width - (bb2[2]-bb2[0])) // 2
    ty2 = ty + (bb[3]-bb[1]) + 16
    draw.text((tx2, ty2), tag, font=font_tag, fill=(170, 155, 220, 230))

    # Platform pills
    platforms = ["ChatGPT", "Claude", "Gemini", "Perplexity"]
    pill_font = try_font(22)
    pill_cols = [
        (16, 185, 129),   # green
        (217,119,  6),    # amber
        (59, 130, 246),   # blue
        (168, 85, 247),   # purple
    ]
    pill_pad_x, pill_pad_y = 18, 8
    pill_gap = 14
    pill_h = 38

    # Measure total width
    pill_widths = []
    for p in platforms:
        bb3 = draw.textbbox((0,0), p, font=pill_font)
        pill_widths.append(bb3[2]-bb3[0] + pill_pad_x*2)

    total_pill_w = sum(pill_widths) + pill_gap * (len(platforms)-1)
    px_start = (width - total_pill_w) // 2
    py = ty2 + (bb2[3]-bb2[1]) + 26

    px = px_start
    for i, (plat, pw) in enumerate(zip(platforms, pill_widths)):
        col = pill_cols[i]
        # pill background
        pill_bg = Image.new("RGBA", (width, height), (0,0,0,0))
        pbg = ImageDraw.Draw(pill_bg)
        pbg.rounded_rectangle(
            [px, py, px+pw, py+pill_h],
            radius=pill_h//2,
            fill=col + (30,),
            outline=col + (120,),
            width=1,
        )
        card.alpha_composite(pill_bg)
        # text
        bb4 = draw.textbbox((0,0), plat, font=pill_font)
        ptx = px + (pw - (bb4[2]-bb4[0])) // 2
        pty = py + (pill_h - (bb4[3]-bb4[1])) // 2 - 1
        draw.text((ptx, pty), plat, font=pill_font, fill=col + (240,))
        px += pw + pill_gap

    return card.convert("RGB")


social = make_social()
social_path = os.path.join(ASSETS, "social-preview.png")
social.save(social_path, "PNG", optimize=True)
print(f"  ✓  {social_path}  (1280×640)")

print("\nAll assets generated.")
