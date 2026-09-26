"""
Shared helpers for the project dioramas (run inside Blender 5.2, headless).

Every scene is code: geometry, materials, light and animation are built by
these scripts, so a diorama can be rebuilt, reviewed and diffed like any other
source file. Ported from the KPS Clean-O pipeline (KPS/scripts/blender/), which
proved the approach end to end.

Coordinates: Blender is Z-up, metres. glTF (and three.js) is Y-up; the exporter
converts, and anything written to scene.json by hand goes through y_up().
"""

from __future__ import annotations

import json
import math
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUILD = os.path.join(ROOT, 'build', '3d')
PUBLIC = os.path.join(ROOT, 'public', '3d')
FONTS = os.path.join(ROOT, 'node_modules', '@fontsource-variable', 'geist-mono', 'files')

FPS = 30

# ---------------------------------------------------------------- palette
# Brand (style.css). These drive the overlays: they mean something.
BG = '#09090b'
SURFACE = '#18181b'
VIOLET = '#8b5cf6'
TURQ = '#06d6a0'
RED = '#f0506e'
AMBER = '#f59e0b'

# The dioramas' own materials: muted and warm, so the brand colours are the
# only saturated things in frame and read as data, not decoration.
MAT = {
    'plinth': '#34302f',      # anodised base: dark, but it must read on the #09090b page
    'steel': '#9aa0a8',       # the nameplate band
    'brass': '#b89452',
    'floor_wood': '#8a6a4f',
    'terrazzo': '#cfc8bd',
    'screed': '#6e6a64',
    'soil': '#4a3a2c',
    'stone': '#3a3833',
    'wall': '#d9d2c7',
    'wall_warm': '#e6dccd',
    'trim': '#2b2a2e',
    'glass': '#a9c7d6',
    'chrome': '#c8ccd2',
    'wood': '#9b7652',
    'wood_dark': '#5b4330',
    'fabric_a': '#c9b79c',
    'fabric_b': '#6f7f94',
    'fabric_c': '#a35d4f',
    'fabric_d': '#3f4b3a',
    'fabric_e': '#d8d4cc',
    'plant': '#3f6b45',
    'plant_dark': '#2c4a31',
    'pot': '#b0896a',
    'skin_a': '#e2b79a',
    'skin_b': '#b98463',
    'skin_c': '#7d543b',
    'hair': '#221c19',
    'rubber': '#232326',
    'plastic_w': '#e9e7e2',
    'screen_off': '#101216',
}


def argv() -> dict:
    """Arguments after `--`: `--key value` pairs; a `--flag` with no value is True."""
    raw = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out: dict = {}
    i = 0
    while i < len(raw):
        key = raw[i].lstrip('-')
        nxt = raw[i + 1] if i + 1 < len(raw) else None
        if nxt is None or nxt.startswith('--'):
            out[key] = True
            i += 1
        else:
            out[key] = int(nxt) if nxt.lstrip('-').isdigit() else nxt
            i += 2
    return out


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.render.fps = FPS
    return scene


def out_dir(scene_id: str, public=False) -> str:
    d = os.path.join(PUBLIC if public else BUILD, scene_id)
    os.makedirs(d, exist_ok=True)
    return d


def write_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=1)


# ---------------------------------------------------------------- colour

def lin(hex_: str, a: float = 1.0):
    """sRGB hex -> linear RGBA (Blender's colour inputs are linear)."""
    h = hex_.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    f = lambda v: v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (*[f(v) for v in c], a)


def mix(hex_a: str, hex_b: str, t: float) -> str:
    a = [int(hex_a.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4)]
    b = [int(hex_b.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4)]
    return '#' + ''.join(f'{round(x + (y - x) * t):02x}' for x, y in zip(a, b))


# ---------------------------------------------------------------- render setup

def engine(scene, which: str = 'CYCLES'):
    if which != 'CYCLES':
        ids = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
        scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in ids else 'BLENDER_EEVEE'
        return None
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    # CUDA first: OptiX needs a newer NVIDIA driver than this laptop has.
    for kind in ('CUDA', 'OPTIX'):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == kind]
            if gpus:
                for d in prefs.devices:
                    d.use = d.type == kind
                scene.cycles.device = 'GPU'
                return kind
        except Exception:
            continue
    return 'CPU'


def view_transform(scene):
    """Khronos PBR Neutral: the same curve as three.js NeutralToneMapping, so a
    Cycles still and the live scene agree on colour."""
    for vt in ('Khronos PBR Neutral', 'Standard'):
        try:
            scene.view_settings.view_transform = vt
            break
        except TypeError:
            continue
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0


def world(scene, hex_: str, strength: float = 1.0):
    w = bpy.data.worlds.new('World')
    scene.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = w.node_tree
    bg = nt.nodes.get('Background') or nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Color'].default_value = lin(hex_)
    bg.inputs['Strength'].default_value = strength
    return w


def collection(name: str):
    col = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(col)
    return col


def link(obj, col=None):
    (col or bpy.context.scene.collection).objects.link(obj)
    return obj


def move_to(obj, col):
    if col is None:
        return obj
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    col.objects.link(obj)
    return obj


def empty(name: str, col=None, loc=(0, 0, 0), size=0.05):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = size
    e.location = loc
    return link(e, col)


def select(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def join(objs, name):
    if len(objs) == 1:
        o = objs[0]
    else:
        select(objs)
        bpy.ops.object.join()
        o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def apply_modifiers(obj):
    select([obj])
    for m in list(obj.modifiers):
        if m.type == 'ARMATURE':
            continue
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except RuntimeError as e:
            print('modifier apply failed', obj.name, m.name, e)
    return obj


def apply_transform(obj, loc=False, rot=True, scale=True):
    select([obj])
    bpy.ops.object.transform_apply(location=loc, rotation=rot, scale=scale)
    return obj


# ---------------------------------------------------------------- camera + light

def aim(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def camera(scene, loc, target, fov_deg=28.0):
    cd = bpy.data.cameras.new('Camera')
    cd.sensor_fit = 'VERTICAL'
    cd.angle_y = math.radians(fov_deg)
    cd.clip_start = 0.05
    cd.clip_end = 200
    cam = link(bpy.data.objects.new('Camera', cd))
    cam.location = loc
    aim(cam, target)
    scene.camera = cam
    return cam


def area_light(name, loc, target, power, size=1.5, color='#ffffff', shape='DISK'):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = power
    ld.shape = shape
    ld.size = size
    ld.color = lin(color)[:3]
    ob = link(bpy.data.objects.new(name, ld))
    ob.location = loc
    aim(ob, target)
    return ob


def point_light(name, loc, power, color='#ffffff', radius=0.1):
    ld = bpy.data.lights.new(name, 'POINT')
    ld.energy = power
    ld.shadow_soft_size = radius
    ld.color = lin(color)[:3]
    ob = link(bpy.data.objects.new(name, ld))
    ob.location = loc
    return ob


def sun(name, rot_deg, strength, angle_deg=6, color='#ffffff'):
    ld = bpy.data.lights.new(name, 'SUN')
    ld.energy = strength
    ld.angle = math.radians(angle_deg)
    ld.color = lin(color)[:3]
    ob = link(bpy.data.objects.new(name, ld))
    ob.rotation_euler = [math.radians(a) for a in rot_deg]
    return ob


def sun_dir(ob):
    """The direction a sun's light travels, in Blender coordinates."""
    return tuple(ob.matrix_world.to_3x3() @ Vector((0, 0, -1)))


# ---------------------------------------------------------------- conversion

def y_up(p, nd=4):
    """Blender (x, y, z) -> three.js (x, z, -y)."""
    return [round(p[0], nd), round(p[2], nd), round(-p[1], nd)]


def blender_from_three(v):
    return (v[0], -v[2], v[1])


# ---------------------------------------------------------------- easing (mirrored in src/three/fx/ease.js)

def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def smoothstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)


def ease_in_out(t):
    t = clamp(t)
    return t * t * (3 - 2 * t)


def ease_out_back(t, s=1.7):
    t = clamp(t) - 1
    return t * t * ((s + 1) * t + s) + 1


def bounce_drop(t):
    """0->1 fall (gravity), then two small bounces. Height fraction 1 -> 0."""
    if t <= 0:
        return 1.0
    if t < 0.5:
        u = t / 0.5
        return 1 - u * u
    if t < 0.75:
        u = (t - 0.5) / 0.25
        return 0.12 * math.sin(math.pi * u)
    if t < 0.9:
        u = (t - 0.75) / 0.15
        return 0.035 * math.sin(math.pi * u)
    return 0.0


class Rand:
    """Seeded LCG so every build of a scene places things identically."""

    def __init__(self, seed: int):
        self.s = seed & 0xFFFFFFFF

    def __call__(self) -> float:
        self.s = (1664525 * self.s + 1013904223) & 0xFFFFFFFF
        return self.s / 0x100000000

    def range(self, a, b):
        return a + (b - a) * self()

    def pick(self, seq):
        return seq[int(self() * len(seq)) % len(seq)]
