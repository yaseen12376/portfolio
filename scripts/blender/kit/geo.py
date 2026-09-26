"""
Geometry and material vocabulary for the dioramas.

Every object a scene makes is tagged with a ROLE, which decides how it is lit
and exported (see bake_scene.py):

  set     Never moves. Joined into one mesh per scene, lightmapped by Cycles
          (direct + indirect light, without surface colour), drawn unlit on the
          page as material colour x baked light. The cheapest and richest light.
  prop    Never moves, but is repeated or fine (hangers, leaves, bolts): kept as
          separate nodes that share mesh data, so the page draws each kind with
          one instanced call. Lit live, with baked ambient occlusion in vertex
          colours so crevices stay dark without a lightmap.
  dyn     Moves or is interacted with (a draggable rail, a crane jib, a helmet):
          lit live, never baked, so it leaves no shadow behind when it moves.
  fx      Overlays that mean something (detection brackets, trails, heat):
          emissive, unlit, never baked, often built on the page instead.

Bevel everything: a 2-3 segment bevel is what makes a procedural box read as a
made object rather than a primitive.
"""

from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import common as C

ROLES = ('set', 'prop', 'dyn', 'fx')

_MATS: dict = {}


# ---------------------------------------------------------------- materials

def pbr(name, hex_, rough=0.55, metal=0.0, spec=0.5, emit=None, emit_strength=0.0, alpha=1.0):
    """A Principled material that survives the glTF round trip unchanged."""
    key = (name, hex_, rough, metal, emit, emit_strength, alpha)
    if key in _MATS:
        return _MATS[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = C.lin(hex_)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    try:
        b.inputs['Specular IOR Level'].default_value = spec
    except KeyError:
        pass
    if emit:
        b.inputs['Emission Color'].default_value = C.lin(emit)
        b.inputs['Emission Strength'].default_value = emit_strength
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    m.diffuse_color = C.lin(hex_)
    _MATS[key] = m
    return m


_TEX_MANIFEST = None


def _manifest():
    global _TEX_MANIFEST
    if _TEX_MANIFEST is None:
        import json
        import os
        path = os.path.join(C.BUILD, '..', 'assets', 'manifest.json')
        _TEX_MANIFEST = json.load(open(path)) if os.path.exists(path) else {'textures': {}}
    return _TEX_MANIFEST


def textured(name, tex_id, tint='#ffffff', rough=0.6, scale=1.0, strength=1.0, metal=0.0, blend=0.2):
    """A Principled material whose colour is a CC0 photo texture (Poly Haven,
    fetched by scripts/fetch-assets.mjs), tiled at its real-world size times
    `scale`, box-projected in object space (joined meshes have no UVs worth
    trusting), and multiplied by `tint` so it sits in the scene's palette.
    `strength` 0..1 fades the photo toward plain tint, for a quieter surface.
    Without the texture file it falls back to the plain tint, so a scene still
    builds before assets are fetched."""
    import os
    key = ('tex', name, tex_id, tint, rough, scale, strength, metal)
    if key in _MATS:
        return _MATS[key]
    info = _manifest()['textures'].get(tex_id)
    path = os.path.join(C.BUILD, '..', 'assets', info['file']) if info else None
    if not path or not os.path.exists(path):
        print(f'texture {tex_id} missing: plain {tint}')
        return pbr(name, tint, rough=rough, metal=metal)
    m = pbr(f'{name}', tint, rough=rough, metal=metal)
    m = m.copy()
    m.name = name
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    coord = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    sx, sy = info['size']
    mp.inputs['Scale'].default_value = (1 / (sx * scale), 1 / (sy * scale), 1 / (sx * scale))
    img = nt.nodes.new('ShaderNodeTexImage')
    img.image = bpy.data.images.load(path, check_existing=True)
    img.image.colorspace_settings.name = 'sRGB'
    img.projection = 'BOX'
    img.projection_blend = blend
    img.interpolation = 'Cubic'
    nt.links.new(coord.outputs['Object'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], img.inputs['Vector'])
    # Normalise the photo to its own average, so the material averages to
    # `tint` (the palette decides colour and value; the photo adds detail).
    import numpy as np
    px = np.empty(len(img.image.pixels), np.float32)
    img.image.pixels.foreach_get(px)
    mean_srgb = px.reshape(-1, 4)[:, :3].mean(0)
    mean = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in mean_srgb]
    src = img.outputs['Color']
    if strength < 1:
        fade = nt.nodes.new('ShaderNodeMix')
        fade.data_type = 'RGBA'
        fade.inputs['Factor'].default_value = 1 - strength
        nt.links.new(src, fade.inputs['A'])
        fade.inputs['B'].default_value = (*mean, 1)
        src = fade.outputs['Result']
    t = C.lin(tint)
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    nt.links.new(src, mix.inputs['A'])
    mix.inputs['B'].default_value = (*(t[i] / max(mean[i], 1e-3) for i in range(3)), 1)
    nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    # What the page needs to draw the same surface: the photo, its tiling (UV
    # per metre, the box projection's scale), how strongly it shows, the
    # average it is normalised to, and the tint (linear).
    m['texture'] = tex_id
    m['tex_file'] = info['file']
    m['tex_uv'] = (1 / (sx * scale), 1 / (sy * scale))
    m['tex_strength'] = float(strength)
    m['tex_mean'] = [float(c) for c in mean]
    m['tex_tint'] = [float(c) for c in t]
    _MATS[key] = m
    return m


def mat(key, **kw):
    """A material from the diorama palette by name (common.MAT)."""
    presets = {
        'steel': dict(rough=0.32, metal=1.0),
        'chrome': dict(rough=0.12, metal=1.0),
        'brass': dict(rough=0.3, metal=1.0),
        'glass': dict(rough=0.05, alpha=0.35),
        'plinth': dict(rough=0.6),
        'rubber': dict(rough=0.8),
        'screen_off': dict(rough=0.2),
    }
    args = {**presets.get(key, {}), **kw}
    return pbr(key, C.MAT[key], **args)


def glow(name, hex_, strength=6.0):
    """Emissive and nothing else: the brand colours, where they mean data."""
    return pbr(name, '#000000', rough=1.0, emit=hex_, emit_strength=strength)


# ---------------------------------------------------------------- tagging

def tag(obj, role='set', **extras):
    assert role in ROLES, role
    obj['role'] = role
    for k, v in extras.items():
        obj[k] = v
    return obj


def role(obj):
    return obj.get('role', 'set')


# ---------------------------------------------------------------- primitives

def _finish(o, name, col, material, role_, smooth, extras):
    o.name = name
    if o.data:
        o.data.name = name
    C.move_to(o, col)
    if material is not None:
        o.data.materials.clear()
        for m in material if isinstance(material, (list, tuple)) else [material]:
            o.data.materials.append(m)
    if smooth and o.type == 'MESH':
        for p in o.data.polygons:
            p.use_smooth = True
    return tag(o, role_, **extras)


def bevel(o, width=0.01, segments=3, angle=40):
    m = o.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(angle)
    m.harden_normals = False
    # Weighted normals keep bevelled flats flat under smooth shading.
    w = o.modifiers.new('wn', 'WEIGHTED_NORMAL')
    w.keep_sharp = True
    return o


def box(name, size, loc=(0, 0, 0), rot=(0, 0, 0), col=None, material=None, bev=0.01, role='set', **extras):
    """A bevelled box. `loc` is the centre of its base (things stand on floors)."""
    sx, sy, sz = size
    bpy.ops.mesh.primitive_cube_add(size=1, location=(loc[0], loc[1], loc[2] + sz / 2))
    o = bpy.context.active_object
    o.scale = (sx, sy, sz)
    o.rotation_euler = [math.radians(a) for a in rot]
    C.apply_transform(o)
    if bev:
        bevel(o, min(bev, min(size) * 0.45))
    return _finish(o, name, col, material, role, bool(bev), extras)


def cyl(name, r, h, loc=(0, 0, 0), rot=(0, 0, 0), col=None, material=None, verts=32, bev=0.004, role='set', **extras):
    """A cylinder standing on `loc`."""
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, vertices=verts, location=(loc[0], loc[1], loc[2] + h / 2))
    o = bpy.context.active_object
    o.rotation_euler = [math.radians(a) for a in rot]
    C.apply_transform(o)
    if bev:
        bevel(o, min(bev, r * 0.4, h * 0.4), segments=2)
    return _finish(o, name, col, material, role, True, extras)


def sphere(name, r, loc=(0, 0, 0), scale=(1, 1, 1), col=None, material=None, seg=24, role='set', **extras):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=max(8, seg // 2), radius=r, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    C.apply_transform(o)
    return _finish(o, name, col, material, role, True, extras)


def mesh(name, verts, faces, col=None, material=None, smooth=False, role='set', **extras):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # "Outside" means nothing for an open, flat, horizontal sheet (a lip, a
    # rug), and recalc can turn one face-down: the bake then culls it as an
    # underside and the page shows a hole. Such a sheet is seen from above.
    if len({round(v[2], 6) for v in verts}) == 1:
        for f in bm.faces:
            if f.normal.z < 0:
                f.normal_flip()
    bm.to_mesh(me)
    bm.free()
    o = C.link(bpy.data.objects.new(name, me), col)
    return _finish(o, name, col, material, role, smooth, extras)


def lathe(name, profile, col=None, material=None, segments=40, loc=(0, 0, 0), role='set', **extras):
    """Revolve a (radius, z) profile around Z. r == 0 makes a pole."""
    verts, faces, rings = [], [], []
    for r, z in profile:
        if r <= 1e-6:
            rings.append([len(verts)])
            verts.append((loc[0], loc[1], loc[2] + z))
            continue
        ring = []
        for s in range(segments):
            th = 2 * math.pi * s / segments
            ring.append(len(verts))
            verts.append((loc[0] + r * math.cos(th), loc[1] + r * math.sin(th), loc[2] + z))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) > 1:
            faces += [(a[0], b[s], b[(s + 1) % segments]) for s in range(segments)]
        elif len(b) == 1 and len(a) > 1:
            faces += [(a[s], b[0], a[(s + 1) % segments]) for s in range(segments)]
        elif len(a) > 1 and len(b) > 1:
            faces += [(a[s], a[(s + 1) % segments], b[(s + 1) % segments], b[s]) for s in range(segments)]
    return mesh(name, verts, faces, col, material, smooth=True, role=role, **extras)


def tube(name, points, radius=0.01, col=None, material=None, resolution=3, role='set', closed=False, **extras):
    """A round tube through 3D points (pipes, rails, cables, handrails)."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = radius
    cu.bevel_resolution = resolution
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(points) - 1)
    for p, xyz in zip(sp.points, points):
        p.co = (*xyz, 1)
    sp.use_cyclic_u = closed
    o = C.link(bpy.data.objects.new(name, cu), col)
    if material is not None:
        cu.materials.append(material)
    return tag(realize(o), role, **extras)


def extrude(name, poly, depth, z=0.0, col=None, material=None, bev=0.004, role='set', caps='both', **extras):
    """Extrude a 2D polygon (x, y) upward by `depth` from height `z`.
    caps: 'both' | 'top' | 'bottom' | 'none'. Leave off caps nobody can see
    (the faces between stacked layers): they would take lightmap space and
    bake black."""
    n = len(poly)
    verts = [(x, y, z) for x, y in poly] + [(x, y, z + depth) for x, y in poly]
    faces = []
    if caps in ('both', 'bottom'):
        faces.append(tuple(range(n - 1, -1, -1)))
    if caps in ('both', 'top'):
        faces.append(tuple(range(n, 2 * n)))
    faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    o = mesh(name, verts, faces, col, material, role=role, **extras)
    if bev:
        bevel(o, bev, segments=2)
    return o


def annulus(name, outer, inner, z, col=None, material=None, role='set', **extras):
    """A flat ring between two outlines with the same vertex count (e.g. two
    rounded_rect()s): the visible lip of a base under a narrower layer."""
    n = len(outer)
    assert n == len(inner)
    verts = [(x, y, z) for x, y in outer] + [(x, y, z) for x, y in inner]
    faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return mesh(name, verts, faces, col, material, role=role, **extras)


def realize(o):
    """Curves and text become meshes, keeping name, place and parent."""
    if o.type not in ('CURVE', 'FONT'):
        return o
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    name, mw, cols, props = o.name, o.matrix_world.copy(), list(o.users_collection), dict(o.items())
    bpy.data.objects.remove(o, do_unlink=True)
    n = bpy.data.objects.new(name, me)
    for c in cols:
        c.objects.link(n)
    n.matrix_world = mw
    for k, v in props.items():
        n[k] = v
    for p in me.polygons:
        p.use_smooth = True
    return n


def text(name, body, size=0.05, depth=0.002, loc=(0, 0, 0), rot=(90, 0, 0), col=None, material=None,
         align='CENTER', role='set', font_path=None, **extras):
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = body
    cu.size = size
    cu.extrude = depth
    cu.align_x = align
    cu.align_y = 'CENTER'
    if font_path:
        try:
            cu.font = bpy.data.fonts.load(font_path, check_existing=True)
        except Exception as e:
            print('font load failed, using built-in:', e)
    o = C.link(bpy.data.objects.new(name, cu), col)
    o.location = loc
    o.rotation_euler = [math.radians(a) for a in rot]
    if material is not None:
        cu.materials.append(material)
    return tag(realize(o), role, **extras)


# ---------------------------------------------------------------- instancing

def instance(proto, name, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), col=None, role=None, **extras):
    """A linked duplicate: same mesh data, its own transform. The exporter
    writes one glTF mesh for all of them; build-3d turns them into one
    EXT_mesh_gpu_instancing draw call."""
    o = bpy.data.objects.new(name, proto.data)
    C.link(o, col or (proto.users_collection[0] if proto.users_collection else None))
    o.location = loc
    o.rotation_euler = [math.radians(a) for a in rot]
    o.scale = scale
    for k, v in proto.items():
        if k != 'proto':
            o[k] = v
    return tag(o, role or proto.get('role', 'prop'), **extras)


def retire(proto):
    """A prototype's own copy is never drawn or exported: only its instances."""
    proto['proto'] = 1
    proto.hide_render = True
    proto.hide_viewport = True
    return proto


def prototype(builder, name, col=None, role='prop'):
    """Build a multi-part prop once, join it into one mesh, apply modifiers,
    and park it at the origin as the source for instance()."""
    parts = builder()
    for p in parts:
        C.apply_modifiers(p)
    o = C.join(parts, name)
    C.apply_transform(o, loc=True)  # origin back to the footprint centre on the floor
    C.move_to(o, col)
    o['role'] = role
    o['proto'] = 1
    return o


def parts_to(parts, name, col=None, role='set', **extras):
    """Join a finished multi-part object into one mesh with its modifiers applied."""
    for p in parts:
        C.apply_modifiers(p)
    o = C.join(parts, name)
    # A join keeps the active part's origin (a tabletop's centre, say); the
    # kit's contract is the footprint centre on the floor, so a scene can
    # place a fixture by where it stands.
    C.apply_transform(o, loc=True)
    C.move_to(o, col)
    return tag(o, role, **extras)


def place(obj, loc=(0, 0, 0), rot=(0, 0, 0)):
    """Move a joined, origin-at-zero object into position (rotation in degrees)."""
    obj.location = loc
    obj.rotation_euler = [math.radians(a) for a in rot]
    return obj
