"""
A piece of the collection as a live scene: the adapter that lets
scripts/blender/bake_scene.py light, bake and export a jar the way it does a
diorama, so the page draws it with the dioramas' engine (src/three/).

  blender ... bake_scene.py -- --scene piece:<id> --stage light|env|export

Output goes to build/pieces/<id>/live/; scripts/build-pieces.mjs (stage
`live`) turns it into public/pieces/<id>/live/.

The bake stages read three things from a scene module, and this supplies them
for a piece:

  META      the poster's own camera as a fixed view, a black world (the page
            colour goes in afterwards, as it does for the loops), no plinth
            kicker, and the page's post settings for a piece
  build()   the jar and the piece in it (pieces/_kit.py, pieces/<id>.py),
            posed at t = 0, each object given the role the bake reads:
              set    base, pad, tag and string: Cycles light on a colour atlas
              prop   the brass rim and trim: lit live
              glass  the jar: left out of every bake, drawn by the page
              dyn    the turntable and all it carries: lit live, its colour,
                     roughness, metalness and occlusion baked into an atlas
  lights()  nothing more: the kit's lights come with the jar

and what only a piece has: the spots (empties the page hangs its numbered
dots on), animate() sampled into keyframes the page plays as a glTF clip, what
animate() changes on its materials (a glow's strength and colour, a ring's
opacity) sampled with it as tracks the page sets frame by frame, the lights
the glass reflects, and the model's atlas. A piece module can add its own:
live(st) changes the scene for the export (a stand-in for a shader the page
draws its own way; an object it marks `hooked` is left out of the clip and of
the join, for src/three/pieces/<id>.js to move; one it marks `apart` travels
over the rest, which the model's occlusion leaves it out of: model_atlas),
page(st) what scene.json's
piece tells the page about it, LIVE['model_uv_scale'] its share of the atlas
and LIVE['clip_frames'] how finely its motion is sampled (the render's 144
for a drop that falls six times a loop: a key a frame, so no part is ever
drawn between the bottom of one fall and the top of the next).
"""

from __future__ import annotations

import importlib
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Vector

import common as C
from kit import geo
from pieces import _kit as K

PAD_R = 0.76            # the pad as drawn live: just past the end of its fade (0.72)
ENV_AT = (0.0, 0.0, K.BASE_H + 0.45)   # where the panoramas are taken: inside the jar
FRAME_H = 1.92          # the kit camera's frame height (K.camera)
LOOP_SECS = 6.0         # one loop of animate(): the render's 144 frames at 24 fps
CLIP_FRAMES = 48        # ...sampled this many times for the clip
AO_DISTANCE = 0.04      # the model is small: occlusion reaches 4 cm


def out_dir(pid: str) -> str:
    d = os.path.join(C.ROOT, 'build', 'pieces', pid, 'live')
    os.makedirs(d, exist_ok=True)
    return d


# ---------------------------------------------------------------- the adapter

class Piece:
    """What bake_scene.py's stages read from a scene module, for one piece."""

    def __init__(self, pid: str):
        self.mod = importlib.import_module(f'pieces.{pid}')
        M = self.mod.META
        # The kit's camera (K.camera's defaults), as a fixed view: the page
        # frames the jar exactly as the poster does, not by fitting its bounds.
        pitch, fov, target = 20.0, 21.0, (0.0, 0.0, 0.50)
        dist = (FRAME_H / 2) / math.tan(math.radians(fov) / 2)
        tag = [t for t in M.get('tag', ())[:2] if t]
        self.META = {
            'id': pid,
            'label': ' '.join(tag).title() if tag else pid,
            'world': ('#000000', 0.0),
            'kicker': False,
            'view': {'yaw': 0.0, 'pitch': pitch, 'fov': fov, 'margin': 1.0, 'target': target, 'distance': dist},
            # The set's light and colour: the base is the only large surface,
            # and the pad needs little detail (its islands shrink before packing).
            'lightmap': 1024,
            'atlas': 1024,
            'uv_scale': {'jar_pad': 0.3},
            # The model's own atlas: baked at 2048, the page picks a size.
            'model_atlas': 2048,
            # The disc is one flat colour, mostly under whatever stands on it;
            # a piece can ask for more or less of the atlas for its own
            # materials (its LIVE['model_uv_scale']).
            'model_uv_scale': {'disc': 0.25, **getattr(self.mod, 'LIVE', {}).get('model_uv_scale', {})},
            'env_at': ENV_AT,
            # Live lights aim at the model, not at a room's figure height.
            'light_target': (0.0, 0.0, K.FLOOR + 0.25),
            # As the loops: no tilt-shift, no vignette, no lift, and the page
            # colour as a floor under every pixel (bake on black, then lighten).
            'post': {'blur': False, 'vignette': 0, 'sat': 1.0, 'backdrop': '#000000', 'floor': K.PAGE},
            'piece': True,
        }

    def build(self, col):
        sc = bpy.context.scene
        M = self.mod.META
        st = K.build(sc, tuple(M.get('tag', ('', ''))), M.get('accent'), M.get('disc', '#1c2622'))
        st['state'] = self.mod.build(st['piece'])
        K.mount(st)
        bpy.context.view_layer.update()
        _drop_hidden(st['turntable'])
        if hasattr(self.mod, 'live'):
            # The piece's own changes for a live scene (a shader effect the
            # page draws its own way, left as a stand-in).
            self.mod.live(st)
        _roles(st)
        _sheen()
        _trim_pad()
        _trim_base()
        spots = _spots(st, self.mod)
        clip, tracks = _keyframes(st, self.mod)
        # Glows the glTF exporter cannot read (an emission shader mixed with
        # a transparent one) leave as the Principled glows it can.
        _principled_glows(st['turntable'])
        bpy.context.view_layer.update()
        # What the page needs for the piece's own effects (its dust), as
        # scene.json's piece says it.
        own = self.mod.page(st) if hasattr(self.mod, 'page') else {}
        return {'piece_spots': spots, 'clip': clip, 'tracks': tracks, 'piece_page': own}

    def lights(self, sc):
        return None


def load(pid: str) -> Piece:
    return Piece(pid)


# ---------------------------------------------------------------- build helpers

def under(o, root) -> bool:
    p = o.parent
    while p is not None:
        if p == root:
            return True
        p = p.parent
    return False


def _drop_hidden(tt):
    """Parts a piece hides (a borrowed model's other options) are removed: the
    export draws everything it is handed."""
    gone = [o for o in bpy.data.objects if o.hide_render and (under(o, tt) or o.type == 'MESH')]
    for o in list(gone):
        for c in o.children_recursive:
            if c not in gone:
                gone.append(c)
    for o in gone:
        bpy.data.objects.remove(o, do_unlink=True)


def _roles(st):
    tt = st['turntable']
    for o in bpy.data.objects:
        if o.type not in ('MESH', 'CURVE', 'FONT'):
            continue
        if under(o, tt):
            o['role'] = 'dyn'
        elif o.name == 'jar_glass':
            o['role'] = 'glass'
        elif o.name in ('jar_rim', 'jar_trim'):
            o['role'] = 'prop'
        else:
            o['role'] = 'set'


def _sheen():
    """The walnut's lacquer catches the room's lights in the render; the
    light bake is diffuse only, so the page adds that gloss itself, from its
    roughness and F0 (bake_scene.py carries them to the page per vertex)."""
    base = bpy.data.objects.get('jar_base')
    mat = bpy.data.materials.get('jar_walnut')
    b = mat.node_tree.nodes.get('Principled BSDF') if mat and mat.use_nodes else None
    if base is None or b is None:
        return
    ior = b.inputs['IOR'].default_value
    # Principled's level: 0.5 leaves F0 as the index gives it, 1 doubles it.
    level = b.inputs['Specular IOR Level'].default_value if 'Specular IOR Level' in b.inputs else 0.5
    f0 = ((ior - 1) / (ior + 1)) ** 2 * 2 * level
    base['sheen'] = (round(b.inputs['Roughness'].default_value, 3), round(f0, 4))


def _trim_pad():
    """The pad is 1.7 m across so no render ever shows its edge. Live, only
    what the page can see is kept: its fade ends at 0.72 m, so its top is cut
    at PAD_R, and its edge and underside go. (Kept, the 4 mm edge took UV
    islands under a texel wide, coloured by whatever island lay beside them
    in the atlas: a red or beige dash on the black pad. Black there in the
    render, as the floor shows it.)"""
    pad = bpy.data.objects.get('jar_pad')
    if not pad:
        return
    for v in pad.data.vertices:
        r = math.hypot(v.co.x, v.co.y)
        if r > PAD_R:
            v.co.x *= PAD_R / r
            v.co.y *= PAD_R / r
    nm = pad.matrix_world.to_3x3().inverted_safe().transposed()
    bm = bmesh.new()
    bm.from_mesh(pad.data)
    bm.normal_update()
    kill = [f for f in bm.faces if (nm @ f.normal).normalized().z < 0.5]
    if kill:
        bmesh.ops.delete(bm, geom=kill, context='FACES')
        bm.to_mesh(pad.data)
    bm.free()
    pad.data.update()


def _trim_base(inner=0.38):
    """The base's top is one disc, and the turntable covers all of it inside
    0.392 m: nobody sees that part, yet it took a third of the light and
    colour atlases. Live, the top is a ring from just under the disc's edge
    outward, built on the top's own outer vertices."""
    o = bpy.data.objects.get('jar_base')
    if not o:
        return
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.normal_update()
    top = [f for f in bm.faces if f.normal.z > 0.999 and abs(f.calc_center_median().z - K.BASE_H) < 1e-4]
    edge = max(math.hypot(v.co.x, v.co.y) for f in top for v in f.verts)
    ring = sorted({v for f in top for v in f.verts if math.hypot(v.co.x, v.co.y) > edge - 1e-4},
                  key=lambda v: math.atan2(v.co.y, v.co.x))
    bmesh.ops.delete(bm, geom=top, context='FACES')
    k = inner / edge
    hole = [bm.verts.new((v.co.x * k, v.co.y * k, v.co.z)) for v in ring]
    n = len(ring)
    for i in range(n):
        f = bm.faces.new((ring[i], ring[(i + 1) % n], hole[(i + 1) % n], hole[i]))
        f.smooth = False
    bm.normal_update()
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()


def box(name):
    """World-space bounds of an object: (low corner, high corner, centre)."""
    o = bpy.data.objects[name]
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi, (lo + hi) / 2


def below(name):
    """The names of everything that draws under an object (its descendants)."""
    o = bpy.data.objects.get(name)
    if o is None:
        return []
    return [c.name for c in o.children_recursive if c.type in ('MESH', 'CURVE', 'FONT')]


PART_SCALE = 8  # a part's number n is kept as n / 8: exact through the 12-bit quantization


def part_attr(objs):
    """Every vertex of each mesh carries its part's number (_spots: 0 for
    none) in an attribute the glTF export keeps (its name starts with an
    underscore), so after a join the page can still tell which part a tap
    hit: '_part', n / PART_SCALE."""
    for o in objs:
        if o.type != 'MESH':
            continue
        me = o.data
        a = me.attributes.get('_part') or me.attributes.new('_part', 'FLOAT', 'POINT')
        a.data.foreach_set('value', [o.get('part', 0) / PART_SCALE] * len(a.data))


def facing(at, up=0.6):
    """Outward from the turntable's axis and a little up: a part's dot shows
    while that side of the model faces the camera."""
    r = Vector((at.x, at.y, 0.0))
    if r.length < 0.06:
        return Vector((0.0, 0.0, 1.0))
    return (r.normalized() * (1 - up) + Vector((0.0, 0.0, up))).normalized()


def reparent(child, parent):
    """A new parent, the same place in the world."""
    bpy.context.view_layer.update()
    mw = child.matrix_world.copy()
    child.parent = parent
    child.matrix_parent_inverse.identity()
    bpy.context.view_layer.update()
    child.matrix_world = mw


def _spots(st, mod):
    """An empty per spot (pieces/<id>.py spots()): `anchor` names it for the
    page, `out` is the way it faces (three.js axes). A spot on the model turns
    with the turntable; one on the jar (the tag) stays put. The objects a
    spot names as its `parts` are numbered with it (`part`, from 1, in the
    order given; part_attr() carries the number into their vertices)."""
    if not hasattr(mod, 'spots'):
        return {}
    tt = st['turntable']
    out = {}
    bpy.context.view_layer.update()
    for i, s in enumerate(mod.spots(st), 1):
        for n in s.get('parts', ()):
            o = bpy.data.objects.get(n)
            if o is not None:
                o['part'] = i
        at = Vector(s['at'])
        e = C.empty(f'spot_{s["id"]}', st['jar'], loc=tuple(at), size=0.02)
        e['anchor'] = s['id']
        face = Vector(s['out']) if s.get('out') is not None else facing(at)
        way = C.y_up(face.normalized())
        e['out'] = way
        on = s.get('on', 'model')
        if on == 'model':
            reparent(e, tt)
        out[s['id']] = {'at': C.y_up(at), 'out': way, 'on': on, 'part': i}
    return out


def _from_light_path(sock, depth=4):
    """Whether a Light Path node drives this socket (through a few nodes)."""
    for link in sock.links:
        f = link.from_node
        if f.type == 'LIGHT_PATH':
            return True
        if depth and any(_from_light_path(i, depth - 1) for i in f.inputs if i.is_linked):
            return True
    return False


def _unwrap(n):
    """Past any ray switch a piece put round a surface (a Mix that a Light
    Path drives, Transparent on one side: NeerNaadi keeps its glows out of
    reflections so), to the shader it switches. Cycles needs the switch; the
    page has no rays to switch on."""
    while n is not None and n.type == 'MIX_SHADER' and n.inputs[0].is_linked and _from_light_path(n.inputs[0]):
        a = n.inputs[1].links[0].from_node if n.inputs[1].is_linked else None
        b = n.inputs[2].links[0].from_node if n.inputs[2].is_linked else None
        if b is not None and b.type == 'BSDF_TRANSPARENT':
            n = a
        elif a is not None and a.type == 'BSDF_TRANSPARENT':
            n = b
        else:
            break
    return n


def _strip_switch(m):
    """The material's surface straight from the shader its ray switch wraps."""
    nt = m.node_tree if m and m.use_nodes else None
    if nt is None:
        return
    s = _output(m).inputs['Surface']
    if not s.is_linked:
        return
    n = s.links[0].from_node
    inner = _unwrap(n)
    if inner is not None and inner is not n:
        nt.links.new(inner.outputs[0], s)


def _glow_nodes(m):
    """An emission-shader glow (_parts.soft_glow): the Emission node and, if
    it is mixed with a Transparent one, the Mix (its factor is the opacity).
    (None, None) for anything else."""
    nt = m.node_tree if m and m.use_nodes else None
    if nt is None or _bsdf(m) is not None:
        return None, None
    s = _output(m).inputs['Surface']
    if not s.is_linked:
        return None, None
    n = _unwrap(s.links[0].from_node)
    if n is None:
        return None, None
    if n.type == 'EMISSION':
        return n, None
    if n.type == 'MIX_SHADER':
        em = next((l.from_node for l in n.inputs[2].links if l.from_node.type == 'EMISSION'), None)
        tr = next((l.from_node for l in n.inputs[1].links if l.from_node.type == 'BSDF_TRANSPARENT'), None)
        if em is not None and tr is not None and not n.inputs[0].is_linked:
            return em, n
    return None, None


def _values(m):
    """What animate() may change on a material between frames, as the page
    can set it (three.js names): emission strength and colour, opacity and
    base colour, each where no link drives it. Colours are linear."""
    out = {}
    b = _bsdf(m)
    if b is not None:
        for key, name in (('emissive', 'Emission Strength'), ('emissiveColor', 'Emission Color'), ('opacity', 'Alpha'), ('color', 'Base Color')):
            s = b.inputs.get(name)
            if s is not None and not s.is_linked:
                v = s.default_value
                out[key] = float(v) if isinstance(v, float) else tuple(v)[:3]
        return out
    em, mix = _glow_nodes(m)
    if em is not None:
        if not em.inputs['Strength'].is_linked:
            out['emissive'] = float(em.inputs['Strength'].default_value)
        if not em.inputs['Color'].is_linked:
            out['emissiveColor'] = tuple(em.inputs['Color'].default_value)[:3]
        out['opacity'] = float(mix.inputs[0].default_value) if mix is not None else 1.0
    return out


def _round(v):
    return round(v, 4) if isinstance(v, float) else [round(c, 4) for c in v]


def _differ(a, b):
    if isinstance(a, float):
        return abs(a - b) > 1e-4
    return any(abs(x - y) > 1e-4 for x, y in zip(a, b))


def _keyframes(st, mod):
    """animate(t) sampled n times through one loop (LIVE['clip_frames'],
    CLIP_FRAMES unless the piece asks for more), keyed on every object it
    moves, so the page can play it as a glTF clip. The last key is t = 1
    itself (not 0 again), so a turning part keeps turning the same way into
    the seam. With it, what animate() changes on the materials of what the
    turntable carries, sampled at the same keys: (clip, tracks).

    tracks: {'frames': n + 1, 'materials': {name: {channel: [a value per
    key]}}}, for the channels that change (emissive, opacity: numbers;
    emissiveColor, color: linear RGB). A glow that changes strength carries
    its colour too, if only as one value: at t = 0 it may be dark, and the
    glTF would keep no colour for it. Each tracked material leaves as itself
    (keeps_own), never in the atlas."""
    if not hasattr(mod, 'animate'):
        return None, None
    tt = st['turntable']
    objs = [o for o in bpy.data.objects if under(o, tt) and not o.get('hooked')]
    n = int(getattr(mod, 'LIVE', {}).get('clip_frames', CLIP_FRAMES))
    mats = {m for o in bpy.data.objects if under(o, tt) and o.type == 'MESH' for m in o.data.materials if m is not None}
    seen = []

    def pose(t):
        mod.animate(t, st['state'])
        seen.append({m.name: _values(m) for m in mats})
        return {o.name: (tuple(o.location), tuple(o.rotation_euler), tuple(o.scale)) for o in objs}

    frames = [pose(i / n) for i in range(n + 1)]
    tracks = {}
    for name, v0 in seen[0].items():
        chans = {}
        for k, v in v0.items():
            if any(_differ(v, f[name][k]) for f in seen[1:]):
                chans[k] = [_round(f[name][k]) for f in seen]
        if 'emissive' in chans and 'emissiveColor' not in chans and 'emissiveColor' in v0:
            chans['emissiveColor'] = _round(v0['emissiveColor'])
        if chans:
            tracks[name] = chans
            bpy.data.materials[name]['tracked'] = 1
    if tracks:
        print('TRACKED', len(tracks), 'materials:', ', '.join(f'{k} ({"/".join(v)})' for k, v in sorted(tracks.items())))
    first = frames[0]
    moving = sorted({k for f in frames for k, v in f.items()
                     if any(abs(a - b) > 1e-6 for x, y in zip(v, first[k]) for a, b in zip(x, y))})
    sc = bpy.context.scene
    sc.render.fps = round(n / LOOP_SECS)
    sc.render.fps_base = 1.0
    sc.frame_start, sc.frame_end = 0, n
    try:
        bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
    except Exception:
        pass
    for name in moving:
        o = bpy.data.objects[name]
        for i, f in enumerate(frames):
            o.location, o.rotation_euler, o.scale = f[name]
            for path in ('location', 'rotation_euler', 'scale'):
                o.keyframe_insert(path, frame=i)
    mod.animate(0.0, st['state'])
    sc.frame_set(0)
    print('KEYED', len(moving), 'objects over', n, 'frames')
    clip = {'frames': n, 'seconds': LOOP_SECS, 'objects': moving} if moving else None
    return clip, ({'frames': n + 1, 'materials': tracks} if tracks else None)


def _principled_glows(tt):
    """Every emission-shader glow on the turntable (_parts.soft_glow: a beam,
    a ring of light, a ripple) rebuilt as the Principled glow the glTF
    exporter reads: black, rough, no specular, the same emission, and the
    Mix's factor as its alpha (blended, so the page draws it see-through).
    Its name stays, so its tracks still find it."""
    done = set()
    for o in bpy.data.objects:
        if not under(o, tt) or o.type != 'MESH':
            continue
        for m in o.data.materials:
            if m is None or m in done:
                continue
            done.add(m)
            # (A Principled glow inside a ray switch, too: the glTF exporter
            # reads the Principled only when it feeds the output itself.)
            _strip_switch(m)
            em, mix = _glow_nodes(m)
            if em is None:
                continue
            colour = tuple(em.inputs['Color'].default_value)
            strength = float(em.inputs['Strength'].default_value)
            alpha = float(mix.inputs[0].default_value) if mix is not None else 1.0
            nt = m.node_tree
            for n in list(nt.nodes):
                nt.nodes.remove(n)
            out = nt.nodes.new('ShaderNodeOutputMaterial')
            b = nt.nodes.new('ShaderNodeBsdfPrincipled')
            b.inputs['Base Color'].default_value = (0, 0, 0, 1)
            b.inputs['Roughness'].default_value = 1.0
            if 'Specular IOR Level' in b.inputs:
                b.inputs['Specular IOR Level'].default_value = 0.0
            b.inputs['Emission Color'].default_value = colour
            b.inputs['Emission Strength'].default_value = strength
            b.inputs['Alpha'].default_value = alpha
            nt.links.new(b.outputs[0], out.inputs['Surface'])
            if alpha < 1 or m.get('tracked'):
                try:
                    m.surface_render_method = 'BLENDED'
                except Exception:
                    m.blend_method = 'BLEND'
            m['glow'] = 1


# ---------------------------------------------------------------- light, for the page

def _hex(rgb):
    return '#' + ''.join(f'{round(max(0, min(1, v)) ** (1 / 2.2) * 255):02x}' for v in rgb)


def live_lights(target):
    """bake_scene.live_lights() for a piece: every light that lights (not the
    strips that exist only as reflections on the glass), as the direction it
    travels to the model, its colour and the irradiance it delivers there,
    strongest first. No test of what can see it: the glass passes light in
    Cycles, but it would stop every test ray here."""
    t = Vector(target)
    out = []
    for o in bpy.data.objects:
        if o.type != 'LIGHT' or o.hide_render or getattr(o, 'visible_diffuse', True) is False:
            continue
        L = o.data
        pos = o.matrix_world.translation
        dist = max(0.5, (pos - t).length)
        if L.type == 'SUN':
            e = L.energy
            d = (o.matrix_world.to_3x3() @ Vector((0, 0, -1))).normalized()
        else:
            e = L.energy / ((math.pi if L.type == 'AREA' else 4 * math.pi) * dist ** 2)
            d = (t - pos).normalized()
        light = {'name': o.name, 'dir': [round(c, 4) for c in C.y_up(d)], 'pos': C.y_up(pos), 'seen': 1.0,
                 'color': _hex(L.color), 'power': round(e, 3)}
        if L.type == 'SPOT':
            light['cone'] = round(math.degrees(L.spot_size), 2)
            light['blend'] = round(L.spot_blend, 3)
        if getattr(o, 'visible_glossy', True) is False:
            # Lights, and is never seen in a reflection (the fill).
            light['glossy'] = False
        out.append(light)
    out.sort(key=lambda l: -l['power'])
    return out


def glass_lights(center=ENV_AT):
    """The lights the glass reflects, as rectangles the page builds its
    reflection probe from (src/three/piece-glass.js): every area light glossy
    rays can see (the window, the edge strips and the rim), with the radiance
    a Lambertian emitter of that power and size has (L = P / (pi A)).
    Positions are relative to the probe, in three.js axes. `on`: the objects a
    linked light falls on and nothing else (_kit.lights(): the strips that
    draw the glass light the glassware alone, so the walnut never mirrors
    them; src/three/room-sheen.js)."""
    c = Vector(center)
    out = []
    for o in bpy.data.objects:
        if o.type != 'LIGHT' or o.data.type != 'AREA' or o.hide_render:
            continue
        if getattr(o, 'visible_glossy', True) is False:
            continue
        L = o.data
        w = L.size
        h = L.size_y if L.shape in ('RECTANGLE', 'ELLIPSE') else L.size
        m = o.matrix_world.to_3x3()
        x = (m @ Vector((1, 0, 0))).normalized()
        y = (m @ Vector((0, 1, 0))).normalized()
        light = {
            'name': o.name,
            'pos': C.y_up(o.matrix_world.translation - c),
            'x': C.y_up(x),
            'y': C.y_up(y),
            'size': [round(w, 4), round(h, 4)],
            'color': _hex(L.color),
            'radiance': round(L.energy / (math.pi * w * h), 3),
        }
        link = getattr(o, 'light_linking', None)
        receivers = link.receiver_collection if link else None
        if receivers is not None:
            light['on'] = sorted(r.name for r in receivers.all_objects)
        out.append(light)
    return out


def scene_json(S, data):
    """What scene.json says about a piece, over what every live scene says."""
    M = S.META
    v = M['view']
    lights = live_lights(M['light_target'])
    key = next((l for l in lights if l['name'] == 'spot'), lights[0] if lights else None)
    yaw, pitch = math.radians(v['yaw']), math.radians(v['pitch'])
    to_cam = (math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch))
    tt = bpy.data.objects['turntable']
    return {
        'key': {k: key[k] for k in ('dir', 'color', 'power')} if key else None,
        'lights': lights,
        # A fixed view: the kit camera's target, distance and field of view.
        # The page keeps the frame's height (FRAME_H) and widens it for a
        # narrow canvas, so the jar is never cut.
        'view': {'dir': C.y_up(to_cam), 'fov': v['fov'], 'margin': 1.0,
                 'target': C.y_up(v['target']), 'distance': round(v['distance'], 4), 'frame': FRAME_H,
                 'bounds': [C.y_up(data['bounds'][0]), C.y_up(data['bounds'][1])], 'hull': []},
        'piece': {
            'id': M['id'],
            'turntable': tt.name,
            'glass': 'jar_glass',
            # The turntable's room: what the shadow map covers.
            'room': {'y': round(K.FLOOR, 4), 'r': K.DISC_R, 'h': K.ROOM_H},
            'clip': data.get('clip'),
            # What the clip moves on the materials (_keyframes).
            'tracks': data.get('tracks'),
            'spots': data.get('piece_spots', {}),
            'probe': {'at': C.y_up(ENV_AT), 'lights': glass_lights()},
            # (And the light of its faint glows, if it has any: model_atlas.)
            'model': {'color': 'model_color.webp', 'orm': 'model_orm.webp',
                      **({'emit': 'model_emit.webp'} if bpy.context.scene.get('model_emit') else {})},
            # The glass: thin walls of index 1.17. Its inner wall's faces point
            # outward, as the outer wall's do (the two are separate pieces of
            # the mesh, and Blender's recalculation turns each outward), so in
            # Cycles a ray enters glass twice on its way in, and the jar's
            # whole inside renders as solid glass of index 1.17^2: it magnifies
            # the model, and its far wall turns light back near the edges. The
            # page refracts the same way, against these dimensions (y up).
            'jar': {'y': K.BASE_H, 'r': K.R_IN, 'wall': K.WALL, 'h': K.H_WALL, 'apex': K.H_APEX},
            'ior': 1.17,
            # The set's first UVs carry its glossy surfaces' roughness and F0.
            'sheen': bool(data.get('sheen')),
            'floor': K.PAGE,
            **(data.get('piece_page') or {}),
        },
    }


# ---------------------------------------------------------------- the model's atlas

def _bsdf(m):
    return m and m.node_tree and next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)


def _is_emissive(m):
    b = _bsdf(m)
    return bool(b) and b.inputs['Emission Strength'].default_value >= 1.0


def _glows(m):
    """A Principled material that gives any light: its emission strength and
    its colour both above nothing, or either driven by a link."""
    b = _bsdf(m)
    if not b:
        return False
    s, c = b.inputs['Emission Strength'], b.inputs['Emission Color']
    return (s.is_linked or s.default_value > 0) and (c.is_linked or max(c.default_value[:3]) > 0)


def _is_clear(m):
    if m is None:
        return False
    b = _bsdf(m)
    return bool(b) and (b.inputs['Alpha'].is_linked or b.inputs['Alpha'].default_value < 1)


def keeps_own(m):
    """A material the atlas cannot carry: a glow of strength 1 and up (more
    than a colour; a fainter one goes into the atlas, its light in
    model_emit.png), anything see-through, or anything animate() changes (its
    tracks), or what a piece asks to keep (`own`: a part the page draws its
    own way). It is exported as itself."""
    return bool(m is not None and (m.get('tracked') or m.get('own'))) or _is_emissive(m) or _is_clear(m)


def _output(m):
    outs = [n for n in m.node_tree.nodes if n.type == 'OUTPUT_MATERIAL']
    return next((n for n in outs if n.is_active_output), outs[0])


def _unemit(m, was):
    """Put back what drove the material's surface before _emit."""
    nt = m.node_tree
    em = nt.nodes.get('_atlas_emit')
    if em is not None:
        nt.nodes.remove(em)
    if was is not None:
        nt.links.new(was, _output(m).inputs['Surface'])


def _emit(m, which):
    """Route one Principled input (its link or its value) into an Emission
    shader on the material's output: an EMIT bake then reads that input,
    procedural or not, metal or not. 'Emission Color' brings its strength
    with it, as the light the material gives; None routes black."""
    nt = m.node_tree
    out = _output(m)
    b = _bsdf(m)
    em = nt.nodes.get('_atlas_emit') or nt.nodes.new('ShaderNodeEmission')
    em.name = '_atlas_emit'
    for sock in (em.inputs['Color'], em.inputs['Strength']):
        for link in list(sock.links):
            nt.links.remove(link)
    em.inputs['Strength'].default_value = 1.0
    src = b.inputs[which] if b is not None and which else None
    if which is None:
        em.inputs['Color'].default_value = (0, 0, 0, 1)
    elif src is not None and src.is_linked:
        nt.links.new(src.links[0].from_socket, em.inputs['Color'])
    elif which in ('Base Color', 'Emission Color'):
        em.inputs['Color'].default_value = tuple(src.default_value)[:4] if src is not None else (0.5, 0.5, 0.5, 1)
    else:
        v = float(src.default_value) if src is not None else 0.5
        em.inputs['Color'].default_value = (v, v, v, 1)
    if which == 'Emission Color' and b is not None:
        s = b.inputs['Emission Strength']
        if s.is_linked:
            nt.links.new(s.links[0].from_socket, em.inputs['Strength'])
        else:
            em.inputs['Strength'].default_value = float(s.default_value)
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])


def _bake(objs, img, kind, samples, margin=8, clear=True):
    sc = bpy.context.scene
    sc.cycles.samples = samples
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
    bpy.ops.object.bake(type=kind, margin=margin, use_clear=clear, target='IMAGE_TEXTURES')
    for nt, n in added:
        nt.nodes.remove(n)


def _pixels(img):
    w, h = img.size
    buf = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(buf)
    return buf.reshape(h, w, 4)[::-1]


def _save(arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = arr[::-1]
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()


def _srgb(lin):
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)


def _realize(o):
    """geo.realize, keeping the parent (a curve the piece hung on the turntable)
    and the custom properties (a piece's `hangs`)."""
    parent = o.parent
    props = {k: o[k] for k in o.keys() if not k.startswith('_')}
    n = geo.realize(o)
    for k, v in props.items():
        n[k] = v
    if parent is not None:
        reparent(n, parent)
    return n


def _drop_undersides(o):
    """Faces within 10 degrees of straight down: the camera's lowest tilt
    (10 degrees above level) never sees one. More atlas for what is seen."""
    mw = o.matrix_world
    nm = mw.to_3x3().inverted_safe().transposed()
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.normal_update()
    kill = [f for f in bm.faces if (nm @ f.normal).normalized().z < -0.985]
    if kill:
        bmesh.ops.delete(bm, geom=kill, context='FACES')
        bm.to_mesh(o.data)
    bm.free()
    return len(kill)


def uv_scale(obj, factors):
    """Shrink the islands of some materials before packing (a large surface
    that needs little detail), so the rest gets more of the atlas. `obj` is
    in edit mode, its active UV map the one being packed."""
    names = [m.name if m else '' for m in obj.data.materials]

    def factor(n):
        return next((v for k, v in factors.items() if n == k or n.startswith(k + '.')), None)

    idx = {i: factor(n) for i, n in enumerate(names) if factor(n) is not None}
    if not idx:
        return
    bm = bmesh.from_edit_mesh(obj.data)
    uv = bm.loops.layers.uv.active
    for i, f in idx.items():
        faces = [p for p in bm.faces if p.material_index == i]
        if not faces:
            continue
        pts = [l[uv].uv.copy() for p in faces for l in p.loops]
        c = sum(pts, Vector((0, 0))) / len(pts)
        for p in faces:
            for l in p.loops:
                l[uv].uv = c + (l[uv].uv - c) * f
    bmesh.update_edit_mesh(obj.data)


def _one_uv(o, name='atlas'):
    """`o`'s UVs as one map, named as the atlas parts' map is, before a join.
    Blender joins UV maps by name, and the page reads the first: joined onto
    a part of its own first by name (a crate's LED, a lens's eye), the atlas
    parts would bring their UVs in as a second map and read zeros from the
    first, one texel for the whole part (Indoor Tracking's crate went black).
    A part of its own keeps its UVs, under the atlas's name."""
    me = o.data
    keep = me.uv_layers.get(name)
    if keep is None and len(me.uv_layers):
        keep = next((u for u in me.uv_layers if u.active_render), me.uv_layers[0])
        keep.name = name
    if keep is None:
        keep = me.uv_layers.new(name=name)
    for other in [u.name for u in me.uv_layers if u.name != name]:
        me.uv_layers.remove(me.uv_layers[other])
    me.uv_layers.active = me.uv_layers[name]
    me.uv_layers[name].active_render = True


def model_atlas(out, size=1024, scale=None, keep=None):
    """Everything the turntable carries, ready to draw live in few draw calls.
    Every part shares one UV atlas, and into it go the colour
    (model_color.png) and occlusion, roughness and metalness (model_orm.png,
    R G B as glTF packs them), and the light its faint glows give, if it has
    any (model_emit.png), each read from the Principled inputs by an EMIT
    bake, so procedural and photo materials survive the trip. The bake runs
    before any join, so each material reads its own UVs. Then the atlas
    materials become one 'atlas' material the page fills in (glows and
    see-through materials keep their own), and every part that does not move
    on its own is joined into one mesh, 'model'. Returns the objects to export
    under the turntable. `keep`: names that stay nodes of their own (what
    the piece's page() names: the page looks them up)."""
    sc = bpy.context.scene
    tt = bpy.data.objects['turntable']
    for o in [o for o in bpy.data.objects if under(o, tt) and o.type in ('CURVE', 'FONT')]:
        _realize(o)
    keyed = {o for o in bpy.data.objects if o.animation_data and o.animation_data.action}

    # Empties with nothing to carry (a borrowed model's own anchors and
    # groups) go first; the ones that move or name a spot stay.
    def idle(e):
        return e.type == 'EMPTY' and e not in keyed and not e.get('anchor') and all(idle(c) for c in e.children)

    def drop_idle():
        for e in [o for o in bpy.data.objects if under(o, tt) and idle(o)]:
            if e.name in bpy.data.objects:
                bpy.data.objects.remove(e, do_unlink=True)

    drop_idle()

    def moves(o):
        p = o
        while p is not None and p != tt:
            if p in keyed:
                return True
            p = p.parent
        return False

    plain = None
    dyn = [o for o in bpy.data.objects if under(o, tt) and o.type == 'MESH']
    for o in dyn:
        o.hide_render = False
        if o.data.users > 1:
            o.data = o.data.copy()
        C.apply_modifiers(o)
        if not o.data.materials:
            plain = plain or geo.pbr('plain', '#8a8a8a', rough=0.6)
            o.data.materials.append(plain)

    atlas_objs = [o for o in dyn if any(m is not None and not keeps_own(m) for m in o.data.materials)]
    culled = sum(_drop_undersides(o) for o in atlas_objs)

    # One atlas for all of them: unwrapped together, packed together, into a
    # UV map of its own (the materials keep rendering from theirs).
    for o in atlas_objs:
        me = o.data
        render_uv = next((u for u in me.uv_layers if u.active_render), None)
        uv = me.uv_layers.new(name='atlas')
        me.uv_layers.active = uv
        if render_uv is not None:
            render_uv.active_render = True
    C.select(atlas_objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    # Smart project sizes each object's islands in its own mesh units, and a
    # borrowed model is often scaled by a parent (the lander by 0.12): it
    # would take seventy times its share. Each object's islands are scaled by
    # its world scale, so a metre gets the same texels everywhere.
    for o in atlas_objs:
        k = sum(o.matrix_world.to_scale()) / 3
        if abs(k - 1) > 1e-4:
            bm = bmesh.from_edit_mesh(o.data)
            uv = bm.loops.layers.uv.active
            for f in bm.faces:
                for l in f.loops:
                    l[uv].uv *= k
            bmesh.update_edit_mesh(o.data)
    if scale:
        for o in atlas_objs:
            uv_scale(o, scale)
    bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Only the model in the bake: its occlusion is its own (the glass and the
    # base never touch it).
    shown = {o: o.hide_render for o in bpy.data.objects}
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.hide_render = o not in atlas_objs
    sc.world.light_settings.distance = AO_DISTANCE
    mats = {m for o in atlas_objs for m in o.data.materials if m is not None and not keeps_own(m)}
    was = {}
    for m in mats:
        s = _output(m).inputs['Surface']
        was[m] = s.links[0].from_socket if s.is_linked else None
    maps = {}
    for which, key in (('Base Color', 'color'), ('Roughness', 'rough'), ('Metallic', 'metal')):
        for m in mats:
            _emit(m, which)
        img = bpy.data.images.new(f'model_{key}', size, size, alpha=False, float_buffer=True)
        _bake(atlas_objs, img, 'EMIT', 4)
        maps[key] = _pixels(img)[..., :3]
    # And the light of a faint glow (under strength 1: keeps_own keeps the
    # stronger as themselves), its colour x strength, for the page's emissive
    # map. Without it each went into the colour map alone and drew unlit where
    # the render shows it lit: AthleteVision's watch hand, the dim panels of
    # ObserveX's screens, Indoor Tracking's raw fixes (black but for their
    # glow), the Earth's clouds over Mission Builder.
    glowing = sorted((m for m in mats if _glows(m)), key=lambda m: m.name)
    if glowing:
        # (These objects' faces in materials of their own bake black here: an
        # LED's light is its own, and must not bleed into the parts round it.)
        others = {m for o in atlas_objs for m in o.data.materials if m is not None and m not in mats}
        for m in others:
            s = _output(m).inputs['Surface']
            was[m] = s.links[0].from_socket if s.is_linked else None
        for m in mats | others:
            _emit(m, 'Emission Color' if m in glowing else None)
        img = bpy.data.images.new('model_emit', size, size, alpha=False, float_buffer=True)
        _bake(atlas_objs, img, 'EMIT', 4)
        maps['emit'] = _pixels(img)[..., :3]
    # A material another object shares (one exported as itself) must not
    # leave as an emission shader.
    for m, s in was.items():
        _unemit(m, s)
    img = bpy.data.images.new('model_ao', size, size, alpha=False, float_buffer=True)
    _bake(atlas_objs, img, 'AO', 96)
    maps['ao'] = _pixels(img)[..., :1]
    # A part that travels over the rest (one the piece's live() marks `apart`:
    # Indoor Tracking's crate, going round its plan) shut in what it stood on
    # at frame 0, and the page drew that ground dark (black where shut in:
    # stage.js shutIn) all through the loop, wherever the part had gone: two
    # black bars where the crate's straps had stood. The rest is baked again
    # without it, and the rest's texels read from that; the part's own read
    # from the first, the model round it as it stands at frame 0.
    def lineage(o):
        while o is not None:
            yield o
            o = o.parent

    away = [o for o in atlas_objs if any(p.get('apart') for p in lineage(o))]
    if away:
        rest = [o for o in atlas_objs if o not in away]
        for o in away:
            o.hide_render = True
        img = bpy.data.images.new('model_ao_rest', size, size, alpha=False, float_buffer=True)
        # Below zero wherever this bake writes nothing (no clear, no margin):
        # the travelling parts' texels and the gaps keep the first bake's.
        img.pixels.foreach_set(np.full(size * size * 4, -1.0, np.float32))
        _bake(rest, img, 'AO', 96, margin=0, clear=False)
        rest_ao = _pixels(img)[..., :1]
        maps['ao'] = np.where(rest_ao >= 0, rest_ao, maps['ao'])
        for o in away:
            o.hide_render = False
        kinds = {}
        for n in {p.name for o in away for p in lineage(o) if p.get('apart')}:
            k = n.rstrip('0123456789.') or n
            kinds[k] = kinds.get(k, 0) + 1
        print(f'BAKED occlusion without the {len(away)} parts that travel:', ', '.join(f'{k} x{c}' if c > 1 else k for k, c in sorted(kinds.items())))
    for o, h in shown.items():
        o.hide_render = h

    _save(_srgb(maps['color']), os.path.join(out, 'model_color.png'))
    orm = np.concatenate([maps['ao'], maps['rough'][..., :1], maps['metal'][..., :1]], axis=-1)
    _save(np.clip(orm, 0, 1), os.path.join(out, 'model_orm.png'))
    # The glows' map only where there are any (scene_json names it then).
    emit = os.path.join(out, 'model_emit.png')
    if 'emit' in maps:
        peak = float(maps['emit'].max())
        _save(_srgb(maps['emit']), emit)
        print('BAKED faint glows', ', '.join(m.name for m in glowing), f'(peak {peak:.3f}{", over 1: clipped" if peak > 1 else ""})')
    elif os.path.exists(emit):
        os.remove(emit)
    sc['model_emit'] = 'emit' in maps
    print('BAKED model atlas', size, 'objects', len(atlas_objs), 'undersides culled', culled)

    # One material for everything the atlas now carries.
    atlas = bpy.data.materials.new('atlas')
    atlas.use_nodes = True
    atlas['atlas'] = True
    for o in atlas_objs:
        me = o.data
        # (Not `keep`: that is the names the page looks up, read below. Named
        # so, this list took its place, and Mission Builder's dust sheets,
        # which nothing else keeps apart, were joined into one 'model_own'.)
        own_mats = []
        remap = {}
        for i, m in enumerate(me.materials):
            if m is not None and keeps_own(m):
                if m not in own_mats:
                    own_mats.append(m)
                remap[i] = 1 + own_mats.index(m)
            else:
                remap[i] = 0
        idx = [remap.get(p.material_index, 0) for p in me.polygons]
        me.materials.clear()
        me.materials.append(atlas)
        for m in own_mats:
            me.materials.append(m)
        me.polygons.foreach_set('material_index', idx)
        for layer in [u for u in me.uv_layers if u.name != 'atlas']:
            me.uv_layers.remove(layer)
        for a in list(me.color_attributes):
            me.color_attributes.remove(a)
        me.update()

    # Join what does not move on its own (and carries nothing that does).
    # The disc first: the joined mesh keeps its place, a child of the turntable.
    # What a piece marks `hangs` is joined apart from the rest: it hangs from
    # the jar's knob, and the page hides its thread while the glass is off, so
    # the thread (named for it) stays a node of its own. Every part says first
    # which spot a tap on it opens.
    part_attr([o for o in bpy.data.objects if under(o, tt)])
    keep = set(keep or ())

    def apart(o):
        """A part that must stay a node of its own: one that carries others,
        what a piece marks `hooked`, a hung thread, and whatever its page()
        names (the page looks it up by name)."""
        return (bool(o.children) or bool(o.get('hooked')) or (bool(o.get('hangs')) and 'thread' in o.name)
                or o.name in keep)

    still = [o for o in atlas_objs if not moves(o) and not apart(o) and not o.get('hangs')]
    still.sort(key=lambda o: o.name != 'disc')
    if len(still) > 1:
        model = C.join(still, 'model')
    elif still:
        model = still[0]
    else:
        model = None
    if model is not None:
        model['role'] = 'dyn'

    # The rest draws together too, one draw for each material rather than one
    # for each part: what stands still in materials of its own (the glows, the
    # see-through, the tracked) as 'model_own', and what moves, by what moves
    # it: every part that rides one keyed parent (a figure's limbs on its
    # torso) as '<parent>_rides', under that parent. What hangs is joined the
    # same way among itself ('hung', '<parent>_hung'), keeping its mark. A
    # keyed part keeps its own keys, so it stays apart.
    def carrier(o):
        p = o.parent
        while p is not None and p != tt:
            if p in keyed:
                return p
            p = p.parent
        return None

    groups = {}
    for o in [o for o in bpy.data.objects if under(o, tt) and o.type == 'MESH' and o is not model]:
        if o in keyed or apart(o):
            continue
        k = carrier(o)
        if o.get('hangs'):
            name = 'hung' if k is None else f'{k.name}_hung'
        else:
            name = 'model_own' if k is None else f'{k.name}_rides'
        groups.setdefault(name, []).append(o)
    joined = 0
    for name, objs in sorted(groups.items()):
        if len(objs) < 2:
            continue
        objs.sort(key=lambda o: o.name)
        for o in objs:
            _one_uv(o)
        j = C.join(objs, name)
        j['role'] = 'dyn'
        if name.endswith('hung'):
            j['hangs'] = 1
        joined += len(objs) - 1
    drop_idle()
    print('JOINED', len(still), 'parts into model;', len(atlas_objs) - len(still), 'move on their own;',
          joined, 'more into', ', '.join(n for n, objs in sorted(groups.items()) if len(objs) > 1) or 'nothing')
    return [tt] + [o for o in bpy.data.objects if under(o, tt)]


def page_names(v):
    """Every string in a piece's page() numbers: the names its page looks up."""
    if isinstance(v, str):
        return {v}
    if isinstance(v, dict):
        return set().union(*(page_names(x) for x in v.values())) if v else set()
    if isinstance(v, (list, tuple)):
        return set().union(*(page_names(x) for x in v)) if v else set()
    return set()


__all__ = ['Piece', 'load', 'out_dir', 'glass_lights', 'live_lights', 'scene_json', 'model_atlas', 'uv_scale',
           'keeps_own', 'ENV_AT', 'under', 'box', 'below', 'facing', 'reparent', 'part_attr', 'page_names']
