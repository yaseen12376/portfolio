"""
NeerNaadi: one Chennai street in the monsoon, cut open.

The project's own drain-anatomy cutaway in miniature. A block of street is
cut at the front to show what the advisor reads from the GCC drain survey:
the RCC box drains under both footpaths (the left one silted, with rubbish
caught in it), the water main and the sewer. Rain from a cloud hung in the
jar ponds in the middle of the road.

Ten unattended reports stand round the water as red beacons, in the app's
own ticket colours (lib/types.ts), and ten open reports within 500 m are
what raise an area red zone, so a red ring pulses round them. Outside it,
one ticket goes through every state the app has once a loop: unattended,
government processing, resolved, and reopened when the resident says it is
not fixed. A model, not a map: no real street or ticket is shown. The
road (wet asphalt) and the tree's bark are scanned surfaces (ambientCG, CC0).
"""

from __future__ import annotations

import math

import bpy

import common as C
from kit import geo
from pieces import _kit as K
from pieces import _parts as P
from pieces import _scans as S

META = {
    'id': 'neernaadi',
    'tag': ('NEER', 'NAADI', 'FLOOD REPORTS  2026'),
    'accent': '#4da3ff',
    'disc': '#131b23',
}

RED, ORANGE, GREY = '#ff3b5c', '#ff9f1c', '#8592a3'   # unattended, processing, resolved

YAW = 26.0                # the block's turn on the disc: the cut face toward the spot, one side to the fill
W, D = 0.60, 0.40         # the block: x across the street, y along it
X_KERB = 0.185            # the road runs from -X_KERB to X_KERB, a footpath each side
Z_ROAD = 0.215
Z_SLAB = 0.22             # the footpath slabs sit on the drains
Z_WALK = 0.234
DRAIN = (0.195, 0.285)    # |x| of a box drain's outer walls
Z_DRAIN = 0.125           # underside of its floor
WALL_T = 0.01
GRAVEL = (0.185, 0.203)   # the road's sub-base, under the asphalt
MAIN = (-0.07, 0.095, 0.026)   # the water main: x, z, radius
SEWER = (0.075, 0.07, 0.032)
POND_R = 0.098
WATER_TOP = Z_ROAD + 0.0025
CLOUD_Z = 0.70
RAIN_TOP = 0.665          # drops start inside the cloud...
RAIN_LEN = 0.045


# ---------------------------------------------------------------- materials

def _water(name, hex_, rough=0.04, transmission=0.7):
    """Water: a little see-through, so what is under it shows, tinted."""
    m, nt, out = K._nodes(name)
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    b.inputs['Base Color'].default_value = C.lin(hex_)
    b.inputs['Roughness'].default_value = rough
    b.inputs['IOR'].default_value = 1.33
    K.sock(b.inputs, 'Transmission Weight', 'Transmission').default_value = transmission
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    m.diffuse_color = C.lin(hex_)
    return m


def _tint(m, hex_):
    """Recolour a glow (either kind) between frames."""
    c = C.lin(hex_)
    for n in m.node_tree.nodes:
        if n.type == 'EMISSION':
            n.inputs['Color'].default_value = c
        elif n.type == 'BSDF_PRINCIPLED':
            n.inputs['Emission Color'].default_value = c


def _no_mirror_ghosts(col):
    """The red zone sits right under the dome's top, and there the glass
    mirrors the floor by total internal reflection: a ray goes into the
    shell, reflects off its outside and comes back out as a transmission ray,
    so P.no_ghosts (glossy rays only) cannot catch it, and a red ring floats
    under the knob. Here every glow turns transparent to a path that has
    reflected even once: seen straight through the glass, it still glows."""
    done = set()
    for o in col.all_objects:
        for s in getattr(o, 'material_slots', ()):
            m = s.material
            if m is None or m.name in done or not P._emits(m):
                continue
            done.add(m.name)
            nt = m.node_tree
            out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
            link = out.inputs['Surface'].links[0]
            src = link.from_socket
            nt.links.remove(link)
            lp = nt.nodes.new('ShaderNodeLightPath')
            gt = nt.nodes.new('ShaderNodeMath')
            gt.operation = 'GREATER_THAN'
            gt.inputs[1].default_value = 0.5
            nt.links.new(lp.outputs['Glossy Depth'], gt.inputs[0])
            clear = nt.nodes.new('ShaderNodeBsdfTransparent')
            mix = nt.nodes.new('ShaderNodeMixShader')
            nt.links.new(gt.outputs[0], mix.inputs[0])
            nt.links.new(src, mix.inputs[1])
            nt.links.new(clear.outputs[0], mix.inputs[2])
            nt.links.new(mix.outputs[0], out.inputs['Surface'])


def _soil(name, hex_):
    return geo.textured(name, 'gravelly_sand', tint=hex_, rough=0.95, scale=0.06, strength=0.75)


# ---------------------------------------------------------------- the block

def _minus(x0, x1, holes):
    """[x0, x1] with the `holes` intervals taken out."""
    out, a = [], x0
    for h0, h1 in sorted(holes):
        if h1 <= a or h0 >= x1:
            continue
        if h0 > a:
            out.append((a, h0))
        a = max(a, h1)
    if a < x1:
        out.append((a, x1))
    return out


def _slab(name, x0, x1, z0, z1, mat, col, root, y0=-D / 2, y1=D / 2, bev=0.0):
    o = geo.box(name, (x1 - x0, y1 - y0, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, z0), col=col, material=mat, bev=bev)
    o.parent = root
    return o


def _ground(col, root):
    """The strata, cut at all four sides, with a hollow for each drain."""
    drains = [(-DRAIN[1], -DRAIN[0]), (DRAIN[0], DRAIN[1])]
    bands = [
        (0.0, 0.06, _soil('soil_clay', '#2f231b')),
        (0.06, Z_DRAIN, _soil('soil_loam', '#5e4430')),
        (Z_DRAIN, GRAVEL[0], _soil('soil_fill', '#9a7a52')),
        (GRAVEL[0], GRAVEL[1], geo.textured('soil_gravel', 'gravelly_sand', tint='#6d6a64', rough=0.9, scale=0.04, strength=0.9)),
    ]
    for i, (z0, z1, mat) in enumerate(bands):
        holes = drains if z1 > Z_DRAIN else []
        for j, (x0, x1) in enumerate(_minus(-W / 2, W / 2, holes)):
            _slab(f'band{i}_{j}', x0, x1, z0, z1, mat, col, root)
    # under each footpath, outside its drain, up to the slab
    gravel = bands[3][2]
    for s in (-1, 1):
        x0, x1 = sorted((s * DRAIN[1], s * W / 2))
        _slab(f'walk_fill{s}', x0, x1, GRAVEL[1], Z_SLAB, gravel, col, root)

    # Wet asphalt: the scan's aggregate at the street's scale (about 1:19),
    # darker and glossier than dry, its roughness still varying stone to stone.
    asphalt = S.scanned('asphalt', 'Asphalt033', tint='#24262b', size=0.16, rough=0.36, bump=0.5)
    _slab('road', -X_KERB, X_KERB, GRAVEL[1], Z_ROAD, asphalt, col, root)
    paving = geo.textured('paving', 'patterned_paving_02', tint='#a0988c', rough=0.8, scale=0.035, strength=0.75)
    for s in (-1, 1):
        x0, x1 = sorted((s * DRAIN[0], s * W / 2))
        _slab(f'footpath{s}', x0, x1, Z_SLAB, Z_WALK, paving, col, root, bev=0.0015)

    # the kerbs, painted black and yellow the Chennai way
    yellow = geo.pbr('kerb_yellow', '#e2b42b', rough=0.6)
    black = geo.pbr('kerb_black', '#1f2023', rough=0.6)
    n = 10
    for s in (-1, 1):
        x0, x1 = sorted((s * X_KERB, s * DRAIN[0]))
        for k in range(n):
            y0 = -D / 2 + k * D / n
            _slab(f'kerb{s}_{k}', x0, x1, GRAVEL[1], Z_WALK + 0.003, yellow if k % 2 == 0 else black, col, root,
                  y0=y0, y1=y0 + D / n, bev=0.0012)

    # the centre line, under the water in the middle
    white = geo.pbr('road_line', '#e9e6de', rough=0.6)
    for k in range(5):
        y = -D / 2 + 0.03 + k * 0.08
        geo.box(f'road_dash{k}', (0.006, 0.045, 0.0006), (0, y + 0.0225, Z_ROAD), col=col, material=white, bev=0).parent = root

    # a gully grate at each kerb: the way into the drain
    iron = geo.pbr('grate_iron', '#2a2b2e', rough=0.5, metal=0.7)
    dark = geo.pbr('grate_hole', '#08090a', rough=1.0)
    for s, y in ((-1, 0.115), (1, -0.125)):
        g = P.group(f'grate{s}', col, loc=(s * (X_KERB - 0.016), y, Z_ROAD), parent=root)
        geo.box('grate_hole', (0.024, 0.036, 0.0004), (0, 0, 0), col=col, material=dark, bev=0).parent = g
        for b in range(5):
            geo.box('grate_bar', (0.026, 0.0028, 0.0012), (0, -0.016 + b * 0.008, 0.0002), col=col, material=iron, bev=0).parent = g

    # pebbles in the cut faces
    rnd = C.Rand(29)
    stones = [geo.pbr(f'pebble{i}', h, rough=0.7) for i, h in enumerate(('#8b8378', '#6f685f', '#a39a8c'))]
    spots = []
    while len(spots) < 16:
        x, z = rnd.range(-0.28, 0.28), rnd.range(0.012, GRAVEL[0] - 0.008)
        if any(math.hypot(x - px, z - pz) < pr + 0.012 for px, pz, pr in (MAIN, SEWER)):
            continue  # clear of the pipes
        if abs(x) > DRAIN[0] - 0.012 and z > Z_DRAIN - 0.012:
            continue  # and of the drains
        spots.append((x, z))
    for i, (x, z) in enumerate(spots):
        o = P.ball(f'pebble{i}', rnd.range(0.004, 0.0075), col, stones[i % 3], loc=(x, -D / 2, z), seg=12)
        o.scale = (1.0, 0.32, 0.75)
        o.parent = root
    for i in range(7):
        y, z = rnd.range(-0.18, 0.18), rnd.range(0.012, GRAVEL[0] - 0.008)
        o = P.ball(f'pebble_side{i}', rnd.range(0.004, 0.007), col, stones[i % 3], loc=(W / 2, y, z), seg=12)
        o.scale = (0.32, 1.0, 0.75)
        o.parent = root


def _drains(col, root):
    """Two RCC box drains, open at the cut. The left one is silted to more
    than half its depth, with rubbish caught in it; the right one runs clear."""
    concrete = geo.textured('drain_rcc', 'concrete_wall_008', tint='#a29d94', rough=0.85, scale=0.05, strength=0.55)
    silt = geo.textured('silt', 'gravelly_sand', tint='#4b4637', rough=1.0, scale=0.03, strength=0.6)   # grey sludge, not soil
    murky = _water('drain_murky', '#2c3b30', rough=0.08, transmission=0.15)
    clear = _water('drain_clear', '#1e4656', rough=0.04, transmission=0.55)
    z_in = Z_DRAIN + WALL_T
    for s in (-1, 1):
        x0, x1 = sorted((s * DRAIN[0], s * DRAIN[1]))
        _slab(f'drain_floor{s}', x0, x1, Z_DRAIN, z_in, concrete, col, root)
        _slab(f'drain_wall_a{s}', x0, x0 + WALL_T, z_in, Z_SLAB, concrete, col, root)
        _slab(f'drain_wall_b{s}', x1 - WALL_T, x1, z_in, Z_SLAB, concrete, col, root)
        i0, i1 = x0 + WALL_T, x1 - WALL_T
        if s < 0:
            top = z_in + 0.05
            _slab('silt', i0, i1, z_in, top, silt, col, root)
            _slab('murky', i0, i1, top, top + 0.012, murky, col, root)
            _rubbish(col, root, (i0 + i1) / 2, top + 0.0125)
        else:
            _slab('silt_thin', i0, i1, z_in, z_in + 0.006, silt, col, root)
            _slab('clear_water', i0, i1, z_in + 0.006, z_in + 0.034, clear, col, root)


def _rubbish(col, root, x, z):
    """What a survey records as an obstacle: a bottle and a wrapper, at the
    cut where they show, and a few leaves."""
    plastic = _water('bottle', '#cfe3ec', rough=0.15, transmission=0.6)
    g = P.group('bottle', col, loc=(x - 0.008, -D / 2 + 0.018, z), rot=(0, 0, 14), parent=root)
    P.rod('bottle_body', (0, -0.016, 0), (0, 0.012, 0), 0.0062, col, plastic, verts=16).parent = g
    P.rod('bottle_neck', (0, -0.024, 0), (0, -0.016, 0), 0.0028, col, plastic, verts=12).parent = g
    P.rod('bottle_cap', (0, -0.027, 0), (0, -0.024, 0), 0.0031, col, geo.pbr('bottle_cap', '#2f6fd0', rough=0.4), verts=12).parent = g
    w = geo.box('wrapper', (0.014, 0.01, 0.002), (x + 0.017, -D / 2 + 0.03, z - 0.0015), rot=(8, -12, 30), col=col,
                material=geo.pbr('wrapper', '#d0452f', rough=0.35), bev=0.0006)
    w.parent = root
    leaf = geo.pbr('leaf_dead', '#7d6a2c', rough=0.7)
    for k, (dx, dy, a) in enumerate(((-0.018, 0.05, 20), (0.012, 0.075, -35), (0.0, 0.11, 60))):
        lf = P.ball(f'leaf{k}', 0.007, col, leaf, loc=(x + dx, -D / 2 + dy, z - 0.0004), seg=10)
        lf.scale = (1.0, 0.45, 0.12)
        lf.rotation_euler = (0, 0, math.radians(a))
        lf.parent = root


def _pipes(col, root):
    """The water main and the sewer under the road, cut through."""
    main = geo.pbr('water_main', '#2f6fd6', rough=0.35)
    sewer = geo.pbr('sewer_pipe', '#8a5a3c', rough=0.6)
    inside_w = _water('main_water', '#1d4a7a', rough=0.05, transmission=0.2)
    inside_s = geo.pbr('sewer_inside', '#15110e', rough=0.9)
    for name, (x, z, r), m, inner in (('main', MAIN, main, inside_w), ('sewer', SEWER, sewer, inside_s)):
        e = D / 2 + 0.0035
        P.rod(f'{name}_pipe', (x, -e, z), (x, e, z), r, col, m, verts=40).parent = root
        for s in (-1, 1):
            P.rod(f'{name}_bore{s}', (x, s * e, z), (x, s * (e + 0.0004), z), r - 0.0055, col, inner, verts=40).parent = root


def _pond(col, root):
    """Rain water standing in the middle of the road."""
    pts = []
    n = 56
    for i in range(n):
        a = 2 * math.pi * i / n
        r = POND_R * (1 + 0.11 * math.sin(3 * a + 0.6) + 0.06 * math.sin(5 * a + 1.9) + 0.035 * math.sin(9 * a + 0.3))
        pts.append((r * math.cos(a), r * math.sin(a)))
    o = geo.extrude('pond', pts, WATER_TOP - Z_ROAD, z=Z_ROAD, col=col, material=_water('pond', '#3a6f9c', rough=0.03, transmission=0.5),
                    bev=0.001)
    o.parent = root
    return min(math.hypot(*p) for p in pts)


# ---------------------------------------------------------------- tickets

def _beacon(name, col, parent, loc, mats, h, head_r=0.0058):
    """A ticket on the map: a puck, a beam as tall as its voices, a head."""
    puck_m, beam_m, head_m = mats
    b = P.group(name, col, loc=loc, parent=parent)
    geo.cyl(f'{name}_puck', 0.0085, 0.0024, (0, 0, 0), col=col, material=puck_m, verts=24, bev=0.0006).parent = b
    beam = P.group(f'{name}_beam', col, parent=b)
    beam.scale = (1, 1, h)
    P.rod(f'{name}_beam_rod', (0, 0, 0), (0, 0, 1), 0.0027, col, beam_m, verts=12).parent = beam
    head = P.group(f'{name}_head', col, loc=(0, 0, h), parent=b)
    P.ball(f'{name}_head_ball', head_r, col, head_m, seg=16).parent = head
    return {'root': b, 'beam': beam, 'head': head}


def _mats(key, hex_, beam_alpha=0.45, head=4.0):
    return (geo.glow(f'{key}_puck', hex_, 2.6), P.soft_glow(f'{key}_beam', hex_, 2.2, alpha=beam_alpha), geo.glow(f'{key}_head', hex_, head))


def _tickets(col, root):
    st = {}
    red = _mats('red', RED)
    # Ten unattended reports round the water: an area red zone.
    heights = (0.12, 0.07, 0.16, 0.09, 0.055, 0.13, 0.08, 0.11, 0.06, 0.1)
    rnd = C.Rand(41)
    for i, h in enumerate(heights):
        a = math.radians(14 + 36 * i + rnd.range(-9, 9))
        r = 0.075 + 0.045 * (i % 2) + rnd.range(-0.006, 0.006)
        _beacon(f'red{i}', col, root, (r * math.cos(a), r * math.sin(a), Z_ROAD), red, h)
    st['red_heads'] = red[2]

    ring_m = P.soft_glow('zone_ring', RED, 2.0, alpha=0.95)
    ring = P.group('zone', col, loc=(0, 0, Z_ROAD + 0.0004), parent=root)
    P.flat_ring('zone_ring', 0.133, 0.141, col, ring_m, h=0.0006, segments=128).parent = ring
    pulse_m = P.soft_glow('zone_pulse', RED, 2.0, alpha=0.7)
    pulse = P.group('zone_pulse', col, loc=(0, 0, Z_ROAD + 0.0002), parent=root)
    P.flat_ring('zone_pulse_ring', 0.133, 0.139, col, pulse_m, h=0.0004, segments=128).parent = pulse
    st.update(ring_m=ring_m, pulse=pulse, pulse_m=pulse_m)

    # Outside the zone, on the footpaths: one being handled, one resolved...
    _beacon('orange', col, root, (0.25, -0.12, Z_WALK), _mats('orange', ORANGE), 0.085)
    _beacon('grey', col, root, (-0.25, -0.03, Z_WALK), _mats('grey', GREY, beam_alpha=0.35, head=2.4), 0.05)
    # ...and one that goes the whole way each loop.
    life = _mats('life', RED)
    st['life'] = _beacon('life', col, root, (0.25, 0.03, Z_WALK), life, 0.1)
    st['life_mats'] = life
    return st


# ---------------------------------------------------------------- the street

def _lamp(col, root):
    x, y = -0.255, 0.165
    metal = geo.pbr('lamp_metal', '#868d96', rough=0.35, metal=0.7)
    g = P.group('lamp', col, loc=(x, y, Z_WALK), parent=root)
    geo.cyl('lamp_foot', 0.009, 0.012, (0, 0, 0), col=col, material=metal, verts=20, bev=0.002).parent = g
    top = 0.3
    P.rod('lamp_pole', (0, 0, 0), (0, 0, top), 0.0052, col, metal, verts=16).parent = g
    arm = [(0, 0, top - 0.004)]
    for i in range(1, 9):
        u = i / 8
        arm.append((0.075 * u, 0, top - 0.004 + 0.02 * math.sin(u * math.pi * 0.75)))
    geo.tube('lamp_arm', arm, radius=0.003, col=col, material=metal, resolution=2).parent = g
    head = P.group('lamp_head', col, loc=(0.085, 0, top + 0.006), rot=(0, 6, 0), parent=g)
    geo.box('lamp_housing', (0.036, 0.016, 0.007), (0, 0, 0), col=col, material=metal, bev=0.002).parent = head
    geo.box('lamp_light', (0.03, 0.011, 0.0008), (0, 0, -0.0006), col=col, material=geo.glow('lamp_glow', '#ffe2b0', 9.0), bev=0).parent = head


def _tree(col, root):
    x, y = 0.248, 0.142
    bark = S.scanned('bark', 'Bark012', tint='#4a3527', size=0.06, rough=0.85, bump=0.9)
    g = P.group('tree', col, loc=(x, y, Z_WALK), parent=root)
    geo.cyl('tree_guard', 0.022, 0.003, (0, 0, 0), col=col, material=geo.pbr('tree_soil', '#3b2b21', rough=1.0), verts=24, bev=0).parent = g
    P.limb('trunk', (0, 0, 0), (0.004, -0.006, 0.17), 0.0085, 0.0055, col, bark, g)
    P.limb('branch', (0.002, -0.003, 0.11), (-0.03, 0.006, 0.18), 0.0045, 0.003, col, bark, g)
    leaves = [geo.pbr(f'neem{i}', h, rough=0.8) for i, h in enumerate(('#3e6b3a', '#477a40', '#365f33'))]
    for i, (dx, dy, dz, r) in enumerate(((0, 0, 0.205, 0.046), (-0.03, 0.012, 0.19, 0.036), (0.026, -0.014, 0.188, 0.034),
                                         (0.008, 0.024, 0.228, 0.03), (-0.014, -0.022, 0.232, 0.028), (-0.036, -0.004, 0.214, 0.026))):
        P.ball(f'canopy{i}', r, col, leaves[i % 3], loc=(dx, dy, dz), seg=20).parent = g


def _cloud(col):
    """A rain cloud hung from the knob. Bobs once a loop."""
    top = geo.pbr('cloud_top', '#cdd4de', rough=0.95)
    under = geo.pbr('cloud_under', '#8a95a3', rough=0.95)
    g = P.group('cloud', col, loc=(0, 0, CLOUD_Z))
    puffs = ((0, 0, 0.03, 0.062), (0.062, 0.012, 0.008, 0.05), (-0.064, -0.008, 0.012, 0.052), (0.018, 0.056, 0.006, 0.046),
             (-0.02, -0.054, 0.008, 0.046), (0.104, -0.018, -0.008, 0.034), (-0.104, 0.02, -0.006, 0.036),
             (0.038, -0.04, 0.042, 0.042), (-0.04, 0.038, 0.046, 0.04))
    for i, (x, y, z, r) in enumerate(puffs):
        o = P.ball(f'puff{i}', r, col, top, loc=(x, y, z), seg=28)
        o.scale = (1.0, 1.0, 0.86)
        o.parent = g
    base = P.ball('cloud_base', 0.118, col, under, loc=(0, 0, -0.012), seg=32)
    base.scale = (1.0, 0.8, 0.26)
    base.parent = g
    # The thread holds still and runs into the cloud's top, so the bob never
    # lifts it into the knob.
    geo.tube('cloud_thread', [(0, 0, CLOUD_Z + 0.06), (0, 0, K.room(0) - 0.002)], radius=0.0011, col=col,
             material=geo.pbr('thread', '#8d9198', rough=0.4, metal=1.0), resolution=2)
    return g


def _rain(col, root, pond_min):
    """Drops that fall from the cloud into the pond, each with the ripple it
    makes. Every drop falls a whole number of times a loop."""
    mat = P.soft_glow('rain', '#cfe3ff', 1.3, alpha=0.6)
    rnd = C.Rand(7)
    reach = min(0.055, pond_min - 0.024)
    drops = []
    for i in range(14):
        a = rnd.range(0, 2 * math.pi)
        r = reach * math.sqrt(rnd())
        x, y = r * math.cos(a), r * math.sin(a)
        d = P.group(f'drop{i}', col, loc=(x, y, RAIN_TOP), parent=root)
        P.rod(f'drop{i}_streak', (0, 0, 0), (0, 0, RAIN_LEN), 0.0014, col, mat, verts=8).parent = d
        rm = P.soft_glow(f'ripple{i}', '#d8ecff', 1.4, alpha=0.8)
        rp = P.group(f'ripple{i}', col, loc=(x, y, WATER_TOP + 0.0003), parent=root)
        P.flat_ring(f'ripple{i}_ring', 0.0075, 0.0088, col, rm, h=0.0003, segments=40).parent = rp
        drops.append({'drop': d, 'ripple': rp, 'mat': rm, 'k': 6 + (i % 2), 'phase': rnd()})
    return drops


# ---------------------------------------------------------------- build + animate

def build(col):
    root = P.group('street', col, rot=(0, 0, YAW))
    _ground(col, root)
    _drains(col, root)
    _pipes(col, root)
    pond_min = _pond(col, root)
    st = _tickets(col, root)
    _lamp(col, root)
    _tree(col, root)
    st['cloud'] = _cloud(col)
    st['drops'] = _rain(col, root, pond_min)
    P.no_ghosts(col)
    _no_mirror_ghosts(col)
    return st


# The lifecycle: (t, colour, beam height). Reopened at the end, back to red.
LIFE = ((0.0, RED, 0.1), (0.25, RED, 0.1), (0.33, ORANGE, 0.085), (0.58, ORANGE, 0.085), (0.66, GREY, 0.045),
        (0.88, GREY, 0.045), (0.96, RED, 0.1), (1.0, RED, 0.1))


def _life(t):
    for (t0, c0, h0), (t1, c1, h1) in zip(LIFE, LIFE[1:]):
        if t0 <= t <= t1:
            u = 0.0 if t1 == t0 else (t - t0) / (t1 - t0)
            u = u * u * (3 - 2 * u)
            return C.mix(c0, c1, u), h0 + (h1 - h0) * u
    return LIFE[-1][1], LIFE[-1][2]


def animate(t, st):
    fall = RAIN_TOP - WATER_TOP
    for d in st['drops']:
        u = (d['k'] * t + d['phase']) % 1.0
        d['drop'].location.z = RAIN_TOP - fall * u
        s = 0.35 + 2.1 * u                       # the last drop's ripple spreads as the next one falls
        d['ripple'].scale = (s, s, 1.0)
        P.set_glow(d['mat'], alpha=0.85 * (1 - u) ** 2)

    p = (2 * t) % 1.0                            # the zone sends out two pulses a loop
    k = 1 + 0.32 * p
    st['pulse'].scale = (k, k, 1.0)
    P.set_glow(st['pulse_m'], alpha=0.7 * (1 - p) ** 1.5)
    P.set_glow(st['ring_m'], strength=2.0 + 0.6 * math.cos(4 * math.pi * t))
    P.set_glow(st['red_heads'], strength=3.4 + 1.0 * math.cos(4 * math.pi * t))

    colour, h = _life(t)
    for m in st['life_mats']:
        _tint(m, colour)
    st['life']['beam'].scale = (1, 1, h)
    st['life']['head'].location.z = h

    st['cloud'].location.z = CLOUD_Z + 0.005 * math.sin(2 * math.pi * t)


# ---------------------------------------------------------------- the live jar (pieces/live.py)

# A drop falls six or seven times a loop: a key a frame (the render's 144),
# so none is ever drawn between the bottom of one fall and the top of the next.
LIVE = {'clip_frames': 144}


def spots(st):
    """The live jar's numbered dots: the red zone (on the tallest red
    beacon), a ticket's life (on the beacon that goes through every state),
    the drains (at the cut, over the silted one) and the floods (on the
    cloud). Each names the parts a tap opens it from with the glass off."""
    from mathutils import Vector

    from pieces.live import below, box
    bpy.context.view_layer.update()
    _, top_r, red = box('red2_head_ball')
    _, top_l, life = box('life_head_ball')
    _, top_c, cloud = box('cloud_base')
    street = bpy.data.objects['street']
    rot = street.matrix_world.to_3x3()
    i0, i1 = -DRAIN[1] + WALL_T, -DRAIN[0] - WALL_T
    cut = street.matrix_world @ Vector(((i0 + i1) / 2, -D / 2 - 0.006, Z_DRAIN + WALL_T + 0.062))
    out = (rot @ Vector((0.0, -1.0, 0.0))).normalized() * 0.8 + Vector((0.0, 0.0, 0.6))
    allof = below('street')
    zone = [n for n in allof if n.startswith(('red', 'zone'))]
    ticket = [n for n in allof if n.startswith(('life', 'orange', 'grey'))]
    drains = [n for n in allof if n.startswith(('drain_', 'silt', 'murky', 'clear_water', 'bottle', 'wrapper', 'leaf', 'grate'))]
    floods = below('cloud') + ['cloud_thread'] + [n for n in allof if n.startswith(('drop', 'ripple', 'pond'))]
    return [
        {'id': 'zone', 'at': (red.x, red.y, top_r.z + 0.012), 'parts': zone},
        {'id': 'ticket', 'at': (life.x, life.y, top_l.z + 0.012), 'parts': ticket},
        {'id': 'drains', 'at': tuple(cut), 'out': tuple(out), 'parts': drains},
        {'id': 'floods', 'at': (cloud.x, cloud.y, top_c.z + 0.01), 'parts': floods},
    ]


def live(st):
    """The cloud hangs from the knob on its thread: lifting the glass leaves
    it hanging where it is (raining), and only the thread goes."""
    from pieces.live import below
    for name in below('cloud') + ['cloud_thread']:
        o = bpy.data.objects.get(name)
        if o is not None:
            o['hangs'] = 1
