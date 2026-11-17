"""
ADRAF: a head form under the scanner, one half taken apart.

The project (deepfake detection from facial landmark geometry, temporal
consistency and a CNN, trained on FaceForensics++ and Celeb-DF) has no code
on this machine, so the piece shows only what its page says. A milliner's
head form with no face (a smooth egg on a neck: no likeness of anyone),
split down the middle. One half is glazed porcelain. The other is the same
shape as voxels pulled a little apart, a few of them lit where the checks
found something. A scan ring travels up and down the head twice a loop, and
the voxels it passes catch its light.
"""

from __future__ import annotations

import math

import bmesh
import bpy

import common as C
from kit import geo
from pieces import _kit as K
from pieces import _parts as P

META = {
    'id': 'adraf',
    'tag': ('ADRAF', '', 'DEEPFAKE DETECTION  2025'),
    'accent': '#fb7185',
    'disc': '#1a1517',
}

ROSE = '#fb7185'
KY = 1.15                 # the head is longer front to back than across
NECK_Z, TOP_Z = 0.30, 0.752
HEAD_C, HEAD_A, HEAD_B = 0.601, 0.118, 0.15   # centre height, half-width, half-height
NECK_R = 0.054
VOX = 0.019
SPLIT = 0.012             # the voxel half stands this far off the cut
RING_R = 0.186
RING_MID, RING_AMP = 0.585, 0.16


def radius(z):
    """The form's radius across (x) at height z; front to back it is KY times this."""
    if z < NECK_Z or z > TOP_Z:
        return 0.0
    neck = NECK_R + 0.018 * C.smoothstep(0.35, NECK_Z, z) if z < 0.55 else 0.0
    d = (z - HEAD_C) / HEAD_B
    head = HEAD_A * math.sqrt(max(0.0, 1 - d * d)) if abs(d) < 1 else 0.0
    # The back of the skull sits a little fuller than the jaw.
    return max(neck, head)


def inside(x, y, z):
    return math.hypot(x, y / KY) < radius(z)


# ---------------------------------------------------------------- the stand

def _stand(col):
    walnut = K.walnut('form_walnut')
    brass = K.brass('form_brass')
    base = geo.lathe('form_base', [(0.0, 0.0), (0.118, 0.0), (0.121, 0.012), (0.112, 0.024), (0.07, 0.03), (0.0, 0.03)], col, walnut, segments=64)
    K.sharpen(base, 40)
    geo.lathe('form_column', [(0.0, 0.028), (0.03, 0.028), (0.026, 0.05), (0.016, 0.08), (0.013, 0.25), (0.02, 0.272), (0.02, 0.286),
                              (0.0, 0.286)], col, walnut, segments=40)
    geo.lathe('form_collar', [(0.0, 0.284), (0.04, 0.284), (0.042, 0.292), (0.036, NECK_Z + 0.001), (0.0, NECK_Z + 0.001)], col, brass, segments=48)


# ---------------------------------------------------------------- the porcelain half

def _porcelain(col):
    glaze = geo.pbr('porcelain', '#f2efe9', rough=0.14)
    try:
        b = glaze.node_tree.nodes.get('Principled BSDF')
        b.inputs['Coat Weight'].default_value = 0.5
        b.inputs['Coat Roughness'].default_value = 0.08
    except Exception:
        pass
    cut = geo.pbr('bisque', '#d9d1c4', rough=0.85)
    zs = [NECK_Z + (TOP_Z - NECK_Z) * (i / 120) ** 0.95 for i in range(121)]
    prof = [(0.0, NECK_Z)] + [(max(radius(z), 0.0), z) for z in zs[:-1]] + [(0.0, TOP_Z)]
    o = geo.lathe('form_porcelain', prof, col, glaze, segments=96)
    o.scale.y = KY
    C.apply_transform(o, loc=False)
    o.data.materials.append(cut)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, 0), plane_no=(1, 0, 0), clear_outer=True)
    edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
    filled = bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    for f in filled['faces']:
        f.material_index = 1
        f.smooth = False
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return o


# ---------------------------------------------------------------- the voxel half

def _scan_material(name, base, glow_hex, rest, peak, rough=0.45):
    """Glows by height: `rest` everywhere, rising to `peak` where the ring is.
    The ring's height is the value node 'ring_z' (world z), set every frame."""
    m, nt, out = K._nodes(name)
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value = C.lin(base)
    b.inputs['Roughness'].default_value = rough
    K.sock(b.inputs, 'Emission Color', 'Emission').default_value = C.lin(glow_hex)
    geo_n = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo_n.outputs['Position'], sep.inputs[0])
    ring = nt.nodes.new('ShaderNodeValue')
    ring.name = ring.label = 'ring_z'
    sub = nt.nodes.new('ShaderNodeMath')
    sub.operation = 'SUBTRACT'
    nt.links.new(sep.outputs['Z'], sub.inputs[0])
    nt.links.new(ring.outputs[0], sub.inputs[1])
    ab = nt.nodes.new('ShaderNodeMath')
    ab.operation = 'ABSOLUTE'
    nt.links.new(sub.outputs[0], ab.inputs[0])
    band = nt.nodes.new('ShaderNodeMapRange')
    band.interpolation_type = 'SMOOTHSTEP'
    band.inputs['From Min'].default_value = 0.0
    band.inputs['From Max'].default_value = 0.045
    band.inputs['To Min'].default_value = peak
    band.inputs['To Max'].default_value = rest
    nt.links.new(ab.outputs[0], band.inputs['Value'])
    nt.links.new(band.outputs['Result'], b.inputs['Emission Strength'])
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    m['glow'] = 1 if rest > 0 else 0
    return m


def _cubes(name, cells, col, material):
    verts, faces = [], []
    for (cx, cy, cz, s) in cells:
        h = s / 2
        i = len(verts)
        verts += [(cx + dx * h, cy + dy * h, cz + dz * h) for dz in (-1, 1) for dy in (-1, 1) for dx in (-1, 1)]
        faces += [(i, i + 2, i + 3, i + 1), (i + 4, i + 5, i + 7, i + 6), (i, i + 1, i + 5, i + 4),
                  (i + 2, i + 6, i + 7, i + 3), (i, i + 4, i + 6, i + 2), (i + 1, i + 3, i + 7, i + 5)]
    o = geo.mesh(name, verts, faces, col, material)
    mod = o.modifiers.new('bevel', 'BEVEL')
    mod.width = s * 0.12
    mod.segments = 1
    mod.limit_method = 'NONE'
    return o


def _voxels(col):
    rnd = C.Rand(23)
    n = lambda lo, hi: range(int(math.floor(lo / VOX)), int(math.ceil(hi / VOX)) + 1)
    cells = {}
    for i in n(0, 0.15):
        for j in n(-0.19, 0.19):
            for k in n(NECK_Z, TOP_Z):
                x, y, z = (i + 0.5) * VOX, (j + 0.5) * VOX, (k + 0.5) * VOX
                if x > 0 and inside(x, y, z):
                    cells[(i, j, k)] = (x, y, z)

    def open_face(i, j, k):
        if i == 0:
            return True  # on the cut: seen from the porcelain side
        return any((i + a, j + b, k + c) not in cells for a, b, c in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)))

    plain, lit = [], []
    for key, (x, y, z) in cells.items():
        if not open_face(*key):
            continue
        out = SPLIT + 0.014 * rnd() ** 2.2
        jit = 0.0016
        cell = (x + out, y + jit * (rnd() * 2 - 1), z + jit * (rnd() * 2 - 1), VOX * (0.84 + 0.12 * rnd()))
        # Artefacts: a sparse handful, toward the front of the face.
        (lit if (y < -0.02 and z > 0.49 and rnd() < 0.09) else plain).append(cell)
    plain_m = _scan_material('voxel', '#d4cdc2', ROSE, 0.0, 2.4)
    lit_m = _scan_material('voxel_lit', '#3a1a20', ROSE, 1.6, 3.2, rough=0.35)
    a = _cubes('form_voxels', plain, col, plain_m)
    b = _cubes('form_voxels_lit', lit, col, lit_m)
    print(f'ADRAF voxels: {len(plain)} plain, {len(lit)} lit')
    return [plain_m, lit_m]


# ---------------------------------------------------------------- the scan ring

def _ring(col):
    root = P.group('scan', col, loc=(0, 0, RING_MID))
    ring = P.ring('scan_ring', RING_R, 0.0024, col, geo.glow('scan_ring', ROSE, 2.2), segments=128, sides=8)
    ring.scale.y = 1.06
    ring.parent = root
    plane = geo.cyl('scan_plane', RING_R - 0.002, 0.0006, (0, 0, -0.0003), col=col, material=P.soft_glow('scan_plane', ROSE, 1.2, alpha=0.06),
                    verts=96, bev=0)
    plane.scale.y = 1.06
    P.no_shadow(plane)
    plane.parent = root
    for o in (ring, plane):
        P.no_shadow(o)
    return root


# ---------------------------------------------------------------- build + move

def build(col):
    _stand(col)
    _porcelain(col)
    mats = _voxels(col)
    ring = _ring(col)
    P.no_ghosts(col)
    return {'ring': ring, 'mats': mats}


def ring_z(t):
    return RING_MID + RING_AMP * math.sin(math.tau * 2 * t)


def animate(t, st):
    z = ring_z(t)
    st['ring'].location.z = z
    # The materials read world height; the turntable's top is K.FLOOR up.
    for m in st['mats']:
        m.node_tree.nodes['ring_z'].outputs[0].default_value = z + K.FLOOR
