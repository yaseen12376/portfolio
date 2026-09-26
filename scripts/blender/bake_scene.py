"""
Bake, export and render one diorama (ported from KPS/scripts/blender/bake3d.py).

  blender --background --factory-startup --python scripts/blender/bake_scene.py -- \
      --scene <id> --stage light|env|export|still [--samples N] [--size N]

Each stage runs in its own Blender process (scripts/build-3d.mjs does this):
headless Cycles baking leaks memory and occasionally crashes, and a fresh
process per stage makes both harmless.

  light   Join every 'set' object into one mesh, give it a second UV map
          ('bake'), and bake Cycles diffuse light, direct + indirect, WITHOUT
          surface colour. The page multiplies it by the material colour, so
          colour edges stay sharp while the light (soft) needs little
          resolution. Props are present as occluders (they never move); 'dyn'
          pieces and figures are hidden (they move, and would leave shadows
          behind). Writes lightmap.png and set.blend.
  env     A panorama from inside the scene: ambient light and reflections for
          everything lit live (props, dyn pieces, figures).
  export  Ambient occlusion baked into each prop's and dyn piece's vertex
          colours; scene.glb (set + props + dyn + anchors) and scene.json.
  still   The posters: Cycles, figures posed at t = 0 exactly as the page
          starts them, in three aspects. Transparent film: build-3d.mjs lays
          the backdrop and the same blur/glow the page uses.

Raw outputs go to build/3d/<id>/; build-3d.mjs turns them into public/3d/<id>/.
"""

from __future__ import annotations

import importlib
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import common as C  # noqa: E402
from kit import geo, nav as NAV, people as P, plinth as PL  # noqa: E402

LIGHT_SCALE = 5.0   # the lightmap stores light / 5 (p99.9 of the calibration bake is 5.25)
ENV_SCALE = 2.0
ASPECTS = {'16x9': (1920, 1080), 'sq': (1440, 1440), 'wide': (2340, 1080)}


# ---------------------------------------------------------------- scene assembly

def load(scene_id):
    return importlib.import_module(f'scenes.{scene_id}')


def assemble(S, *, figures: bool):
    """Build the scene into a fresh file. Returns (scene, data, key light)."""
    sc = C.reset()
    C.engine(sc, 'CYCLES')
    C.view_transform(sc)
    wc, ws = S.META.get('world', ('#101016', 0.35))
    C.world(sc, wc, ws)
    col = C.collection('diorama')
    data = S.build(col)
    key = S.lights(sc)
    if data.get('plinth') and S.META.get('kicker', True):
        PL.kicker(data['plinth'], S.META['view']['yaw'], **(S.META.get('kicker') or {}))
    if figures:
        figs = C.collection('figures')
        for i, m in enumerate(data.get('cast', [])):
            loc, face = cast_pose(m, data)
            rig, _b = P.spawn(figs, m['body'], m.get('outfit', {}), loc, face, m['clip'], m.get('phase', 0.0), f'fig{i}',
                              hair=m.get('hair'), attach=[*m.get('wear', []), *m.get('carry', [])])
            if m.get('scale'):
                rig.scale = (m['scale'],) * 3
    bpy.context.view_layer.update()
    return sc, data, key


def path_point(pts, along):
    """Position and heading at `along` (0..1 of arc length) on a polyline.
    The page uses the same parametrisation (src/three/people.js)."""
    seg = [(Vector(a), Vector(b)) for a, b in zip(pts, pts[1:])]
    lengths = [(b - a).length for a, b in seg]
    total = sum(lengths)
    d = (along % 1.0) * total
    for (a, b), l in zip(seg, lengths):
        if d <= l or (a, b) == seg[-1]:
            t = d / l if l else 0.0
            p = a + (b - a) * t
            return (p.x, p.y), (b - a).normalized()
        d -= l
    return tuple(pts[-1]), Vector((1, 0))


def cast_pose(m, data):
    if 'path' in m:
        (x, y), tan = path_point(data['paths'][m['path']], m.get('along', 0.0))
        return (x, y), math.degrees(math.atan2(tan.x, -tan.y))
    return tuple(m['at']), m.get('face', 0.0)


def objects(role):
    return [o for o in bpy.data.objects if o.get('role') == role]


# ---------------------------------------------------------------- helpers (from KPS)

def pixels(img) -> np.ndarray:
    w, h = img.size
    buf = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(buf)
    return buf.reshape(h, w, 4)[::-1]  # row 0 at the top, like an image file


def srgb(lin):
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)


def blur(a, sigma):
    """Separable Gaussian in numpy (no PIL inside Blender)."""
    r = max(1, int(sigma * 3))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    out = a.copy()
    for axis in (0, 1):
        pad = [(0, 0)] * a.ndim
        pad[axis] = (r, r)
        p = np.pad(out, pad, mode='edge')
        acc = np.zeros_like(out)
        for i, w in enumerate(k):
            sl = [slice(None)] * a.ndim
            sl[axis] = slice(i, i + out.shape[axis])
            acc += w * p[tuple(sl)]
        out = acc
    return out


def smooth_islands(a):
    """A light denoise for baked light: blur, but only where the blur does not
    cross a sharp change (a UV seam or a hard shadow edge)."""
    orig = srgb(a / LIGHT_SCALE)
    b = blur(orig, 1.2)
    diff = np.abs(b - orig).max(-1, keepdims=True)
    w = np.clip(1 - diff / 0.06, 0, 1)
    return orig * (1 - w) + b * w


def save_png(arr, path):
    """Write an HxWx3 array of 0..1 values to an 8-bit PNG, byte for byte."""
    h, w = arr.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = arr[::-1]
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()


def bake_setup(sc, samples):
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = False
    sc.cycles.use_denoising = False
    sc.render.bake.margin = 16
    try:
        sc.render.bake.margin_type = 'EXTEND'
    except Exception:
        pass


def bake_into(objs, img, kind='DIFFUSE', passes=('DIRECT', 'INDIRECT')):
    added = []
    for o in objs:
        for m in o.data.materials:
            if m is None:
                continue
            n = m.node_tree.nodes.new('ShaderNodeTexImage')
            n.image = img
            m.node_tree.nodes.active = n
            added.append((m.node_tree, n))
    C.select(objs)
    bpy.ops.object.bake(type=kind, pass_filter=set(passes), margin=16, use_clear=True, target='IMAGE_TEXTURES')
    for nt, n in added:
        nt.nodes.remove(n)


def cull(o, view_dir):
    """Delete faces no camera can see: undersides, faces pointing away from
    every view in the allowed orbit, and faces buried against other geometry
    (a box's bottom on the floor, the back of a shelf against a wall). A ray
    from the face centre along its normal that hits something within 6 mm
    means nothing can see that point; a face goes only when all of its points
    are hidden. More lightmap for what is seen."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.normal_update()
    v = Vector(view_dir).normalized()
    dg = bpy.context.evaluated_depsgraph_get()
    sc = bpy.context.scene
    mw = o.matrix_world

    def buried(f):
        # Every sample must be covered, not just the centre: a band across the
        # middle of a tall face hides its centre and nothing else.
        n = (mw.to_3x3() @ f.normal).normalized()
        c = f.calc_center_median()
        for p in [c] + [c.lerp(v.co, 0.85) for v in f.verts]:
            hit, *_ = sc.ray_cast(dg, mw @ p + n * 0.0015, n, distance=0.006)
            if not hit:
                return False
        return True

    kill = [f for f in bm.faces if f.normal.z < -0.8 or (f.normal.dot(v) < -0.6 and f.normal.z < 0.2) or buried(f)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(o.data)
    bm.free()


def view_dir(S):
    v = S.META['view']
    yaw, pitch = math.radians(v['yaw']), math.radians(v['pitch'])
    return (math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch))


# ---------------------------------------------------------------- framing

def scene_hull(max_points=160):
    """The convex hull of everything drawn (set, props, moving pieces), as a
    few dozen points: the camera fit frames these rather than the bounding
    box, whose empty corners (air above an open front) made every diorama
    smaller than it needed to be."""
    import bmesh as _bm
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    bm = _bm.new()
    for o in bpy.data.objects:
        if o.type != 'MESH' or o.hide_render or o.get('role') not in ('set', 'prop', 'dyn'):
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = o.matrix_world
        step = max(1, len(me.vertices) // 400)
        for i in range(0, len(me.vertices), step):
            bm.verts.new(mw @ me.vertices[i].co)
        for c in o.bound_box:
            bm.verts.new(mw @ Vector(c))
        ev.to_mesh_clear()
    hull = _bm.ops.convex_hull(bm, input=bm.verts)
    pts = [v.co.copy() for v in hull['geom'] if isinstance(v, _bm.types.BMVert)]
    bm.free()
    if len(pts) > max_points:
        pts = pts[:: max(1, len(pts) // max_points)]
    return [[round(c, 4) for c in p] for p in pts]


def scene_bounds():
    """World-space box around everything that is drawn (set, props, dyn)."""
    lo, hi = Vector((1e9, 1e9, 1e9)), Vector((-1e9, -1e9, -1e9))
    bpy.context.view_layer.update()
    for o in bpy.data.objects:
        if o.type != 'MESH' or o.hide_render or o.get('role') not in ('set', 'prop', 'dyn'):
            continue
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
            hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
    return [list(lo), list(hi)]


def corners(bounds):
    (x0, y0, z0), (x1, y1, z1) = bounds
    return [Vector((x, y, z)) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]


def fit(bounds, direction, fov_deg, aspect, margin=1.06, hull=None):
    """Camera target and distance that fit every point of `hull` (or every
    corner of `bounds`) in frame, looking along -direction, aimed at the
    middle of what the camera sees (a few passes of fit, measure, recentre).
    Mirrored exactly by src/three/camera-rig.js, so a poster and the live
    scene frame the same way at any aspect."""
    target = sum(corners(bounds), Vector()) / 8
    cs = [Vector(p) for p in hull] if hull else corners(bounds)
    d = Vector(direction).normalized()
    F = -d
    R = F.cross(Vector((0, 0, 1))).normalized()
    U = R.cross(F).normalized()
    tv = math.tan(math.radians(fov_deg) / 2)
    th = tv * aspect

    def distance_for():
        need = 0.0
        for p in cs:
            q = p - target
            depth = q.dot(F)
            need = max(need, abs(q.dot(R)) / th - depth, abs(q.dot(U)) / tv - depth)
        return need

    dist = distance_for()
    for _ in range(4):
        xs, ys = [], []
        for p in cs:
            q = p - target
            z = q.dot(F) + dist
            xs.append(q.dot(R) / (z * th))
            ys.append(q.dot(U) / (z * tv))
        target = target + R * ((min(xs) + max(xs)) / 2 * dist * th) + U * ((min(ys) + max(ys)) / 2 * dist * tv)
        dist = distance_for()
    return target, dist * margin


# ---------------------------------------------------------------- stages

def merge_baked(s):
    """Every diffuse surface of the set now reads its colour from the atlas,
    so they can all share one material: one draw call on the page instead of
    one per material. Metals and glass keep theirs (they are lit live)."""
    me = s.data
    baked = bpy.data.materials.new('baked')
    baked.use_nodes = True
    baked['baked'] = True
    keep = []
    remap = {}
    for i, m in enumerate(me.materials):
        b = m and next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        live = b is not None and (b.inputs['Metallic'].default_value > 0.5 or b.inputs['Alpha'].default_value < 1)
        if live:
            remap[i] = len(keep) + 1
            keep.append(m)
        else:
            remap[i] = 0
    idx = [remap[p.material_index] for p in me.polygons]
    me.materials.clear()
    me.materials.append(baked)
    for m in keep:
        me.materials.append(m)
    me.polygons.foreach_set('material_index', idx)
    me.update()
    print('MERGED', len(idx), 'faces onto 1 baked material +', len(keep), 'live')


def tile_uvs(objs):
    """UVs for every photo-textured face, exactly as Cycles' box projection
    reads the photo (object space, the material's tiling, the same axis and
    flip rules as svm_node_tex_image_box), so the page draws the same tiling
    photo over the baked light: sharp at any distance."""
    for o in objs:
        me = o.data
        uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
        mats = list(me.materials)
        if not any(m and m.get('texture') for m in mats):
            continue
        buf = np.zeros(len(me.loops) * 2, np.float32)
        uv.data.foreach_get('uv', buf)
        buf = buf.reshape(-1, 2)
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        for p in me.polygons:
            m = mats[p.material_index] if p.material_index < len(mats) else None
            if not (m and m.get('texture')):
                continue
            su, sv = m['tex_uv']
            n = p.normal
            ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
            for li in p.loop_indices:
                x, y, z = co[me.loops[li].vertex_index]
                x, y, z = x * su, y * sv, z * su  # the Mapping node's scale (x, y, then z like x)
                if ax >= ay and ax >= az:
                    buf[li] = ((1 - y) if n.x < 0 else y, z)
                elif ay >= az:
                    buf[li] = ((1 - x) if n.y > 0 else x, z)
                else:
                    buf[li] = ((1 - y) if n.z > 0 else y, x)
        uv.data.foreach_set('uv', buf.ravel())
        me.update()


def merge_tiled(s, out):
    """The set's surfaces as the page draws them: one 'flat' material whose
    colour rides in the vertex colours, and one per photo texture (its tint in
    the vertex colours, the photo on UV 0), all times the lightmap on UV 1.
    Metals and glass keep their own (they are lit live). Each photo is written
    once, normalised to its average and faded by its strength, so
    colour = tint x tile x light exactly as Blender's material computes it."""
    me = s.data
    col = me.color_attributes.get('Col') or me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    me.color_attributes.active_color = col
    try:
        me.color_attributes.render_color_index = list(me.color_attributes).index(col)
    except Exception:
        pass
    flat = bpy.data.materials.new('flat')
    flat.use_nodes = True
    groups, live, info = {}, [], {}
    route = {}
    for i, m in enumerate(me.materials):
        b = m and next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if b is not None and (b.inputs['Metallic'].default_value > 0.5 or b.inputs['Alpha'].default_value < 1):
            if m not in live:
                live.append(m)
            route[i] = ('live', m, None)
        elif m and m.get('texture'):
            k = (m['texture'], round(float(m['tex_strength']), 2))
            if k not in groups:
                g = bpy.data.materials.new(f'tiled_{k[0]}_{int(k[1] * 100)}')
                g.use_nodes = True
                groups[k] = (g, m)
            route[i] = ('tiled', groups[k][0], list(m['tex_tint'])[:3])
        else:
            base = list(b.inputs['Base Color'].default_value[:3]) if b is not None else [0.8, 0.8, 0.8]
            route[i] = ('flat', flat, base)
    order = [flat] + [g for g, _ in groups.values()] + live
    at = {m.name: j for j, m in enumerate(order)}
    rgba = np.ones((len(me.loops), 4), np.float32)
    idx = []
    for p in me.polygons:
        kind, m, c = route.get(p.material_index, ('flat', flat, [0.8, 0.8, 0.8]))
        idx.append(at[m.name])
        if c is not None:
            for li in p.loop_indices:
                rgba[li, :3] = c
    col.data.foreach_set('color', rgba.ravel())
    me.materials.clear()
    for m in order:
        me.materials.append(m)
    me.polygons.foreach_set('material_index', idx)
    me.update()
    # The tiles: linear photo / its average, faded toward 1 by (1 - strength),
    # halved into 8 bits (the page doubles it back), 512 px.
    for (tex_id, strength), (g, src) in groups.items():
        path = os.path.join(C.BUILD, '..', 'assets', src['tex_file'])
        img = bpy.data.images.load(path, check_existing=True)
        w, h = img.size
        px = np.empty(w * h * 4, np.float32)
        img.pixels.foreach_get(px)
        rgb = px.reshape(h, w, 4)[::-1, :, :3]  # top row first
        lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
        mean = np.array(src['tex_mean'], np.float32)
        t = (lin / np.maximum(mean, 1e-3)) * strength + (1 - strength)
        k = max(1, w // 512)
        t = t[: (h // k) * k, : (w // k) * k].reshape(h // k, k, w // k, k, 3).mean((1, 3))
        name = f'tile-{tex_id}-{int(strength * 100)}.png'
        save_png(srgb(np.clip(t / 2, 0, 1)), os.path.join(out, name))
        info[g.name] = {'tile': name}
    print('MERGED', len(idx), 'faces: flat +', len(groups), 'tiled +', len(live), 'live')
    return info


def occluder_boxes(objs):
    """World boxes (three.js axes) of the set's tall pieces: walls, racking,
    partitions. The page tests a few rays against these to tell whether a
    camera can see someone (a dashed box while they are hidden)."""
    out = []
    for o in objs:
        pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        # Tall, and wide enough to hide a person (a wall, racking, a booth):
        # not a post, a lamp, a sign; never a glazed frame.
        if hi.z < 1.2 or hi.z - lo.z < 1.0 or max(hi.x - lo.x, hi.y - lo.y) < 0.5 or o.get('see_through'):
            continue
        out.append([[round(lo.x, 3), round(lo.z, 3), round(-hi.y, 3)], [round(hi.x, 3), round(hi.z, 3), round(-lo.y, 3)]])
    return out


def stage_light(S, out, samples, size):
    sc, data, key = assemble(S, figures=False)
    data['bounds'] = scene_bounds()
    data['hull'] = scene_hull()
    # The walkable floor, before joining and culling remove what the rays need.
    pl = S.META['plinth']
    data['nav'] = NAV.build(data['plinth'], pl['w'], pl['d'], pl.get('radius', 0.16))
    data['footprints'] = NAV.footprints()
    if data.get('spots'):
        # Static fixtures only here; moving ones (rails) are checked on the page.
        data['nav_unreachable'] = NAV.check_reach(data['nav'], data['spots'], 0.2, S.META.get('nav_start'), NAV.dyn_polys())
        data['spots_too_close'] = NAV.check_spacing(data['spots'])
        print('NAV spots too close:', data['spots_too_close'] or 'none')
    bake_setup(sc, samples)
    for o in objects('dyn'):
        o.hide_render = True
        for c in o.children_recursive:
            c.hide_render = True
    set_objs = [o for o in objects('set') if o.type in ('MESH', 'CURVE')]
    for o in set_objs:
        C.apply_modifiers(geo.realize(o) if o.type == 'CURVE' else o)
    set_objs = [o for o in objects('set') if o.type == 'MESH']
    tiled = bool(S.META.get('tiled'))
    data['occluders'] = occluder_boxes(set_objs)
    if tiled:
        tile_uvs(set_objs)
    s = C.join(set_objs, 'set_all')
    s['role'] = 'set'
    cull(s, view_dir(S))
    me = s.data
    for layer in list(me.uv_layers):
        if not (tiled and layer.name == 'UVMap'):
            me.uv_layers.remove(layer)
    if not me.uv_layers.get('UVMap'):
        me.uv_layers.new(name='UVMap')      # TEXCOORD_0: the tiles' UVs (tiled), else unused
    bake_uv = me.uv_layers.new(name='bake')  # TEXCOORD_1: the lightmap
    me.uv_layers.active = bake_uv
    C.select([s])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    atlas = 0 if tiled else int(S.META.get('atlas', 0))
    if atlas:
        # Surface colour, photo textures and all, on the same UVs as the light:
        # noise-free in a few samples (it is colour, not light), so it keeps
        # every grain and weave the light bake's smoothing would blur.
        sc.cycles.samples = 8
        col = bpy.data.images.new('albedo', atlas, atlas, alpha=False, float_buffer=True)
        bake_into([s], col, passes=('COLOR',))
        sc.cycles.samples = samples
        save_png(srgb(pixels(col)[..., :3]), os.path.join(out, 'albedo.png'))
        data['albedo'] = atlas
        print('BAKED albedo', atlas)
    img = bpy.data.images.new('lightmap', size, size, alpha=False, float_buffer=True)
    bake_into([s], img)
    raw = pixels(img)[..., :3]
    np.save(os.path.join(out, 'light.npy'), raw.astype(np.float16))
    save_png(smooth_islands(raw), os.path.join(out, 'lightmap.png'))
    print('BAKED light', size, 'faces', len(me.polygons), 'max %.2f mean %.2f' % (raw.max(), raw.mean()))
    if tiled:
        data['materials'] = merge_tiled(s, out)
    elif atlas:
        merge_baked(s)
    C.write_json(os.path.join(out, 'build.json'), data)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'set.blend'))


def stage_nav(S, out):
    """Only the floor plan and the scene's plain data (spots, zones, lines,
    portals, cast), re-derived from the scene script into build.json and
    scene.json without baking light again: for layout tweaks that don't move
    anything the light bake sees, and for fixes to how the floor is read."""
    sc, data, key = assemble(S, figures=False)
    pl = S.META['plinth']
    b = json.load(open(os.path.join(out, 'build.json')))
    b['nav'] = NAV.build(data['plinth'], pl['w'], pl['d'], pl.get('radius', 0.16))
    b['footprints'] = NAV.footprints()
    for k in ('spots', 'zones', 'lines', 'portals', 'cast', 'paths', 'cameras'):
        if k in data:
            b[k] = data[k]
    if b.get('spots'):
        b['nav_unreachable'] = NAV.check_reach(b['nav'], b['spots'], 0.2, S.META.get('nav_start'), NAV.dyn_polys())
        b['spots_too_close'] = NAV.check_spacing(b['spots'])
        print('NAV spots too close:', b['spots_too_close'] or 'none')
    C.write_json(os.path.join(out, 'build.json'), b)
    sj = os.path.join(out, 'scene.json')
    if os.path.exists(sj):
        m = json.load(open(sj))
        m['nav'] = b['nav']
        m['footprints'] = b['footprints']
        m['zones'] = {k: [C.y_up((x, y, 0.0)) for x, y in pts] for k, pts in b.get('zones', {}).items()}
        m['spots'] = {k: {'at': C.y_up((v['at'][0], v['at'][1], 0.0)), 'face': v.get('face', 0.0), **{a: c for a, c in v.items() if a not in ('at', 'face')}}
                      for k, v in b.get('spots', {}).items()}
        m['lines'] = {k: [C.y_up((x, y, 0.0)) for x, y in pts] for k, pts in b.get('lines', {}).items()}
        m['portals'] = {k: {**v, 'at': C.y_up((v['at'][0], v['at'][1], 0.0))} for k, v in b.get('portals', {}).items()}
        m['paths'] = {k: [C.y_up((x, y, 0.0)) for x, y in pts] for k, pts in b.get('paths', {}).items()}
        m['cameras'] = {k: {**v, 'pos': C.y_up(v['pos']), 'look': C.y_up(v['look'])} for k, v in b.get('cameras', {}).items()}
        m['cast'] = [{**{k: v for k, v in c.items() if k not in ('at', 'face')},
                      **({'at': C.y_up((c['at'][0], c['at'][1], 0.0)), 'face': c.get('face', 0.0)} if 'at' in c else {})}
                     for c in b.get('cast', [])]
        C.write_json(sj, m)
    print('NAV refreshed', 'unreachable:', b.get('nav_unreachable') or 'none')


def stage_env(S, out, samples):
    sc, data, key = assemble(S, figures=False)
    for o in objects('dyn'):
        o.hide_render = True
    cam = C.camera(sc, (0.0, 0.0, 0.9), (0.0, 1.0, 0.9))
    cam.rotation_euler = (math.radians(90), 0, 0)
    cam.data.type = 'PANO'
    for holder in (cam.data, getattr(cam.data, 'cycles', None)):
        try:
            holder.panorama_type = 'EQUIRECTANGULAR'
        except Exception:
            pass
    sc.render.resolution_x, sc.render.resolution_y = 1024, 512
    sc.cycles.samples = min(samples, 256)
    sc.cycles.use_denoising = True
    sc.render.image_settings.file_format = 'OPEN_EXR'
    path = os.path.join(out, 'env.exr')
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    raw = pixels(bpy.data.images.load(path))[..., :3]
    save_png(srgb(raw / ENV_SCALE), os.path.join(out, 'env.png'))
    print('BAKED env')


def bake_ao(sc, objs):
    """Each live-lit piece's own occlusion, into a colour attribute that
    travels with it (KPS method). Gentle: there is no bounce light on the page
    to lift the crevices, so full-strength AO reads as dirt."""
    sc.world.light_settings.distance = 0.08
    everything = [o for o in bpy.data.objects if o.type == 'MESH']
    was = {o: o.hide_render for o in everything}
    meshes = [o for o in objs if o.type == 'MESH']
    by_data = {}
    for o in meshes:
        by_data.setdefault(o.data.name, o)  # instances share data: bake the prototype once
    for o in by_data.values():
        for e in everything:
            e.hide_render = True
        o.hide_render = False
        me = o.data
        a = me.color_attributes.get('ao') or me.color_attributes.new('ao', 'BYTE_COLOR', 'CORNER')
        me.color_attributes.active_color = a
        try:
            me.color_attributes.render_color_index = list(me.color_attributes).index(a)
        except Exception:
            pass
        C.select([o])
        bpy.ops.object.bake(type='AO', margin=0, target='VERTEX_COLORS')
        buf = np.empty(len(a.data) * 4, np.float32)
        a.data.foreach_get('color', buf)
        buf = buf.reshape(-1, 4)
        buf[:, :3] = 0.5 + 0.5 * buf[:, :3]
        a.data.foreach_set('color', buf.ravel())
    for o, h in was.items():
        o.hide_render = h
    print('BAKED ao', len(by_data), 'meshes')


def gltf(path, objs):
    C.select(objs)
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
              export_extras=True, export_texcoords=True, export_normals=True, export_materials='EXPORT',
              export_image_format='AUTO', export_cameras=False, export_lights=False, export_animations=False,
              export_vertex_color='ACTIVE', export_gpu_instances=False)
    while True:
        try:
            bpy.ops.export_scene.gltf(**kw)
            return
        except TypeError as e:
            bad = str(e).split('"')[1] if '"' in str(e) else None
            if not bad or bad not in kw:
                raise
            print('gltf: dropping unsupported option', bad)
            kw.pop(bad)


def stage_export(S, out):
    bpy.ops.wm.open_mainfile(filepath=os.path.join(out, 'set.blend'))
    sc = bpy.context.scene
    bake_setup(sc, 128)
    data = json.load(open(os.path.join(out, 'build.json')))
    for o in list(objects('prop')) + list(objects('dyn')):
        if o.type == 'CURVE':
            geo.realize(o)
    live = [o for o in objects('prop') + objects('dyn') if o.type == 'MESH' and not o.get('proto')]
    for o in live:
        o.hide_render = False
    bake_ao(sc, live)
    anchors = [o for o in bpy.data.objects if o.type == 'EMPTY' and o.get('anchor')]
    exported = [bpy.data.objects['set_all']] + live + anchors
    gltf(os.path.join(out, 'scene.glb'), exported)
    write_scene_json(S, sc, data, out)
    print('EXPORTED', len(exported), 'objects')


def live_lights(bounds):
    """Every light Blender rendered with, as a three.js DirectionalLight for
    the pieces lit live (figures, props, dyn): direction, colour and the
    irradiance it delivers at the middle of the scene, converted from Blender
    watts the way the glTF exporter's compatible mode does. An area light is a
    Lambertian emitter (E = P / (pi d^2)); a point or spot light radiates
    P / (4 pi) per steradian. The plinth kicker is left out: it exists for the
    base, which is baked.

    Live lights cast no shadows, so each is weighted by how much of the scene
    can see it: rays from a grid over the floor, at figure height, to the
    light. A fill behind a wall lights the wall's far side in Cycles, not the
    room; on the page it would tint everything."""
    (x0, y0, z0), (x1, y1, z1) = bounds
    target = Vector(((x0 + x1) / 2, (y0 + y1) / 2, max(0.0, z0) + 0.8))
    dg = bpy.context.evaluated_depsgraph_get()
    sc = bpy.context.scene
    grid = [Vector((x0 + (x1 - x0) * (0.15 + 0.7 * i / 4), y0 + (y1 - y0) * (0.15 + 0.7 * j / 4), z))
            for i in range(5) for j in range(5) for z in (0.35, 0.9)]

    def seen(pos):
        free = 0
        for p in grid:
            ray = pos - p
            hit, *_ = sc.ray_cast(dg, p, ray.normalized(), distance=ray.length - 0.05)
            free += not hit
        return free / len(grid)

    out = []
    for o in bpy.data.objects:
        if o.type != 'LIGHT' or o.hide_render or o.name == 'kicker':
            continue
        L = o.data
        d = Vector(o.matrix_world.to_3x3() @ Vector((0, 0, -1))).normalized()
        dist = max(0.5, (o.matrix_world.translation - target).length)
        if L.type == 'SUN':
            e = L.energy
        elif L.type == 'AREA':
            e = L.energy / (math.pi * dist ** 2)
        else:
            e = L.energy / (4 * math.pi * dist ** 2)
            d = (target - o.matrix_world.translation).normalized()
        vis = seen(o.matrix_world.translation)
        if vis < 0.05:
            continue
        e *= vis
        out.append({'name': o.name, 'dir': [round(c, 4) for c in C.y_up(d)], 'seen': round(vis, 2),
                    'color': '#' + ''.join(f'{round(max(0, min(1, c)) ** (1 / 2.2) * 255):02x}' for c in L.color),
                    'power': round(e, 3)})
    out.sort(key=lambda l: -l['power'])
    return out


def write_scene_json(S, sc, data, out):
    key = bpy.data.objects.get('key')
    d = Vector(key.matrix_world.to_3x3() @ Vector((0, 0, -1))).normalized() if key else Vector((0, 0, -1))
    v = S.META['view']
    lights = live_lights(data['bounds'])
    meta = {
        'id': S.META['id'],
        'label': S.META['label'],
        'units': 'm', 'up': 'y',
        'lightScale': LIGHT_SCALE,
        'lightmap': 'lightmap.webp',
        # Colour atlas for the set's 'baked' material (on the lightmap's UVs).
        'albedo': 'albedo.webp' if data.get('albedo') else None,
        'env': {'file': 'env.webp', 'scale': ENV_SCALE},
        # The key light, for everything lit live: direction it travels, colour,
        # strength (tuned per scene so live pieces sit in the baked light).
        'key': {'dir': C.y_up(d), 'color': '#' + ''.join(f'{round(c ** (1 / 2.2) * 255):02x}' for c in key.data.color) if key else '#ffffff',
                'power': S.META.get('key_power', 2.2)},
        # All of them, strongest first (the page lights live pieces with up to three).
        'lights': lights,
        # Framing: the page fits `bounds` for its own aspect with the same maths
        # as the posters (fit() here, camera-rig.js there).
        'view': {'dir': C.y_up(view_dir(S)), 'fov': v['fov'], 'margin': v.get('margin', 1.06),
                 'bounds': [C.y_up(data['bounds'][0]), C.y_up(data['bounds'][1])],
                 'hull': [C.y_up(p) for p in data.get('hull', [])]},
        'post': S.META.get('post', {}),
        'plinth': data.get('plinth', {}),
        # The floor plan figures walk on, and the footprints of what moves.
        'nav': data.get('nav'),
        'footprints': data.get('footprints', {}),
        'anchors': {k: C.y_up(p) for k, p in data.get('anchors', {}).items()},
        'paths': {k: [C.y_up((x, y, 0.0)) for x, y in pts] for k, pts in data.get('paths', {}).items()},
        # Floor polygons the analytics use (zones), named spots people go to
        # (with the way they face there, degrees as in the cast), and cameras
        # (the store's own: position, what they look at, field of view).
        'zones': {k: [C.y_up((x, y, 0.0)) for x, y in pts] for k, pts in data.get('zones', {}).items()},
        'spots': {k: {'at': C.y_up((v['at'][0], v['at'][1], 0.0)), 'face': v.get('face', 0.0), **{a: b for a, b in v.items() if a not in ('at', 'face')}}
                  for k, v in data.get('spots', {}).items()},
        'cameras': {k: {**v, 'pos': C.y_up(v['pos']), 'look': C.y_up(v['look'])} for k, v in data.get('cameras', {}).items()},
        # The set's materials as the page builds them (tiled era), the tall
        # pieces that hide people from a camera, and the places people come and go.
        'materials': data.get('materials', {}),
        'occluders': data.get('occluders', []),
        'portals': {k: {**v, 'at': C.y_up((v['at'][0], v['at'][1], 0.0))} for k, v in data.get('portals', {}).items()},
        'lines': {k: [C.y_up((x, y, 0.0)) for x, y in pts] for k, pts in data.get('lines', {}).items()},
        'cast': [{**{k: v for k, v in m.items() if k not in ('at', 'face')},
                  **({'at': C.y_up((m['at'][0], m['at'][1], 0.0)), 'face': m.get('face', 0.0)} if 'at' in m else {})}
                 for m in data.get('cast', [])],
    }
    C.write_json(os.path.join(out, 'scene.json'), meta)


def camera_for(S, sc, aspect, bounds, hull=None):
    v = S.META['view']
    tgt, dist = fit(bounds, view_dir(S), v['fov'], aspect, v.get('margin', 1.06), hull)
    return C.camera(sc, tuple(tgt + Vector(view_dir(S)).normalized() * dist), tuple(tgt), fov_deg=v['fov'])


def stage_still(S, out, samples, only=None):
    sc, data, key = assemble(S, figures=True)
    built = json.load(open(os.path.join(out, 'build.json')))
    bounds, hull = built['bounds'], built.get('hull')
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    for name, (w, h) in ASPECTS.items():
        if only and name != only:
            continue
        sc.render.resolution_x, sc.render.resolution_y = w, h
        sc.camera = camera_for(S, sc, w / h, bounds, hull)
        sc.render.filepath = os.path.join(out, f'still-{name}.png')
        bpy.ops.render.render(write_still=True)
        print('RENDERED still', name, w, h)


def stage_draft(S, out, samples, res=(1600, 900)):
    """A quick Cycles render of the assembled scene, cast and all, straight
    from the scene script: no bake, few samples, for judging layout, scale and
    composition while building. Also prints the nav grid, as text."""
    sc, data, key = assemble(S, figures=True)
    bounds = scene_bounds()
    hull = scene_hull()
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.camera = camera_for(S, sc, res[0] / res[1], bounds, hull)
    sc.render.filepath = os.path.join(out, 'draft.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED draft')


def stage_look(S, out, samples):
    """QA: the set drawn the way the page draws it (base colour x lightmap,
    no shading of its own), everything else rendered as usual. Against the
    still, it shows what the bake loses (specular, reflections) before any
    runtime question comes up."""
    bpy.ops.wm.open_mainfile(filepath=os.path.join(out, 'set.blend'))
    sc = bpy.context.scene
    built = json.load(open(os.path.join(out, 'build.json')))
    bounds, hull = built['bounds'], built.get('hull')
    s = bpy.data.objects['set_all']
    s.data.uv_layers.active = s.data.uv_layers['bake']
    img = bpy.data.images.load(os.path.join(out, 'lightmap.png'))
    img.colorspace_settings.name = 'sRGB'  # stored sRGB-encoded, like the page reads it
    for i, m in enumerate(s.data.materials):
        if m is None:
            continue
        bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf is None or bsdf.inputs['Metallic'].default_value > 0.5 or bsdf.inputs['Alpha'].default_value < 1:
            continue
        m = m.copy()
        s.data.materials[i] = m
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        out_node = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
        uv = nt.nodes.new('ShaderNodeUVMap')
        uv.uv_map = 'bake'
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        tex.interpolation = 'Linear'
        nt.links.new(uv.outputs['UV'], tex.inputs['Vector'])
        mul = nt.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        base = bsdf.inputs['Base Color']
        if m.get('baked') and os.path.exists(os.path.join(out, 'albedo.png')):
            # The merged set material: its colour is the atlas.
            at = nt.nodes.new('ShaderNodeTexImage')
            at.image = bpy.data.images.load(os.path.join(out, 'albedo.png'))
            at.image.colorspace_settings.name = 'sRGB'
            nt.links.new(uv.outputs['UV'], at.inputs['Vector'])
            nt.links.new(at.outputs['Color'], mul.inputs['A'])
        elif base.is_linked:
            nt.links.new(base.links[0].from_socket, mul.inputs['A'])
        else:
            mul.inputs['A'].default_value = base.default_value
        nt.links.new(tex.outputs['Color'], mul.inputs['B'])
        em = nt.nodes.new('ShaderNodeEmission')
        em.inputs['Strength'].default_value = LIGHT_SCALE
        nt.links.new(mul.outputs['Result'], em.inputs['Color'])
        nt.links.new(em.outputs['Emission'], out_node.inputs['Surface'])
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    w, h = ASPECTS['16x9']
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.camera = camera_for(S, sc, w / h, bounds, hull)
    sc.render.filepath = os.path.join(out, 'look-16x9.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED look')


if __name__ == '__main__':
    a = C.argv()
    sid = str(a['scene'])
    stage = str(a.get('stage', 'light'))
    S = load(sid)
    out = C.out_dir(sid)
    samples = int(a.get('samples', 256))
    if stage == 'light':
        stage_light(S, out, samples, int(a.get('size', S.META.get('lightmap', 2048))))
    elif stage == 'env':
        stage_env(S, out, samples)
    elif stage == 'export':
        stage_export(S, out)
    elif stage == 'nav':
        stage_nav(S, out)
    elif stage == 'still':
        stage_still(S, out, samples, a.get('only'))
    elif stage == 'look':
        stage_look(S, out, samples)
    elif stage == 'draft':
        stage_draft(S, out, samples)
    else:
        raise SystemExit(f'unknown stage {stage}')
