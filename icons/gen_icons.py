"""
QueryBoost — Industry Standard Icon Generator v5
Design: Amplified Search. A modern, geometric logo featuring a stylized capital
"Q" formed by three distinct, interlocking chevrons. The arrows transition
through a vibrant cyan-to-emerald gradient, symbolizing enhancement and growth.
Outputs: icon16.png  icon32.png  icon48.png  icon128.png  icon128_store.png
"""

import os
import math
from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
SIZES   = [16, 32, 48, 128]

# ── v5 Palette: Amplified Search ─────────────────────────────────────────────
BG_COLOR      = (24, 25, 28)    # Very dark, slightly cool gray
CHEVRON_CYAN  = (0, 255, 200)
CHEVRON_MID   = (0, 225, 170)
CHEVRON_EMRLD = (0, 200, 140)
GRADIENT_STEPS = [CHEVRON_CYAN, CHEVRON_MID, CHEVRON_EMRLD]
SHADOW_COLOR  = (10, 10, 12, 180)
HIGHLIGHT_COLOR = (255, 255, 255, 200)

# ── Geometry ─────────────────────────────────────────────────────────────────
# Defines the three chevrons that form the stylized 'Q'
# Points are for a 128x128 canvas and will be scaled down.
CHEVRON_SHAPES = [
    [(30, 20), (64, 54), (98, 20), (80, 20), (64, 36), (48, 20)], # Top
    [(30, 45), (64, 79), (98, 45), (80, 45), (64, 61), (48, 45)], # Middle
    [(30, 70), (64, 104), (98, 70), (80, 70), (64, 86), (48, 70)], # Bottom
]
# Defines the tail of the 'Q'
Q_TAIL_SHAPE = [(82, 82), (102, 102), (102, 88), (90, 82)]

def _scale_shape(shape, size, offset=(0,0)):
    """Scales a shape from the 128x128 reference to the target size."""
    scale = size / 128.0
    ox, oy = offset
    return [(p[0] * scale + ox, p[1] * scale + oy) for p in shape]

def _rounded_mask(size, r_frac):
    """Creates a rounded corner mask for the icon."""
    r = max(2, int(size * r_frac))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size, size), radius=r, fill=255)
    return mask

# ── Layer Generators ─────────────────────────────────────────────────────────

def make_base(size, r_frac):
    """Creates the dark, rounded-square base layer."""
    base = Image.new("RGBA", (size, size), BG_COLOR)
    mask = _rounded_mask(size, r_frac)
    out = Image.new("RGBA", (size, size), (0,0,0,0))
    out.paste(base, mask=mask)
    return out

def add_chevrons(draw, size):
    """Draws the chevrons with shadows and highlights."""
    shadow_offset = size * 0.03
    
    # Draw chevrons from top to bottom to ensure correct overlap
    for i, shape_pts in enumerate(CHEVRON_SHAPES):
        color = GRADIENT_STEPS[i]
        
        # Shadow
        shadow_shape = _scale_shape(shape_pts, size, (shadow_offset, shadow_offset))
        draw.polygon(shadow_shape, fill=SHADOW_COLOR)
        
        # Main shape
        main_shape = _scale_shape(shape_pts, size)
        draw.polygon(main_shape, fill=color)

    # Draw the Q's tail, which is part of the last chevron's color
    tail_color = GRADIENT_STEPS[-1]
    tail_shadow = _scale_shape(Q_TAIL_SHAPE, size, (shadow_offset, shadow_offset))
    draw.polygon(tail_shadow, fill=SHADOW_COLOR)
    
    main_tail = _scale_shape(Q_TAIL_SHAPE, size)
    draw.polygon(main_tail, fill=tail_color)

def add_highlight_sheen(draw, size):
    """Adds a subtle highlight to the top-left of the shapes."""
    if size < 32: return
    
    # Highlight on the top chevron
    highlight_line_width = max(1, int(size * 0.02))
    draw.line([
        _scale_shape([CHEVRON_SHAPES[0][0]], size)[0],
        _scale_shape([CHEVRON_SHAPES[0][1]], size)[0],
        _scale_shape([CHEVRON_SHAPES[0][2]], size)[0]
    ], fill=HIGHLIGHT_COLOR, width=highlight_line_width, joint="curve")

# ── Main Assembly ────────────────────────────────────────────────────────────

def make_icon(size):
    r_frac = 0.20 if size >= 48 else (0.25 if size == 32 else 0.30)
    
    img = make_base(size, r_frac)
    
    # Use a temporary canvas for drawing the main artwork to handle transparency
    artwork_canvas = Image.new("RGBA", img.size, (0,0,0,0))
    draw = ImageDraw.Draw(artwork_canvas)
    
    add_chevrons(draw, size)
    add_highlight_sheen(draw, size)
    
    # Composite the artwork onto the base
    img.alpha_composite(artwork_canvas)
    
    return img

if __name__ == "__main__":
    if not os.path.exists(OUT_DIR):
        os.makedirs(OUT_DIR)
        
    for size in SIZES:
        icon = make_icon(size)
        path = os.path.join(OUT_DIR, f"icon{size}.png")
        icon.save(path, "PNG", optimize=True)
        print(f"  ✓  icon{size}.png  ({size}×{size})")

    # Generate a dedicated store icon with a slightly smaller corner radius
    store_icon = make_icon(128)
    store_path = os.path.join(OUT_DIR, "icon128_store.png")
    store_icon.save(store_path, "PNG", optimize=True)
    print(f"  ✓  icon128_store.png  (128×128)")

    print("\nAll icons generated with v5 'Amplified Search' design.")
