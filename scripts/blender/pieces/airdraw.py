"""
AirDraw: a wooden artist's hand, drawing in the air.

The app tracks one hand with MediaPipe (21 landmarks a frame) and reads
three gestures: index finger up draws, an open palm erases, a pinch zooms.
This hand holds the drawing pose. Its 21 landmarks are the lit beads on its
joints, and the palm carries the lines MediaPipe joins them with. The stroke
it has drawn hangs in the air in the app's brush colour, #22d3ee, ending at
the fingertip. A pulse runs along the stroke twice a loop.
"""

from __future__ import annotations

import math

import bpy
from mathutils import Matrix, Vector

import common as C
from kit import geo
from pieces import _kit as K
from pieces import _parts as P

META = {
    'id': 'airdraw',
    'tag': ('AIRDRAW', '', 'GESTURE DRAWING  2026'),
    'accent': '#22d3ee',
    'disc': '#11181d',
}

BRUSH = '#22d3ee'
G = 2.25                                  # life size to piece size
HAND_AT = Vector((-0.1, 0.035, 0.2))      # the wrist, in piece space
HAND_YAW, HAND_TILT = -24.0, -6.0         # degrees: turned toward camera left, leaning back

# Landmarks in life-size metres, hand frame: wrist at the origin, fingers up
# +Z, palm facing -Y, thumb on +X (a right hand, palm to the camera).
MCP = {'index': (0.030, 0.0, 0.092), 'middle': (0.008, 0.0, 0.096), 'ring': (-0.013, 0.0, 0.090), 'pinky': (-0.031, 0.0, 0.078)}
BONES = {'index': (0.046, 0.026, 0.020), 'middle': (0.050, 0.030, 0.022), 'ring': (0.046, 0.028, 0.021), 'pinky': (0.036, 0.020, 0.018)}
RADII = {'index': 0.0085, 'middle': 0.009, 'ring': 0.0085, 'pinky': 0.0074}
CURL = (80.0, 175.0, 225.0)               # cumulative bend at MCP, PIP, DIP (a fist)
POINT = (6.0, 12.0, 18.0)                 # the index finger, nearly straight
THUMB = ((0.024, -0.010, 0.022), (0.041, -0.027, 0.047), (0.033, -0.046, 0.067), (0.016, -0.055, 0.077))


def _finger(name):
    a = Vector(MCP[name])
    pts = [a]
    for L, deg in zip(BONES[name], POINT if name == 'index' else CURL):
        th = math.radians(deg)
        a = a + L * Vector((0.0, -math.sin(th), math.cos(th)))
        pts.append(a)
    return pts


def landmarks():
    """MediaPipe order: 0 wrist, 1-4 thumb, 5-8 index, 9-12 middle, 13-16 ring, 17-20 pinky."""
    out = [Vector((0.0, 0.0, 0.0))] + [Vector(p) for p in THUMB]
    for name in ('index', 'middle', 'ring', 'pinky'):
        out += _finger(name)
    return out


def hand_matrix():
    return (Matrix.Translation(HAND_AT) @ Matrix.Rotation(math.radians(HAND_YAW), 4, 'Z')
            @ Matrix.Rotation(math.radians(HAND_TILT), 4, 'X') @ Matrix.Scale(G, 4))


# ---------------------------------------------------------------- the stand and the hand

def _stand(col):
    walnut = K.walnut('hand_walnut')
    brass = K.brass('hand_brass')
    base = geo.lathe('hand_base', [(0.0, 0.0), (0.104, 0.0), (0.107, 0.011), (0.098, 0.022), (0.06, 0.027), (0.0, 0.027)], col, walnut, segments=64)
    K.sharpen(base, 40)
    wrist_low = hand_matrix() @ Vector((0.0, 0.004, -0.034))
    P.rod('hand_rod', (HAND_AT.x * 0.25, HAND_AT.y * 0.25, 0.02), tuple(wrist_low), 0.0062, col, brass, verts=20)
    P.ball('hand_rod_cap', 0.011, col, brass, loc=(HAND_AT.x * 0.25, HAND_AT.y * 0.25, 0.027), seg=20)


def _hand(col):
    wood = P.wood('hand_wood', '#d6ab78', rough=0.5)
    root = P.group('hand', col)
    root.matrix_world = hand_matrix()
    lm = landmarks()
    parts = []
    # Forearm stub and wrist block.
    parts.append(geo.lathe('hand_forearm', [(0.0, -0.036), (0.021, -0.036), (0.023, -0.012), (0.024, -0.004), (0.0, -0.004)], col, wood, segments=32))
    # The palm: a rounded slab, a little thicker at the heel of the thumb.
    palm = geo.box('hand_palm', (0.078, 0.024, 0.088), (0.0, 0.0012, 0.004), col=col, material=wood, bev=0.011)
    parts.append(palm)
    parts.append(geo.sphere('hand_thenar', 0.017, (0.022, -0.008, 0.03), scale=(1.0, 0.75, 1.35), col=col, material=wood, seg=20))
    # Phalanges: one rounded piece per bone, a sliver apart at each joint.
    chains = {'thumb': [1, 2, 3, 4], 'index': [5, 6, 7, 8], 'middle': [9, 10, 11, 12], 'ring': [13, 14, 15, 16], 'pinky': [17, 18, 19, 20]}
    for name, idx in chains.items():
        r = 0.0098 if name == 'thumb' else RADII[name]
        for k in range(3):
            a, b = lm[idx[k]], lm[idx[k + 1]]
            d = (b - a)
            gap = 0.0025
            a2, b2 = a + d.normalized() * gap, b - d.normalized() * gap
            taper = 0.94 ** k
            parts.append(P.limb(f'{name}_bone{k}', tuple(a2), tuple(b2), r * taper, r * taper * 0.93, col, wood))
    for p in parts:
        p.parent = root
    return root, lm


def _landmarks(col, root, lm):
    """The 21 beads, and the palm's connecting lines (MediaPipe draws these)."""
    glow = geo.glow('landmark', BRUSH, 2.4)
    beads = []
    finger = {**{i: 0.0098 for i in (1, 2, 3, 4)}, **{i: RADII['index'] for i in (5, 6, 7, 8)}, **{i: RADII['middle'] for i in (9, 10, 11, 12)},
              **{i: RADII['ring'] for i in (13, 14, 15, 16)}, **{i: RADII['pinky'] for i in (17, 18, 19, 20)}}
    for i, p in enumerate(lm):
        # A bead just proud of the wood at each joint; at the wrist, a bigger one.
        r = 0.0115 if i == 0 else finger[i] * (0.82 if i in (4, 8, 12, 16, 20) else 1.06)
        if i in (4, 8, 12, 16, 20):  # tips: out at the end of the finger
            prev = lm[i - 1]
            p = p + (p - prev).normalized() * finger[i] * 0.55
        b = P.ball(f'lm{i:02d}', r, col, glow, loc=tuple(p), seg=16)
        b.parent = root
        beads.append(b)
    line = geo.glow('landmark_line', BRUSH, 1.6)
    front = Vector((0.0, -0.0135, 0.0))
    for a, b in ((0, 1), (0, 5), (5, 9), (9, 13), (13, 17), (0, 17), (5, 6), (6, 7), (7, 8)):
        pa, pb = lm[a] + front, lm[b] + front
        if a >= 5 and b <= 8:  # along the pointing finger: on its palm side
            pa, pb = lm[a] + Vector((0, -0.0085, 0)), lm[b] + Vector((0, -0.0085, 0))
        o = P.rod(f'lm_line_{a}_{b}', tuple(pa), tuple(pb), 0.0012, col, line, verts=8)
        o.parent = root
    return beads


# ---------------------------------------------------------------- the stroke

STAR_C, STAR_R = Vector((0.138, -0.03, 0.652)), 0.15


def stroke_points(tip):
    """A star drawn in one line, beside the hand, and the short lead from its
    last corner to the fingertip (where the line is being drawn now). Corners
    are rounded the way a hand moving fast rounds them; the drawing bows
    slightly toward the camera."""
    def corner(k):
        a = math.radians(90 + 72 * k)
        return STAR_C + STAR_R * Vector((math.cos(a), 0.0, math.sin(a)))
    order = [1, 3, 0, 2, 4, 1]
    pts = [corner(k) for k in order]
    t = Vector(tip)
    pts += [pts[-1].lerp(t, 0.5) + Vector((0.0, -0.01, 0.035)), t]
    for _ in range(3):  # Chaikin: round the corners, keep the ends
        nxt = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            nxt += [a.lerp(b, 0.25), a.lerp(b, 0.75)]
        nxt.append(pts[-1])
        pts = nxt
    dense = []
    for a, b in zip(pts, pts[1:]):
        n = max(1, int((b - a).length / 0.004))
        dense += [a.lerp(b, i / n) for i in range(n)]
    dense.append(pts[-1])
    out = []
    for p in dense:
        d = ((p.x - STAR_C.x) ** 2 + (p.z - STAR_C.z) ** 2) / STAR_R ** 2
        out.append(p + Vector((0.0, -0.022 * max(0.0, 1 - d), 0.0)))
    return out


def stroke_path(pts):
    """u in 0..1 along the line, by length."""
    acc = [0.0]
    for a, b in zip(pts, pts[1:]):
        acc.append(acc[-1] + (b - a).length)
    total = acc[-1]

    def f(u):
        s = max(0.0, min(1.0, u)) * total
        lo, hi = 0, len(acc) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if acc[mid] <= s:
                lo = mid
            else:
                hi = mid
        seg = acc[hi] - acc[lo]
        k = (s - acc[lo]) / seg if seg > 0 else 0.0
        return pts[lo].lerp(pts[hi], k)
    return f


def _tube(name, pts, radii, col, material):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 1.0
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for p, xyz, r in zip(sp.points, pts, radii):
        p.co = (*xyz, 1)
        p.radius = r
    o = C.link(bpy.data.objects.new(name, cu), col)
    cu.materials.append(material)
    return geo.tag(geo.realize(o), 'set')


def _stroke(col, tip):
    line = stroke_points(tip)
    f = stroke_path(line)
    n = len(line)
    # Thin where it started, full width toward the finger.
    radii = [0.0028 + 0.0028 * C.smoothstep(0.0, 0.3, i / (n - 1)) for i in range(n)]
    _tube('stroke', [tuple(p) for p in line], radii, col, geo.glow('stroke', BRUSH, 2.2))
    beads = []
    hot = geo.glow('stroke_pulse', '#c9f8ff', 5.0)
    for j in range(3):
        b = P.ball(f'pulse{j}', 1.0, col, hot, seg=16)
        P.no_shadow(b)
        beads.append(b)
    return f, beads


# ---------------------------------------------------------------- build + move

def build(col):
    _stand(col)
    root, lm = _hand(col)
    _landmarks(col, root, lm)
    bpy.context.view_layer.update()
    tip = hand_matrix() @ (lm[8] + Vector((0.0, -0.002, 0.009)))
    f, beads = _stroke(col, tip)
    P.no_ghosts(col)
    return {'path': f, 'beads': beads}


def animate(t, st):
    f = st['path']
    for j, b in enumerate(st['beads']):
        u = (2 * t + j / 3) % 1.0
        b.location = f(u)
        s = 0.0095 * C.smoothstep(0.0, 0.04, u) * (1 - C.smoothstep(0.96, 1.0, u))
        s = max(s, 1e-4)
        b.scale = (s, s, s)
