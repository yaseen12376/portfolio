"""
Small parts the pieces share: paper with printed lines, glows, jointed toy
limbs, rings, and a strip of paper that follows a path.

Everything is built in a local frame and then parented to an empty (group()),
so a part is placed by moving one object. Piece space: z = 0 is the top of the
turntable, -Y is the side the camera sees first.
"""

from __future__ import annotations

import math
import os

import bpy
from mathutils import Vector

import common as C
from kit import geo
from pieces import _kit as K

FONT = K.FONT
SANS = os.path.join(C.ROOT, 'node_modules', '@fontsource-variable', 'geist', 'files', 'geist-latin-wght-normal.woff2')


def group(name, col, parts=(), loc=(0, 0, 0), rot=(0, 0, 0), parent=None, scale=1.0):
    """An empty that owns `parts` (built in its local frame). `rot` in degrees."""
    e = C.empty(name, col, loc=loc)
    e.rotation_euler = [math.radians(a) for a in rot]
    e.scale = (scale, scale, scale)
    for p in parts:
        if p is not None:
            p.parent = e
    if parent is not None:
        e.parent = parent
    return e


def adopt(col, before):
    """Move every object made since `before` (a set of names) into `col`: the
    diorama kit's props are built in the scene's own collection."""
    for o in list(bpy.data.objects):
        if o.name not in before and col not in o.users_collection:
            C.move_to(o, col)


def names():
    return {o.name for o in bpy.data.objects}


# ---------------------------------------------------------------- materials

def paper(name='paper', hex_='#f3efe6', rough=0.82):
    return geo.pbr(name, hex_, rough=rough)


def ink(name='ink', hex_='#2a2724'):
    return geo.pbr(name, hex_, rough=0.75)


def wood(name='toy_wood', hex_='#c9a06c', rough=0.55):
    m = geo.textured(name, 'black_walnut_veneer_01', tint=hex_, rough=rough, scale=0.25, strength=0.55)
    return m


def soft_glow(name, hex_, strength=3.0, alpha=1.0):
    """Emission mixed with transparency: a beam, a ring of light, a faint disc.
    `alpha` 1 is a solid glow; lower lets the scene show through."""
    if alpha >= 1:
        return geo.glow(name, hex_, strength)
    m, nt, out = K._nodes(name)
    e = nt.nodes.new('ShaderNodeEmission')
    e.inputs['Color'].default_value = C.lin(hex_)
    e.inputs['Strength'].default_value = strength
    t = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    mix.inputs[0].default_value = alpha
    nt.links.new(t.outputs[0], mix.inputs[1])
    nt.links.new(e.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    m['glow'] = 1
    return m


def set_glow(material, strength=None, alpha=None):
    """Change a glow between frames (either kind of glow material)."""
    nt = material.node_tree
    for n in nt.nodes:
        if n.type == 'EMISSION' and strength is not None:
            n.inputs['Strength'].default_value = strength
        elif n.type == 'BSDF_PRINCIPLED' and strength is not None:
            n.inputs['Emission Strength'].default_value = strength
        elif n.type == 'MIX_SHADER' and alpha is not None:
            n.inputs[0].default_value = alpha


def no_shadow(o):
    o.visible_shadow = False
    return o


def _emits(m):
    if m.get('glow'):
        return True
    for n in (m.node_tree.nodes if m.node_tree else ()):
        if n.type == 'EMISSION':
            return True
        if n.type == 'BSDF_PRINCIPLED':
            s, c = n.inputs.get('Emission Strength'), n.inputs.get('Emission Color')
            if s is not None and s.default_value > 0 and c is not None and max(c.default_value[:3]) > 0:
                return True
    return False


def no_ghosts(col):
    """Keep glowing parts out of reflections. In the jar's glass they show up
    as a second, floating copy of the piece. They are still seen through the
    glass and still light what is near them. Call at the end of build()."""
    for o in col.all_objects:
        if any(s.material is not None and _emits(s.material) for s in getattr(o, 'material_slots', ())):
            o.visible_glossy = False


# ---------------------------------------------------------------- flat things

def slab(name, w, h, t, col, material, x=0.0, y=0.0, z=0.0, bev=0.0):
    """A flat rectangle in the local XY plane, `t` thick, centred on (x, y),
    its underside at z."""
    return geo.box(name, (w, h, t), (x, y, z), col=col, material=material, bev=bev)


def sheet(name, w, h, col, material=None, t=0.0018, corner=0.0):
    """A sheet of paper in the local XY plane: x centred, y from 0 to h."""
    material = material or paper()
    if corner:
        c = corner
        poly = [(-w / 2 + c, 0), (w / 2 - c, 0), (w / 2, c), (w / 2, h - c), (w / 2 - c, h), (-w / 2 + c, h), (-w / 2, h - c), (-w / 2, c)]
    else:
        poly = [(-w / 2, 0), (w / 2, 0), (w / 2, h), (-w / 2, h)]
    return geo.extrude(name, poly, t, col=col, material=material, bev=0)


def rows(name, col, material, x0, x1, y_top, n, pitch, thick=0.004, z=0.002, ragged=None, skip=()):
    """Lines of 'text': thin bars from x0 toward x1, one per row, going down
    from y_top. `ragged`: per-row lengths as a fraction of the full width."""
    out = []
    rnd = C.Rand(len(name) * 7 + n)
    for i in range(n):
        if i in skip:
            continue
        k = ragged[i % len(ragged)] if ragged else 0.62 + 0.38 * rnd()
        w = (x1 - x0) * k
        out.append(geo.box(f'{name}_{i}', (w, thick, 0.0003), (x0 + w / 2, y_top - i * pitch, z), col=col, material=material, bev=0))
    return out


def label(name, body, size, col, material, x=0.0, y=0.0, z=0.002, align='CENTER', depth=0.0003, rot_z=0.0):
    """Printed words lying in the local XY plane."""
    return geo.text(name, body, size=size, depth=depth, loc=(x, y, z), rot=(0, 0, rot_z), col=col, material=material,
                    align=align, font_path=FONT, resolution=3)


def heavy(name, body, size, col, material, loc=(0, 0, 0), rot=(90, 0, 0), depth=0.002, weight=0.04, font_path=None, align='CENTER'):
    """Words in a heavier weight than the font file opens at: the outlines are
    pushed out by `weight` x size. Standing by default, facing -Y."""
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = body
    cu.size = size
    cu.extrude = depth
    cu.offset = size * weight
    cu.resolution_u = 6
    cu.align_x = align
    cu.align_y = 'CENTER'
    try:
        cu.font = bpy.data.fonts.load(font_path or SANS, check_existing=True)
    except Exception as e:
        print('font load failed, using built-in:', e)
    o = C.link(bpy.data.objects.new(name, cu), col)
    o.location = loc
    o.rotation_euler = [math.radians(a) for a in rot]
    cu.materials.append(material)
    return geo.tag(geo.realize(o), 'set')


def barcode(name, col, material, x, y, w, h, z=0.002, seed=5):
    """Vertical bars of uneven width, the way a Code 128 strip reads from afar."""
    rnd = C.Rand(seed)
    out = []
    cx = x - w / 2
    i = 0
    while cx < x + w / 2 - 0.001:
        bw = (0.0012, 0.0024, 0.0036)[int(rnd() * 3)]
        gap = (0.0012, 0.0024)[int(rnd() * 2)]
        bw = min(bw, x + w / 2 - cx)
        out.append(geo.box(f'{name}_{i}', (bw, h, 0.0003), (cx + bw / 2, y, z), col=col, material=material, bev=0))
        cx += bw + gap
        i += 1
    return out


def brackets(name, col, material, w, h, arm=0.25, thick=0.004, depth=0.002, z=0.0):
    """Four corner brackets around a w x h box in the local XY plane, centred."""
    out = []
    ax, ay = w * arm, h * arm
    for sx in (-1, 1):
        for sy in (-1, 1):
            out.append(geo.box(f'{name}_h', (ax, thick, depth), (sx * (w / 2 - ax / 2), sy * (h / 2 - thick / 2), z), col=col, material=material, bev=0))
            out.append(geo.box(f'{name}_v', (thick, ay, depth), (sx * (w / 2 - thick / 2), sy * (h / 2 - ay / 2), z), col=col, material=material, bev=0))
    return out


def stroke(name, a, b, thick, col, material, z=0.002, depth=0.0004):
    """A straight line drawn on a sheet: from a to b in the local XY plane."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    return geo.box(name, (length, thick, depth), ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z), rot=(0, 0, math.degrees(math.atan2(dy, dx))),
                   col=col, material=material, bev=0)


def limb(name, a, b, r0, r1, col, material, parent=None):
    """A rounded limb from point a to point b (in the parent's frame)."""
    a, b = Vector(a), Vector(b)
    o = capsule(name, (b - a).length, r0, r1, col, material)
    o.location = a
    o.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
    if parent is not None:
        o.parent = parent
    return o


def elbow(a, c, l1, l2, pole):
    """Two-bone reach: where the middle joint sits between a and c for bone
    lengths l1 and l2, bent toward `pole`."""
    a, c, pole = Vector(a), Vector(c), Vector(pole)
    ac = c - a
    d = min(ac.length, l1 + l2 - 1e-6)
    u = ac.normalized()
    x = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = math.sqrt(max(0.0, l1 * l1 - x * x))
    side = (pole - u * pole.dot(u)).normalized()
    return a + u * x + side * h


# ---------------------------------------------------------------- round things

def ring(name, radius, tube, col, material, z=0.0, segments=96, sides=10):
    """A torus lying flat (in the XY plane), centred on the local origin at z."""
    bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=tube, major_segments=segments, minor_segments=sides,
                                     location=(0, 0, z))
    o = bpy.context.active_object
    return geo._finish(o, name, col, material, 'set', True, {})


def flat_ring(name, r0, r1, col, material, z=0.0, h=0.0006, segments=96, a0=0.0, a1=360.0):
    """A flat band between two radii (a mark on a floor), optionally an arc."""
    n = max(3, int(segments * (a1 - a0) / 360))
    verts, faces = [], []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        c, s = math.cos(a), math.sin(a)
        verts += [(r0 * c, r0 * s, z), (r1 * c, r1 * s, z), (r0 * c, r0 * s, z + h), (r1 * c, r1 * s, z + h)]
    for i in range(n):
        a, b = i * 4, (i + 1) * 4
        faces += [(a + 2, a + 3, b + 3, b + 2), (a, b, b + 1, a + 1), (a + 1, b + 1, b + 3, a + 3), (a, a + 2, b + 2, b)]
    return geo.mesh(name, verts, faces, col, material)


def capsule(name, length, r0, r1, col, material, segments=20):
    """A limb: rounded at both ends, from the local origin up +Z by `length`."""
    n = 6
    prof = [(0.0, -r0)]
    for i in range(1, n + 1):
        a = -math.pi / 2 + (math.pi / 2) * i / n
        prof.append((r0 * math.cos(a), r0 * math.sin(a)))
    for i in range(0, n):
        a = (math.pi / 2) * i / n
        prof.append((r1 * math.cos(a), length + r1 * math.sin(a)))
    prof.append((0.0, length + r1))
    return geo.lathe(name, prof, col, material, segments=segments)


def rod(name, a, b, r, col, material, verts=20, bev=0.0):
    """A straight round bar between two points (flat ends)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, vertices=verts, location=(a + b) / 2)
    o = bpy.context.active_object
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    if bev:
        geo.bevel(o, min(bev, r * 0.4), segments=2)
    return geo._finish(o, name, col, material, 'set', True, {})


def path_tube(name, fn, n, radius, col, material, closed=False):
    """A tube through fn(u) for u in 0..1."""
    pts = [tuple(fn(i / (n if closed else n - 1))) for i in range(n)]
    return geo.tube(name, pts, radius=radius, col=col, material=material, resolution=3, closed=closed)


def ball(name, r, col, material, loc=(0, 0, 0), seg=20):
    return geo.sphere(name, r, loc, col=col, material=material, seg=seg)


def rounded_box(name, size, col, material, loc=(0, 0, 0), radius=0.01):
    return geo.box(name, size, loc, col=col, material=material, bev=radius)


def cone(name, r, h, col, material, loc=(0, 0, 0), tip=0.15, segments=28):
    """A cone standing on `loc` (a traffic cone, a beam's shell)."""
    return geo.lathe(name, [(0.0, 0.0), (r, 0.0), (r * tip, h), (0.0, h)], col, material, segments=segments, loc=loc)


# ---------------------------------------------------------------- paper on a path

class Strip:
    """A flat printed strip that lies along a path and can slide along it.

    Build the strip flat: its length along +X (from x = 0), its width along Y,
    print raised in +Z. `path(s)` returns ((x, y, z), tangent, normal) for a
    distance s along the path; `side` is the strip's width direction. Call
    place(offset) to lay the strip with its x = 0 edge at distance `offset`.
    """

    def __init__(self, obj, path, side=(1.0, 0.0, 0.0)):
        self.obj = obj
        self.path = path
        self.side = Vector(side)
        me = obj.data
        self.rest = [v.co.copy() for v in me.vertices]

    def place(self, offset=0.0):
        me = self.obj.data
        flat = [0.0] * (len(self.rest) * 3)
        for i, r in enumerate(self.rest):
            p, _t, n = self.path(r.x + offset)
            q = Vector(p) + self.side * r.y + Vector(n) * r.z
            flat[i * 3:i * 3 + 3] = (q.x, q.y, q.z)
        me.vertices.foreach_set('co', flat)
        me.update()


def join(parts, name, col):
    """Many printed bits become one mesh (keeps their materials)."""
    parts = [p for p in parts if p is not None]
    for p in parts:
        C.apply_modifiers(p)
    o = C.join(parts, name)
    # A join keeps the first part's origin: put it back at the local zero, so
    # the mesh's coordinates are the ones the parts were built at.
    C.apply_transform(o, loc=True)
    C.move_to(o, col)
    return o


def subdivide_x(o, step):
    """Cut a flat mesh across X every `step`, so it can bend along a path."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(o.data)
    xs = [v.co.x for v in bm.verts]
    x = min(xs) + step
    hi = max(xs)
    while x < hi - 1e-6:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(x, 0, 0), plane_no=(1, 0, 0))
        x += step
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return o
