"""
The construction-site kit: a building site at architectural-model density,
for ConstructSafe. Each builder returns ONE joined object, origin at its
footprint centre on the ground (z = 0), facing -Y (its front), like the
retail kit, so a scene can place it or instance it.

Photo textures (plywood, corrugated iron, concrete, rust) where a camera
would see grain; flat colours where it wouldn't (hi-vis, painted plant,
galvanised tube). Anything lit live on the page (role 'prop' or 'dyn') uses
flat colours only: photo textures survive only on the baked set.
"""

from __future__ import annotations

import math

import common as C
from kit import geo

GALV = '#8f969c'       # galvanised scaffold tube
HIVIS = '#ff7a1a'      # hi-vis orange
PLANT = '#f2b21b'      # construction-plant yellow
CONCRETE = '#b9b4ab'
BOARD = '#b98f5a'      # scaffold board timber


def _join(parts, name, role='set', **extras):
    return geo.parts_to(parts, name, role=role, **extras)


def galv(name='galv'):
    return geo.pbr(name, GALV, rough=0.38, metal=0.8)


def plywood(name='plywood', tint='#c9a878', scale=0.6):
    return geo.textured(name, 'plywood', tint=tint, rough=0.7, scale=scale)


def corrugated(name='corrugated', tint='#d9dcdf', scale=0.5):
    return geo.textured(name, 'corrugated_iron', tint=tint, rough=0.5, scale=scale, metal=0.3)


def concrete(name='concrete', tint=CONCRETE, scale=0.8):
    return geo.textured(name, 'concrete_wall_008', tint=tint, rough=0.85, scale=scale)


def rust(name='rust', tint='#7a4a33', scale=0.4):
    return geo.textured(name, 'rusty_metal_02', tint=tint, rough=0.75, scale=scale, metal=0.4)


# ---------------------------------------------------------------- the perimeter

def hoarding(name='hoarding', w=3.0, h=1.9, band='#1f6f4a'):
    """A plywood site hoarding panel between two posts, with a painted band."""
    ply = plywood(f'{name}_ply', tint='#d6c3a0')
    paint = geo.pbr(f'{name}_band', band, rough=0.6)
    post = geo.pbr('hoarding_post', '#3a3a3e', rough=0.6)
    parts = [
        geo.box(f'{name}_panel', (w, 0.025, h), (0, 0, 0.02), material=ply, bev=0.004),
        geo.box(f'{name}_band', (w, 0.028, 0.32), (0, 0, h - 0.5), material=paint, bev=0.002),
    ]
    for x in (-w / 2, w / 2):
        parts.append(geo.box(f'{name}_post_{x:.1f}', (0.08, 0.08, h + 0.05), (x, 0.05, 0), material=post, bev=0.01))
    return _join(parts, name)


def heras(name='heras', w=3.3, h=2.0):
    """A temporary mesh fence panel on its two concrete feet: see-through."""
    tube = galv(f'{name}_tube')
    mesh = geo.pbr(f'{name}_mesh', '#9aa1a6', rough=0.45, metal=0.7)
    foot = geo.pbr('heras_foot', '#6f6c68', rough=0.9)
    parts = []
    z0 = 0.12
    for x in (-w / 2 + 0.03, w / 2 - 0.03):
        parts.append(geo.tube(f'{name}_upright_{x:.1f}', [(x, 0, z0), (x, 0, z0 + h)], 0.02, material=tube))
        parts.append(geo.box(f'{name}_foot_{x:.1f}', (0.18, 0.6, 0.12), (x, 0, 0), material=foot, bev=0.02))
    for z in (z0 + 0.02, z0 + h - 0.02):
        parts.append(geo.tube(f'{name}_rail_{z:.1f}', [(-w / 2 + 0.03, 0, z), (w / 2 - 0.03, 0, z)], 0.02, material=tube))
    # The mesh, as thin bars: a grid the camera can see through.
    n = 16
    for i in range(1, n):
        x = -w / 2 + w * i / n
        parts.append(geo.box(f'{name}_v{i}', (0.006, 0.006, h - 0.04), (x, 0, z0 + 0.02), material=mesh, bev=0))
    for j in range(1, 7):
        z = z0 + h * j / 7
        parts.append(geo.box(f'{name}_h{j}', (w - 0.06, 0.006, 0.006), (0, 0, z), material=mesh, bev=0))
    return _join(parts, name, role='prop')


def sign_board(name, lines, w=0.9, h=0.6, ink='#f4f2ea', paper='#1f5fb4', size=0.05, post=True):
    """A site sign on two posts (or wall-mounted): coloured panel, white text."""
    panel = geo.pbr(f'{name}_panel', paper, rough=0.5)
    inkm = geo.pbr(f'{name}_ink', ink, rough=0.5)
    z0 = 1.0 if post else 0.0
    parts = [geo.box(f'{name}_board', (w, 0.02, h), (0, 0, z0), material=panel, bev=0.004)]
    lh = h / (len(lines) + 1)
    for i, line in enumerate(lines):
        parts.append(geo.text(f'{name}_t{i}', line, size=size, depth=0.002, loc=(0, -0.012, z0 + h - lh * (i + 1)), material=inkm))
    if post:
        pm = galv(f'{name}_post')
        for x in (-w / 2 + 0.05, w / 2 - 0.05):
            parts.append(geo.box(f'{name}_p{x:.1f}', (0.05, 0.05, z0 + 0.02), (x, 0.03, 0), material=pm, bev=0.006))
    return _join(parts, name)


# ---------------------------------------------------------------- the building

def scaffold(name='scaffold', length=3.2, depth=0.95, lifts=(1.25, 2.5), bays=3, ladder_bay=0):
    """An independent tube-and-fitting scaffold: standards, ledgers and
    transoms, a brace per bay, boards and toe boards at each lift, double
    guardrails, and a ladder through the first lift. Runs along X, its
    working side facing -Y."""
    tube = galv(f'{name}_tube')
    board = geo.textured(f'{name}_board', 'plywood', tint=BOARD, rough=0.8, scale=0.4)
    toe = geo.pbr(f'{name}_toe', '#c9a04a', rough=0.7)
    base = geo.pbr(f'{name}_baseplate', '#55585c', rough=0.6, metal=0.5)
    parts = []
    xs = [-length / 2 + length * i / bays for i in range(bays + 1)]
    ys = (-depth / 2, depth / 2)
    top = lifts[-1] + 1.05
    r = 0.024
    for x in xs:
        for y in ys:
            parts.append(geo.tube(f'{name}_std_{x:.2f}_{y:.2f}', [(x, y, 0.02), (x, y, top)], r, material=tube, resolution=2))
            parts.append(geo.box(f'{name}_plate_{x:.2f}_{y:.2f}', (0.16, 0.16, 0.02), (x, y, 0), material=base, bev=0.004))
    levels = [0.18] + list(lifts)
    for z in levels:
        for y in ys:
            parts.append(geo.tube(f'{name}_ledger_{z:.2f}_{y:.2f}', [(xs[0], y, z), (xs[-1], y, z)], r, material=tube, resolution=2))
        for x in xs:
            parts.append(geo.tube(f'{name}_transom_{z:.2f}_{x:.2f}', [(x, ys[0], z), (x, ys[1], z)], r, material=tube, resolution=2))
    for z in lifts:
        # Five boards across, a toe board and two guardrails on the open side.
        for k in range(5):
            y = ys[0] + 0.05 + (depth - 0.1) * (k + 0.5) / 5
            parts.append(geo.box(f'{name}_board_{z:.2f}_{k}', (length + 0.1, (depth - 0.14) / 5, 0.04), (0, y, z + r), material=board, bev=0.006))
        parts.append(geo.box(f'{name}_toe_{z:.2f}', (length, 0.03, 0.15), (0, ys[0] - 0.02, z + r + 0.04), material=toe, bev=0.004))
        for dz in (0.5, 0.95):
            parts.append(geo.tube(f'{name}_guard_{z:.2f}_{dz}', [(xs[0], ys[0] - 0.04, z + dz), (xs[-1], ys[0] - 0.04, z + dz)], r, material=tube, resolution=2))
            parts.append(geo.tube(f'{name}_guardend_{z:.2f}_{dz}', [(xs[0] - 0.04, ys[0], z + dz), (xs[0] - 0.04, ys[1], z + dz)], r, material=tube, resolution=2))
    # A face brace per bay on the back.
    for i in range(bays):
        parts.append(geo.tube(f'{name}_brace_{i}', [(xs[i], ys[1] + 0.04, 0.2), (xs[i + 1], ys[1] + 0.04, lifts[0])], r * 0.9, material=tube, resolution=2))
    # A ladder up through the first lift, tied to the end frame.
    lx = xs[ladder_bay] + 0.35
    ly = ys[1] - 0.18
    for dx in (-0.2, 0.2):
        parts.append(geo.box(f'{name}_ladder_{dx}', (0.05, 0.05, lifts[0] + 1.0), (lx + dx, ly, 0), material=geo.pbr('ladder_alu', '#c7cbce', rough=0.4, metal=0.7), bev=0.006))
    for k in range(int((lifts[0] + 0.9) / 0.28)):
        parts.append(geo.box(f'{name}_rung_{k}', (0.4, 0.03, 0.03), (lx, ly, 0.25 + k * 0.28), material=geo.pbr('ladder_alu', '#c7cbce', rough=0.4, metal=0.7), bev=0.004))
    return _join(parts, name)


def rebar_mat(name='rebar', w=2.4, d=1.6, spacing=0.2, h=0.12):
    """A mat of reinforcing bar on chairs, ready for a pour."""
    bar = rust(f'{name}_bar')
    chair = geo.pbr('rebar_chair', '#3f3f44', rough=0.6)
    parts = []
    nx = int(w / spacing)
    ny = int(d / spacing)
    for i in range(nx + 1):
        x = -w / 2 + w * i / nx
        parts.append(geo.box(f'{name}_y{i}', (0.014, d, 0.014), (x, 0, h), material=bar, bev=0))
    for j in range(ny + 1):
        y = -d / 2 + d * j / ny
        parts.append(geo.box(f'{name}_x{j}', (w, 0.014, 0.014), (0, y, h + 0.014), material=bar, bev=0))
    for i in range(0, nx + 1, 3):
        for j in range(0, ny + 1, 3):
            parts.append(geo.box(f'{name}_chair_{i}_{j}', (0.05, 0.05, h), (-w / 2 + w * i / nx, -d / 2 + d * j / ny, 0), material=chair, bev=0.004))
    # Walked on (people step between the bars): not in the way on the floor plan.
    return _join(parts, name, passable=1)


def starter_bars(name='starters', n=4, h=0.9):
    """Bars standing up out of a footing, capped for safety."""
    bar = rust(f'{name}_bar')
    cap = geo.pbr('rebar_cap', HIVIS, rough=0.6)
    parts = []
    for i in range(n):
        for j in range(2):
            x = -0.15 + 0.3 * i / max(1, n - 1)
            y = -0.08 + 0.16 * j
            parts.append(geo.cyl(f'{name}_{i}_{j}', 0.008, h, (x, y, 0), material=bar, verts=8, bev=0))
            parts.append(geo.sphere(f'{name}_cap_{i}_{j}', 0.022, (x, y, h), material=cap, seg=8))
    return _join(parts, name)


def formwork(name='formwork', w=1.6, d=1.0, h=0.5):
    """A plywood box for a footing, open at the top, braced with timber."""
    ply = plywood(f'{name}_ply', tint='#c29a64')
    timber = geo.pbr('formwork_timber', '#a57b4a', rough=0.8)
    parts = [
        geo.box(f'{name}_front', (w, 0.02, h), (0, -d / 2, 0), material=ply, bev=0.003),
        geo.box(f'{name}_back', (w, 0.02, h), (0, d / 2, 0), material=ply, bev=0.003),
        geo.box(f'{name}_l', (0.02, d, h), (-w / 2, 0, 0), material=ply, bev=0.003),
        geo.box(f'{name}_r', (0.02, d, h), (w / 2, 0, 0), material=ply, bev=0.003),
    ]
    for x in (-w / 3, w / 3):
        parts.append(geo.box(f'{name}_strut_{x:.1f}', (0.05, 0.05, 0.6), (x, -d / 2 - 0.18, 0), rot=(35, 0, 0), material=timber, bev=0.006))
    return _join(parts, name)


# ---------------------------------------------------------------- plant and vehicles

def mixer(name='mixer'):
    """A site drum mixer on its stand (the drum is built separately, to turn)."""
    frame = geo.pbr('mixer_frame', '#d23b2a', rough=0.45, metal=0.3)
    tyre = geo.pbr('tyre', '#1b1b1d', rough=0.85)
    parts = [
        geo.box(f'{name}_chassis', (0.9, 0.35, 0.08), (0, 0, 0.32), material=frame, bev=0.01),
        geo.box(f'{name}_post', (0.08, 0.08, 0.55), (0.3, 0, 0.36), material=frame, bev=0.008),
        geo.box(f'{name}_motor', (0.26, 0.3, 0.22), (-0.3, 0, 0.4), material=frame, bev=0.02),
        geo.tube(f'{name}_tow', [(-0.45, 0, 0.35), (-0.75, 0, 0.3)], 0.02, material=frame),
    ]
    for y in (-0.24, 0.24):
        parts.append(geo.cyl(f'{name}_wheel_{y}', 0.16, 0.08, (0.05, y, 0.16), rot=(90, 0, 0), material=tyre, verts=20, bev=0.01))
    return _join(parts, name)


def mixer_drum(name='mixer_drum'):
    """The mixer's drum, origin on its axis: lit live, it turns on the page."""
    drum = geo.pbr('mixer_drum', '#e24a33', rough=0.4, metal=0.3)
    o = geo.lathe(f'{name}_shell', [(0.0, -0.3), (0.12, -0.3), (0.26, -0.18), (0.3, 0.0), (0.26, 0.16), (0.16, 0.3), (0.14, 0.32), (0.0, 0.32)], material=drum, segments=28)
    rim = geo.lathe(f'{name}_rim', [(0.14, 0.32), (0.16, 0.34), (0.15, 0.36), (0.13, 0.33)], material=geo.pbr('mixer_rim', '#2b2b2e', rough=0.5), segments=28)
    return _join([o, rim], name, role='dyn')


def excavator(name='excavator'):
    """A compact excavator: tracks, turntable, cab, boom, arm and bucket."""
    yel = geo.pbr('plant_yellow', PLANT, rough=0.45, metal=0.2)
    dark = geo.pbr('plant_dark', '#2a2b2e', rough=0.7)
    glass = geo.pbr('cab_glass', '#1d2a33', rough=0.1, alpha=0.6)
    parts = []
    for y in (-0.55, 0.55):
        parts.append(geo.box(f'{name}_track_{y}', (2.0, 0.42, 0.42), (0, y, 0), material=dark, bev=0.12))
    parts += [
        geo.cyl(f'{name}_ring', 0.6, 0.12, (0, 0, 0.42), material=dark, verts=24, bev=0.01),
        geo.box(f'{name}_body', (1.7, 1.3, 0.55), (0.15, 0, 0.54), material=yel, bev=0.06),
        geo.box(f'{name}_cab', (0.85, 0.9, 0.95), (-0.35, 0.18, 1.09), material=yel, bev=0.05),
        geo.box(f'{name}_glass', (0.7, 0.92, 0.6), (-0.35, 0.18, 1.3), material=glass, bev=0.02),
        geo.box(f'{name}_weight', (0.5, 1.3, 0.5), (0.95, 0, 0.6), material=dark, bev=0.05),
    ]
    boom = [(-0.6, -0.35, 1.0), (-1.4, -0.35, 2.0), (-2.2, -0.35, 1.9)]
    parts.append(geo.tube(f'{name}_boom', boom, 0.11, material=yel, resolution=2))
    parts.append(geo.tube(f'{name}_arm', [(-2.2, -0.35, 1.9), (-2.6, -0.35, 0.8)], 0.08, material=yel, resolution=2))
    bucket = geo.box(f'{name}_bucket', (0.45, 0.6, 0.4), (-2.7, -0.35, 0.4), rot=(0, -20, 0), material=dark, bev=0.05)
    parts.append(bucket)
    parts.append(geo.tube(f'{name}_ram', [(-0.4, -0.35, 1.25), (-1.3, -0.35, 1.7)], 0.05, material=geo.pbr('ram_chrome', '#d6d9dc', rough=0.2, metal=1.0), resolution=2))
    return _join(parts, name)


def van(name='site_van'):
    """A white panel van with the contractor's stripe, lit live (it drives in
    and out through the gate)."""
    body = geo.pbr('van_white', '#eceae4', rough=0.35, metal=0.1)
    stripe = geo.pbr('van_stripe', HIVIS, rough=0.5)
    glass = geo.pbr('van_glass', '#1c2530', rough=0.1)
    tyre = geo.pbr('tyre', '#1b1b1d', rough=0.85)
    parts = [
        geo.box(f'{name}_body', (1.0, 2.6, 1.05), (0, 0.2, 0.28), material=body, bev=0.1),
        geo.box(f'{name}_nose', (1.0, 0.7, 0.62), (0, -1.35, 0.28), material=body, bev=0.12),
        geo.box(f'{name}_screen', (0.92, 0.3, 0.42), (0, -0.98, 0.9), rot=(-30, 0, 0), material=glass, bev=0.03),
        geo.box(f'{name}_stripe', (1.02, 2.62, 0.08), (0, 0.2, 0.62), material=stripe, bev=0.01),
    ]
    for x in (-0.46, 0.46):
        for y in (-1.1, 1.1):
            parts.append(geo.cyl(f'{name}_wheel_{x}_{y}', 0.2, 0.14, (x, y, 0.2), rot=(0, 90, 0), material=tyre, verts=20, bev=0.01))
    return _join(parts, name, role='dyn')


# ---------------------------------------------------------------- cabins

def cabin(name='cabin', w=3.2, d=2.2, h=2.45, door_side='right', window=True, open_front=True, roof=None):
    """A portable site cabin (a portakabin): corrugated walls on a steel skid,
    a flat roof, a doorway in one end wall (`door_side`) and a window. With
    `open_front`, the front wall is cut away at 0.9 m (a model's cabin) so the
    inside reads from the camera; a cut-away cabin has no roof either (`roof`
    defaults to not `open_front`), as a model's rooms don't."""
    wall = corrugated(f'{name}_wall', tint='#e3e1d8')
    trim = geo.pbr('cabin_trim', '#2f5d8a', rough=0.5)
    skid = geo.pbr('cabin_skid', '#2a2b2e', rough=0.7)
    floor = geo.textured(f'{name}_floor', 'rubber_tiles', tint='#4a4d52', rough=0.9, scale=0.5)
    glass = geo.pbr('cabin_glass', '#9fb8c9', rough=0.1, alpha=0.4)
    t = 0.06
    # Low enough to step onto (under ankle height: the floor stays walkable).
    parts = [
        geo.box(f'{name}_skid', (w, d, 0.05), (0, 0, 0), material=skid, bev=0.01),
        geo.box(f'{name}_floor', (w - 2 * t, d - 2 * t, 0.02), (0, 0, 0.05), material=floor, bev=0),
        geo.box(f'{name}_back', (w, t, h), (0, d / 2 - t / 2, 0.05), material=wall, bev=0.01),
    ]
    # The end wall with the doorway (0.35 d wide), and the plain one.
    dx = w / 2 - t / 2 if door_side == 'right' else -w / 2 + t / 2
    parts += [
        geo.box(f'{name}_end_plain', (t, d, h), (-dx, 0, 0.05), material=wall, bev=0.01),
        geo.box(f'{name}_end_a', (t, d * 0.35, h), (dx, -d * 0.325, 0.05), material=wall, bev=0.01),
        geo.box(f'{name}_end_b', (t, d * 0.3, h), (dx, d * 0.35, 0.05), material=wall, bev=0.01),
        geo.box(f'{name}_end_head', (t, d * 0.35, 0.35), (dx, 0.025 * d, h - 0.25), material=wall, bev=0.01),
    ]
    if roof if roof is not None else not open_front:
        parts.append(geo.box(f'{name}_roof', (w + 0.1, d + 0.1, 0.1), (0, 0, h + 0.1), material=trim, bev=0.02))
    else:
        # The walls' top edge, capped like a model's cut.
        for n_, (sx, sy, x, y) in {'cap_back': (w, 0.1, 0, d / 2 - t / 2), 'cap_l': (0.1, d, -w / 2 + t / 2, 0), 'cap_r': (0.1, d, w / 2 - t / 2, 0)}.items():
            parts.append(geo.box(f'{name}_{n_}', (sx, sy, 0.04), (x, y, h + 0.1), material=trim, bev=0.006))
    front_h = 0.9 if open_front else h
    parts.append(geo.box(f'{name}_front', (w, t, front_h), (0, -d / 2 + t / 2, 0.05), material=wall, bev=0.01))
    parts.append(geo.box(f'{name}_front_cap', (w, 0.1, 0.04), (0, -d / 2 + t / 2, 0.05 + front_h), material=trim, bev=0.006))
    if window:
        parts.append(geo.box(f'{name}_window', (0.9, 0.02, 0.6), (-w / 4, d / 2 - t - 0.001, 1.2), material=glass, bev=0.004))
    return _join(parts, name)


def hut(name='gate_hut', w=1.5, d=1.4, h=2.3):
    """The gate hut: a small cabin with a counter window to the gate."""
    wall = corrugated(f'{name}_wall', tint='#d7dde3')
    trim = geo.pbr('hut_trim', '#1f6f4a', rough=0.5)
    glass = geo.pbr('cabin_glass', '#9fb8c9', rough=0.1, alpha=0.4)
    t = 0.05
    parts = [
        geo.box(f'{name}_base', (w, d, 0.08), (0, 0, 0), material=geo.pbr('cabin_skid', '#2a2b2e', rough=0.7), bev=0.01),
        geo.box(f'{name}_back', (w, t, h), (0, d / 2 - t / 2, 0.08), material=wall, bev=0.008),
        geo.box(f'{name}_left', (t, d, h), (-w / 2 + t / 2, 0, 0.08), material=wall, bev=0.008),
        geo.box(f'{name}_right_low', (t, d, 0.95), (w / 2 - t / 2, 0, 0.08), material=wall, bev=0.008),
        geo.box(f'{name}_right_glass', (0.02, d - 0.2, 0.9), (w / 2 - t / 2, 0, 1.05), material=glass, bev=0.003),
        geo.box(f'{name}_right_top', (t, d, 0.35), (w / 2 - t / 2, 0, h - 0.27), material=wall, bev=0.008),
        geo.box(f'{name}_front_low', (w, t, 0.9), (0, -d / 2 + t / 2, 0.08), material=wall, bev=0.008),
        geo.box(f'{name}_counter', (0.3, d - 0.2, 0.04), (w / 2 - 0.18, 0, 1.0), material=trim, bev=0.006),
        geo.box(f'{name}_roof', (w + 0.12, d + 0.12, 0.08), (0, 0, h + 0.08), material=trim, bev=0.015),
    ]
    return _join(parts, name)


def barrier_post(name='barrier_post'):
    """The gate barrier's post (its arm is built separately, to lift)."""
    red = geo.pbr('barrier_red', '#d23b2a', rough=0.5)
    return _join([geo.box(f'{name}_box', (0.28, 0.28, 0.95), (0, 0, 0), material=red, bev=0.02)], name)


def barrier_arm(name='barrier_arm', length=2.6):
    """The barrier's arm, red and white bands, pivot at its origin: it lifts on the page."""
    white = geo.pbr('barrier_white', '#f2f0ea', rough=0.5)
    red = geo.pbr('barrier_red', '#d23b2a', rough=0.5)
    parts = []
    n = 6
    for i in range(n):
        parts.append(geo.box(f'{name}_seg{i}', (length / n, 0.06, 0.08), (length * (i + 0.5) / n, 0, -0.04), material=red if i % 2 else white, bev=0.005))
    return _join(parts, name, role='dyn')


# ---------------------------------------------------------------- the welding bay

def welding_screen(name='welding_screen', w=1.8, h=1.8, color='#b8321f'):
    """A welding screen: a frame on feet with a tinted curtain."""
    frame = geo.pbr('screen_frame', '#3a3d42', rough=0.5, metal=0.6)
    curtain = geo.pbr(f'{name}_curtain', color, rough=0.6, alpha=0.78)
    parts = [geo.box(f'{name}_curtain', (w - 0.08, 0.01, h - 0.3), (0, 0, 0.25), material=curtain, bev=0)]
    for x in (-w / 2, w / 2):
        parts.append(geo.tube(f'{name}_up_{x:.1f}', [(x, 0, 0), (x, 0, h)], 0.02, material=frame))
        parts.append(geo.tube(f'{name}_foot_{x:.1f}', [(x, -0.3, 0.02), (x, 0.3, 0.02)], 0.02, material=frame))
    parts.append(geo.tube(f'{name}_top', [(-w / 2, 0, h), (w / 2, 0, h)], 0.02, material=frame))
    return _join(parts, name)


def workbench(name='workbench', w=1.6, d=0.7, h=0.85):
    """A steel fabrication bench with a vice and a beam section on it."""
    steel = geo.pbr('bench_steel', '#4a4e54', rough=0.45, metal=0.7)
    top = rust(f'{name}_top', tint='#5c5f63', scale=0.5)
    parts = [geo.box(f'{name}_top', (w, d, 0.05), (0, 0, h - 0.05), material=top, bev=0.008)]
    for x in (-w / 2 + 0.06, w / 2 - 0.06):
        for y in (-d / 2 + 0.06, d / 2 - 0.06):
            parts.append(geo.box(f'{name}_leg_{x:.1f}_{y:.1f}', (0.05, 0.05, h - 0.05), (x, y, 0), material=steel, bev=0.005))
    parts.append(geo.box(f'{name}_shelf', (w - 0.1, d - 0.1, 0.03), (0, 0, 0.2), material=steel, bev=0.004))
    parts.append(geo.box(f'{name}_vice', (0.16, 0.14, 0.12), (w / 2 - 0.15, -d / 2 + 0.1, h), material=geo.pbr('vice_blue', '#2c4f86', rough=0.5, metal=0.4), bev=0.01))
    parts.append(geo.box(f'{name}_beam', (0.9, 0.12, 0.12), (-0.2, 0.05, h), material=rust(f'{name}_beam', tint='#6a4632'), bev=0.004))
    return _join(parts, name)


def gas_bottles(name='gas_bottles'):
    """Oxygen and acetylene on their trolley, hoses to the torch."""
    trolley = geo.pbr('trolley_steel', '#2a2b2e', rough=0.6, metal=0.4)
    ox = geo.pbr('bottle_oxygen', '#2f5d8a', rough=0.4, metal=0.3)
    ac = geo.pbr('bottle_acetylene', '#8a2a2a', rough=0.4, metal=0.3)
    parts = [geo.box(f'{name}_base', (0.5, 0.3, 0.05), (0, 0, 0.1), material=trolley, bev=0.01),
             geo.tube(f'{name}_handle', [(0, 0.12, 0.1), (0, 0.12, 1.3)], 0.015, material=trolley)]
    for x, m in ((-0.12, ox), (0.12, ac)):
        parts.append(geo.cyl(f'{name}_b{x}', 0.1, 1.0, (x, 0, 0.15), material=m, verts=20, bev=0.04))
        parts.append(geo.cyl(f'{name}_valve{x}', 0.03, 0.08, (x, 0, 1.15), material=geo.pbr('brass_valve', '#b89452', rough=0.3, metal=1.0), verts=10, bev=0.005))
    for x in (-0.2, 0.2):
        parts.append(geo.cyl(f'{name}_wheel{x}', 0.09, 0.04, (x, 0.12, 0.09), rot=(0, 90, 0), material=geo.pbr('tyre', '#1b1b1d', rough=0.85), verts=16, bev=0.005))
    return _join(parts, name)


def bin_(name='bin'):
    """A steel waste bin: where a fire can start in a welding bay."""
    steel = rust(f'{name}_steel', tint='#4f5b52', scale=0.3)
    o = geo.lathe(f'{name}_shell', [(0.0, 0.0), (0.24, 0.0), (0.26, 0.62), (0.28, 0.64), (0.26, 0.64), (0.24, 0.05), (0.0, 0.05)], material=steel, segments=24)
    return _join([o], name)


def extinguisher_point(name='fire_point'):
    """A fire point: extinguisher on a stand with its sign."""
    red = geo.pbr('ext_red', '#c8211f', rough=0.35)
    stand = geo.pbr('ext_stand', '#d23b2a', rough=0.5)
    parts = [
        geo.box(f'{name}_stand', (0.5, 0.12, 1.1), (0, 0.06, 0), material=stand, bev=0.01),
        geo.cyl(f'{name}_ext', 0.075, 0.5, (0.12, -0.05, 0.25), material=red, verts=16, bev=0.02),
        geo.box(f'{name}_sign', (0.4, 0.02, 0.24), (0, 0, 1.12), material=geo.pbr('ext_sign', '#c8211f', rough=0.5), bev=0.004),
    ]
    return _join(parts, name)


# ---------------------------------------------------------------- materials yard

def pallet(name='pallet', load='blocks'):
    """A pallet, with blocks, bags of cement, or nothing on it."""
    wood = geo.pbr('pallet_wood', '#b58a58', rough=0.8)
    parts = [geo.box(f'{name}_deck', (1.2, 0.8, 0.14), (0, 0, 0), material=wood, bev=0.01)]
    if load == 'blocks':
        blk = geo.pbr('blocks_grey', '#9e9a93', rough=0.9)
        for k in range(3):
            parts.append(geo.box(f'{name}_blocks_{k}', (1.1, 0.72, 0.2), (0, 0, 0.14 + k * 0.21), material=blk, bev=0.01))
        parts.append(geo.box(f'{name}_wrap', (1.12, 0.74, 0.02), (0, 0, 0.77), material=geo.pbr('wrap', '#dfe4e8', rough=0.3, alpha=0.6), bev=0))
    elif load == 'bags':
        bag = geo.pbr('cement_bag', '#cfc4ad', rough=0.9)
        for k in range(4):
            for j in range(2):
                parts.append(geo.box(f'{name}_bag_{k}_{j}', (0.52, 0.34, 0.12), (-0.28 + 0.56 * (j % 2), -0.18 + 0.36 * ((k + j) % 2), 0.14 + k * 0.12), material=bag, bev=0.04))
    return _join(parts, name, role='prop')


def timber_stack(name='timber', l=2.4, layers=4):
    """Sawn timber stacked on bearers."""
    wood = geo.pbr('timber', '#c39a63', rough=0.8)
    parts = []
    for x in (-l / 3, l / 3):
        parts.append(geo.box(f'{name}_bearer_{x:.1f}', (0.1, 0.7, 0.08), (x, 0, 0), material=geo.pbr('bearer', '#7d5a35', rough=0.8), bev=0.008))
    for k in range(layers):
        for j in range(5):
            parts.append(geo.box(f'{name}_{k}_{j}', (l, 0.1, 0.05), (0, -0.26 + j * 0.13, 0.08 + k * 0.055), material=wood, bev=0.006))
    return _join(parts, name, role='prop')


def pipe_stack(name='pipes', l=2.2):
    """Plastic drain pipes stacked in a pyramid."""
    pvc = geo.pbr('pvc_orange', '#d9751e', rough=0.5)
    parts = []
    r = 0.075
    rows = [4, 3, 2]
    for k, n in enumerate(rows):
        for j in range(n):
            y = (j - (n - 1) / 2) * 2 * r
            parts.append(geo.cyl(f'{name}_{k}_{j}', r, l, (-l / 2, y, r + k * r * 1.7), rot=(0, 90, 0), material=pvc, verts=14, bev=0.004))
    o = _join(parts, name, role='prop')
    return o


def skip(name='skip', w=2.2, d=1.4, h=0.9):
    """A builders' skip, half full of rubble."""
    steel = geo.pbr('skip_yellow', '#e0a21a', rough=0.5, metal=0.3)
    rubble = geo.pbr('rubble', '#8c857a', rough=0.95)
    shell = geo.mesh(f'{name}_shell', [
        (-w / 2 + 0.25, -d / 2, 0), (w / 2 - 0.25, -d / 2, 0), (w / 2 - 0.25, d / 2, 0), (-w / 2 + 0.25, d / 2, 0),
        (-w / 2, -d / 2, h), (w / 2, -d / 2, h), (w / 2, d / 2, h), (-w / 2, d / 2, h),
    ], [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (3, 2, 1, 0)], material=steel)
    fill = geo.box(f'{name}_rubble', (w - 0.3, d - 0.1, 0.1), (0, 0, h - 0.35), material=rubble, bev=0.05)
    return _join([shell, fill], name)


def cone(name='cone'):
    """A traffic cone with its reflective band."""
    orange = geo.pbr('cone_orange', HIVIS, rough=0.55)
    white = geo.pbr('cone_band', '#f2f0ea', rough=0.4)
    base = geo.box(f'{name}_base', (0.34, 0.34, 0.04), (0, 0, 0), material=geo.pbr('cone_base', '#1f1f22', rough=0.8), bev=0.01)
    body = geo.lathe(f'{name}_body', [(0.14, 0.04), (0.03, 0.72), (0.0, 0.72)], material=orange, segments=16)
    band = geo.lathe(f'{name}_band', [(0.098, 0.28), (0.076, 0.42), (0.077, 0.42), (0.099, 0.28)], material=white, segments=16)
    return _join([base, body, band], name, role='prop')


def wheelbarrow(name='wheelbarrow'):
    """A wheelbarrow, tipped down on its legs."""
    tray = geo.pbr('barrow_green', '#2f6b3a', rough=0.5, metal=0.2)
    steel = galv(f'{name}_frame')
    parts = [
        geo.mesh(f'{name}_tray', [
            (-0.35, -0.28, 0.35), (0.4, -0.2, 0.3), (0.4, 0.2, 0.3), (-0.35, 0.28, 0.35),
            (-0.45, -0.34, 0.62), (0.55, -0.28, 0.6), (0.55, 0.28, 0.6), (-0.45, 0.34, 0.62),
        ], [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (3, 2, 1, 0)], material=tray),
        geo.cyl(f'{name}_wheel', 0.17, 0.07, (0.62, 0, 0.17), rot=(90, 0, 0), material=geo.pbr('tyre', '#1b1b1d', rough=0.85), verts=18, bev=0.01),
    ]
    for y in (-0.22, 0.22):
        parts.append(geo.tube(f'{name}_handle_{y}', [(0.6, y * 0.5, 0.18), (-0.9, y, 0.62)], 0.018, material=steel))
        parts.append(geo.tube(f'{name}_leg_{y}', [(-0.2, y, 0.33), (-0.25, y, 0.0)], 0.016, material=steel))
    return _join(parts, name, role='prop')


def light_tower(name='light_tower', h=3.4):
    """A mobile lighting tower: trailer, mast and a bank of four floodlights
    (the scene adds the light itself)."""
    body = geo.pbr('tower_yellow', PLANT, rough=0.45, metal=0.2)
    dark = geo.pbr('plant_dark', '#2a2b2e', rough=0.7)
    lamp = geo.pbr('flood_lens', '#fff6dc', rough=0.2, emit='#fff1cf', emit_strength=4.0)
    parts = [
        geo.box(f'{name}_trailer', (1.2, 0.8, 0.6), (0, 0, 0.3), material=body, bev=0.04),
        geo.tube(f'{name}_mast', [(0, 0.1, 0.9), (0, 0.1, h)], 0.045, material=dark),
        geo.box(f'{name}_bar', (0.9, 0.08, 0.08), (0, 0.1, h - 0.05), material=dark, bev=0.01),
    ]
    for x in (-0.36, -0.12, 0.12, 0.36):
        parts.append(geo.box(f'{name}_head_{x}', (0.2, 0.12, 0.16), (x, 0.0, h - 0.18), rot=(-35, 0, 0), material=dark, bev=0.01))
        parts.append(geo.box(f'{name}_lens_{x}', (0.17, 0.01, 0.13), (x, -0.07, h - 0.17), rot=(-35, 0, 0), material=lamp, bev=0))
    for y in (-0.42, 0.42):
        parts.append(geo.cyl(f'{name}_wheel_{y}', 0.2, 0.1, (0, y, 0.2), rot=(90, 0, 0), material=geo.pbr('tyre', '#1b1b1d', rough=0.85), verts=16, bev=0.01))
    return _join(parts, name)


def camera_pole(name='cam_pole', h=3.0):
    """A camera pole with its junction box (the camera goes on top)."""
    steel = galv(f'{name}_steel')
    parts = [
        geo.box(f'{name}_base', (0.3, 0.3, 0.1), (0, 0, 0), material=geo.pbr('pole_base', '#6f6c68', rough=0.9), bev=0.02),
        geo.tube(f'{name}_pole', [(0, 0, 0.1), (0, 0, h)], 0.045, material=steel),
        geo.box(f'{name}_box', (0.22, 0.12, 0.3), (0, -0.07, 1.2), material=geo.pbr('junction_grey', '#b9bcbf', rough=0.5), bev=0.01),
    ]
    return _join(parts, name)


def blocks_stack(name='block_stack', n=3):
    """Concrete blocks stacked loose, for the day's wall."""
    blk = geo.pbr('blocks_grey', '#9e9a93', rough=0.9)
    parts = []
    for k in range(n):
        for j in range(3):
            parts.append(geo.box(f'{name}_{k}_{j}', (0.44, 0.215, 0.215), (-0.46 + j * 0.46 + (0.23 if k % 2 else 0) * 0, 0, k * 0.22), material=blk, bev=0.008))
    return _join(parts, name, role='prop')


def mortar_tub(name='mortar_tub'):
    """A mortar tub and a spot board."""
    tub = geo.pbr('tub_black', '#1e1f22', rough=0.7)
    mortar = geo.pbr('mortar', '#8d8a82', rough=0.95)
    o = geo.lathe(f'{name}_tub', [(0.0, 0.0), (0.26, 0.0), (0.32, 0.3), (0.3, 0.3), (0.24, 0.03), (0.0, 0.03)], material=tub, segments=24)
    fill = geo.cyl(f'{name}_mortar', 0.28, 0.02, (0, 0, 0.2), material=mortar, verts=24, bev=0)
    return _join([o, fill], name, role='prop')


def trestle(name='trestle', w=1.2, h=0.75):
    """A pair of trestles with a board across."""
    wood = geo.pbr('trestle_wood', '#b58a58', rough=0.8)
    parts = [geo.box(f'{name}_board', (w, 0.3, 0.04), (0, 0, h), material=wood, bev=0.006)]
    for x in (-w / 2 + 0.15, w / 2 - 0.15):
        parts.append(geo.box(f'{name}_a_{x}', (0.05, 0.05, h), (x, -0.12, 0), rot=(12, 0, 0), material=wood, bev=0.006))
        parts.append(geo.box(f'{name}_b_{x}', (0.05, 0.05, h), (x, 0.12, 0), rot=(-12, 0, 0), material=wood, bev=0.006))
    return _join(parts, name)
