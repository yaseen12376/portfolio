"""
AthleteVision: one phone on a stand, counting sit-ups.

The app's ninth test, as its README describes it: the phone films side-on at
mat height, and a sit-up counts at the moment the elbows touch the knees. A
jointed wooden figure does one sit-up a loop, fingers clasped behind the neck
as the handbook asks; the pose landmarks the phone tracks ride on its joints.
Around it, the kit of the other tests: a floor tape, two cones and the
medicine ball. A toy, not a person: no face, no athlete.
"""

from __future__ import annotations

import math

from mathutils import Vector

import common as C
from kit import geo
from pieces import _kit as K
from pieces import _parts as P

META = {
    'id': 'athletevision',
    'tag': ('ATHLETE', 'VISION', 'FITNESS TESTS  2026'),
    'accent': '#06d6a0',
    'disc': '#17222b',
}

YAW = 33.0            # the mat's turn on the disc, so the phone stands front right
MAT_T = 0.014
HIP = Vector((0.06, 0.0, MAT_T + 0.047))
TORSO, NECK, HEAD_R = 0.2, 0.03, 0.054
UPPER, FORE, THIGH, SHIN = 0.118, 0.125, 0.16, 0.16
SH_Y, HIP_Y = 0.07, 0.046
LOW, HIGH = 7.0, 74.0  # the torso's angle off the mat, lying and up


def _figure(col, root):
    wood = P.wood('toy_maple', '#d6b488', rough=0.5)
    joint = geo.pbr('toy_joint', '#8b6646', rough=0.45)
    glow = geo.glow('pose_glow', C.TURQ, 1.9)
    dot_r, line_r = 0.0098, 0.0036

    def dot(p, parent):
        o = P.ball('pose_dot', dot_r, col, glow, loc=tuple(p), seg=14)
        o.parent = parent
        return o

    def line(a, b, parent):
        o = P.rod('pose_line', a, b, line_r, col, glow, verts=8)
        o.parent = parent
        return o

    # ---- the legs: knees up, feet flat, still for the whole loop
    legs = P.group('legs', col, parent=root)
    knee_a = math.radians(56)
    knees = []
    for s in (-1, 1):
        hip = Vector((HIP.x, s * HIP_Y, HIP.z))
        knee = hip + Vector((math.cos(knee_a), 0, math.sin(knee_a))) * THIGH
        az = MAT_T + 0.03
        ankle = Vector((knee.x + math.sqrt(max(0.0, SHIN ** 2 - (knee.z - az) ** 2)), s * HIP_Y, az))
        P.limb('thigh', hip, knee, 0.04, 0.032, col, wood, legs)
        P.limb('shin', knee, ankle, 0.03, 0.024, col, wood, legs)
        P.ball('knee', 0.034, col, joint, loc=tuple(knee)).parent = legs
        P.limb('foot', ankle + Vector((-0.012, 0, -0.008)), ankle + Vector((0.07, 0, -0.012)), 0.022, 0.018, col, wood, legs)
        out = Vector((0, s * 0.043, 0))
        for p in (hip + out, knee + out, ankle + out * 0.75):
            dot(p, legs)
        line(hip + out, knee + out, legs)
        line(knee + out, ankle + out * 0.75, legs)
        knees.append(knee)

    # ---- the torso, head and arms: one rigid part that turns at the hips.
    # Its own frame: +Z up the spine, +X out of the chest.
    torso = P.group('torso', col, loc=tuple(HIP), parent=root)
    body = P.capsule('trunk', TORSO, 0.05, 0.06, col, wood, segments=24)
    body.scale = (0.8, 1.12, 1.0)
    body.parent = torso
    P.ball('hips', 0.052, col, joint, loc=(0, 0, 0)).parent = torso
    P.limb('neck', (0.004, 0, TORSO + 0.03), (0.008, 0, TORSO + 0.06 + NECK), 0.024, 0.022, col, wood, torso)
    head_c = Vector((0.012, 0, TORSO + 0.06 + NECK + HEAD_R * 0.86))
    head = P.ball('head', HEAD_R, col, wood, loc=tuple(head_c), seg=28)
    head.scale = (1.0, 0.9, 1.12)
    head.parent = torso
    dot(head_c + Vector((HEAD_R * 0.98, 0, 0.0)), torso)       # the nose landmark, on a blank face
    elbows = []
    for s in (-1, 1):
        sh = Vector((0.0, s * SH_Y, TORSO + 0.02))
        hand = Vector((-0.03, s * 0.026, TORSO + 0.06 + NECK * 0.6))   # clasped behind the neck
        el = P.elbow(sh, hand, UPPER, FORE, (1.0, s * 0.55, -0.35))
        P.ball('shoulder', 0.034, col, joint, loc=tuple(sh)).parent = torso
        P.limb('upper_arm', sh, el, 0.028, 0.024, col, wood, torso)
        P.ball('elbow', 0.027, col, joint, loc=tuple(el)).parent = torso
        P.limb('forearm', el, hand, 0.023, 0.02, col, wood, torso)
        out = Vector((0, s * 0.036, 0))
        hip_l = Vector((0, s * (HIP_Y + 0.043), 0))
        for p in (sh + out, el + out, hand + out * 0.6):
            dot(p, torso)
        line(sh + out, el + out, torso)
        line(el + out, hand + out * 0.6, torso)
        line(hip_l, sh + out, torso)
        elbows.append(el)
    return torso, elbows, knees


def _phone(col, root):
    """The phone on its stand, filming side-on. Its screen faces away from the
    athlete: the app's own view, with the count."""
    stand = P.group('stand', col, loc=(0.02, -0.315, 0.0), parent=root)
    black = geo.pbr('stand_black', '#1c1d21', rough=0.4)
    steel = geo.pbr('stand_steel', '#8f949b', rough=0.3, metal=1.0)
    top = Vector((0, 0, 0.3))
    for i in range(3):
        a = math.radians(90 + i * 120)
        foot = Vector((0.092 * math.cos(a), 0.092 * math.sin(a), 0.006))
        P.rod(f'stand_leg{i}', foot, top, 0.0075, col, black, verts=12).parent = stand
        P.ball(f'stand_foot{i}', 0.011, col, black, loc=tuple(foot), seg=12).parent = stand
    P.rod('stand_column', (0, 0, 0.26), (0, 0, 0.385), 0.0065, col, steel, verts=12).parent = stand
    P.ball('stand_hub', 0.017, col, black, loc=(0, 0, 0.3), seg=14).parent = stand
    P.ball('stand_head', 0.014, col, black, loc=(0, 0, 0.387), seg=14).parent = stand

    w, h = 0.2, 0.094
    ph = P.group('phone', col, loc=(0, -0.004, 0.395), rot=(90 - 8, 0, 0), parent=stand)
    parts = [geo.box('phone_body', (w, h, 0.011), (0, h / 2, -0.011), col=col, material=geo.pbr('phone_body', '#22242a', rough=0.3, metal=0.6), bev=0.005)]
    parts.append(geo.box('phone_screen', (w - 0.012, h - 0.012, 0.0006), (0, h / 2, 0), col=col,
                         material=geo.pbr('phone_screen', '#0a1418', rough=0.12, emit='#0f2a2c', emit_strength=0.6), bev=0))
    parts.append(geo.box('phone_clamp', (0.035, 0.016, 0.02), (0, -0.006, -0.017), col=col, material=black, bev=0.003))
    lens = geo.cyl('phone_lens', 0.008, 0.003, (-w / 2 + 0.024, h - 0.024, -0.0135), col=col, material=geo.pbr('lens', '#0b0c10', rough=0.05), verts=18, bev=0.0008)
    parts.append(lens)
    # what the app shows: the figure it is tracking, and the count
    g = geo.glow('screen_pose', C.TURQ, 2.0)
    pts = {'hip': (-0.02, 0.022), 'sh': (-0.034, 0.058), 'head': (-0.036, 0.073), 'el': (-0.006, 0.054), 'knee': (0.004, 0.05), 'ank': (0.026, 0.022)}
    for i, (a, b) in enumerate((('hip', 'sh'), ('sh', 'el'), ('hip', 'knee'), ('knee', 'ank'))):
        parts.append(P.stroke(f'screen_l{i}', pts[a], pts[b], 0.0034, col, g, z=0.0007))
    for k, p in pts.items():
        parts.append(geo.cyl(f'screen_d_{k}', 0.0048, 0.0005, (p[0], p[1], 0.0007), col=col, material=g, verts=12, bev=0))
    white = geo.glow('screen_white', '#eafff8', 1.6)
    parts.append(P.label('screen_count', '12', 0.04, col, white, x=0.056, y=0.05, z=0.0007))
    parts.append(P.label('screen_unit', 'SIT-UPS', 0.0105, col, g, x=0.056, y=0.019, z=0.0007))
    for p in parts:
        p.parent = ph
    return stand


def _kit(col, root):
    orange = geo.pbr('cone_orange', '#e2571c', rough=0.5)
    white = geo.pbr('cone_white', '#f0ede6', rough=0.55)
    for i, (x, y) in enumerate(((-0.27, -0.2), (0.28, 0.17))):
        g = P.group(f'cone{i}', col, loc=(x, y, 0), parent=root)
        geo.box('cone_foot', (0.075, 0.075, 0.007), (0, 0, 0), col=col, material=orange, bev=0.002).parent = g
        geo.lathe('cone_body', [(0.0, 0.006), (0.03, 0.006), (0.009, 0.105), (0.006, 0.112), (0.0, 0.112)], col, orange, segments=24).parent = g
        geo.lathe('cone_band', [(0.0222, 0.04), (0.0162, 0.066), (0.0166, 0.067), (0.0228, 0.039)], col, white, segments=24).parent = g
    # the floor tape, with a mark every tenth
    tape = P.group('floor_tape', col, loc=(0.0, 0.185, 0.0), parent=root)
    geo.box('tape', (0.5, 0.024, 0.0012), (0, 0, 0), col=col, material=geo.pbr('tape_white', '#efece4', rough=0.7), bev=0).parent = tape
    dark = P.ink('tape_mark', '#22252b')
    for i in range(11):
        geo.box(f'tape_tick{i}', (0.0022, 0.014 if i % 5 == 0 else 0.008, 0.0004), (-0.24 + i * 0.048, 0.004, 0.0012), col=col, material=dark, bev=0).parent = tape
    # the medicine ball
    mb = P.group('med_ball', col, loc=(-0.15, 0.275, 0.0), parent=root)
    P.ball('ball', 0.055, col, geo.pbr('ball_rubber', '#23395d', rough=0.55), loc=(0, 0, 0.055), seg=32).parent = mb
    P.ring('ball_seam', 0.0553, 0.0022, col, geo.pbr('ball_seam', '#e2571c', rough=0.5), z=0.055, segments=48, sides=6).parent = mb
    s2 = P.ring('ball_seam2', 0.0553, 0.0022, col, geo.pbr('ball_seam', '#e2571c', rough=0.5), z=0.0, segments=48, sides=6)
    s2.rotation_euler = (math.radians(90), 0, math.radians(30))
    s2.location = (0, 0, 0.055)
    s2.parent = mb


def _stopwatch(col):
    """The 45 seconds a sit-up attempt lasts, on a stopwatch hung in the jar.
    A dial on both faces; the hand goes round once a loop."""
    z, r = 0.735, 0.082
    root = P.group('stopwatch', col, loc=(0, 0, z), rot=(0, 0, -14.0))
    brass = K.brass('watch_brass')
    case = P.rod('watch_case', (0, -0.013, 0), (0, 0.013, 0), r, col, brass, verts=64, bev=0.004)
    case.parent = root
    P.rod('watch_stem', (0, 0, r - 0.002), (0, 0, r + 0.02), 0.011, col, brass, verts=20).parent = root
    crown = P.ring('watch_ring', 0.017, 0.0034, col, brass, segments=32, sides=8)
    crown.rotation_euler = (0, math.radians(90), 0)
    crown.location = (0, 0, r + 0.034)
    crown.parent = root
    geo.tube('watch_thread', [(0, 0, r + 0.05), (0, 0, K.room(0) - z - 0.002)], radius=0.0011, col=col,
             material=geo.pbr('thread', '#8d9198', rough=0.4, metal=1.0), resolution=2).parent = root
    dark = P.ink('watch_ink', '#20232a')
    red = geo.pbr('watch_hand', '#e2571c', rough=0.4, emit='#e2571c', emit_strength=0.6)
    hands = []
    for k, face in enumerate((-1, 1)):
        f = P.group(f'watch_face{k}', col, loc=(0, face * 0.0132, 0), rot=(90, 0, 0 if face < 0 else 180), parent=root)
        parts = [geo.cyl('watch_dial', r - 0.008, 0.0008, (0, 0, 0), col=col, material=P.paper('watch_dial', '#f3efe6'), verts=64, bev=0)]
        for i in range(12):
            a = math.radians(i * 30)
            long = i % 3 == 0
            r0, r1 = r - (0.026 if long else 0.02), r - 0.012
            parts.append(P.stroke(f'watch_tick{i}', (r0 * math.sin(a), r0 * math.cos(a)), (r1 * math.sin(a), r1 * math.cos(a)), 0.003 if long else 0.0018,
                                  col, dark, z=0.0008))
        # the 45 s of the attempt, as an arc round three quarters of the dial
        arc = P.flat_ring('watch_arc', r - 0.0105, r - 0.0085, col, geo.glow('watch_arc', C.TURQ, 1.4), z=0.0008, h=0.0004, a0=-180, a1=90)
        parts.append(arc)
        parts.append(P.label('watch_45', '45 s', 0.019, col, dark, x=0, y=-0.03, z=0.0008))
        hand = P.group('watch_hand', col, parent=f)
        hp = P.stroke('watch_hand_bar', (0, -0.012), (0, r - 0.022), 0.0038, col, red, z=0.0016, depth=0.0008)
        hp.parent = hand
        parts.append(geo.cyl('watch_pin', 0.006, 0.003, (0, 0, 0.0008), col=col, material=brass, verts=16, bev=0.0008))
        for q in parts:
            q.parent = f
        hands.append(hand)
    return hands


def build(col):
    root = P.group('rig', col, rot=(0, 0, YAW))
    mat = geo.box('mat', (0.64, 0.25, MAT_T), (0, 0, 0), col=col, material=geo.pbr('mat_blue', '#2c5a9e', rough=0.72), bev=0.006)
    mat.parent = root
    trim = geo.box('mat_trim', (0.6, 0.21, 0.0006), (0, 0, MAT_T), col=col, material=geo.pbr('mat_blue2', '#3468b2', rough=0.7), bev=0)
    trim.parent = root
    torso, elbows, knees = _figure(col, root)
    _phone(col, root)
    _kit(col, root)

    # How far up is "elbows touch knees"? The angle at which the elbow comes
    # closest to the knee (the knee never moves).
    best = (1e9, HIGH)
    for deg in range(55, 89):
        th = math.radians(deg)
        el = elbows[1]
        # torso frame -> rig frame: +Z along the spine, +X out of the chest
        spine = Vector((-math.cos(th), 0, math.sin(th)))
        chest = Vector((math.sin(th), 0, math.cos(th)))
        p = HIP + spine * el.z + chest * el.x + Vector((0, el.y, 0))
        d = (p - knees[1]).length
        if d < best[0]:
            best = (d, float(deg))
    hands = _stopwatch(col)
    P.no_ghosts(col)
    return {'torso': torso, 'high': min(best[1], 80.0), 'hands': hands}


def animate(t, st):
    # One sit-up a loop. The still (t = 0) is the counted moment: up, elbows
    # at the knees.
    e = 0.5 + 0.5 * math.cos(2 * math.pi * t)
    e = e * e * (3 - 2 * e)                       # rest a beat at each end
    theta = LOW + (st['high'] - LOW) * e
    st['torso'].rotation_euler = (0, math.radians(theta - 90), 0)
    for h in st['hands']:
        h.rotation_euler = (0, 0, -2 * math.pi * t)
