"""
People: "vinyl toy" figures, one rig, several bodies, shared animation clips.

Built the way a toy is: a Skin-modifier body grown over a skeleton graph, with
a big separate head (about a third of the height, like the figurine in the
hero), dot eyes, brows, ears and a hair shell, mitten hands and rounded shoes.
Belts, collars and cuffs are separate rings: they hide the seam between two
colour regions (per-vertex colour follows the mesh's diagonal edges and would
otherwise leave a jagged line) and they read as toy detail.

Rigged with our own armature and deterministic weights (the two nearest bones,
blended only near joints; rings, hands, feet and the head pinned to one bone),
because Blender's automatic bone-heat weighting can fail without warning and
would make builds unrepeatable.

Colour is not in the material. Every vertex carries a REGION code in its
colour attribute (eyes, skin, top, bottom, shoes, hair, accent), and each
figure gets a palette: a ColorRamp in Blender for stills, a small shader patch
on the page. So a figure is one mesh, one draw call, in any outfit.

The figure faces -Y in Blender, which is +Z in three.js.
"""

from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import common as C

# Region codes, stored in the red channel as (index + 0.5) / 16. Each figure's
# palette maps them to colours; unset ones fall back sensibly on the page
# (trim, badge and vest follow the top, strip follows the vest).
REGIONS = ('eyes', 'white', 'skin', 'top', 'bottom', 'shoes', 'sole', 'hair',
           'mouth', 'accent', 'trim', 'vest', 'strip', 'badge', 'lens', 'belt')


def region_value(name):
    return (REGIONS.index(name) + 0.5) / len(REGIONS)


# ---------------------------------------------------------------- skeleton

# Joint positions for the base body (Z up, metres, facing -Y). About 1.40 m:
# short chunky legs, a barrel torso and a big head, the proportions of a vinyl
# toy, not of an adult.
BASE = {
    'hips': (0, 0, 0.60), 'spine': (0, 0.004, 0.72), 'chest': (0, 0.008, 0.85), 'neck': (0, 0.012, 0.955),
    'sh.L': (0.162, 0.012, 0.9), 'el.L': (0.2, 0.02, 0.72), 'wr.L': (0.212, 0.0, 0.565),
    'sh.R': (-0.162, 0.012, 0.9), 'el.R': (-0.2, 0.02, 0.72), 'wr.R': (-0.212, 0.0, 0.565),
    'hp.L': (0.082, 0, 0.56), 'kn.L': (0.088, -0.01, 0.3), 'an.L': (0.09, 0.008, 0.075),
    'hp.R': (-0.082, 0, 0.56), 'kn.R': (-0.088, -0.01, 0.3), 'an.R': (-0.09, 0.008, 0.075),
}
# Skin radii (x, y): the torso is wider than it is deep.
RADII = {'hips': (.148, .12), 'spine': (.152, .118), 'chest': (.165, .125), 'neck': (.066, .062),
         'sh.L': (.074, .07), 'el.L': (.061, .058), 'wr.L': (.053, .05),
         'sh.R': (.074, .07), 'el.R': (.061, .058), 'wr.R': (.053, .05),
         'hp.L': (.088, .084), 'kn.L': (.071, .068), 'an.L': (.058, .055),
         'hp.R': (.088, .084), 'kn.R': (.071, .068), 'an.R': (.058, .055)}
EDGES = [('hips', 'spine'), ('spine', 'chest'), ('chest', 'neck'), ('chest', 'sh.L'), ('sh.L', 'el.L'), ('el.L', 'wr.L'),
         ('chest', 'sh.R'), ('sh.R', 'el.R'), ('el.R', 'wr.R'), ('hips', 'hp.L'), ('hp.L', 'kn.L'), ('kn.L', 'an.L'),
         ('hips', 'hp.R'), ('hp.R', 'kn.R'), ('kn.R', 'an.R')]
HEAD_C = (0, 0.0, 1.19)
HEAD_R = 0.19
BELT_Z = 0.585
COLLAR_Z = 0.952

# Body variants: (name, width scale, height scale, belly)
VARIANTS = (('a', 1.0, 1.0, 0.0), ('b', 1.12, 1.0, 0.028), ('c', 0.92, 1.0, -0.006))

BONES = [
    # name, head joint/point, tail, parent
    ('root', (0, 0, 0), (0, 0, 0.2), None),
    ('hips', 'hips', 'spine', 'root'),
    ('spine', 'spine', 'chest', 'hips'),
    ('chest', 'chest', 'neck', 'spine'),
    ('neck', 'neck', (0, 0.012, 1.02), 'chest'),
    ('head', (0, 0.012, 1.02), (0, 0.012, 1.42), 'neck'),
    ('upperarm.L', 'sh.L', 'el.L', 'chest'), ('forearm.L', 'el.L', 'wr.L', 'upperarm.L'), ('hand.L', 'wr.L', (0.216, -0.004, 0.47), 'forearm.L'),
    ('upperarm.R', 'sh.R', 'el.R', 'chest'), ('forearm.R', 'el.R', 'wr.R', 'upperarm.R'), ('hand.R', 'wr.R', (-0.216, -0.004, 0.47), 'forearm.R'),
    ('thigh.L', 'hp.L', 'kn.L', 'hips'), ('shin.L', 'kn.L', 'an.L', 'thigh.L'), ('foot.L', 'an.L', (0.09, -0.125, 0.025), 'shin.L'),
    ('thigh.R', 'hp.R', 'kn.R', 'hips'), ('shin.R', 'kn.R', 'an.R', 'thigh.R'), ('foot.R', 'an.R', (-0.09, -0.125, 0.025), 'shin.R'),
]


def _pt(v):
    return Vector(BASE[v]) if isinstance(v, str) else Vector(v)


def build_rig(col, name='rig'):
    ad = bpy.data.armatures.new(name)
    rig = C.link(bpy.data.objects.new(name, ad), col)
    C.select([rig])
    bpy.ops.object.mode_set(mode='EDIT')
    for n, h, t, p in BONES:
        eb = ad.edit_bones.new(n)
        eb.head = _pt(h)
        eb.tail = _pt(t)
        # Roll so a limb's local X lies along world X: rotating about local X
        # then swings it forward/back in the figure's sagittal plane.
        eb.align_roll(Vector((0, -1, 0)) if abs((eb.tail - eb.head).normalized().z) > 0.5 else Vector((0, 0, 1)))
        if p:
            eb.parent = ad.edit_bones[p]
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in rig.pose.bones:
        pb.rotation_mode = 'XYZ'
    return rig


# ---------------------------------------------------------------- bodies

def _region_attr(o, value_fn, face_fn=None):
    """The region code, per face corner: a colour boundary can then follow an
    edge loop exactly instead of smearing across a triangle. `face_fn(poly)`
    decides per face where given, else `value_fn(vertex)` per corner."""
    me = o.data
    old = me.color_attributes.get('region')
    if old is not None and old.domain != 'CORNER':
        me.color_attributes.remove(old)
    a = me.color_attributes.get('region') or me.color_attributes.new('region', 'BYTE_COLOR', 'CORNER')
    for p in me.polygons:
        fv = face_fn(p) if face_fn else None
        for li in p.loop_indices:
            val = fv if fv is not None else value_fn(me.vertices[me.loops[li].vertex_index])
            a.data[li].color = (val, 0, 0, 1)
    me.color_attributes.active_color = a
    return a


def _smooth_part(name, loc, r, scale=(1, 1, 1), seg=28):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=tuple(loc))
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    # Location too: callers edit vertices against world positions (the jaw
    # taper, the hairline), so local and world coordinates must agree.
    C.apply_transform(o, loc=True)
    bpy.ops.object.shade_smooth()
    return o


def _ring(name, center, major, minor, axis=(0, 0, 1), scale=(1, 1, 1)):
    """A torus around `axis` through `center`: belts, collars and cuffs."""
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=28, minor_segments=8,
                                     location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    C.apply_transform(o)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(Vector(axis).normalized())
    o.location = tuple(center)
    C.apply_transform(o, loc=True)
    bpy.ops.object.shade_smooth()
    return o


def _set_region(o, region):
    _region_attr(o, lambda v: region_value(region))
    return o


def _pin(o, bone):
    """Mark every vertex of this part to follow exactly one bone (see bind())."""
    g = o.vertex_groups.new(name=f'pin:{bone}')
    g.add([v.index for v in o.data.vertices], 1.0, 'REPLACE')
    return o


def _on_surface(target, x, z, lift=0.0):
    """Where a ray from the front (-Y) meets `target` at (x, z): the point and
    the outward normal, so a face feature sits on the curve of the head."""
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    tree = BVHTree.FromObject(target, bpy.context.evaluated_depsgraph_get())
    hit, n, _i, _d = tree.ray_cast(Vector((x, -1.0, z)), Vector((0, 1, 0)))
    if hit is None:
        return Vector((x, -HEAD_R, z)), Vector((0, -1, 0))
    return hit + n * lift, n


def _feature(name, loc, normal, r, scale, region, seg=16, twist=0.0):
    """A small ellipsoid turned so its flat side lies on the surface."""
    o = _smooth_part(name, (0, 0, 0), r, scale, seg=seg)
    q = Vector((0, -1, 0)).rotation_difference(normal)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = q
    if twist:
        o.rotation_mode = 'XYZ'
        o.rotation_euler.rotate_axis('Y', twist)
    o.location = loc
    C.apply_transform(o, loc=True)
    return _pin(_set_region(o, region), 'head')


def _arc(name, center, major, minor, a0, a1, normal, region, seg=12):
    """A thick arc (brows, the smile): a torus cut to [a0, a1] degrees in the
    XZ plane, turned to lie on the surface."""
    bm = bmesh.new()
    rings = []
    for i in range(seg + 1):
        t = math.radians(a0 + (a1 - a0) * i / seg)
        c = Vector((math.cos(t) * major, 0, math.sin(t) * major))
        tang = Vector((-math.sin(t), 0, math.cos(t)))
        side = Vector((0, 1, 0))
        up = tang.cross(side).normalized()
        # Taper the ends, like a sculpted brow or lip line.
        k = math.sin(math.pi * i / seg) ** 0.5
        ring = []
        for j in range(8):
            u = 2 * math.pi * j / 8
            off = (side * math.cos(u) * 0.6 + up * math.sin(u)) * minor * (0.35 + 0.65 * k)
            ring.append(bm.verts.new(c + off))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for j in range(8):
            bm.faces.new((r0[j], r0[(j + 1) % 8], r1[(j + 1) % 8], r1[j]))
    bmesh.ops.contextual_create(bm, geom=rings[0])
    bmesh.ops.contextual_create(bm, geom=rings[-1])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = C.link(bpy.data.objects.new(name, me))
    for p in o.data.polygons:
        p.use_smooth = True
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, -1, 0)).rotation_difference(normal)
    o.location = center
    C.apply_transform(o, loc=True)
    return _pin(_set_region(o, region), 'head')


def _wrap_to(o, target, offset):
    """Lay a thin feature onto a curved surface, keeping its own thickness."""
    sw = o.modifiers.new('wrap', 'SHRINKWRAP')
    sw.target = target
    sw.wrap_method = 'NEAREST_SURFACEPOINT'
    sw.wrap_mode = 'ABOVE_SURFACE'
    sw.offset = offset
    C.apply_modifiers(o)
    return o


def _face(head, head_c):
    """Eyes with whites, irises and a catchlight under a heavy upper lid, shaped
    brows, a nose and a small smile: the figurine in the hero, not a dot face."""
    parts = []
    for s_ in (1, -1):
        x = s_ * 0.07
        p, n = _on_surface(head, x, head_c.z + 0.02)
        white = _feature('eye_white', p - n * 0.012, n, 0.036, (1.0, 0.5, 1.22), 'white', seg=16)
        parts.append(white)
        ip, _ = _on_surface(white, x - s_ * 0.004, head_c.z + 0.016)
        iris = _feature('iris', ip - n * 0.004, n, 0.022, (1.0, 0.42, 1.14), 'eyes', seg=14)
        parts.append(iris)
        cp, _ = _on_surface(iris, x + s_ * 0.004, head_c.z + 0.026)
        parts.append(_feature('glint', cp, n, 0.0058, (1, 0.5, 1), 'white', seg=8))
        # The upper lid: a skin cap over the top of the eye, a little heavy.
        lp, _ = _on_surface(head, x, head_c.z + 0.052)
        parts.append(_feature('lid', lp - n * 0.006, n, 0.04, (1.02, 0.42, 0.5), 'skin', seg=14))
        bp, bn = _on_surface(head, x + s_ * 0.004, head_c.z + 0.084, lift=0.002)
        brow = _arc('brow', bp + Vector((0, 0, -0.03)), 0.034, 0.0085, 58 if s_ > 0 else 45, 135 if s_ > 0 else 122, bn, 'hair')
        parts.append(_wrap_to(brow, head, 0.005))
    np_, nn = _on_surface(head, 0, head_c.z - 0.03)
    parts.append(_feature('nose', np_ - nn * 0.012, nn, 0.027, (1.0, 0.85, 0.9), 'skin', seg=14))
    mp, mn = _on_surface(head, 0, head_c.z - 0.072, lift=0.001)
    smile = _arc('smile', mp + Vector((0, 0, 0.022)), 0.032, 0.0068, 212, 328, mn, 'mouth')
    parts.append(_wrap_to(smile, head, 0.0035))
    return parts


def _torso(ws, belly):
    """The torso alone (hips to neck), as a skin surface: what belts and vests
    wrap onto, without the arms hanging beside it getting in the way."""
    names = ['hips', 'spine', 'chest', 'neck']
    pts = []
    for n in names:
        x, y, z = BASE[n]
        pts.append((x * ws, y - (belly if n in ('spine', 'hips') else 0.0), z))
    me = bpy.data.meshes.new('torso')
    me.from_pydata(pts, [(0, 1), (1, 2), (2, 3)], [])
    o = C.link(bpy.data.objects.new('torso', me))
    sk = o.modifiers.new('skin', 'SKIN')
    sk.branch_smoothing = 0.75
    for i, n in enumerate(names):
        rx, ry = RADII[n]
        grow = ws if n != 'neck' else 1.0
        extra = max(0.0, belly) * 1.4 if n in ('spine', 'hips') else 0.0
        o.data.skin_vertices[0].data[i].radius = (rx * grow + extra, ry * grow + extra)
    o.data.skin_vertices[0].data[0].use_root = True
    sub = o.modifiers.new('sub', 'SUBSURF')
    sub.levels = 2
    C.apply_modifiers(o)
    return o


def _band(name, target, z0, z1, offset, thick, region, seg=40, rows=3, reach=0.19):
    """A band that hugs `target` between heights z0 and z1, `offset` off its
    outer surface and `thick` deep: belts, vests, reflective strips.

    Built from rays cast inward from outside, taking the first hit within
    `reach` of the body's axis. Not a shrinkwrap: the skin body has faces
    inside it where limbs join, which "nearest surface" snaps to, and rays
    from outside would otherwise stop on an arm hanging beside the torso."""
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    tree = BVHTree.FromObject(target, bpy.context.evaluated_depsgraph_get())
    ring_pts = []
    for r in range(rows):
        z = z0 + (z1 - z0) * r / (rows - 1)
        ring = []
        for k in range(seg):
            th = 2 * math.pi * k / seg
            d = Vector((math.cos(th), math.sin(th), 0))
            o = Vector((0, 0, z)) + d * 0.6
            pt, nrm = None, d
            for _ in range(6):
                hit, n, _i, dist = tree.ray_cast(o, -d, 1.2)
                if hit is None:
                    break
                if Vector((hit.x, hit.y, 0)).length <= reach:
                    pt, nrm = hit, n
                    break
                o = hit - d * 1e-4
            if pt is None:
                pt = Vector((0, 0, z)) + d * 0.12
            flat = Vector((nrm.x, nrm.y, 0))
            flat = flat.normalized() if flat.length > 1e-6 else d
            ring.append(pt + flat * offset)
        ring_pts.append(ring)
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in ring] for ring in ring_pts]
    for r0, r1 in zip(vs, vs[1:]):
        for k in range(seg):
            bm.faces.new((r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = C.link(bpy.data.objects.new(name, me))
    # Normals point out of the body: thickness grows outward, rims closed.
    sol = o.modifiers.new('solid', 'SOLIDIFY')
    sol.thickness = thick
    sol.offset = 1.0
    sol.use_rim = True
    C.apply_modifiers(o)
    for p in o.data.polygons:
        p.use_smooth = True
    return _set_region(o, region)


def _vest(body, belt_z):
    """A hi-vis vest: a shell wrapped 12 mm off the torso, from the belt to the
    armpits, and two reflective bands a little proud of it. Weighted like the
    torso it covers, so it bends with the spine."""
    shell = _band('vest', body, belt_z - 0.03, 0.845, 0.02, 0.008, 'vest')
    strips = [_band('strip', body, z - 0.014, z + 0.014, 0.03, 0.004, 'strip') for z in (belt_z + 0.07, belt_z + 0.19)]
    return C.join([shell] + strips, 'vest')


def build_vest(variant, col):
    """The hi-vis vest for a build, as its own mesh: bound to the same rig as
    the bodies, it rides on any figure of that build (one extra draw call)
    instead of doubling the body."""
    body = build_body(variant, col)
    v = _vest(body, BELT_Z)
    bpy.data.objects.remove(body, do_unlink=True)
    v.name = f'vest_{variant}'
    v.data.name = v.name
    C.move_to(v, col)
    v.data.color_attributes.active_color = v.data.color_attributes['region']
    return v


def build_body(variant, col, vest=False):
    """One body mesh (unrigged, bald: hair is an attachment), region-coded."""
    vname, ws, hs, belly = next(v for v in VARIANTS if v[0] == variant)

    def J(n):
        x, y, z = BASE[n]
        push = belly if n in ('spine', 'hips') else 0.0
        return Vector((x * ws, y - push, z * hs))

    names = list(BASE)
    me = bpy.data.meshes.new(f'body_{vname}')
    me.from_pydata([tuple(J(n)) for n in names], [(names.index(a), names.index(b)) for a, b in EDGES], [])
    body = C.link(bpy.data.objects.new(f'body_{vname}', me), col)
    sk = body.modifiers.new('skin', 'SKIN')
    sk.branch_smoothing = 0.75
    sk.use_smooth_shade = True
    for i, n in enumerate(names):
        rx, ry = RADII[n]
        grow = ws if n != 'neck' else 1.0
        extra = max(0.0, belly) * 1.4 if n in ('spine', 'hips') else 0.0
        body.data.skin_vertices[0].data[i].radius = (rx * grow + extra, ry * grow + extra)
    body.data.skin_vertices[0].data[names.index('hips')].use_root = True
    sub = body.modifiers.new('sub', 'SUBSURF')
    sub.levels = 2
    C.apply_modifiers(body)
    # Far more triangles than a figure a few hundred pixels tall can show:
    # halve them, keeping the silhouette (the rings hide the colour seams).
    dec = body.modifiers.new('dec', 'DECIMATE')
    dec.ratio = 0.3
    C.apply_modifiers(body)
    C.select([body])
    bpy.ops.object.shade_smooth()

    belt_z, collar_z = BELT_Z * hs, COLLAR_Z * hs
    # Exact edge loops where the colours change, so each boundary is a clean
    # line (under the belt, under the collar), not a sawtooth of triangles.
    bm = bmesh.new()
    bm.from_mesh(body.data)
    for z in (belt_z, collar_z):
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, z), plane_no=(0, 0, 1))
    bm.to_mesh(body.data)
    bm.free()

    def face_region(p):
        z = p.center.z
        return region_value('skin') if z > collar_z else region_value('top') if z > belt_z else region_value('bottom')
    _region_attr(body, None, face_region)

    parts = [body]
    # Wrapped from inside the torso, the nearest surface is always the torso's,
    # never an arm hanging beside it: the body itself is the target.
    if vest:
        parts.append(_vest(body, belt_z))  # weighted like the torso it covers
    # Belt and turtleneck: fitted bands that also hide the colour seams.
    parts.append(_pin(_band('belt', body, belt_z - 0.028, belt_z + 0.028, 0.002, 0.014, 'belt'), 'hips'))
    parts.append(_pin(_ring_neck(J('neck').y, collar_z), 'chest'))
    # A staff badge on the left chest: invisible (top-coloured) unless a palette sets it.
    chest = [v.co for v in body.data.vertices if abs(v.co.z - 0.84 * hs) < 0.02 and 0.05 < v.co.x < 0.11]
    front = min(p.y for p in chest) if chest else -0.13
    badge = geo_box('badge', (0.05, 0.008, 0.032), (0.08 * ws, front - 0.001, 0.84 * hs - 0.016))
    parts.append(_pin(_set_region(badge, 'badge'), 'chest'))
    for s_ in ('L', 'R'):
        el, wr = J(f'el.{s_}'), J(f'wr.{s_}')
        d = (wr - el).normalized()
        parts.append(_pin(_set_region(_ring(f'cuff{s_}', wr + d * 0.004, 0.052 * ws, 0.016, axis=d), 'trim'), f'forearm.{s_}'))
        parts.append(_pin(_set_region(_smooth_part(f'hand{s_}', wr + d * 0.052, 0.05, (0.86, 0.74, 1.12), seg=18), 'skin'), f'hand.{s_}'))
        an = J(f'an.{s_}')
        shoe = _smooth_part(f'foot{s_}', (an.x, an.y - 0.04, 0.05), 0.066, (0.98, 1.72, 0.7), seg=20)
        # A sole: the bottom of the shoe in its own colour, flattened to the floor.
        for v in shoe.data.vertices:
            v.co.z = max(v.co.z, 0.004)
        _region_attr(shoe, lambda v: region_value('sole') if v.co.z < 0.024 else region_value('shoes'))
        parts.append(_pin(shoe, f'foot.{s_}'))

    head_c = Vector((HEAD_C[0], HEAD_C[1], HEAD_C[2] * hs))
    head = _smooth_part('head', head_c, HEAD_R, (1.0, 0.93, 1.06), seg=32)
    for v in head.data.vertices:
        t = max(0.0, (head_c.z - v.co.z) / HEAD_R)
        v.co.x = head_c.x + (v.co.x - head_c.x) * (1.0 - 0.13 * t)
        v.co.y = head_c.y + (v.co.y - head_c.y) * (1.0 - 0.06 * t)
    _set_region(head, 'skin')
    parts += _face(head, head_c)
    parts.append(_pin(head, 'head'))
    for s_ in (1, -1):
        parts.append(_pin(_set_region(_smooth_part('ear', (s_ * HEAD_R * 0.97, head_c.y + 0.01, head_c.z - 0.01), 0.042,
                                                   (0.45, 0.72, 1.0), seg=16), 'skin'), 'head'))

    o = C.join(parts, f'body_{vname}' + ('_vest' if vest else ''))
    o.data.color_attributes.active_color = o.data.color_attributes['region']
    return o


def _ring_neck(y, collar_z):
    """A rolled turtleneck: a fat ring that sinks into the shoulders."""
    return _set_region(_ring('collar', (0, y, collar_z - 0.01), 0.074, 0.024, scale=(1.0, 0.92, 0.9)), 'trim')


def geo_box(name, size, base):
    """A small bevelled box on `base` (centre of its bottom face)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(base[0], base[1], base[2] + size[2] / 2))
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    C.apply_transform(o)
    m = o.modifiers.new('bev', 'BEVEL')
    m.width = min(size) * 0.3
    m.segments = 2
    C.apply_modifiers(o)
    return o


# ---------------------------------------------------------------- hair

HAIR_STYLES = ('short', 'quiff', 'crop', 'bun', 'ponytail', 'long', 'curly', 'bob')


def build_hair(style, col, head_c=None):
    """Sculpted toy hair: volumes around the head fused by a voxel remesh into
    one smooth piece, grooved, trimmed back from the face along a hairline, and
    given thickness. A rigid attachment on the head bone."""
    hc = Vector(head_c or HEAD_C)
    R = HEAD_R
    blobs = []

    def blob(loc, r, scale=(1, 1, 1)):
        blobs.append(_smooth_part('hb', hc + Vector(loc), r, scale, seg=24))

    tight = {'crop': 1.045, 'curly': 1.07}.get(style, 1.075)
    blob((0, 0.006, 0.012), R * tight, (1.02, 0.97, 1.05))
    if style == 'quiff':
        blob((0.01, -0.09, 0.17), 0.105, (1.3, 0.95, 0.75))
        blob((0.06, -0.03, 0.17), 0.1, (1, 1.1, 0.75))
        blob((-0.07, -0.02, 0.14), 0.09, (1, 1.1, 0.8))
        blob((0.0, 0.07, 0.12), 0.12, (1.2, 1, 0.8))
    elif style == 'short':
        blob((0, -0.03, 0.13), 0.1, (1.3, 1.1, 0.6))
    elif style == 'bun':
        blob((0, 0.13, 0.12), 0.08)
    elif style == 'ponytail':
        blob((0, 0.17, 0.02), 0.06, (1, 1, 1))
        blob((0, 0.2, -0.12), 0.055, (0.9, 0.9, 2.2))
    elif style == 'long':
        blob((0, 0.07, -0.12), 0.17, (1.15, 0.8, 1.5))
        for s in (1, -1):
            blob((s * 0.13, 0.02, -0.1), 0.08, (0.8, 1.0, 1.9))
    elif style == 'bob':
        for s in (1, -1):
            blob((s * 0.13, 0.0, -0.05), 0.09, (0.8, 1.1, 1.3))
        blob((0, 0.08, -0.06), 0.15, (1.1, 0.8, 1.1))
    elif style == 'curly':
        import random
        rnd = random.Random(3)
        for _ in range(46):
            th = rnd.uniform(0, 2 * math.pi)
            ph = rnd.uniform(-0.2, 1.35)
            d = Vector((math.cos(th) * math.cos(ph), math.sin(th) * math.cos(ph), math.sin(ph)))
            if d.y < -0.35 and d.z < 0.55:
                continue  # keep the face clear
            blob(tuple(d * R * 1.05), rnd.uniform(0.035, 0.05))
    o = C.join(blobs, f'hair_{style}')
    rm = o.modifiers.new('remesh', 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = 0.009
    rm.adaptivity = 0.0
    C.apply_modifiers(o)
    sm = o.modifiers.new('smooth', 'CORRECTIVE_SMOOTH')
    sm.iterations = 6
    sm.use_only_smooth = True
    C.apply_modifiers(o)
    # Sculpted grooves: a band texture pushed along the normals.
    if style not in ('curly',):
        tex = bpy.data.textures.get('hair_bands') or bpy.data.textures.new('hair_bands', 'WOOD')
        tex.wood_type = 'BANDNOISE'
        tex.noise_scale = 0.35
        tex.turbulence = 4.0
        disp = o.modifiers.new('grooves', 'DISPLACE')
        disp.texture = tex
        disp.texture_coords = 'OBJECT'
        disp.strength = 0.006
        disp.mid_level = 0.5
        C.apply_modifiers(o)
    # The hairline: smooth cutters (the face, the ears, the nape), so the edge
    # is a clean sculpted line rather than the voxel staircase.
    cutters = []

    def cutter(loc, r, scale=(1, 1, 1)):
        c = _smooth_part('cut', hc + Vector(loc), r, scale, seg=48)
        cutters.append(c)

    fringe = {'quiff': 0.16, 'short': 0.13, 'crop': 0.12, 'curly': 0.13, 'bun': 0.11, 'ponytail': 0.11, 'long': 0.11, 'bob': 0.1}[style]
    # The face: a big ellipsoid in front whose top edge is the hairline.
    cutter((0, -0.2, fringe - 0.29), 0.29, (1.02, 1.0, 1.0))
    if style in ('short', 'quiff', 'crop', 'curly', 'bun', 'ponytail'):
        for s_ in (1, -1):
            cutter((s_ * 0.2, 0.0, -0.1), 0.085, (0.7, 1.2, 1.4))  # clear the ears
        if style != 'ponytail':
            cutter((0, 0.12, -0.26), 0.2, (1.3, 1.0, 0.9))  # the nape
    elif style == 'bob':
        cutter((0, 0.0, -0.36), 0.2, (1.6, 1.6, 1.0))  # an even hem at the jaw
    else:
        cutter((0, 0.0, -0.5), 0.2, (1.6, 1.6, 1.0))
    # One cutter at a time: overlapping cutters joined into one mesh are not a
    # valid solid, and the boolean would take everything.
    for c in cutters:
        bo = o.modifiers.new('hairline', 'BOOLEAN')
        bo.operation = 'DIFFERENCE'
        bo.object = c
        bo.solver = 'EXACT'
        C.apply_modifiers(o)
        bpy.data.objects.remove(c, do_unlink=True)
    dec = o.modifiers.new('dec', 'DECIMATE')
    dec.ratio = 0.1
    C.apply_modifiers(o)
    C.select([o])
    bpy.ops.object.shade_smooth()
    _set_region(o, 'hair')
    C.move_to(o, col)
    o['attach'] = 'head'
    return o


# ---------------------------------------------------------------- things people carry and wear

def _rigid(name, parts, region_of, bone, col):
    o = C.join(parts, name) if len(parts) > 1 else parts[0]
    o.name = name
    o.data.name = name
    _region_attr(o, region_of)
    for p in o.data.polygons:
        p.use_smooth = True
    C.move_to(o, col)
    o['attach'] = bone
    return o


def _hand_c(side='R'):
    wr = Vector(BASE[f'wr.{side}'])
    el = Vector(BASE[f'el.{side}'])
    return wr + (wr - el).normalized() * 0.052


def build_attachments(col):
    """Rigid pieces the page parents to a bone: hats, glasses and what people
    hold. Modelled in the rest pose, where they belong on the body."""
    out = []
    # Hard hat (region accent: yellow, white, red by palette).
    shell = geo_lathe([(0.0, 0.18), (0.07, 0.176), (0.12, 0.155), (0.16, 0.11), (0.185, 0.055), (0.19, 0.02), (0.19, 0.0), (0.0, 0.0)])
    brim = geo_lathe([(0.185, 0.012), (0.228, 0.006), (0.228, -0.002), (0.185, 0.0)])
    brim.scale = (1, 1.12, 1)
    C.apply_transform(brim)
    ridge = geo_box('ridge', (0.03, 0.34, 0.03), (0, 0, 0.165))
    hat = _rigid('hat', [shell, brim, ridge], lambda v: region_value('accent'), 'head', col)
    hat.location = (HEAD_C[0], HEAD_C[1] + 0.01, HEAD_C[2] + 0.07)
    C.apply_transform(hat, loc=True)
    hat['attach'] = 'head'
    out.append(hat)
    # Cap: a crown and a peak.
    crown = geo_lathe([(0.0, 0.15), (0.1, 0.14), (0.17, 0.09), (0.2, 0.02), (0.2, 0.0), (0.0, 0.0)])
    peak = geo_box('peak', (0.24, 0.14, 0.012), (0, -0.2, 0.0))
    cap = _rigid('cap', [crown, peak], lambda v: region_value('accent'), 'head', col)
    cap.location = (HEAD_C[0], HEAD_C[1], HEAD_C[2] + 0.1)
    C.apply_transform(cap, loc=True)
    out.append(cap)
    # Glasses: two lenses and a bridge, just in front of the eyes.
    lenses = []
    for s_ in (1, -1):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.034, minor_radius=0.006, major_segments=24, minor_segments=6,
                                         location=(s_ * 0.07, -0.19, HEAD_C[2] + 0.02), rotation=(math.pi / 2, 0, 0))
        lenses.append(bpy.context.active_object)
    lenses.append(geo_box('bridge', (0.04, 0.008, 0.008), (0, -0.19, HEAD_C[2] + 0.024)))
    out.append(_rigid('glasses', lenses, lambda v: region_value('lens'), 'head', col))
    h = _hand_c('R')
    # A shopping bag hanging from the right hand.
    body = geo_box('bag', (0.07, 0.2, 0.22), (h.x - 0.02, h.y, h.z - 0.3))
    bpy.ops.mesh.primitive_torus_add(major_radius=0.045, minor_radius=0.006, major_segments=20, minor_segments=6,
                                     location=(h.x - 0.02, h.y, h.z - 0.07), rotation=(0, math.pi / 2, 0))
    handle = bpy.context.active_object
    out.append(_rigid('bag', [body, handle], lambda v: region_value('accent'), 'hand.R', col))
    # A phone and a card, held along the hand.
    out.append(_rigid('phone', [geo_box('phone', (0.012, 0.05, 0.1), (h.x, h.y - 0.02, h.z - 0.08))],
                      lambda v: region_value('lens'), 'hand.R', col))
    out.append(_rigid('card', [geo_box('card', (0.004, 0.06, 0.04), (h.x, h.y - 0.03, h.z - 0.06))],
                      lambda v: region_value('accent'), 'hand.R', col))
    # A carton carried against the chest.
    out.append(_rigid('box', [geo_box('carton', (0.3, 0.22, 0.2), (0, -0.28, 0.66))],
                      lambda v: region_value('accent'), 'chest', col))
    # A clipboard in the left hand.
    hl = _hand_c('L')
    out.append(_rigid('clipboard', [geo_box('board', (0.01, 0.16, 0.22), (hl.x, hl.y - 0.04, hl.z - 0.18))],
                      lambda v: region_value('accent'), 'hand.L', col))
    # Hammer: handle along the hand, head across it.
    hh = geo_box('handle', (0.018, 0.018, 0.26), (h.x, h.y, h.z - 0.2))
    hd = geo_box('head', (0.02, 0.1, 0.03), (h.x, h.y, h.z - 0.22))
    out.append(_rigid('hammer', [hh, hd], lambda v: region_value('lens') if v.co.z < h.z - 0.19 else region_value('accent'), 'hand.R', col))
    # A broom: pole and a head on the floor side.
    pole = geo_box('pole', (0.016, 0.016, 1.0), (h.x, h.y, h.z - 0.5))
    bristles = geo_box('bristles', (0.05, 0.28, 0.06), (h.x, h.y, h.z - 0.55))
    out.append(_rigid('broom', [pole, bristles], lambda v: region_value('accent'), 'hand.R', col))
    # A welding torch.
    out.append(_rigid('torch', [geo_box('torch', (0.02, 0.02, 0.16), (h.x, h.y - 0.02, h.z - 0.12))],
                      lambda v: region_value('lens'), 'hand.R', col))
    return out


def geo_lathe(profile, segments=32):
    verts, faces, rings = [], [], []
    for r, z in profile:
        if r <= 1e-6:
            rings.append([len(verts)])
            verts.append((0, 0, z))
            continue
        ring = []
        for s in range(segments):
            th = 2 * math.pi * s / segments
            ring.append(len(verts))
            verts.append((r * math.cos(th), r * math.sin(th), z))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) > 1:
            faces += [(a[0], b[s], b[(s + 1) % segments]) for s in range(segments)]
        elif len(b) == 1 and len(a) > 1:
            faces += [(a[s], b[0], a[(s + 1) % segments]) for s in range(segments)]
        elif len(a) > 1 and len(b) > 1:
            faces += [(a[s], a[(s + 1) % segments], b[(s + 1) % segments], b[s]) for s in range(segments)]
    me = bpy.data.meshes.new('lathe')
    me.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return C.link(bpy.data.objects.new('lathe', me))


# ---------------------------------------------------------------- weights

def _seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (a + ab * t - p).length


def bind(body, rig):
    """Deterministic skin weights, and the armature modifier. The mesh stays a
    root node (a skinned mesh under the rig trips a glTF validator warning)."""
    rig_bones = [(b.name, rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local)
                 for b in rig.data.bones if b.name != 'root']
    groups = {n: body.vertex_groups.new(name=n) for n, _, _ in rig_bones}
    pins = {g.index: g.name.split(':', 1)[1] for g in body.vertex_groups if g.name.startswith('pin:')}
    limbs = [(n, a, b) for n, a, b in rig_bones if n not in ('head', 'hand.L', 'hand.R', 'foot.L', 'foot.R')]
    for v in body.data.vertices:
        pinned = next((pins[g.group] for g in v.groups if g.group in pins and g.weight > 0.5), None)
        if pinned:
            groups[pinned].add([v.index], 1.0, 'REPLACE')
            continue
        p = body.matrix_world @ v.co
        d = sorted((_seg_dist(p, a, b), n) for n, a, b in limbs)
        (d0, n0), (d1, n1) = d[0], d[1]
        w1 = max(0.0, 1 - (d1 - d0) / 0.055) * 0.5
        groups[n0].add([v.index], 1 - w1, 'REPLACE')
        if w1 > 0.001:
            groups[n1].add([v.index], w1, 'REPLACE')
    for g in [g for g in body.vertex_groups if g.name.startswith('pin:')]:
        body.vertex_groups.remove(g)
    m = body.modifiers.new('rig', 'ARMATURE')
    m.object = rig
    return body


# ---------------------------------------------------------------- clips

CLIPS: dict = {}


def clip(name, frames, loop=True):
    def deco(fn):
        CLIPS[name] = (frames, loop, fn)
        return fn
    return deco


def _s(ph):
    return math.sin(2 * math.pi * ph)


def _c(ph):
    return math.cos(2 * math.pi * ph)


# Every pose function gets (P, ph), ph in [0, 1) across the clip, and sets
# bone-local rotations (radians) and hip offsets (metres) from rest.
# Axes (see build_rig): limbs +X swings forward; arms +Z (left) / -Z (right)
# raises them sideways; the spine's +X leans forward, +Y twists, +Z tilts.


@clip('walk', 32)
def _walk(P, ph):
    s, c = _s(ph), _c(ph)
    P['thigh.L'].rotation_euler.x = 0.42 * s
    P['thigh.R'].rotation_euler.x = -0.42 * s
    P['shin.L'].rotation_euler.x = -0.62 * max(0.0, -_c(ph - 0.08))
    P['shin.R'].rotation_euler.x = -0.62 * max(0.0, _c(ph - 0.08))
    P['foot.L'].rotation_euler.x = 0.18 * s
    P['foot.R'].rotation_euler.x = -0.18 * s
    P['upperarm.L'].rotation_euler.x = -0.34 * s
    P['upperarm.R'].rotation_euler.x = 0.34 * s
    P['forearm.L'].rotation_euler.x = 0.22 + 0.14 * max(0.0, -s)
    P['forearm.R'].rotation_euler.x = 0.22 + 0.14 * max(0.0, s)
    P['upperarm.L'].rotation_euler.z = 0.1
    P['upperarm.R'].rotation_euler.z = -0.1
    P['hips'].location.y = 0.02 * abs(c) - 0.01        # bob (bone-local Y is up the spine)
    P['hips'].rotation_euler.y = 0.06 * s              # twist
    P['chest'].rotation_euler.y = -0.09 * s            # counter-twist
    P['head'].rotation_euler.y = 0.04 * s


@clip('idle', 120)
def _idle(P, ph):
    s = _s(ph)
    P['chest'].rotation_euler.x = 0.025 * s
    P['spine'].rotation_euler.z = 0.015 * _s(ph * 0.5)
    P['head'].rotation_euler.y = 0.22 * _s(ph * 0.5 + 0.1)
    P['head'].rotation_euler.x = -0.03 * _c(ph)
    P['upperarm.L'].rotation_euler.z = 0.1 + 0.03 * s
    P['upperarm.R'].rotation_euler.z = -0.1 - 0.03 * s
    P['forearm.L'].rotation_euler.x = 0.14
    P['forearm.R'].rotation_euler.x = 0.14
    P['hips'].location.x = 0.012 * _s(ph * 0.5)


@clip('browse', 96)
def _browse(P, ph):
    # Weight on one leg, head tilted to a rail, one arm reaching and turning a hanger.
    reach = 0.5 + 0.5 * _s(ph)
    P['hips'].location.x = 0.03
    P['thigh.R'].rotation_euler.x = 0.08
    P['shin.R'].rotation_euler.x = -0.12
    P['head'].rotation_euler.x = 0.18
    P['head'].rotation_euler.y = -0.25 + 0.2 * _s(ph * 0.5)
    P['upperarm.R'].rotation_euler.x = 0.95 + 0.25 * reach
    P['upperarm.R'].rotation_euler.z = -0.12
    P['forearm.R'].rotation_euler.x = 0.55 - 0.3 * reach
    P['hand.R'].rotation_euler.y = 0.6 * _s(ph * 2)
    P['upperarm.L'].rotation_euler.z = 0.12
    P['forearm.L'].rotation_euler.x = 0.2
    P['chest'].rotation_euler.y = -0.1


# ---------------------------------------------------------------- more clips
# The work the scenes show. Same axes as above: limbs +X swing forward,
# forearm +X bends the elbow, arms +Z (left) / -Z (right) lift sideways,
# spine +X leans forward, +Y twists, +Z tilts; the root's location Y is up.


def _rest_arms(P, s=0.0):
    P['upperarm.L'].rotation_euler.z = 0.1 + 0.02 * s
    P['upperarm.R'].rotation_euler.z = -0.1 - 0.02 * s
    P['forearm.L'].rotation_euler.x = 0.14
    P['forearm.R'].rotation_euler.x = 0.14


def _breathe(P, ph, k=1.0):
    P['chest'].rotation_euler.x = 0.02 * k * _s(ph)


@clip('queue', 150)
def _queue(P, ph):
    # Waiting: weight shifts, hands clasped in front, a glance around.
    _breathe(P, ph * 2)
    P['hips'].location.x = 0.018 * _s(ph)
    P['spine'].rotation_euler.z = -0.02 * _s(ph)
    P['head'].rotation_euler.y = 0.35 * _s(ph * 1.0 + 0.15) * max(0.0, _s(ph * 2))
    for s_, sgn in (('L', 1), ('R', -1)):
        P[f'upperarm.{s_}'].rotation_euler.x = 0.28
        P[f'upperarm.{s_}'].rotation_euler.z = sgn * -0.08
        P[f'forearm.{s_}'].rotation_euler.x = 1.05
        P[f'forearm.{s_}'].rotation_euler.z = sgn * -0.35


@clip('pay', 60)
def _pay(P, ph):
    # Card held out to the terminal, a small tap.
    _breathe(P, ph)
    P['spine'].rotation_euler.x = 0.06
    P['upperarm.R'].rotation_euler.x = 1.15
    P['upperarm.R'].rotation_euler.z = 0.1
    P['forearm.R'].rotation_euler.x = 0.45 + 0.08 * max(0.0, _s(ph * 2))
    P['hand.R'].rotation_euler.x = -0.3
    P['head'].rotation_euler.x = 0.22
    P['upperarm.L'].rotation_euler.z = 0.1
    P['forearm.L'].rotation_euler.x = 0.2


@clip('tryon', 96)
def _tryon(P, ph):
    # A garment held up against the body, turning a little to see it.
    P['spine'].rotation_euler.y = 0.16 * _s(ph)
    P['head'].rotation_euler.x = 0.25
    P['head'].rotation_euler.y = -0.1 * _s(ph)
    for s_, sgn in (('L', 1), ('R', -1)):
        P[f'upperarm.{s_}'].rotation_euler.x = 0.95
        P[f'upperarm.{s_}'].rotation_euler.z = sgn * 0.18
        P[f'forearm.{s_}'].rotation_euler.x = 0.9


@clip('carry', 32)
def _carry(P, ph):
    # Walking with a carton held against the chest: the walk's legs, fixed arms.
    _walk(P, ph)
    for s_, sgn in (('L', 1), ('R', -1)):
        P[f'upperarm.{s_}'].rotation_euler.x = 0.55
        P[f'upperarm.{s_}'].rotation_euler.z = sgn * 0.2
        P[f'forearm.{s_}'].rotation_euler.x = 1.25
        P[f'forearm.{s_}'].rotation_euler.z = sgn * -0.25
    P['chest'].rotation_euler.y = 0.0


@clip('point', 60)
def _point(P, ph):
    # Showing someone the way: the arm out, the head following it.
    _breathe(P, ph)
    P['upperarm.R'].rotation_euler.x = 1.35
    P['upperarm.R'].rotation_euler.z = -0.45
    P['forearm.R'].rotation_euler.x = 0.08
    P['spine'].rotation_euler.y = -0.12
    P['head'].rotation_euler.y = -0.35
    P['upperarm.L'].rotation_euler.z = 0.12
    P['forearm.L'].rotation_euler.x = 0.2


@clip('phone', 120)
def _phone(P, ph):
    # Head down over a phone, thumb scrolling.
    _breathe(P, ph)
    P['head'].rotation_euler.x = 0.42
    P['neck'].rotation_euler.x = 0.12
    P['upperarm.R'].rotation_euler.x = 0.45
    P['upperarm.R'].rotation_euler.z = 0.12
    P['forearm.R'].rotation_euler.x = 1.55
    P['hand.R'].rotation_euler.x = 0.25 + 0.06 * _s(ph * 6)
    P['upperarm.L'].rotation_euler.z = 0.1
    P['forearm.L'].rotation_euler.x = 0.2


@clip('type', 48)
def _type(P, ph):
    # At a desk or till screen: both hands on keys, alternating.
    P['spine'].rotation_euler.x = 0.1
    P['head'].rotation_euler.x = 0.18
    for s_, sgn, off in (('L', 1, 0.0), ('R', -1, 0.5)):
        P[f'upperarm.{s_}'].rotation_euler.x = 0.5
        P[f'upperarm.{s_}'].rotation_euler.z = sgn * 0.14
        P[f'forearm.{s_}'].rotation_euler.x = 1.3
        P[f'hand.{s_}'].rotation_euler.x = 0.12 * max(0.0, _s(ph * 3 + off))


@clip('scan', 40)
def _scan(P, ph):
    # A cashier passing an item over the scanner, right to left.
    sweep = _s(ph)
    P['spine'].rotation_euler.x = 0.08
    P['spine'].rotation_euler.y = 0.1 * sweep
    P['head'].rotation_euler.x = 0.25
    P['upperarm.R'].rotation_euler.x = 0.8
    P['upperarm.R'].rotation_euler.z = -0.1 + 0.35 * sweep
    P['forearm.R'].rotation_euler.x = 1.0
    P['upperarm.L'].rotation_euler.x = 0.5
    P['forearm.L'].rotation_euler.x = 1.1


@clip('fold', 72)
def _fold(P, ph):
    # Folding stock on a table: hands meet, turn over, part.
    k = 0.5 + 0.5 * _s(ph)
    P['spine'].rotation_euler.x = 0.16
    P['head'].rotation_euler.x = 0.3
    for s_, sgn in (('L', 1), ('R', -1)):
        P[f'upperarm.{s_}'].rotation_euler.x = 0.55 + 0.25 * k
        P[f'upperarm.{s_}'].rotation_euler.z = sgn * (0.35 - 0.25 * k)
        P[f'forearm.{s_}'].rotation_euler.x = 0.9 + 0.3 * (1 - k)
        P[f'hand.{s_}'].rotation_euler.y = sgn * 0.6 * k


@clip('talk', 90)
def _talk(P, ph):
    # Talking to a shopper: hands open in turn, nods.
    _breathe(P, ph)
    P['head'].rotation_euler.x = 0.06 * _s(ph * 3)
    P['head'].rotation_euler.y = 0.08 * _s(ph)
    for s_, sgn, off in (('L', 1, 0.0), ('R', -1, 0.5)):
        up = max(0.0, _s(ph + off))
        P[f'upperarm.{s_}'].rotation_euler.x = 0.2 + 0.35 * up
        P[f'upperarm.{s_}'].rotation_euler.z = sgn * 0.12
        P[f'forearm.{s_}'].rotation_euler.x = 0.4 + 0.7 * up
        P[f'hand.{s_}'].rotation_euler.y = sgn * 0.4 * up


@clip('wave', 40)
def _wave(P, ph):
    _rest_arms(P)
    P['upperarm.R'].rotation_euler.x = 0.4
    P['upperarm.R'].rotation_euler.z = -1.6
    P['forearm.R'].rotation_euler.x = 0.3
    P['forearm.R'].rotation_euler.z = 0.45 * _s(ph * 2)
    P['head'].rotation_euler.z = 0.06


@clip('hammer', 36)
def _hammer(P, ph):
    # Raise, strike, recover: fast down, slow up.
    t = ph
    strike = C.smoothstep(0.55, 0.7, t) - C.smoothstep(0.75, 1.0, t)
    lift = C.smoothstep(0.0, 0.5, t) * (1 - strike)
    P['spine'].rotation_euler.x = 0.18 + 0.12 * strike
    P['head'].rotation_euler.x = 0.35
    P['thigh.L'].rotation_euler.x = 0.25
    P['shin.L'].rotation_euler.x = -0.35
    P['upperarm.R'].rotation_euler.x = 0.6 + 1.6 * lift - 0.4 * strike
    P['forearm.R'].rotation_euler.x = 0.4 + 1.0 * lift
    P['upperarm.L'].rotation_euler.x = 0.7
    P['forearm.L'].rotation_euler.x = 1.0


@clip('weld', 90)
def _weld(P, ph):
    # Crouched, torch in the right hand, a steady small circle.
    P['hips'].location.y = -0.2
    P['thigh.L'].rotation_euler.x = 1.25
    P['thigh.R'].rotation_euler.x = 0.9
    P['shin.L'].rotation_euler.x = -1.9
    P['shin.R'].rotation_euler.x = -1.5
    P['foot.L'].rotation_euler.x = 0.55
    P['foot.R'].rotation_euler.x = 0.5
    P['spine'].rotation_euler.x = 0.35
    P['head'].rotation_euler.x = 0.3
    P['upperarm.R'].rotation_euler.x = 0.9 + 0.05 * _s(ph * 2)
    P['upperarm.R'].rotation_euler.z = 0.05 * _c(ph * 2)
    P['forearm.R'].rotation_euler.x = 0.6
    P['upperarm.L'].rotation_euler.x = 0.7
    P['forearm.L'].rotation_euler.x = 1.0


def _lying(P, k):
    """k 0..1: from standing to lying on the back (a fall's end state)."""
    P['root'].rotation_euler.x = -1.48 * k
    P['root'].location.y = 0.13 * k
    P['root'].location.z = 0.45 * k  # feet slide forward, the back lands behind
    P['head'].rotation_euler.x = -0.25 * k


@clip('slip', 42, loop=False)
def _slip(P, ph):
    # Feet go forward, arms fly up, down onto the back.
    k = C.smoothstep(0.15, 0.85, ph)
    fly = C.smoothstep(0.0, 0.3, ph) * (1 - C.smoothstep(0.7, 1.0, ph))
    P['thigh.L'].rotation_euler.x = 0.7 * fly + 0.2 * k
    P['thigh.R'].rotation_euler.x = 0.5 * fly + 0.15 * k
    P['shin.L'].rotation_euler.x = -0.3 * fly
    P['upperarm.L'].rotation_euler.z = 0.1 + 1.3 * fly
    P['upperarm.R'].rotation_euler.z = -0.1 - 1.3 * fly
    P['forearm.L'].rotation_euler.x = 0.3
    P['forearm.R'].rotation_euler.x = 0.3
    _lying(P, k)


@clip('down', 60)
def _down(P, ph):
    # Still on the ground, stirring: what the fall score watches.
    _lying(P, 1.0)
    P['upperarm.L'].rotation_euler.z = 0.5 + 0.05 * _s(ph)
    P['upperarm.R'].rotation_euler.z = -0.4
    P['thigh.L'].rotation_euler.x = 0.2 + 0.1 * max(0.0, _s(ph))
    P['head'].rotation_euler.y = 0.2 * _s(ph * 0.5)


@clip('getup', 54, loop=False)
def _getup(P, ph):
    # Roll up to sitting, then onto the feet.
    k = 1 - C.smoothstep(0.0, 0.9, ph)
    P['spine'].rotation_euler.x = 0.5 * math.sin(math.pi * ph)
    P['thigh.L'].rotation_euler.x = 1.0 * math.sin(math.pi * ph)
    P['shin.L'].rotation_euler.x = -1.2 * math.sin(math.pi * ph)
    P['upperarm.R'].rotation_euler.x = 0.6 * math.sin(math.pi * ph)
    _lying(P, k)


@clip('sweep', 48)
def _sweep(P, ph):
    # A broom pushed side to side, the body turning with it.
    sw = _s(ph)
    P['spine'].rotation_euler.x = 0.2
    P['spine'].rotation_euler.y = 0.18 * sw
    P['head'].rotation_euler.x = 0.3
    P['upperarm.R'].rotation_euler.x = 0.55
    P['upperarm.R'].rotation_euler.z = -0.05 + 0.2 * sw
    P['forearm.R'].rotation_euler.x = 0.7
    P['upperarm.L'].rotation_euler.x = 0.7
    P['upperarm.L'].rotation_euler.z = 0.1 + 0.2 * sw
    P['forearm.L'].rotation_euler.x = 0.9


@clip('thumbs', 45)
def _thumbs(P, ph):
    _rest_arms(P)
    P['upperarm.R'].rotation_euler.x = 0.7
    P['forearm.R'].rotation_euler.x = 1.2
    P['hand.R'].rotation_euler.y = 0.4
    P['head'].rotation_euler.x = -0.08 + 0.05 * _s(ph)


def _key_all(rig, frames_list, fn):
    sc = bpy.context.scene
    P = rig.pose.bones
    for f, ph in frames_list:
        sc.frame_set(f)
        for pb in P:
            pb.rotation_euler = (0, 0, 0)
            pb.location = (0, 0, 0)
        fn(P, ph)
        for pb in P:
            pb.keyframe_insert('rotation_euler', frame=f)
            if pb.name in ('hips', 'root'):
                pb.keyframe_insert('location', frame=f)


def key_clips(rig, names=None, step=2):
    """Key every clip as its own action on its own NLA track. The glTF
    exporter's ACTIONS mode writes each as a separate animation."""
    rig.animation_data_create()
    out = {}
    for name in names or list(CLIPS):
        frames, loop, fn = CLIPS[name]
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        fl = [(1 + i, i / frames) for i in range(0, frames + 1, step)]
        if fl[-1][0] != frames + 1:
            fl.append((frames + 1, 1.0))
        _key_all(rig, fl, fn)
        tr = rig.animation_data.nla_tracks.new()
        tr.name = name
        st = tr.strips.new(name, 1, act)
        st.name = name
        rig.animation_data.action = None
        out[name] = {'frames': frames, 'seconds': round(frames / C.FPS, 4), 'loop': loop}
    return out


def pose(rig, name, phase):
    """Hold a figure in a clip at phase 0..1 (for stills and bakes)."""
    frames, loop, fn = CLIPS[name]
    P = rig.pose.bones
    for pb in P:
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
    fn(P, phase % 1.0)
    bpy.context.view_layer.update()


def measure_stride():
    """How far the walk carries a figure per cycle (two steps). The page sets
    walking speed from this so feet don't slide."""
    leg = BASE['hp.L'][2] - BASE['an.L'][2]
    return round(2 * 2 * leg * math.sin(0.42) * 0.9, 3)


# ---------------------------------------------------------------- palette material (Blender side)

def resolve_outfit(outfit):
    """Every region's colour: the defaults, the outfit, and the page's fallbacks
    (trim, badge and vest follow the top, strip follows the vest). The page
    applies the same rules (src/three/people.js), so stills and live agree."""
    o = {**DEFAULT_OUTFIT, **(outfit or {})}
    for k, src in (('trim', 'top'), ('badge', 'top'), ('vest', 'top')):
        o.setdefault(k, o[src])
    o.setdefault('strip', o['vest'])
    return o


def palette_material(name, colors: dict):
    """A per-figure material: region code -> colour via a constant ColorRamp."""
    colors = resolve_outfit(colors)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.46
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = 'region'
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'CONSTANT'
    els = ramp.color_ramp.elements
    n = len(REGIONS)
    while len(els) < n:
        els.new(0.5)
    for i, reg in enumerate(REGIONS):
        els[i].position = i / n
        els[i].color = C.lin(colors.get(reg, '#888888'))
    nt.links.new(attr.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Red'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    return m


DEFAULT_OUTFIT = {'eyes': '#2a1c14', 'white': '#f3efe8', 'skin': C.MAT['skin_a'], 'top': C.MAT['fabric_b'],
                  'bottom': '#2d3340', 'shoes': '#1b1b1e', 'sole': '#d9d4cb', 'hair': C.MAT['hair'],
                  'mouth': '#7a3b36', 'accent': C.AMBER, 'lens': '#15171b', 'belt': '#2e2622'}


# ---------------------------------------------------------------- figures in a scene (stills only)

_CACHE: dict = {}


def _cached(key, make):
    if key not in _CACHE:
        o = make()
        o.hide_render = o.hide_viewport = True
        _CACHE[key] = o
    return _CACHE[key]


def spawn(col, body, outfit, loc, face_deg, clip_name, phase, name, hair='short', attach=()):
    """A posed copy of a body (with its hair and anything it carries) for a
    scene's Cycles still. Never exported with a scene: on the page the same
    figure comes from people.glb, driven by the cast entry in scene.json,
    starting from exactly this pose."""
    src_rig = _cached('rig', lambda: build_rig(col, 'rig_src'))
    body, _, extra = body.partition('+')
    variant = body.split('_')[1]
    vest = extra == 'vest'

    def make_body():
        b = build_body(variant, col, vest=vest)
        bind(b, src_rig)
        return b

    src_body = _cached(body + ('+vest' if vest else ''), make_body)
    rig = src_rig.copy()
    rig.data = src_rig.data.copy()
    rig.animation_data_clear()
    C.link(rig, col)
    b = src_body.copy()
    b.data = src_body.data.copy()
    C.link(b, col)
    b.modifiers['rig'].object = rig
    b.hide_render = b.hide_viewport = False
    rig.hide_render = rig.hide_viewport = False
    mat = palette_material(f'{name}_mat', outfit)
    b.data.materials.clear()
    b.data.materials.append(mat)
    b.parent = rig
    # Rigid pieces follow their bone: parented to it, keeping their rest place.
    pieces = []
    if hair:
        pieces.append(_cached(f'hair_{hair}', lambda: build_hair(hair, col)))
    if attach:
        if 'attach' not in _CACHE:
            for o in build_attachments(col):
                o.hide_render = o.hide_viewport = True
                _CACHE[f'att_{o.name}'] = o
            _CACHE['attach'] = True
        pieces += [_CACHE[f'att_{a}'] for a in attach if f'att_{a}' in _CACHE]
    bpy.context.view_layer.update()
    for src in pieces:
        o = src.copy()
        o.data = src.data.copy()
        C.link(o, col)
        o.hide_render = o.hide_viewport = False
        o.data.materials.clear()
        o.data.materials.append(mat)
        bone = src['attach']
        rest = rig.matrix_world @ rig.data.bones[bone].matrix_local
        o.parent = rig
        o.parent_type = 'BONE'
        o.parent_bone = bone
        # A bone parent sits at the bone's tail: undo that to keep the piece put.
        o.matrix_parent_inverse = (rest @ Matrix.Translation((0, rig.data.bones[bone].length, 0))).inverted()
        o['role'] = 'fig'
    rig.location = (loc[0], loc[1], 0.0)
    rig.rotation_euler = (0.0, 0.0, math.radians(face_deg))
    pose(rig, clip_name, phase)
    rig['role'] = 'fig'
    b['role'] = 'fig'
    return rig, b
