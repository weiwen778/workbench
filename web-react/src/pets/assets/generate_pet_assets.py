#!/usr/bin/env python3
"""Deterministic pixel-dog sprite sheet + portrait generator (Pillow only).

Every frame is drawn at 64x64 with 1px dark-brown outlines and assembled
into a 4x6 sheet (rows: idle, walk, eat, sleep, sad, sick). The portrait is
drawn at 64x64 and nearest-neighbour upscaled to 128x128.

Usage: python generate_pet_assets.py [output-dir]
"""
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter

FRAME = 64
COLS = 4
ROW_NAMES = ["idle", "walk", "eat", "sleep", "sad", "sick"]

OUTLINE = (74, 51, 36, 255)     # #4A3324 dark brown
BASE = (246, 217, 160, 255)     # #F6D9A0 cream gold
LIGHT = (255, 240, 201, 255)    # #FFF0C9 light highlight
SHADOW = (217, 168, 95, 255)    # #D9A85F amber shadow
DEEP = (184, 132, 63, 255)      # #B8843F deeper amber
PALE = (250, 232, 190, 255)     # muzzle / belly highlight
RED = (209, 72, 63, 255)        # #D1483F collar
RED_DARK = (158, 47, 42, 255)   # #9E2F2A collar edge
GOLD = (240, 186, 78, 255)      # collar tag
DARK = (43, 26, 16, 255)        # eyes / nose
WHITE = (255, 255, 255, 255)
TONGUE = (232, 138, 138, 255)   # #E88A8A
SWEAT = (146, 200, 232, 255)    # #92C8E8
SICK_BASE = (238, 219, 178, 255)


def mask():
    return Image.new("L", (FRAME, FRAME), 0)


def add_ellipse(m, box):
    ImageDraw.Draw(m).ellipse(box, fill=255)


def add_rect(m, box, radius=0):
    if radius:
        ImageDraw.Draw(m).rounded_rectangle(box, radius=radius, fill=255)
    else:
        ImageDraw.Draw(m).rectangle(box, fill=255)


def add_line(m, pts, width):
    ImageDraw.Draw(m).line(pts, fill=255, width=width, joint="curve")


def compose(sil, base, shadow_masks, light_masks, deep_masks, details):
    """Outline + base + shading clipped to the silhouette + details."""
    out = Image.new("RGBA", (sil.size[0], sil.size[1]), (0, 0, 0, 0))
    ring = sil.filter(ImageFilter.MaxFilter(3))
    out.paste(OUTLINE, (0, 0), ring)
    out.paste(base, (0, 0), sil)
    for m, color in shadow_masks:
        out.paste(color, (0, 0), ImageChops.multiply(m, sil))
    for m, color in light_masks:
        out.paste(color, (0, 0), ImageChops.multiply(m, sil))
    for m, color in deep_masks:
        out.paste(color, (0, 0), ImageChops.multiply(m, sil))
    out.alpha_composite(details)
    return out


def standing(
    dy=0,
    head_dx=0,
    head_dy=0,
    ear_dy=0,
    tail=None,
    legs=(0, 0, 0, 0),
    eye="open",
    mouth="none",
    tongue=False,
    base=BASE,
    extra=None,
):
    """Profile dog facing right. Returns a 64x64 RGBA frame."""
    hx = 48 + head_dx
    hy = 25 + head_dy + dy
    if tail is None:
        tail = [(13, 35 + dy), (8, 31 + dy), (5, 25 + dy)]

    sil = mask()
    # tail, torso, chest, legs, head, muzzle, floppy ear
    add_line(sil, tail, 3)
    add_ellipse(sil, (tail[-1][0] - 2, tail[-1][1] - 2, tail[-1][0] + 2, tail[-1][1] + 2))
    add_ellipse(sil, (11, 30 + dy, 40, 50 + dy))
    add_ellipse(sil, (27, 31 + dy, 47, 50 + dy))
    for x, dx in zip((18, 22, 37, 41), legs):
        add_rect(sil, (x + dx, 44 + dy, x + 3 + dx, 56), radius=1)
    add_ellipse(sil, (hx - 10, hy - 10, hx + 10, hy + 10))
    add_ellipse(sil, (hx + 1, hy + 1, hx + 13, hy + 11))
    add_ellipse(sil, (hx - 15, hy - 8 + ear_dy, hx - 4, hy + 12 + ear_dy))

    shadow = [
        (ellipse_mask(12, 44 + dy, 43, 52 + dy), SHADOW),
        (ellipse_mask(29, 44 + dy, 45, 50 + dy), SHADOW),
        (ellipse_mask(hx - 6, hy + 4, hx + 9, hy + 11), SHADOW),
        (ellipse_mask(hx - 13, hy - 2 + ear_dy, hx - 6, hy + 8 + ear_dy), SHADOW),
    ]
    light = [
        (ellipse_mask(15, 30 + dy, 38, 37 + dy), LIGHT),
        (ellipse_mask(hx - 7, hy - 9, hx + 4, hy - 2), LIGHT),
    ]
    deep = [
        (ellipse_mask(hx - 13, hy + 5 + ear_dy, hx - 7, hy + 10 + ear_dy), DEEP),
        (ellipse_mask(hx + 4, hy + 4, hx + 12, hy + 10), PALE),
    ] + [(ellipse_mask(x + dx - 1, 53, x + dx + 4, 57), DEEP) for x, dx in zip((18, 22, 37, 41), legs)]

    det = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
    d = ImageDraw.Draw(det)
    # floppy ear seam
    d.arc((hx - 15, hy - 8 + ear_dy, hx - 4, hy + 12 + ear_dy), 55, 190, fill=DEEP)
    # collar across the neck with a gold tag
    d.polygon([(hx - 9, hy + 4), (hx - 1, hy + 2), (hx - 1, hy + 9), (hx - 9, hy + 11)], fill=RED)
    d.polygon([(hx - 9, hy + 9), (hx - 1, hy + 7), (hx - 1, hy + 9), (hx - 9, hy + 11)], fill=RED_DARK)
    d.point((hx - 5, hy + 10), fill=GOLD)
    d.point((hx - 5, hy + 11), fill=GOLD)
    # nose and muzzle line
    d.rectangle((hx + 9, hy + 3, hx + 12, hy + 5), fill=DARK)
    d.point((hx + 10, hy + 3), fill=(120, 84, 60, 255))
    d.point((hx + 9, hy + 6), fill=OUTLINE)
    # eye
    if eye == "open":
        d.rectangle((hx + 3, hy - 4, hx + 4, hy - 2), fill=DARK)
        d.point((hx + 3, hy - 4), fill=WHITE)
    elif eye == "blink":
        d.line((hx + 2, hy - 3, hx + 5, hy - 3), fill=DARK)
    elif eye == "half":
        d.line((hx + 2, hy - 3, hx + 5, hy - 3), fill=DARK)
        d.point((hx + 2, hy - 2), fill=DARK)
    elif eye == "closed":
        d.line((hx + 2, hy - 3, hx + 4, hy - 2), fill=DARK)
        d.line((hx + 4, hy - 2, hx + 5, hy - 3), fill=DARK)
    # mouth
    if mouth == "open":
        d.rectangle((hx + 8, hy + 8, hx + 10, hy + 9), fill=OUTLINE)
        if tongue:
            d.rectangle((hx + 9, hy + 10, hx + 10, hy + 11), fill=TONGUE)
    elif mouth == "frown":
        d.line((hx + 8, hy + 9, hx + 11, hy + 8), fill=OUTLINE)
    elif mouth == "smile":
        d.line((hx + 8, hy + 8, hx + 11, hy + 8), fill=OUTLINE)
        d.point((hx + 7, hy + 7), fill=OUTLINE)
    if extra:
        extra(d, hx, hy)
    return compose(sil, base, shadow, light, deep, det)


def ellipse_mask(x0, y0, x1, y1):
    m = mask()
    add_ellipse(m, (x0, y0, x1, y1))
    return m


def idle_frame(i):
    breath = (0, 1, 0, 1)[i]
    tail = [
        [(13, 35), (8, 31), (5, 25)],
        [(13, 35), (8, 30), (6, 23)],
        [(13, 36), (8, 32), (5, 26)],
        [(13, 36), (8, 31), (7, 24)],
    ][i]
    return standing(
        dy=breath,
        ear_dy=(0, 1, 0, 1)[i],
        tail=tail,
        eye="blink" if i == 3 else "open",
        mouth="smile",
    )


def walk_frame(i):
    bob = (0, 1, 0, 1)[i]
    legs = [
        (-2, 2, 2, -2),
        (1, 1, -1, -1),
        (2, -2, -2, 2),
        (-1, -1, 1, 1),
    ][i]
    tail = [
        [(13, 34), (9, 30), (7, 24)],
        [(13, 34), (8, 29), (6, 23)],
        [(13, 35), (9, 31), (8, 25)],
        [(13, 35), (8, 30), (7, 22)],
    ][i]
    return standing(
        dy=bob,
        head_dy=(0, 0, 1, 1)[i],
        ear_dy=(0, 1, 1, 2)[i],
        tail=tail,
        legs=legs,
        mouth="smile",
    )


def eat_frame(i):
    dip = (8, 10, 8, 10)[i]
    return standing(
        dy=1,
        head_dx=1,
        head_dy=dip,
        ear_dy=(1, 2, 1, 2)[i],
        tail=[(13, 34), (9, 30), (8, 25)],
        legs=(0, 0, 1, 1),
        eye="half" if i in (1, 3) else "open",
        mouth="open" if i in (1, 3) else "smile",
        tongue=i in (1, 3),
    )


def sleep_frame(i):
    """Curled up on the floor; the four frames breathe and drift two Zs."""
    breath = (0, 1, 0, 1)[i]
    sil = mask()
    add_ellipse(sil, (9, 38 + breath, 52, 57))
    add_ellipse(sil, (40, 40 + breath, 60, 57))
    add_ellipse(sil, (50, 46 + breath, 62, 56))
    add_ellipse(sil, (36, 41 + breath, 47, 57))
    add_line(sil, [(12, 48), (6, 50), (5, 55)], 3)
    add_ellipse(sil, (3, 53, 7, 57))
    add_ellipse(sil, (43, 54, 52, 58))

    shadow = [
        (ellipse_mask(10, 50, 52, 58), SHADOW),
        (ellipse_mask(42, 50 + breath, 60, 57), SHADOW),
    ]
    light = [
        (ellipse_mask(14, 38 + breath, 42, 45 + breath), LIGHT),
        (ellipse_mask(42, 41 + breath, 54, 47 + breath), LIGHT),
    ]
    deep = [
        (ellipse_mask(37, 43 + breath, 45, 56), SHADOW),
        (ellipse_mask(38, 50 + breath, 44, 55), DEEP),
        (ellipse_mask(52, 50 + breath, 61, 56), PALE),
    ]

    det = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
    d = ImageDraw.Draw(det)
    d.polygon([(40, 47 + breath), (47, 45 + breath), (47, 52 + breath), (40, 54 + breath)], fill=RED)
    d.polygon([(40, 52 + breath), (47, 50 + breath), (47, 52 + breath), (40, 54 + breath)], fill=RED_DARK)
    d.point((44, 53 + breath), fill=GOLD)
    d.rectangle((56, 48 + breath, 58, 50 + breath), fill=DARK)
    d.line((53, 50 + breath, 55, 50 + breath), fill=OUTLINE)
    d.line((54, 46 + breath, 56, 45 + breath), fill=DARK)
    d.line((56, 45 + breath, 57, 46 + breath), fill=DARK)
    # floating Zs
    positions = [(50, 16), (49, 12), (52, 9), (50, 13)][i]
    draw_z(d, positions[0], positions[1], 1 if i % 2 == 0 else 2)
    return compose(sil, BASE, shadow, light, deep, det)


def draw_z(d, x, y, scale):
    # a 3x5 Z drawn with 1px (or 2px at scale 2) strokes
    if scale == 1:
        d.line((x, y, x + 3, y), fill=OUTLINE)
        d.point((x + 2, y + 1), fill=OUTLINE)
        d.point((x + 1, y + 2), fill=OUTLINE)
        d.line((x, y + 3, x + 3, y + 3), fill=OUTLINE)
    else:
        d.line((x, y, x + 5, y), fill=OUTLINE, width=2)
        d.line((x + 4, y + 2, x + 2, y + 4), fill=OUTLINE, width=2)
        d.line((x + 1, y + 4, x + 2, y + 5), fill=OUTLINE, width=2)
        d.line((x, y + 6, x + 6, y + 6), fill=OUTLINE, width=2)


def sad_frame(i):
    return standing(
        dy=1,
        head_dx=-1,
        head_dy=(4, 5, 4, 5)[i],
        ear_dy=(2, 3, 2, 3)[i],
        tail=[[(13, 36), (10, 42), (8, 49)], [(13, 36), (10, 43), (9, 51)],
              [(13, 36), (11, 42), (10, 48)], [(13, 36), (10, 42), (8, 50)]][i],
        eye="half" if i % 2 == 0 else "blink",
        mouth="frown",
    )


def sick_frame(i):
    drop_y = (10, 8, 11, 9)[i]

    def extra(d, hx, hy):
        # cold sweat drop floating above the forehead
        d.rectangle((hx + 3, drop_y, hx + 6, drop_y + 4), fill=SWEAT)
        d.point((hx + 4, drop_y - 1), fill=(196, 228, 246, 255))
        d.point((hx + 5, drop_y - 1), fill=(196, 228, 246, 255))
        d.rectangle((hx + 3, drop_y, hx + 3, drop_y + 3), fill=(196, 228, 246, 255))
        d.point((hx + 6, drop_y + 4), fill=(96, 156, 196, 255))

    return standing(
        dy=2,
        head_dx=-1,
        head_dy=(5, 6, 5, 6)[i],
        ear_dy=(3, 4, 3, 4)[i],
        tail=[[(13, 37), (11, 43), (10, 49)], [(13, 37), (11, 44), (11, 51)],
              [(13, 37), (12, 43), (11, 48)], [(13, 37), (11, 43), (10, 50)]][i],
        legs=((-1, 1, -1, 1), (0, 0, 0, 0), (-1, 1, 0, 0), (0, 0, -1, 1))[i],
        eye="closed",
        mouth="frown",
        base=SICK_BASE,
        extra=extra,
    )


BUILDERS = [idle_frame, walk_frame, eat_frame, sleep_frame, sad_frame, sick_frame]


def build_sheet():
    sheet = Image.new("RGBA", (FRAME * COLS, FRAME * len(ROW_NAMES)), (0, 0, 0, 0))
    for row, builder in enumerate(BUILDERS):
        for col in range(COLS):
            frame = builder(col)
            sheet.alpha_composite(frame, (col * FRAME, row * FRAME))
    return sheet


def build_portrait():
    """Front view at 64x64, nearest-neighbour upscaled to 128x128."""
    sil = mask()
    add_ellipse(sil, (15, 12, 49, 48))       # head
    add_ellipse(sil, (6, 18, 22, 56))        # left floppy ear
    add_ellipse(sil, (42, 18, 58, 56))       # right floppy ear
    add_ellipse(sil, (18, 42, 46, 63))       # chest
    add_ellipse(sil, (22, 32, 42, 46))       # muzzle

    shadow = [
        (ellipse_mask(18, 42, 46, 64), SHADOW),
        (ellipse_mask(23, 39, 41, 46), SHADOW),
        (ellipse_mask(9, 30, 18, 53), SHADOW),
        (ellipse_mask(46, 30, 55, 53), SHADOW),
    ]
    light = [
        (ellipse_mask(19, 13, 44, 24), LIGHT),
        (ellipse_mask(24, 33, 40, 39), PALE),
    ]
    deep = [
        (ellipse_mask(10, 44, 17, 53), DEEP),
        (ellipse_mask(47, 44, 54, 53), DEEP),
        (ellipse_mask(26, 40, 38, 46), PALE),
    ]
    det = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
    d = ImageDraw.Draw(det)
    # collar and tag
    d.rectangle((20, 48, 44, 52), fill=RED)
    d.line((21, 49, 43, 49), fill=(232, 116, 100, 255))
    d.rectangle((20, 51, 44, 53), fill=RED_DARK)
    d.rectangle((30, 51, 34, 55), fill=GOLD)
    d.point((32, 54), fill=OUTLINE)
    # eyes with highlights, brows
    d.rectangle((21, 26, 25, 31), fill=DARK)
    d.rectangle((38, 26, 42, 31), fill=DARK)
    d.rectangle((22, 27, 23, 28), fill=WHITE)
    d.rectangle((39, 27, 40, 28), fill=WHITE)
    d.line((20, 23, 26, 22), fill=SHADOW)
    d.line((38, 22, 44, 23), fill=SHADOW)
    # nose + mouth + tongue
    d.rectangle((28, 35, 36, 39), fill=DARK)
    d.rectangle((30, 35, 31, 36), fill=(110, 76, 54, 255))
    d.line((32, 40, 32, 42), fill=OUTLINE)
    d.line((28, 42, 31, 44), fill=OUTLINE)
    d.line((33, 42, 36, 44), fill=OUTLINE)
    d.rectangle((30, 44, 34, 46), fill=TONGUE)

    img = compose(sil, BASE, shadow, light, deep, det)
    return img.resize((128, 128), Image.NEAREST)


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    os.makedirs(out_dir, exist_ok=True)
    sheet = build_sheet()
    sheet.save(os.path.join(out_dir, "dog-sheet.png"), optimize=True)
    portrait = build_portrait()
    portrait.save(os.path.join(out_dir, "dog-portrait.png"), optimize=True)
    # asset contract checks (see CREDITS.md)
    assert sheet.size == (256, 384), sheet.size
    assert sheet.mode == "RGBA", sheet.mode
    assert sheet.getchannel("A").getextrema()[0] == 0
    assert portrait.size == (128, 128), portrait.size
    assert portrait.mode == "RGBA", portrait.mode
    print("pet assets ok:", os.path.join(out_dir, "dog-sheet.png"))


if __name__ == "__main__":
    main()
