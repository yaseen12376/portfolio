"""
03 FinMind: the verification works.

The product (HYDRABATH_HACK/ai-money-mentor) answers money questions in seven
stages: input, memory, a deterministic calculation, retrieval from official
documents, the context, a local LLM, and five safety checks. The island is
that pipeline as a small factory, and the whole of it is the laptop: a
question comes in through the door, rides a conveyor past a station for each
stage, and leaves as an answer at the counter. Nothing else crosses the wall.

  - the kiosk: seven tool lecterns (FIRE, health score, tax, life events,
    couples, portfolio X-ray, scam shield), where a question is put in a tray
  - the memory archive: profile, goals, history and prefs cabinets (SQLite)
  - the calculation engine: a press that prints the steps, and the rules
    binders for the two tax years
  - the library: four bookcases holding exactly 49, 6, 8 and 50 books, one
    per passage ingested from SEBI and the Income Tax Department (113), with
    the vector and keyword catalogues and the fusion (RRF) table
  - the context desk: the four folders the model reads
  - the scribe's booth: the local model (Ollama, qwen3.5:4b), glassed in
  - the safety line: five gates across the belt, one per check, and the
    trust dial
  - the counter: the answer handed out in EN, HI, TE or TA
  - the lounge inside the belt's U: a planning table showing the
    1,000-scenario fan while people wait

Coordinates: Blender, metres, Z up. The open front faces -Y (the camera
side); the door and the street are on the +X edge.
"""

from __future__ import annotations

import math

import common as C
from kit import geo, plinth, props, retail as R, works as K

W, D = 12.2, 8.0
HW, HD = W / 2, D / 2
X0, X1 = -5.85, 4.62          # the works' left wall and right (low) wall
Y0, Y1 = -3.68, 3.6           # the front (low) wall and the back wall
WALL_H = 2.4
LOW_H = 0.95                  # the right wall: low, so the camera sees in
DOOR = (-3.63, -2.83)         # the door's opening, along Y, in the right wall
BELT_X = (-3.6, 2.9)          # the belt's two legs
BELT_Y = 1.2                  # its back bar
BELT_START = -1.6             # where a question's tray is put on (left leg)
BELT_END = -1.72              # where the answer comes off (right leg)
BELT_W = 0.42
BELT_H = 0.8
GATES_Y = (0.35, 0.0, -0.35, -0.7, -1.05)
BOOTH = (3.3, 4.55, 0.0, 1.55)    # the scribe's glass booth: x0, x1, y0, y1
TOOLS = ('FIRE', 'HEALTH', 'TAX', 'LIFE', 'COUPLES', 'X-RAY', 'SCAM')

META = {
    'id': 'finmind',
    'label': '03 / FINMIND',
    'plinth': {'w': W, 'd': D, 'radius': 0.3, 'strata': [('screed', 0.06), ('soil', 0.2), ('stone', 0.16)]},
    'view': {'yaw': 31, 'pitch': 37, 'fov': 26, 'margin': 1.03},
    'post': {'focus': 0.5, 'band': 0.24, 'ramp': 0.34, 'bloom': 0.4, 'bloomThreshold': 0.95, 'sat': 1.04, 'vignette': 0.28,
             'case': {'band': 0.34, 'ramp': 0.4, 'blurAmount': 0.55}},
    'lightmap': 4096,
    'tiled': True,
    'world': ('#0e1119', 0.3),
    'kicker': {'power': 150},
    'nav_start': 'door_in',
}


def face_to(at, target):
    """Cast 'face' degrees for a figure at `at` looking at `target` (it faces -Y at 0)."""
    return math.degrees(math.atan2(target[0] - at[0], -(target[1] - at[1])))


def lights(sc):
    key = C.area_light('key', (8.5, -7.5, 9.0), (-0.3, 0.2, 0.5), 4600, size=6.0, color='#fff3e6')
    C.area_light('fill', (-8.0, -6.0, 4.5), (0, 0, 0.8), 1100, size=5.5, color='#d9e2ff')
    # A pendant over each station, the scribe's lamp, the lounge table, the street lamp.
    for i, (x, y, p) in enumerate(((-3.3, -2.8, 70), (-5.0, -0.2, 60), (-5.2, 2.3, 60), (-2.7, 2.6, 70), (-0.2, 2.6, 70),
                                   (2.6, 2.5, 60), (2.9, -0.35, 70), (3.4, -2.3, 60), (-0.35, -0.45, 55))):
        C.area_light(f'pendant{i}', (x, y, 2.55), (x, y, 0), p, size=0.9, color='#ffe9d2')
    C.area_light('booth_lamp', (3.95, 0.8, 2.1), (3.95, 0.8, 0), 45, size=0.8, color='#fff1d6')
    C.point_light('street_lamp', (5.9, 1.9, 2.7), 55, color='#ffcf8a', radius=0.08)
    return key


def build(col):
    P = META['plinth']
    floor = geo.textured('terrazzo', 'terrazzo_tiles', tint='#d9d3c7', rough=0.5, scale=0.45)
    base = plinth.build(col, W, D, top=floor, radius=P['radius'],
                        strata=[(geo.mat(k, rough=0.9), t) for k, t in P['strata']], label=META['label'])
    wall = geo.textured('wall', 'white_plaster_02', tint='#efe9df', rough=0.85, scale=0.7, strength=0.6)
    accent = geo.pbr('wall_accent', '#1c3350', rough=0.95, spec=0.1)
    trim = geo.pbr('trim_navy', K.NAVY, rough=0.7, spec=0.1)

    # ------------------------------------------------------------ the shell: the edge of the machine
    geo.box('wall_back', (X1 - X0 + 0.1, 0.1, WALL_H), ((X0 + X1) / 2, Y1 + 0.05, 0), col=col, material=wall, bev=0.01)
    geo.box('wall_left', (0.1, Y1 - Y0 + 0.1, WALL_H), (X0 - 0.05, (Y0 + Y1) / 2, 0), col=col, material=wall, bev=0.01)
    geo.box('wall_back_band', (X1 - X0 - 0.2, 0.012, 0.5), ((X0 + X1) / 2, Y1 - 0.006, WALL_H - 0.62), col=col, material=accent, bev=0)
    geo.box('wall_front', (X1 - X0 + 0.1, 0.12, 0.42), ((X0 + X1) / 2, Y0 - 0.06, 0), col=col, material=wall, bev=0.01)
    geo.box('wall_right_a', (0.12, DOOR[0] - Y0 + 0.06, LOW_H), (X1 + 0.06, (Y0 - 0.06 + DOOR[0]) / 2, 0), col=col, material=wall, bev=0.01)
    geo.box('wall_right_b', (0.12, Y1 - DOOR[1] + 0.1, LOW_H), (X1 + 0.06, (DOOR[1] + Y1 + 0.1) / 2, 0), col=col, material=wall, bev=0.01)
    for name, (x, y, w, d) in {'cap_front': ((X0 + X1) / 2, Y0 - 0.06, X1 - X0 + 0.14, 0.16),
                               'cap_right_a': (X1 + 0.06, (Y0 - 0.06 + DOOR[0]) / 2, 0.16, DOOR[0] - Y0 + 0.1),
                               'cap_right_b': (X1 + 0.06, (DOOR[1] + Y1 + 0.1) / 2, 0.16, Y1 - DOOR[1] + 0.14)}.items():
        h = 0.42 if name == 'cap_front' else LOW_H
        geo.box(name, (w, d, 0.035), (x, y, h), col=col, material=trim, bev=0.006)
    geo.box('skirt_back', (X1 - X0 - 0.1, 0.02, 0.1), ((X0 + X1) / 2, Y1 - 0.01, 0), col=col, material=trim, bev=0.003)
    geo.box('skirt_left', (0.02, Y1 - Y0 - 0.1, 0.1), (X0 + 0.01, (Y0 + Y1) / 2, 0), col=col, material=trim, bev=0.003)
    # What the wall is: the laptop's edge. Said on the front, where the camera reads it.
    ms = K.plaque('machine_sign', ['ON THIS MACHINE  ·  YOUR FINANCES NEVER LEAVE IT'], 4.6, 0.16, 0.075)
    geo.place(ms, (-1.2, Y0 - 0.12, 0.13))
    C.move_to(ms, col)
    sb = R.sign('works_sign', 'FINMIND', w=1.5, h=0.26)
    geo.place(sb, (-1.6, Y1 - 0.04, 2.1))
    C.move_to(sb, col)

    # ------------------------------------------------------------ the street and the door
    pave = geo.textured('pavement', 'patterned_paving_02', tint='#9a958d', rough=0.8, scale=0.5)
    geo.box('pavement', (HW - 0.12 - (X1 + 0.12), D - 0.7, 0.03), ((X1 + 0.12 + HW - 0.12) / 2, 0, 0), col=col, material=pave, bev=0.004)
    geo.box('door_mat', (0.7, DOOR[1] - DOOR[0] - 0.08, 0.012), (X1 - 0.4, sum(DOOR) / 2, 0), col=col,
            material=geo.textured('mat', 'rubber_tiles', tint='#2e3b4a', rough=0.9, scale=0.5), bev=0.003)
    for y in DOOR:
        geo.box(f'door_post_{y:.2f}', (0.14, 0.1, 2.1), (X1 + 0.06, y + (0.05 if y == DOOR[1] else -0.05), 0), col=col, material=trim, bev=0.008)
    geo.box('door_lintel', (0.14, DOOR[1] - DOOR[0] + 0.2, 0.12), (X1 + 0.06, sum(DOOR) / 2, 2.1), col=col, material=trim, bev=0.008)
    pb = K.post_box('post_box')
    geo.place(pb, (5.45, -1.4, 0.03))
    C.move_to(pb, col)
    lp = R.lamp_post('street_lamp', h=2.8)
    geo.place(lp, (5.9, 1.9, 0.03))
    C.move_to(lp, col)
    for i, y in enumerate((0.4, 2.6)):
        pl = props.plant(f'street_plant_{i}', h=0.8, leaves=9, seed=31 + i)
        geo.place(pl, (5.5, y, 0.03))
        C.move_to(pl, col)
    # The internet box on the right wall by the door, its cable out to the street.
    rt = K.router('router')
    geo.place(rt, (X1 - 0.04, -2.3, 0.62), (0, 0, 90))
    C.move_to(rt, col)
    pg = K.plug('router_plug')
    geo.place(pg, (X1 - 0.02, -2.3 + 0.07, 0.56), (0, 0, 90))
    C.move_to(pg, col)
    geo.tube('router_cable', [(X1 + 0.02, -2.23, 0.57), (X1 + 0.1, -2.2, 0.4), (X1 + 0.15, -2.1, 0.04), (5.3, -1.6, 0.04)], 0.008, col=col, material=geo.pbr('cable', '#15161a', rough=0.6))

    # ------------------------------------------------------------ the conveyor
    bx0, bx1 = BELT_X
    t = BELT_W / 2
    left = K.belt('belt_left', length=(BELT_Y - t) - (BELT_START - 0.15), w=BELT_W, h=BELT_H)
    geo.place(left, (bx0, ((BELT_Y - t) + (BELT_START - 0.15)) / 2, 0), (0, 0, 90))
    C.move_to(left, col)
    back = K.belt('belt_back', length=(bx1 - t) - (bx0 + t), w=BELT_W, h=BELT_H)
    geo.place(back, ((bx0 + bx1) / 2, BELT_Y, 0))
    C.move_to(back, col)
    right = K.belt('belt_right', length=(BELT_Y - t) - (BELT_END - 0.1), w=BELT_W, h=BELT_H)
    geo.place(right, (bx1, ((BELT_Y - t) + (BELT_END - 0.1)) / 2, 0), (0, 0, 90))
    C.move_to(right, col)
    for i, x in enumerate(BELT_X):
        tt = K.belt_turn(f'belt_turn_{i}', w=BELT_W, h=BELT_H)
        geo.place(tt, (x, BELT_Y, 0))
        C.move_to(tt, col)
    # The hopper a question is dropped into, at the head of the belt.
    geo.box('hopper', (BELT_W + 0.06, 0.24, BELT_H + 0.12), (bx0, BELT_START - 0.27, 0), col=col, material=K.navy(), bev=0.01)
    geo.box('hopper_lip', (BELT_W + 0.1, 0.06, 0.04), (bx0, BELT_START - 0.38, BELT_H + 0.12), col=col, material=geo.pbr('hopper_emerald', K.EMERALD, rough=0.4), bev=0.004)

    # ------------------------------------------------------------ the kiosk
    for i, title in enumerate(TOOLS):
        b = K.booth(f'booth_{i}', title)
        geo.place(b, (-5.35 + 0.68 * i, -3.1, 0))
        C.move_to(b, col)

    # ------------------------------------------------------------ the memory archive
    for i, (title, y) in enumerate(zip(('PROFILE', 'GOALS', 'HISTORY', 'PREFS'), (-1.25, -0.55, 0.15, 0.85))):
        cab = K.cabinet(f'cabinet_{i}', title)
        geo.place(cab, (X0 + 0.35, y, 0), (0, 0, 90))
        C.move_to(cab, col)
    asg = K.plaque('archive_sign', ['MEMORY', 'SQLITE'], 0.9, 0.2, 0.05)
    geo.place(asg, (X0 + 0.01, -0.2, 1.62), (0, 0, 90))
    C.move_to(asg, col)

    # ------------------------------------------------------------ the calculation engine
    ex, ey = X0 + 0.65, Y1 - 0.62
    en = K.press('engine')
    geo.place(en, (ex, ey, 0))
    C.move_to(en, col)
    rm = K.ram('engine_ram')
    geo.place(rm, (ex, ey + 0.02, 1.22))
    C.move_to(rm, col)
    # A pneumatic tube, overhead (clear of heads), carries each printed sheet to the belt's corner.
    geo.tube('sheet_tube', [(ex, ey + 0.1, 1.72), (ex, ey + 0.1, 2.05), (ex + 0.5, ey - 0.4, 2.12), (bx0 - 0.1, BELT_Y + 0.25, 2.1), (bx0, BELT_Y, 1.95), (bx0, BELT_Y, 1.62)],
             0.04, col=col, material=geo.pbr('tube_glass', '#b9d3dc', rough=0.08, metal=0.1))
    geo.cyl('tube_mouth', 0.06, 0.1, (bx0, BELT_Y, 1.55), col=col, material=K.steel(), verts=20, bev=0.004)
    bs = K.binder_shelf('binders')
    geo.place(bs, (X0 + 0.15, 1.45, 0), (0, 0, 90))
    C.move_to(bs, col)
    for i, (year, colr) in enumerate((('2025-26', '#3f5a3a'), ('2026-27', '#1c3350'))):
        bd = K.binder(f'binder_{year.replace("-", "_")}', year, colr)
        geo.place(bd, (X0 + 0.14, 1.45 + 0.34 - i * 0.1, 1.65), (0, 0, 90))
        C.move_to(bd, col)

    # ------------------------------------------------------------ the library
    books = (
        ('SEBI', 'MF INVESTOR FAQs · 49', 49, '#2f4a6b'),
        ('SEBI', 'REGULAR AND DIRECT · 6', 6, '#3f5a3a'),
        ('INCOME TAX DEPT', 'NEW VS OLD REGIME · 8', 8, '#6b2f3a'),
        ('INCOME TAX DEPT', 'SALARIED AY 2026-27 · 50', 50, '#6b5a2f'),
    )
    for i, (who, what, n, tint) in enumerate(books):
        bc = K.bookcase(f'bookcase_{i}', n=n, seed=7 + i, title=(who, what), tint=tint)
        geo.place(bc, (-3.3 + 1.25 * i, Y1 - 0.16, 0))
        C.move_to(bc, col)
    for name, x, title in (('catalogue_vector', -4.2, ('VECTOR', 'QDRANT · BGE-M3')), ('catalogue_keyword', 1.3, ('KEYWORD', 'FTS5 · BM25'))):
        cat = K.catalogue(name, title)
        geo.place(cat, (x, Y1 - 0.24, 0))
        C.move_to(cat, col)
    mt = K.table('rrf_table', w=0.8, d=0.45)
    geo.place(mt, (2.1, 2.45, 0))
    C.move_to(mt, col)
    rp = K.plaque('rrf_plate', ['RRF · k 60 · TOP 4'], 0.44, 0.08, 0.034)
    geo.place(rp, (2.1, 2.3, 0.9))
    C.move_to(rp, col)

    # ------------------------------------------------------------ the context desk
    cd = K.table('context_desk', w=0.95, d=0.5)
    geo.place(cd, (3.6, 2.45, 0))
    C.move_to(cd, col)
    fo = K.folders('folders')
    geo.place(fo, (3.6, 2.45, 0.9))
    C.move_to(fo, col)
    cp = K.plaque('context_plate', ['CONTEXT', 'num-ctx 8192'], 0.44, 0.12, 0.032)
    geo.place(cp, (3.6, 2.2, 0.9))
    C.move_to(cp, col)

    # ------------------------------------------------------------ the scribe's booth: the local model
    x0, x1, y0, y1 = BOOTH
    fr, glass = R.glass_wall('booth_south', x1 - x0, h=1.8, door=(-0.05, 0.6), panes=3)
    geo.place(fr, ((x0 + x1) / 2, y0, 0))
    for g in glass:
        g.location = (g.location[0] + (x0 + x1) / 2, g.location[1] + y0, g.location[2])
    fr2, glass2 = R.glass_wall('booth_north', x1 - x0, h=1.8, panes=3)
    geo.place(fr2, ((x0 + x1) / 2, y1, 0))
    for g in glass2:
        g.location = (g.location[0] + (x0 + x1) / 2, g.location[1] + y1, g.location[2])
    fr3, glass3 = R.glass_wall('booth_west', y1 - y0, h=1.8, door=(-0.2, 0.2), panes=3)
    geo.place(fr3, (x0, (y0 + y1) / 2, 0), (0, 0, 90))
    for g in glass3:
        lx, ly = g.location[0], g.location[1]
        g.location = (x0 - ly, (y0 + y1) / 2 + lx, g.location[2])
        g.rotation_euler = (0, 0, math.radians(90))
    fr4, glass4 = R.glass_wall('booth_east', y1 - y0, h=1.8, panes=3)
    geo.place(fr4, (x1, (y0 + y1) / 2, 0), (0, 0, 90))
    for g in glass4:
        lx, ly = g.location[0], g.location[1]
        g.location = (x1 - ly, (y0 + y1) / 2 + lx, g.location[2])
        g.rotation_euler = (0, 0, math.radians(90))
    for o in (fr, fr2, fr3, fr4, *glass, *glass2, *glass3, *glass4):
        C.move_to(o, col)
    wd = K.writing_desk('writing_desk')
    geo.place(wd, (x0 + 0.28, (y0 + y1) / 2, 0), (0, 0, 90))
    C.move_to(wd, col)
    board = geo.box('token_board', (0.9, 0.006, 0.5), ((x0 + x1) / 2 + 0.05, y1 - 0.05, 1.1), col=col,
                    material=geo.pbr('token_screen', '#0a192f', rough=1.0, spec=0.0, emit='#0a192f', emit_strength=0.5), bev=0, role='dyn')
    del board
    bsg = K.plaque('booth_sign', ['LOCAL MODEL', 'OLLAMA · QWEN3.5:4B'], 1.0, 0.16, 0.042, ink=K.GLOW, glow=K.GLOW)
    geo.place(bsg, ((x0 + x1) / 2, y0 - 0.04, 1.86))
    C.move_to(bsg, col)

    # ------------------------------------------------------------ the safety line
    for i, (gy, title) in enumerate(zip(GATES_Y, K.GATE_NAMES)):
        g = K.gate(f'gate_{i}', title)
        geo.place(g, (bx1, gy, 0))
        C.move_to(g, col)
        arm = K.stamp_arm(f'gate_arm_{i}')
        geo.place(arm, (bx1, gy, 0.98))
        C.move_to(arm, col)
    geo.box('dial_post', (0.06, 0.06, 1.35), (3.45, -1.35, 0), col=col, material=K.navy(), bev=0.006)
    dial = K.dial_face('trust_dial')
    geo.place(dial, (3.45, -1.39, 1.33))
    C.move_to(dial, col)
    dp = K.plaque('dial_plate', ['TRUST 0 TO 100'], 0.3, 0.06, 0.026)
    geo.place(dp, (3.45, -1.395, 1.1))
    C.move_to(dp, col)

    # ------------------------------------------------------------ the counter
    ct = K.counter('counter', w=0.9, d=0.45)
    geo.place(ct, (3.55, -2.05, 0), (0, 0, 90))
    C.move_to(ct, col)
    for f in K.fins('counter_fins', w=0.9):
        lx, ly = f.location[0], f.location[1]
        f.location = (3.55 - ly, -2.05 + lx, f.location[2])
        f.rotation_euler = (0, 0, math.radians(90))
        C.move_to(f, col)

    # ------------------------------------------------------------ the lounge
    pt, screen = K.planning_table('planning_table')
    geo.place(pt, (-0.35, -0.45, 0))
    # (The screen's origin is its own centre, at the table's top: keep that height.)
    screen.location = (-0.35, -0.45, screen.location.z)
    C.move_to(pt, col)
    C.move_to(screen, col)
    wc = K.water_cooler('water_cooler')
    geo.place(wc, (-2.95, 0.55, 0))
    C.move_to(wc, col)
    for i, (x, y) in enumerate(((2.3, 0.55), (-5.4, -3.2))):
        pl = props.plant(f'plant_{i}', h=0.95, leaves=9, seed=11 + i)
        geo.place(pl, (x, y, 0))
        C.move_to(pl, col)
    for i, (x, y) in enumerate(((-4.1, -2.8), (-4.9, -0.2), (-5.2, 2.3), (-2.7, 2.6), (-0.2, 2.6), (2.6, 2.5), (-0.35, -0.45))):
        pd = K.pendant(f'pendant_{i}', drop=0.75 if i == 6 else 0.8, top=WALL_H + 0.25)
        geo.place(pd, (x, y, 0))
        C.move_to(pd, col)

    # ------------------------------------------------------------ what the page needs to know
    spots = {
        # The door (walked through), and the street beyond it.
        'door_in': {'at': (X1 - 0.35, DOOR[1] - 0.2), 'lane': True},
        'door_out': {'at': (X1 - 0.35, DOOR[0] + 0.2), 'lane': True},
        'street_in': {'at': (X1 + 0.5, DOOR[1] - 0.2), 'lane': True},
        'street_out': {'at': (X1 + 0.5, DOOR[0] + 0.2), 'lane': True},
        # The counter: the clerk at the belt's end, visitors at its windows.
        'clerk': {'at': (2.95, -2.25), 'face': face_to((0, 0), (1, 0))},
        'pickup_a': {'at': (4.15, -1.7), 'face': face_to((0, 0), (-1, 0))},
        'pickup_b': {'at': (4.15, -2.4), 'face': face_to((0, 0), (-1, 0))},
        # The safety line and the scribe (in the booth, at the hatch).
        'inspector': {'at': (3.62, -0.62), 'face': face_to((0, 0), (-1, 0))},
        'scribe': {'at': (x0 + 0.85, (y0 + y1) / 2), 'face': face_to((0, 0), (-1, 0))},
        # The context desk and the fusion table, the library, the engine.
        'context': {'at': (3.6, 3.0), 'face': face_to((0, 0), (0, -1))},
        'merge': {'at': (2.1, 3.0), 'face': face_to((0, 0), (0, -1))},
        'keyword': {'at': (1.3, 2.8), 'face': face_to((0, 0), (0, 1))},
        'shelf_0': {'at': (-3.3, 2.85), 'face': face_to((0, 0), (0, 1))},
        'shelf_1': {'at': (-2.05, 2.85), 'face': face_to((0, 0), (0, 1))},
        'shelf_2': {'at': (-0.8, 2.85), 'face': face_to((0, 0), (0, 1))},
        'shelf_3': {'at': (0.45, 2.85), 'face': face_to((0, 0), (0, 1))},
        'vector': {'at': (-4.2, 2.8), 'face': face_to((0, 0), (0, 1))},
        'binders': {'at': (X0 + 0.7, 1.45), 'face': face_to((0, 0), (-1, 0))},
        'engine': {'at': (ex, ey - 0.8), 'face': face_to((0, 0), (0, 1))},
        # The memory archive: a cabinet each, and the belt's side.
        'cab_0': {'at': (X0 + 1.0, -1.25), 'face': face_to((0, 0), (-1, 0))},
        'cab_1': {'at': (X0 + 1.0, -0.55), 'face': face_to((0, 0), (-1, 0))},
        'cab_2': {'at': (X0 + 1.0, 0.15), 'face': face_to((0, 0), (-1, 0))},
        'cab_3': {'at': (X0 + 1.0, 0.85), 'face': face_to((0, 0), (-1, 0))},
        'archive': {'at': (bx0 - t - 0.3, -0.2), 'face': face_to((0, 0), (1, 0))},
        # The lounge, round the planning table.
        'plan_n0': {'at': (-0.85, 0.45), 'face': face_to((0, 0), (0, -1))},
        'plan_n1': {'at': (0.15, 0.45), 'face': face_to((0, 0), (0, -1))},
        'plan_s0': {'at': (-0.85, -1.38), 'face': face_to((0, 0), (0, 1))},
        'plan_s1': {'at': (0.15, -1.38), 'face': face_to((0, 0), (0, 1))},
        'plan_w': {'at': (-1.78, -0.45), 'face': face_to((0, 0), (1, 0))},
        'plan_e': {'at': (1.08, -0.45), 'face': face_to((0, 0), (-1, 0))},
        'cooler': {'at': (-2.45, 0.55), 'face': face_to((0, 0), (-1, 0))},
    }
    # The kiosk: a visitor's place at each tool's lectern.
    for i in range(len(TOOLS)):
        spots[f'booth_{i}'] = {'at': (-5.35 + 0.68 * i, -2.52), 'face': face_to((0, 0), (0, -1))}
    portals = {'street': {'at': (HW - 0.25, sum(DOOR) / 2), 'r': 0.45}}
    zones = {
        'kiosk': [(X0 + 0.1, Y0 + 0.05), (-1.0, Y0 + 0.05), (-1.0, -2.15), (X0 + 0.1, -2.15)],
        'archive': [(X0 + 0.05, -1.7), (bx0 - t - 0.05, -1.7), (bx0 - t - 0.05, 1.2), (X0 + 0.05, 1.2)],
        'engine': [(X0 + 0.05, 1.2), (bx0 - t - 0.05, 1.2), (bx0 - t - 0.05, Y1 - 0.05), (X0 + 0.05, Y1 - 0.05)],
        'library': [(bx0 - t - 0.05, BELT_Y + t + 0.05), (1.7, BELT_Y + t + 0.05), (1.7, Y1 - 0.05), (bx0 - t - 0.05, Y1 - 0.05)],
        'context': [(1.7, BELT_Y + t + 0.05), (X1 - 0.05, BELT_Y + t + 0.05), (X1 - 0.05, Y1 - 0.05), (1.7, Y1 - 0.05)],
        'scribe': [(x0 + 0.02, y0 + 0.02), (x1 - 0.02, y0 + 0.02), (x1 - 0.02, y1 - 0.02), (x0 + 0.02, y1 - 0.02)],
        'safety': [(bx1 + t + 0.05, -1.3), (X1 - 0.05, -1.3), (X1 - 0.05, y0 - 0.02), (bx1 + t + 0.05, y0 - 0.02)],
        'counter': [(2.5, Y0 + 0.05), (X1 - 0.05, Y0 + 0.05), (X1 - 0.05, -1.3), (2.5, -1.3)],
        'lounge': [(bx0 + t + 0.05, -1.75), (bx1 - t - 0.05, -1.75), (bx1 - t - 0.05, BELT_Y - t - 0.05), (bx0 + t + 0.05, BELT_Y - t - 0.05)],
        'door': [(X1 - 0.75, DOOR[0]), (X1 + 0.05, DOOR[0]), (X1 + 0.05, DOOR[1]), (X1 - 0.75, DOOR[1])],
    }
    # The belt's centre line, from where a tray is put on to where it comes off.
    lines = {'belt': [(bx0, BELT_START), (bx0, BELT_Y), (bx1, BELT_Y), (bx1, BELT_END)],
             'door': [(X1 - 0.02, DOOR[0] + 0.06), (X1 - 0.02, DOOR[1] - 0.06)]}
    paths = {}
    cameras = {}

    def at(k):
        return spots[k]['at']

    def fc(k):
        return spots[k]['face']

    staff = {'top': '#2c4466', 'bottom': '#262a31', 'badge': K.EMERALD, 'accent': K.EMERALD}

    def worker(role, body, hair, skin, hair_c, spot, clip, phase, name, carry=(), wear=(), top=None):
        e = {'body': body, 'hair': hair, 'role': role, 'name': name, 'carry': list(carry), 'wear': list(wear),
             'outfit': {**staff, 'skin': skin, 'hair': hair_c, **({'top': top} if top else {})},
             'clip': clip, 'at': at(spot), 'face': fc(spot), 'phase': phase}
        return e

    def visitor(body, hair, skin, hair_c, top, bottom, at_, face, clip, phase, name, carry=(), party=None, scale=None, accent=None):
        e = {'body': body, 'hair': hair, 'role': 'visitor', 'name': name, 'carry': list(carry),
             'outfit': {'top': top, 'bottom': bottom, 'skin': skin, 'hair': hair_c, 'accent': accent or top},
             'clip': clip, 'at': at_, 'face': face, 'phase': phase}
        if party:
            e['party'] = party
        if scale:
            e['scale'] = scale
        return e

    cast = [
        # The works' staff, one at each station (each does several jobs).
        worker('archivist', 'body_c', 'bun', C.MAT['skin_b'], '#241c16', 'cab_1', 'fold', 0.2, 'Ananya', carry=('clipboard',)),
        worker('keeper', 'body_b', 'short', C.MAT['skin_c'], '#141111', 'engine', 'type', 0.5, 'Farhan', wear=('glasses',)),
        worker('librarian', 'body_a', 'long', C.MAT['skin_a'], '#3b2a20', 'shelf_1', 'browse', 0.3, 'Kavya', carry=('card',)),
        worker('librarian', 'body_b', 'crop', C.MAT['skin_b'], '#1c1612', 'keyword', 'scan', 0.6, 'Joseph', carry=('card',)),
        worker('clerk', 'body_a', 'quiff', C.MAT['skin_c'], '#141111', 'context', 'fold', 0.1, 'Sameer', carry=('clipboard',)),
        worker('scribe', 'body_c', 'ponytail', C.MAT['skin_b'], '#1a1512', 'scribe', 'type', 0.4, 'Deepa', wear=('glasses',)),
        worker('inspector', 'body_b', 'curly', C.MAT['skin_a'], '#2a2320', 'inspector', 'point', 0.7, 'Imran', carry=('clipboard',)),
        worker('counter', 'body_c', 'bob', C.MAT['skin_c'], '#231a14', 'clerk', 'talk', 0.2, 'Meera'),
        # Visitors, spread over the kiosk, the lounge and the counter, and one coming in.
        visitor('body_b', 'quiff', C.MAT['skin_b'], '#241c16', '#3f6f5d', '#2b2d33', at('booth_0'), fc('booth_0'), 'scan', 0.3, 'Arjun', carry=('phone',)),
        visitor('body_c', 'long', C.MAT['skin_a'], '#5a3a22', '#c9b79c', '#3a3530', at('booth_5'), fc('booth_5'), 'point', 0.5, 'Fatima'),
        visitor('body_a', 'short', C.MAT['skin_c'], '#141111', '#6f7f94', '#2d3340', at('plan_s0'), fc('plan_s0'), 'talk', 0.1, 'Vikram', party=1),
        visitor('body_c', 'bob', C.MAT['skin_b'], '#3b2a20', '#d8b4a0', '#3a3530', at('plan_s1'), fc('plan_s1'), 'point', 0.4, 'Nisha', party=1, carry=('bag',)),
        visitor('body_b', 'curly', C.MAT['skin_a'], '#1c1612', '#b89452', '#23262d', at('pickup_a'), fc('pickup_a'), 'pay', 0.6, 'Gopal', carry=('card',)),
        visitor('body_a', 'ponytail', C.MAT['skin_c'], '#231a14', '#7a1f2b', '#1f2126', (X1 + 0.6, DOOR[1] - 0.2), face_to((0, 0), (-1, 0)), 'walk', 0.0, 'Lakshmi'),
    ]

    return {'plinth': {k: v for k, v in base.items() if k != 'parts'}, 'anchors': {}, 'paths': paths, 'cast': cast,
            'spots': spots, 'zones': zones, 'cameras': cameras, 'lines': lines, 'portals': portals}
