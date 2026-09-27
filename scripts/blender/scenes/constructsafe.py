"""
02 ConstructSafe: a building site at night, watched by four cameras.

The product (repos/FINAL_EIT_PPE/construct_safe) watches site cameras for
missing PPE, falls and fire, and names the worker in view. The island is a
site big enough for every one of those to have a place of its own, seen from
the home view:

  - the gate and its hut: the entry camera (CAM-01, face mode), the barrier,
    the enrolment counter; the road beyond is where people come and go
  - the groundworks: a rebar mat, footings in formwork, starter bars, the
    drum mixer: watched for PPE (CAM-02, outdoor)
  - the building going up: a concrete frame with a first-floor deck half
    cast, a three-lift scaffold on its face, block walls going up inside:
    the ground floor is the indoor camera's (CAM-03, fall mode)
  - the welding bay: screens, the bench, gas bottles and a bin, the
    "High-Risk Zone" camera's (CAM-04, fire mode)
  - the materials yard: pallets, timber, pipes, the skip
  - the site office: a portakabin, cut away, with the dashboard on its desk
  - plant: an excavator, and the site van

Coordinates: Blender, metres, Z up. The open front of the site faces -Y (the
camera side); the gate is on the +X edge.
"""

from __future__ import annotations

import math

import common as C
from kit import geo, plinth, props, retail as R, site as S

W, D = 13.0, 9.0
HW, HD = W / 2, D / 2
GATE = (-0.95, 0.95)         # the gate's opening, along Y, on the +X edge
FRAME = (-6.1, -1.5, 1.0, 4.1)   # the building's frame: x0, x1, y0, y1
DECK_Z = 2.7                 # the first-floor deck
DECK_Y = 2.55                # the deck is cast from here back (the front half is open)
WELD = (1.9, 5.1, 2.3, 4.15)     # the welding bay
OFFICE = (4.7, -3.05)        # the portakabin's centre
HUT = (5.85, 1.75)           # the gate hut's centre

META = {
    'id': 'constructsafe',
    'label': '02 / CONSTRUCTSAFE',
    'plinth': {'w': W, 'd': D, 'radius': 0.3, 'strata': [('soil', 0.14), ('stone', 0.2), ('screed', 0.06)]},
    'view': {'yaw': 32, 'pitch': 38, 'fov': 26, 'margin': 1.03},
    'post': {'focus': 0.5, 'band': 0.24, 'ramp': 0.34, 'bloom': 0.5, 'bloomThreshold': 0.9, 'sat': 1.05, 'vignette': 0.32,
             'case': {'band': 0.34, 'ramp': 0.4, 'blurAmount': 0.55}},
    'lightmap': 4096,
    'tiled': True,
    'world': ('#0a0c14', 0.22),
    'kicker': {'power': 140},
    'nav_start': 'gate_in',
}


def face_to(at, target):
    """Cast 'face' degrees for a figure at `at` looking at `target` (it faces -Y at 0)."""
    return math.degrees(math.atan2(target[0] - at[0], -(target[1] - at[1])))


def lights(sc):
    # Night: a cool moon for the key, the site lit by its own towers and lamps.
    key = C.area_light('key', (-7.0, -6.0, 10.0), (0.4, 0.35, 0.6), 2600, size=7.0, color='#c9d6ff')
    C.area_light('fill', (8.0, -6.5, 5.0), (-0.1, 0.1, 0.8), 700, size=6.0, color='#9fb2e0')
    # The two lighting towers, the office, the hut, the welding bay, the ground floor.
    C.area_light('tower_a', (-0.3, 3.75, 3.35), (-3.2, 0.5, 0.0), 900, size=0.9, color='#ffe8c2')
    C.area_light('tower_b', (2.6, -1.35, 3.35), (-1.5, -2.0, 0.0), 800, size=0.9, color='#ffe8c2')
    C.area_light('office_lamp', (OFFICE[0], OFFICE[1] + 0.2, 2.4), (OFFICE[0], OFFICE[1], 0), 90, size=1.2, color='#fff1dc')
    C.area_light('hut_lamp', (HUT[0], HUT[1], 2.25), (HUT[0], HUT[1], 0), 40, size=0.6, color='#fff1dc')
    C.area_light('weld_lamp', ((WELD[0] + WELD[1]) / 2, (WELD[2] + WELD[3]) / 2, 2.6), ((WELD[0] + WELD[1]) / 2, (WELD[2] + WELD[3]) / 2, 0), 160, size=1.6, color='#ffe2c0')
    C.area_light('floor_lamp', (-3.8, 3.2, 2.55), (-3.8, 2.4, 0), 180, size=1.4, color='#ffe7c9')
    C.point_light('gate_lamp', (6.25, -1.25, 2.6), 45, color='#ffcf8a', radius=0.06)
    return key


def build(col):
    P = META['plinth']
    ground = geo.textured('ground', 'gravelly_sand', tint='#a0917c', rough=0.95, scale=0.8)
    base = plinth.build(col, W, D, top=ground, radius=P['radius'],
                        strata=[(geo.mat(k, rough=0.9), t) for k, t in P['strata']], label=META['label'])
    rnd = C.Rand(23)
    slab = S.concrete('slab', tint='#a9a49b', scale=1.0)
    hard = geo.textured('hardstanding', 'smooth_concrete_floor', tint='#8e8a84', rough=0.9, scale=0.8)
    frame_c = S.concrete('frame_concrete', tint='#bdb7ad', scale=0.7)

    # ------------------------------------------------------------ ground
    x0, x1, y0, y1 = FRAME
    geo.box('ground_floor', (x1 - x0 + 0.4, y1 - y0 + 0.3, 0.02), ((x0 + x1) / 2, (y0 + y1) / 2 - 0.05, 0), col=col, material=slab, bev=0.004)
    # The haul road in from the gate, and the yard's hardstanding.
    geo.box('haul_road', (5.4, GATE[1] - GATE[0] + 0.3, 0.012), (HW - 2.8, (GATE[0] + GATE[1]) / 2, 0), col=col, material=hard, bev=0.002)
    geo.box('yard_pad', (3.8, 2.8, 0.012), (0.9, 0.2, 0), col=col, material=hard, bev=0.002)

    # ------------------------------------------------------------ the perimeter
    # Hoarding along the back and the left (away from the camera), see-through
    # mesh fencing along the gate side; the front is the model's cut.
    band = '#1f6f4a'
    for i, x in enumerate([-HW + 1.55 + 3.05 * k for k in range(4)]):
        h = S.hoarding(f'hoarding_back_{i}', w=3.0, band=band)
        geo.place(h, (x, HD - 0.15, 0))
        C.move_to(h, col)
    for i, y in enumerate([-HD + 1.5 + 3.0 * k for k in range(3)]):
        h = S.hoarding(f'hoarding_left_{i}', w=2.95, band=band)
        geo.place(h, (-HW + 0.15, y, 0), (0, 0, 90))
        C.move_to(h, col)
    sb = S.sign_board('site_board', ['CONSTRUCTSAFE', 'SITE 1 · TOWER 1', 'CCTV IN OPERATION'], w=2.2, h=0.8, paper='#1f6f4a', size=0.13, post=False)
    geo.place(sb, (-1.2, HD - 0.18, 0.75))
    C.move_to(sb, col)
    fence = S.heras('heras_proto')
    C.move_to(fence, col)
    for i, y in enumerate((-3.6, -2.0, 2.2, 3.7)):
        # The gate side: two panels each side of the gate.
        geo.instance(fence, f'heras_gate_{i}', (HW - 0.12, y, 0), (0, 0, 90), (1, 0.48 if abs(y) < 2.5 else 0.5, 1), col=col)
    geo.retire(fence)

    # ------------------------------------------------------------ the gate
    hut = S.hut('gate_hut')
    geo.place(hut, (HUT[0], HUT[1], 0), (0, 0, -90))  # its counter window faces the gate lane (-Y)
    C.move_to(hut, col)
    post = S.barrier_post('barrier_post')
    geo.place(post, (HW - 0.45, GATE[0] - 0.2, 0))
    C.move_to(post, col)
    arm = S.barrier_arm('barrier_arm', length=GATE[1] - GATE[0] + 0.25)
    geo.place(arm, (HW - 0.45, GATE[0] - 0.2, 0.9), (0, 0, 90))  # along +Y across the lane; the page lifts it
    C.move_to(arm, col)
    ppe = S.sign_board('ppe_sign', ['PPE REQUIRED', 'HARD HAT · MASK · VEST'], w=1.1, h=0.5, paper='#1f5fb4', size=0.07)
    geo.place(ppe, (HW - 1.6, GATE[0] - 0.75, 0), (0, 0, -20))
    C.move_to(ppe, col)
    tablet = R.plate('enrol_tablet', ['ENROL', 'photo + ID'], w=0.2, h=0.14, ink='#e4e4e7', paper='#1f2024', size=0.018)
    geo.place(tablet, (HUT[0] - 0.05, HUT[1] - 0.72, 1.12), (70, 0, 0))
    C.move_to(tablet, col)

    # ------------------------------------------------------------ the building going up
    cols_x = [x0 + 0.2, x0 + 1.75, x0 + 3.3, x1 - 0.2]
    cols_y = [y0 + 0.2, DECK_Y, y1 - 0.2]
    for i, x in enumerate(cols_x):
        for j, y in enumerate(cols_y):
            geo.box(f'column_{i}_{j}', (0.3, 0.3, DECK_Z), (x, y, 0), col=col, material=frame_c, bev=0.008)
    # Beams at the first floor, all round, and the deck cast over the back half.
    geo.box('beam_back', (x1 - x0, 0.3, 0.4), ((x0 + x1) / 2, y1 - 0.2, DECK_Z - 0.4), col=col, material=frame_c, bev=0.008)
    geo.box('beam_mid', (x1 - x0, 0.3, 0.4), ((x0 + x1) / 2, DECK_Y, DECK_Z - 0.4), col=col, material=frame_c, bev=0.008)
    geo.box('beam_front', (x1 - x0, 0.3, 0.4), ((x0 + x1) / 2, y0 + 0.2, DECK_Z - 0.4), col=col, material=frame_c, bev=0.008)
    for x in (cols_x[0], cols_x[-1]):
        geo.box(f'beam_side_{x:.1f}', (0.3, y1 - y0 - 0.4, 0.4), (x, (y0 + y1) / 2, DECK_Z - 0.4), col=col, material=frame_c, bev=0.008)
    geo.box('deck', (x1 - x0 + 0.1, y1 - DECK_Y + 0.15, 0.2), ((x0 + x1) / 2, (DECK_Y + y1) / 2, DECK_Z), col=col, material=slab, bev=0.01)
    # First-floor column stubs with their starter bars: the next lift to come.
    starters = S.starter_bars('starters_proto', n=3, h=0.8)
    C.move_to(starters, col)
    for i, x in enumerate(cols_x):
        geo.box(f'stub_{i}', (0.3, 0.3, 0.5), (x, y1 - 0.2, DECK_Z + 0.2), col=col, material=frame_c, bev=0.008)
        geo.instance(starters, f'stub_bars_{i}', (x, y1 - 0.2, DECK_Z + 0.7), col=col, role='set')
    geo.retire(starters)
    # Props (shores) under where the next bay of deck will be cast.
    for i, x in enumerate(cols_x[:-1]):
        for j, y in enumerate((y0 + 0.75, y0 + 1.15)):
            geo.tube(f'shore_{i}_{j}', [(x + 0.75, y, 0.02), (x + 0.75, y, DECK_Z - 0.4)], 0.03, col=col, material=S.galv('shore_galv'))
    # Block walls going up inside, a trestle, a stack of blocks and a mortar tub.
    blk = geo.pbr('blockwork', '#a8a39a', rough=0.9)
    geo.box('blockwall_left', (0.2, y1 - y0 - 0.9, 1.1), (x0 + 0.45, (y0 + y1) / 2 + 0.3, 0.02), col=col, material=blk, bev=0.004)
    geo.box('blockwall_back', (2.6, 0.2, 0.7), (x0 + 1.9, y1 - 0.5, 0.02), col=col, material=blk, bev=0.004)
    tr = S.trestle('trestle')
    geo.place(tr, (-2.55, 3.35, 0.02), (0, 0, 90))
    C.move_to(tr, col)
    bs = S.blocks_stack('blocks_indoor', n=3)
    geo.place(bs, (-4.9, 1.75, 0.02))
    C.move_to(bs, col)
    mt = S.mortar_tub('mortar_tub')
    geo.place(mt, (-3.9, 2.95, 0.02))
    C.move_to(mt, col)
    # The scaffold on the frame's face, three lifts, the ladder at its west end.
    sc = S.scaffold('scaffold', length=3.4, depth=0.8, lifts=(1.35, 2.7), bays=3, ladder_bay=0)
    geo.place(sc, (x0 + 2.0, y0 - 0.45, 0))
    C.move_to(sc, col)

    # ------------------------------------------------------------ groundworks
    # (Kept a body's width and more apart, so every part of it can be walked to.)
    rb = S.rebar_mat('rebar_mat', w=2.3, d=1.5)
    geo.place(rb, (-4.55, -3.0, 0))
    C.move_to(rb, col)
    fw = S.formwork('footing_a', w=1.4, d=0.9, h=0.45)
    geo.place(fw, (-2.35, -2.65, 0))
    C.move_to(fw, col)
    fw2 = S.formwork('footing_b', w=1.2, d=0.9, h=0.45)
    geo.place(fw2, (-5.15, -1.45, 0))
    C.move_to(fw2, col)
    for name, at in (('footing_a_bars', (-2.35, -2.65)), ('footing_b_bars', (-5.15, -1.45))):
        sb_ = S.starter_bars(name, n=3, h=0.75)
        geo.place(sb_, (at[0], at[1], 0.02))
        C.move_to(sb_, col)
    mx = S.mixer('mixer')
    geo.place(mx, (-0.95, -1.55, 0), (0, 0, 20))
    C.move_to(mx, col)
    drum = S.mixer_drum('mixer_drum')
    geo.place(drum, (-0.95 + 0.1, -1.55 + 0.04, 0.9), (0, 55, 20))
    C.move_to(drum, col)
    wb = S.wheelbarrow('wheelbarrow')
    geo.place(wb, (-1.35, -3.85, 0), (0, 0, 170))
    C.move_to(wb, col)
    cone = S.cone('cone_proto')
    C.move_to(cone, col)
    for i, (x, y) in enumerate(((-6.0, -4.0), (-3.0, -4.0), (-6.0, -2.05), (4.9, -1.05), (3.3, -1.05))):
        geo.instance(cone, f'cone_{i}', (x, y, 0), (0, 0, rnd.range(0, 90)), col=col)
    geo.retire(cone)

    # ------------------------------------------------------------ plant
    ex = S.excavator('excavator')
    geo.place(ex, (1.35, -3.05, 0), (0, 0, 8))
    C.move_to(ex, col)
    vn = S.van('site_van')
    geo.place(vn, (3.35, -1.75, 0), (0, 0, 84))
    C.move_to(vn, col)

    # ------------------------------------------------------------ the materials yard
    for i, (x, y, load, rot) in enumerate(((-0.35, 0.95, 'blocks', 4), (0.95, 0.95, 'blocks', -3), (2.25, 0.95, 'bags', 2))):
        pl = S.pallet(f'pallet_{i}', load=load)
        geo.place(pl, (x, y, 0.012), (0, 0, rot))
        C.move_to(pl, col)
    tm = S.timber_stack('timber', l=2.2)
    geo.place(tm, (1.05, -0.45, 0.012), (0, 0, 2))
    C.move_to(tm, col)
    sk = S.skip('skip')
    geo.place(sk, (-0.3, 3.55, 0), (0, 0, 90))
    C.move_to(sk, col)

    # ------------------------------------------------------------ the welding bay
    wx0, wx1, wy0, wy1 = WELD
    for i, (x, y, rot, w) in enumerate(((wx0 + 0.9, wy0, 0, 1.8), (wx0, (wy0 + wy1) / 2 + 0.3, 90, 1.6), (wx1 - 0.2, wy1 - 0.1, 0, 1.8))):
        scr = S.welding_screen(f'welding_screen_{i}', w=w, h=1.8, color='#b8321f' if i != 1 else '#2f6b3a')
        geo.place(scr, (x, y, 0), (0, 0, rot))
        C.move_to(scr, col)
    bench = S.workbench('workbench')
    geo.place(bench, (3.35, 3.25, 0))
    C.move_to(bench, col)
    gb = S.gas_bottles('gas_bottles')
    geo.place(gb, (4.8, 3.72, 0), (0, 0, -10))
    C.move_to(gb, col)
    bn = S.bin_('fire_bin')
    geo.place(bn, (4.75, 2.55, 0))
    C.move_to(bn, col)
    fp = S.extinguisher_point('fire_point')
    geo.place(fp, (2.3, 4.0, 0))
    C.move_to(fp, col)
    beam_tr = S.trestle('beam_trestle', w=1.4, h=0.7)
    geo.place(beam_tr, (2.85, 2.0, 0), (0, 0, 0))
    C.move_to(beam_tr, col)
    geo.box('steel_beam', (1.8, 0.14, 0.22), (2.85, 2.0, 0.74), col=col, material=S.rust('steel_beam', tint='#5a3f30'), bev=0.006)

    # ------------------------------------------------------------ the site office
    ox, oy = OFFICE
    cb = S.cabin('site_office', w=3.2, d=2.1, h=2.45, door_side='left', window=True, open_front=True)
    geo.place(cb, (ox, oy, 0))
    C.move_to(cb, col)
    dk = R.desk('office_desk', w=1.2, d=0.55)
    geo.place(dk, (ox + 0.55, oy + 0.55, 0.12))
    C.move_to(dk, col)
    scr = R.monitor_screen('dashboard_screen', 0.62, 0.36)
    geo.place(scr, (ox + 0.55, oy + 0.55 + 0.08 - 0.0175 - 0.003, 0.12 + 0.74 + 0.14 + 0.025))
    C.move_to(scr, col)
    pt = props.table('plan_table', w=1.0, d=0.6, h=0.9)
    geo.place(pt, (ox - 0.85, oy + 0.35, 0.12))
    C.move_to(pt, col)
    geo.box('plans', (0.8, 0.5, 0.004), (ox - 0.85, oy + 0.35, 1.02), col=col, material=geo.pbr('plans_paper', '#dfe6ee', rough=0.8), bev=0)
    board = R.plate('ppe_board', ['PPE: HARD HAT', 'MASK · VEST', 'ALERTS: 10 s', 'per camera'], w=0.5, h=0.34, size=0.035)
    geo.place(board, (ox - 0.2, oy + 1.0, 1.35))
    C.move_to(board, col)

    # ------------------------------------------------------------ lighting towers
    for i, (x, y, rot) in enumerate(((-0.3, 3.75, 200), (2.6, -1.35, 150))):
        lt = S.light_tower(f'light_tower_{i}', h=3.4)
        geo.place(lt, (x, y, 0), (0, 0, rot))
        C.move_to(lt, col)

    # ------------------------------------------------------------ the four cameras
    cams = {
        # CAM-01, the gate: on the hut, faces coming in through the gate.
        'cam01': ((HUT[0] - 0.62, HUT[1] - 0.66, 2.35), (HW - 0.2, -0.3, 1.1)),
        # CAM-02, the groundworks and the scaffold: on its pole at the front.
        'cam02': ((-0.95, -3.95, 3.1), (-4.1, -1.2, 0.6)),
        # CAM-03, indoor: on a column at the back of the ground floor.
        'cam03': ((x1 - 0.25, y1 - 0.4, 2.2), (-4.3, 1.6, 0.4)),
        # CAM-04, the welding bay ("High-Risk Zone"): on its pole by the yard.
        'cam04': ((1.55, 1.85, 2.9), (3.9, 3.2, 0.4)),
    }
    pole = S.camera_pole('cam_pole_proto', h=3.0)
    C.move_to(pole, col)
    for role in ('cam02', 'cam04'):
        (x, y, _), _ = cams[role]
        geo.instance(pole, f'pole_{role}', (x, y, 0), col=col, role='set')
    geo.retire(pole)
    for role, (pos, look) in cams.items():
        c = props.wall_camera(f'cam_{role}')
        yaw = math.degrees(math.atan2(-(look[0] - pos[0]), look[1] - pos[1]))  # its lens looks along -Y
        geo.place(c, pos, (0, 0, yaw + 180))
        C.move_to(c, col)

    # ------------------------------------------------------------ what the page needs to know
    gm = (GATE[0] + GATE[1]) / 2
    spots = {
        # The gate: in by the north half, out by the south (lane spots are walked through).
        'gate_in': {'at': (HW - 1.1, gm + 0.35), 'lane': True},
        'gate_out': {'at': (HW - 1.1, gm - 0.35), 'lane': True},
        'gate_road_in': {'at': (HW - 0.35, gm + 0.35), 'lane': True},
        'gate_road_out': {'at': (HW - 0.35, gm - 0.35), 'lane': True},
        'guard': {'at': (HUT[0], HUT[1] + 0.05), 'face': face_to((0, 0), (0, -1)), 'fixed': True},
        'enrol': {'at': (HUT[0] - 0.05, HUT[1] - 0.95), 'face': face_to((0, 0), (0, 1))},
        # The groundworks.
        'rebar_0': {'at': (-5.25, -2.75), 'face': face_to((0, 0), (0.3, -1))},
        'rebar_1': {'at': (-3.85, -3.4), 'face': face_to((0, 0), (-0.3, 1))},
        'form_a': {'at': (-2.35, -1.8), 'face': face_to((0, 0), (0, -1))},
        'form_b': {'at': (-4.3, -1.45), 'face': face_to((0, 0), (-1, 0))},
        'mixer': {'at': (-1.45, -2.25), 'face': face_to((0, 0), (0.6, 1))},
        'barrow': {'at': (-1.4, -3.2), 'face': face_to((0, 0), (0, -1))},
        # The scaffold's foot and the posed figures on its lifts.
        'scaffold_foot': {'at': (x0 + 0.55, y0 - 1.25), 'face': face_to((0, 0), (0, 1))},
        'scaffold_1': {'at': (x0 + 2.5, y0 - 0.45), 'face': face_to((0, 0), (0, 1)), 'fixed': True},
        'scaffold_2': {'at': (x0 + 1.2, y0 - 0.45), 'face': face_to((0, 0), (0, 1)), 'fixed': True},
        # The ground floor, indoors.
        'blockwork': {'at': (x0 + 0.95, 2.1), 'face': face_to((0, 0), (-1, 0))},
        'blocks': {'at': (-4.9, 1.2), 'face': face_to((0, 0), (0, 1))},
        'mortar': {'at': (-3.9, 2.35), 'face': face_to((0, 0), (0, 1))},
        'trestle': {'at': (-2.55, 2.55), 'face': face_to((0, 0), (0, 1))},
        # The yard.
        'yard_blocks': {'at': (0.3, 0.2), 'face': face_to((0, 0), (0, 1))},
        'yard_bags': {'at': (2.25, 0.2), 'face': face_to((0, 0), (0, 1))},
        'timber': {'at': (1.05, -1.1), 'face': face_to((0, 0), (0, 1))},
        'skip': {'at': (-0.3, 2.65), 'face': face_to((0, 0), (0, 1))},
        # The welding bay.
        'weld': {'at': (3.35, 2.58), 'face': face_to((0, 0), (0, 1))},
        'beam': {'at': (2.85, 1.35), 'face': face_to((0, 0), (0, 1))},
        'bottles': {'at': (4.62, 3.18), 'face': face_to((0, 0), (0.3, 1))},
        'fire_bin': {'at': (4.75, 2.55), 'fixed': True},
        'extinguisher': {'at': (2.3, 3.45), 'face': face_to((0, 0), (0, 1))},
        # The site office.
        'desk': {'at': (ox + 0.55, oy - 0.05), 'face': face_to((0, 0), (0, 1))},
        'plans': {'at': (ox - 0.85, oy - 0.25), 'face': face_to((0, 0), (0, 1))},
        'office_door': {'at': (ox - 2.0, oy + 0.05), 'lane': True},
        'van': {'at': (3.35, -0.85), 'face': face_to((0, 0), (0, -1))},
    }
    # Where people come and go: the road beyond the gate.
    portals = {'road': {'at': (HW - 0.1, gm), 'r': 0.45}}
    zones = {
        'gate': [(HW - 1.7, GATE[0] - 0.1), (HW - 0.05, GATE[0] - 0.1), (HW - 0.05, 0.62), (HW - 1.7, 0.62)],
        'groundworks': [(-HW + 0.3, -HD + 0.3), (-1.7, -HD + 0.3), (-1.7, -0.1), (-HW + 0.3, -0.1)],
        'ground_floor': [(x0 + 0.1, y0), (x1 - 0.05, y0), (x1 - 0.05, y1 - 0.05), (x0 + 0.1, y1 - 0.05)],
        'welding': [(wx0 - 0.1, wy0 - 0.9), (wx1, wy0 - 0.9), (wx1, wy1), (wx0 - 0.1, wy1)],
    }
    lines = {'gate': [(HW - 0.8, GATE[0] + 0.08), (HW - 0.8, GATE[1] - 0.08)]}
    cameras = {role: {'pos': pos, 'look': look, 'fov': 74, 'mount': 'wall'} for role, (pos, look) in cams.items()}
    paths = {}

    def worker(body, hair, top, skin, hair_c, vest, at, face, clip, phase, carry=(), scale=None, name=None, wear=('hat', 'mask')):
        e = {'body': f'{body}+vest', 'hair': hair, 'role': 'worker', 'wear': list(wear), 'carry': list(carry),
             'outfit': {'top': top, 'bottom': '#2e3238', 'skin': skin, 'hair': hair_c, 'vest': vest, 'strip': '#e8e8e0', 'accent': '#f2c230'},
             'clip': clip, 'at': at, 'face': face, 'phase': phase}
        if scale:
            e['scale'] = scale
        if name:
            e['name'] = name
        return e

    def at(k):
        return spots[k]['at']

    def fc(k):
        return spots[k]['face']

    cast = [
        # The guard in the hut, and the supervisor in the office.
        {'body': 'body_b', 'hair': 'short', 'role': 'guard', 'fixed': True, 'wear': ['cap'], 'name': 'Suresh',
         'outfit': {'top': '#2b3a55', 'bottom': '#1f2126', 'skin': C.MAT['skin_c'], 'hair': '#141111', 'accent': '#2b3a55'},
         'clip': 'idle', 'at': at('guard'), 'face': fc('guard'), 'phase': 0.3},
        {'body': 'body_a+vest', 'hair': 'crop', 'role': 'supervisor', 'wear': ['hat', 'mask'], 'carry': ['clipboard'], 'name': 'Priya',
         'outfit': {'top': '#f2f0ea', 'bottom': '#2e3238', 'skin': C.MAT['skin_b'], 'hair': '#1a1512', 'vest': '#f2c230', 'strip': '#e8e8e0', 'accent': '#f2f0ea'},
         'clip': 'type', 'at': at('desk'), 'face': fc('desk'), 'phase': 0.2},
        # Workers, one to a district.
        worker('body_b', 'short', '#4d5a6b', C.MAT['skin_c'], '#141111', '#ff7a1a', at('rebar_0'), fc('rebar_0'), 'hammer', 0.1, carry=('hammer',), name='Ravi'),
        worker('body_a', 'crop', '#6b4a3a', C.MAT['skin_b'], '#241c16', '#f2c230', at('form_a'), fc('form_a'), 'hammer', 0.5, carry=('hammer',), name='Arun'),
        worker('body_c', 'ponytail', '#3f4b3a', C.MAT['skin_a'], '#3b2a20', '#ff7a1a', at('blockwork'), fc('blockwork'), 'fold', 0.3, name='Meena'),
        worker('body_b', 'crop', '#5e6b5c', C.MAT['skin_c'], '#1c1612', '#f2c230', at('mortar'), fc('mortar'), 'sweep', 0.6, carry=('broom',), name='Karthik'),
        worker('body_a', 'short', '#2f3a4a', C.MAT['skin_a'], '#2a2320', '#ff7a1a', at('weld'), fc('weld'), 'weld', 0.2, carry=('torch',), name='Vijay'),
        worker('body_c', 'bun', '#8a5a44', C.MAT['skin_b'], '#241c16', '#f2c230', at('yard_blocks'), fc('yard_blocks'), 'carry', 0.4, carry=('box',), name='Divya'),
        worker('body_b', 'quiff', '#4c5d78', C.MAT['skin_c'], '#141111', '#ff7a1a', at('mixer'), fc('mixer'), 'idle', 0.7, name='Mani'),
        # A new starter walking in from the road: not enrolled yet.
        worker('body_a', 'curly', '#7a1f2b', C.MAT['skin_b'], '#1a1512', '#f2c230', (HW - 1.3, gm + 0.35), face_to((0, 0), (-1, 0)), 'walk', 0.0, name='new starter'),
        # On the scaffold's lifts: posed, working.
        worker('body_b', 'short', '#4d5a6b', C.MAT['skin_a'], '#241c16', '#ff7a1a', at('scaffold_1'), fc('scaffold_1'), 'hammer', 0.35, carry=('hammer',), name='Anil'),
        worker('body_c', 'crop', '#3f4b3a', C.MAT['skin_c'], '#141111', '#f2c230', at('scaffold_2'), fc('scaffold_2'), 'idle', 0.55, name='Lakshmi'),
    ]
    # The two on the scaffold stand on its lifts (heights for the page).
    cast[-2]['role'] = 'scaffolder'
    cast[-2]['lift'] = 1.35 + 0.064
    cast[-1]['role'] = 'scaffolder'
    cast[-1]['lift'] = 2.7 + 0.064

    return {'plinth': {k: v for k, v in base.items() if k != 'parts'}, 'anchors': {}, 'paths': paths, 'cast': cast,
            'spots': spots, 'zones': zones, 'cameras': cameras, 'lines': lines, 'portals': portals}
