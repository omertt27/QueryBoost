"""
QueryBoost — Industry Standard Asset Generator v5
Design: Amplified Search. A modern, geometric logo featuring a stylized capital
"Q" formed by three distinct, interlocking chevrons. The arrows transition
through a vibrant cyan-to-emerald gradient, symbolizing enhancement and growth.
Outputs:
  assets/logo.png              512×512   high-res standalone logo
  assets/social-preview.png   1280×640  GitHub repo social card
"""

import os
from PIL import Image, ImageDraw, ImageFont

# ── Setup ────────────────────────────────────────────────────────────────────
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS_DIR = os.path.join(ROOT, "assets")
os.makedirs(ASSETS_DIR, exist_ok=True)

# ── v5 Palette: Amplified Search ─────────────────────────────────────────────
BG_COLOR      = (24, 25, 28)
CHEVRON_CYAN  = (0, 255, 200)
CHEVRON_MID   = (0, 225, 170)
CHEVRON_EMRLD = (0, 200, 140)
GRADIENT_STEPS = [CHEVRON_CYAN, CHEVRON_MID, CHEVRON_EMRLD]
SHADOW_COLOR  = (10, 10, 12, 180)
HIGHLIGHT_COLOR = (255, 255, 255, 200)
TEXT_COLOR    = (240, 240, 255)
SUBTEXT_COLOR = (150, 150, 170)

# ── Geometry ─────────────────────────────────────────────────────────────────
CHEVRON_SHAPES = [
    [(30, 20), (64, 54), (98, 20), (80, 20), (64, 36), (48, 20)],
    [(30, 45), (64, 79), (98, 45), (80, 45), (64, 61), (48, 45)],
    [(30, 70), (64, 104), (98, 70), (80, 70), (64, 86), (48, 70)],
]
Q_TAIL_SHAPE = [(82, 82), (102, 102), (102, 88), (90, 82)]
CANVAS_REF_SIZE = 128.0

def _scale_shape(shape, scale, offset=(0,0)):
    ox, oy = offset
    return [(p[0] * scale + ox, p[1] * scale + oy) for p in shape]

# ── Artwork Generation ───────────────────────────────────────────────────────

def draw_q_logo(draw, size, center_pos):
    """Draws the full 'Q' logo onto a PIL Draw object."""
    scale = size / CANVAS_REF_SIZE
    cx, cy = center_pos
    
    # Center the 128x128 reference canvas at the given position
    offset_x = cx - (CANVAS_REF_SIZE * scale / 2)
    offset_y = cy - (CANVAS_REF_SIZE * scale / 2)
    
    shadow_offset = size * 0.03
    
    # Draw chevrons
    for i, shape_pts in enumerate(CHEVRON_SHAPES):
        color = GRADIENT_STEPS[i]
        shadow_shape = _scale_shape(shape_pts, scale, (offset_x + shadow_offset, offset_y + shadow_offset))
        main_shape = _scale_shape(shape_pts, scale, (offset_x, offset_y))
        draw.polygon(shadow_shape, fill=SHADOW_COLOR)
        draw.polygon(main_shape, fill=color)

    # Draw tail
    tail_color = GRADIENT_STEPS[-1]
    tail_shadow = _scale_shape(Q_TAIL_SHAPE, scale, (offset_x + shadow_offset, offset_y + shadow_offset))
    main_tail = _scale_shape(Q_TAIL_SHAPE, scale, (offset_x, offset_y))
    draw.polygon(tail_shadow, fill=SHADOW_COLOR)
    draw.polygon(main_tail, fill=tail_color)

    # Draw highlight
    if size >= 32:
        highlight_line_width = max(1, int(size * 0.02))
        # Manually scale and offset the highlight line points
        scaled_line = [
            (p[0] * scale + offset_x, p[1] * scale + offset_y)
            for p in [CHEVRON_SHAPES[0][0], CHEVRON_SHAPES[0][1], CHEVRON_SHAPES[0][2]]
        ]
        draw.line(scaled_line, fill=HIGHLIGHT_COLOR, width=highlight_line_width, joint="curve")

# ── Asset Makers ─────────────────────────────────────────────────────────────

def make_logo(size=512):
    """Generates the standalone 512x512 logo.png"""
    img = Image.new("RGBA", (size, size), (0,0,0,0))
    draw = ImageDraw.Draw(img)
    
    # Create a dark, rounded-square base
    r = size * 0.20
    ImageDraw.Draw(img).rounded_rectangle((0, 0, size, size), radius=r, fill=BG_COLOR)
    
    # Draw the logo centered on the base
    draw_q_logo(draw, size, (size/2, size/2))
    
    path = os.path.join(ASSETS_DIR, "logo.png")
    img.save(path, "PNG", optimize=True)
    print(f"  ✓  logo.png ({size}×{size})")


def _load_font(size):
    """
    Fix #14: Robust font loading with a prioritized fallback chain.
    Tries common system font paths across macOS, Linux, and Windows before
    falling back to Pillow's built-in default (which exists on all versions).
    """
    candidates = [
        # macOS
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNSDisplay.ttf",
        "/Library/Fonts/Arial.ttf",
        # Linux
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        # Windows
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except (IOError, OSError):
            continue
    # Last resort: Pillow built-in (Pillow ≥ 10 accepts size=)
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def make_social_preview(width=1280, height=640):
    """Generates the 1280x640 social-preview.png"""
    img = Image.new("RGB", (width, height), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # Draw logo on the left
    logo_size = 320
    logo_cx = width * 0.28
    logo_cy = height / 2
    draw_q_logo(draw, logo_size, (logo_cx, logo_cy))

    # Draw text on the right using the robust font loader
    title_font = _load_font(80)
    tag_font   = _load_font(36)

    text_x = width * 0.52
    draw.text((text_x, height/2 - 70), "QueryBoost", font=title_font, fill=TEXT_COLOR)
    draw.text((text_x, height/2 + 40), "Silent, on-device AI query enhancement.", font=tag_font, fill=SUBTEXT_COLOR)

    path = os.path.join(ASSETS_DIR, "social-preview.png")
    img.save(path, "PNG", optimize=True)
    print(f"  ✓  social-preview.png ({width}×{height})")


if __name__ == "__main__":
    print("Generating v5 'Amplified Search' assets...")
    make_logo()
    make_social_preview()
    print("\nAll assets generated.")
