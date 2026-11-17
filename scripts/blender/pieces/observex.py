"""
ObserveX: the product's mark, watched over by three rings.

The site is a pitch for a home-security concept, so there is no machine to
show: the piece is its identity, straight from the repo. The rounded "OX"
block is the logo in the navbar (a cyan to violet gradient, the letters in
the page's navy), and the three rings are its palette: navy #050810, cyan
#00e5ff and purple #8b5cf6. Each ring leans at its own angle and swings round
a whole number of times a loop, with a small lens riding it.
"""

from __future__ import annotations

import math

import bpy

import common as C
from kit import geo
from pieces import _kit as K
from pieces import _parts as P

META = {
    'id': 'observex',
    'tag': ('OBSERVEX', '', 'PRODUCT SITE  2026'),
    'accent': '#00e5ff',
    'disc': '#0b0f1c',
}

NAVY, CYAN, PURPLE = '#050810', '#00e5ff', '#8b5cf6'
CENTRE = 0.47
SIDE = 0.19
# radius, lean from the horizontal (degrees), swings a loop, start angle, lens laps a loop, colour
RINGS = ((0.335, 24.0, 1, 20.0, 2, 'navy'), (0.282, 58.0, -1, 140.0, -1, 'cyan'), (0.228, 82.0, 1, 250.0, 2, 'purple'))


def _gradient():
    """The logo's gradient: cyan at one top corner to violet at the far foot."""
    m, nt, out = K._nodes('ox_gradient')
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Roughness'].default_value = 0.28
    co = nt.nodes.new('ShaderNodeTexCoord')
    dot = nt.nodes.new('ShaderNodeVectorMath')
    dot.operation = 'DOT_PRODUCT'
    nt.links.new(co.outputs['Object'], dot.inputs[0])
    dot.inputs[1].default_value = (0.62, 0.0, -0.78)
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -0.11
    mr.inputs['From Max'].default_value = 0.11
    nt.links.new(dot.outputs['Value'], mr.inputs['Value'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    e = ramp.color_ramp.elements
    e[0].position, e[0].color = 0.0, C.lin('#22d3ee')
    e[1].position, e[1].color = 1.0, C.lin('#8b5cf6')
    nt.links.new(mr.outputs['Result'], ramp.inputs[0])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(ramp.outputs['Color'], K.sock(b.inputs, 'Emission Color', 'Emission'))
    b.inputs['Emission Strength'].default_value = 0.5
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    return m


def _block(col):
    root = P.group('ox', col, loc=(0, 0, CENTRE))
    bpy.ops.mesh.primitive_cube_add(size=SIDE, location=(0, 0, 0))
    cube = bpy.context.active_object
    geo.bevel(cube, 0.032, segments=6)
    geo._finish(cube, 'ox_block', col, _gradient(), 'set', True, {})
    cube.parent = root
    ink = geo.pbr('ox_ink', NAVY, rough=0.35)
    for k, (y, turn) in enumerate(((-SIDE / 2 - 0.0005, 0), (SIDE / 2 + 0.0005, 180))):
        P.heavy(f'ox_text{k}', 'OX', 0.084, col, ink, loc=(0, y, -0.002), rot=(90, 0, turn), depth=0.004, weight=0.035).parent = root
    return root


def _stand(col):
    dark = geo.pbr('ox_stand', '#10141f', rough=0.3, metal=0.9)
    top = CENTRE - SIDE / 2 + 0.002
    prof = [(0.0, 0.0), (0.118, 0.0), (0.124, 0.008), (0.124, 0.02), (0.108, 0.03), (0.06, 0.038), (0.03, 0.05), (0.016, 0.07), (0.0105, 0.1),
            (0.0105, top - 0.02), (0.022, top), (0.0, top)]
    K.sharpen(geo.lathe('stand', prof, col, dark, segments=64), 35)
    P.ring('stand_glow', 0.112, 0.0022, col, geo.glow('stand_cyan', CYAN, 2.0), z=0.0305, segments=96, sides=8)


def _rings(col):
    mats = {
        'navy': geo.pbr('ring_navy', '#1a2a5c', rough=0.22, metal=1.0),
        'cyan': geo.glow('ring_cyan', CYAN, 1.5),
        'purple': geo.glow('ring_purple', PURPLE, 2.0),
    }
    shell = geo.pbr('node_shell', '#0d1226', rough=0.2, metal=0.8)
    out = []
    for i, (r, lean, swings, start, laps, kind) in enumerate(RINGS):
        swing = P.group(f'ring_swing{i}', col, loc=(0, 0, CENTRE))
        tilt = P.group(f'ring_tilt{i}', col, rot=(lean, 0, 0), parent=swing)
        P.ring(f'ring{i}', r, 0.0088 if kind == 'navy' else 0.0058, col, mats[kind], segments=160, sides=14).parent = tilt
        if kind == 'navy':
            # the dark ring carries a thin line of light, so it reads on a dark page
            P.ring(f'ring{i}_line', r + 0.0092, 0.0013, col, geo.glow('ring_navy_line', '#9fd8ff', 1.2), segments=160, sides=6).parent = tilt
        # a lens riding the ring: the thing that watches
        rider = P.group(f'ring_rider{i}', col, parent=tilt)
        P.ball(f'ring{i}_node', 0.021, col, shell, loc=(r, 0, 0), seg=24).parent = rider
        eye = geo.glow(f'node_eye_{kind}', PURPLE if kind == 'purple' else CYAN, 3.5)
        P.ball(f'ring{i}_eye', 0.0105, col, eye, loc=(r, 0, 0.0135), seg=16).parent = rider
        P.ball(f'ring{i}_eye2', 0.0105, col, eye, loc=(r, 0, -0.0135), seg=16).parent = rider
        out.append((swing, swings, start, rider, laps))
    return out


def build(col):
    _stand(col)
    _block(col)
    rings = _rings(col)
    P.no_ghosts(col)
    return {'rings': rings}


def animate(t, st):
    for swing, swings, start, rider, laps in st['rings']:
        swing.rotation_euler = (0, 0, math.radians(start) + 2 * math.pi * swings * t)
        rider.rotation_euler = (0, 0, 2 * math.pi * laps * t)
