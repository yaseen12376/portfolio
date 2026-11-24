"""
Indoor Tracking: finding a crate on a floor plan with three radios.

No code for this project is on this machine, so the piece shows only what
its page says: BLE beacons, RSSI trilateration with Kalman filtering, MQTT,
and live positions on a floor plan accurate to about 3 metres.

A floor plan in blueprint navy with white card walls and three rooms. Three
anchor posts with lit tips; a crate with a BLE tag doing one lap of the rooms
a loop, its tag pulsing. Each anchor's range circle is sized to the crate's
distance, so the three meet where the crate is; the faint disc around it is
the 3 m the system promises (the scale bar on the plan says how big 3 m is).
Raw fixes scatter round the route, the smoothed track is the line of dots
behind the crate, and readings climb from the anchors to a gateway on a mast.
The plan's board has a scanned grain under its navy (ambientCG, CC0), and
the crate is plywood.
"""

from __future__ import annotations

import math

import bpy
from mathutils import Vector

import common as C
from kit import geo
from pieces import _kit as K
from pieces import _parts as P
from pieces import _scans as S

META = {
    'id': 'indoor-tracking',
    'tag': ('INDOOR', 'TRACKING', 'BLE + MQTT  2025'),
    'accent': '#f472b6',
    'disc': '#121a26',
}

PINK = '#f472b6'
# The plan stands on a plinth: low on the turntable it would sit behind the
# bright band the jar's foot makes in the glass.
PLAN = (0.6, 0.46, 0.115)
TOP = PLAN[2]
HALF = (0.285, 0.215)                  # the outer walls' centre lines
WALL_H, INNER_H, WALL_T = 0.02, 0.03, 0.007
THREE_M = 0.09                         # the plan's scale: 3 m
ANCHORS = ((-0.25, 0.18), (0.25, 0.18), (0.02, -0.186))
POST_H = 0.27
GATE = Vector((-0.06, 0.03, 0.72))
# Wall runs (x0, y0, x1, y1), doorways already left out.
WALLS = (
    (-HALF[0], -HALF[1], HALF[0], -HALF[1]), (-HALF[0], HALF[1], HALF[0], HALF[1]),
    (-HALF[0], -HALF[1], -HALF[0], HALF[1]), (HALF[0], -HALF[1], HALF[0], HALF[1]),
    (-0.06, -HALF[1], -0.06, -0.155), (-0.06, -0.08, -0.06, 0.095), (-0.06, 0.17, -0.06, HALF[1]),
    (-0.06, 0.03, 0.085, 0.03), (0.16, 0.03, HALF[0], 0.03),
)
# The lap, through the three doorways (centres at y -0.1175 and 0.1325 on the
# left wall, x 0.1225 on the middle one).
ROUTE = ((-0.19, -0.12), (-0.06, -0.1175), (0.06, -0.128), (0.135, -0.07), (0.1225, 0.03), (0.13, 0.118),
         (0.03, 0.135), (-0.06, 0.1325), (-0.17, 0.118), (-0.226, 0.0))
TRAIL_N, TRAIL_AGE = 84, 0.42
RAW_N, RAW_AGE = 36, 0.3


# ---------------------------------------------------------------- the route

def _route_points(n=600):
    """A closed Catmull-Rom curve through ROUTE, resampled evenly by length."""
    pts = [Vector((x, y, 0.0)) for x, y in ROUTE]
    m = len(pts)
    raw = []
    for i in range(m):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % m], pts[(i + 2) % m]
        for k in range(40):
            s = k / 40
            s2, s3 = s * s, s * s * s
            raw.append(0.5 * ((2 * p1) + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s2 + (-p0 + 3 * p1 - 3 * p2 + p3) * s3))
    acc = [0.0]
    for a, b in zip(raw, raw[1:] + raw[:1]):
        acc.append(acc[-1] + (b - a).length)
    total = acc[-1]
    out, j = [], 0
    for i in range(n):
        s = total * i / n
        while acc[j + 1] < s:
            j += 1
        k = (s - acc[j]) / max(1e-9, acc[j + 1] - acc[j])
        out.append(raw[j].lerp(raw[(j + 1) % len(raw)], k))
    return out


ROUTE_PTS = _route_points()


def at(u):
    """Position and heading on the lap, u in 0..1."""
    n = len(ROUTE_PTS)
    f = (u % 1.0) * n
    i = int(f)
    a, b = ROUTE_PTS[i % n], ROUTE_PTS[(i + 1) % n]
    p = a.lerp(b, f - i)
    d = ROUTE_PTS[(i + 3) % n] - ROUTE_PTS[(i - 3) % n]
    return p, math.atan2(d.y, d.x)


# ---------------------------------------------------------------- the plan

def _plan(col):
    navy = S.scanned('blueprint', 'Concrete048', tint='#1d3158', size=0.3, rough=0.62, bump=0.12)
    geo.box('plinth', (PLAN[0], PLAN[1], TOP - 0.03), (0, 0, 0), col=col, material=geo.pbr('plinth', '#121722', rough=0.5), bev=0.004)
    geo.box('plan', (PLAN[0], PLAN[1], 0.03), (0, 0, TOP - 0.03), col=col, material=navy, bev=0.004)
    grid = geo.pbr('blueprint_line', '#7097d1', rough=0.7)
    lines = []
    step = 0.03
    for i in range(-9, 10):
        x = i * step
        lines.append(P.stroke(f'grid_x{i}', (x, -PLAN[1] / 2 + 0.008), (x, PLAN[1] / 2 - 0.008), 0.0012, col, grid, z=TOP))
    for j in range(-7, 8):
        y = j * step
        lines.append(P.stroke(f'grid_y{j}', (-PLAN[0] / 2 + 0.008, y), (PLAN[0] / 2 - 0.008, y), 0.0012, col, grid, z=TOP))
    P.join(lines, 'plan_grid', col)
    card = geo.pbr('card', '#eef0f3', rough=0.72)
    for k, (x0, y0, x1, y1) in enumerate(WALLS):
        length = math.hypot(x1 - x0, y1 - y0) + WALL_T
        outer = k < 4
        geo.box(f'wall{k}', (length, WALL_T, WALL_H if outer else INNER_H), ((x0 + x1) / 2, (y0 + y1) / 2, TOP),
                rot=(0, 0, math.degrees(math.atan2(y1 - y0, x1 - x0))), col=col, material=card, bev=0.0012)
    # The scale bar, front left: 3 m.
    white = geo.pbr('scale_ink', '#e7edf6', rough=0.6)
    x0, y = -0.255, -0.193
    P.stroke('scale_bar', (x0, y), (x0 + THREE_M, y), 0.0028, col, white, z=TOP)
    for x in (x0, x0 + THREE_M):
        P.stroke('scale_tick', (x, y - 0.006), (x, y + 0.006), 0.0024, col, white, z=TOP)
    P.label('scale_3m', '3 m', 0.02, col, white, x=x0 + THREE_M + 0.012, y=y - 0.007, z=TOP, align='LEFT')


# ---------------------------------------------------------------- anchors and gateway

def _anchors(col):
    post = geo.pbr('post', '#e9ecef', rough=0.5)
    box = geo.pbr('scanner', '#1b1e24', rough=0.45)
    tip = geo.glow('anchor_tip', PINK, 2.4)
    tips = []
    for i, (x, y) in enumerate(ANCHORS):
        geo.cyl(f'anchor{i}_foot', 0.017, 0.006, (x, y, TOP), col=col, material=post, verts=24, bev=0.0015)
        P.rod(f'anchor{i}_post', (x, y, TOP), (x, y, TOP + POST_H - 0.03), 0.0045, col, post, verts=16)
        geo.box(f'anchor{i}_box', (0.03, 0.022, 0.034), (x, y, TOP + POST_H - 0.034), col=col, material=box, bev=0.004)
        t = Vector((x, y, TOP + POST_H + 0.01))
        P.ball(f'anchor{i}_tip', 0.0105, col, tip, loc=tuple(t), seg=16)
        tips.append(t)
    return tips


def _gateway(col):
    post = geo.pbr('mast', '#c9ced6', rough=0.35, metal=0.6)
    P.rod('mast', (GATE.x, GATE.y, TOP + INNER_H), (GATE.x, GATE.y, GATE.z - 0.02), 0.005, col, post, verts=16)
    root = P.group('gateway', col, loc=tuple(GATE), rot=(74.0, 0.0, 0.0), scale=1.35)
    pcb = geo.box('gw_pcb', (0.082, 0.05, 0.004), (0, 0, 0), col=col, material=geo.pbr('pcb', '#16191f', rough=0.5), bev=0.0015)
    can = geo.box('gw_can', (0.03, 0.026, 0.006), (-0.012, 0.0, 0.004), col=col, material=geo.pbr('rf_can', '#c3c8cf', rough=0.25, metal=1.0), bev=0.001)
    trace = geo.box('gw_antenna', (0.018, 0.012, 0.0006), (0.026, 0.012, 0.004), col=col, material=geo.pbr('trace', '#b88a3b', rough=0.3, metal=1.0), bev=0)
    led = P.ball('gw_led', 0.0035, col, geo.glow('gw_led', PINK, 3.0), loc=(0.028, -0.014, 0.0055), seg=10)
    pins = []
    for side in (-1, 1):
        for k in range(10):
            pins.append(geo.box('gw_pin', (0.0028, 0.004, 0.0035), (-0.036 + k * 0.008, side * 0.022, -0.0035), col=col,
                                material=geo.pbr('pin', '#d8d8d2', rough=0.3, metal=1.0), bev=0))
    for p in [pcb, can, trace, led, P.join(pins, 'gw_pins', col)]:
        p.parent = root
    return GATE + Vector((0.0, -0.008, 0.0))


def _bezier(a, b, lift):
    c = (a + b) / 2 + Vector((0.0, 0.0, lift))
    return lambda u: (1 - u) ** 2 * a + 2 * (1 - u) * u * c + u * u * b


# ---------------------------------------------------------------- the moving parts

def _crate(col):
    root = P.group('tracked', col)
    wood = geo.textured('tracked_wood', 'plywood', tint='#b98a55', rough=0.6, scale=0.3, strength=0.75)
    parts = [geo.box('tracked_crate', (0.06, 0.048, 0.042), (0, 0, 0), col=col, material=wood, bev=0.0035)]
    for sx in (-1, 1):
        parts.append(geo.box('tracked_band', (0.005, 0.0495, 0.0425), (sx * 0.02, 0, 0), col=col, material=P.wood('tracked_dark', '#7c5832'), bev=0.001))
    parts.append(geo.cyl('tag_puck', 0.013, 0.007, (0.0, 0.0, 0.042), col=col, material=geo.pbr('tag_white', '#f4f5f7', rough=0.35), verts=28, bev=0.002))
    parts.append(P.ball('tag_led', 0.0038, col, geo.glow('tag_led', PINK, 3.5), loc=(0.0, 0.0, 0.0495), seg=10))
    for p in parts:
        p.parent = root
    return root


def _ring_mat(name, alpha):
    return P.soft_glow(name, PINK, 2.0, alpha=alpha)


def _arc_mesh(name, col, material):
    me = bpy.data.meshes.new(name)
    o = C.link(bpy.data.objects.new(name, me), col)
    me.materials.append(material)
    P.no_shadow(o)
    return o


def set_arcs(o, centre, radius, width=0.0045, segs=180):
    """A range circle, drawn only where it lies on the plan."""
    me = o.data
    me.clear_geometry()
    lim_x, lim_y = PLAN[0] / 2 - 0.006, PLAN[1] / 2 - 0.006
    verts, faces = [], []
    z = TOP + 0.0016
    prev = None
    for k in range(segs + 1):
        a = math.tau * k / segs
        c, s = math.cos(a), math.sin(a)
        x, y = centre[0] + radius * c, centre[1] + radius * s
        on = abs(x) < lim_x and abs(y) < lim_y
        if on:
            i = len(verts)
            r0, r1 = radius - width / 2, radius + width / 2
            verts += [(centre[0] + r0 * c, centre[1] + r0 * s, z), (centre[0] + r1 * c, centre[1] + r1 * s, z)]
            if prev is not None:
                faces.append((prev, prev + 1, i + 1, i))
            prev = i
        else:
            prev = None
    me.from_pydata(verts, [], faces)
    me.update()


def build(col):
    _plan(col)
    tips = _anchors(col)
    gate = _gateway(col)
    crate = _crate(col)
    accuracy = P.flat_ring('accuracy', 0.0, THREE_M, col, _ring_mat('accuracy', 0.1), z=TOP + 0.0012, h=0.0004, segments=64)
    P.no_shadow(accuracy)
    pulses = []
    for k in range(2):
        m = _ring_mat(f'pulse{k}', 0.6)
        o = P.flat_ring(f'pulse{k}', 0.96, 1.0, col, m, z=0.0, h=0.0004, segments=96)
        P.no_shadow(o)
        pulses.append((o, m))
    arcs = [_arc_mesh(f'range{i}', col, _ring_mat(f'range{i}', 0.85)) for i in range(len(ANCHORS))]
    dot = geo.glow('trail', PINK, 1.8)
    trail = []
    for j in range(TRAIL_N):
        s = j / TRAIL_N
        p, _ = at(s)
        o = P.ball(f'trail{j}', 1.0, col, dot, loc=(p.x, p.y, TOP + 0.004), seg=10)
        P.no_shadow(o)
        trail.append((o, s))
    raw_m = geo.glow('raw_fix', '#dbe4f0', 0.9)
    rnd = C.Rand(31)
    raw = []
    for j in range(RAW_N):
        s = rnd()
        p, h = at(s)
        off = (rnd() * 2 - 1) * 0.03
        q = p + Vector((-math.sin(h), math.cos(h), 0.0)) * off + Vector(((rnd() - 0.5) * 0.02, (rnd() - 0.5) * 0.02, 0.0))
        o = P.ball(f'raw{j}', 1.0, col, raw_m, loc=(q.x, q.y, TOP + 0.003), seg=8)
        P.no_shadow(o)
        raw.append((o, s))
    hot = geo.glow('reading', PINK, 3.2)
    link = P.soft_glow('link', PINK, 1.4, alpha=0.3)
    readings = []
    for i, tip in enumerate(tips):
        path = _bezier(tip, gate, 0.12 + 0.03 * i)
        line = geo.tube(f'link{i}', [tuple(path(k / 40)) for k in range(41)], radius=0.0011, col=col, material=link, resolution=2)
        P.no_shadow(line)
        for j in range(3):
            o = P.ball(f'reading{i}_{j}', 1.0, col, hot, seg=12)
            P.no_shadow(o)
            readings.append((o, path, j / 3 + i * 0.11))
    P.no_ghosts(col)
    return {'crate': crate, 'accuracy': accuracy, 'pulses': pulses, 'arcs': arcs, 'trail': trail, 'raw': raw, 'readings': readings}


def animate(t, st):
    p, h = at(t)
    st['crate'].location = (p.x, p.y, TOP)
    st['crate'].rotation_euler = (0.0, 0.0, h)
    st['accuracy'].location = (p.x, p.y, 0.0)
    for k, (o, m) in enumerate(st['pulses']):
        ph = (4 * t + k / 2) % 1.0
        r = 0.014 + 0.085 * ph
        o.location = (p.x, p.y, TOP + 0.002)
        o.scale = (r, r, 1.0)
        P.set_glow(m, alpha=0.65 * (1 - ph) ** 2)
    for o, (x, y) in zip(st['arcs'], ANCHORS):
        set_arcs(o, (x, y), math.hypot(p.x - x, p.y - y))
    for o, s in st['trail']:
        age = (t - s) % 1.0
        r = 0.0052 * (1 - age / TRAIL_AGE) ** 0.6 if 0.012 < age < TRAIL_AGE else 1e-4
        o.scale = (r, r, r * 0.6)
    for o, s in st['raw']:
        age = (t - s) % 1.0
        r = 0.0026 * (1 - age / RAW_AGE) if 0.0 < age < RAW_AGE else 1e-4
        o.scale = (r, r, r * 0.6)
    for o, path, ph in st['readings']:
        u = (2 * t + ph) % 1.0
        o.location = path(u)
        r = 0.0072 * C.smoothstep(0.0, 0.08, u) * (1 - C.smoothstep(0.9, 1.0, u))
        o.scale = (max(r, 1e-4),) * 3


# ---------------------------------------------------------------- the live jar (pieces/live.py)

# Pulses four times a loop, readings twice, trail dots born and gone: a key a
# frame (the render's 144), so nothing is drawn between one cycle and the next.
LIVE = {'clip_frames': 144}
ARC_W, ARC_SEGS = 0.0045, 180      # set_arcs()'s defaults, for the page


def spots(st):
    """The live jar's numbered dots: the ranges (on the front anchor's tip),
    the track (on the plan's 3 m scale bar, which the crate's disc matches)
    and the gateway (on its board). Each names the parts a tap opens it from
    with the glass off: the anchors and their range circles; the crate, its
    disc, pulses, raw fixes and track; the gateway, its mast and the
    readings climbing to it."""
    from pieces.live import below, box
    bpy.context.view_layer.update()
    _, top_a, tip = box('anchor2_tip')
    _, top_s, bar = box('scale_3m')
    _, top_g, gw = box('gw_pcb')
    names = [o.name for o in bpy.data.objects if o.type in ('MESH', 'CURVE', 'FONT')]
    ranges = [n for n in names if n.startswith(('anchor', 'range'))]
    track = below('tracked') + [n for n in names if n.startswith(('accuracy', 'pulse', 'trail', 'raw', 'scale_'))]
    gateway = below('gateway') + [n for n in names if n.startswith(('mast', 'link', 'reading'))]
    return [
        {'id': 'ranges', 'at': (tip.x, tip.y, top_a.z + 0.012), 'parts': ranges},
        {'id': 'track', 'at': (bar.x, bar.y, top_s.z + 0.008), 'parts': track},
        {'id': 'gateway', 'at': (gw.x, gw.y, top_g.z + 0.014), 'parts': gateway},
    ]


def live(st):
    """The range circles are redrawn every frame (set_arcs): the page draws
    them its own way (src/three/pieces/indoor-tracking.js), from where the
    crate is, cut to the plan. The crate goes round the plan, and the raw
    fixes come and go: the plan's occlusion is baked without them, or it
    keeps where they stood at frame 0 (the crate's straps as two black bars).
    And the plinth's top goes: the plan covers all of it, yet the map of the
    ground the glass takes from straight above (the lowest surface that faces
    up wins) took it for the floor, and drew its black wherever a ray passed
    behind the crate, a wall or a post and came down on the plan
    (AthleteVision's underlay, the same)."""
    import bmesh

    for o in st['state']['arcs']:
        o['hooked'] = 1
    st['state']['crate']['apart'] = 1
    for o, _ in st['state']['raw']:
        o['apart'] = 1
    plinth = bpy.data.objects.get('plinth')
    if plinth:
        nm = plinth.matrix_world.to_3x3().inverted_safe().transposed()
        bm = bmesh.new()
        bm.from_mesh(plinth.data)
        bm.normal_update()
        top = [f for f in bm.faces if (nm @ f.normal).normalized().z > 0.99]
        if top:
            bmesh.ops.delete(bm, geom=top, context='FACES')
            bm.to_mesh(plinth.data)
        bm.free()
        plinth.data.update()


def page(st):
    """What the page's range circles need: their meshes, the anchors, the
    crate they reach for, and the plan they are cut to (piece space, z up)."""
    return {'ranges': {
        'meshes': [o.name for o in st['state']['arcs']], 'anchors': [list(a) for a in ANCHORS], 'crate': 'tracked',
        'z': round(TOP + 0.0016, 5), 'lim': [round(PLAN[0] / 2 - 0.006, 5), round(PLAN[1] / 2 - 0.006, 5)],
        'width': ARC_W, 'segs': ARC_SEGS,
    }}
