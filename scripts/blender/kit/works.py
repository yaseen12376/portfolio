"""
The verification-works kit: FinMind's pipeline as a small factory, at
architectural-model density. A conveyor carries each question past the
stations the product runs it through (memory, the calculation engine, the
library of official documents, the context desk, the local model's writing
booth, the five safety gates) to the counter where the answer is handed out.

Each builder returns ONE joined object, origin at its footprint centre on the
floor (z = 0), facing -Y (its front), like the other kits. Pieces the page
moves or paints live (a stamp arm, a screen) are separate 'dyn' objects with
flat colours; everything else is baked.

Palette: the product's own (frontend/tailwind.config.js): navy #0A192F and
#122844, emerald #10B981 and #34D399, cream #F5F3EF.
"""

from __future__ import annotations

import math
import os

import common as C
from kit import geo

NAVY = '#223047'
NAVY_DEEP = '#152236'
EMERALD = '#10b981'
GLOW = '#34d399'
CREAM = '#f2efe8'
BRASS = '#b89452'
PAPER = '#f4f1e8'


def _join(parts, name, role='set', **extras):
    return geo.parts_to(parts, name, role=role, **extras)


def _font():
    f = os.path.join(C.FONTS, 'geist-mono-latin-wght-normal.woff2')
    return f if os.path.exists(f) else None


def navy(name='works_navy'):
    # Matte paint with little sheen: the page draws the set diffuse-only, so a
    # glossy dark paint would read lighter in the Cycles poster than live.
    return geo.pbr(name, NAVY, rough=0.7, spec=0.1)


def steel(name='works_steel'):
    return geo.pbr(name, '#9aa3ab', rough=0.35, metal=0.8)


def label(name, lines, w, h, size, loc=(0, 0, 0), ink=CREAM, paper=NAVY_DEEP, glow=None):
    """A plate with text on its -Y face, bottom centre at `loc` (its back at loc.y)."""
    x, y, z = loc
    ink_mat = geo.pbr(f'ink_{ink}', ink, rough=0.5, emit=glow, emit_strength=0.8 if glow else 0.0)
    parts = [geo.box(f'{name}_plate', (w, 0.008, h), (x, y - 0.004, z), material=geo.pbr(f'plate_{paper}', paper, rough=0.6), bev=0.002)]
    n = len(lines)
    for i, line in enumerate(lines):
        zz = z + h / 2 + (n - 1) * size * 0.75 - i * size * 1.5 - size * 0.4
        parts.append(geo.text(f'{name}_t{i}', line, size=size, depth=0, loc=(x, y - 0.0085, zz), rot=(90, 0, 0), material=ink_mat, font_path=_font(), resolution=2))
    return parts


def plaque(name, lines, w, h, size, ink=CREAM, paper=NAVY_DEEP, glow=None):
    """A sign as one object: its back at y = 0, its bottom at z = 0, text on -Y."""
    return _join(label(name, lines, w, h, size, loc=(0, 0, 0), ink=ink, paper=paper, glow=glow), name)


# ---------------------------------------------------------------- the conveyor

def belt(name='belt', length=2.0, w=0.42, h=0.8):
    """A straight belt conveyor along local X: rubber belt on rollers, navy
    side frames with an emerald stripe, legs about every metre."""
    # Matte rubber (a glossy one would read grey in the poster and dark on the page).
    rubber = geo.pbr('belt_rubber', '#34363b', rough=0.95, spec=0.1)
    frame = navy()
    stripe = geo.pbr('belt_stripe', EMERALD, rough=0.4)
    parts = [geo.box(f'{name}_belt', (length, w - 0.04, 0.025), (0, 0, h - 0.025), material=rubber, bev=0.004)]
    for sy in (-1, 1):
        y = sy * (w / 2 - 0.01)
        parts.append(geo.box(f'{name}_side', (length, 0.035, 0.11), (0, y, h - 0.09), material=frame, bev=0.006))
        parts.append(geo.box(f'{name}_stripe', (length - 0.02, 0.004, 0.018), (0, y + sy * 0.019, h - 0.05), material=stripe, bev=0))
    n = max(2, int(round(length / 1.0)) + 1)
    for i in range(n):
        x = -length / 2 + 0.08 + i * (length - 0.16) / (n - 1)
        for sy in (-1, 1):
            parts.append(geo.box(f'{name}_leg', (0.045, 0.045, h - 0.1), (x, sy * (w / 2 - 0.05), 0), material=frame, bev=0.005))
        parts.append(geo.box(f'{name}_brace', (0.03, w - 0.1, 0.03), (x, 0, 0.18), material=frame, bev=0.004))
    for x in (-length / 2 + 0.04, length / 2 - 0.04):
        parts.append(geo.cyl(f'{name}_roller', 0.04, w - 0.06, (x, (w - 0.06) / 2, h - 0.05), rot=(90, 0, 0), material=steel(), verts=16, bev=0.003))
    return _join(parts, name)


def belt_turn(name='belt_turn', w=0.42, h=0.8):
    """A corner: a square frame with a turntable the trays turn on."""
    frame = navy()
    parts = [geo.box(f'{name}_frame', (w, w, 0.1), (0, 0, h - 0.12), material=frame, bev=0.008),
             geo.cyl(f'{name}_table', w / 2 - 0.02, 0.025, (0, 0, h - 0.025), material=geo.pbr('turntable', '#3a3d44', rough=0.6, metal=0.3), verts=32, bev=0.004)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(geo.box(f'{name}_leg', (0.045, 0.045, h - 0.12), (sx * (w / 2 - 0.05), sy * (w / 2 - 0.05), 0), material=frame, bev=0.005))
    return _join(parts, name)


# ---------------------------------------------------------------- the kiosk

def booth(name='booth', title='FIRE'):
    """One tool's kiosk lectern: a slim pedestal with a tilted screen facing
    the visitor (+Y), and the tool's name on the side the camera sees (-Y)."""
    frame = navy()
    parts = [geo.box(f'{name}_foot', (0.5, 0.36, 0.04), (0, 0, 0), material=frame, bev=0.008),
             geo.box(f'{name}_post', (0.26, 0.16, 0.92), (0, 0, 0.04), material=frame, bev=0.01),
             geo.box(f'{name}_head', (0.5, 0.08, 0.34), (0, 0.02, 0.9), rot=(-24, 0, 0), material=frame, bev=0.01),
             geo.box(f'{name}_glass', (0.44, 0.006, 0.27), (0, 0.068, 0.93), rot=(-24, 0, 0),
                     material=geo.pbr('booth_glass', '#123a34', rough=0.2, emit=GLOW, emit_strength=0.55), bev=0),
             geo.box(f'{name}_slot', (0.2, 0.05, 0.02), (0, 0.1, 0.84), material=geo.pbr('slot_brass', BRASS, rough=0.3, metal=1.0), bev=0.003)]
    parts += label(f'{name}_name', [title], 0.44, 0.1, 0.045, loc=(0, -0.085, 0.55), ink=CREAM, paper=NAVY_DEEP)
    return _join(parts, name)


# ---------------------------------------------------------------- memory

def cabinet(name='cabinet', title='PROFILE', w=0.5, d=0.6, h=1.3):
    """A four-drawer filing cabinet, drawer fronts to -Y, its label on top drawer."""
    body = geo.pbr('cabinet_body', '#c9cdc6', rough=0.5, metal=0.2)
    parts = [geo.box(f'{name}_body', (w, d, h), (0, 0, 0), material=body, bev=0.008)]
    dh = (h - 0.06) / 4
    for k in range(4):
        z = 0.03 + k * dh
        parts.append(geo.box(f'{name}_drawer', (w - 0.04, 0.012, dh - 0.02), (0, -d / 2 - 0.004, z + 0.01), material=body, bev=0))
        parts.append(geo.box(f'{name}_pull', (0.14, 0.025, 0.02), (0, -d / 2 - 0.016, z + dh * 0.62), material=geo.pbr('pull_brass', BRASS, rough=0.3, metal=1.0), bev=0))
        parts.append(geo.box(f'{name}_card', (0.09, 0.004, 0.04), (0, -d / 2 - 0.012, z + dh * 0.78), material=geo.pbr('card_white', PAPER, rough=0.8), bev=0))
    parts += label(f'{name}_title', [title], w - 0.08, 0.07, 0.032, loc=(0, -d / 2 - 0.01, h + 0.02), ink=CREAM, paper=NAVY_DEEP)
    return _join(parts, name)


# ---------------------------------------------------------------- the calculation engine

def press(name='engine'):
    """The calculation engine as a printing press: a navy base, a column,
    a head with dials, a paper strip running out to the belt. The ram is a
    separate 'dyn' piece the page strokes."""
    frame = navy()
    parts = [geo.box(f'{name}_base', (1.05, 0.8, 0.82), (0, 0, 0), material=frame, bev=0.02),
             geo.box(f'{name}_bed', (0.9, 0.6, 0.05), (0, 0, 0.82), material=steel(), bev=0.006),
             geo.box(f'{name}_column', (0.16, 0.2, 0.9), (0, 0.26, 0.82), material=frame, bev=0.01),
             geo.box(f'{name}_head', (0.6, 0.5, 0.26), (0, 0.08, 1.46), material=frame, bev=0.02)]
    for i, x in enumerate((-0.2, 0.0, 0.2)):
        parts.append(geo.cyl(f'{name}_rim{i}', 0.072, 0.02, (x, -0.16, 1.59), rot=(90, 0, 0), material=geo.pbr('dial_rim', BRASS, rough=0.3, metal=1.0), verts=16, bev=0))
        parts.append(geo.cyl(f'{name}_dial{i}', 0.06, 0.02, (x, -0.175, 1.59), rot=(90, 0, 0), material=geo.pbr('dial_face', CREAM, rough=0.4), verts=16, bev=0))
    # The paper strip: a roll at the back, a sheet across the bed, a tongue out the front.
    paper = geo.pbr('strip_paper', PAPER, rough=0.85)
    parts.append(geo.cyl(f'{name}_roll', 0.09, 0.5, (0, 0.46, 0.95), rot=(0, 90, 0), material=paper, verts=24, bev=0.004))
    parts.append(geo.box(f'{name}_sheet', (0.42, 0.64, 0.004), (0, -0.02, 0.87), material=paper, bev=0))
    parts.append(geo.box(f'{name}_stripe', (1.06, 0.006, 0.05), (0, -0.403, 0.6), material=geo.pbr('press_stripe', EMERALD, rough=0.4), bev=0))
    parts += label(f'{name}_plate', ['CALCULATION ENGINE', 'RULES, NOT GUESSES'], 0.62, 0.16, 0.036, loc=(0, -0.405, 0.2), ink=CREAM, paper=NAVY_DEEP)
    return _join(parts, name)


def ram(name='engine_ram'):
    """The press's ram, stroked by the page as each calculation step prints."""
    return geo.box(name, (0.34, 0.28, 0.2), (0, 0, 0), material=geo.pbr('ram_steel', '#b8bfc6', rough=0.3, metal=0.9), bev=0.01, role='dyn')


def binder_shelf(name='binders', w=0.9, d=0.3):
    """A wall shelf of rules binders. The two tax years' binders are 'dyn'
    pieces of their own (the page pulls the year in use forward)."""
    wood = geo.textured('shelf_oak', 'oak_veneer_01', tint='#b99a74', rough=0.6, scale=0.3)
    parts = [geo.box(f'{name}_board', (w, d, 0.03), (0, 0, 1.18), material=wood, bev=0.004),
             geo.box(f'{name}_board2', (w, d, 0.03), (0, 0, 1.62), material=wood, bev=0.004)]
    for sx in (-1, 1):
        parts.append(geo.box(f'{name}_bracket', (0.03, d - 0.04, 0.12), (sx * (w / 2 - 0.08), 0.02, 1.06), material=steel(), bev=0.003))
    cols = ['#2f4a6b', '#6b2f3a', '#3f5a3a', '#6b5a2f']
    for i in range(4):
        x = -w / 2 + 0.52 + i * 0.1
        parts.append(geo.box(f'{name}_b{i}', (0.07, 0.24, 0.3), (x, 0.01, 1.65), material=geo.pbr(f'binder_{cols[i]}', cols[i], rough=0.6), bev=0.003))
    parts += label(f'{name}_title', ['RULES', 'verified 2026-09-19'], 0.36, 0.1, 0.028, loc=(0.2, -d / 2, 1.34), ink=NAVY_DEEP, paper=PAPER)
    return _join(parts, name)


def binder(name, year, color):
    """One tax year's rules binder, its year on the spine (-Y)."""
    parts = [geo.box(f'{name}_body', (0.08, 0.26, 0.32), (0, 0, 0), material=geo.pbr(f'binder_{color}', color, rough=0.55), bev=0.008)]
    parts.append(geo.text(f'{name}_year', year, size=0.028, depth=0, resolution=2, loc=(0, -0.132, 0.16), rot=(90, 0, 90), material=geo.pbr('ink_cream', CREAM, rough=0.5), font_path=_font()))
    parts[-1].rotation_euler = (math.radians(90), 0, math.radians(90))
    parts[-1].location = (0.0, -0.132, 0.16)
    o = _join(parts, name, role='dyn')
    return o


# ---------------------------------------------------------------- the library

def bookcase(name='bookcase', n=20, seed=1, w=1.1, d=0.32, h=1.9, title=('SOURCE',), tint='#2f4a6b'):
    """A bookcase holding exactly `n` spines: one per ingested passage."""
    rnd = C.Rand(seed)
    wood = geo.textured('case_walnut', 'black_walnut_veneer_01', tint='#8a6a52', rough=0.55, scale=0.3)
    parts = [geo.box(f'{name}_back', (w, 0.02, h), (0, d / 2 - 0.01, 0), material=wood, bev=0.004)]
    for sx in (-1, 1):
        parts.append(geo.box(f'{name}_side', (0.025, d, h), (sx * (w / 2 - 0.0125), 0, 0), material=wood, bev=0.004))
    levels = 5
    gap = (h - 0.1) / levels
    for i in range(levels + 1):
        parts.append(geo.box(f'{name}_shelf', (w - 0.05, d - 0.02, 0.022), (0, 0, 0.04 + i * gap), material=wood, bev=0.003))
    # Spines spread over every shelf (as many on each as can be: the counts are
    # the documents' passages), each shelf's run from a bookend at one side.
    shades = [tint, C.mix(tint, '#f2efe8', 0.35), C.mix(tint, '#101318', 0.3), C.mix(tint, '#b89452', 0.3)]
    per = [n // levels + (1 if i < n % levels else 0) for i in range(levels)]
    for lvl, count in enumerate(per):
        z = 0.062 + lvl * gap
        left = (lvl % 2 == 0)
        x = -w / 2 + 0.05 if left else w / 2 - 0.05
        for k in range(count):
            bw = 0.032 + rnd() * 0.022
            bh = min(gap - 0.05, 0.22 + rnd() * 0.1)
            if left and x + bw > w / 2 - 0.05 or not left and x - bw < -w / 2 + 0.05:
                break
            cx = x + bw / 2 if left else x - bw / 2
            col = shades[int(rnd() * len(shades)) % len(shades)]
            parts.append(geo.box(f'{name}_book', (bw, d - 0.08, bh), (cx, 0.01, z), material=geo.pbr(f'book_{col}', col, rough=0.65), bev=0))
            x = x + bw + 0.002 if left else x - bw - 0.002
        if count:
            end_x = x + 0.01 if left else x - 0.01
            parts.append(geo.box(f'{name}_bookend', (0.012, d - 0.12, 0.14), (end_x, 0.01, z), material=steel(), bev=0))
    parts += label(f'{name}_title', list(title), w - 0.1, 0.16, 0.034, loc=(0, -d / 2, h + 0.03), ink=CREAM, paper=NAVY_DEEP)
    return _join(parts, name)


def catalogue(name='catalogue', title=('INDEX',), w=0.52, d=0.45, h=1.12):
    """A card catalogue: a grid of small drawers with brass pulls."""
    wood = geo.textured('cat_oak', 'oak_veneer_01', tint='#b08a62', rough=0.55, scale=0.25)
    parts = [geo.box(f'{name}_body', (w, d, h), (0, 0, 0), material=wood, bev=0.008)]
    cols, rows = 3, 6
    for i in range(cols):
        for j in range(rows):
            x = -w / 2 + (i + 0.5) * w / cols
            z = 0.06 + j * (h - 0.1) / rows
            parts.append(geo.box(f'{name}_dr', (w / cols - 0.02, 0.01, (h - 0.1) / rows - 0.02), (x, -d / 2 - 0.004, z), material=wood, bev=0))
            parts.append(geo.box(f'{name}_pull', (0.05, 0.015, 0.012), (x, -d / 2 - 0.012, z + (h - 0.1) / rows * 0.45), material=geo.pbr('pull_brass', BRASS, rough=0.3, metal=1.0), bev=0))
    parts += label(f'{name}_title', list(title), w - 0.04, 0.12, 0.03, loc=(0, -d / 2 - 0.01, h + 0.03), ink=CREAM, paper=NAVY_DEEP)
    return _join(parts, name)


def table(name='table', w=0.8, d=0.45, h=0.9, top_mat=None):
    """A plain standing-height work table."""
    wood = top_mat or geo.textured('table_oak', 'oak_veneer_01', tint='#c2a27c', rough=0.55, scale=0.3)
    parts = [geo.box(f'{name}_top', (w, d, 0.035), (0, 0, h - 0.035), material=wood, bev=0.006)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(geo.box(f'{name}_leg', (0.035, 0.035, h - 0.035), (sx * (w / 2 - 0.04), sy * (d / 2 - 0.04), 0), material=navy(), bev=0.004))
    return _join(parts, name)


def folders(name='folders', titles=('SYSTEM', 'MEMORY', 'CALC', 'SOURCES')):
    """The context desk's four in-trays, one per block the model reads."""
    parts = []
    cols = ['#2f4a6b', '#3f5a3a', '#6b5a2f', '#6b2f3a']
    for i, t in enumerate(titles):
        x = -0.33 + i * 0.22
        parts.append(geo.box(f'{name}_tray{i}', (0.2, 0.26, 0.05), (x, 0, 0), material=navy(), bev=0.004))
        parts.append(geo.box(f'{name}_file{i}', (0.17, 0.23, 0.015), (x, 0, 0.05), material=geo.pbr(f'folder_{cols[i]}', cols[i], rough=0.6), bev=0.002))
        parts.append(geo.text(f'{name}_t{i}', t, size=0.022, depth=0, resolution=2, loc=(x, -0.132, 0.02), rot=(90, 0, 0), material=geo.pbr('ink_cream', CREAM, rough=0.5), font_path=_font()))
    return _join(parts, name)


# ---------------------------------------------------------------- the local model's booth

def writing_desk(name='writing_desk', w=0.9, d=0.5, h=1.02):
    """The scribe's standing desk: a sloped writing top, a lamp, a paper stack."""
    wood = geo.textured('desk_walnut', 'black_walnut_veneer_01', tint='#7d5e48', rough=0.5, scale=0.3)
    parts = [geo.box(f'{name}_top', (w, d, 0.04), (0, 0, h - 0.04), rot=(-8, 0, 0), material=wood, bev=0.006)]
    for sx in (-1, 1):
        parts.append(geo.box(f'{name}_side', (0.04, d - 0.06, h - 0.06), (sx * (w / 2 - 0.03), 0, 0), material=wood, bev=0.005))
    parts.append(geo.box(f'{name}_paper', (0.3, 0.22, 0.02), (-0.12, -0.02, h + 0.005), rot=(-8, 0, 0), material=geo.pbr('paper_stack', PAPER, rough=0.85), bev=0.002))
    parts.append(geo.cyl(f'{name}_lamp_base', 0.06, 0.02, (0.33, 0.12, h), material=steel(), verts=16, bev=0.003))
    parts.append(geo.tube(f'{name}_lamp_arm', [(0.33, 0.12, h + 0.02), (0.3, 0.1, h + 0.32), (0.18, 0.02, h + 0.38)], 0.008, material=steel()))
    parts.append(geo.cyl(f'{name}_lamp_shade', 0.06, 0.07, (0.18, 0.02, h + 0.33), rot=(20, 0, 0), material=geo.pbr('lamp_shade', EMERALD, rough=0.4, emit='#fff1c8', emit_strength=0.4), verts=16, bev=0.003))
    return _join(parts, name)


# ---------------------------------------------------------------- the safety line

GATE_NAMES = ('SOURCES', 'NUMBERS', 'OUTPUT', 'PRODUCTS', 'CONSISTENCY')


def gate(name='gate', title='NUMBERS', span=0.62, h=1.28):
    """A gate arch across the belt (local X across, Y along the belt): two
    posts, a crossbeam with the check's name, and a stamp head the arm hangs from."""
    frame = navy()
    parts = []
    for sx in (-1, 1):
        parts.append(geo.box(f'{name}_post', (0.05, 0.07, h), (sx * span / 2, 0, 0), material=frame, bev=0.006))
    parts.append(geo.box(f'{name}_beam', (span + 0.05, 0.08, 0.1), (0, 0, h), material=frame, bev=0.008))
    parts.append(geo.box(f'{name}_head', (0.14, 0.12, 0.1), (0, 0, h - 0.1), material=steel(), bev=0.006))
    parts += label(f'{name}_title', [title], span - 0.02, 0.07, 0.03, loc=(0, -0.045, h + 0.01), ink=GLOW, paper=NAVY_DEEP, glow=GLOW)
    return _join(parts, name)


def stamp_arm(name='gate_arm'):
    """The gate's stamp: a plunger the page drops onto each tray it passes."""
    parts = [geo.box(f'{name}_rod', (0.02, 0.02, 0.2), (0, 0, 0.06), material=steel(), bev=0.003),
             geo.box(f'{name}_foot', (0.12, 0.09, 0.05), (0, 0, 0.01), material=geo.pbr('stamp_rubber', EMERALD, rough=0.5), bev=0.006)]
    return _join(parts, name, role='dyn')


def dial_face(name='trust_dial', r=0.16):
    """The trust score's dial face, a disc the page paints (0 to 100)."""
    return geo.cyl(name, r, 0.01, (0, 0, 0), rot=(90, 0, 0), material=geo.pbr('dial_screen', '#0a192f', rough=1.0, spec=0.0, emit='#0a192f', emit_strength=0.5), verts=40, bev=0, role='dyn')


# ---------------------------------------------------------------- the counter

def counter(name='counter', w=1.6, d=0.5, h=1.02, windows=('EN', 'HI', 'TE', 'TA')):
    """The answer counter: a navy front, an oak top, low glass fins between
    its windows, each window's language on a plate facing the visitor (-Y)."""
    top = geo.textured('counter_oak', 'oak_veneer_01', tint='#c2a27c', rough=0.5, scale=0.3)
    parts = [geo.box(f'{name}_body', (w, d - 0.05, h - 0.04), (0, 0.02, 0), material=navy(), bev=0.01),
             geo.box(f'{name}_top', (w + 0.04, d, 0.04), (0, 0, h - 0.04), material=top, bev=0.006),
             geo.box(f'{name}_stripe', (w, 0.006, 0.04), (0, -d / 2 + 0.02, h - 0.2), material=geo.pbr('counter_stripe', EMERALD, rough=0.4), bev=0)]
    n = len(windows)
    for i, t in enumerate(windows):
        x = -w / 2 + (i + 0.5) * w / n
        parts += label(f'{name}_w{i}', [t], 0.16, 0.08, 0.04, loc=(x, -d / 2 + 0.02, h - 0.6), ink=CREAM, paper=NAVY_DEEP)
    return _join(parts, name)


def fins(name='counter_fins', w=1.6, h=1.02, n=4):
    """The glass fins between the counter's windows (lit live)."""
    out = []
    for i in range(1, n):
        x = -w / 2 + i * w / n
        out.append(geo.box(f'{name}_{i}', (0.012, 0.36, 0.34), (x, 0, h), material=geo.pbr('fin_glass', '#b9d3dc', rough=0.04, alpha=0.2), bev=0, role='prop'))
    return out


# ---------------------------------------------------------------- the lounge

def planning_table(name='planning_table', w=2.0, d=1.1, h=0.9):
    """A lit planning table: a navy frame and a glass top the page paints
    (the Monte Carlo fan). The top is a separate 'dyn' named `{name}_screen`."""
    frame = navy()
    parts = [geo.box(f'{name}_rim', (w, d, 0.07), (0, 0, h - 0.07), material=frame, bev=0.012),
             geo.box(f'{name}_plinth', (w - 0.5, d - 0.4, h - 0.07), (0, 0, 0), material=frame, bev=0.02),
             geo.box(f'{name}_kick', (w - 0.42, d - 0.32, 0.06), (0, 0, 0), material=geo.pbr('kick_emerald', EMERALD, rough=0.4, emit=GLOW, emit_strength=0.3), bev=0.006)]
    body = _join(parts, name)
    screen = geo.box(f'{name}_screen', (w - 0.1, d - 0.1, 0.006), (0, 0, h), material=geo.pbr('table_screen', '#0a192f', rough=1.0, spec=0.0, emit='#0a192f', emit_strength=0.5), bev=0, role='dyn')
    return body, screen


# ---------------------------------------------------------------- the edge of the machine

def post_box(name='post_box'):
    """A pillar box outside the door, its plate saying nothing is sent."""
    red = geo.pbr('pillar_red', '#b3261e', rough=0.45)
    parts = [geo.cyl(f'{name}_body', 0.2, 1.05, (0, 0, 0), material=red, verts=32, bev=0.01),
             geo.sphere(f'{name}_cap', 0.21, (0, 0, 1.05), scale=(1, 1, 0.45), material=red, seg=24),
             geo.box(f'{name}_slot', (0.2, 0.03, 0.03), (0, -0.19, 0.84), material=geo.pbr('slot_black', '#15161a', rough=0.5), bev=0.004)]
    parts += label(f'{name}_plate', ['NOTHING', 'SENT'], 0.2, 0.12, 0.032, loc=(0, -0.2, 0.55), ink='#15161a', paper=CREAM)
    return _join(parts, name)


def router(name='router'):
    """The house's internet box on the wall, cable out to the street. The
    plug is a separate 'dyn' piece (the page can pull it)."""
    parts = [geo.box(f'{name}_box', (0.26, 0.07, 0.18), (0, 0, 0), material=geo.pbr('router_white', CREAM, rough=0.4), bev=0.01)]
    for i in range(4):
        parts.append(geo.box(f'{name}_led{i}', (0.012, 0.004, 0.012), (-0.08 + i * 0.05, -0.037, 0.05), material=geo.pbr('led_green', GLOW, rough=0.3, emit=GLOW, emit_strength=4.0), bev=0))
    return _join(parts, name, role='prop')


def plug(name='router_plug'):
    return geo.box(name, (0.05, 0.04, 0.03), (0, 0, 0), material=geo.pbr('plug_grey', '#3a3d44', rough=0.5), bev=0.004, role='dyn')


def pendant(name='pendant', drop=0.9, top=2.6):
    """A hanging lamp over a station: a cord and an emerald shade."""
    parts = [geo.cyl(f'{name}_cord', 0.005, drop, (0, 0, top - drop), material=geo.pbr('cord', '#15161a', rough=0.6), verts=8, bev=0),
             geo.cyl(f'{name}_shade', 0.16, 0.14, (0, 0, top - drop - 0.14), material=geo.pbr('shade_navy', NAVY, rough=0.4, metal=0.3), verts=24, bev=0.004),
             geo.cyl(f'{name}_bulb', 0.13, 0.01, (0, 0, top - drop - 0.145), material=geo.pbr('bulb', '#fff1d6', emit='#fff1d6', emit_strength=6.0), verts=24, bev=0)]
    return _join(parts, name)


def water_cooler(name='water_cooler'):
    parts = [geo.box(f'{name}_body', (0.32, 0.32, 0.95), (0, 0, 0), material=geo.pbr('cooler_white', CREAM, rough=0.4), bev=0.02),
             geo.cyl(f'{name}_bottle', 0.14, 0.4, (0, 0, 0.95), material=geo.pbr('cooler_bottle', '#9cc9e0', rough=0.05, alpha=0.5), verts=24, bev=0.02)]
    return _join(parts, name)
