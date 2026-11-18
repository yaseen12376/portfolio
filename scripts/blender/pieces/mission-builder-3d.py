"""
Mission Builder 3D: the game's own lander on a slice of Mars.

What it shows is the game's three ideas, and nothing the game does not do:
  - dust settles on the solar panels and a brush sweeps it off, by the game's
    own rule (its cleaner starts above 30 per cent and stops at 5): each
    array's brush waits while the dust builds, then wipes once round; the
    right array runs half a loop behind the left
  - the radio signal takes time: beads of light climb from the dish to a
    small Earth hanging at the top of the jar
  - the lander is the game's own model (that repo's blender/10_lander.py),
    in its solar configuration with the large dish

The arrays' cells and the dust are scans (ambientCG, CC0: SolarPanel003 and
SurfaceImperfections015, fetched by scripts/fetch-assets.mjs), not the game's
flat texture: the cells laid on each gore's own UVs, the dust a sheet a hair
above them whose patches and grain come from the grime scan.
"""

from __future__ import annotations

import math
import os
import random
import shutil

import bpy
import numpy as np
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

# The arrays' cells: one scan of the panel (8 x 8 cells, gaps on its edges)
# over 2.4 of the arrays' UV units (0.4 m each), so a cell is 12 cm; rows
# start at the hub (v 0.262) and a gap runs down each gore's middle (u 0.5).
CELL_TILE = 2.4
CELL_ORIGIN = (0.5, 0.262)

# The dust, in each array's own cycle (one a loop). The brush waits, parked
# along the hub's +y, then sweeps once round, eased, starting and ending on a
# key of the live clip (pieces/live.py samples the loop 48 times), so the
# page's brush is parked exactly while its dust says so. Dust is 5 per cent
# where it has just passed and builds to 35 by the time it comes round again.
DUST_START = 14 / 48
DUST_SWEEP = 18 / 48
DUST_MIN, DUST_MAX = 0.05, 0.35
DUST_TILE = 0.8         # the dust maps' tile, in the lander's metres
DUST_LIFT = 0.006       # the sheet above the cells (0.7 mm in the jar)
BRUSH_HALF = 0.028      # half the brush's width: pushed dust heaps up past it
DUST_COLORS = ('#8e5a3c', '#c48f63')
# Each array's place in the loop and where on the maps it reads (so the two
# never wear the same pattern).
DUST_SIDES = {'L': (0.0, (0.0, 0.0)), 'R': (0.5, (0.37, 0.61))}
# How a thickness of dust looks; the page reads the same numbers (page()).
DUST_LOOK = {
    'patch': (0.5, 1.0),            # thickness x (a + b patches): thin and thick patches
    'grain': (0.55, 0.9),           # x (a + b grain)
    'streak': (0.3, 1.4, 0.12),     # just swept: x (a + b rings), fading over c of a cycle
    'rings': ((0.2, 37.3, 1.3), (0.15, 61.7, 0.4), (0.1, 97.1, 2.2)),   # the bristles' arcs: amplitude, per metre, phase
    'ridge': (0.45, 0.035, 0.6, 0.8),  # pushed ahead of the brush: a x (c + d patches), over b metres
    'film': (3.1, 1.3),             # cover = 1 - exp(-a thickness^b): about 6, 30 and 55 per cent at 5, 20 and 35
    'speck': (0.80, 0.93, 0.15, 2.2, 0.9),  # grains above a..b, cover c + d level, at most e
}


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

def _scan(mid):
    """An ambientCG material's maps (fetched by scripts/fetch-assets.mjs), by
    map name, as paths; None before the assets are fetched."""
    info = geo._manifest().get('materials', {}).get(mid)
    if not info:
        print(f'material {mid} missing: run node scripts/fetch-assets.mjs')
        return None
    base = os.path.join(C.BUILD, '..', 'assets')
    paths = {k: os.path.normpath(os.path.join(base, v)) for k, v in info['maps'].items()}
    return paths if all(os.path.exists(p) for p in paths.values()) else None


def _cells(m):
    """The arrays' cells, rebuilt on the game's material (the parts, the atlas
    and the live jar all know it by name): a scanned panel of monocrystalline
    cells, laid on each gore's own UVs, so the busbars run out from the hub
    and every gore is a fan of whole rows. Dielectric under glass, its colour
    and roughness from the scan (the scan's metalness, all metal, would make
    the blue a mirror's); its white gaps toned down a little, so at the jar's
    size the cells read as cells, not as a grid of light."""
    maps = _scan('SolarPanel003')
    if maps is None:
        return
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    uv = nt.nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'Float2'
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1 / CELL_TILE, 1 / CELL_TILE, 1)
    mp.inputs['Location'].default_value = (-CELL_ORIGIN[0] / CELL_TILE, -CELL_ORIGIN[1] / CELL_TILE, 0)
    nt.links.new(uv.outputs['UV'], mp.inputs['Vector'])

    def image(name, colour):
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = bpy.data.images.load(maps[name], check_existing=True)
        n.image.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
        n.interpolation = 'Linear'
        nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
        return n.outputs['Color']

    # Linear values: the cells sit near 0.02 and stay; the gaps (0.62) come down to 0.3.
    tone = nt.nodes.new('ShaderNodeRGBCurve')
    pts = tone.mapping.curves[3].points
    pts[0].location = (0.0, 0.0)
    pts[1].location = (1.0, 0.44)
    pts.new(0.12, 0.12)
    tone.mapping.update()
    nt.links.new(image('Color', True), tone.inputs['Color'])
    nt.links.new(tone.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(image('Roughness', False), b.inputs['Roughness'])
    b.inputs['Metallic'].default_value = 0.0
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.uv_map = 'Float2'
    nm.inputs['Strength'].default_value = 0.5
    nt.links.new(image('NormalGL', False), nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    nt.links.new(b.outputs[0], out.inputs['Surface'])


def _blur(a, sigma):
    """A Gaussian blur that wraps round the edges (the maps tile)."""
    fy = np.fft.fftfreq(a.shape[0])[:, None]
    fx = np.fft.rfftfreq(a.shape[1])[None, :]
    g = np.exp(-2 * (math.pi * sigma) ** 2 * (fx ** 2 + fy ** 2))
    return np.fft.irfft2(np.fft.rfft2(a) * g, s=a.shape)


def _resample(a, n):
    """`a` at n x n, band-limited and still tiling (its spectrum cropped)."""
    f = np.fft.fftshift(np.fft.fft2(a))
    h, w = a.shape
    cy, cx = h // 2, w // 2
    f = f[cy - n // 2: cy + n // 2, cx - n // 2: cx + n // 2]
    return np.real(np.fft.ifft2(np.fft.ifftshift(f))) * (n * n) / (h * w)


def _png(a, path):
    h, w = a.shape
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = a[..., None]
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return img


def _dust_maps():
    """The dust's two maps, from the grime scan's brightness: its grain (the
    fine detail, high-passed, 384 px: noise costs a WebP dearly, and finer
    is under a pixel even close up) and its patches (the same scan blurred,
    128 px). Both tile; both go to the page too (live() copies them out), so
    the live dust wears the render's."""
    maps = _scan('SurfaceImperfections015')
    if maps is None:
        raise FileNotFoundError('SurfaceImperfections015: run node scripts/fetch-assets.mjs')
    src = bpy.data.images.load(maps['Color'], check_existing=True)
    w, h = src.size
    px = np.empty(w * h * 4, np.float32)
    src.pixels.foreach_get(px)
    lum = px.reshape(h, w, 4)[..., :3].mean(-1).astype(np.float64)
    g = _resample(lum, 384)
    hp = g - _blur(g, 2.0)
    grain = np.clip(0.5 + hp / (4 * hp.std()), 0, 1)
    m = _resample(_blur(lum, 8.0), 128)
    lo, hi = np.percentile(m, [3, 97])
    patches = np.clip((m - lo) / (hi - lo), 0, 1)
    d = os.path.join(C.ROOT, 'build', 'pieces', META['id'], 'dust')
    os.makedirs(d, exist_ok=True)
    out = {}
    for name, a in (('grain', grain), ('mottle', patches)):
        path = os.path.join(d, f'dust_{name}.png')
        out[name] = (_png(a.astype(np.float32), path), path)
    return out


class _Math:
    """Shader math as expressions: the dust is one formula, and the page runs
    it too (src/three/piece-dust.js), so it is written here the way it reads
    there."""

    def __init__(self, nt):
        self.nt = nt

    def _in(self, sock, v):
        if isinstance(v, (int, float)):
            sock.default_value = v
        else:
            self.nt.links.new(v, sock)

    def __call__(self, op, a, b=None, c=None, clamp=False):
        n = self.nt.nodes.new('ShaderNodeMath')
        n.operation = op
        n.use_clamp = clamp
        for i, v in enumerate((a, b, c)):
            if v is not None:
                self._in(n.inputs[i], v)
        return n.outputs[0]

    def value(self, name, v=0.0):
        n = self.nt.nodes.new('ShaderNodeValue')
        n.name = n.label = name
        n.outputs[0].default_value = v
        return n.outputs[0]

    def smooth(self, x, e0, e1):
        n = self.nt.nodes.new('ShaderNodeMapRange')
        n.interpolation_type = 'SMOOTHSTEP'
        self._in(n.inputs['Value'], x)
        n.inputs['From Min'].default_value = e0
        n.inputs['From Max'].default_value = e1
        return n.outputs['Result']

    def image(self, img, vec):
        n = self.nt.nodes.new('ShaderNodeTexImage')
        n.image = img
        n.interpolation = 'Linear'
        n.extension = 'REPEAT'
        self.nt.links.new(vec, n.inputs['Vector'])
        return n.outputs['Color']


def _dust_material(side, maps):
    """One array's dust. The sheet's own space is the hub's (the lander's
    metres; the brush parks along +y and turns anticlockwise seen from
    above, from +y towards -x). Each frame animate() sets where the
    cycle is (dust_w: 0 as a sweep starts), how much of the turn the brush has
    swept (dust_arm: 1 while parked) and whether it is sweeping (dust_sweep).
    A point a fraction p of the turn round from the parked brush was passed
    when the eased sweep reached it; since then its dust has built from 5 per
    cent towards 35. Its thickness takes the scan's patches and grain; just
    swept, the bristles' arcs; just ahead of a sweeping brush, a ridge of what
    it pushes. Thickness covers the cells as 1 - exp(-a t^b), and the scan's
    brightest grains show on their own."""
    _, shift = DUST_SIDES[side]
    lk = DUST_LOOK
    m, nt, out = K._nodes(f'dust_{side}')
    f = _Math(nt)
    co = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(co.outputs['Object'], sep.inputs[0])
    x, y = sep.outputs['X'], sep.outputs['Y']
    w, arm, sweep = f.value('dust_w'), f.value('dust_arm', 1.0), f.value('dust_sweep')

    r = f('SQRT', f('ADD', f('MULTIPLY', x, x), f('MULTIPLY', y, y)))
    p = f('FRACT', f('DIVIDE', f('SUBTRACT', f('ARCTAN2', y, x), math.pi / 2), 2 * math.pi))
    passed = f('LESS_THAN', p, arm)
    # When the brush reached p, in the cycle's time: the eased turn, inverted.
    wp = f('MULTIPLY', f('SUBTRACT', 0.5, f('SINE', f('DIVIDE', f('ARCSINE', f('SUBTRACT', 1.0, f('MULTIPLY', p, 2.0))), 3.0))), DUST_SWEEP)
    tau = f('SUBTRACT', f('ADD', f('SUBTRACT', w, wp), 1.0), passed, clamp=True)
    level = f('MULTIPLY_ADD', tau, DUST_MAX - DUST_MIN, DUST_MIN)

    vec = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(f('MULTIPLY_ADD', x, 1 / DUST_TILE, shift[0]), vec.inputs['X'])
    nt.links.new(f('MULTIPLY_ADD', y, 1 / DUST_TILE, shift[1]), vec.inputs['Y'])
    patches = f.image(maps['mottle'][0], vec.outputs[0])
    grain = f.image(maps['grain'][0], vec.outputs[0])
    patches = f('ADD', patches, 0.0)     # (the grey maps' colour, as one value)
    grain = f('ADD', grain, 0.0)

    ring = 0.5
    for a, k, ph in lk['rings']:
        ring = f('MULTIPLY_ADD', f('SINE', f('MULTIPLY_ADD', r, 2 * math.pi * k, ph)), a, ring)
    ring = f('ADD', ring, 0.0, clamp=True)
    fresh = f('EXPONENT', f('MULTIPLY', tau, -1 / lk['streak'][2]))
    streak = f('MULTIPLY_ADD', f('MULTIPLY_ADD', ring, lk['streak'][1], lk['streak'][0] - 1.0), fresh, 1.0)
    d = f('MULTIPLY', level, f('MULTIPLY_ADD', patches, lk['patch'][1], lk['patch'][0]))
    d = f('MULTIPLY', d, f('MULTIPLY_ADD', grain, lk['grain'][1], lk['grain'][0]))
    d = f('MULTIPLY', d, streak)
    ahead = f('MULTIPLY', f('SUBTRACT', 1.0, passed), sweep)
    past = f('MAXIMUM', f('SUBTRACT', f('MULTIPLY', f('SUBTRACT', p, arm), f('MULTIPLY', r, 2 * math.pi)), BRUSH_HALF), 0.0)
    ridge = f('MULTIPLY', ahead, f('EXPONENT', f('DIVIDE', past, -lk['ridge'][1])))
    d = f('MULTIPLY_ADD', f('MULTIPLY', ridge, f('MULTIPLY_ADD', patches, lk['ridge'][3], lk['ridge'][2])), lk['ridge'][0], d)
    film = f('SUBTRACT', 1.0, f('EXPONENT', f('MULTIPLY', f('POWER', d, lk['film'][1]), -lk['film'][0])))
    s0, s1, sa, sb, smax = lk['speck']
    speck = f('MULTIPLY', f.smooth(grain, s0, s1), f('MINIMUM', f('MULTIPLY_ADD', level, sb, sa), smax))
    alpha = f('SUBTRACT', 1.0, f('MULTIPLY', f('SUBTRACT', 1.0, film), f('SUBTRACT', 1.0, speck)))

    col = nt.nodes.new('ShaderNodeMix')
    col.data_type = 'RGBA'
    nt.links.new(grain, col.inputs['Factor'])
    col.inputs['A'].default_value = C.lin(DUST_COLORS[0])
    col.inputs['B'].default_value = C.lin(DUST_COLORS[1])
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(col.outputs['Result'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.95
    try:
        b.inputs['Specular IOR Level'].default_value = 0.2
    except KeyError:
        pass
    nt.links.new(alpha, b.inputs['Alpha'])
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    try:
        m.surface_render_method = 'BLENDED'
    except Exception:
        pass
    return m


def _dust_sheet(side, array, root, col, material):
    """The dust's sheet: a copy of the array's cells, lifted a hair, its
    origin on the hub (the brush's pivot) and its axes the lander's, so its
    own space is the one the formula reads. On the lander, not the brush: the
    dust stays where it fell."""
    bpy.context.view_layer.update()
    mw = array.matrix_world
    nm = mw.to_3x3().inverted_safe().transposed()
    me = array.data
    names = [mt.name if mt else '' for mt in me.materials]
    cells = names.index(next(n for n in names if n.split('.')[0] == 'SolarCells'))
    hub = mw.translation.copy()
    verts, faces, index = [], [], {}
    for poly in me.polygons:
        if poly.material_index != cells or (nm @ poly.normal).normalized().z < 0.9:
            continue
        face = []
        for v in poly.vertices:
            if v not in index:
                index[v] = len(verts)
                p = mw @ me.vertices[v].co
                verts.append((p.x - hub.x, p.y - hub.y, p.z - hub.z + DUST_LIFT))
            face.append(index[v])
        faces.append(face)
    sheet = geo.mesh(f'dust_{side}', verts, faces, col, material)
    sheet.location = hub
    sheet.parent = root
    sheet.visible_shadow = False
    return sheet


def _sweep(t, off):
    """Where an array's brush is at loop time t (its cycle `off` behind the
    left's): its angle, unwrapped (so the clip's keys turn one way through
    the seam), the cycle's own time (0 as a sweep starts), how much of the
    turn it has swept (1 while parked), and whether it is sweeping."""
    u = t - off - DUST_START
    c = math.floor(u)
    w = u - c
    if w < DUST_SWEEP:
        x = w / DUST_SWEEP
        e = x * x * (3 - 2 * x)
        return 2 * math.pi * (c + e), w, e, 1.0
    return 2 * math.pi * (c + 1), w, 1.0, 0.0


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
    cells = next(mt for mt in objs['Array_L'].data.materials if mt and mt.name.split('.')[0] == 'SolarCells')
    _cells(cells)
    maps = _dust_maps()

    pivots, dust = [], {}
    for side, x in (('L', -2.05), ('R', 2.05)):
        e = C.empty(f'brush_pivot_{side}', col, loc=(x, 0.0, 1.07))
        e.parent = root
        _reparent(objs[f'Brush_{side}'], e)
        pivots.append(e)
        dust[side] = _dust_material(side, maps)
        _dust_sheet(side, objs[f'Array_{side}'], root, col, dust[side])

    root.scale = (SCALE, SCALE, SCALE)
    root.rotation_euler = (0, 0, YAW)
    root.location = (0, 0, _height(0, 0))
    bpy.context.view_layer.update()
    return root, pivots, dust, {k: v[1] for k, v in maps.items()}


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
    root, pivots, dust, maps = _lander(col)
    dish = root.matrix_world @ Vector((0.46, 0.62, 2.40))
    beads = _signal(col, dish)
    return {'pivots': pivots, 'beads': beads, 'dust': dust, 'dust_maps': maps}


def animate(t, st):
    # Each brush waits, then sweeps once round; its dust follows (_dust_material).
    for side, p in zip(DUST_SIDES, st['pivots']):
        angle, w, arm, sweeping = _sweep(t, DUST_SIDES[side][0])
        p.rotation_euler = (0, 0, angle)
        nodes = st['dust'][side].node_tree.nodes
        nodes['dust_w'].outputs[0].default_value = w
        nodes['dust_arm'].outputs[0].default_value = arm
        nodes['dust_sweep'].outputs[0].default_value = sweeping
    # Two pulses climb the beads each loop.
    n = len(st['beads'])
    for i, b in enumerate(st['beads']):
        u = (t * 2 - i / n) % 1.0
        d = min(u, 1 - u)
        k = max(0.0, 1 - d * 5.5) ** 2
        s = 0.55 + 1.5 * k
        b.scale = (s, s, s)


# ---------------------------------------------------------------- the live jar (pieces/live.py)

# The model atlas: twice the texels a metre for the cells (12 cm cells, seen
# close up with the glass off), half for the slice's banded wall.
LIVE = {'model_uv_scale': {'SolarCells': 2.0, 'mars_strata': 0.5}}

def spots(st):
    """The live jar's numbered dots, one per thing the case study's explorer
    talks about: the launch checks (on the lander's deck), the dust (on the
    left array), the signal (on the dish) and the tests (on the tag). Each
    also names the parts a tap opens it from, with the glass lifted: the
    lander's body and instruments; its arrays, their yokes and the cleaner;
    the dish, the beads and the Earth they climb to; the tag and its string.
    (The ground, the rocks and the disc open nothing.)"""
    from pieces.live import below, box
    bpy.context.view_layer.update()
    _, deck, body = box('Base')
    _, top_a, array = box('Array_L')
    _, top_d, dish = box('Antenna_Large')
    # The tag's dot sits on its eyelet, clear of the words.
    _, top_e, eye = box('tag_eyelet')
    lander = below('Lander')
    arrays = [n for n in lander if n.startswith(('Array_', 'Solar_', 'Brush_', 'dust_', 'Cleaner'))]
    radio = [n for n in lander if n.startswith('Antenna_')]
    return [
        {'id': 'checks', 'at': (body.x, body.y, deck.z + 0.012), 'parts': [n for n in lander if n not in arrays + radio]},
        {'id': 'dust', 'at': (array.x, array.y, top_a.z + 0.01), 'parts': arrays},
        {'id': 'signal', 'at': (dish.x, dish.y, top_d.z + 0.01),
         'parts': radio + [b.name for b in st['state']['beads']] + ['earth', 'earth_thread']},
        {'id': 'tag', 'at': (eye.x, eye.y, top_e.z + 0.004), 'on': 'jar', 'parts': below('tag') + ['tag_string']},
    ]


def _dust_live_material():
    """What the dust sheets leave as: a stand-in the page replaces with its
    own dust (src/three/piece-dust.js), see-through so the atlas leaves it be."""
    m, nt, out = K._nodes('dust_live')
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value = C.lin(DUST_COLORS[1])
    b.inputs['Roughness'].default_value = 0.95
    b.inputs['Alpha'].default_value = 0.6
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    try:
        m.surface_render_method = 'BLENDED'
    except Exception:
        pass
    m['dust'] = 1
    return m


def live(st):
    """Live, the dust is the page's own shader on the same sheets, reading
    the same two maps by the same formula (page() gives it the numbers), and
    the brush's sweep is the clip's. The sheets leave with a stand-in."""
    from pieces.live import out_dir
    m = _dust_live_material()
    for side in DUST_SIDES:
        me = bpy.data.objects[f'dust_{side}'].data
        me.materials.clear()
        me.materials.append(m)
    out = out_dir(META['id'])
    for name, path in st['state']['dust_maps'].items():
        shutil.copyfile(path, os.path.join(out, f'dust_{name}.png'))
    # The Earth hangs from the knob on its thread: lifting the glass lifts them.
    for name in ('earth', 'earth_thread'):
        o = bpy.data.objects.get(name)
        if o is not None:
            o['hangs'] = 1


def page(st):
    """What the page needs to draw the dust as the render does (scene.json's
    piece.dust): the maps (scripts/build-pieces.mjs makes them WebP), each
    sheet with its brush's pivot, and every number the formula reads."""
    return {'dust': {
        'maps': {'grain': 'dust_grain.webp', 'mottle': 'dust_mottle.webp'},
        'start': DUST_START, 'sweep': DUST_SWEEP, 'min': DUST_MIN, 'max': DUST_MAX,
        'tile': DUST_TILE, 'brush': BRUSH_HALF, 'colors': list(DUST_COLORS),
        'sheets': [{'mesh': f'dust_{s}', 'pivot': f'brush_pivot_{s}', 'offset': off, 'shift': list(shift)}
                   for s, (off, shift) in DUST_SIDES.items()],
        'look': {k: [list(x) if isinstance(x, tuple) else x for x in v] for k, v in DUST_LOOK.items()},
    }}
