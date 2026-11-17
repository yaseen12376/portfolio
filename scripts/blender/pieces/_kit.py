"""
The bell jar every piece of the collection stands under.

A hand-blown jar with real glass thickness and a ball knob, a brass rim, a
turned walnut base, a paper tag leaning on the base, and a dark pad that
catches the museum spot. Only the turntable inside the jar turns: the jar, the
tag and every reflection hold still, so a full turn loops without a seam.

Rendered on a black world. scripts/build-pieces.mjs then takes the lighter of
each pixel and the page colour (#09090b), so the pad's pool of light fades
into the page and no frame edge shows on the site.

Units are metres, but the jar is modelled big (0.86 m across) and the camera
frames it: only proportions matter.
"""

from __future__ import annotations

import math
import os

import bpy
from mathutils import Vector

import common as C
from kit import geo

# ---------------------------------------------------------------- dimensions

R_IN = 0.42      # the jar's inner radius
WALL = 0.011     # glass thickness
H_WALL = 0.60    # straight wall, above the base
H_APEX = 1.02    # inner apex, above the base
BASE_H = 0.13    # the walnut base
BASE_R = 0.57
DISC_H = 0.006
DISC_R = 0.392   # the turntable: a piece stays inside this radius
ROOM_H = 0.94    # ...and under this height at the centre
FLOOR = BASE_H + DISC_H  # world z of the turntable's top (a piece's z = 0)

SEGMENTS = 128
PAGE = '#09090b'

FONT = os.path.join(C.FONTS, 'geist-mono-latin-wght-normal.woff2')


def source(name: str) -> str:
    """A model borrowed from another project (pieces/sources.json): the copy
    in build/pieces/_src/ when the builder has made one, else the original."""
    import json
    cached = os.path.join(C.ROOT, 'build', 'pieces', '_src', name)
    if os.path.exists(cached):
        return cached
    cfg = json.load(open(os.path.join(os.path.dirname(__file__), 'sources.json'), encoding='utf-8'))[name]
    path = os.environ.get(cfg.get('env', ''), cfg['from'])
    if not os.path.exists(path):
        raise FileNotFoundError(f'{name}: not at {path} (set {cfg.get("env")})')
    return path


def room(r: float) -> float:
    """Clear height above the turntable at radius r (for placing tall things)."""
    if r >= R_IN:
        return 0.0
    cap = H_APEX - H_WALL
    return H_WALL + cap * math.sqrt(max(0.0, 1 - (r / R_IN) ** 2)) - DISC_H


# ---------------------------------------------------------------- materials

def _nodes(name):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    return m, nt, out


def sock(coll, *names):
    for n in names:
        if n in coll:
            return coll[n]
    raise KeyError(names)


def glass(name='jar_glass', tint=(0.985, 0.995, 0.99), ior=1.17):
    """Real glass to the camera, clear to light: shadow and diffuse rays pass
    straight through, so the spot lights the model inside without caustics
    (which are off: they are noise at any affordable sample count).

    The index is museum glass, not window glass: at 1.5 the far wall mirrors a
    brightly lit model back as a veil over everything; at 1.17 the face-on
    reflection is a sixth of that and the edges still catch the light."""
    m, nt, out = _nodes(name)
    g = nt.nodes.new('ShaderNodeBsdfGlass')
    g.inputs['Color'].default_value = (*tint, 1)
    g.inputs['Roughness'].default_value = 0.0
    g.inputs['IOR'].default_value = ior
    t = nt.nodes.new('ShaderNodeBsdfTransparent')
    lp = nt.nodes.new('ShaderNodeLightPath')
    mx = nt.nodes.new('ShaderNodeMath')
    mx.operation = 'MAXIMUM'
    nt.links.new(lp.outputs['Is Shadow Ray'], mx.inputs[0])
    nt.links.new(lp.outputs['Is Diffuse Ray'], mx.inputs[1])
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(mx.outputs[0], mix.inputs[0])
    nt.links.new(g.outputs[0], mix.inputs[1])
    nt.links.new(t.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    return m


def brass(name='jar_brass'):
    return geo.pbr(name, '#c9a25c', rough=0.24, metal=1.0)


def walnut(name='jar_walnut'):
    m = geo.textured(name, 'black_walnut_veneer_01', tint='#4b2f1e', rough=0.48, scale=0.4)
    b = m.node_tree.nodes['Principled BSDF']
    try:
        b.inputs['Specular IOR Level'].default_value = 0.42
        b.inputs['Coat Weight'].default_value = 0.08
        b.inputs['Coat Roughness'].default_value = 0.25
    except KeyError:
        pass
    return m


def pad_material(name='jar_pad', hex_='#1b1a1d', r0=0.59, r1=0.72):
    """The pad under the jar: dark and slightly glossy inside r0, gone by r1.
    The fade is in the material (not the light), so whatever the lights do the
    pool ends in black well inside the frame."""
    m, nt, out = _nodes(name)
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value = C.lin(hex_)
    b.inputs['Roughness'].default_value = 0.5
    try:
        b.inputs['Specular IOR Level'].default_value = 0.25
    except KeyError:
        pass
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    co = nt.nodes.new('ShaderNodeTexCoord')
    ln = nt.nodes.new('ShaderNodeVectorMath')
    ln.operation = 'LENGTH'
    nt.links.new(co.outputs['Object'], ln.inputs[0])
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.interpolation_type = 'SMOOTHSTEP'
    mr.inputs['From Min'].default_value = r0
    mr.inputs['From Max'].default_value = r1
    mr.inputs['To Min'].default_value = 0.0
    mr.inputs['To Max'].default_value = 1.0
    nt.links.new(ln.outputs['Value'], mr.inputs['Value'])
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(mr.outputs[0], mix.inputs[0])
    nt.links.new(b.outputs[0], mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    return m


def sharpen(o, deg=40):
    """Smooth shading that still breaks at real corners."""
    try:
        o.data.set_sharp_from_angle(angle=math.radians(deg))
    except Exception:
        pass
    return o


# ---------------------------------------------------------------- the jar

def _jar_profile():
    ro, ri = R_IN + WALL, R_IN
    cap_o, cap_i = H_APEX + WALL - H_WALL, H_APEX - H_WALL
    n = 30
    neck = 0.024
    pts = [(ro, 0.0), (ro, H_WALL)]
    a_end = math.acos(neck / ro)
    for i in range(1, n + 1):
        a = a_end * i / n
        pts.append((ro * math.cos(a), H_WALL + cap_o * math.sin(a)))
    z = pts[-1][1]
    # the knob: a short neck, then a ball
    ball = 0.052
    zc = z + 0.026 + math.sqrt(ball * ball - neck * neck)
    pts.append((neck, z + 0.026))
    t0 = -math.acos(neck / ball)
    for i in range(1, 17):
        t = t0 + (math.pi / 2 - t0) * i / 16
        r = ball * math.cos(t)
        pts.append((r if i < 16 else 0.0, zc + ball * math.sin(t)))
    # ...and back down the inside
    pts.append((0.0, H_APEX))
    for i in range(n - 1, -1, -1):
        a = (math.pi / 2) * i / n
        pts.append((ri * math.cos(a), H_WALL + cap_i * math.sin(a)))
    pts += [(ri, 0.0), (ro, 0.0)]
    return pts


def _cove(r0, z0, r1, z1, depth, n=8):
    """A concave quarter-turn between two points of a turned profile."""
    out = []
    for i in range(1, n):
        t = i / n
        bulge = math.sin(math.pi * t) * depth
        out.append((r0 + (r1 - r0) * t - bulge, z0 + (z1 - z0) * t))
    return out


def _base_profile():
    r = BASE_R
    pts = [(0.0, 0.0), (r - 0.012, 0.0), (r, 0.010), (r, 0.030), (r - 0.010, 0.040)]
    pts += _cove(r - 0.010, 0.040, r - 0.014, 0.096, 0.020)
    pts += [(r - 0.014, 0.096), (r - 0.006, 0.104), (r - 0.006, 0.120), (r - 0.016, BASE_H), (0.0, BASE_H)]
    return pts


def _ring(name, r0, r1, z0, z1, col, material, round_=0.004, segments=SEGMENTS):
    """A closed ring with softened top edges (a rim, a trim)."""
    pts = [(r0, z0), (r1, z0), (r1, z1 - round_), (r1 - round_, z1), (r0 + round_, z1), (r0, z1 - round_), (r0, z0)]
    return sharpen(geo.lathe(name, pts, col, material, segments=segments), 50)


# ---------------------------------------------------------------- the tag

def _tag(col, lines, yaw_deg=24.0, lean_deg=62.0, w=0.38, h=0.21):
    """`lines`: the name on one or two big lines, then a small line under a
    red rule (a year, a kind). Pass '' to leave a line out."""
    paper = geo.pbr('tag_paper', '#eee4cf', rough=0.86)
    ink = geo.pbr('tag_ink', '#1d1a17', rough=0.7)
    rule = geo.pbr('tag_rule', '#8a2d27', rough=0.7)
    t = 0.0025
    cut = 0.045
    x0, x1 = -w / 2, w / 2
    poly = [(x0 + cut, 0), (x1, 0), (x1, h), (x0 + cut, h), (x0, h - cut), (x0, cut)]
    parts = [geo.extrude('tag_sheet', poly, t, col=col, material=paper, bev=0)]
    eye = (x0 + 0.042, h / 2)
    parts.append(geo.cyl('tag_hole', 0.011, 0.0006, (eye[0], eye[1], t), col=col, material=geo.pbr('tag_dark', '#0c0b0a', rough=0.9), verts=24, bev=0))
    parts.append(_ring('tag_eyelet', 0.011, 0.019, t, t + 0.0016, col, brass(), round_=0.0005, segments=28))
    parts[-1].location = (eye[0], eye[1], 0)
    # sized to the room right of the eyelet
    tx = (eye[0] + 0.03 + x1 - 0.018) / 2
    room_w = x1 - 0.018 - (eye[0] + 0.03)
    big1, big2, small = (tuple(lines) + ('', '', ''))[:3]
    s_big = min(0.047, room_w / (0.62 * max(len(big1), len(big2), 1)))
    s_small = min(0.021, room_w / (0.62 * max(len(small), 1)))
    rows = [(big1, 0.71), (big2, 0.48)] if big2 else [(big1, 0.62)]
    rule_y, small_y = (0.315, 0.175) if big2 else (0.40, 0.24)

    def line(name, body, size, y):
        parts.append(geo.text(name, body, size=size, depth=0.0003, loc=(tx, h * y, t + 0.0002), rot=(0, 0, 0), col=col,
                              material=ink, font_path=FONT, resolution=4))

    for i, (body, y) in enumerate(rows):
        if body:
            line(f'tag_big{i}', body, s_big, y)
    if small:
        parts.append(geo.box('tag_rule', (room_w, 0.0016, 0.0003), (tx, h * rule_y, t), col=col, material=rule, bev=0))
        line('tag_small', small, s_small, small_y)

    lean, yaw = math.radians(lean_deg), math.radians(yaw_deg)
    # The sheet leans on the base's top edge. The base is round and the sheet
    # is flat, so it touches at its middle only: clear of the widest radius,
    # or the curve pokes through the paper.
    rb = (BASE_R - 0.001) + 0.120 / math.tan(lean)
    root = C.empty('tag', col, loc=(rb * math.sin(yaw), -rb * math.cos(yaw), 0.001))
    root.rotation_euler = (lean, 0, yaw)
    for p in parts:
        p.parent = root
    bpy.context.view_layer.update()

    # The string: out of the eyelet, down onto the pad, and away in a loose curl.
    a = root.matrix_world @ Vector((eye[0], eye[1], t + 0.002))
    out_dir = Vector((math.sin(yaw), -math.cos(yaw), 0))
    side = Vector((-math.cos(yaw), -math.sin(yaw), 0))
    pts = []
    n = 26
    for i in range(n + 1):
        u = i / n
        p = a + out_dir * (0.015 + 0.075 * u) + side * (0.07 * u + 0.045 * math.sin(u * math.pi * 1.5) * u)
        z = a.z * (1 - u) ** 2.2 + 0.004
        pts.append((p.x, p.y, z))
    geo.tube('tag_string', pts, radius=0.0022, col=col, material=geo.pbr('tag_twine', '#b9a27c', rough=0.9), resolution=2)
    return root


# ---------------------------------------------------------------- light + camera

def _hide_from_camera(ob):
    """A light is a reflection on the glass and nothing else: never seen
    directly, and never seen through the jar (a strip behind it would show as
    a bright rectangle in the middle of the glass)."""
    for k in ('visible_camera', 'visible_transmission'):
        try:
            setattr(ob, k, False)
        except Exception:
            pass
    return ob


def _strip(name, loc, target, power, w, h, color, only=None):
    """`only`: 'glossy' for a light that exists as a reflection and lights
    nothing, 'diffuse' for a fill that lights and is never reflected."""
    ld = bpy.data.lights.new(name, 'AREA')
    ld.shape = 'RECTANGLE'
    ld.size = w
    ld.size_y = h
    ld.energy = power
    ld.color = C.lin(color)[:3]
    ob = C.link(bpy.data.objects.new(name, ld))
    ob.location = loc
    C.aim(ob, target)
    if only:
        try:
            ob.visible_diffuse = only == 'diffuse'
            ob.visible_glossy = only == 'glossy'
        except Exception:
            pass
    return _hide_from_camera(ob)


def _spot(name, loc, target, power, cone_deg, blend, color, radius=0.07):
    ld = bpy.data.lights.new(name, 'SPOT')
    ld.energy = power
    ld.spot_size = math.radians(cone_deg)
    ld.spot_blend = blend
    ld.shadow_soft_size = radius
    ld.color = C.lin(color)[:3]
    ob = C.link(bpy.data.objects.new(name, ld))
    ob.location = loc
    C.aim(ob, target)
    return _hide_from_camera(ob)


def _only(light, objs, name):
    """Light linking: this light falls on these objects and on nothing else."""
    try:
        col = bpy.data.collections.new(name)
        for o in objs:
            col.objects.link(o)
        light.light_linking.receiver_collection = col
        return True
    except Exception as e:
        print('light linking skipped:', e)
        return False


def lights(glassware, accent=None):
    """`glassware`: the jar and its brass. The strips that draw the glass fall
    on those alone, so they can be as strong as the glass needs without
    bleaching the base, the pad or the model."""
    mid = (0, 0, BASE_H + 0.45)
    # The museum spot: warm, from above and a little in front.
    _spot('spot', (0.55, -1.25, 3.3), (0, 0.02, BASE_H + 0.2), 760, 46, 0.8, '#ffe6cc')
    # A soft fill from the front left, so the side away from the spot is not lost.
    _strip('fill', (-2.4, -2.2, 1.5), mid, 42, 1.6, 1.6, '#e9eeff', only='diffuse')
    draw = [
        # A tall window, front left: the long highlight that says "glass".
        _strip('window', (-2.5, -2.1, 1.55), mid, 440, 0.85, 2.1, '#f1f4ff', only='glossy'),
        # Two strips behind: the edge lines that separate the jar from the dark.
        _strip('edge_l', (-1.75, 1.55, 1.1), mid, 420, 0.3, 2.3, '#e6ecff', only='glossy'),
        _strip('edge_r', (1.85, 1.35, 1.1), mid, 360, 0.3, 2.3, C.mix('#e6ecff', C.VIOLET, 0.45), only='glossy'),
    ]
    for i, ld in enumerate(draw):
        _only(ld, glassware, f'glassware_{i}')
    # A low violet kiss from behind, the site's accent.
    _strip('rim', (0.4, 2.3, 0.5), (0, 0, BASE_H + 0.3), 9, 1.2, 0.5, accent or C.VIOLET)


def camera(sc, pitch_deg=20.0, fov_deg=21.0, frame_h=1.92, target=(0.0, 0.0, 0.50)):
    """One camera for every piece: the same height, the same baseline.
    (`target` and `frame_h` are only ever changed for a close look while
    building a piece.)"""
    target = Vector(target)
    dist = (frame_h / 2) / math.tan(math.radians(fov_deg) / 2)
    p = math.radians(pitch_deg)
    loc = target + Vector((0, -math.cos(p), math.sin(p))) * dist
    return C.camera(sc, tuple(loc), tuple(target), fov_deg=fov_deg)


# ---------------------------------------------------------------- assemble

def build(sc, tag_lines=('', ''), accent=None, disc='#1c2622'):
    """Jar, base, pad, tag, lights and camera. Returns the turntable (an empty
    at the top of the disc: parent a piece's objects to it) and the collection
    a piece builds into."""
    jar = C.collection('jar')
    g = geo.lathe('jar_glass', _jar_profile(), jar, glass(), segments=SEGMENTS, loc=(0, 0, BASE_H))
    sharpen(g, 35)

    b = geo.lathe('jar_base', _base_profile(), jar, walnut(), segments=SEGMENTS)
    sharpen(b, 28)
    rim = _ring('jar_rim', R_IN + WALL + 0.0015, R_IN + WALL + 0.034, BASE_H - 0.002, BASE_H + 0.034, jar, brass(), round_=0.006)
    trim = _ring('jar_trim', DISC_R + 0.001, R_IN - 0.0015, BASE_H - 0.002, BASE_H + 0.011, jar, brass(), round_=0.002)

    pad = geo.cyl('jar_pad', 1.7, 0.004, (0, 0, -0.004), col=jar, material=pad_material(), verts=96, bev=0)
    pad.visible_shadow = False

    tt = C.empty('turntable', jar, loc=(0, 0, FLOOR))
    d = geo.cyl('disc', DISC_R, DISC_H, (0, 0, BASE_H), col=jar, material=geo.pbr('disc', disc, rough=0.94), verts=96, bev=0)
    d.parent = tt
    d.matrix_parent_inverse = tt.matrix_world.inverted()

    if any(tag_lines):
        _tag(jar, tuple(tag_lines))
    lights([g, rim, trim], accent)
    camera(sc)
    return {'turntable': tt, 'jar': jar, 'piece': C.collection('piece'), 'disc': d}


def mount(st):
    """Parent everything a piece built (its top-level objects) to the turntable."""
    tt = st['turntable']
    for o in st['piece'].all_objects:
        if o.parent is None:
            o.parent = tt  # piece space: z = 0 is the top of the disc
