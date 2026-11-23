"""
Scanned surfaces for the pieces: ambientCG materials (CC0, photographed;
scripts/blender/assets.json, fetched by scripts/fetch-assets.mjs into the
git-ignored build/assets/) as Principled materials.

  scanned(name, 'Cardboard004', tint='#b98a57', size=0.3, rough=0.7, bump=0.4)

Colour, roughness and height come from the scan, tiled at `size` metres
(its real size by default) and box-projected in the object's own space, so a
joined or bevelled mesh needs no UVs. The colour is the scan normalised to
its own average and multiplied by `tint`, so the palette decides colour and
value and the scan adds the grain, the fibres, the wear; `detail` below 1
fades it toward the plain tint. The roughness keeps the scan's variation
round the mean `rough` asks for. The height drives a Bump node (Cycles only:
the live jar's atlas carries colour, roughness and metalness, which is
where the scan shows at its size anyway).

Before the assets are fetched, a plain material of the tint stands in.
"""

from __future__ import annotations

import math
import os

import bpy
import numpy as np

import common as C
from kit import geo

_CACHE = {}


def maps(mid):
    """An ambientCG material's maps by name, as paths (None before the fetch)."""
    info = geo._manifest().get('materials', {}).get(mid)
    if not info:
        print(f'material {mid} missing: run node scripts/fetch-assets.mjs')
        return None
    base = os.path.join(C.BUILD, '..', 'assets')
    paths = {k: os.path.normpath(os.path.join(base, v)) for k, v in info['maps'].items()}
    return paths if all(os.path.exists(p) for p in paths.values()) else None


def real_size(mid):
    info = geo._manifest().get('materials', {}).get(mid) or {}
    return tuple(info.get('size', (1.0, 1.0)))


def _mean(img, colour):
    """The image's average: linear RGB for a colour map, its value for a data map."""
    px = np.empty(len(img.pixels), np.float32)
    img.pixels.foreach_get(px)
    rgb = px.reshape(-1, 4)[:, :3].astype(np.float64)
    if colour:
        lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
        return lin.mean(0)
    return float(rgb.mean())


def scanned(name, mid, tint=None, size=None, rough=None, bump=0.3, metal=0.0, detail=1.0, blend=0.15, spec=0.5,
            rough_range=None, rot=(0.0, 0.0, 0.0)):
    """A Principled material from a scan (see the module's notes).

    tint         hex: the scan's colour normalised and multiplied by it;
                 None: the scan's own colour
    size         one tile, in metres (a number, or (x, y)); the scan's real size by default
    rough        the roughness the surface averages; None: the scan's own
    rough_range  (lo, hi) the scan's roughness is squeezed into, after `rough`
    bump         the height's strength (0: none)
    detail       0..1: how much of the scan's colour shows over the plain tint
    rot          the projection turned (degrees about x, y, z): a grain run the other way
    """
    key = (name, mid, tint, size, rough, bump, metal, detail, blend, spec, rough_range, tuple(rot))
    if key in _CACHE:
        return _CACHE[key]
    paths = maps(mid)
    if paths is None:
        m = geo.pbr(name, tint or '#808080', rough=rough if rough is not None else 0.6, metal=metal)
        _CACHE[key] = m
        return m
    sx, sy = (size, size) if isinstance(size, (int, float)) else (size or real_size(mid))
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Metallic'].default_value = metal
    try:
        b.inputs['Specular IOR Level'].default_value = spec
    except KeyError:
        pass
    coord = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1 / sx, 1 / sy, 1 / sx)
    mp.inputs['Rotation'].default_value = tuple(math.radians(a) for a in rot)
    nt.links.new(coord.outputs['Object'], mp.inputs['Vector'])

    def image(map_name, colour):
        n = nt.nodes.new('ShaderNodeTexImage')
        n.image = bpy.data.images.load(paths[map_name], check_existing=True)
        n.image.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
        n.projection = 'BOX'
        n.projection_blend = blend
        n.interpolation = 'Cubic'
        nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
        return n

    # Colour: the scan over its own average, times the tint.
    col = image('Color', True)
    src = col.outputs['Color']
    if tint is not None:
        mean = _mean(col.image, True)
        t = C.lin(tint)
        k = [t[i] / max(1e-4, mean[i]) for i in range(3)]
        mul = nt.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        nt.links.new(src, mul.inputs[6])
        mul.inputs[7].default_value = (*k, 1.0)
        src = mul.outputs[2]
        if detail < 1:
            fade = nt.nodes.new('ShaderNodeMix')
            fade.data_type = 'RGBA'
            fade.inputs['Factor'].default_value = detail
            fade.inputs[6].default_value = t
            nt.links.new(src, fade.inputs[7])
            src = fade.outputs[2]
        m.diffuse_color = t
    nt.links.new(src, b.inputs['Base Color'])

    # Roughness: the scan's, round the mean asked for.
    if 'Roughness' in paths:
        r = image('Roughness', False)
        out = r.outputs['Color']
        if rough is not None:
            g = nt.nodes.new('ShaderNodeMath')
            g.operation = 'MULTIPLY'
            g.use_clamp = True
            nt.links.new(out, g.inputs[0])
            g.inputs[1].default_value = rough / max(1e-3, _mean(r.image, False))
            out = g.outputs[0]
        if rough_range is not None:
            mr = nt.nodes.new('ShaderNodeMapRange')
            nt.links.new(out, mr.inputs['Value'])
            mr.inputs['To Min'].default_value, mr.inputs['To Max'].default_value = rough_range
            out = mr.outputs['Result']
        nt.links.new(out, b.inputs['Roughness'])
    elif rough is not None:
        b.inputs['Roughness'].default_value = rough

    # Height: a bump, as deep as the scan's tile is wide times a little.
    if bump > 0 and 'Displacement' in paths:
        h = image('Displacement', False)
        bn = nt.nodes.new('ShaderNodeBump')
        bn.inputs['Strength'].default_value = bump
        bn.inputs['Distance'].default_value = 0.004 * min(sx, sy)
        nt.links.new(h.outputs['Color'], bn.inputs['Height'])
        nt.links.new(bn.outputs['Normal'], b.inputs['Normal'])
    m['scan'] = mid
    _CACHE[key] = m
    return m


__all__ = ['scanned', 'maps', 'real_size']
