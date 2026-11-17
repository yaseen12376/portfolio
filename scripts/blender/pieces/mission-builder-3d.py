"""
Mission Builder 3D: the game's own lander on a slice of Mars.

What it shows is the game's three ideas, and nothing the game does not do:
  - dust settles on the solar panels and a brush sweeps it off (each brush
    turns once a loop; the wedge behind it is clean and dusts over again)
  - the radio signal takes time: beads of light climb from the dish to a
    small Earth hanging at the top of the jar
  - the lander is the game's own model (that repo's blender/10_lander.py),
    in its solar configuration with the large dish
"""

from __future__ import annotations

import math
import random

import bpy
from mathutils import Vector, noise

import common as C
from kit import geo
from pieces import _kit as K

META = {
    'id': 'mission-builder-3d',
    'tag': ('MISSION', 'BUILDER 3D', 'MARS LANDER GAME  2026'),
    'accent': '#ff8a4c',
    'disc': '#2a1711',
}

SCALE = 0.12        # the lander's 6.26 m span, just inside the glass
YAW = math.radians(-22)
SLICE_R = 0.35      # the slice of Mars it stands on
SLICE_H = 0.22
EARTH_Z = 0.80
N_BEADS = 11        # one for each second of the game's squeezed signal delay


# ---------------------------------------------------------------- ground

def _height(x, y):
    r = math.hypot(x, y)
    n = 0.0
    f, a = 5.0, 1.0
    for _ in range(4):
        n += a * noise.noise(Vector((x * f, y * f, 3.7)))
        f *= 2.1
        a *= 0.5
    dune = 0.020 * n + 0.010 * math.sin(x * 9 + y * 4)
    flat = C.smoothstep(0.26, 0.13, r)              # level where the feet stand
    sag = 0.03 * C.smoothstep(SLICE_R * 0.55, SLICE_R, r)
    return SLICE_H + (1 - flat) * dune - sag


def _edge(th):
    """The slice's outline: round, but cut by hand."""
    return SLICE_R + 0.008 * noise.noise(Vector((math.cos(th) * 1.7, math.sin(th) * 1.7, 9.1)))


def _strata_material():
    """Bands of rock by height, wobbling a little as real beds do."""
    m, nt, out = K._nodes('mars_strata')
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Roughness'].default_value = 0.93
    co = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(co.outputs['Object'], sep.inputs[0])
    wob = nt.nodes.new('ShaderNodeTexNoise')
    wob.inputs['Scale'].default_value = 5.0
    wob.inputs['Detail'].default_value = 2.0
    nt.links.new(co.outputs['Object'], wob.inputs['Vector'])
    k = nt.nodes.new('ShaderNodeMath')
    k.operation = 'MULTIPLY_ADD'
    nt.links.new(K.sock(wob.outputs, 'Fac', 'Factor'), k.inputs[0])
    k.inputs[1].default_value = 0.035
    nt.links.new(sep.outputs['Z'], k.inputs[2])
    norm = nt.nodes.new('ShaderNodeMath')
    norm.operation = 'DIVIDE'
    nt.links.new(k.outputs[0], norm.inputs[0])
    norm.inputs[1].default_value = SLICE_H + 0.035
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'CONSTANT'
    bands = [(0.0, '#4a2418'), (0.13, '#7a3b24'), (0.24, '#5c2c1c'), (0.37, '#96512f'), (0.46, '#6d3521'),
             (0.60, '#b06a3f'), (0.70, '#84422a'), (0.83, '#a4572f')]
    e = ramp.color_ramp.elements
    while len(e) < len(bands):
        e.new(0.5)
    for el, (pos, hex_) in zip(e, bands):
        el.position = pos
        el.color = C.lin(hex_)
    nt.links.new(norm.outputs[0], ramp.inputs[0])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    return m


def _ground(col):
    rings, seg = 28, 120
    edge = [_edge(2 * math.pi * s / seg) for s in range(seg)]
    # the top
    verts = [(0.0, 0.0, _height(0, 0))]
    for i in range(1, rings + 1):
        for s in range(seg):
            th = 2 * math.pi * s / seg
            r = edge[s] * i / rings
            x, y = r * math.cos(th), r * math.sin(th)
            verts.append((x, y, _height(x, y)))
    faces = [(0, 1 + s, 1 + (s + 1) % seg) for s in range(seg)]
    for i in range(1, rings):
        a, b = 1 + (i - 1) * seg, 1 + i * seg
        faces += [(a + s, b + s, b + (s + 1) % seg, a + (s + 1) % seg) for s in range(seg)]
    soil = geo.textured('mars_soil', 'gravelly_sand', tint='#a4532f', rough=0.95, scale=0.1, strength=0.85)
    geo.mesh('mars_ground', verts, faces, col, soil, smooth=True)

    # the cut face: straight down from the top's rim, a little rough
    rows = 12
    wv, wf = [], []
    for k in range(rows + 1):
        u = k / rows
        for s in range(seg):
            th = 2 * math.pi * s / seg
            x0, y0 = edge[s] * math.cos(th), edge[s] * math.sin(th)
            top = _height(x0, y0)
            z = top * u
            rough = 0.004 * noise.noise(Vector((math.cos(th) * 6, math.sin(th) * 6, z * 30))) * math.sin(math.pi * u)
            r = edge[s] + rough - 0.006 * (1 - u) ** 2
            wv.append((r * math.cos(th), r * math.sin(th), z))
    for k in range(rows):
        a, b = k * seg, (k + 1) * seg
        wf += [(a + s, a + (s + 1) % seg, b + (s + 1) % seg, b + s) for s in range(seg)]
    wall = geo.mesh('mars_slice', wv, wf, col, _strata_material(), smooth=True)
    return wall


def _rock(name, r, seed, col, material):
    rnd = random.Random(seed)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=r)
    o = bpy.context.active_object
    for v in o.data.vertices:
        k = 1 + 0.32 * noise.noise(Vector(v.co) * (2.2 / r) + Vector((seed, 0, 0)))
        v.co = Vector((v.co.x * k, v.co.y * k, v.co.z * k * rnd.uniform(0.55, 0.8)))
    o.rotation_euler = (rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rnd.uniform(0, 6.28))
    C.apply_transform(o)
    geo._finish(o, name, col, material, 'set', True, {})
    return K.sharpen(o, 32)


def _rocks(col):
    rnd = random.Random(26)
    stone = geo.pbr('mars_rock', '#5f3423', rough=0.92)
    dark = geo.pbr('mars_rock_dark', '#3d2219', rough=0.9)
    spots = [(0.25, 205, 0.030), (0.30, 232, 0.018), (0.27, 318, 0.024), (0.31, 20, 0.016), (0.22, 158, 0.013),
             (0.31, 120, 0.022), (0.20, 286, 0.010), (0.31, 265, 0.012), (0.28, 75, 0.011), (0.32, 350, 0.014)]
    for i, (r, deg, size) in enumerate(spots):
        x, y = r * math.cos(math.radians(deg)), r * math.sin(math.radians(deg))
        o = _rock(f'rock_{i}', size, 40 + i, col, stone if rnd.random() < 0.65 else dark)
        o.location = (x, y, _height(x, y) + size * 0.22)


# ---------------------------------------------------------------- lander

def _dust_material(name, pivot):
    """Dust that is thinnest just behind the brush and thickest just ahead of
    it, read in the brush pivot's own space so the wedge turns with the arm."""
    m, nt, out = K._nodes(name)
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value = C.lin('#c9906a')
    b.inputs['Roughness'].default_value = 0.96
    try:
        b.inputs['Specular IOR Level'].default_value = 0.1
    except KeyError:
        pass
    co = nt.nodes.new('ShaderNodeTexCoord')
    co.object = pivot
    grad = nt.nodes.new('ShaderNodeTexGradient')
    grad.gradient_type = 'RADIAL'
    nt.links.new(co.outputs['Object'], grad.inputs['Vector'])

    def math_(op, a, b_=None):
        n = nt.nodes.new('ShaderNodeMath')
        n.operation = op
        for i, v in enumerate((a, b_)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                nt.links.new(v, n.inputs[i])
        return n.outputs[0]

    g = K.sock(grad.outputs, 'Fac', 'Factor')
    since = math_('FRACT', math_('ADD', g, 0.25))        # 0 just ahead of the arm, 1 just behind
    dust = math_('POWER', math_('SUBTRACT', 1.0, since), 2.6)
    nt.links.new(math_('MULTIPLY', dust, 0.95), b.inputs['Alpha'])
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    return m


def _reparent(child, parent):
    bpy.context.view_layer.update()
    mw = child.matrix_world.copy()
    child.parent = parent
    child.matrix_parent_inverse.identity()
    bpy.context.view_layer.update()
    child.matrix_world = mw


def _lander(col):
    with bpy.data.libraries.load(K.source('lander.blend'), link=False) as (src, dst):
        dst.objects = list(src.objects)
    objs = {o.name: o for o in dst.objects if o is not None}
    for o in objs.values():
        col.objects.link(o)
    # The solar build with the large dish: the game fits one power source and
    # one antenna, never both.
    for name in ('Antenna_Small', 'Power_Nuclear'):
        objs[name].hide_render = True
        objs[name].hide_viewport = True
    root = objs['Lander']

    pivots = []
    for side, x in (('L', -2.05), ('R', 2.05)):
        e = C.empty(f'brush_pivot_{side}', col, loc=(x, 0.0, 1.07))
        e.parent = root
        _reparent(objs[f'Brush_{side}'], e)
        pivots.append(e)
        # The dust lies on the round array as a sheet of its own, a hair above the cells.
        z, n = 1.058, 48
        ring = [(x + 1.0 * math.cos(2 * math.pi * i / n), 1.0 * math.sin(2 * math.pi * i / n), z) for i in range(n)]
        sheet = geo.mesh(f'dust_{side}', [(x, 0.0, z)] + ring, [(0, 1 + i, 1 + (i + 1) % n) for i in range(n)],
                         col, _dust_material(f'dust_{side}', e))
        sheet.visible_shadow = False
        sheet.parent = root

    root.scale = (SCALE, SCALE, SCALE)
    root.rotation_euler = (0, 0, YAW)
    root.location = (0, 0, _height(0, 0))
    bpy.context.view_layer.update()
    return root, pivots


# ---------------------------------------------------------------- signal + Earth

def _earth_material():
    m, nt, out = K._nodes('earth')
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Roughness'].default_value = 0.34
    co = nt.nodes.new('ShaderNodeTexCoord')
    land = nt.nodes.new('ShaderNodeTexNoise')
    land.inputs['Scale'].default_value = 22.0
    land.inputs['Detail'].default_value = 6.0
    nt.links.new(co.outputs['Object'], land.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    e = ramp.color_ramp.elements
    e[0].position, e[0].color = 0.52, C.lin('#123f8c')
    e[1].position, e[1].color = 0.57, C.lin('#3d7f4c')
    nt.links.new(K.sock(land.outputs, 'Fac', 'Factor'), ramp.inputs[0])
    cloud = nt.nodes.new('ShaderNodeTexNoise')
    cloud.inputs['Scale'].default_value = 40.0
    cloud.inputs['Detail'].default_value = 4.0
    nt.links.new(co.outputs['Object'], cloud.inputs['Vector'])
    cr = nt.nodes.new('ShaderNodeValToRGB')
    ce = cr.color_ramp.elements
    ce[0].position, ce[0].color = 0.60, (0, 0, 0, 1)
    ce[1].position, ce[1].color = 0.72, (1, 1, 1, 1)
    nt.links.new(K.sock(cloud.outputs, 'Fac', 'Factor'), cr.inputs[0])
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    nt.links.new(cr.outputs['Color'], mix.inputs['Factor'])
    nt.links.new(ramp.outputs['Color'], mix.inputs['A'])
    mix.inputs['B'].default_value = (0.86, 0.9, 0.94, 1)
    nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
    nt.links.new(mix.outputs['Result'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 0.12
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    return m


def _signal(col, start):
    earth = geo.sphere('earth', 0.042, (0, 0, EARTH_Z), col=col, material=_earth_material(), seg=40)
    earth.rotation_euler = (math.radians(23), 0, 0)
    geo.tube('earth_thread', [(0, 0, EARTH_Z + 0.041), (0, 0, K.room(0) - 0.001)], radius=0.0011, col=col,
             material=geo.pbr('thread', '#8d9198', rough=0.4, metal=1.0), resolution=2)
    end = Vector((0, 0, EARTH_Z - 0.058))
    ctrl = Vector((start.x * 1.3, start.y * 1.3, (start.z + end.z) / 2 + 0.07))
    bead = geo.glow('signal', '#ffd7a1', 9.0)
    beads = []
    for i in range(N_BEADS):
        u = (i + 0.7) / (N_BEADS + 0.4)
        p = start * (1 - u) ** 2 + ctrl * 2 * u * (1 - u) + end * u ** 2
        beads.append(geo.sphere(f'bead_{i}', 0.0058, tuple(p), col=col, material=bead, seg=12))
    return beads


# ---------------------------------------------------------------- build + move

def build(col):
    _ground(col)
    _rocks(col)
    root, pivots = _lander(col)
    dish = root.matrix_world @ Vector((0.46, 0.62, 2.40))
    beads = _signal(col, dish)
    return {'pivots': pivots, 'beads': beads}


def animate(t, st):
    # Each brush turns once; the right one runs half a turn behind the left.
    for i, p in enumerate(st['pivots']):
        p.rotation_euler = (0, 0, 2 * math.pi * (t + 0.5 * i))
    # Two pulses climb the beads each loop.
    n = len(st['beads'])
    for i, b in enumerate(st['beads']):
        u = (t * 2 - i / n) % 1.0
        d = min(u, 1 - u)
        k = max(0.0, 1 - d * 5.5) ** 2
        s = 0.55 + 1.5 * k
        b.scale = (s, s, s)
