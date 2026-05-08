"""
Generate designer-rendered social cards for Jax Studio.

Outputs (re-buildable any time):
  • /app/frontend/src/static/og-image.png         — 1200x630 (Twitter/FB/LinkedIn/Slack/Discord/iMessage link preview)
  • /app/frontend/src/static/og-image-square.png  — 1080x1080 (Instagram feed, LinkedIn feed-square, profile cards)

Layout philosophy (shared across both sizes):
  • Pitch-black background (matches the live site)
  • Soft accent radial in the corner (the cube's signature glow)
  • Massive stacked display title "JAX / STUDIO" — second line outlined
  • Thin orange rule + small caps tagline under the title
  • Top-left brand chip (dot + label)
  • Bottom-right COMING SOON · pulse dot
  • Hairline corner brackets for editorial framing

Run:  python3 /app/scripts/build_og_image.py
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BG = (10, 10, 10)
TEXT = (255, 255, 255)
ACCENT = (255, 87, 34)
MUTED = (160, 160, 165)
LINE = (50, 50, 55)

SANS_BLACK = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
MONO = "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"


def font(path, size):
    return ImageFont.truetype(path, size)


def draw_radial_glow(canvas, cx, cy, radius, color, alpha_max=110):
    glow = Image.new("RGBA", (radius * 2, radius * 2), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    steps = 60
    for i in range(steps, 0, -1):
        a = int(alpha_max * (i / steps) ** 2.4)
        r = int(radius * (i / steps))
        gd.ellipse((radius - r, radius - r, radius + r, radius + r), fill=color + (a,))
    glow = glow.filter(ImageFilter.GaussianBlur(8))
    canvas.alpha_composite(glow, (cx - radius, cy - radius))


def draw_grid(canvas, color, step=60, alpha=10):
    g = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(g)
    c = color + (alpha,)
    W, H = canvas.size
    for x in range(0, W, step):
        gd.line([(x, 0), (x, H)], fill=c, width=1)
    for y in range(0, H, step):
        gd.line([(0, y), (W, y)], fill=c, width=1)
    canvas.alpha_composite(g)


def draw_corner_brackets(d, W, H, color=LINE, blen=28, bw=2):
    c = color + (255,)
    pad = 28
    # Top-left
    d.line([(pad, pad), (pad + blen, pad)], fill=c, width=bw)
    d.line([(pad, pad), (pad, pad + blen)], fill=c, width=bw)
    # Top-right
    d.line([(W - pad, pad), (W - pad - blen, pad)], fill=c, width=bw)
    d.line([(W - pad, pad), (W - pad, pad + blen)], fill=c, width=bw)
    # Bottom-left
    d.line([(pad, H - pad), (pad + blen, H - pad)], fill=c, width=bw)
    d.line([(pad, H - pad), (pad, H - pad - blen)], fill=c, width=bw)
    # Bottom-right
    d.line([(W - pad, H - pad), (W - pad - blen, H - pad)], fill=c, width=bw)
    d.line([(W - pad, H - pad), (W - pad, H - pad - blen)], fill=c, width=bw)


def render_card(W, H, layout, out_path):
    """
    layout: dict with size-specific tuning:
      title_x, title_y, title_size, line2_offset, glow_cx, glow_cy, glow_r,
      tagline_text, tagline_y_off, tagline_size, brand_size, soon_size,
      bracket_padding, soon_pos
    """
    img = Image.new("RGBA", (W, H), BG + (255,))

    # 1. Hairline grid (editorial)
    draw_grid(img, (255, 255, 255), step=layout["grid_step"], alpha=10)

    # 2. Accent radial glows
    draw_radial_glow(img, cx=layout["glow_cx"], cy=layout["glow_cy"],
                     radius=layout["glow_r"], color=ACCENT, alpha_max=120)
    draw_radial_glow(img, cx=layout["glow_cx"] - 90, cy=layout["glow_cy"] - 60,
                     radius=int(layout["glow_r"] * 1.35), color=(255, 100, 80), alpha_max=40)

    d = ImageDraw.Draw(img)

    # 3. Brand chip top-left
    chip_x, chip_y = layout["brand_x"], layout["brand_y"]
    chip_dot = layout["brand_size"] - 2
    d.ellipse((chip_x, chip_y + 4, chip_x + chip_dot, chip_y + 4 + chip_dot), fill=ACCENT)
    d.text((chip_x + chip_dot + 12, chip_y - 3), "JAX STUDIO",
           font=font(MONO, layout["brand_size"]), fill=TEXT)

    # 4. Stacked title
    f_big = font(SANS_BLACK, layout["title_size"])
    d.text((layout["title_x"], layout["title_y"]), "JAX", font=f_big, fill=TEXT)
    line2_y = layout["title_y"] + layout["line2_offset"]
    d.text((layout["title_x"], line2_y), "STUDIO",
           font=f_big, fill=None,
           stroke_fill=ACCENT, stroke_width=4)

    # 5. Tagline rule + text
    rule_y = line2_y + layout["tagline_y_off"]
    d.line([(layout["title_x"], rule_y), (layout["title_x"] + 80, rule_y)], fill=ACCENT, width=3)
    d.text((layout["title_x"] + 100, rule_y - 11),
           layout["tagline_text"],
           font=font(MONO, layout["tagline_size"]), fill=MUTED)

    # 6. COMING SOON bottom-right
    soon_text = "COMING SOON"
    f_soon = font(MONO, layout["soon_size"])
    bb = d.textbbox((0, 0), soon_text, font=f_soon)
    tw = bb[2] - bb[0]
    th = bb[3] - bb[1]
    sx, sy = layout["soon_pos"](W, H, tw, th)
    d.ellipse((sx - 22, sy + 6, sx - 10, sy + 18), fill=ACCENT)
    d.text((sx, sy - 3), soon_text, font=f_soon, fill=TEXT)

    # 7. Corner brackets
    draw_corner_brackets(d, W, H)

    img.convert("RGB").save(out_path, "PNG", optimize=True)
    print(f"Wrote {out_path}  ({W}x{H})")


def main():
    # ---- Wide 1200x630 (Twitter / OG / LinkedIn link preview) ----
    render_card(
        W=1200, H=630,
        layout=dict(
            grid_step=60,
            glow_cx=1090, glow_cy=140, glow_r=380,
            brand_x=60, brand_y=60, brand_size=19,
            title_x=60, title_y=220, title_size=220, line2_offset=195,
            tagline_y_off=230,
            tagline_text="GRAPHIC DESIGN  ·  BRAND IDENTITY  ·  2026",
            tagline_size=18,
            soon_size=22,
            soon_pos=lambda W, H, tw, th: (W - 60 - tw, H - 60 - th),
        ),
        out_path="/app/frontend/src/static/og-image.png",
    )

    # ---- Square 1080x1080 (Instagram feed / LinkedIn square) ----
    # Same design language — re-balanced for the narrower / taller canvas.
    render_card(
        W=1080, H=1080,
        layout=dict(
            grid_step=60,
            glow_cx=950, glow_cy=130, glow_r=460,
            brand_x=60, brand_y=60, brand_size=21,
            # Vertical center shifts up a touch so the COMING SOON has room
            title_x=60, title_y=380, title_size=210, line2_offset=185,
            tagline_y_off=215,
            # Shorter tagline so it fits on one line at this width
            tagline_text="GRAPHIC DESIGN  ·  2026",
            tagline_size=20,
            soon_size=24,
            soon_pos=lambda W, H, tw, th: (W - 60 - tw, H - 60 - th),
        ),
        out_path="/app/frontend/src/static/og-image-square.png",
    )

    # ---- Story 1080x1920 (Instagram / Facebook / LinkedIn Stories, 9:16) ----
    # Title pushed to the upper third of the safe area, COMING SOON anchored
    # near the bottom. Wide vertical glow column on the right adds depth and
    # complements the tall canvas. Brand chip top-left with extra padding to
    # avoid the typical Story top-bar overlay.
    render_card(
        W=1080, H=1920,
        layout=dict(
            grid_step=60,
            glow_cx=900, glow_cy=620, glow_r=560,
            brand_x=60, brand_y=130, brand_size=22,
            title_x=60, title_y=720, title_size=240, line2_offset=215,
            tagline_y_off=255,
            tagline_text="GRAPHIC DESIGN  ·  2026",
            tagline_size=22,
            soon_size=26,
            # COMING SOON anchored well above the bottom edge so the Story
            # progress dots / reply UI / swipe-up cover (~250-300 px tall on
            # Instagram & Facebook Stories) don't obscure it.
            soon_pos=lambda W, H, tw, th: (W - 60 - tw, H - 280 - th),
        ),
        out_path="/app/frontend/src/static/og-image-story.png",
    )


if __name__ == "__main__":
    main()
