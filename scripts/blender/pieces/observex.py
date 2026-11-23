"""
ObserveX: the front door at night, as the app watches it.

The app (stream_rtsp.py in its own, private repo) reads each RTSP camera and
looks for the threats this scene is made of, and draws them as its dashboard
does, in its own colours:
  - a person whose face cannot be seen: the magenta box labelled
    MASKED/UNKNOWN PERSON (MaskedPersonDetector)
  - a weapon: a red box from its fine-tuned YOLOv12m (WeaponDetector)
  - loitering: the ring at the figure's feet fills a mark a second; at 20 s
    the app raises an alert, at 40 s a critical one (LoiteringMonitor)
  - a number plate, read with EasyOCR and boxed amber while it is unknown
  - the text the owner gets (its weapon and masked-person messages, as the
    app words them) on the phone on its stand, and the dashboard on the
    monitor inside, behind the wall
The camera over the door pans, its view drawn as a frustum.

A house front at about 1:6: brick (Bricks086), a teak door (Wood066), a drive
of interlocking pavers (PavingStones099) and a lawn (Grass004), the camera's
housing and the gate powder-coated metal (Metal027): scanned surfaces,
ambientCG, CC0. The
figure is a jointed wooden toy in a hoodie: no face is modelled, and none is
used. The plate is invented, with a district code (00) no registration has.
"""

from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import common as C
from kit import geo, props
from pieces import _kit as K
from pieces import _parts as P
from pieces import _scans as S

META = {
    'id': 'observex',
    'tag': ('OBSERVEX', '', 'HOME SECURITY  2026'),
    'accent': '#3b82f6',
    'disc': '#141926',
}

# The app's colours: its stylesheet, and the boxes stream_rtsp.py draws.
BLUE, GREEN, AMBER, RED, MAGENTA = '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#ff00ff'
BG, SIDEBAR, CARD, TEXT, MUTED = '#0a0e17', '#0f1320', '#141926', '#e8edf5', '#8b95a8'

R = K.DISC_R - 0.006        # the ground's edge
G = 0.012                   # the yard's top
PL = G + 0.05               # the plinth: the house floor, the porch, the door's sill
WY0, WY1 = 0.07, 0.106      # the front wall's faces
XL, XR = -0.352, 0.352      # its ends
TOP = 0.60                  # the parapet's top
BAND = (0.532, 0.556)       # the roof slab's edge, a band across the front
LEDGE = WY0 - 0.012         # the plinth's face, a little proud of the wall
DOOR = (-0.035, 0.125, PL, PL + 0.35)        # x0, x1, z0, z1 of the opening
WIN = (0.19, 0.31, PL + 0.17, PL + 0.35)
VENT = (-0.29, -0.21, 0.43, 0.48)
PORCH = (-0.215, 0.16, -0.085)               # x0, x1, its front edge
STEPS = (-0.07, 0.16)                        # x0, x1 of the two steps
LAWN = (-0.11, -0.10)                        # its corner: the lawn is the front left

FIG = Vector((-0.125, -0.012, PL))           # where the figure stands
FIG_YAW = 70.0                               # facing the door, a little toward us
HEAD_YAW = -52.0                             # ...its head turned to the street
SECS = 40                                    # the ring: one mark a second, to 40 s
RING = (0.046, 0.055)
FILL_PHASE = 26 / SECS * 0.9                 # the still (t = 0) shows 26 s

CAM_AT = Vector((0.25, WY0, 0.512))          # the camera's wall plate, under the roof's edge
# Its aim (degrees) and sweep: toward the figure, as far round as the frustum
# can turn before its near side would cut into the wall it hangs on.
PAN0, PAN_AMP, TILT = -64.0, 9.0, 38.0
FRUSTUM = (0.40, 17.0, 12.0)                 # length, half angles across and down

SCOOT = Vector((0.238, -0.112, G))
SCOOT_YAW = -9.0
GATE = Vector((0.295, -0.205, G))            # the gate post the scooter came in by
PHONE = Vector((-0.245, -0.19, G))
PHONE_YAW = 12.0
DESK = Vector((-0.205, 0.15, PL))            # inside: the desk against the wall


# ---------------------------------------------------------------- small helpers

def _arc_poly(r, a0, a1, n):
    """Points on a circle of radius r from angle a0 to a1 (degrees)."""
    return [(r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def _chord_x(y, r=R):
    return math.sqrt(max(0.0, r * r - y * y))


def _bool(o, cutter):
    """o minus cutter (applied); the cutter goes."""
    m = o.modifiers.new('cut', 'BOOLEAN')
    m.operation = 'DIFFERENCE'
    m.object = cutter
    try:
        m.solver = 'EXACT'
    except Exception:
        pass
    C.apply_modifiers(o)
    bpy.data.objects.remove(cutter, do_unlink=True)
    return o


def _cut(o, holes, col, y=(WY0 + WY1) / 2):
    """Openings through a wall: each (x0, x1, z0, z1), right through it."""
    for i, (x0, x1, z0, z1) in enumerate(holes):
        _bool(o, geo.box(f'_cut{i}', (x1 - x0, 0.3, z1 - z0), ((x0 + x1) / 2, y, z0), col=col, bev=0))
    return o


def _words(name, body, size, col, mat, x=0.0, y=0.0, z=0.0005, align='LEFT', depth=0.0002):
    """Words lying in the local XY plane (a screen's face), in Geist."""
    return geo.text(name, body, size=size, depth=depth, loc=(x, y, z), rot=(0, 0, 0), col=col, material=mat,
                    align=align, font_path=P.SANS, resolution=2)


def _rrect(name, w, h, r, col, mat, x=0.0, y=0.0, z=0.0, t=0.0003, n=4):
    """A rounded rectangle lying in the local XY plane, centred on (x, y)."""
    r = min(r, w / 2, h / 2)
    pts = []
    for cx, cy, a in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(n + 1):
            th = math.radians(a + 90 * i / n)
            pts.append((x + cx + r * math.cos(th), y + cy + r * math.sin(th)))
    return geo.extrude(name, pts, t, z=z, col=col, material=mat, bev=0)


def _cage(name, col, mat, lo, hi, arm=0.28, th=0.0026):
    """The detector's box as corner brackets on a cuboid from lo to hi (piece
    space): an axis-aligned box, as the dashboard draws one on the frame."""
    lo, hi = Vector(lo), Vector(hi)
    size = hi - lo
    parts = []
    for cx in (0, 1):
        for cy in (0, 1):
            for cz in (0, 1):
                corner = Vector((hi.x if cx else lo.x, hi.y if cy else lo.y, hi.z if cz else lo.z))
                for ax, s in enumerate((cx, cy, cz)):
                    d = Vector((0.0, 0.0, 0.0))
                    d[ax] = (-1 if s else 1) * size[ax] * arm
                    end = corner + d
                    mid = (corner + end) / 2
                    dims = [th, th, th]
                    dims[ax] = abs(d[ax]) + th
                    parts.append(geo.box(f'{name}_arm', tuple(dims), (mid.x, mid.y, mid.z - dims[2] / 2), col=col, material=mat, bev=0))
    return P.no_shadow(P.join(parts, name, col))


def _badge(name, body, col, bg, fg, at, size=0.0095, parent=None):
    """The app's label over a box: a plate of the box's colour with the words
    on it, standing and facing the front (-y), its foot at `at`."""
    g = P.group(name, col, loc=tuple(at), parent=parent)
    t = geo.text(f'{name}_text', body, size=size, depth=0.0003, loc=(0, -0.0017, 0), rot=(90, 0, 0), col=col, material=fg,
                 align='CENTER', font_path=P.SANS, resolution=2)
    bpy.context.view_layer.update()
    w = t.dimensions.x + size * 1.1
    h = size * 1.55
    t.location.z = h / 2 - size * 0.04
    t.parent = g
    P.no_shadow(geo.box(f'{name}_plate', (w, 0.0024, h), (0, 0, 0), col=col, material=bg, bev=0.0007)).parent = g
    P.no_shadow(t)
    return g


def _bounds(names):
    """Piece-space bounds of these objects' vertices."""
    bpy.context.view_layer.update()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for n in names:
        o = bpy.data.objects[n]
        if o.type != 'MESH':
            continue
        mw = o.matrix_world
        for v in o.data.vertices:
            p = mw @ v.co
            lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
            hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
    return lo, hi


def _meshes(root):
    return [c.name for c in root.children_recursive if c.type == 'MESH']


def _sphere_part(name, r, scale, keep, col, mat, loc, thick=0.0, seg=32):
    """A sphere trimmed to the faces keep(x, y, z) accepts (unit-sphere
    coordinates), given a thickness: a hood, a mask."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=1.0, location=(0, 0, 0))
    o = bpy.context.active_object
    bm = bmesh.new()
    bm.from_mesh(o.data)
    kill = [f for f in bm.faces if not keep(*f.calc_center_median())]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(o.data)
    bm.free()
    o.scale = (r * scale[0], r * scale[1], r * scale[2])
    C.apply_transform(o)
    o.location = loc
    if thick:
        m = o.modifiers.new('thick', 'SOLIDIFY')
        m.thickness = thick
        m.offset = 1.0
        C.apply_modifiers(o)
    return geo._finish(o, name, col, mat, 'set', True, {})


# ---------------------------------------------------------------- materials

def _brick(name='brick', tint='#8a4a37'):
    """Bricks086 is a 2:1 tile (2.6 by 1.3 m). The scan helper scales x and z
    alike; set here, the mapping keeps the bricks their own shape on the
    wall's faces (x along, z up) and on its ends (y along, z up)."""
    sx, sz = 2.6 / 6, 1.3 / 6
    m = S.scanned(name, 'Bricks086', tint=tint, size=sx, rough=0.84, bump=0.8)
    mp = next((n for n in m.node_tree.nodes if n.type == 'MAPPING'), None)
    if mp is not None:
        mp.inputs['Scale'].default_value = (1 / sx, 1 / sx, 1 / sz)
    return m


def _mats():
    return {
        'brick': _brick(),
        'plaster': geo.textured('plaster_in', 'white_plaster_02', tint='#e7e0d3', rough=0.88, scale=0.25, strength=0.45),
        'paint': geo.textured('plaster_out', 'painted_plaster_wall', tint='#d6ccb9', rough=0.82, scale=0.2, strength=0.5),
        'stone': S.scanned('plinth_stone', 'Concrete046', tint='#736e66', size=0.3, rough=0.75, bump=0.5),
        'granite': geo.textured('granite', 'terrazzo_tiles', tint='#4b4744', rough=0.24, scale=0.09, strength=0.4),
        'coping': S.scanned('coping', 'Concrete048', tint='#a39e95', size=0.25, rough=0.8, bump=0.35),
        'teak': S.scanned('teak', 'Wood066', tint='#6a3f22', size=0.4 / 6 * 2, rough=0.42, bump=0.25, rot=(0, 90, 0)),
        'teak_flat': S.scanned('teak_flat', 'Wood066', tint='#6a3f22', size=0.4 / 6 * 2, rough=0.42, bump=0.25),
        'brass': K.brass('house_brass'),
        'black': geo.pbr('iron_black', '#141517', rough=0.45, metal=0.55),
        'shell': S.scanned('cam_shell', 'Metal027', tint='#e4e2dc', size=0.08, rough=0.36, bump=0.12),
    }


# ---------------------------------------------------------------- the ground

def _ground(col, m):
    """The yard (interlocking pavers) with the lawn let into it at the front
    left, and the plinth the house stands on: its floor, the porch and the
    steps. Each surface is the only one under its own patch of ground: the
    live jar's glass maps the ground by the lowest surface facing up."""
    pavers = S.scanned('pavers', 'PavingStones099', tint='#8b8883', size=2.0 / 6, rough=0.62, bump=0.55)
    grass = S.scanned('lawn', 'Grass004', tint='#4b6631', size=1.4 / 6, rough=0.92, bump=0.9)
    cx = _chord_x(LEDGE)
    a_ledge = math.degrees(math.atan2(LEDGE, cx))
    lx, ly = LAWN
    a_lawn0 = math.degrees(math.atan2(ly, -_chord_x(ly)))           # where the lawn's top edge meets the rim
    a_lawn1 = math.degrees(math.atan2(-_chord_x(lx), lx))          # ...and its right edge
    px0, px1, py = PORCH
    sx0, sx1 = STEPS
    sy = py - 0.06
    yard = [(-cx, LEDGE), (px0, LEDGE), (px0, py), (sx0, py), (sx0, sy), (sx1, sy), (sx1, LEDGE), (cx, LEDGE)]
    yard += _arc_poly(R, a_ledge, a_lawn1 + 360 if a_lawn1 < a_ledge - 360 else a_lawn1, 40)[1:]
    yard += [(lx, ly)]
    yard += _arc_poly(R, a_lawn0, -180 - a_ledge, 6)
    geo.extrude('yard', yard[:-1], G, col=col, material=pavers, bev=0)
    lawn = [(lx, ly)] + _arc_poly(R, a_lawn0, a_lawn1, 14)
    geo.extrude('lawn', lawn, G + 0.0025, col=col, material=grass, bev=0)
    kerb = geo.pbr('kerb', '#8e8a83', rough=0.8)
    geo.box('kerb_x', (abs(-_chord_x(ly) - lx) - 0.004, 0.006, G + 0.005), ((lx - _chord_x(ly)) / 2 - 0.002, ly + 0.003, 0), col=col, material=kerb, bev=0.0012)
    geo.box('kerb_y', (0.006, abs(-_chord_x(lx) - ly), G + 0.005), (lx + 0.003, (ly - _chord_x(lx)) / 2, 0), col=col, material=kerb, bev=0.0012)

    # The house's plinth under the wall and the rooms: stone faces, no top
    # (the floor and the ledge are its top).
    back = [(-cx, LEDGE), (cx, LEDGE)] + _arc_poly(R, a_ledge, 180 - a_ledge, 48)[1:-1]
    geo.extrude('plinth', back, PL - 0.003, col=col, material=m['stone'], bev=0, caps='bottom')
    geo.extrude('porch', [(px0, py), (px1, py), (px1, LEDGE), (px0, LEDGE)], PL - 0.003, col=col, material=m['stone'], bev=0, caps='bottom')
    # The porch's granite top, the ledge along the front, and the steps.
    geo.box('porch_top', (px1 - px0 + 0.006, LEDGE - py + 0.003, 0.004), ((px0 + px1) / 2, (py + LEDGE) / 2 - 0.0015, PL - 0.004), col=col, material=m['granite'], bev=0.0012)
    cl = _chord_x(WY0)
    geo.box('ledge', (2 * cl - 0.002, WY0 - LEDGE + 0.002, 0.004), (0, (LEDGE + WY0) / 2, PL - 0.004), col=col, material=m['granite'], bev=0.0008)
    for i, (y0, y1, top) in enumerate(((py - 0.03, py, PL - 0.017), (sy, py - 0.03, PL - 0.034))):
        geo.box(f'step{i}', (sx1 - sx0, y1 - y0, top - 0.004), ((sx0 + sx1) / 2, (y0 + y1) / 2, 0), col=col, material=m['stone'], bev=0)
        geo.box(f'step{i}_tread', (sx1 - sx0 + 0.004, y1 - y0 + 0.003, 0.004), ((sx0 + sx1) / 2, (y0 + y1) / 2 - 0.0015, top - 0.004), col=col, material=m['granite'], bev=0.0012)
    # Inside: the floor, marble.
    floor = [(-_chord_x(WY0), WY0), (_chord_x(WY0), WY0)] + _arc_poly(R, math.degrees(math.atan2(WY0, _chord_x(WY0))), 180 - math.degrees(math.atan2(WY0, _chord_x(WY0))), 48)[1:-1]
    geo.extrude('floor', floor, 0.003, z=PL - 0.003, col=col, material=geo.textured('floor_marble', 'marble_01', tint='#d9d3c7', rough=0.22, scale=0.15, strength=0.55), bev=0)


# ---------------------------------------------------------------- the house front

def _wall(col, m):
    dx0, dx1, dz0, dz1 = DOOR
    wx0, wx1, wz0, wz1 = WIN
    vx0, vx1, vz0, vz1 = VENT
    z0 = PL - 0.003
    wall = geo.box('wall', (XR - XL, WY1 - WY0, TOP - 0.006 - z0), (0, (WY0 + WY1) / 2, z0), col=col, material=m['brick'], bev=0)
    _cut(wall, [(dx0, dx1, dz0 - 0.01, dz1), (wx0, wx1, wz0, wz1), (vx0, vx1, vz0, vz1)], col)
    # Plaster inside, the same openings.
    skin = geo.box('wall_inside', (XR - XL - 0.002, 0.0025, TOP - 0.006 - PL), (0, WY1 + 0.00125, PL), col=col, material=m['plaster'], bev=0)
    _cut(skin, [(dx0, dx1, dz0 - 0.01, dz1), (wx0, wx1, wz0, wz1), (vx0, vx1, vz0, vz1)], col, y=WY1 + 0.00125)
    geo.box('skirting', (XR - XL - 0.002, 0.0016, 0.012), (0, WY1 + 0.0033, PL), col=col, material=geo.pbr('skirting', '#4a3a2e', rough=0.5), bev=0)
    # The roof slab's edge, the parapet's coping.
    geo.box('band', (XR - XL + 0.016, 0.012, BAND[1] - BAND[0]), (0, WY0 - 0.004, BAND[0]), col=col, material=m['paint'], bev=0.0015)
    geo.box('coping', (XR - XL + 0.01, WY1 - WY0 + 0.01, 0.007), (0, (WY0 + WY1) / 2, TOP - 0.007), col=col, material=m['coping'], bev=0.0015)
    # A drip ledge over each opening: the sunshades (chajja).
    for name, x0, x1, z, d in (('shade_door', dx0 - 0.024, dx1 + 0.024, dz1 + 0.024, 0.06), ('shade_win', wx0 - 0.022, wx1 + 0.022, wz1 + 0.024, 0.042)):
        geo.box(name, (x1 - x0, d, 0.011), ((x0 + x1) / 2, WY0 - d / 2 + 0.002, z), col=col, material=m['paint'], bev=0.0018)
    # The rainwater pipe at the right end, with its clamps and shoe.
    pvc = geo.pbr('pvc', '#8f969c', rough=0.45)
    px, py = XR - 0.016, WY0 - 0.0095
    geo.tube('downpipe', [(px, py, BAND[0] + 0.004), (px, py, G + 0.022), (px, py - 0.006, G + 0.012), (px, py - 0.018, G + 0.009)], radius=0.0055, col=col, material=pvc, resolution=3)
    for i, z in enumerate((0.16, 0.32, 0.46)):
        geo.box(f'pipe_clamp{i}', (0.015, 0.012, 0.004), (px, py + 0.003, z), col=col, material=pvc, bev=0.001)
    geo.box('pipe_head', (0.02, 0.016, 0.014), (px, py, BAND[0] - 0.012), col=col, material=pvc, bev=0.002)


def _door(col, m):
    """The teak door, shut, in its frame; brass handle and lock."""
    dx0, dx1, dz0, dz1 = DOOR
    fw = 0.011
    yc = (WY0 + WY1) / 2
    depth = WY1 - WY0 + 0.006
    teak, flat, brass = m['teak'], m['teak_flat'], m['brass']
    for i, x in enumerate((dx0 + fw / 2, dx1 - fw / 2)):
        geo.box(f'door_jamb{i}', (fw, depth, dz1 - dz0), (x, yc, dz0), col=col, material=teak, bev=0.0015)
    geo.box('door_head', (dx1 - dx0, depth, fw), ((dx0 + dx1) / 2, yc, dz1 - fw), col=col, material=flat, bev=0.0015)
    # architrave round the front
    for i, x in enumerate((dx0 - 0.004, dx1 + 0.004)):
        geo.box(f'door_arch{i}', (0.009, 0.004, dz1 - dz0 + 0.008), (x, WY0 - 0.002, dz0), col=col, material=teak, bev=0.001)
    geo.box('door_arch_top', (dx1 - dx0 + 0.017, 0.004, 0.009), ((dx0 + dx1) / 2, WY0 - 0.002, dz1 + 0.0), col=col, material=flat, bev=0.001)
    geo.box('door_sill', (dx1 - dx0 + 0.008, depth + 0.004, 0.004), ((dx0 + dx1) / 2, yc - 0.002, dz0 - 0.004), col=col, material=m['granite'], bev=0.001)

    lx0, lx1 = dx0 + fw + 0.0008, dx1 - fw - 0.0008
    lz0, lz1 = dz0, dz1 - fw - 0.0008
    w, h = lx1 - lx0, lz1 - lz0
    ly = WY0 + 0.012
    leaf = [geo.box('door_leaf', (w, 0.01, h), ((lx0 + lx1) / 2, ly, lz0), col=col, material=teak, bev=0.001)]
    # Raised panels, three high, on both faces.
    rows = ((0.03, 0.11), (0.155, 0.075), (0.245, 0.075))
    for face, yy in ((-1, ly - 0.0052), (1, ly + 0.0052)):
        for k, (z, hh) in enumerate(rows):
            for j, (a, b) in enumerate(((0.016, w / 2 - 0.007), (w / 2 + 0.007, w - 0.016))):
                leaf.append(geo.box(f'door_panel{face}_{k}{j}', (b - a, 0.003, hh), (lx0 + (a + b) / 2, yy, lz0 + z), col=col, material=teak, bev=0.0011))
    for o in leaf:
        o['door'] = 1
    hx = lx1 - 0.016
    for face in (-1, 1):
        yy = ly + face * 0.006
        geo.box(f'door_lockplate{face}', (0.008, 0.002, 0.03), (hx, yy, lz0 + 0.165), col=col, material=brass, bev=0.0006)
        P.rod(f'door_handle{face}', (hx, yy, lz0 + 0.185), (hx, yy + face * 0.008, lz0 + 0.185), 0.0018, col, brass, verts=10)
        P.rod(f'door_lever{face}', (hx, yy + face * 0.008, lz0 + 0.185), (hx - 0.022, yy + face * 0.008, lz0 + 0.185), 0.0017, col, brass, verts=10)
        geo.cyl(f'door_keyhole{face}', 0.0016, 0.0012, (hx, yy + face * 0.0006, lz0 + 0.168), rot=(90, 0, 0), col=col, material=m['black'], verts=10, bev=0)
    # and a peephole
    geo.cyl('door_peephole', 0.0028, 0.002, ((lx0 + lx1) / 2, ly - 0.0062, lz0 + 0.27), rot=(90, 0, 0), col=col, material=brass, verts=14, bev=0.0004)


def _window(col, m):
    """A window with a steel grille in front, two glazed shutters in a teak
    frame, and lit curtains behind: someone is home."""
    wx0, wx1, wz0, wz1 = WIN
    yc = (WY0 + WY1) / 2
    depth = WY1 - WY0 + 0.004
    fw = 0.008
    teak = m['teak']
    for i, x in enumerate((wx0 + fw / 2, wx1 - fw / 2)):
        geo.box(f'win_jamb{i}', (fw, depth, wz1 - wz0), (x, yc, wz0), col=col, material=teak, bev=0.0012)
    for i, z in enumerate((wz0, wz1 - fw)):
        geo.box(f'win_rail{i}', (wx1 - wx0, depth, fw), ((wx0 + wx1) / 2, yc, z), col=col, material=m['teak_flat'], bev=0.0012)
    geo.box('win_mullion', (fw * 0.8, depth - 0.006, wz1 - wz0 - 2 * fw), ((wx0 + wx1) / 2, yc, wz0 + fw), col=col, material=teak, bev=0.001)
    # the sill, granite, proud of the wall
    geo.box('win_sill', (wx1 - wx0 + 0.02, 0.018, 0.006), ((wx0 + wx1) / 2, WY0 - 0.005, wz0 - 0.006), col=col, material=m['granite'], bev=0.0012)
    # glass, a little reflective
    glass = geo.pbr('win_glass', '#93a6b8', rough=0.06, alpha=0.22)
    geo.box('win_glass', (wx1 - wx0 - 2 * fw, 0.0015, wz1 - wz0 - 2 * fw), ((wx0 + wx1) / 2, yc + 0.004, wz0 + fw), col=col, material=glass, bev=0)
    # the curtains behind, lit warm from the room
    warm = geo.pbr('curtain', '#e9cda4', rough=0.92, emit='#ffc47e', emit_strength=0.75)
    for i, (a, b) in enumerate(((wx0 + fw, wx0 + (wx1 - wx0) * 0.42), (wx0 + (wx1 - wx0) * 0.58, wx1 - fw))):
        n = 14
        pts = [(a + (b - a) * k / n, WY1 + 0.006 + 0.0028 * math.sin(k * math.pi * 0.9)) for k in range(n + 1)]
        pts += [(x, y + 0.0016) for x, y in reversed(pts)]
        geo.extrude(f'curtain{i}', pts, wz1 - wz0 - 0.01, z=wz0 + 0.004, col=col, material=warm, bev=0)
    # the grille: square bars, set in the opening's front
    iron = m['black']
    gy = WY0 + 0.004
    n = 6
    for i in range(1, n):
        x = wx0 + fw + (wx1 - wx0 - 2 * fw) * i / n
        geo.box(f'grille_v{i}', (0.0026, 0.0026, wz1 - wz0 - 2 * fw), (x, gy, wz0 + fw), col=col, material=iron, bev=0)
    for i, f in enumerate((0.33, 0.66)):
        geo.box(f'grille_h{i}', (wx1 - wx0 - 2 * fw, 0.0022, 0.0026), ((wx0 + wx1) / 2, gy - 0.0024, wz0 + fw + (wz1 - wz0 - 2 * fw) * f), col=col, material=iron, bev=0)


def _vent(col, m):
    """A ventilator high on the left: glass louvres in a frame."""
    vx0, vx1, vz0, vz1 = VENT
    yc = (WY0 + WY1) / 2
    for i, x in enumerate((vx0 + 0.003, vx1 - 0.003)):
        geo.box(f'vent_jamb{i}', (0.006, WY1 - WY0 + 0.003, vz1 - vz0), (x, yc, vz0), col=col, material=m['teak'], bev=0.0008)
    for i, z in enumerate((vz0, vz1 - 0.006)):
        geo.box(f'vent_rail{i}', (vx1 - vx0, WY1 - WY0 + 0.003, 0.006), ((vx0 + vx1) / 2, yc, z), col=col, material=m['teak_flat'], bev=0.0008)
    louvre = geo.pbr('vent_glass', '#a9b8c4', rough=0.25, alpha=0.55)
    for i in range(4):
        z = vz0 + 0.009 + i * 0.0105
        geo.box(f'louvre{i}', (vx1 - vx0 - 0.012, 0.0012, 0.0115), ((vx0 + vx1) / 2, yc, z), rot=(28, 0, 0), col=col, material=louvre, bev=0)
    geo.box('vent_glow', (vx1 - vx0 - 0.012, 0.001, vz1 - vz0 - 0.012), ((vx0 + vx1) / 2, WY1 - 0.004, vz0 + 0.006), col=col,
            material=geo.pbr('vent_room', '#d9bf98', rough=0.9, emit='#ffb36b', emit_strength=0.35), bev=0)


def _fixtures(col, m):
    """By the door: the porch lantern, the video doorbell and the house number."""
    black = geo.pbr('lantern_black', '#18181a', rough=0.42, metal=0.6)
    lit = geo.glow('lantern_light', '#ffcf8f', 4.2)
    lx, lz = 0.157, 0.33
    root = P.group('lantern', col, loc=(lx, WY0, lz))
    parts = [geo.box('lantern_plate', (0.016, 0.004, 0.032), (0, -0.002, -0.016), col=col, material=black, bev=0.0012)]
    parts.append(P.rod('lantern_arm', (0, -0.004, 0.004), (0, -0.017, 0.004), 0.0022, col, black, verts=10))
    c = Vector((0, -0.024, -0.003))
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(geo.box('lantern_post', (0.0024, 0.0024, 0.036), (c.x + sx * 0.0085, c.y + sy * 0.0085, c.z - 0.018), col=col, material=black, bev=0))
    parts.append(geo.box('lantern_base', (0.022, 0.022, 0.0035), (c.x, c.y, c.z - 0.0205), col=col, material=black, bev=0.001))
    roof = geo.lathe('lantern_roof', [(0.0, 0.0), (0.0165, 0.0), (0.012, 0.004), (0.0035, 0.012), (0.0, 0.014)], col, black, segments=4)
    roof.rotation_euler = (0, 0, math.radians(45))      # its corners over the posts
    roof.location = (c.x, c.y, c.z + 0.018)
    parts.append(roof)
    parts.append(P.rod('lantern_finial', (c.x, c.y, c.z + 0.031), (c.x, c.y, c.z + 0.036), 0.0018, col, black, verts=8))
    for p in parts:
        p.parent = root
    glow = geo.box('lantern_glass', (0.0165, 0.0165, 0.033), (c.x, c.y, c.z - 0.0168), col=col, material=lit, bev=0.0008)
    P.no_shadow(glow).parent = root

    # the video doorbell: a lens over a lit button
    bell = P.group('doorbell', col, loc=(0.147, WY0, 0.25))
    dark = geo.pbr('bell_black', '#111215', rough=0.3)
    geo.box('bell_body', (0.014, 0.005, 0.03), (0, -0.0025, -0.015), col=col, material=dark, bev=0.0035).parent = bell
    geo.cyl('bell_lens', 0.0032, 0.0012, (0, -0.0052, 0.007), rot=(90, 0, 0), col=col, material=geo.pbr('bell_lens', '#020203', rough=0.05), verts=16, bev=0).parent = bell
    ring = P.ring('bell_ring', 0.0042, 0.0008, col, geo.glow('bell_ring', BLUE, 2.4), segments=24, sides=6)
    ring.rotation_euler = (math.radians(90), 0, 0)
    ring.location = (0, -0.0053, -0.006)
    P.no_shadow(ring).parent = bell

    # the house number, brass on granite
    plaque = P.group('plaque', col, loc=(-0.066, WY0, 0.25))
    geo.box('plaque_stone', (0.032, 0.004, 0.022), (0, -0.002, -0.011), col=col, material=m['granite'], bev=0.0012).parent = plaque
    P.heavy('plaque_no', '12', 0.0145, col, m['brass'], loc=(0, -0.0044, 0.0), depth=0.0012, weight=0.03).parent = plaque


# ---------------------------------------------------------------- the camera

def _camera(col, m):
    """A bullet camera on a wall arm, drawn about twice its size, with the
    frustum it sees through. The pan turns the body and the frustum."""
    shell = m['shell']
    mount = P.group('cam_mount', col, loc=tuple(CAM_AT))
    geo.box('cam_plate', (0.034, 0.006, 0.04), (0, -0.003, -0.022), col=col, material=shell, bev=0.0035).parent = mount
    for sx in (-1, 1):
        for sz in (-1, 1):
            geo.cyl('cam_screw', 0.0018, 0.0012, (sx * 0.011, -0.0066, -0.002 + sz * 0.013), rot=(90, 0, 0), col=col, material=K.brass('screw'), verts=8, bev=0).parent = mount
    P.rod('cam_arm', (0, -0.006, -0.004), (0, -0.028, -0.009), 0.0058, col, shell, verts=16).parent = mount
    geo.tube('cam_cable', [(0.006, -0.004, -0.012), (0.012, -0.012, -0.02), (0.012, -0.004, -0.032), (0.012, 0.0, -0.034)], radius=0.0016, col=col,
             material=geo.pbr('cable', '#1b1c1f', rough=0.6), resolution=2).parent = mount
    pan = P.group('cam_pan', col, loc=(0, -0.031, -0.01), rot=(0, 0, PAN0), parent=mount)
    P.ball('cam_joint', 0.0085, col, shell, seg=16).parent = pan
    tilt = P.group('cam_tilt', col, rot=(TILT, 0, 0), parent=pan)
    body = [P.rod('cam_body', (0, 0.012, 0), (0, -0.06, 0), 0.0165, col, shell, verts=32, bev=0.003)]
    body.append(P.rod('cam_neck', (0, 0.0, -0.002), (0, 0.0, 0.0), 0.006, col, shell, verts=12))
    # the sunshield: a curved hood over the top, past the lens
    arc = [(0.0205 * math.cos(math.radians(a)), 0.0205 * math.sin(math.radians(a))) for a in range(-20, 201, 10)]
    arc += [(0.0182 * math.cos(math.radians(a)), 0.0182 * math.sin(math.radians(a))) for a in range(200, -21, -10)]
    hood = geo.extrude('cam_hood', arc, 0.084, z=-0.006, col=col, material=shell, bev=0)
    hood.rotation_euler = (math.radians(90), 0, 0)
    body.append(hood)
    # the face: a dark glass front, the lens, eight IR LEDs round it (faint red)
    glass = geo.pbr('cam_front', '#050607', rough=0.04)
    body.append(geo.cyl('cam_face', 0.0152, 0.002, (0, -0.06, 0), rot=(90, 0, 0), col=col, material=glass, verts=32, bev=0))
    body.append(geo.cyl('cam_lens', 0.0068, 0.004, (0, -0.0605, 0), rot=(90, 0, 0), col=col, material=geo.pbr('cam_lens', '#0d1322', rough=0.02, metal=0.4), verts=24, bev=0.0008))
    ir = geo.glow('cam_ir', '#ff2d2d', 1.3)
    for i in range(8):
        a = math.radians(22.5 + i * 45)
        o = P.ball('cam_ir', 0.0015, col, ir, loc=(0.0112 * math.cos(a), -0.0626, 0.0112 * math.sin(a)), seg=8)
        P.no_shadow(o)
        body.append(o)
    led = P.ball('cam_led', 0.0014, col, geo.glow('cam_led', BLUE, 3.0), loc=(0.0, -0.045, -0.0163), seg=8)
    body.append(P.no_shadow(led))
    for o in body:
        o.parent = tilt

    # The frustum: its four faces barely there, its edges a line of light.
    L, ha, va = FRUSTUM
    apex = Vector((0, -0.064, 0))
    fx, fz = L * math.tan(math.radians(ha)), L * math.tan(math.radians(va))
    far = [Vector((sx * fx, -0.064 - L, sz * fz)) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    verts = [tuple(apex)] + [tuple(v) for v in far]
    faces = [(0, 1, 2), (0, 2, 3), (0, 3, 4), (0, 4, 1)]
    sheet = geo.mesh('frustum', verts, faces, col, P.soft_glow('frustum_fill', BLUE, 1.6, alpha=0.022))
    P.no_shadow(sheet).parent = tilt
    edge = P.soft_glow('frustum_edge', '#7fb0ff', 2.2, alpha=0.5)
    lines = [P.rod('frustum_ray', apex, v, 0.0009, col, edge, verts=6) for v in far]
    lines += [P.rod('frustum_rim', far[i], far[(i + 1) % 4], 0.0009, col, edge, verts=6) for i in range(4)]
    for o in lines:
        P.no_shadow(o).parent = tilt
    return pan


# ---------------------------------------------------------------- the figure

def _figure(col):
    """A jointed wooden toy in a hoodie and jeans, hood up and a black cloth
    mask over the lower half of a blank face. It stands by the door facing
    it, its head turned to the street; a kitchen knife held low in its right
    hand. Built facing -y (its right hand at -x), then turned."""
    root = P.group('figure', col, loc=tuple(FIG), rot=(0, 0, FIG_YAW))
    hoodie = geo.textured('hoodie', 'cotton_jersey', tint='#34373e', rough=0.92, scale=0.17, strength=0.7)
    jeans = geo.textured('jeans', 'denim_fabric_04', tint='#35455f', rough=0.86, scale=0.17, strength=0.75)
    wood = P.wood('toy_peg', '#cfae84', rough=0.5)
    mask = geo.pbr('mask_cloth', '#0f1012', rough=0.95)
    glove = S.scanned('gloves', 'Leather027', tint='#17171a', size=0.05, rough=0.42, bump=0.3)
    shoe = geo.pbr('shoe', '#202125', rough=0.6)
    sole = geo.pbr('sole', '#d9d5cc', rough=0.7)
    rib = geo.pbr('hoodie_rib', '#25282d', rough=0.95)

    # legs, shoes
    for s, side in ((-1, 'r'), (1, 'l')):
        hip = Vector((s * 0.0165, 0.002, 0.142))
        knee = Vector((s * 0.0178, -0.005, 0.078))
        ankle = Vector((s * 0.0192, 0.002, 0.016))
        P.limb(f'thigh_{side}', hip, knee, 0.0128, 0.0108, col, jeans, root)
        P.limb(f'shin_{side}', knee, ankle, 0.0103, 0.0083, col, jeans, root)
        geo.box(f'shoe_{side}', (0.0148, 0.036, 0.0105), (s * 0.0194, -0.008, 0.0028), col=col, material=shoe, bev=0.0042).parent = root
        geo.box(f'sole_{side}', (0.0152, 0.037, 0.0034), (s * 0.0194, -0.008, 0.0), col=col, material=sole, bev=0.0012).parent = root
    geo.sphere('pelvis', 0.025, (0, 0.002, 0.143), scale=(1.04, 0.74, 0.6), col=col, material=jeans, seg=24).parent = root

    # the hoodie: a body that hangs a little loose, its hem and pocket
    prof = [(0.0, 0.121), (0.0285, 0.121), (0.0312, 0.127), (0.0298, 0.15), (0.0306, 0.18), (0.0338, 0.207), (0.0355, 0.222),
            (0.031, 0.236), (0.025, 0.246), (0.019, 0.254), (0.0, 0.257)]
    body = geo.lathe('hoodie_body', prof, col, hoodie, segments=40)
    body.scale = (1.0, 0.72, 1.0)
    K.sharpen(body, 60).parent = root
    hem = P.ring('hoodie_hem', 0.0298, 0.0028, col, rib, z=0.125, segments=40, sides=8)
    hem.scale = (1.0, 0.72, 1.0)
    hem.parent = root
    geo.box('hoodie_pocket', (0.034, 0.003, 0.026), (0, -0.0222, 0.129), col=col, material=hoodie, bev=0.0012).parent = root
    for s in (-1, 1):
        geo.tube(f'hoodie_cord{s}', [(s * 0.0058, -0.0178, 0.25), (s * 0.0062, -0.0215, 0.236), (s * 0.0068, -0.0228, 0.214)], radius=0.0009, col=col,
                 material=geo.pbr('cord', '#d7d5cf', rough=0.8), resolution=2).parent = root

    # arms: the right one low and a little forward, gripping the knife
    arms = {
        'r': (Vector((-0.0352, 0.001, 0.226)), Vector((-0.0405, -0.005, 0.178)), Vector((-0.039, -0.017, 0.134))),
        'l': (Vector((0.0352, 0.001, 0.226)), Vector((0.041, 0.006, 0.178)), Vector((0.0398, 0.0005, 0.133))),
    }
    for side, (sh, el, wr) in arms.items():
        P.ball(f'shoulder_{side}', 0.0114, col, hoodie, loc=tuple(sh), seg=16).parent = root
        P.limb(f'sleeve_up_{side}', sh, el, 0.0108, 0.0096, col, hoodie, root)
        P.ball(f'elbow_{side}', 0.0098, col, hoodie, loc=tuple(el), seg=14).parent = root
        P.limb(f'sleeve_lo_{side}', el, wr, 0.0094, 0.0084, col, hoodie, root)
        cuff = P.ring(f'cuff_{side}', 0.0078, 0.0022, col, rib, segments=20, sides=6)
        cuff.location = wr
        cuff.rotation_euler = (wr - el).to_track_quat('Z', 'Y').to_euler()
        cuff.parent = root
        hand = P.ball(f'glove_{side}', 0.0086, col, glove, loc=tuple(wr + (wr - el).normalized() * 0.009), seg=16)
        hand.scale = (0.82, 0.92, 1.12)
        hand.rotation_euler = (wr - el).to_track_quat('Z', 'Y').to_euler()
        hand.parent = root

    # the head: hood, blank wooden face, mask. It turns (the scan) on the neck.
    head = P.group('head', col, loc=(0, 0.0, 0.252), rot=(0, 0, HEAD_YAW), parent=root)
    face = P.ball('face', 0.0186, col, wood, loc=(0, -0.001, 0.0155), seg=28)
    face.scale = (0.9, 1.0, 1.12)
    face.parent = head
    # The hood: a shell with an oval cut out of its front (a clean cut, not
    # the sphere's faces, whose steps showed up close) and a ribbed edge on it.
    hr, hs, hc = 0.0246, (1.0, 1.07, 1.1), Vector((0.0, 0.0045, 0.0172))
    hood = _sphere_part('hood', hr, hs, lambda x, y, z: True, col, hoodie, tuple(hc), thick=0.0022, seg=48)
    ax, az = 0.64 * hr * hs[0], 0.8 * hr * hs[2]
    zc = hc.z + 0.02 * hr * hs[2]
    y_cut = hc.y - 0.2 * hr * hs[1]
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=1.0, depth=0.05, location=(0, y_cut - 0.025, zc), rotation=(math.radians(90), 0, 0))
    cutter = bpy.context.active_object
    cutter.scale = (ax, az, 1.0)
    C.move_to(cutter, col)
    _bool(hood, cutter)
    hood.parent = head
    shell = [hr * s + 0.0011 for s in hs]          # the middle of the shell's thickness
    rim = []
    for k in range(48):
        a = 2 * math.pi * k / 48
        x, z = ax * math.cos(a), zc + az * math.sin(a)
        q = 1 - (x / shell[0]) ** 2 - ((z - hc.z) / shell[2]) ** 2
        rim.append((x, hc.y - shell[1] * math.sqrt(max(0.0, q)), z))
    geo.tube('hood_rim', rim, radius=0.0016, col=col, material=rib, resolution=2, closed=True).parent = head
    # The mask: over the nose and the mouth, up to just under where eyes would be.
    m = _sphere_part('mask', 0.0193, (0.92, 1.03, 1.12),
                     lambda x, y, z: z < 0.2 and y < 0.42,
                     col, mask, (0, -0.0012, 0.0155), thick=0.0011, seg=48)
    m.parent = head
    return root, head


def _knife(col, root):
    """A kitchen knife in the right fist, its blade forward and down: about
    one and a half times its size, so it reads at the jar's scale."""
    k = P.group('knife', col, loc=(-0.039, -0.012, 0.1255), rot=(13.0, 0, 0), parent=root)
    handle = geo.pbr('knife_handle', '#1b1714', rough=0.5)
    steel = geo.pbr('knife_steel', '#d5d8dd', rough=0.14, metal=1.0)
    parts = [geo.box('knife_grip', (0.0048, 0.026, 0.0074), (0, -0.013, -0.0037), col=col, material=handle, bev=0.0021)]
    for y in (-0.006, -0.02):
        for sx in (-1, 1):
            parts.append(geo.cyl('knife_rivet', 0.0011, 0.0006, (sx * 0.0024, y, 0), rot=(0, 90, 0), col=col, material=steel, verts=8, bev=0))
    parts.append(geo.box('knife_bolster', (0.0052, 0.003, 0.0082), (0, -0.0265, -0.0041), col=col, material=steel, bev=0.0008))
    # the blade: spine nearly straight, the edge curving up to the point
    prof = [(0.028, 0.0034), (0.062, 0.003), (0.082, 0.0018), (0.093, 0.0004), (0.088, -0.0027), (0.074, -0.0064), (0.056, -0.0088),
            (0.038, -0.0097), (0.028, -0.0097)]
    blade = geo.extrude('knife_blade', prof, 0.0012, z=-0.0006, col=col, material=steel, bev=0)
    rot = Matrix(((0.0, 0.0, -1.0), (-1.0, 0.0, 0.0), (0.0, 1.0, 0.0)))
    blade.rotation_euler = rot.to_euler()
    parts.append(blade)
    for p in parts:
        p.parent = k
    return k


def _loiter(col):
    """Forty marks round the figure's feet, one a second: amber to 20 s (the
    app's loitering alert), red to 40 s (its critical one)."""
    root = P.group('loiter', col, loc=(FIG.x, FIG.y, PL))
    r0, r1 = RING
    P.flat_ring('loiter_track', r0 - 0.0012, r1 + 0.0012, col, geo.pbr('loiter_track', '#1d2028', rough=0.55), h=0.0007, segments=96).parent = root
    amber = geo.glow('loiter_amber', AMBER, 2.4)
    red = geo.glow('loiter_red', RED, 2.6)
    marks = []
    step = 360 / SECS
    for i in range(SECS):
        a0 = 90 - i * step - 0.9
        a1 = 90 - (i + 1) * step + 0.9
        mid = math.radians((a0 + a1) / 2)
        c = Vector((math.cos(mid) * (r0 + r1) / 2, math.sin(mid) * (r0 + r1) / 2, 0.0))
        n = 4
        verts, faces = [], []
        for j in range(n + 1):
            a = math.radians(a1 + (a0 - a1) * j / n)
            for rr in (r0, r1):
                verts.append((rr * math.cos(a) - c.x, rr * math.sin(a) - c.y, 0.0012))
        for j in range(n):
            faces.append((2 * j, 2 * j + 1, 2 * j + 3, 2 * j + 2))
        o = geo.mesh(f'loiter_mark{i}', verts, faces, col, amber if i < SECS // 2 else red)
        o.location = c
        o.parent = root
        marks.append(P.no_shadow(o))
    # The two thresholds, printed outside the ring.
    for body, deg, mat in (('20 s', -90.0, geo.glow('loiter_t20', AMBER, 1.8)), ('40 s', 112.0, geo.glow('loiter_t40', RED, 1.8))):
        a = math.radians(deg)
        rr = r1 + 0.012
        P.no_shadow(P.label(f'loiter_{body[:2]}', body, 0.0105, col, mat, x=rr * math.cos(a), y=rr * math.sin(a), z=0.0008)).parent = root
    return marks


# ---------------------------------------------------------------- the scooter

def _scooter(col):
    """A generic step-through scooter on its stand, nose to the house, its
    rear plate to the street. Built facing +y, its wheels on z = 0."""
    root = P.group('scooter', col, loc=tuple(SCOOT), rot=(0, 0, SCOOT_YAW))
    paint = geo.pbr('scooter_paint', '#2d4855', rough=0.2, metal=0.4)
    b = paint.node_tree.nodes['Principled BSDF']
    try:
        b.inputs['Coat Weight'].default_value = 0.6
        b.inputs['Coat Roughness'].default_value = 0.08
    except KeyError:
        pass
    plastic = geo.pbr('scooter_black', '#17181a', rough=0.55)
    tyre = geo.pbr('tyre', '#111111', rough=0.85)
    alloy = geo.pbr('alloy', '#a2a8ae', rough=0.28, metal=0.9)
    chrome = geo.pbr('chrome', '#cdd1d6', rough=0.12, metal=1.0)
    seat = S.scanned('scooter_seat', 'Leather027', tint='#1e1e21', size=0.06, rough=0.5, bump=0.4)
    parts = []

    def wheel(name, y, rr, z):
        t = P.ring(f'{name}_tyre', rr - 0.0105, 0.0105, col, tyre, segments=48, sides=12)
        t.rotation_euler = (0, math.radians(90), 0)
        t.location = (0, y, z)
        parts.append(t)
        parts.append(geo.cyl(f'{name}_rim', rr - 0.016, 0.017, (-0.0085, y, z), rot=(0, 90, 0), col=col, material=alloy, verts=32, bev=0.0015))
        for k in range(5):
            a = math.radians(k * 72)
            parts.append(P.rod(f'{name}_spoke', (0.009, y, z), (0.009, y + (rr - 0.019) * math.cos(a), z + (rr - 0.019) * math.sin(a)), 0.0017, col, alloy, verts=6))
        parts.append(geo.cyl(f'{name}_hub', 0.0065, 0.022, (-0.011, y, z), rot=(0, 90, 0), col=col, material=chrome, verts=16, bev=0.001))

    wheel('rear', -0.09, 0.041, 0.041)
    wheel('front', 0.104, 0.043, 0.043)
    parts.append(geo.cyl('front_disc', 0.0175, 0.0012, (-0.0105, 0.104, 0.043), rot=(0, 90, 0), col=col, material=chrome, verts=24, bev=0))
    # the floorboard, its ribbed mat
    parts.append(geo.box('floorboard', (0.054, 0.104, 0.012), (0, 0.008, 0.045), col=col, material=plastic, bev=0.003))
    for i in range(6):
        parts.append(geo.box(f'floor_rib{i}', (0.046, 0.0016, 0.0008), (0, -0.032 + i * 0.016, 0.057), col=col, material=geo.pbr('rib', '#2a2b2e', rough=0.6), bev=0))
    # the rear body under the seat, and the seat
    parts.append(geo.box('cowl', (0.064, 0.122, 0.056), (0, -0.073, 0.05), col=col, material=paint, bev=0.017))
    parts.append(geo.box('cowl_skirt', (0.06, 0.07, 0.018), (0, -0.06, 0.04), col=col, material=plastic, bev=0.005))
    parts.append(geo.box('seat', (0.051, 0.112, 0.014), (0, -0.068, 0.1035), col=col, material=seat, bev=0.0065))
    parts.append(geo.tube('grab_rail', [(-0.023, -0.112, 0.109), (-0.022, -0.132, 0.106), (0.022, -0.132, 0.106), (0.023, -0.112, 0.109)], radius=0.0028, col=col,
                          material=plastic, resolution=2))
    # the tail lamp, the plate on its holder below it
    parts.append(geo.box('tail_lamp', (0.042, 0.008, 0.013), (0, -0.131, 0.08), col=col, material=geo.pbr('tail_lens', '#6e0b10', rough=0.12), bev=0.003))
    parts.append(geo.box('plate_holder', (0.05, 0.03, 0.006), (0, -0.124, 0.071), rot=(-12, 0, 0), col=col, material=plastic, bev=0.002))
    parts.append(geo.box('rear_flap', (0.032, 0.006, 0.032), (0, -0.125, 0.04), col=col, material=plastic, bev=0.002))
    # the muffler on the right
    parts.append(P.rod('muffler', (0.032, -0.052, 0.034), (0.032, -0.118, 0.042), 0.0092, col, plastic, verts=20, bev=0.002))
    parts.append(geo.box('muffler_guard', (0.004, 0.05, 0.012), (0.0418, -0.086, 0.032), col=col, material=chrome, bev=0.0014))
    # the leg shield and the front: apron, fender, fork, headlamp
    parts.append(geo.box('apron', (0.058, 0.014, 0.118), (0, 0.07, 0.052), rot=(-11, 0, 0), col=col, material=paint, bev=0.0065))
    parts.append(geo.box('apron_inner', (0.05, 0.006, 0.1), (0, 0.06, 0.056), rot=(-11, 0, 0), col=col, material=plastic, bev=0.003))
    arc = [(0.0475 * math.cos(math.radians(a)), 0.0475 * math.sin(math.radians(a))) for a in range(25, 166, 10)]
    arc += [(0.0505 * math.cos(math.radians(a)), 0.0505 * math.sin(math.radians(a))) for a in range(165, 24, -10)]
    fender = geo.extrude('fender', arc, 0.028, z=-0.014, col=col, material=paint, bev=0)
    fender.rotation_euler = Matrix(((0.0, 0.0, 1.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0))).to_euler()
    fender.location = (0, 0.104, 0.043)
    parts.append(fender)
    for sx in (-1, 1):
        parts.append(P.rod(f'fork{sx}', (sx * 0.0115, 0.104, 0.043), (sx * 0.0115, 0.088, 0.13), 0.0042, col, plastic, verts=12))
    parts.append(geo.box('bar_cowl', (0.064, 0.03, 0.022), (0, 0.072, 0.16), col=col, material=paint, bev=0.0075))
    parts.append(geo.box('headlamp', (0.034, 0.006, 0.013), (0, 0.0872, 0.165), col=col, material=geo.pbr('headlamp', '#d7dde3', rough=0.04, metal=0.3), bev=0.003))
    parts.append(geo.box('meter', (0.03, 0.016, 0.004), (0, 0.064, 0.181), rot=(-20, 0, 0), col=col, material=geo.pbr('meter', '#0c0d10', rough=0.1), bev=0.0015))
    for sx in (-1, 1):
        parts.append(P.rod(f'bar{sx}', (sx * 0.03, 0.068, 0.172), (sx * 0.056, 0.064, 0.174), 0.0046, col, plastic, verts=12))
        parts.append(P.rod(f'lever{sx}', (sx * 0.03, 0.077, 0.174), (sx * 0.054, 0.08, 0.172), 0.0012, col, chrome, verts=6))
        parts.append(P.rod(f'mirror_stalk{sx}', (sx * 0.024, 0.068, 0.18), (sx * 0.042, 0.072, 0.21), 0.0016, col, chrome, verts=6))
        mirror = geo.sphere(f'mirror{sx}', 0.009, (sx * 0.046, 0.072, 0.214), scale=(1.25, 0.4, 0.85), col=col, material=plastic, seg=16)
        parts.append(mirror)
        parts.append(geo.box(f'indicator{sx}', (0.008, 0.005, 0.006), (sx * 0.026, 0.087, 0.1585), col=col, material=geo.pbr('indicator', '#d88a1c', rough=0.2), bev=0.0015))
    # the centre stand, down
    parts.append(geo.box('stand', (0.044, 0.006, 0.03), (0, -0.03, 0.0), col=col, material=plastic, bev=0.001))
    for p in parts:
        p.parent = root

    # the rear plate, two lines: an invented number (district 00 does not exist)
    plate = P.group('plate', col, loc=(0, -0.1395, 0.075), rot=(90 - 12, 0, 0), parent=root)
    pw, ph = 0.056, 0.036
    sheet = _rrect('plate_sheet', pw, ph, 0.003, col, geo.pbr('plate_white', '#f1f0ea', rough=0.45), y=-ph / 2, z=-0.0012, t=0.0012)
    sheet.parent = plate
    rim = geo.pbr('plate_ink', '#141414', rough=0.5)
    for y, body in ((-0.0105, 'TN 00'), (-0.0265, 'OX 2026')):
        P.heavy(f'plate_{body[:2]}', body, 0.0118, col, rim, loc=(0, y, 0.00005), rot=(0, 0, 0), depth=0.0003, weight=0.05).parent = plate
    border = P.brackets('plate_border', col, rim, pw - 0.003, ph - 0.003, arm=0.5, thick=0.0009, depth=0.0003)
    for o in border:
        o.location.y -= ph / 2
        o.parent = plate
    return root, plate


def _gate(col, m):
    """The gate the scooter came in by: a brick post with a lamp on its cap
    and the steel leaf swung open along the drive (the other post, and the
    wall, are past the jar's edge)."""
    root = P.group('gate', col, loc=tuple(GATE))
    pw, ph = 0.03, 0.14
    geo.box('gate_post', (pw, pw, ph), (0, 0, 0), col=col, material=m['brick'], bev=0.001).parent = root
    geo.box('gate_cap', (pw + 0.008, pw + 0.008, 0.008), (0, 0, ph), col=col, material=m['coping'], bev=0.0015).parent = root
    geo.cyl('gate_lamp_base', 0.0062, 0.004, (0, 0, ph + 0.008), col=col, material=m['black'], verts=16, bev=0.001).parent = root
    P.no_shadow(P.ball('gate_lamp', 0.0088, col, geo.glow('gate_lamp', '#ffd29a', 3.2), loc=(0, 0, ph + 0.0205), seg=16)).parent = root
    steel = S.scanned('gate_steel', 'Metal027', tint='#1c1e21', size=0.08, rough=0.45, bump=0.15)
    hx, hy = -pw / 2 - 0.0025, pw / 2 - 0.003
    for z in (0.022, 0.1):
        P.rod('gate_hinge', (hx, hy, z), (hx, hy, z + 0.012), 0.0028, col, steel, verts=10).parent = root
    # The leaf, built closed (from the hinge along -x), then swung open 100
    # degrees, toward the house.
    lw, lh, t = 0.11, 0.112, 0.004
    parts = [geo.box('gate_stile', (t, t, lh), (-t / 2, 0, 0), col=col, material=steel, bev=0),
             geo.box('gate_stile', (t, t, lh), (-lw + t / 2, 0, 0), col=col, material=steel, bev=0)]
    for z in (0.0, lh * 0.36, lh - t):
        parts.append(geo.box('gate_rail', (lw, t, t), (-lw / 2, 0, z), col=col, material=steel, bev=0))
    parts.append(geo.box('gate_sheet', (lw - 2 * t, 0.0012, lh * 0.36 - t), (-lw / 2, 0, t), col=col, material=steel, bev=0))
    n = 8
    for i in range(1, n):
        x = -lw * i / n
        parts.append(geo.box('gate_bar', (0.0022, 0.0022, lh * 0.64 + 0.008), (x, 0, lh * 0.36), col=col, material=steel, bev=0))
        parts.append(P.cone('gate_tip', 0.0026, 0.0075, col, steel, loc=(x, 0, lh + 0.008), segments=8))
    leaf = P.join(parts, 'gate_leaf', col)
    leaf.location = (hx, hy, 0.005)
    leaf.rotation_euler = (0, 0, math.radians(-100.0))
    leaf.parent = root
    return root


def _plate_box(col, plate):
    """The amber box round the plate (unknown to the app), and its label."""
    pw, ph = 0.056, 0.036
    amber = geo.glow('plate_box', AMBER, 2.4)
    g = P.group('plate_cage', col, loc=(0, 0, 0.0045), parent=plate)
    for o in P.brackets('plate_box', col, amber, pw + 0.014, ph + 0.014, arm=0.26, thick=0.0024, depth=0.0016):
        o.location.y -= ph / 2
        P.no_shadow(o).parent = g
    bpy.context.view_layer.update()
    top = plate.matrix_world @ Vector((0, 0.008, 0.005))
    # The label as the app draws it: "PLATE: " and the read, cleaned to
    # letters and digits (stream_rtsp.py), in amber while the plate is unknown.
    return _badge('plate_badge', 'PLATE: TN00OX2026', col, geo.glow('plate_badge_bg', AMBER, 1.6), geo.pbr('badge_ink', '#111111', rough=0.6),
                  (top.x, top.y - 0.004, top.z), size=0.0078)


# ---------------------------------------------------------------- the phone

def _phone(col):
    """The owner's phone on a stand, drawn large: the texts as the app words
    them (its weapon and masked-person messages)."""
    root = P.group('phone_stand', col, loc=tuple(PHONE), rot=(0, 0, PHONE_YAW))
    black = geo.pbr('stand_black', '#1b1c20', rough=0.4)
    steel = geo.pbr('stand_steel', '#8f949b', rough=0.3, metal=1.0)
    top = Vector((0, 0, 0.11))
    for i in range(3):
        a = math.radians(90 + i * 120)
        foot = Vector((0.06 * math.cos(a), 0.06 * math.sin(a), 0.005))
        P.rod(f'stand_leg{i}', foot, top, 0.0055, col, black, verts=10).parent = root
        P.ball(f'stand_foot{i}', 0.008, col, black, loc=tuple(foot), seg=10).parent = root
    P.ball('stand_hub', 0.012, col, black, loc=tuple(top), seg=12).parent = root
    P.rod('stand_column', (0, 0, 0.11), (0, 0, 0.142), 0.005, col, steel, verts=10).parent = root

    w, h = 0.084, 0.168
    ph = P.group('phone', col, loc=(0, -0.002, 0.15), rot=(90 - 12, 0, 0), parent=root)
    body = _rrect('phone_body', w, h, 0.011, col, geo.pbr('phone_frame', '#2b2d33', rough=0.28, metal=0.7), y=h / 2, z=-0.008, t=0.008, n=6)
    body.parent = ph
    geo.box('phone_clamp', (0.03, 0.012, 0.016), (0, -0.004, -0.014), col=col, material=black, bev=0.003).parent = ph
    geo.box('phone_clamp_top', (0.03, 0.01, 0.012), (0, h - 0.002, -0.012), col=col, material=black, bev=0.003).parent = ph
    sw, sh = w - 0.006, h - 0.006
    scr = _rrect('phone_screen', sw, sh, 0.009, col, geo.pbr('phone_glass', '#07090d', rough=0.08, emit='#0b0f17', emit_strength=0.6), y=h / 2, z=0.0, t=0.0005, n=6)
    scr.parent = ph
    g = P.group('phone_ui', col, loc=(0, h / 2, 0.0005), parent=ph)
    white = geo.glow('ui_white', '#eef2f8', 1.5)
    muted = geo.glow('ui_muted', '#8b95a8', 1.1)
    red = geo.glow('ui_red', '#ff5a5a', 2.2)
    mag = geo.glow('ui_magenta', '#ff4dff', 2.0)
    bubble = geo.glow('ui_bubble', '#262a33', 1.0)
    head = geo.glow('ui_head', '#141822', 1.0)
    x0 = -sw / 2 + 0.006
    items = []
    # status bar, then the conversation's header
    items.append(_words('ui_time', '23:42', 0.0058, col, white, x=x0, y=sh / 2 - 0.007))
    for k in range(3):
        items.append(geo.box(f'ui_sig{k}', (0.0016, 0.0005, 0.0018 + k * 0.0012), (sw / 2 - 0.016 + k * 0.0026, sh / 2 - 0.0085, 0.0), col=col, material=white, bev=0))
    items.append(_rrect('ui_bat', 0.0075, 0.0034, 0.0008, col, white, x=sw / 2 - 0.0055, y=sh / 2 - 0.0072))
    items.append(_rrect('ui_header', sw, 0.02, 0.0, col, head, y=sh / 2 - 0.024, t=0.0002))
    items.append(geo.cyl('ui_avatar', 0.0048, 0.0002, (x0 + 0.004, sh / 2 - 0.024, 0.0002), col=col, material=geo.glow('ui_avatar', BLUE, 1.6), verts=20, bev=0))
    items.append(_words('ui_from', 'Home Security', 0.0058, col, white, x=x0 + 0.011, y=sh / 2 - 0.022, z=0.0004))
    items.append(_words('ui_sms', 'Text message', 0.0038, col, muted, x=x0 + 0.011, y=sh / 2 - 0.0285, z=0.0004))
    # the weapon message
    by = sh / 2 - 0.039
    items.append(_rrect('ui_bubble1', sw - 0.012, 0.052, 0.005, col, bubble, x=-0.0025, y=by - 0.026, t=0.0002))
    # (the app's own words, stream_rtsp.py _build_detailed_sms; its emoji left out)
    lines = [('WEAPON DETECTED', red, 0.0062), ('Severity: CRITICAL', white, 0.0045), ('Camera: CAM1', white, 0.0045),
             ('IMMEDIATE ACTION REQUIRED:', white, 0.0037), ('Do NOT approach the area', muted, 0.0039), ('Call police (100/911) immediately', muted, 0.0033)]
    yy = by - 0.0075
    for i, (txt, mat, size) in enumerate(lines):
        items.append(_words(f'ui_w{i}', txt, size, col, mat, x=x0, y=yy, z=0.0004))
        yy -= size * 1.6 + (0.0018 if i == 0 else 0.0)
    # the masked-person message, with its snapshot
    by2 = by - 0.058
    items.append(_rrect('ui_bubble2', sw - 0.012, 0.06, 0.005, col, bubble, x=-0.0025, y=by2 - 0.03, t=0.0002))
    for i, txt in enumerate(('MASKED/UNIDENTIFIED', 'PERSON')):
        items.append(_words(f'ui_mh{i}', txt, 0.0052, col, mag, x=x0, y=by2 - 0.0075 - i * 0.0072, z=0.0004))
    sx_, sy_ = x0 + 0.012, by2 - 0.037
    items.append(_rrect('ui_snap', 0.024, 0.03, 0.002, col, geo.glow('ui_snap', '#3a2f2a', 0.9), x=sx_, y=sy_, t=0.0003))
    items.append(_rrect('ui_snap_wall', 0.024, 0.013, 0.0, col, geo.glow('ui_snap_wall', '#6a3a2c', 0.9), x=sx_, y=sy_ + 0.0085, z=0.00005, t=0.0003))
    items.append(_rrect('ui_snap_fig', 0.0062, 0.017, 0.0026, col, geo.glow('ui_snap_fig', '#15161a', 1.0), x=sx_, y=sy_ - 0.002, z=0.0001, t=0.0003))
    for o in P.brackets('ui_snap_box', col, mag, 0.011, 0.022, arm=0.3, thick=0.0008, depth=0.0003, z=0.0004):
        o.location.x += sx_
        o.location.y += sy_ - 0.0015
        items.append(o)
    tx = x0 + 0.028
    for i, (txt, mat, size) in enumerate((('Severity: CRITICAL', white, 0.0037), ('Camera: CAM1', white, 0.0037), ('A person with a', muted, 0.0034),
                                          ('concealed face', muted, 0.0034), ('Review snapshot', muted, 0.0034))):
        items.append(_words(f'ui_m{i}', txt, size, col, mat, x=tx, y=by2 - 0.0255 - i * 0.0062, z=0.0004))
    for o in items:
        P.no_shadow(o).parent = g
    return root


# ---------------------------------------------------------------- inside

def _dashboard(col, scr_w, scr_h):
    """The app's dashboard, flat in the screen's own frame (x right, y up,
    facing +z): its sidebar of six tabs, the camera with its boxes, the four
    stat cards and the recent alerts, in its stylesheet's colours."""
    items = []
    # One material per colour and strength: the screen is many small parts.
    gl = lambda name, hex_, s=1.0: geo.glow(f'scr_{hex_.lstrip("#")}_{s:g}', hex_, s)
    bgm, side, card = gl('dash_bg', BG, 1.0), gl('dash_side', SIDEBAR, 1.0), gl('dash_card', CARD, 1.0)
    text, muted, blue = gl('dash_text', TEXT, 1.4), gl('dash_muted', MUTED, 1.0), gl('dash_blue', BLUE, 1.8)
    W, H = scr_w, scr_h
    items.append(_rrect('dash_bg', W, H, 0.0, col, bgm, t=0.0002))
    sw = 0.028
    items.append(_rrect('dash_sidebar', sw, H, 0.0, col, side, x=-W / 2 + sw / 2, z=0.0002, t=0.0002))
    items.append(_rrect('dash_logo', 0.0052, 0.0052, 0.0012, col, blue, x=-W / 2 + 0.0055, y=H / 2 - 0.0062, z=0.0004))
    items.append(_words('dash_brand', 'MSD', 0.0034, col, text, x=-W / 2 + 0.0095, y=H / 2 - 0.0055, z=0.0004))
    items.append(_words('dash_brand2', 'Security', 0.0022, col, muted, x=-W / 2 + 0.0095, y=H / 2 - 0.0082, z=0.0004))
    for i, name in enumerate(('Dashboard', 'Alerts', 'People', 'Vehicles', 'Settings', 'Metrics')):
        y = H / 2 - 0.016 - i * 0.0062
        if i == 0:
            items.append(_rrect('dash_nav_on', sw - 0.004, 0.0052, 0.001, col, gl('dash_nav_on', '#1c2a4a', 1.2), x=-W / 2 + sw / 2, y=y, z=0.0003))
        items.append(_rrect(f'dash_icon{i}', 0.0026, 0.0026, 0.0005, col, blue if i == 0 else muted, x=-W / 2 + 0.0055, y=y, z=0.0004))
        items.append(_words(f'dash_nav{i}', name, 0.0024, col, text if i == 0 else muted, x=-W / 2 + 0.009, y=y, z=0.0004))
    items.append(geo.cyl('dash_health', 0.0009, 0.0002, (-W / 2 + 0.005, -H / 2 + 0.0045, 0.0003), col=col, material=gl('dash_green', GREEN, 2.0), verts=10, bev=0))
    items.append(_words('dash_health_t', 'System online', 0.0021, col, muted, x=-W / 2 + 0.0075, y=-H / 2 + 0.0045, z=0.0004))

    mx0, mx1 = -W / 2 + sw + 0.005, W / 2 - 0.005
    top = H / 2 - 0.005
    items.append(_words('dash_title', 'Live Dashboard', 0.0052, col, text, x=mx0, y=top - 0.003, z=0.0004))
    # Home / Away (Away on: everything is boxed) and the SOS button
    items.append(_rrect('dash_mode', 0.026, 0.0062, 0.0031, col, card, x=mx1 - 0.031, y=top - 0.003, z=0.0003))
    items.append(_rrect('dash_away', 0.0125, 0.0048, 0.0024, col, blue, x=mx1 - 0.0245, y=top - 0.003, z=0.0004))
    items.append(_words('dash_home_t', 'Home', 0.0023, col, muted, x=mx1 - 0.0375, y=top - 0.003, z=0.0005, align='CENTER'))
    items.append(_words('dash_away_t', 'Away', 0.0023, col, text, x=mx1 - 0.0245, y=top - 0.003, z=0.0005, align='CENTER'))
    items.append(_rrect('dash_sos', 0.012, 0.0062, 0.0015, col, gl('dash_red', RED, 2.0), x=mx1 - 0.006, y=top - 0.003, z=0.0003))
    items.append(_words('dash_sos_t', 'SOS', 0.0027, col, gl('dash_white', '#ffffff', 1.8), x=mx1 - 0.006, y=top - 0.003, z=0.0005, align='CENTER'))

    # the camera tile: the front door as the camera sees it, boxed
    cx0, cx1 = mx0, mx0 + 0.07
    cy1 = top - 0.009
    cy0 = cy1 - 0.044
    ccx, ccy = (cx0 + cx1) / 2, (cy0 + cy1) / 2
    items.append(_rrect('dash_cam', cx1 - cx0, cy1 - cy0, 0.0012, col, gl('dash_cam', '#1b1f27', 0.9), x=ccx, y=ccy, z=0.0003))
    items.append(_rrect('dash_cam_wall', cx1 - cx0 - 0.002, 0.026, 0.0, col, gl('dash_cam_wall', '#4a2a22', 0.85), x=ccx, y=cy1 - 0.014, z=0.0004))
    items.append(_rrect('dash_cam_door', 0.012, 0.022, 0.0, col, gl('dash_cam_door', '#2a1a10', 0.9), x=ccx + 0.008, y=cy1 - 0.016, z=0.0005))
    items.append(_rrect('dash_cam_ground', cx1 - cx0 - 0.002, 0.016, 0.0, col, gl('dash_cam_ground', '#3a3b3d', 0.8), x=ccx, y=cy0 + 0.0085, z=0.0004))
    items.append(_rrect('dash_cam_fig', 0.0062, 0.02, 0.003, col, gl('dash_cam_fig', '#121316', 1.0), x=ccx - 0.009, y=ccy - 0.002, z=0.0006))
    mag, red, amb = gl('dash_magenta', MAGENTA, 2.0), gl('dash_redbox', '#ff3030', 2.0), gl('dash_amber', AMBER, 2.0)
    for name, mat, w, h, x, y in (('dash_box_p', mag, 0.011, 0.026, ccx - 0.009, ccy - 0.002), ('dash_box_w', red, 0.006, 0.006, ccx - 0.0045, ccy - 0.009),
                                  ('dash_box_l', amb, 0.009, 0.0055, ccx + 0.024, cy0 + 0.006)):
        for o in P.brackets(name, col, mat, w, h, arm=0.3, thick=0.0006, depth=0.0002, z=0.0007):
            o.location.x += x
            o.location.y += y
            items.append(o)
    items.append(_words('dash_label_p', 'MASKED/UNKNOWN PERSON', 0.0016, col, mag, x=ccx - 0.0145, y=ccy + 0.0125, z=0.0007))
    items.append(_words('dash_label_w', 'KNIFE', 0.0016, col, red, x=ccx - 0.001, y=ccy - 0.0135, z=0.0007))
    items.append(_words('dash_label_l', 'PLATE: TN00OX2026', 0.0014, col, amb, x=ccx + 0.0155, y=cy0 + 0.0105, z=0.0007))
    items.append(_rrect('dash_cam_chip', 0.011, 0.004, 0.001, col, gl('dash_chip', '#0b0e14', 1.0), x=cx0 + 0.008, y=cy1 - 0.004, z=0.0006))
    items.append(_words('dash_cam_name', 'CAM1', 0.0022, col, text, x=cx0 + 0.008, y=cy1 - 0.004, z=0.0007, align='CENTER'))
    live = geo.cyl('dash_live', 0.0011, 0.0002, (cx1 - 0.009, cy1 - 0.004, 0.0006), col=col, material=geo.glow('dash_live', RED, 2.6), verts=12, bev=0)
    items.append(live)
    items.append(_words('dash_live_t', 'LIVE', 0.0022, col, text, x=cx1 - 0.0072, y=cy1 - 0.004, z=0.0007))

    # the recent alerts, newest first
    ax0, ax1 = cx1 + 0.004, mx1
    items.append(_rrect('dash_alerts', ax1 - ax0, cy1 - cy0, 0.0012, col, card, x=(ax0 + ax1) / 2, y=ccy, z=0.0003))
    items.append(_words('dash_alerts_t', 'Recent Alerts', 0.0028, col, text, x=ax0 + 0.003, y=cy1 - 0.0045, z=0.0005))
    # As app.js renderAlertItem() lays a row out: a bar and a tag in the
    # level's colour, camera / category, then the message as published. (An
    # unknown plate is logged, not alerted: only a flagged one would be here.)
    rows = (('critical', 'cam1 / weapon', 'Potential weapon detected (knife)', RED),
            ('critical', 'cam1 / masked_person', '1 person(s) with COVERED FACE detected', RED),
            ('high', 'cam1 / behavior', 'Loitering detected (track 1, 20s)', '#f97316'),
            ('info', 'system / mode', 'Security mode changed to: AWAY', BLUE))
    for i, (level, where, msg, hx) in enumerate(rows):
        y = cy1 - 0.0118 - i * 0.0082
        items.append(geo.box(f'dash_row_bar{i}', (0.0009, 0.0058, 0.0002), (ax0 + 0.0035, y + 0.0001, 0.0004), col=col, material=gl('bar', hx, 2.0), bev=0))
        items.append(_words(f'dash_row_l{i}', level, 0.0019, col, gl('tag', hx, 1.8), x=ax0 + 0.0055, y=y + 0.0016, z=0.0005))
        items.append(_words(f'dash_row_c{i}', where, 0.0017, col, muted, x=ax0 + 0.0165, y=y + 0.0016, z=0.0005))
        items.append(_words(f'dash_row_m{i}', msg, 0.0018, col, text, x=ax0 + 0.0055, y=y - 0.0013, z=0.0005))

    # the four stat cards, as the app labels them
    sy1 = cy0 - 0.004
    sy0 = -H / 2 + 0.004
    n = 4
    gap = 0.003
    cw = (mx1 - mx0 - gap * (n - 1)) / n
    for i, (label, value, hx) in enumerate((('Total Alerts', '4', RED), ('Tracked People', '1', MAGENTA), ('Active Cameras', '1', BLUE), ('SMS Status', 'Active', GREEN))):
        x = mx0 + cw / 2 + i * (cw + gap)
        items.append(_rrect(f'dash_stat{i}', cw, sy1 - sy0, 0.0012, col, card, x=x, y=(sy0 + sy1) / 2, z=0.0003))
        items.append(_rrect(f'dash_stat_icon{i}', 0.0042, 0.0042, 0.001, col, gl(f'dash_stat_i{i}', hx, 1.4), x=x - cw / 2 + 0.0045, y=(sy0 + sy1) / 2, z=0.0004))
        items.append(_words(f'dash_stat_v{i}', value, 0.0042, col, text, x=x - cw / 2 + 0.0085, y=(sy0 + sy1) / 2 + 0.0015, z=0.0005))
        items.append(_words(f'dash_stat_l{i}', label, 0.002, col, muted, x=x - cw / 2 + 0.0085, y=(sy0 + sy1) / 2 - 0.0025, z=0.0005))
    return items, live


def _room(col, m):
    """Behind the wall, seen as the jar turns: the desk with the PC the app
    runs on, its dashboard on a large monitor, the router the camera's cable
    goes to, a chair, a lamp and a plant on a rug."""
    room = P.group('desk', col, loc=tuple(DESK))
    oak = geo.textured('desk_oak', 'oak_veneer_01', tint='#9a7650', rough=0.45, scale=0.3, strength=0.7)
    black = geo.pbr('desk_black', '#1a1b1e', rough=0.45, metal=0.5)
    dw, dd, dh = 0.2, 0.076, 0.123
    parts = [geo.box('desk_top', (dw, dd, 0.006), (0, 0, dh - 0.006), col=col, material=oak, bev=0.0015)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(geo.box('desk_leg', (0.005, 0.005, dh - 0.006), (sx * (dw / 2 - 0.006), sy * (dd / 2 - 0.006), 0), col=col, material=black, bev=0.0008))
    parts.append(geo.box('desk_rail', (dw - 0.012, 0.004, 0.012), (0, -dd / 2 + 0.006, dh - 0.02), col=col, material=black, bev=0.0008))
    # the monitor, drawn large, facing the room (+y)
    W, H = 0.172, 0.104
    mon = P.group('monitor', col, loc=(0, -0.012, dh + 0.02), rot=(90, 0, 180), parent=room)
    frame = _rrect('monitor_frame', W, H, 0.003, col, geo.pbr('monitor_frame', '#141518', rough=0.3, metal=0.4), y=H / 2, z=-0.006, t=0.006)
    frame.parent = mon
    screen_items, live = _dashboard(col, W - 0.008, H - 0.008)
    scr = P.group('dashboard', col, loc=(0, H / 2, 0.0002), parent=mon)
    for o in screen_items:
        P.no_shadow(o).parent = scr
    parts.append(geo.box('monitor_neck', (0.014, 0.008, 0.05), (0, -0.017, dh), col=col, material=black, bev=0.002))
    parts.append(geo.box('monitor_foot', (0.05, 0.03, 0.003), (0, -0.012, dh), col=col, material=black, bev=0.0012))
    # keyboard and mouse
    kb = geo.box('keyboard', (0.072, 0.022, 0.003), (0, 0.02, dh), col=col, material=geo.pbr('kb', '#202226', rough=0.5), bev=0.001)
    parts.append(kb)
    keys = geo.pbr('keys', '#3a3d43', rough=0.6)
    for r in range(4):
        parts.append(geo.box(f'key_row{r}', (0.066, 0.0036, 0.0008), (0, 0.0128 + r * 0.0049, dh + 0.003), col=col, material=keys, bev=0))
    parts.append(geo.sphere('mouse', 0.006, (0.052, 0.02, dh + 0.002), scale=(0.75, 1.15, 0.5), col=col, material=geo.pbr('mouse', '#202226', rough=0.45), seg=16))
    # the router: two aerials, lights on its face
    router = [geo.box('router', (0.032, 0.02, 0.007), (-0.075, -0.018, dh), col=col, material=geo.pbr('router', '#e8e8e6', rough=0.45), bev=0.002)]
    for sx in (-1, 1):
        router.append(P.rod(f'router_aerial{sx}', (-0.075 + sx * 0.012, -0.026, dh + 0.006), (-0.075 + sx * 0.016, -0.03, dh + 0.04), 0.0016, col,
                            geo.pbr('aerial', '#2a2b2e', rough=0.5), verts=8))
    leds = []
    for i in range(4):
        mat = geo.glow(f'router_led{i}', GREEN if i < 3 else BLUE, 2.6)
        leds.append(mat)
        router.append(P.no_shadow(geo.box(f'router_led{i}', (0.0026, 0.0008, 0.0016), (-0.084 + i * 0.006, -0.0078, dh + 0.003), col=col, material=mat, bev=0)))
    parts += router
    # the PC under the desk, its light toward the room
    parts.append(geo.box('pc', (0.032, 0.07, 0.078), (0.072, 0.0, 0.0), col=col, material=geo.pbr('pc', '#18191c', rough=0.4, metal=0.3), bev=0.002))
    parts.append(P.no_shadow(geo.box('pc_light', (0.002, 0.0008, 0.05), (0.082, 0.0353, 0.016), col=col, material=geo.glow('pc_light', BLUE, 2.6), bev=0)))
    parts.append(geo.cyl('pc_button', 0.0028, 0.0008, (0.066, 0.0352, 0.064), rot=(90, 0, 0), col=col, material=geo.pbr('pc_btn', '#3a3b40', rough=0.3), verts=12, bev=0))
    for p in parts:
        p.parent = room

    # the chair, pulled out and turned
    chair = P.group('chair', col, loc=(DESK.x + 0.052, DESK.y + 0.112, PL), rot=(0, 0, 200.0))
    fabric = geo.textured('chair_mesh', 'wool_boucle', tint='#2a2c31', rough=0.9, scale=0.15, strength=0.6)
    cp = []
    for i in range(5):
        a = math.radians(i * 72)
        cp.append(P.rod('chair_leg', (0, 0, 0.012), (0.03 * math.cos(a), 0.03 * math.sin(a), 0.008), 0.0028, col, black, verts=8))
        cp.append(P.ball('chair_caster', 0.0045, col, black, loc=(0.03 * math.cos(a), 0.03 * math.sin(a), 0.0045), seg=10))
    cp.append(P.rod('chair_lift', (0, 0, 0.01), (0, 0, 0.07), 0.0035, col, black, verts=12))
    cp.append(geo.box('chair_seat', (0.052, 0.05, 0.011), (0, 0, 0.07), col=col, material=fabric, bev=0.0045))
    cp.append(P.rod('chair_spine', (0, 0.022, 0.075), (0, 0.03, 0.11), 0.0025, col, black, verts=8))
    cp.append(geo.box('chair_back', (0.048, 0.01, 0.062), (0, 0.031, 0.1), rot=(-8, 0, 0), col=col, material=fabric, bev=0.0045))
    for s in (-1, 1):
        cp.append(geo.box('chair_arm', (0.004, 0.034, 0.003), (s * 0.028, 0.002, 0.098), col=col, material=black, bev=0.001))
        cp.append(P.rod('chair_arm_post', (s * 0.028, 0.006, 0.08), (s * 0.028, 0.006, 0.098), 0.002, col, black, verts=6))
    for p in cp:
        p.parent = chair

    # the cable: from the camera, through the wall, along it and down to the router
    cy = WY1 + 0.004
    geo.tube('cam_cable_in', [(CAM_AT.x, cy, CAM_AT.z - 0.03), (CAM_AT.x - 0.02, cy, 0.47), (DESK.x + 0.02, cy, 0.47), (DESK.x - 0.06, cy, 0.4),
                              (DESK.x - 0.075, cy + 0.002, DESK.z + dh + 0.015), (DESK.x - 0.075, DESK.y - 0.03, DESK.z + dh + 0.004)],
             radius=0.0016, col=col, material=geo.pbr('cable_white', '#dedcd6', rough=0.5), resolution=2)

    # the rug, a lamp on a side table, a plant by the door
    geo.box('rug', (0.2, 0.13, 0.002), (0.03, 0.245, PL), col=col, material=geo.textured('rug', 'wool_boucle', tint='#7a5638', rough=0.95, scale=0.2, strength=0.7), bev=0.0008)
    lamp = P.group('lamp', col, loc=(0.245, 0.17, PL))
    lp = [geo.lathe('side_table', [(0.0, 0.0), (0.02, 0.0), (0.02, 0.003), (0.006, 0.006), (0.005, 0.085), (0.032, 0.088), (0.032, 0.094), (0.0, 0.094)], col, oak, segments=32)]
    lp.append(geo.lathe('lamp_base', [(0.0, 0.094), (0.012, 0.094), (0.01, 0.1), (0.003, 0.104), (0.003, 0.13), (0.0, 0.13)], col, geo.pbr('lamp_brass', '#b08d57', rough=0.3, metal=0.9), segments=24))
    for p in lp:
        p.parent = lamp
    shade = geo.lathe('lamp_shade', [(0.024, 0.118), (0.016, 0.148), (0.0155, 0.1485), (0.0235, 0.1185)], col,
                      geo.pbr('lamp_shade', '#f1e2c4', rough=0.85, emit='#ffcf8a', emit_strength=1.6), segments=32)
    shade.parent = lamp
    bulb = P.ball('lamp_bulb', 0.007, col, geo.glow('lamp_bulb', '#ffd9a3', 5.0), loc=(0, 0, 0.13), seg=12)
    P.no_shadow(bulb).parent = lamp
    # (the kit's plant is room-sized, its pot a fixed 0.33 m across: scaled)
    before = P.names()
    plant = props.plant('plant', h=0.9, leaves=12, seed=3)
    P.adopt(col, before)
    plant.scale = (0.16, 0.16, 0.16)
    plant.location = (0.075, 0.31, PL)
    return leds, live


# ---------------------------------------------------------------- build

def build(col):
    m = _mats()
    _ground(col, m)
    _wall(col, m)
    _door(col, m)
    _window(col, m)
    _vent(col, m)
    _fixtures(col, m)
    pan = _camera(col, m)

    root, head = _figure(col)
    knife = _knife(col, root)
    marks = _loiter(col)
    # The boxes, sized to what they hold (as the detector's would be).
    body = [n for n in _meshes(root) if n not in _meshes(knife)]
    lo, hi = _bounds(body)
    magenta = geo.glow('box_magenta', MAGENTA, 2.0)
    _cage('person_box', col, magenta, lo - Vector((0.012, 0.012, 0.004)), hi + Vector((0.012, 0.012, 0.012)))
    _badge('person_badge', 'MASKED/UNKNOWN PERSON', col, magenta, geo.glow('badge_white', '#ffffff', 1.6), (0.5 * (lo.x + hi.x), lo.y - 0.012, hi.z + 0.016),
           size=0.0086)
    klo, khi = _bounds(_meshes(knife))
    red = geo.glow('box_red', '#ff2a2a', 2.2)
    _cage('knife_box', col, red, klo - Vector((0.008, 0.008, 0.008)), khi + Vector((0.008, 0.008, 0.008)), arm=0.32, th=0.0022)
    _badge('knife_badge', 'KNIFE', col, red, geo.glow('badge_white', '#ffffff', 1.6), (0.5 * (klo.x + khi.x), klo.y - 0.008, khi.z + 0.011), size=0.0078)

    scooter, plate = _scooter(col)
    _plate_box(col, plate)
    _gate(col, m)
    _phone(col)
    leds, live_dot = _room(col, m)
    P.no_ghosts(col)
    return {'pan': pan, 'head': head, 'marks': marks, 'magenta': magenta, 'red': red, 'leds': leds,
            'live': live_dot.data.materials[0]}


def animate(t, st):
    # The camera sweeps the porch and back, once a loop.
    st['pan'].rotation_euler = (0, 0, math.radians(PAN0 + PAN_AMP * math.sin(2 * math.pi * t)))
    # The figure watches the street: a slow look one way and back.
    st['head'].rotation_euler = (0, 0, math.radians(HEAD_YAW + 10.0 * math.sin(2 * math.pi * t + 0.8)))
    # Loitering: a mark a second to 40 s, then the ring lets go. (Offset, so
    # the still shows 26 s: past the alert, on the way to the critical one.)
    u = (t + FILL_PHASE) % 1.0
    fill = u / 0.9 * SECS if u < 0.9 else SECS * (1 - C.ease_in_out((u - 0.9) / 0.1))
    for i, o in enumerate(st['marks']):
        k = max(0.0001, C.clamp(fill - i))
        o.scale = (k, k, 1)
    # The boxes breathe twice a loop; the router's lights blink.
    p = 0.5 + 0.5 * math.cos(4 * math.pi * t)
    P.set_glow(st['magenta'], strength=1.5 + 1.0 * p)
    P.set_glow(st['red'], strength=1.6 + 1.2 * p)
    for i, mat in enumerate(st['leds']):
        on = math.sin(2 * math.pi * (3 + i) * t + i * 1.7) > -0.2
        P.set_glow(mat, strength=2.6 if on else 0.35)
    P.set_glow(st['live'], strength=2.8 if math.cos(2 * math.pi * 4 * t) > 0 else 0.6)


# ---------------------------------------------------------------- the live jar (pieces/live.py)

def spots(st):
    """The live jar's numbered dots, each on something that only turns with
    the turntable: the camera (over its housing), the masked person (over
    its label), the knife (by its box), the plate (over its label), the
    phone (over its top) and the dashboard (over the monitor, facing the
    room, so it shows once the jar has turned). Each names the parts a tap
    opens it from with the glass off. A dot over a label stands clear of
    it, so that a chapter's close view (its view in src/data/projects.js)
    shows the label under the dot.

    Every spot says which way it faces. The default (outward from the axis)
    would turn the house front side on: what stands in front of the wall
    faces the street, a little to the side as each part looks, and 37° up,
    so its dot is gone before the jar has turned far enough for the wall to
    hide the part. The camera is seen from the right, its wall running back
    to the figure it watches; the masked person from where its face looks,
    clear of the phone, which stands between it and the front left; the
    knife side on; the plate and the phone square on."""
    from pieces.live import below, box
    front = lambda x: (x, -0.78, 0.6)
    bpy.context.view_layer.update()
    _, top_c, cam = box('cam_plate')
    _, top_p, badge = box('person_badge_plate')
    lo_k, hi_k, knife = box('knife_box')
    _, top_l, plate = box('plate_badge_plate')
    _, top_ph, phone = box('phone_body')
    _, top_m, mon = box('monitor_frame')
    knife_parts = below('knife') + ['knife_box'] + below('knife_badge')
    person = [n for n in below('figure') if n not in knife_parts] + below('loiter') + ['person_box'] + below('person_badge')
    return [
        {'id': 'camera', 'at': (cam.x, cam.y - 0.02, top_c.z + 0.016), 'out': front(0.5),
         'parts': below('cam_mount') + below('lantern') + below('doorbell')},
        {'id': 'masked', 'at': (badge.x, badge.y, top_p.z + 0.03), 'out': front(0.3), 'parts': person},
        {'id': 'weapon', 'at': (knife.x, lo_k.y - 0.004, hi_k.z + 0.045), 'out': front(-0.1), 'parts': knife_parts},
        {'id': 'plate', 'at': (plate.x, plate.y, top_l.z + 0.03), 'out': front(-0.15),
         'parts': below('scooter') + below('plate_badge') + below('gate')},
        {'id': 'alert', 'at': (phone.x, phone.y, top_ph.z + 0.025), 'out': front(0.15), 'parts': below('phone_stand')},
        {'id': 'dashboard', 'at': (mon.x, mon.y, top_m.z + 0.03), 'out': (0.0, 0.75, 0.66),
         'parts': below('desk') + below('chair') + below('lamp')},
    ]


def live(st):
    """Words leave with their faces only. The render's words stand a
    fraction of a millimetre proud, for its light to catch their edges;
    live, their backs and sides cannot be seen (each lies on a screen, a
    plate or the ground) and were most of the jar: 33,000 of its 70,000
    triangles, the dashboard's and the phone's above all. Each word is its
    own mesh in its own frame, the text's: its face looks up local z."""
    import re

    import bmesh

    words = re.compile(r'(ui_(time|from|sms|w\d+|mh\d+|m\d+)|dash_(brand2?|nav\d+|health_t|title|home_t|away_t|sos_t|label_[pwl]'
                       r'|cam_name|live_t|alerts_t|row_[lcm]\d+|stat_[vl]\d+)|\w+_badge_text|loiter_[24]0|plate_(TN|OX))(\.\d+)?')
    n = kept = cut = 0
    for o in bpy.data.objects:
        if o.type != 'MESH' or not words.fullmatch(o.name):
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.normal_update()
        back = [f for f in bm.faces if f.normal.z < 0.5]
        bmesh.ops.delete(bm, geom=back, context='FACES')
        bm.to_mesh(o.data)
        n, kept, cut = n + 1, kept + len(bm.faces), cut + len(back)
        bm.free()
    print(f'WORDS {n} objects: {kept} faces kept, {cut} cut')
