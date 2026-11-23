"""
Attendance: a camera over a door, and the log it keeps.

As the repo's code has it (cctv_attendance_system.py):
  - a CCTV camera watches people pass and matches each face to an enrolled one
  - a sighting is a check-in, the next one a check-out, and RECOGNITION_COOLDOWN
    (60 s) keeps someone standing in frame from being logged twice: the ring
    on the floor fills over those 60 seconds
  - the Excel export has two sheets, Working_Hours_Summary and
    Detailed_InOut_Log
The figure is a blank wooden peg: no face is modelled, and none is used.
The floor is terrazzo with brass strips, the door painted wood (scanned
surfaces, ambientCG, CC0).
"""

from __future__ import annotations

import math

import bpy
from mathutils import Vector

import common as C
from kit import geo, props
from pieces import _kit as K
from pieces import _parts as P
from pieces import _scans as S

META = {
    'id': 'attendance',
    'tag': ('AUTOMATED', 'ATTENDANCE', 'FACE RECOGNITION  2025'),
    'accent': '#8b5cf6',
    'disc': '#1a1d24',
}

DOOR_Y = 0.13
PERSON = (0.0, -0.1)
HEAD_Z = 0.47
RING_R = 0.125
TICKS = 60
CAM = (0.0, DOOR_Y - 0.093, 0.66)


def _door(col):
    root = P.group('door', col, loc=(0, DOOR_Y, 0))
    frame_m = geo.pbr('door_frame', '#e6dfd2', rough=0.6)
    wall_m = geo.textured('door_wall', 'painted_plaster_wall', tint='#d6d2ca', rough=0.85, scale=0.6, strength=0.5)
    parts = []
    for sx in (-1, 1):
        parts.append(geo.box('door_jamb', (0.042, 0.062, 0.675), (sx * 0.205, 0, 0), col=col, material=frame_m, bev=0.006))
        parts.append(geo.box('door_wall', (0.07, 0.036, 0.725), (sx * 0.26, 0, 0), col=col, material=wall_m, bev=0.002))
    parts.append(geo.box('door_lintel', (0.452, 0.062, 0.05), (0, 0, 0.675), col=col, material=frame_m, bev=0.006))
    parts.append(geo.box('door_sill', (0.37, 0.07, 0.008), (0, 0, 0), col=col, material=geo.pbr('door_sill', '#8a7a66', rough=0.6), bev=0.002))
    for q in parts:
        q.parent = root

    # the leaf, a little way open into the room behind
    leaf = P.group('door_leaf', col, loc=(-0.184, 0.012, 0.01), rot=(0, 0, 30.0), parent=root)
    # Painted wood, its grain up the door.
    paint = S.scanned('door_paint', 'PaintedWood007A', tint='#2d5261', size=0.22, rough=0.48, bump=0.25, rot=(0, 90, 0))
    inset = S.scanned('door_inset', 'PaintedWood007A', tint='#274855', size=0.22, rough=0.52, bump=0.25, rot=(0, 90, 0))
    brass = K.brass('door_brass')
    w, h = 0.362, 0.655
    lp = [geo.box('leaf_panel', (w, 0.022, h), (w / 2, 0, 0), col=col, material=paint, bev=0.004)]
    for z0, hh in ((0.05, 0.25), (0.35, 0.25)):
        for sy in (-1, 1):
            lp.append(geo.box('leaf_inset', (w - 0.09, 0.003, hh), (w / 2, sy * 0.0115, z0), col=col, material=inset, bev=0.002))
    for sy in (-1, 1):
        lp.append(P.rod('leaf_handle', (w - 0.04, sy * 0.011, 0.33), (w - 0.04, sy * 0.034, 0.33), 0.006, col, brass, verts=12))
        lp.append(P.rod('leaf_lever', (w - 0.04, sy * 0.034, 0.33), (w - 0.1, sy * 0.034, 0.33), 0.0055, col, brass, verts=12))
    for q in lp:
        q.parent = leaf


def _camera(col):
    """The dome camera on its bracket, and the cone it watches through."""
    white = geo.pbr('cam_white', '#e9e7e2', rough=0.4)
    geo.box('cam_shelf', (0.15, 0.124, 0.012), (0, DOOR_Y - 0.093, 0.7), col=col, material=white, bev=0.003)
    before = P.names()
    cam = props.dome_camera('dome_cam')
    P.adopt(col, before)
    cam.scale = (0.82, 0.82, 0.82)
    cam.location = (CAM[0], CAM[1], 0.7)
    P.ball('cam_led', 0.0048, col, geo.glow('cam_led', '#ff4d5e', 3.0), loc=(0.034, CAM[1] - 0.038, 0.69), seg=10)

    # aimed at the head of whoever stands on the mark
    dy, dz = PERSON[1] - CAM[1], HEAD_Z - CAM[2]
    pan = P.group('scan_pan', col, loc=CAM)
    tilt = P.group('scan_tilt', col, rot=(math.degrees(math.atan2(dy, -dz)), 0, 0), parent=pan)
    L, half = 0.36, math.radians(17)
    beam = geo.lathe('scan_cone', [(0.0, 0.0), (L * math.tan(half), -L)], col, P.soft_glow('scan_beam', C.VIOLET, 2.2, alpha=0.06), segments=48)
    P.no_shadow(beam).parent = tilt
    edge = P.ring('scan_edge', L * math.tan(half), 0.0016, col, P.soft_glow('scan_edge', C.VIOLET, 2.0, alpha=0.6), z=-L, segments=64, sides=6)
    P.no_shadow(edge).parent = tilt
    return pan


def _person(col):
    """A wooden peg, with the box the detector draws round a head."""
    root = P.group('person', col, loc=(PERSON[0], PERSON[1], 0.0))
    wood = P.wood('peg_wood', '#d2b891', rough=0.5)
    coat = geo.pbr('peg_coat', '#4d6379', rough=0.6)
    body = geo.lathe('peg_body', [(0.0, 0.0), (0.066, 0.0), (0.07, 0.014), (0.064, 0.14), (0.052, 0.3), (0.046, 0.36), (0.028, 0.384),
                                  (0.025, 0.41), (0.0, 0.41)], col, coat, segments=40)
    K.sharpen(body, 40).parent = root
    P.ball('peg_head', 0.062, col, wood, loc=(0, 0, HEAD_Z), seg=32).parent = root
    geo.lathe('peg_collar', [(0.027, 0.382), (0.034, 0.39), (0.027, 0.4)], col, wood, segments=32).parent = root
    # the detection box: corner brackets on a cube round the head
    g = geo.glow('detect_box', C.TURQ, 1.8)
    s, arm, th = 0.082, 0.034, 0.0034
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                c = (sx * s, sy * s, HEAD_Z + sz * s)
                for axis in range(3):
                    d = [0.0, 0.0, 0.0]
                    d[axis] = -(sx, sy, sz)[axis] * arm
                    P.rod('detect_arm', c, (c[0] + d[0], c[1] + d[1], c[2] + d[2]), th / 2, col, g, verts=6).parent = root
    return root


def _ring(col):
    """Sixty marks round the figure, one for each second of the cooldown."""
    root = P.group('cooldown', col, loc=(PERSON[0], PERSON[1], 0.0))
    dim = geo.pbr('tick_dim', '#3b3f4b', rough=0.6)
    lit = geo.glow('tick_lit', C.VIOLET, 2.6)
    ticks = []
    for i in range(TICKS):
        a = math.radians(90 - i * 360 / TICKS)      # from the back, clockwise seen from above
        ln = 0.03 if i % 5 == 0 else 0.02
        r = RING_R + ln / 2
        for k, m in enumerate((dim, lit)):
            hgt = 0.0016 + k * 0.0012
            o = geo.box('tick', (ln, 0.0056, hgt), (0, 0, 0), col=col, material=m, bev=0)
            o.location = (r * math.cos(a), r * math.sin(a), hgt / 2)
            o.rotation_euler = (0, 0, a)
            o.parent = root
            if k:
                P.no_shadow(o)
                ticks.append(o)
    y = -(RING_R + 0.064)
    geo.box('ring_plate', (0.1, 0.042, 0.003), (0, y, 0), col=col, material=geo.pbr('ring_plate', '#23262e', rough=0.5), bev=0.001).parent = root
    P.label('ring_60', '60 s', 0.027, col, geo.glow('ring_text', '#c9b8ff', 1.6), x=0.0, y=y, z=0.0032).parent = root
    return ticks


def _sheets(col):
    """The export: two sheets of one workbook, on a small easel."""
    root = P.group('sheets', col, loc=(0.25, -0.212, 0.0), rot=(0, 0, 50.0))
    board = P.group('sheet_board', col, loc=(0, 0, 0.004), rot=(90 - 22, 0, 0), parent=root)
    ply = geo.textured('sheet_ply', 'plywood', tint='#a88560', rough=0.6, scale=0.5, strength=0.6)
    W, H = 0.212, 0.262
    geo.box('board', (W, H, 0.006), (0, H / 2, -0.006), col=col, material=ply, bev=0.002).parent = board
    P.rod('board_leg', (0, 0.06, 0.148), (0, 0.112, 0.0), 0.005, col, ply, verts=10).parent = root
    geo.box('board_clip', (0.07, 0.016, 0.006), (0, H - 0.02, 0.0034), col=col, material=K.brass('clip_brass'), bev=0.002).parent = board
    green = geo.pbr('xl_green', '#1f7a48', rough=0.7)
    dark = P.ink('xl_ink', '#262a2e')
    grey = P.ink('xl_grey', '#a3a29d')
    line = P.ink('xl_line', '#cfcdc6')
    chip = {'in': geo.pbr('xl_in', '#16a37f', rough=0.6), 'out': geo.pbr('xl_out', '#e0912b', rough=0.6), 'bar': geo.pbr('xl_bar', '#7c5fe0', rough=0.6)}

    def page(name, title, x, y, z, w, h, kind):
        parts = [P.sheet(f'{name}_sheet', w, h, col, P.paper('xl_paper', '#f7f6f1'), t=0.0012)]
        x0 = -w / 2 + 0.009
        full = w - 0.018
        parts.append(P.label(f'{name}_title', title, 0.0108, col, dark, x=x0, y=h - 0.014, z=0.0013, align='LEFT'))
        parts.append(geo.box(f'{name}_head', (full, 0.014, 0.0003), (0, h - 0.034, 0.0012), col=col, material=green, bev=0))
        rnd = C.Rand(len(title))
        r = 0
        while True:
            yy = h - 0.053 - r * 0.0165
            if yy < 0.012:
                break
            parts.append(geo.box(f'{name}_rule{r}', (full, 0.0006, 0.0003), (0, yy - 0.0083, 0.0012), col=col, material=line, bev=0))
            nw = full * (0.2 + 0.1 * rnd())
            parts.append(geo.box(f'{name}_n{r}', (nw, 0.0052, 0.0003), (x0 + nw / 2, yy, 0.0012), col=col, material=dark, bev=0))
            if kind == 'log':
                parts.append(geo.box(f'{name}_t{r}', (full * 0.2, 0.0052, 0.0003), (x0 + full * 0.5, yy, 0.0012), col=col, material=grey, bev=0))
                key = 'in' if r % 2 == 0 else 'out'
                parts.append(geo.box(f'{name}_c{r}', (full * 0.17, 0.0086, 0.0003), (x0 + full * 0.86, yy, 0.0012), col=col, material=chip[key], bev=0))
            else:
                bw = full * (0.2 + 0.36 * rnd())
                parts.append(geo.box(f'{name}_b{r}', (bw, 0.0078, 0.0003), (x0 + full * 0.4 + bw / 2, yy, 0.0012), col=col, material=chip['bar'], bev=0))
            r += 1
        return P.group(name, col, parts, loc=(x, y, z), parent=board)

    page('sheet_log', 'Detailed_InOut_Log', 0.014, 0.05, 0.0006, 0.17, 0.196, 'log')
    page('sheet_hours', 'Working_Hours_Summary', -0.012, 0.012, 0.0024, 0.17, 0.196, 'hours')
    return root


def _floor(col):
    """The lobby floor: the turntable's own top as terrazzo, cast in squares
    with brass strips between them (one under the door's sill)."""
    disc = bpy.data.objects.get('disc')
    if disc is not None:
        disc.data.materials.clear()
        disc.data.materials.append(S.scanned('lobby_terrazzo', 'Tiles043', tint='#a29b91', size=0.3, rough=0.3, bump=0.12, spec=0.55))
    brass = geo.pbr('terrazzo_strip', '#a08a58', rough=0.38, metal=0.7)
    r = K.DISC_R - 0.003
    for i, x in enumerate((-0.25, 0.0, 0.25)):
        h = math.sqrt(r * r - x * x)
        geo.box(f'strip_x{i}', (0.0018, 2 * h, 0.0003), (x, 0, 0), col=col, material=brass, bev=0)
    for i, y in enumerate((DOOR_Y - 0.25, DOOR_Y, DOOR_Y + 0.25)):
        if abs(y) < r - 0.02:
            h = math.sqrt(r * r - y * y)
            geo.box(f'strip_y{i}', (2 * h, 0.0018, 0.0003), (0, y, 0), col=col, material=brass, bev=0)


def build(col):
    _floor(col)
    _door(col)
    pan = _camera(col)
    _person(col)
    ticks = _ring(col)
    _sheets(col)
    P.no_ghosts(col)
    return {'pan': pan, 'ticks': ticks}


def animate(t, st):
    # The camera's cone sweeps across the doorway and back, once a loop.
    st['pan'].rotation_euler = (0, 0, math.radians(18) * math.sin(2 * math.pi * t))
    # The cooldown fills second by second, then lets go. (Offset so the still,
    # at t = 0, shows it two thirds full.)
    u = (t + 0.6) % 1.0
    fill = u / 0.9 if u < 0.9 else 1 - C.ease_in_out((u - 0.9) / 0.1)
    n = fill * TICKS
    for i, o in enumerate(st['ticks']):
        k = max(0.0001, C.clamp(n - i))
        o.scale = (k, k, 1)


# ---------------------------------------------------------------- the live jar (pieces/live.py)

# The floor is the disc's own top now, and shows: a full share of the atlas.
LIVE = {'model_uv_scale': {'lobby_terrazzo': 1.0}}


def spots(st):
    """The live jar's numbered dots: the camera (over its shelf), the
    cooldown (on the ring's plate) and the log (on the easel). Each names the
    parts a tap opens it from with the glass off: the camera, its cone and
    the figure it has found; the ring; the two sheets and their easel."""
    from pieces.live import below, box
    bpy.context.view_layer.update()
    _, top_s, shelf = box('cam_shelf')
    _, top_r, plate = box('ring_plate')
    _, top_b, board = box('board')
    near = Vector((shelf.x, shelf.y, shelf.z - 0.03))
    camera = [o.name for o in bpy.data.objects if o.type in ('MESH', 'CURVE', 'FONT') and (o.matrix_world.translation - near).length < 0.09]
    return [
        {'id': 'camera', 'at': (shelf.x, shelf.y, top_s.z + 0.012), 'parts': sorted(set(camera + below('scan_pan') + below('person')))},
        {'id': 'cooldown', 'at': (plate.x, plate.y, top_r.z + 0.008), 'parts': below('cooldown')},
        {'id': 'log', 'at': (board.x, board.y, top_b.z + 0.01), 'parts': below('sheets')},
    ]


def page(st):
    """What the page's glass needs: the floor here is the turntable's own top
    (_floor()). The map of the ground the glass takes from straight above
    leaves the turntable's top out under every other piece's ground; here it
    is the ground, and rays that pass behind the clipboard or the figure come
    down on it."""
    return {'discFloor': True}
