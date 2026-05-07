"""
Generate a designer-rendered OG/Twitter card image for Jax Studio.
Output: /app/frontend/src/static/og-image.png  (1200 x 630, exactly to spec)

Layout philosophy:
  - Pitch-black background (matches the live site)
  - Soft accent radial in the top-right corner (the cube's signature glow)
  - Massive stacked display title "JAX / STUDIO" — left-aligned, asymmetric,
    weight 900 — with a subtle gradient stroke on the second line
  - Thin orange rule + small caps tagline under the title
  - Top-left brand chip (dot + label) for instant recognition
  - Bottom-right "COMING SOON · 2026" mono caption for context

Run: python3 /app/scripts/build_og_image.py
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1200, 630
BG = (10, 10, 10)
TEXT = (255, 255, 255)
ACCENT = (255, 87, 34)
MUTED = (160, 160, 165)
LINE = (50, 50, 55)

# Liberation Sans Bold is on the system; close stand-in for Archivo Black.
SANS_BLACK = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
SANS_REG = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
MONO = "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def draw_radial_glow(canvas: Image.Image, cx: int, cy: int, radius: int, color, alpha_max: int = 110):
    """Soft radial gradient orb — alpha falls off with distance."""
    glow = Image.new("RGBA", (radius * 2, radius * 2), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    steps = 60
    for i in range(steps, 0, -1):
        a = int(alpha_max * (i / steps) ** 2.4)
        r = int(radius * (i / steps))
        gd.ellipse((radius - r, radius - r, radius + r, radius + r), fill=color + (a,))
    glow = glow.filter(ImageFilter.GaussianBlur(8))
    canvas.alpha_composite(glow, (cx - radius, cy - radius))


def draw_grid(canvas: Image.Image, color, step: int = 60, alpha: int = 22):
    """Hairline graph paper for an editorial print feel."""
    g = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(g)
    c = color + (alpha,)
    for x in range(0, W, step):
        gd.line([(x, 0), (x, H)], fill=c, width=1)
    for y in range(0, H, step):
        gd.line([(0, y), (W, y)], fill=c, width=1)
    canvas.alpha_composite(g)


def draw_text_with_outline(d, xy, text, fnt, fill=None, outline=None, outline_width=3):
    """Stroke + fill — used for the second display line for visual contrast."""
    if outline:
        d.text(xy, text, font=fnt, fill=None, stroke_fill=outline, stroke_width=outline_width)
    else:
        d.text(xy, text, font=fnt, fill=fill)


def main():
    img = Image.new("RGBA", (W, H), BG + (255,))

    # 1. Subtle hairline grid (editorial / print vibe)
    draw_grid(img, (255, 255, 255), step=60, alpha=10)

    # 2. Accent glow in top-right corner — the "cube" presence without
    #    actually drawing a cube (which would feel flat as a flat PNG).
    draw_radial_glow(img, cx=W - 110, cy=140, radius=380, color=ACCENT, alpha_max=120)
    # Secondary cooler glow further out for depth
    draw_radial_glow(img, cx=W - 200, cy=80, radius=520, color=(255, 100, 80), alpha_max=40)

    d = ImageDraw.Draw(img)

    # 3. Top-left brand chip — orange dot + label
    chip_x, chip_y = 60, 60
    d.ellipse((chip_x, chip_y + 4, chip_x + 14, chip_y + 18), fill=ACCENT)
    d.text((chip_x + 26, chip_y - 3), "JAX STUDIO", font=font(MONO, 19), fill=TEXT)

    # 4. Massive display title — stacked, asymmetric.
    title_x = 60
    title_y = 220
    f_big = font(SANS_BLACK, 220)
    # Line 1: solid white "JAX"
    d.text((title_x, title_y), "JAX", font=f_big, fill=TEXT)
    # Line 2: outlined "STUDIO" in accent — eye-catch + brand color
    line2_y = title_y + 195
    d.text((title_x, line2_y), "STUDIO",
           font=f_big, fill=None,
           stroke_fill=ACCENT, stroke_width=4)

    # 5. Thin accent rule + tagline beneath the title
    rule_y = line2_y + 230
    d.line([(title_x, rule_y), (title_x + 80, rule_y)], fill=ACCENT, width=3)
    d.text((title_x + 100, rule_y - 11),
           "GRAPHIC DESIGN  ·  BRAND IDENTITY  ·  2026",
           font=font(MONO, 18), fill=MUTED)

    # 6. Bottom-right COMING SOON
    soon_text = "COMING SOON"
    f_soon = font(MONO, 22)
    bb = d.textbbox((0, 0), soon_text, font=f_soon)
    tw = bb[2] - bb[0]
    th = bb[3] - bb[1]
    sx = W - 60 - tw
    sy = H - 60 - th
    # Pulse dot
    d.ellipse((sx - 22, sy + 6, sx - 10, sy + 18), fill=ACCENT)
    d.text((sx, sy - 3), soon_text, font=f_soon, fill=TEXT)

    # 7. Hairline corner brackets for editorial framing
    bracket_color = LINE + (255,)
    blen = 28
    bw = 2
    # Top-left
    d.line([(28, 28), (28 + blen, 28)], fill=bracket_color, width=bw)
    d.line([(28, 28), (28, 28 + blen)], fill=bracket_color, width=bw)
    # Top-right
    d.line([(W - 28, 28), (W - 28 - blen, 28)], fill=bracket_color, width=bw)
    d.line([(W - 28, 28), (W - 28, 28 + blen)], fill=bracket_color, width=bw)
    # Bottom-left
    d.line([(28, H - 28), (28 + blen, H - 28)], fill=bracket_color, width=bw)
    d.line([(28, H - 28), (28, H - 28 - blen)], fill=bracket_color, width=bw)
    # Bottom-right
    d.line([(W - 28, H - 28), (W - 28 - blen, H - 28)], fill=bracket_color, width=bw)
    d.line([(W - 28, H - 28), (W - 28, H - 28 - blen)], fill=bracket_color, width=bw)

    out_path = "/app/frontend/src/static/og-image.png"
    img.convert("RGB").save(out_path, "PNG", optimize=True)
    print(f"Wrote {out_path}  ({W}x{H})")


if __name__ == "__main__":
    main()
