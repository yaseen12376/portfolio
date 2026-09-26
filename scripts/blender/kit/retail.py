"""
The retail kit: a boutique's fixtures at architectural-model density. Each
builder returns ONE joined object, origin at its footprint centre on the floor
(z = 0), facing -Y (its front), like kit/props.py, so a scene can place it or
instance it.

Materials are CC0 photo textures (geo.textured) where the surface has grain a
camera would see (oak, marble, denim, linen), flat palette colours where it
would not (painted steel, plastic). Photo textures only survive on the baked
set (they are baked into its atlas): anything lit live on the page (role
'prop' or 'dyn', e.g. shirts on a rail people drag) uses flat colours.
"""

from __future__ import annotations

import math

import common as C
from kit import geo, props

OAK = '#b08a62'
WALNUT = '#5b4330'
STEEL = '#1f2024'
BRASS = '#b89452'
LINEN = '#e8e1d4'


def oak(name='oak', scale=0.35):
    return geo.textured(name, 'oak_veneer_01', tint=OAK, rough=0.48, scale=scale)


def walnut(name='walnut', scale=0.35):
    return geo.textured(name, 'black_walnut_veneer_01', tint=WALNUT, rough=0.45, scale=scale)


def steel(name='steel_black'):
    return geo.pbr(name, STEEL, rough=0.42, metal=0.6)


def _join(parts, name, role='set', **extras):
    return geo.parts_to(parts, name, role=role, **extras)


# ---------------------------------------------------------------- garments

JEANS = ['#3b4a63', '#2c3548', '#4c5d78', '#232a38', '#5a6b86']
TEES = ['#e9e4da', '#c9b79c', '#a35d4f', '#6f7f94', '#3f4b3a', '#d8b4a0', '#8a8f7a']


def folded_jeans(name='jeans', color='#3b4a63', loc=(0, 0, 0), rot=0.0):
    """A pair of jeans folded in three, in real denim, part of the baked set."""
    denim = geo.textured(f'denim_{color}', 'denim_fabric_04', tint=color, rough=0.95, scale=0.5)
    slab = geo.box(f'{name}_slab', (0.3, 0.22, 0.042), loc, rot=(0, 0, rot), material=denim, bev=0.015)
    return slab


def folded_tee(name='tee', color='#e9e4da', loc=(0, 0, 0), rot=0.0):
    """A folded tee in jersey, part of the baked set."""
    cloth = geo.textured(f'jersey_{color}', 'cotton_jersey', tint=color, rough=0.95, scale=0.4)
    return geo.box(f'{name}_fold', (0.28, 0.22, 0.028), loc, rot=(0, 0, rot), material=cloth, bev=0.011)


def shirt(name='shirt', color='#e9e4da', long=False):
    """A shirt on a hanger, lit live (it hangs on a rail people move): flat
    colour, softly bevelled silhouette with thickness, and a wire hanger.
    Origin at the hanger hook's top."""
    poly = [(x * 0.62, y * (0.62 if not long else 0.72)) for x, y in props.TEE]
    body = geo.extrude(f'{name}_cloth', poly, 0.028, 0, material=geo.pbr(f'cloth_{color}', color, rough=0.92), bev=0.009)
    body.rotation_euler = (math.radians(90), 0, 0)
    C.apply_transform(body)
    top = max(v.co.z for v in body.data.vertices)
    body.location = (0, 0.014, -top - 0.03)
    C.apply_transform(body, loc=True)
    wire = geo.mat('chrome', rough=0.2)
    hook = geo.tube(f'{name}_hook', [(0, 0, -0.03), (0, 0, 0.0), (0.02, 0, 0.018), (0.035, 0, 0.0)], 0.0035, material=wire)
    bar = geo.tube(f'{name}_bar', [(-0.17, 0, -0.08), (0, 0, -0.03), (0.17, 0, -0.08)], 0.0045, material=wire)
    return _join([body, hook, bar], name, role='prop')


# ---------------------------------------------------------------- fixtures

def rail(name='rail', w=1.3, h=1.4):
    """A black steel garment rail on castered T-feet (dyn: people drag it)."""
    r = props.rail(name, w=w, h=h)
    r.data.materials.clear()
    r.data.materials.append(steel(f'{name}_steel'))
    return geo.tag(r, 'dyn')


def display_table(name='table', w=1.25, d=0.7, h=0.72):
    """A nesting display table: oak top on a black steel frame, a lower shelf."""
    parts = [geo.box(f'{name}_top', (w, d, 0.05), (0, 0, h - 0.05), material=oak(f'{name}_oak'), bev=0.012),
             geo.box(f'{name}_shelf', (w - 0.12, d - 0.12, 0.03), (0, 0, 0.18), material=oak(f'{name}_oak'), bev=0.008)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(geo.box(f'{name}_leg', (0.04, 0.04, h - 0.05), (sx * (w / 2 - 0.05), sy * (d / 2 - 0.05), 0), material=steel(), bev=0.006))
    return _join(parts, name)


def denim_wall(name='denim_wall', w=1.6, h=2.1, cols=4, rows=5, d=0.36):
    """Oak cubbies on the back wall, each full of folded jeans (placed by the
    scene), with a lit header."""
    wood = oak(f'{name}_oak', 0.5)
    parts = [geo.box(f'{name}_back', (w, 0.03, h), (0, d / 2 - 0.015, 0), material=wood, bev=0.004)]
    for c in range(cols + 1):
        x = -w / 2 + c * w / cols
        parts.append(geo.box(f'{name}_v', (0.03, d, h), (x, 0, 0), material=wood, bev=0.004))
    for r in range(rows + 1):
        z = r * (h - 0.03) / rows
        parts.append(geo.box(f'{name}_h', (w + 0.03, d, 0.03), (0, 0, z), material=wood, bev=0.004))
    parts.append(geo.box(f'{name}_header', (w + 0.06, 0.05, 0.12), (0, -d / 2 + 0.02, h + 0.02), material=steel(), bev=0.01))
    parts.append(geo.box(f'{name}_led', (w - 0.1, 0.01, 0.02), (0, -d / 2 - 0.006, h + 0.02),
                         material=geo.pbr('led_warm', '#fff3dc', emit='#ffe9c4', emit_strength=6), bev=0))
    return _join(parts, name)


def mannequin(name='mannequin', pose=0.0, top='#a35d4f', bottom='#2d3340'):
    """A headless dress form on a walnut tripod, wearing a top: clearly a
    fixture, never mistaken for a shopper."""
    wood = walnut(f'{name}_walnut', 0.3)
    brass = geo.mat('brass', rough=0.3, metal=1.0)
    parts = []
    for i in range(3):
        a = math.radians(90 + i * 120 + pose * 20)
        parts.append(geo.tube(f'{name}_leg{i}', [(0.2 * math.cos(a), 0.2 * math.sin(a), 0.0), (0.0, 0.0, 0.62)], 0.014, material=wood))
    parts.append(geo.tube(f'{name}_pole', [(0, 0, 0.6), (0, 0, 0.9)], 0.012, material=brass))
    form = geo.sphere(f'{name}_form', 0.2, (0, 0, 1.12), (0.92, 0.6, 1.3), material=geo.textured(f'mtop_{top}', 'rough_linen', tint=top, rough=0.9, scale=0.3), seg=28)
    hips = geo.sphere(f'{name}_hips', 0.16, (0, 0, 0.9), (1.05, 0.68, 0.55), material=geo.textured(f'mbot_{bottom}', 'denim_fabric_04', tint=bottom, rough=0.9, scale=0.4), seg=24)
    neck = geo.cyl(f'{name}_neck', 0.045, 0.1, (0, 0, 1.36), material=geo.pbr('form_linen', '#e8e1d4', rough=0.8), verts=16, bev=0.01)
    knob = geo.sphere(f'{name}_knob', 0.03, (0, 0, 1.48), material=brass, seg=12)
    return _join(parts + [form, hips, neck, knob], name)


def neon(name, text, size=0.18, color='#ffd6a8', font=None):
    """A warm neon wordmark for a wall: glowing letters on a smoked acrylic
    backing, lit for real in the bake (it lights the wall around it)."""
    import os
    font = font or os.path.join(C.FONTS, 'geist-mono-latin-wght-normal.woff2')
    letters = geo.text(f'{name}_text', text, size=size, depth=0.012, loc=(0, -0.03, size * 0.6), rot=(90, 0, 0),
                       material=geo.pbr('neon', '#fff1dc', emit=color, emit_strength=9), font_path=font if os.path.exists(font) else None)
    w = size * 0.62 * len(text) + 0.14
    backing = geo.box(f'{name}_back', (w, 0.012, size * 1.5), (0, -0.008, 0), material=geo.pbr('acrylic', '#1b1b1f', rough=0.2), bev=0.006)
    return _join([letters, backing], name)


def frame(name, w=0.6, h=0.8, art=('#c8553d', '#e9e4da', '#3f4b3a')):
    """A framed print: an oak frame around a simple abstract of the palette."""
    parts = [geo.box(f'{name}_frame', (w, 0.03, h), (0, 0, 0), material=oak(f'{name}_oak', 0.3), bev=0.006),
             geo.box(f'{name}_paper', (w - 0.08, 0.004, h - 0.08), (0, -0.016, 0.04), material=geo.pbr('paper', '#f2eee6', rough=0.9), bev=0)]
    parts.append(geo.cyl(f'{name}_sun', (w - 0.2) / 2, 0.004, (0, -0.02, h * 0.55), rot=(90, 0, 0), material=geo.pbr(f'art_{art[0]}', art[0], rough=0.9), verts=32, bev=0))
    parts.append(geo.box(f'{name}_band', (w - 0.08, 0.005, h * 0.22), (0, -0.021, 0.04), material=geo.pbr(f'art_{art[2]}', art[2], rough=0.9), bev=0))
    return _join(parts, name)


def clock(name='clock', r=0.16):
    face = geo.cyl(f'{name}_face', r, 0.03, (0, 0, 0), rot=(90, 0, 0), material=geo.pbr('clock_face', '#f2eee6', rough=0.6), verts=40, bev=0.008)
    rim = geo.tube(f'{name}_rim', [(r * math.cos(t), -0.02, r * math.sin(t)) for t in [i * math.pi / 20 for i in range(41)]], 0.012, material=steel())
    hands = [geo.box(f'{name}_h', (0.012, 0.006, r * 0.6), (0, -0.034, 0), rot=(0, 30, 0), material=steel(), bev=0),
             geo.box(f'{name}_m', (0.008, 0.006, r * 0.85), (0, -0.036, 0), rot=(0, -110, 0), material=steel(), bev=0)]
    return _join([face, rim] + hands, name)


def fitting_room(name='fitting', w=0.8, d=0.9, h=1.95, curtain='#6b5a4c'):
    """One cubicle: two side panels (oak-faced), a rail, a half-drawn linen
    curtain in soft folds, a stool, a hook with a shirt. Open to the front."""
    wood = oak(f'{name}_oak', 0.5)
    parts = []
    for sx in (-1, 1):
        parts.append(geo.box(f'{name}_side', (0.04, d, h), (sx * w / 2, 0, 0.05), material=wood, bev=0.006))
    parts.append(geo.box(f'{name}_back', (w + 0.04, 0.04, h), (0, d / 2, 0.05), material=wood, bev=0.006))
    parts.append(geo.tube(f'{name}_rod', [(-w / 2, -d / 2 + 0.03, h - 0.05), (w / 2, -d / 2 + 0.03, h - 0.05)], 0.008, material=geo.mat('chrome', rough=0.2)))
    # Curtain: a wavy strip drawn to one side.
    pts = []
    cw = w * 0.45
    for i in range(25):
        t = i / 24
        pts.append((w / 2 - cw + t * cw, -d / 2 + 0.03 + 0.03 * math.sin(t * math.pi * 8)))
    cur = geo.extrude(f'{name}_curtain', pts + [(p[0], p[1] + 0.012) for p in reversed(pts)], h - 0.12, 0.08,
                      material=geo.textured(f'curtain_{curtain}', 'rough_linen', tint=curtain, rough=0.95, scale=0.3), bev=0, caps='none')
    parts.append(cur)
    parts.append(geo.cyl(f'{name}_stool', 0.14, 0.42, (w / 2 - 0.2, d / 2 - 0.22, 0), material=geo.textured('boucle', 'wool_boucle', tint='#cfc3b4', rough=0.95, scale=0.3), verts=24, bev=0.02))
    parts.append(geo.box(f'{name}_mirror', (0.5, 0.012, 1.1), (0, d / 2 - 0.03, 0.55), material=geo.pbr('mirror_s', '#a8b6bd', rough=0.08, metal=1.0), bev=0.002))
    return _join(parts, name)


def cash_wrap(name='cash_wrap', w=1.5, d=0.62, h=0.95):
    """The till: an oak-fronted counter with a marble top, a bag shelf, a
    POS screen, a card terminal and a receipt printer. The customer side is
    its front (-Y)."""
    wood = walnut(f'{name}_walnut', 0.4)
    marble = geo.textured('marble_top', 'marble_01', tint='#ece8e2', rough=0.25, scale=0.8)
    parts = [geo.box(f'{name}_body', (w, d, h - 0.04), (0, 0, 0), material=wood, bev=0.012),
             geo.box(f'{name}_top', (w + 0.06, d + 0.06, 0.04), (0, 0, h - 0.04), material=marble, bev=0.008)]
    # Fluted front: vertical oak ribs.
    for i in range(18):
        x = -w / 2 + 0.06 + i * (w - 0.12) / 17
        parts.append(geo.cyl(f'{name}_flute', 0.018, h - 0.14, (x, -d / 2 - 0.004, 0.06), material=oak(f'{name}_flute_oak'), verts=10, bev=0))
    # POS: a screen on a stand, facing the cashier (+Y side), glowing.
    stand = geo.box(f'{name}_pos_stand', (0.06, 0.06, 0.14), (0.25, 0.08, h), material=steel(), bev=0.01)
    screen = geo.box(f'{name}_pos', (0.34, 0.03, 0.24), (0.25, 0.09, h + 0.12), rot=(-14, 0, 0), material=steel(), bev=0.01)
    glass = geo.box(f'{name}_pos_glass', (0.31, 0.004, 0.21), (0.25, 0.108, h + 0.135), rot=(-14, 0, 0),
                    material=geo.pbr('pos_screen', '#0e1420', emit='#9fb7ff', emit_strength=1.6), bev=0)
    term = geo.box(f'{name}_terminal', (0.08, 0.13, 0.05), (-0.25, -0.14, h), rot=(12, 0, 0), material=geo.pbr('terminal', '#232428', rough=0.5), bev=0.01)
    keys = geo.box(f'{name}_terminal_screen', (0.06, 0.05, 0.004), (-0.25, -0.15, h + 0.05), rot=(12, 0, 0),
                   material=geo.pbr('term_screen', '#0b0f12', emit='#79f2c9', emit_strength=1.2), bev=0)
    printer = geo.box(f'{name}_printer', (0.14, 0.16, 0.1), (0.62, 0.1, h), material=geo.pbr('printer', '#e7e5e1', rough=0.5), bev=0.012)
    bags = [geo.box(f'{name}_bag', (0.28, 0.1, 0.34), (-0.55 + i * 0.04, 0.16, 0.08), rot=(0, 0, 4 * i),
                    material=geo.pbr('bag_paper', '#c8a27a', rough=0.85), bev=0.004) for i in range(3)]
    return _join(parts + [stand, screen, glass, term, keys, printer] + bags, name)


def stanchion(name='stanchion', h=0.9):
    """A brass queue post (instanced: flat colours, lit live)."""
    base = geo.cyl(f'{name}_base', 0.12, 0.02, (0, 0, 0), material=steel(), verts=24, bev=0.006)
    post = geo.cyl(f'{name}_post', 0.022, h, (0, 0, 0.02), material=geo.mat('brass', rough=0.3, metal=1.0), verts=16, bev=0.004)
    cap = geo.sphere(f'{name}_cap', 0.03, (0, 0, h + 0.03), material=geo.mat('brass', rough=0.3, metal=1.0), seg=14)
    return _join([base, post, cap], name, role='prop')


def rope(name, a, b, h=0.82, sag=0.08, color='#5a2330'):
    """A velvet queue rope between two posts, hanging in a catenary-ish curve."""
    pts = []
    for i in range(13):
        t = i / 12
        z = h - sag * 4 * t * (1 - t)
        pts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z))
    return geo.tube(name, pts, 0.014, material=geo.pbr('velvet', color, rough=0.9))


def shelving(name='shelving', w=1.1, d=0.45, h=1.9, levels=4):
    """Stockroom racking: grey steel uprights and plywood shelves."""
    grey = geo.pbr('rack_grey', '#6f7378', rough=0.5, metal=0.5)
    ply = geo.textured('ply', 'oak_veneer_01', tint='#c9ab82', rough=0.7, scale=0.3)
    parts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(geo.box(f'{name}_up', (0.035, 0.035, h), (sx * (w / 2 - 0.02), sy * (d / 2 - 0.02), 0), material=grey, bev=0.004))
    for i in range(levels):
        z = 0.1 + i * (h - 0.15) / (levels - 1)
        parts.append(geo.box(f'{name}_shelf', (w, d, 0.025), (0, 0, z), material=ply, bev=0.004))
    return _join(parts, name)


def carton(name='carton', s=(0.34, 0.26, 0.22)):
    """A stock carton (instanced: flat colours, lit live)."""
    card = geo.pbr('cardboard', '#b58a5c', rough=0.85)
    body = geo.box(f'{name}_box', s, (0, 0, 0), material=card, bev=0.006)
    tape = geo.box(f'{name}_tape', (s[0] + 0.004, 0.05, 0.004), (0, 0, s[2] - 0.001), material=geo.pbr('tape', '#d9c9a8', rough=0.6), bev=0)
    return _join([body, tape], name, role='prop')


def desk(name='desk', w=1.0, d=0.55, h=0.74):
    """The back-office desk, stood at: a monitor (the page draws the live
    dashboard on its screen) and a keyboard."""
    parts = [geo.box(f'{name}_top', (w, d, 0.035), (0, 0, h - 0.035), material=walnut(f'{name}_walnut'), bev=0.008)]
    for sx in (-1, 1):
        parts.append(geo.box(f'{name}_panel', (0.03, d - 0.04, h - 0.035), (sx * (w / 2 - 0.03), 0, 0), material=steel(), bev=0.004))
    parts.append(geo.box(f'{name}_stand', (0.12, 0.1, 0.02), (0, 0.08, h), material=steel(), bev=0.004))
    parts.append(geo.box(f'{name}_neck', (0.03, 0.03, 0.2), (0, 0.1, h + 0.02), material=steel(), bev=0.004))
    parts.append(geo.box(f'{name}_monitor', (0.62, 0.035, 0.38), (0, 0.08, h + 0.14), material=steel(), bev=0.01))
    parts.append(geo.box(f'{name}_keyboard', (0.36, 0.12, 0.018), (0, -0.1, h), material=geo.pbr('kbd', '#2a2b30', rough=0.6), bev=0.004))
    return _join(parts, name)


def monitor_screen(name='screen', w=0.58, h=0.34):
    """The monitor's glass, a separate 'dyn' plane the page paints live."""
    return geo.box(name, (w, 0.004, h), (0, 0, 0), material=geo.pbr('dash_screen', '#0b0d12', emit='#1b1f2a', emit_strength=1.0), bev=0, role='dyn')


# ---------------------------------------------------------------- the street

def bench(name='bench', w=1.1):
    wood = oak(f'{name}_slat', 0.4)
    parts = [geo.box(f'{name}_slat', (w, 0.07, 0.03), (0, -0.12 + i * 0.08, 0.42), material=wood, bev=0.006) for i in range(4)]
    parts += [geo.box(f'{name}_back', (w, 0.03, 0.07), (0, 0.18, 0.5 + i * 0.1), material=wood, bev=0.006) for i in range(3)]
    for sx in (-1, 1):
        parts.append(geo.box(f'{name}_frame', (0.05, 0.4, 0.42), (sx * (w / 2 - 0.1), 0, 0), material=steel(), bev=0.008))
    return _join(parts, name)


def lamp_post(name='lamp', h=2.6):
    pole = geo.cyl(f'{name}_pole', 0.035, h, (0, 0, 0), material=steel(), verts=16, bev=0.004)
    base = geo.cyl(f'{name}_base', 0.08, 0.2, (0, 0, 0), material=steel(), verts=16, bev=0.01)
    arm = geo.tube(f'{name}_arm', [(0, 0, h - 0.05), (0, -0.28, h + 0.05)], 0.02, material=steel())
    head = geo.box(f'{name}_head', (0.12, 0.3, 0.06), (0, -0.35, h), material=steel(), bev=0.01)
    glow = geo.box(f'{name}_glow', (0.1, 0.26, 0.01), (0, -0.35, h - 0.012), material=geo.pbr('lamp_led', '#fff6e6', emit='#ffe2b0', emit_strength=10), bev=0)
    return _join([pole, base, arm, head, glow], name, see_through=True)  # a pole hides nobody from a camera


def planter(name='planter', w=0.9, d=0.4, h=0.45):
    box = geo.box(f'{name}_box', (w, d, h), (0, 0, 0), material=geo.textured('planter_conc', 'smooth_concrete_floor', tint='#a19d96', rough=0.85, scale=1.0), bev=0.02)
    soil = geo.box(f'{name}_soil', (w - 0.08, d - 0.08, 0.02), (0, 0, h - 0.04), material=geo.mat('soil', rough=1.0), bev=0)
    return _join([box, soil], name)


def sign(name, text, w=1.8, h=0.28, font=None):
    """The shop's name over the door: black steel fascia, brass letters."""
    import os
    fascia = geo.box(f'{name}_fascia', (w, 0.06, h), (0, 0, 0), material=steel(), bev=0.01)
    font = font or os.path.join(C.FONTS, 'geist-mono-latin-wght-normal.woff2')
    letters = geo.text(f'{name}_text', text, size=h * 0.46, depth=0.008, loc=(0, -0.034, h / 2), rot=(90, 0, 0),
                       material=geo.pbr('sign_brass', BRASS, rough=0.3, metal=1.0, emit='#ffd9a0', emit_strength=0.6),
                       font_path=font if os.path.exists(font) else None)
    return _join([fascia, letters], name)


# ---------------------------------------------------------------- the v2 store: pieces that move on the page

GLASS = '#b9d3dc'


def sliding_door(name='door', w=1.6, h=2.2):
    """Automatic double doors: two glass leaves in slim steel frames, each a
    separate 'dyn' piece (passable: the nav grid ignores them) that the page
    slides apart along its local X as someone comes near. Returns the two
    leaves, origins at each leaf's bottom centre, closed position."""
    leaves = []
    lw = w / 2 + 0.03  # the leaves overlap a little where they meet
    for side, sx in (('l', -1), ('r', 1)):
        glass = geo.box(f'{name}_{side}_glass', (lw - 0.06, 0.012, h - 0.08), (0, 0, 0.04), material=geo.pbr('door_glass', GLASS, rough=0.05, alpha=0.22), bev=0)
        rails = [geo.box(f'{name}_{side}_top', (lw, 0.04, 0.05), (0, 0, h - 0.05), material=steel(), bev=0.004),
                 geo.box(f'{name}_{side}_bot', (lw, 0.04, 0.06), (0, 0, 0), material=steel(), bev=0.004),
                 geo.box(f'{name}_{side}_stile', (0.04, 0.04, h), (-sx * (lw / 2 - 0.02), 0, 0), material=steel(), bev=0.004),
                 geo.box(f'{name}_{side}_edge', (0.03, 0.045, h), (sx * (lw / 2 - 0.015), 0, 0), material=steel(), bev=0.004),
                 geo.box(f'{name}_{side}_bar', (0.02, 0.03, 0.5), (sx * (lw / 2 - 0.1), -0.04, 0.8), material=geo.mat('steel', rough=0.3), bev=0.004)]
        leaf = geo.parts_to([glass] + rails, f'{name}_{side}', role='dyn', passable=True)
        leaf.location = (-sx * (w / 4 - 0.015) * -1, 0, 0)
        leaves.append(leaf)
    return leaves


def booth(name='booth', w=1.0, d=1.1, h=2.05, curtain='#6b5a4c'):
    """A fitting booth, open to the front (-Y): oak side and back panels, a
    head rail, a stool, a mirror and a hook. Its curtain is a separate 'dyn'
    piece (passable) the page draws shut when someone is inside (scale X from
    its left end: 0.25 gathered open, 1 closed). Returns (booth, curtain)."""
    wood = oak(f'{name}_oak', 0.5)
    parts = []
    for sx in (-1, 1):
        parts.append(geo.box(f'{name}_side', (0.045, d, h), (sx * w / 2, 0, 0.05), material=wood, bev=0.006))
    parts.append(geo.box(f'{name}_back', (w + 0.045, 0.045, h), (0, d / 2, 0.05), material=wood, bev=0.006))
    parts.append(geo.box(f'{name}_head', (w + 0.045, 0.06, 0.12), (0, -d / 2 + 0.03, h - 0.07), material=wood, bev=0.006))
    parts.append(geo.cyl(f'{name}_stool', 0.14, 0.42, (w / 2 - 0.22, d / 2 - 0.25, 0), material=geo.textured('boucle', 'wool_boucle', tint='#cfc3b4', rough=0.95, scale=0.3), verts=24, bev=0.02))
    parts.append(geo.box(f'{name}_mirror', (0.5, 0.012, 1.15), (-0.1, d / 2 - 0.035, 0.55), material=geo.pbr('mirror_s', '#a8b6bd', rough=0.08, metal=1.0), bev=0.002))
    parts.append(geo.cyl(f'{name}_hook', 0.012, 0.06, (w / 2 - 0.05, d / 2 - 0.3, 1.7), rot=(0, 90, 0), material=geo.mat('brass', rough=0.3, metal=1.0), verts=10, bev=0))
    b = geo.parts_to(parts, name)
    # The curtain: gathered linen from the head rail, built full width from its
    # left end (its origin), so scaling X gathers it to that side.
    pts = [(t / 48 * w, 0.035 * math.sin(t / 48 * math.pi * 14)) for t in range(49)]
    poly = pts + [(p[0], p[1] + 0.014) for p in reversed(pts)]
    cur = geo.extrude(f'{name}_curtain', poly, h - 0.16, 0.06, material=geo.pbr(f'curtain_{curtain}', curtain, rough=0.95), bev=0, caps='none', role='dyn', passable=True)
    return b, cur


def roller_shutter(name='shutter', w=1.6, h=2.2):
    """A steel roller shutter for an opening: a housing over it (set) and the
    slatted curtain as a 'dyn' piece (passable) hanging down from its origin
    at the housing, which the page rolls down at closing (scale Z from 0.03,
    rolled up, to 1, down). Returns (housing, curtain)."""
    grey = geo.pbr('shutter_grey', '#8c9096', rough=0.45, metal=0.7)
    # Above head height (the nav grid treats anything below 1.5 m as a wall).
    housing = geo.box(f'{name}_housing', (w + 0.1, 0.16, 0.18), (0, -0.02, max(h, 1.56)), material=steel(), bev=0.01)
    slats = [geo.box(f'{name}_slat', (w, 0.02, 0.07), (0, -0.09, -(i + 1) * 0.075), material=grey, bev=0.006) for i in range(int(h / 0.075))]
    s = geo.parts_to(slats, f'{name}_curtain', role='dyn', passable=True)
    return housing, s


def badge_reader(name='badge_reader'):
    """A staff badge reader for a wall: a dark unit with a lit ring."""
    body = geo.box(f'{name}_body', (0.09, 0.03, 0.14), (0, 0, 0), material=geo.pbr('reader', '#1c1d21', rough=0.4), bev=0.008)
    ring = geo.cyl(f'{name}_ring', 0.028, 0.004, (0, -0.017, 0.085), rot=(90, 0, 0), material=geo.pbr('reader_led', '#0b0f12', emit='#8b5cf6', emit_strength=5), verts=24, bev=0)
    return geo.parts_to([body, ring], name)


def lockers(name='lockers', n=4, w=0.4, d=0.45, h=1.8):
    """Staff lockers: a row of steel doors with vents and handles."""
    body = geo.pbr('locker', '#8b979c', rough=0.45)
    parts = [geo.box(f'{name}_body', (n * w, d, h), (0, 0, 0), material=body, bev=0.006)]
    for i in range(n):
        x = -n * w / 2 + (i + 0.5) * w
        parts.append(geo.box(f'{name}_door', (w - 0.02, 0.01, h - 0.08), (x, -d / 2 - 0.004, 0.04), material=body, bev=0.004))
        for k in range(4):
            parts.append(geo.box(f'{name}_vent', (w * 0.5, 0.012, 0.012), (x, -d / 2 - 0.008, h - 0.28 - k * 0.04), material=geo.pbr('vent', '#2a2e33', rough=0.5), bev=0))
        parts.append(geo.box(f'{name}_handle', (0.02, 0.02, 0.1), (x + w / 2 - 0.07, -d / 2 - 0.014, h * 0.52), material=geo.pbr('handle', '#c9ccd1', rough=0.3), bev=0.003))
    return geo.parts_to(parts, name)


def glass_wall(name, w, h=1.45, door=None, panes=4):
    """An office front: a steel frame with glazing and (optionally) a door gap
    `door` = (x0, x1) along its width. Returns (frame, [panes]); the panes are
    lit live (glass), the frame is baked."""
    fr = []
    xs = [-w / 2 + i * w / panes for i in range(panes + 1)]
    for x in xs:
        if door and door[0] - 0.01 < x < door[1] + 0.01:
            continue
        fr.append(geo.box(f'{name}_post', (0.05, 0.06, h), (x, 0, 0), material=steel(), bev=0.004))
    for x0, x1 in ([(-w / 2, door[0]), (door[1], w / 2)] if door else [(-w / 2, w / 2)]):
        fr.append(geo.box(f'{name}_sill', (x1 - x0, 0.07, 0.08), ((x0 + x1) / 2, 0, 0), material=steel(), bev=0.004))
        fr.append(geo.box(f'{name}_head', (x1 - x0, 0.07, 0.05), ((x0 + x1) / 2, 0, h - 0.05), material=steel(), bev=0.004))
    if door:
        for x in door:
            fr.append(geo.box(f'{name}_jamb', (0.05, 0.08, h + 0.3), (x, 0, 0), material=steel(), bev=0.004))
        fr.append(geo.box(f'{name}_lintel', (door[1] - door[0] + 0.05, 0.08, 0.05), ((door[0] + door[1]) / 2, 0, h + 0.25), material=steel(), bev=0.004))
    frame = geo.parts_to(fr, name, see_through=True)  # glazed: cameras see through it
    glass = []
    for i in range(panes):
        a, b = xs[i] + 0.03, xs[i + 1] - 0.03
        if door and not (b <= door[0] or a >= door[1]):
            continue
        glass.append(geo.box(f'{name}_pane_{i}', (b - a, 0.012, h - 0.14), ((a + b) / 2, 0, 0.08), material=geo.pbr('office_glass', GLASS, rough=0.04, alpha=0.18), bev=0, role='prop'))
    return frame, glass


def service_door(name='service_door', w=0.9, h=2.1):
    """A steel service door in its frame, drawn half open (the way out to the
    alley behind the store). Origin at the opening's bottom centre."""
    grey = geo.pbr('service_grey', '#6b7078', rough=0.5)
    parts = [geo.box(f'{name}_jamb_l', (0.06, 0.12, h + 0.06), (-w / 2 - 0.03, 0, 0), material=steel(), bev=0.004),
             geo.box(f'{name}_jamb_r', (0.06, 0.12, h + 0.06), (w / 2 + 0.03, 0, 0), material=steel(), bev=0.004),
             geo.box(f'{name}_head', (w + 0.12, 0.12, 0.06), (0, 0, h), material=steel(), bev=0.004),
             geo.box(f'{name}_sign', (0.34, 0.01, 0.1), (0, -0.07, h - 0.3), material=geo.pbr('exit_sign', '#12351f', emit='#35d07f', emit_strength=3), bev=0.003)]
    leaf = geo.box(f'{name}_leaf', (w - 0.02, 0.045, h - 0.02), (0, 0, 0), material=grey, bev=0.006)
    # Swung right open (into the room, against the wall beside the opening),
    # so the doorway is clear to walk through.
    a = math.radians(95)
    # (a box's origin is its centre: keep its height, just lift it off the floor)
    leaf.location = (-w / 2 + 0.01 + (w - 0.02) / 2 * math.cos(a), -(w - 0.02) / 2 * math.sin(a), leaf.location[2] + 0.01)
    leaf.rotation_euler = (0, 0, -a)
    parts.append(leaf)
    return geo.parts_to(parts, name)


def trolley(name='trolley'):
    """A stock trolley: a steel frame on castors with a carton on it (lit live)."""
    grey = geo.pbr('trolley_grey', '#7a7f86', rough=0.45, metal=0.6)
    parts = [geo.box(f'{name}_deck', (0.7, 0.45, 0.03), (0, 0, 0.16), material=grey, bev=0.006),
             geo.box(f'{name}_handle', (0.04, 0.45, 0.8), (-0.33, 0, 0.18), material=grey, bev=0.006)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(geo.cyl(f'{name}_wheel', 0.05, 0.03, (sx * 0.28, sy * 0.17, 0.0), rot=(90, 0, 0), material=geo.pbr('castor', '#1c1d21', rough=0.8), verts=16, bev=0.004))
    parts.append(geo.box(f'{name}_box', (0.4, 0.32, 0.28), (0.05, 0, 0.19), material=geo.pbr('cardboard', '#b58a5c', rough=0.85), bev=0.008))
    return geo.parts_to(parts, name, role='prop')
