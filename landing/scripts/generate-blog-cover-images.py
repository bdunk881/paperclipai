#!/usr/bin/env python3
"""Generate AutoFlow v2 editorial cover images for the marketing blog series.

The generated PNGs are deterministic, 1200x630, and intentionally use the v2
"Workplace" palette from landing/app/v2.css: cream paper, ink linework,
terracotta as the through-line, and one earthy secondary accent per cover.
"""

from __future__ import annotations

import json
import math
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1200, 630
OUT_DIR = Path(__file__).resolve().parents[1] / "public" / "blog" / "covers"
MANIFEST = OUT_DIR / "cover-image-manifest.json"

COLORS = {
    "paper": "#f6f1e7",
    "paper2": "#ede5d3",
    "paper3": "#e3d9c2",
    "card": "#ffffff",
    "ink": "#1a1410",
    "ink2": "#3a2f25",
    "ink3": "#6b5a48",
    "line": "#d8ccb7",
    "clay": "#c2502b",
    "clay2": "#d96239",
    "claySoft": "#f0c8b8",
    "sage": "#4a6b4a",
    "sage2": "#6b8e6b",
    "mustard": "#b8862c",
    "mustard2": "#d49e3e",
    "plum": "#5d3a5e",
    "blue": "#1f3a52",
}

FONT_SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"
FONT_SERIF_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
FONT_SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_SANS_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


@dataclass(frozen=True)
class Cover:
    slug: str
    post_id: str
    accent: str
    secondary: str
    eyebrow: str
    title: str
    alt: str
    draw: Callable[[ImageDraw.ImageDraw], None]


def hex_to_rgba(hex_color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4)) + (alpha,)


def base(seed: int) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    rng = random.Random(seed)
    img = Image.new("RGB", (W, H), COLORS["paper"])
    d = ImageDraw.Draw(img, "RGBA")

    # Warm editorial paper texture.
    noise = Image.effect_noise((W, H), 18).convert("L")
    noise = Image.merge("RGB", (noise, noise, noise)).point(lambda p: int(244 + (p - 128) * 0.035))
    img = Image.blend(img, noise, 0.09)
    d = ImageDraw.Draw(img, "RGBA")

    for x in range(60, W, 120):
        d.line((x, 0, x, H), fill=hex_to_rgba(COLORS["line"], 42), width=1)
    for y in range(62, H, 112):
        d.line((0, y, W, y), fill=hex_to_rgba(COLORS["line"], 38), width=1)

    # Misregistered paper tabs and arcs used across the set.
    for _ in range(8):
        x, y = rng.randint(-120, W), rng.randint(-80, H)
        r = rng.randint(28, 82)
        d.ellipse((x, y, x + r, y + r), outline=hex_to_rgba(COLORS["clay"], 18), width=2)
    d.rounded_rectangle((48, 44, W - 48, H - 44), radius=26, outline=hex_to_rgba(COLORS["ink"], 45), width=1)
    return img, d


def arrow(d: ImageDraw.ImageDraw, start, end, color, width=5, alpha=255):
    sx, sy = start
    ex, ey = end
    d.line((sx, sy, ex, ey), fill=hex_to_rgba(color, alpha), width=width)
    ang = math.atan2(ey - sy, ex - sx)
    size = 17
    p1 = (ex - size * math.cos(ang - 0.45), ey - size * math.sin(ang - 0.45))
    p2 = (ex - size * math.cos(ang + 0.45), ey - size * math.sin(ang + 0.45))
    d.polygon((end, p1, p2), fill=hex_to_rgba(color, alpha))


def card(d, xy, label, accent, w=160, h=78, icon=""):
    x, y = xy
    d.rounded_rectangle((x + 5, y + 7, x + w + 5, y + h + 7), radius=16, fill=hex_to_rgba(COLORS["ink"], 20))
    d.rounded_rectangle((x, y, x + w, y + h), radius=16, fill=hex_to_rgba(COLORS["card"], 238), outline=hex_to_rgba(COLORS["ink"], 94), width=2)
    d.ellipse((x + 16, y + 20, x + 42, y + 46), fill=hex_to_rgba(accent, 220))
    if icon:
        d.text((x + 24, y + 26), icon, fill=hex_to_rgba(COLORS["card"], 255), anchor="mm", font=font(FONT_SANS_BOLD, 14))
    d.text((x + 54, y + 27), label, fill=hex_to_rgba(COLORS["ink"], 235), font=font(FONT_SANS_BOLD, 18))
    d.line((x + 54, y + 53, x + w - 22, y + 53), fill=hex_to_rgba(accent, 120), width=3)


def draw_header(d: ImageDraw.ImageDraw, cover: Cover):
    d.text((78, 79), cover.eyebrow.upper(), fill=hex_to_rgba(COLORS["ink3"], 230), font=font(FONT_MONO, 16))
    d.text((78, 112), cover.title, fill=hex_to_rgba(COLORS["ink"], 245), font=font(FONT_SERIF, 38))
    d.rounded_rectangle((78, 176, 254, 186), radius=5, fill=hex_to_rgba(cover.accent, 210))
    d.rounded_rectangle((274, 176, 354, 186), radius=5, fill=hex_to_rgba(cover.secondary, 180))


def pillar(d):
    pts = [(248, 330), (440, 252), (628, 330), (818, 252), (976, 330), (818, 450), (628, 395), (440, 450)]
    labels = ["Lead", "CRM", "Invoice", "Onboard", "Report", "Approve", "Budget", "Slack"]
    for a, b in zip(pts, pts[1:] + pts[:1]):
        arrow(d, a, b, COLORS["clay"], 4, 160)
    for p, label in zip(pts, labels):
        card(d, (p[0]-76, p[1]-36), label, COLORS["clay"], 152, 72)
    d.ellipse((548, 242, 708, 402), fill=hex_to_rgba(COLORS["claySoft"], 105), outline=hex_to_rgba(COLORS["clay"], 190), width=3)
    d.text((628, 323), "SMB\nops", fill=hex_to_rgba(COLORS["ink"], 235), anchor="mm", align="center", font=font(FONT_SERIF_BOLD, 30))


def zapier(d):
    d.line((600, 210, 600, 525), fill=hex_to_rgba(COLORS["ink"], 90), width=3)
    d.arc((390, 260, 810, 740), 200, 340, fill=hex_to_rgba(COLORS["sage"], 210), width=7)
    d.polygon([(600, 250), (522, 442), (678, 442)], outline=hex_to_rgba(COLORS["ink"], 210), fill=hex_to_rgba(COLORS["paper2"], 180))
    for x, c in [(335, COLORS["sage"]), (865, COLORS["clay"])] :
        d.rounded_rectangle((x-126, 322, x+126, 430), radius=18, fill=hex_to_rgba(COLORS["card"], 235), outline=hex_to_rgba(COLORS["ink"], 90), width=2)
        d.ellipse((x-43, 249, x+43, 335), fill=hex_to_rgba(c, 215))
        for i in range(3):
            d.line((x-78, 360+i*22, x+78, 360+i*22), fill=hex_to_rgba(c, 130), width=4)
    d.text((335, 476), "task zaps", anchor="mm", fill=hex_to_rgba(COLORS["ink3"], 230), font=font(FONT_MONO, 18))
    d.text((865, 476), "agent routines", anchor="mm", fill=hex_to_rgba(COLORS["ink3"], 230), font=font(FONT_MONO, 18))


def n8n(d):
    # Left: branching open flow.
    center = (375, 350)
    branches = [(220, 250), (220, 450), (520, 250), (520, 450), (560, 350)]
    for p in branches:
        arrow(d, center, p, COLORS["blue"], 4, 155)
    for p in [center] + branches:
        d.ellipse((p[0]-32, p[1]-32, p[0]+32, p[1]+32), fill=hex_to_rgba(COLORS["card"], 245), outline=hex_to_rgba(COLORS["blue"], 210), width=4)
    # Right: guided flow with manager rail.
    x0 = 700
    d.rounded_rectangle((670, 223, 1008, 475), radius=34, fill=hex_to_rgba(COLORS["card"], 210), outline=hex_to_rgba(COLORS["ink"], 75), width=2)
    for i, lab in enumerate(["Plan", "Run", "Review"]):
        y = 272 + i * 78
        card(d, (x0, y - 31), lab, COLORS["clay"], 180, 62)
        if i < 2: arrow(d, (790, y + 35), (790, y + 64), COLORS["clay"], 4, 180)
    d.line((930, 250, 930, 445), fill=hex_to_rgba(COLORS["blue"], 170), width=6)
    d.text((930, 226), "policy", anchor="mm", fill=hex_to_rgba(COLORS["blue"], 230), font=font(FONT_MONO, 16))


def make_blocks(d):
    blocks = [(248, 284, COLORS["mustard"]), (408, 226, COLORS["clay"]), (568, 330, COLORS["mustard2"]), (728, 250, COLORS["claySoft"]), (888, 356, COLORS["mustard"])]
    for i, (x, y, c) in enumerate(blocks):
        if i: arrow(d, (blocks[i-1][0]+106, blocks[i-1][1]+48), (x-16, y+48), COLORS["ink"], 3, 120)
        d.rounded_rectangle((x, y, x+128, y+96), radius=20, fill=hex_to_rgba(c, 210), outline=hex_to_rgba(COLORS["ink"], 130), width=2)
        d.rectangle((x+22, y+24, x+106, y+34), fill=hex_to_rgba(COLORS["card"], 150))
        d.rectangle((x+22, y+49, x+84, y+59), fill=hex_to_rgba(COLORS["card"], 130))
    d.rounded_rectangle((170, 190, 1035, 505), radius=34, outline=hex_to_rgba(COLORS["ink"], 70), width=3)
    d.text((605, 527), "modular visual canvas", anchor="mm", fill=hex_to_rgba(COLORS["ink3"], 230), font=font(FONT_MONO, 18))


def power(d):
    # Heavy gears.
    for cx, cy, r in [(355, 350, 92), (475, 300, 64)]:
        for a in range(0, 360, 30):
            x = cx + math.cos(math.radians(a)) * (r + 13)
            y = cy + math.sin(math.radians(a)) * (r + 13)
            d.rounded_rectangle((x-10, y-10, x+10, y+10), radius=4, fill=hex_to_rgba(COLORS["plum"], 170))
        d.ellipse((cx-r, cy-r, cx+r, cy+r), fill=hex_to_rgba(COLORS["plum"], 135), outline=hex_to_rgba(COLORS["ink"], 135), width=3)
        d.ellipse((cx-r/2, cy-r/2, cx+r/2, cy+r/2), fill=hex_to_rgba(COLORS["paper"], 235), outline=hex_to_rgba(COLORS["ink"], 90), width=2)
    # Nimble arrows.
    for y in [264, 342, 420]:
        arrow(d, (642, y), (960, y-34 if y == 342 else y), COLORS["clay"], 8, 215)
        d.ellipse((620, y-16, 652, y+16), fill=hex_to_rgba(COLORS["claySoft"], 220), outline=hex_to_rgba(COLORS["clay"], 200), width=2)
    d.text((395, 505), "enterprise weight", anchor="mm", fill=hex_to_rgba(COLORS["ink3"], 230), font=font(FONT_MONO, 17))
    d.text((805, 505), "startup motion", anchor="mm", fill=hex_to_rgba(COLORS["ink3"], 230), font=font(FONT_MONO, 17))


def tools(d):
    for i in range(5):
        x = 238 + i * 154
        y = 272 + (i % 2) * 42
        h = 168 - i * 12
        d.rounded_rectangle((x, y, x+108, y+h), radius=19, fill=hex_to_rgba(COLORS["card"], 242), outline=hex_to_rgba(COLORS["ink"], 90), width=2)
        d.ellipse((x+26, y+25, x+82, y+81), fill=hex_to_rgba(COLORS["clay" if i==0 else "mustard"], 210 - i*18))
        d.text((x+54, y+54), str(i+1), anchor="mm", fill=hex_to_rgba(COLORS["card"], 255), font=font(FONT_SANS_BOLD, 25))
        for j in range(3):
            d.line((x+24, y+100+j*20, x+84, y+100+j*20), fill=hex_to_rgba(COLORS["ink"], 75), width=3)
    d.line((210, 512, 1000, 512), fill=hex_to_rgba(COLORS["clay"], 160), width=5)


def invoice(d):
    d.rounded_rectangle((220, 210, 550, 500), radius=18, fill=hex_to_rgba(COLORS["card"], 245), outline=hex_to_rgba(COLORS["ink"], 105), width=2)
    d.text((260, 257), "INVOICE", fill=hex_to_rgba(COLORS["ink"], 230), font=font(FONT_MONO, 28))
    for i, w in enumerate([210, 170, 245, 130]):
        d.line((260, 310+i*38, 260+w, 310+i*38), fill=hex_to_rgba(COLORS["line"], 240), width=5)
    d.rounded_rectangle((260, 435, 510, 460), radius=8, fill=hex_to_rgba(COLORS["sage"], 180))
    xs = [670, 800, 930]
    for i, (x, lab) in enumerate(zip(xs, ["Day 3", "Day 7", "Day 14"])):
        if i: arrow(d, (xs[i-1]+46, 350), (x-46, 350), COLORS["sage"], 5, 180)
        d.ellipse((x-48, 302, x+48, 398), fill=hex_to_rgba(COLORS["card"], 245), outline=hex_to_rgba(COLORS["sage"], 215), width=5)
        d.text((x, 350), lab, anchor="mm", fill=hex_to_rgba(COLORS["ink"], 240), font=font(FONT_SANS_BOLD, 19))
    d.text((800, 454), "reminder cadence", anchor="mm", fill=hex_to_rgba(COLORS["ink3"], 230), font=font(FONT_MONO, 18))


def future(d):
    # Dawn horizon.
    d.rectangle((90, 420, 1110, 430), fill=hex_to_rgba(COLORS["ink"], 85))
    d.pieslice((418, 194, 782, 558), 180, 360, fill=hex_to_rgba(COLORS["mustard2"], 155), outline=hex_to_rgba(COLORS["clay"], 175), width=4)
    for r, a in [(420, 70), (560, 45), (700, 30)]:
        d.arc((600-r/2, 315-r/2, 600+r/2, 315+r/2), 200, 340, fill=hex_to_rgba(COLORS["clay"], a), width=3)
    blocks = [(296, 375), (438, 315), (560, 360), (696, 308), (828, 372)]
    for i, (x, y) in enumerate(blocks):
        d.rounded_rectangle((x, y, x+92, y+70), radius=14, fill=hex_to_rgba(COLORS["card"], 238), outline=hex_to_rgba(COLORS["ink"], 90), width=2)
        d.line((x+18, y+25, x+74, y+25), fill=hex_to_rgba(COLORS["mustard" if i % 2 else "clay"], 160), width=4)
        d.line((x+18, y+44, x+60, y+44), fill=hex_to_rgba(COLORS["ink"], 65), width=3)
        if i: arrow(d, (blocks[i-1][0]+92, blocks[i-1][1]+35), (x, y+35), COLORS["clay"], 4, 150)
    d.text((600, 502), "no-code blocks self-assembling", anchor="mm", fill=hex_to_rgba(COLORS["ink3"], 230), font=font(FONT_MONO, 18))


COVERS = [
    Cover("complete-guide-workflow-automation-small-business", "fT4RkbtsUFo0w0XC153GsN", COLORS["clay"], COLORS["clay2"], "Pillar guide", "Workflow automation for small business", "Editorial illustration of connected small-business processes, including leads, CRM, invoices, onboarding, approvals, budgets, reports, and Slack-like updates, on a warm cream AutoFlow v2 background.", pillar),
    Cover("autoflow-vs-zapier", "0bzv6vDb5M9RssFkJRkNJz", COLORS["clay"], COLORS["sage"], "Comparison", "AutoFlow vs Zapier", "Balanced editorial scale comparing task-based automation with agent routines, using sage and terracotta accents on cream paper.", zapier),
    Cover("autoflow-vs-n8n", "nE3O1lobPG69YhI3zgxIdI", COLORS["clay"], COLORS["blue"], "Comparison", "AutoFlow vs n8n", "Editorial workflow illustration contrasting a branching open-source flow with a guided agent routine and policy rail in ink-blue and terracotta.", n8n),
    Cover("autoflow-vs-make", "nE3O1lobPG69YhI3zgxIGd", COLORS["clay"], COLORS["mustard"], "Comparison", "AutoFlow vs Make", "Modular visual-canvas blocks connected as an automation flow, with mustard and terracotta accents on a cream editorial background.", make_blocks),
    Cover("autoflow-vs-power-automate", "0bzv6vDb5M9RssFkJRkMop", COLORS["clay"], COLORS["plum"], "Comparison", "AutoFlow vs Power Automate", "Editorial contrast between heavy enterprise gears and nimble startup arrows, using plum and terracotta accents in the AutoFlow v2 style.", power),
    Cover("best-workflow-automation-tools-2026", "0bzv6vDb5M9RssFkJRkNp9", COLORS["clay"], COLORS["mustard"], "2026 shortlist", "Best workflow automation tools", "Tidy ranked top-five editorial lineup of automation tool cards with terracotta and mustard accents on warm cream paper.", tools),
    Cover("automate-invoice-follow-ups-tutorial", "nE3O1lobPG69YhI3zgxJek", COLORS["clay"], COLORS["sage"], "Tutorial", "Automate invoice follow-ups", "Invoice follow-up illustration showing an invoice and Day 3, Day 7, and Day 14 reminder cadence timeline, with sage and terracotta accents.", invoice),
    Cover("future-of-no-code-automation", "nE3O1lobPG69YhI3zgxKbf", COLORS["clay"], COLORS["mustard"], "Future", "The future of no-code automation", "Warm dawn horizon with abstract no-code blocks self-assembling into an automation flow, using mustard and terracotta on cream paper.", future),
]


def save_optimized(img: Image.Image, path: Path):
    # Quantize to keep each social card comfortably below 300 KB without losing
    # the flat editorial treatment.
    pal = img.convert("P", palette=Image.Palette.ADAPTIVE, colors=192)
    pal.save(path, format="PNG", optimize=True)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = []
    for idx, cover in enumerate(COVERS, start=1):
        img, d = base(idx * 131)
        draw_header(d, cover)
        cover.draw(d)
        d.text((78, H - 78), "AUTOFLOW / WORKPLACE AUTOMATION", fill=hex_to_rgba(COLORS["ink3"], 205), font=font(FONT_MONO, 15))
        d.text((W - 78, H - 78), f"{idx:02d} / 08", fill=hex_to_rgba(COLORS["ink3"], 205), font=font(FONT_MONO, 15), anchor="ra")
        img = img.filter(ImageFilter.UnsharpMask(radius=1.1, percent=105, threshold=3))
        filename = f"{idx:02d}-{cover.slug}.png"
        out = OUT_DIR / filename
        save_optimized(img, out)
        manifest.append({
            "slug": cover.slug,
            "postId": cover.post_id,
            "file": filename,
            "path": f"/blog/covers/{filename}",
            "width": W,
            "height": H,
            "accent": cover.secondary,
            "alt": cover.alt,
        })
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    for item in manifest:
        size = (OUT_DIR / item["file"]).stat().st_size
        print(f"{item['file']}: {size/1024:.1f} KB")


if __name__ == "__main__":
    main()
