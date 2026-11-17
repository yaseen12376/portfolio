"""
Property claim workbench: one claim file, read, checked and settled.

Everything shown is the demo build's own synthetic claim (CLM-78452):
  - a claim folder standing open, its top page read line by line: the cited
    lines are marked, and a highlight walks down them
  - the damage photo on the folder's other leaf, two corner-bracket boxes
    around what the model described
  - a printing calculator whose tape is the settlement, step by step:
    164,160.00 - 25,000.00 - 10,000.00 - 6,200.00 = 122,960.00
  - three stamps, one per approval level
  - the sealed claim pack, banded and wax-sealed
No client, no real claim, no real document.
"""

from __future__ import annotations

import math

from mathutils import Matrix

import common as C
from kit import geo
from pieces import _kit as K
from pieces import _parts as P

META = {
    'id': 'claims-workbench',
    'tag': ('CLAIM REVIEW', 'WORKBENCH', 'PROPERTY CLAIMS  2026'),
    'accent': '#f5b83d',
    'disc': '#1b2823',
}

AMBER = '#f5b83d'
CITED = (1, 4, 7)          # the rows the model cited
TAPE = ('164,160.00', '- 25,000.00', '- 10,000.00', '- 6,200.00')
NET = '122,960.00'


def _from_left(o, w):
    """Move a bar's origin to its left end, so it can be wiped in by scale."""
    o.data.transform(Matrix.Translation((w / 2, 0, 0)))
    o.location.x -= w / 2
    return o


# ---------------------------------------------------------------- the folder

def _page(col, name, w, h, cited=(), title=None, live=False):
    """One page of the file, in its own XY plane (x centred, y up from 0)."""
    grey = P.ink('page_grey', '#8d8a84')
    dark = P.ink('page_ink', '#2f2c29')
    parts = [P.sheet(f'{name}_sheet', w, h, col, P.paper('page_paper', '#f6f3ec'))]
    x0, x1 = -w / 2 + 0.022, w / 2 - 0.022
    top = h - 0.05
    if title:
        parts.append(P.label(f'{name}_title', title, 0.021, col, dark, x=x0, y=h - 0.03, align='LEFT'))
        parts.append(geo.box(f'{name}_rule', (x1 - x0, 0.0012, 0.0003), ((x0 + x1) / 2, h - 0.048, 0.0019), col=col, material=dark, bev=0))
        top = h - 0.078
    pitch = 0.034
    n = int((top - 0.085) / pitch) + 1
    marks = []
    for i in range(n):
        y = top - i * pitch
        k = (0.94, 0.78, 0.88, 0.6, 0.97, 0.83, 0.72, 0.9, 0.66)[i % 9]
        wline = (x1 - x0 - 0.02) * k
        if i in cited:
            # A cited line: a pale band under the words, a chip in the margin
            # saying where it was read from, and (live) the bright band.
            band_w = x1 - x0 + 0.008
            parts.append(geo.box(f'{name}_band{i}', (band_w, 0.022, 0.0003), ((x0 + x1) / 2, y, 0.0018), col=col,
                                 material=geo.pbr('cite_band', '#f0dca2', rough=0.8), bev=0))
            parts.append(geo.box(f'{name}_chip{i}', (0.013, 0.013, 0.0005), (x0 - 0.012, y, 0.0018), col=col,
                                 material=geo.pbr('cite_chip', C.TURQ, rough=0.5, emit=C.TURQ, emit_strength=0.5), bev=0))
            if live:
                m = P.soft_glow(f'cite_live{i}', AMBER, 2.2)
                b = geo.box(f'{name}_live{i}', (band_w, 0.022, 0.0004), ((x0 + x1) / 2, y, 0.0021), col=col, material=m, bev=0)
                marks.append(_from_left(b, band_w))
                parts.append(b)
        parts.append(geo.box(f'{name}_l{i}', (wline, 0.0055, 0.0003), (x0 + wline / 2, y, 0.0026), col=col,
                             material=dark if i in cited else grey, bev=0))
    # two boxed values at the foot of the page
    for j, x in enumerate((x0 + 0.045, x0 + 0.145)):
        parts.append(geo.box(f'{name}_cell{j}', (0.082, 0.026, 0.0003), (x, 0.037, 0.0018), col=col,
                             material=geo.pbr('cell', '#e2ddd2', rough=0.8), bev=0))
        parts.append(geo.box(f'{name}_cellv{j}', (0.05, 0.0055, 0.0003), (x - 0.008, 0.037, 0.0022), col=col, material=dark, bev=0))
    return parts, marks


def _photo(col, w=0.25, h=0.185):
    """The damage photo: a wall, a floor, a water stain and a pool, with the
    two boxes the model drew. Shapes only: no real photograph."""
    parts = [P.sheet('photo_print', w, h, col, P.paper('photo_border', '#f4f1ea'), t=0.0022)]
    iw, ih = w - 0.022, h - 0.022
    cy = h / 2
    parts.append(geo.box('photo_wall', (iw, ih, 0.0004), (0, cy, 0.0022), col=col, material=geo.pbr('ph_wall', '#cbbfa9', rough=0.9), bev=0))
    parts.append(geo.box('photo_floor', (iw, ih * 0.3, 0.0004), (0, cy - ih * 0.35, 0.0025), col=col,
                         material=geo.pbr('ph_floor', '#7b6a57', rough=0.85), bev=0))
    parts.append(geo.box('photo_skirt', (iw, 0.006, 0.0004), (0, cy - ih * 0.2, 0.0028), col=col, material=geo.pbr('ph_skirt', '#efe9dc', rough=0.8), bev=0))

    def blob(name, cx, cy_, rx, ry, hex_, seed):
        rnd = C.Rand(seed)
        poly = []
        for i in range(18):
            a = 2 * math.pi * i / 18
            k = 0.78 + 0.34 * rnd()
            poly.append((cx + rx * k * math.cos(a), cy_ + ry * k * math.sin(a)))
        return geo.extrude(name, poly, 0.0004, z=0.0030, col=col, material=geo.pbr(name, hex_, rough=0.9), bev=0)

    stain = (-0.045, cy + 0.03)
    pool = (0.055, cy - ih * 0.36)
    parts.append(blob('photo_stain', *stain, 0.05, 0.034, '#8a7a61', 3))
    parts.append(blob('photo_stain2', stain[0] + 0.012, stain[1] - 0.012, 0.028, 0.03, '#75664f', 4))
    parts.append(blob('photo_pool', *pool, 0.045, 0.014, '#4f5964', 6))
    box_m = geo.pbr('ph_box', C.TURQ, rough=0.5, emit=C.TURQ, emit_strength=1.2)
    for k, (c, bw, bh) in enumerate(((stain, 0.125, 0.092), (pool, 0.105, 0.042))):
        for b in P.brackets(f'photo_box{k}', col, box_m, bw, bh, arm=0.28, thick=0.0032, depth=0.0006, z=0.0036):
            b.location.x += c[0]
            b.location.y += c[1]
            parts.append(b)
    return parts


def _folder(col):
    """A manila folder standing open like a tent: pages on one leaf, the photo
    on the other. Returns the live highlight bars."""
    manila = geo.pbr('manila', '#d6b170', rough=0.78)
    w, h, lean = 0.36, 0.6, 11.0
    d = h * math.sin(math.radians(lean))
    yaw = -9.0
    root = P.group('folder', col, loc=(-0.035, 0.07, 0.0), rot=(0, 0, yaw))

    def leaf(name, back):
        tab = [(-w / 2, 0), (w / 2, 0), (w / 2, h), (w / 2 - 0.02, h + 0.022), (w / 2 - 0.105, h + 0.022), (w / 2 - 0.125, h), (-w / 2, h)]
        board = geo.extrude(f'{name}_board', tab if not back else [(-x, y) for x, y in reversed(tab)], 0.004, z=-0.004, col=col, material=manila, bev=0)
        g = P.group(name, col, [board], loc=(0, d if back else -d, 0.0), rot=(90 - lean, 0, 180 if back else 0), parent=root)
        return g

    front = leaf('leaf_front', False)
    back = leaf('leaf_back', True)

    # three fanned pages on the front leaf, the top one live
    marks = []
    for i, (dx, dy, turn) in enumerate(((0.012, 0.03, 5.0), (-0.008, 0.024, -3.5), (0.0, 0.045, 0.0))):
        live = i == 2
        parts, mk = _page(col, f'page{i}', 0.31, 0.5, cited=CITED if live else (2, 5), title='ADJUSTER REPORT' if live else None, live=live)
        marks += mk
        P.group(f'page{i}', col, parts, loc=(dx, dy, 0.0008 + i * 0.0022), rot=(0, 0, turn), parent=front)
    clip = geo.box('folder_clip', (0.05, 0.02, 0.006), (0.0, h - 0.035, 0.007), col=col, material=K.brass('clip_brass'), bev=0.002)
    clip.parent = front

    P.group('photo', col, _photo(col, 0.31, 0.225), loc=(0.0, 0.3, 0.0008), rot=(0, 0, -3.0), parent=back)
    slip, _ = _page(col, 'slip', 0.27, 0.22, cited=(1, 3), title='PHOTO NOTES')
    P.group('slip', col, slip, loc=(-0.01, 0.05, 0.0008), rot=(0, 0, 2.5), parent=back)
    pin = geo.cyl('photo_pin', 0.007, 0.006, (0.0, 0.512, 0.003), col=col, material=geo.pbr('pin_red', '#a3312b', rough=0.35), verts=16, bev=0.001)
    pin.parent = back
    return marks


# ---------------------------------------------------------------- the calculator

def _tape_path(x, y0, z0):
    """Up out of the slot leaning back, then curling over and down behind."""
    lean = math.radians(9)
    L, R = 0.36, 0.045
    ty, tz = math.sin(lean), math.cos(lean)

    def path(s):
        if s <= L:
            p = (x, y0 + ty * s, z0 + tz * s)
            return p, (0, ty, tz), (0, -tz, ty)
        a = (s - L) / R                      # turning clockwise (toward +Y, then down)
        cy, cz = y0 + ty * L + tz * R, z0 + tz * L - ty * R
        ang = math.pi - lean - a             # angle of the radius from the centre
        p = (x, cy + R * math.cos(ang), cz + R * math.sin(ang))
        t = (0, math.sin(ang), -math.cos(ang))
        return p, t, (0, -t[2], t[1])

    return path


def _calculator(col):
    root = P.group('calculator', col, loc=(0.262, -0.07, 0.0), rot=(0, 0, 24.0))
    body_m = geo.pbr('calc_body', '#d9d4c8', rough=0.5)
    dark = geo.pbr('calc_dark', '#2b2d31', rough=0.45)
    w, d = 0.165, 0.2
    tilt = P.group('calc_tilt', col, loc=(0, 0, 0.004), rot=(9, 0, 0), parent=root)
    parts = [geo.box('calc_shell', (w, d, 0.03), (0, 0, 0), col=col, material=body_m, bev=0.008)]
    parts.append(geo.box('calc_display', (w - 0.03, 0.03, 0.004), (0, d / 2 - 0.058, 0.03), col=col,
                         material=geo.pbr('calc_lcd', '#1d2a22', rough=0.25, emit='#7cf0b4', emit_strength=0.25), bev=0.002))
    parts.append(P.label('calc_digits', NET, 0.0135, col, P.soft_glow('calc_digit', '#9dffd0', 1.6), x=w / 2 - 0.022, y=d / 2 - 0.058, z=0.0345, align='RIGHT'))
    keys = (('#3a3d42',) * 3 + ('#b3542d',), ('#3a3d42',) * 3 + ('#6b6f76',), ('#3a3d42',) * 3 + ('#6b6f76',), ('#3a3d42',) * 3 + ('#2e7d57',))
    for r, row in enumerate(keys):
        for c, hex_ in enumerate(row):
            parts.append(geo.box(f'calc_key{r}{c}', (0.026, 0.02, 0.008), (-0.048 + c * 0.032, d / 2 - 0.092 - r * 0.026, 0.029), col=col,
                                 material=geo.pbr(f'key_{hex_}', hex_, rough=0.5), bev=0.003))
    # the printer head at the back, and the roll behind it
    parts.append(geo.box('calc_head', (w, 0.05, 0.05), (0, d / 2 - 0.025, 0), col=col, material=body_m, bev=0.008))
    parts.append(geo.box('calc_slot', (w - 0.028, 0.007, 0.002), (0, d / 2 - 0.03, 0.05), col=col, material=dark, bev=0))
    parts.append(P.rod('calc_roll', (-(w - 0.05) / 2, d / 2 + 0.02, 0.05), ((w - 0.05) / 2, d / 2 + 0.02, 0.05), 0.03, col,
                       P.paper('roll_paper', '#f1eee6'), verts=28))
    for p in parts:
        p.parent = tilt

    # the tape, printed flat and then laid along its path
    tw = w - 0.036
    white = P.paper('tape_paper', '#f7f5ef')
    inkm = P.ink('tape_ink', '#2c2a31')
    flat = [geo.box('tape_sheet', (0.5, tw, 0.0009), (0.25, 0, 0), col=col, material=white, bev=0)]
    rows_ = [(NET, 0.0215, 0.06)] + [(v, 0.0155, 0.118 + i * 0.044) for i, v in enumerate(reversed(TAPE))]
    for i, (body, size, s) in enumerate(rows_):
        flat.append(P.label(f'tape_t{i}', body, size, col, inkm, x=s, y=-(tw / 2 - 0.009), z=0.0009, align='RIGHT', rot_z=-90))
    flat.append(geo.box('tape_rule', (0.0016, tw - 0.016, 0.0003), (0.09, 0, 0.0009), col=col, material=inkm, bev=0))
    tape = P.subdivide_x(P.join(flat, 'tape', col), 0.006)
    tape.parent = tilt
    strip = P.Strip(tape, _tape_path(0.0, d / 2 - 0.03, 0.045), side=(-1, 0, 0))
    strip.place(0.0)
    return root


# ---------------------------------------------------------------- stamps + the pack

def _stamps(col):
    root = P.group('stamps', col, loc=(-0.285, -0.085, 0.0), rot=(0, 0, -68.0), scale=1.45)
    walnut = K.walnut('stamp_wood')
    brass = K.brass('stamp_brass')
    tray = geo.box('stamp_tray', (0.19, 0.068, 0.014), (0, 0, 0), col=col, material=geo.pbr('tray', '#2a2623', rough=0.6), bev=0.004)
    tray.parent = root
    for i, (hex_, tall) in enumerate((('#2e7d57', 0.092), ('#2b5fa8', 0.104), ('#a3312b', 0.118))):
        x = -0.058 + i * 0.058
        prof = [(0.0, 0.0), (0.021, 0.0), (0.021, 0.014), (0.012, 0.022), (0.0085, 0.034), (0.0085, tall - 0.03),
                (0.015, tall - 0.018), (0.0165, tall - 0.008), (0.012, tall), (0.0, tall)]
        h = geo.lathe(f'stamp_handle{i}', prof, col, walnut, segments=28, loc=(x, 0, 0.022))
        K.sharpen(h, 40)
        base = geo.box(f'stamp_base{i}', (0.046, 0.046, 0.01), (x, 0, 0.013), col=col, material=brass, bev=0.002)
        pad = geo.box(f'stamp_pad{i}', (0.042, 0.042, 0.004), (x, 0, 0.009), col=col, material=geo.pbr(f'stamp_ink{i}', hex_, rough=0.6), bev=0)
        band = geo.cyl(f'stamp_band{i}', 0.0092, 0.008, (x, 0, 0.022 + tall - 0.05), col=col, material=geo.pbr(f'stamp_band{i}', hex_, rough=0.45),
                       verts=24, bev=0.001)
        for o in (h, base, pad, band):
            o.parent = root
    return root


def _pack(col):
    """The claim pack: a flat archive box, banded, with a wax seal."""
    root = P.group('pack', col, loc=(-0.02, -0.245, 0.0), rot=(0, 0, 7.0), scale=1.15)
    w, d, h = 0.215, 0.118, 0.04
    parts = [geo.box('pack_box', (w, d, h), (0, 0, 0), col=col, material=geo.pbr('pack_board', '#7d7a70', rough=0.85), bev=0.004)]
    parts.append(geo.box('pack_lid', (w + 0.004, d + 0.004, 0.012), (0, 0, h - 0.012), col=col, material=geo.pbr('pack_lid', '#8b887d', rough=0.85), bev=0.003))
    band = geo.pbr('pack_band', '#efe9da', rough=0.8)
    parts.append(geo.box('pack_band_top', (0.036, d + 0.008, 0.0012), (0.045, 0, h), col=col, material=band, bev=0))
    for sy in (-1, 1):
        parts.append(geo.box('pack_band_side', (0.036, 0.0012, h), (0.045, sy * (d / 2 + 0.0026), 0), col=col, material=band, bev=0))
    wax = geo.pbr('pack_wax', '#8f1f1b', rough=0.3)
    seal = geo.lathe('pack_seal', [(0.0, 0.0), (0.02, 0.0), (0.0215, 0.003), (0.019, 0.0058), (0.013, 0.0052), (0.012, 0.0036), (0.0, 0.0036)], col, wax,
                     segments=28, loc=(0.045, 0.0, h + 0.0012))
    parts.append(seal)
    lab = P.paper('pack_label', '#f4f1ea')
    parts.append(geo.box('pack_label', (0.088, 0.06, 0.0008), (-0.05, 0.0, h), col=col, material=lab, bev=0))
    dark = P.ink('pack_ink', '#2f2c29')
    parts.append(P.label('pack_title', 'CLAIM PACK', 0.0105, col, dark, x=-0.05, y=0.016, z=h + 0.0008))
    parts += P.barcode('pack_code', col, dark, -0.05, -0.008, 0.068, 0.017, z=h + 0.0008, seed=9)
    for p in parts:
        p.parent = root
    return root


# ---------------------------------------------------------------- build + move

def build(col):
    marks = _folder(col)
    _calculator(col)
    _stamps(col)
    _pack(col)
    P.no_ghosts(col)
    return {'marks': marks}


def animate(t, st):
    # The highlight takes each cited line in turn: it wipes in from the left,
    # rests, and thins away as the next one starts. (Offset so the still, at
    # t = 0, has a line lit.)
    marks = st['marks']
    n = len(marks)
    for i, b in enumerate(marks):
        u = ((t + 0.1) * n - i) % n          # 0..1 is this line's turn
        if u >= 1.0:
            b.scale = (0.0001, 0.0001, 1)
            continue
        wipe = C.ease_in_out(min(1.0, u / 0.28))
        thin = 1 - C.ease_in_out(max(0.0, (u - 0.8) / 0.2))
        b.scale = (max(0.0001, wipe), max(0.0001, thin), 1)
