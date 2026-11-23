"""
KPS Clean-O: the storefront's own products, in a crate on a doorstep.

The storefront (a redesign concept for a local cleaning-products brand) ends
in a 3D doorstep you clean with the products. These are that project's own
product models (style-previews/3d/_bake/tools.glb, copied into build/), kept
at their true sizes relative to one another. The palette is the site's: leaf
green #1f7a4d and cream #fff8ee. The kolam is drawn the way that project
draws it: a sikku kolam, one closed line that mirrors off the edge of a grid
of dots. The step is a red-oxide floor, as a Tamil doorstep has.

Soap bubbles rise from the scrubber's suds, each a whole number of times a
loop, and pop at the top. The step is polished red oxide, mottled as a real
one is, and the crate painted wood (scanned surfaces, ambientCG, CC0).
"""

from __future__ import annotations

import math

import bpy
from mathutils import Matrix, Vector

import common as C
from kit import geo
from pieces import _kit as K
from pieces import _parts as P
from pieces import _scans as SC

META = {
    'id': 'kps-cleano',
    'tag': ('KPS', 'CLEAN-O', 'STOREFRONT  2026'),
    'accent': '#57c48a',
    'disc': '#1d1916',
}

LEAF, CREAM, CREAM_DEEP = '#1f7a4d', '#fff8ee', '#f6ebd9'
S = 0.47                      # the products are modelled at full size
STEP = (0.6, 0.46, 0.026)     # the doorstep slab: w, d, h
TOP = STEP[2]
CRATE = (-0.02, 0.112, -6.0)  # x, y, yaw
CRATE_FLOOR = TOP + 0.012

# Standing in the crate: x, y (piece space), yaw, lean back (degrees).
IN_CRATE = {
    'kps-big-21': (-0.03, 0.16, -3.0, 7.0),
    'i-steel-set': (-0.115, 0.09, 14.0, 5.0),
    'coco-gold': (0.095, 0.145, -16.0, 9.0),
    'burma-fan-broom': (0.005, 0.085, 9.0, 4.0),
}
LEFT_OUT = ('ceiling-brush-gold', 'micro-fibre-40x40')

SUDS = Vector((0.142, -0.092, 0.0))   # the scrubber, on the mat (z filled in by build)
BUBBLES = (  # radius, cycles a loop, phase, drift side
    (0.040, 1, 0.00, 1.0), (0.026, 1, 0.13, -1.0), (0.034, 1, 0.27, 0.6), (0.020, 2, 0.06, -0.8),
    (0.030, 1, 0.41, -0.4), (0.017, 2, 0.31, 0.9), (0.036, 1, 0.56, 0.2), (0.024, 1, 0.70, -1.0),
    (0.028, 1, 0.84, 0.7), (0.015, 2, 0.45, -0.3),
)
TOP_Z = 0.84


# ---------------------------------------------------------------- the step and its kolam

def _step(col):
    # Polished red oxide: glossy, its shine and its colour mottled.
    red = SC.scanned('red_oxide', 'Concrete046', tint='#8c3424', size=0.45, rough=0.24, bump=0.08, detail=0.7, spec=0.6)
    geo.box('step', (STEP[0], STEP[1], STEP[2]), (0, 0, 0), col=col, material=red, bev=0.006)


def _kolam_line(p_=3, q_=4):
    """The project's sikku kolam (scripts/blender/doorstep3d.py, kolam()): a
    mirror curve on a p x q grid of dots, in grid units, unrotated."""
    start, d = (0.5, 0.0), (1, 1)
    pts, refl = [], []
    m, dd = start, d
    while True:
        m = (m[0] + dd[0] * 0.5, m[1] + dd[1] * 0.5)
        r = False
        if abs(m[0] - round(m[0])) < 1e-9 and round(m[0]) in (0, p_):
            dd = (-dd[0], dd[1])
            r = True
        if abs(m[1] - round(m[1])) < 1e-9 and round(m[1]) in (0, q_):
            dd = (dd[0], -dd[1])
            r = True
        pts.append(m)
        refl.append(r)
        if m == start and dd == d:
            break
    out = []
    rad = math.sqrt(2) / 4
    n = len(pts)
    for k in range(n):
        a, b, c = Vector(pts[k - 1]), Vector(pts[k]), Vector(pts[(k + 1) % n])
        n0, n1 = (a + b) / 2, (b + c) / 2
        if not refl[k]:
            out += [n0, b]
            continue
        centre = n0 + n1 - b
        a0 = math.atan2(n0.y - centre.y, n0.x - centre.x)
        a1 = math.atan2(n1.y - centre.y, n1.x - centre.x)
        da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
        for s in range(9):
            ang = a0 + da * s / 8
            out.append(centre + rad * Vector((math.cos(ang), math.sin(ang))))
    dense = [out[0]]
    for p in out[1:] + [out[0]]:
        q = dense[-1]
        steps = max(1, int((p - q).length / 0.08))
        for s in range(1, steps + 1):
            dense.append(q.lerp(p, s / steps))
    dots = [Vector((i + 0.5, j + 0.5)) for i in range(p_) for j in range(q_)]
    return dense[:-1], dots, (p_ / 2, q_ / 2)


def _kolam(col, at=(-0.14, -0.11), spacing=0.044, p_=3, q_=4):
    chalk = geo.pbr('rice_flour', '#f4efe4', rough=0.95)
    line, dots, (cx, cy) = _kolam_line(p_, q_)
    rot = math.radians(45)

    def place(v, z):
        x, y = (v.x - cx) * spacing, (v.y - cy) * spacing
        return (at[0] + x * math.cos(rot) - y * math.sin(rot), at[1] + x * math.sin(rot) + y * math.cos(rot), z)

    # Built at z = 0 and then lifted, so flattening it squashes it in place.
    stroke = geo.tube('kolam_line', [place(v, 0.0) for v in line], radius=0.003, col=col, material=chalk, resolution=2, closed=True)
    stroke.location.z = TOP + 0.0012
    stroke.scale.z = 0.4
    for i, v in enumerate(dots):
        x, y, _ = place(v, 0)
        geo.cyl(f'kolam_dot{i}', 0.0042, 0.0012, (x, y, TOP), col=col, material=chalk, verts=14, bev=0)


# ---------------------------------------------------------------- the crate

def _crate(col):
    x, y, yaw = CRATE
    root = P.group('crate', col, loc=(x, y, TOP), rot=(0, 0, yaw))
    green = SC.scanned('crate_green', 'PaintedWood007A', tint=LEAF, size=0.2, rough=0.5, bump=0.3)
    cream = geo.pbr('crate_cream', CREAM_DEEP, rough=0.6)
    w, d, h, post, slat = 0.34, 0.16, 0.122, 0.018, 0.009
    parts = [geo.box('crate_floor', (w - 0.01, d - 0.01, CRATE_FLOOR - TOP), (0, 0, 0), col=col, material=green, bev=0.002)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(geo.box('crate_post', (post, post, h), (sx * (w / 2 - post / 2), sy * (d / 2 - post / 2), 0), col=col, material=cream, bev=0.003))
    for z in (0.016, 0.07):
        for sy in (-1, 1):
            parts.append(geo.box('crate_slat', (w - 2 * post + 0.004, slat, 0.042), (0, sy * (d / 2 - slat / 2), z), col=col, material=green, bev=0.002))
        for sx in (-1, 1):
            parts.append(geo.box('crate_slat', (slat, d - 2 * post + 0.004, 0.042), (sx * (w / 2 - slat / 2), 0, z), col=col, material=green, bev=0.002))
    for p in parts:
        p.parent = root
    return root


# ---------------------------------------------------------------- the products

def _products(col):
    before = P.names()
    bpy.ops.import_scene.gltf(filepath=K.source('kps-tools.glb'))
    P.adopt(col, before)
    roots = {o.name: o for o in bpy.data.objects if o.name not in before and o.parent is None}
    for name in LEFT_OUT:
        r = roots.pop(name, None)
        if r is not None:
            for o in [*r.children_recursive, r]:
                bpy.data.objects.remove(o, do_unlink=True)

    def put(name, x, y, z, yaw=0.0, lean=0.0):
        r = roots[name]
        r.rotation_mode = 'XYZ'
        r.matrix_world = (Matrix.Translation((x, y, z)) @ Matrix.Rotation(math.radians(yaw), 4, 'Z')
                          @ Matrix.Rotation(math.radians(-lean), 4, 'X') @ Matrix.Scale(S, 4))
        return r

    for name, (x, y, yaw, lean) in IN_CRATE.items():
        put(name, x, y, CRATE_FLOOR, yaw, lean)
    put('nar-mat-24x16', 0.15, -0.1, TOP, yaw=8.0)
    put('white-phenyl', 0.226, 0.126, TOP, yaw=-30.0)
    mat_top = TOP + 0.018 * S
    put('handle-scrubber', SUDS.x, SUDS.y, mat_top, yaw=-28.0)
    return mat_top + 0.071 * S


# ---------------------------------------------------------------- suds and bubbles

def _bubble_material():
    """A soap film: no refraction, colour from thin-film interference."""
    m, nt, out = K._nodes('soap_film')
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value = (1, 1, 1, 1)
    b.inputs['Roughness'].default_value = 0.0
    b.inputs['IOR'].default_value = 1.0
    K.sock(b.inputs, 'Transmission Weight', 'Transmission').default_value = 1.0
    for k, v in (('Thin Film Thickness', 480.0), ('Thin Film IOR', 1.33)):
        if k in b.inputs:
            b.inputs[k].default_value = v
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    return m


def _suds(col, z):
    foam = geo.pbr('suds', '#f7f8f8', rough=0.35)
    rnd = C.Rand(17)
    for i in range(16):
        a = rnd() * math.tau
        r = 0.008 + 0.022 * rnd() ** 0.7
        s = 0.005 + 0.009 * rnd()
        P.ball(f'suds{i}', s, col, foam, loc=(SUDS.x + r * math.cos(a), SUDS.y + r * math.sin(a) * 0.7, z - 0.002 + s * 0.6), seg=12)


def _path(u, side):
    """Where a bubble is, u of the way up: out of the suds, drifting in toward
    the jar's axis as it climbs (the dome narrows), with a lazy sway."""
    z0 = SUDS.z + 0.02
    z = z0 + (TOP_Z - z0) * u
    pull = C.smoothstep(0.0, 1.0, u) * 0.82
    x = SUDS.x * (1 - pull) + side * 0.03 * math.sin(math.tau * (1.5 * u + 0.2 * side))
    y = SUDS.y * (1 - pull) + 0.022 * math.cos(math.tau * (1.1 * u + 0.3 * side))
    return Vector((x, y, z))


def _bubbles(col):
    film = _bubble_material()
    out = []
    for i, (r, k, phase, side) in enumerate(BUBBLES):
        o = P.ball(f'bubble{i}', 1.0, col, film, seg=32)
        o.visible_shadow = False
        out.append((o, r, k, phase, side))
    # The strips that draw the jar's edges fall on the glass alone (light
    # linking); a soap film needs those same long highlights to read.
    for name in ('glassware_0', 'glassware_1', 'glassware_2'):
        g = bpy.data.collections.get(name)
        if g is not None:
            for o, *_ in out:
                g.objects.link(o)
    return out


# ---------------------------------------------------------------- build + move

def build(col):
    _step(col)
    _kolam(col)
    _crate(col)
    SUDS.z = _products(col)
    _suds(col, SUDS.z)
    bubbles = _bubbles(col)
    P.no_ghosts(col)
    return {'bubbles': bubbles}


def animate(t, st):
    for o, r, k, phase, side in st['bubbles']:
        u = (t * k + phase) % 1.0
        o.location = _path(u, side)
        # Blown up out of the suds, then gone at the top in a few frames.
        s = r * C.smoothstep(0.0, 0.1, u) * (1 - C.smoothstep(0.95, 1.0, u))
        s = max(s, 1e-4)
        o.scale = (s, s, s * 0.97)


# ---------------------------------------------------------------- the live jar (pieces/live.py)

# A bubble blows up and pops in a tenth of its climb: a key a frame (the
# render's 144). The step's top shows: a full share of the atlas.
LIVE = {'clip_frames': 144, 'model_uv_scale': {'red_oxide': 1.0}}
IN_KIT = ('kps-big-21', 'i-steel-set', 'coco-gold', 'burma-fan-broom', 'white-phenyl')
AT_WORK = ('handle-scrubber', 'nar-mat-24x16')


def _span(names):
    from pieces.live import box
    boxes = [box(n) for n in names if bpy.data.objects.get(n) is not None and bpy.data.objects[n].type == 'MESH']
    lo = Vector((min(b[0].x for b in boxes), min(b[0].y for b in boxes), min(b[0].z for b in boxes)))
    hi = Vector((max(b[1].x for b in boxes), max(b[1].y for b in boxes), max(b[1].z for b in boxes)))
    return lo, hi, (lo + hi) / 2


def spots(st):
    """The live jar's numbered dots: the kit (on the crate's rim), the
    cleaning (on the scrubber in its suds), the kolam (on the step) and the
    storefront (on the tag). Each names the parts a tap opens it from with
    the glass off."""
    from pieces.live import below, box
    bpy.context.view_layer.update()
    crate = below('crate')
    _, hi_c, c = _span(crate)
    work = [n for name in AT_WORK for n in below(name) + [name]]
    _, hi_w, w = _span(work)
    _, hi_k, k = box('kolam_line')
    _, top_e, eye = box('tag_eyelet')
    kit = crate + [n for name in IN_KIT for n in below(name) + [name]]
    names = [o.name for o in bpy.data.objects if o.type == 'MESH']
    clean = work + [n for n in names if n.startswith(('suds', 'bubble'))]
    kolam = [n for n in names if n.startswith('kolam')] + ['step']
    return [
        {'id': 'kit', 'at': (c.x, c.y, hi_c.z + 0.012), 'parts': kit},
        {'id': 'clean', 'at': (w.x, w.y, hi_w.z + 0.012), 'parts': clean},
        {'id': 'kolam', 'at': (k.x, k.y, hi_k.z + 0.008), 'parts': kolam},
        {'id': 'site', 'at': (eye.x, eye.y, top_e.z + 0.004), 'on': 'jar', 'parts': below('tag') + ['tag_string']},
    ]


# The bristled products are modelled to be looked at one at a time: in the
# jar a brush head is a few pixels across, and this share of its faces keeps
# its outline. (The renders keep them whole: the live jar's file has a budget.)
LIVE_THIN = {'burma-fan-broom': 0.25, 'i-steel-set': 0.25, 'coco-gold': 0.3}


def _thin(names, ratio):
    """Collapse each mesh to `ratio` of its faces."""
    for n in names:
        o = bpy.data.objects.get(n)
        if o is None or o.type != 'MESH' or len(o.data.polygons) < 200:
            continue
        if o.data.users > 1:
            o.data = o.data.copy()
        d = o.modifiers.new('live_thin', 'DECIMATE')
        d.ratio = ratio
        with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
            bpy.ops.object.modifier_apply(modifier=d.name)


def live(st):
    """The bristled products thinned (LIVE_THIN). A soap film is thin-film
    interference over a clear sphere, which the glTF cannot carry: it leaves
    as a faint, see-through stand-in with no refraction to pay for, and the
    page draws the film itself (src/three/pieces/kps-cleano.js), from what
    page() reads off the render's material."""
    from pieces.live import below
    for root, ratio in LIVE_THIN.items():
        _thin(below(root) + [root], ratio)
    m = bpy.data.materials.get('soap_film')
    if m is None:
        return
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    K.sock(b.inputs, 'Transmission Weight', 'Transmission').default_value = 0.0
    b.inputs['Base Color'].default_value = (1, 1, 1, 1)
    b.inputs['Roughness'].default_value = 0.04
    b.inputs['Alpha'].default_value = 0.16
    try:
        m.surface_render_method = 'BLENDED'
    except Exception:
        m.blend_method = 'BLEND'
    m['own'] = 1


def page(st):
    """What the page's soap film needs: the stand-in's material, and the
    film's thickness (nm) and index, read off the render's material
    (_bubble_material(); live() leaves those two inputs as they were)."""
    m = bpy.data.materials.get('soap_film')
    if m is None:
        return {}
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    get = lambda k, d: round(b.inputs[k].default_value, 4) if k in b.inputs else d
    return {'film': {'material': m.name, 'thickness': get('Thin Film Thickness', 480.0), 'ior': get('Thin Film IOR', 1.33)}}
