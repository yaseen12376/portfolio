"""
01 Retail Analytics: a high-street store, boxed (v2).

A cut-away store on a street corner, big enough that every feature of the
platform (Buttons/README.md) has a district of its own, seen from the home
view, with aisles people can pass in:

  - the street and the entrance: automatic double doors, the entrance camera's
    counting line just inside, a perimeter camera on the facade; passers-by on
    the pavement who never go in (and are never counted)
  - the shop floor: two garment rails people can move, two display tables, a
    window display: browsing, heatmaps, journeys
  - the fitting rooms: three booths whose curtains draw shut (dwell, loitering,
    and a person the camera can't see whose ID is kept)
  - the denim wall
  - the checkout: the till, a four-place queue lane: POS matching, parties
  - back of house, behind a low partition: the manager's glass office (the live
    dashboard on the desk monitor, facing out), the staff and stock room with
    the badge reader at its door (consent), and a service door to the alley
  - six cameras, one per role: entrance, checkout, floor, stockroom,
    staff_only, perimeter

People only come and go through two places the camera can't see: the passage
through the next building (the arcade) and the alley behind the store.

Coordinates: Blender, metres, Z up. The open front of the store faces -Y (the
camera side), the shopfront runs along +X with the street beyond it.
"""

from __future__ import annotations

import math

import common as C
from kit import geo, plinth, props, retail as R

W, D = 11.4, 7.6
HW, HD = W / 2, D / 2
WALL_H = 2.4
LEFT_X = -HW + 0.24          # the left wall's centre line
BACK_Y = 2.9                 # the store's back wall; the service alley is behind it
FRONT_X = 3.2                # the shopfront line; the street is beyond it
FRONT_Y = -HD + 0.1          # the open front edge of the floor
DOOR = (-0.7, 0.9)           # the double doors' opening, along Y (south of the stock room)
CUT = 0.9                    # the shopfront glazing is cut away at this height, as a model's is
DOOR_H = 1.5                 # and the doorway, a little higher, so the doors still read as doors
PART_Y = 1.1                 # the back-of-house partition
PART_H = 1.45
OFFICE_X = (0.0, 1.3)        # the manager's office, x range
STAFF_DOOR = (1.6, 2.5)      # the staff and stock room's door in the partition, x range (0.9 m: two can pass at a squeeze)
SERVICE = (1.8, 2.7)         # the service door in the back wall, x range
TILL = (-4.55, -1.3)         # the counter's centre
QUEUE_Y = -2.8
ROPE_Y = -2.2
ARCH = (3.6, 4.8)            # the arcade passage through the next building, x range
BLOCK_Y = 2.2                # the next building's south face

META = {
    'id': 'retail-analytics',
    'label': '01 / RETAIL ANALYTICS',
    'plinth': {'w': W, 'd': D, 'radius': 0.3, 'strata': [('screed', 0.06), ('soil', 0.2), ('stone', 0.16)]},
    'view': {'yaw': 30, 'pitch': 36, 'fov': 26, 'margin': 1.03},
    'post': {'focus': 0.5, 'band': 0.24, 'ramp': 0.34, 'bloom': 0.35, 'bloomThreshold': 1.0, 'sat': 1.05, 'vignette': 0.28,
             'case': {'band': 0.34, 'ramp': 0.4, 'blurAmount': 0.55}},
    'lightmap': 4096,
    'tiled': True,
    'world': ('#0f1016', 0.3),
    'kicker': {'power': 160},
    'nav_start': 'in_in',
}


def face_to(at, target):
    """Cast 'face' degrees for a figure at `at` looking at `target` (it faces -Y at 0)."""
    return math.degrees(math.atan2(target[0] - at[0], -(target[1] - at[1])))


def placed(obj, center, rot_deg, col):
    """Put a piece built around its own local offset at `center`, turned by
    `rot_deg` about Z (its local offset turns with it)."""
    a = math.radians(rot_deg)
    x, y, z = obj.location
    obj.location = (center[0] + x * math.cos(a) - y * math.sin(a), center[1] + x * math.sin(a) + y * math.cos(a), z + (center[2] if len(center) > 2 else 0))
    obj.rotation_euler = (0, 0, a)
    C.move_to(obj, col)
    return obj


def lights(sc):
    key = C.area_light('key', (8.0, -7.0, 9.0), (-0.4, 0.3, 0.5), 5200, size=6.0, color='#fff3e6')
    C.area_light('fill', (-7.5, -5.5, 4.5), (0, 0, 0.8), 1300, size=5.5, color='#d9e2ff')
    # Practicals: track lights over each district, the office desk, the street lamp.
    for i, (x, y, p) in enumerate(((-3.9, 1.9, 75), (-1.2, 1.9, 70), (-1.0, -0.2, 80), (1.0, -0.9, 80), (-3.2, -1.8, 80),
                                   (2.6, -2.6, 60), (0.65, 2.0, 45), (2.3, 2.0, 45), (2.6, 0.5, 60))):
        C.area_light(f'track{i}', (x, y, 2.75), (x, y, 0), p, size=1.3, color='#ffe9d2')
    C.point_light('street_lamp', (4.9, -0.8, 2.75), 60, color='#ffcf8a', radius=0.08)
    C.point_light('arcade_lamp', (4.2, 2.8, 2.05), 18, color='#ffc27a', radius=0.05)
    return key


def build(col):
    P = META['plinth']
    floor = geo.textured('parquet', 'herringbone_parquet', tint='#c2a88a', rough=0.45, scale=0.3)
    base = plinth.build(col, W, D, top=floor, radius=P['radius'],
                        strata=[(geo.mat(k, rough=0.9), t) for k, t in P['strata']], label=META['label'])

    wall = geo.textured('wall', 'white_plaster_02', tint='#e9e6e0', rough=0.85, scale=0.7, strength=0.6)
    accent = geo.textured('wall_accent', 'painted_plaster_wall', tint='#5e6b5c', rough=0.85, scale=0.6, strength=0.6)
    trim = geo.mat('trim', rough=0.5)
    steel = R.steel()
    rnd = C.Rand(11)

    # ------------------------------------------------------------ shell
    geo.box('wall_back_a', (SERVICE[0] - LEFT_X + 0.04, 0.08, WALL_H), ((LEFT_X - 0.04 + SERVICE[0]) / 2, BACK_Y, 0), col=col, material=wall, bev=0.01)
    geo.box('wall_back_b', (FRONT_X + 0.04 - SERVICE[1], 0.08, WALL_H), ((SERVICE[1] + FRONT_X + 0.04) / 2, BACK_Y, 0), col=col, material=wall, bev=0.01)
    geo.box('wall_back_lintel', (SERVICE[1] - SERVICE[0], 0.08, WALL_H - 2.15), (sum(SERVICE) / 2, BACK_Y, 2.15), col=col, material=wall, bev=0.01)
    geo.box('wall_left', (0.08, BACK_Y - FRONT_Y, WALL_H), (LEFT_X, (BACK_Y + FRONT_Y) / 2, 0), col=col, material=wall, bev=0.01)
    geo.box('wall_accent', (2.4, 0.01, WALL_H - 0.3), (-1.2, BACK_Y - 0.045, 0.1), col=col, material=accent, bev=0)
    geo.box('skirt_back', (FRONT_X - LEFT_X - 0.1, 0.02, 0.1), ((FRONT_X + LEFT_X) / 2, BACK_Y - 0.05, 0), col=col, material=trim, bev=0.003)
    geo.box('skirt_left', (0.02, BACK_Y - FRONT_Y - 0.1, 0.1), (LEFT_X + 0.05, (BACK_Y + FRONT_Y) / 2, 0), col=col, material=trim, bev=0.003)
    # Track lighting along the tops of the walls.
    geo.box('track_back', (FRONT_X - LEFT_X - 0.4, 0.05, 0.04), ((FRONT_X + LEFT_X) / 2, BACK_Y - 0.3, WALL_H - 0.08), col=col, material=steel, bev=0.004)
    geo.box('track_left', (0.05, BACK_Y - FRONT_Y - 0.6, 0.04), (LEFT_X + 0.3, (BACK_Y + FRONT_Y) / 2, WALL_H - 0.08), col=col, material=steel, bev=0.004)
    for i in range(11):
        x = LEFT_X + 0.6 + i * 0.78
        geo.cyl(f'spot_b{i}', 0.035, 0.1, (x, BACK_Y - 0.3, WALL_H - 0.19), rot=(20, 0, 0), col=col, material=steel, verts=14, bev=0.004)
    for i in range(7):
        y = FRONT_Y + 0.6 + i * 0.85
        geo.cyl(f'spot_l{i}', 0.035, 0.1, (LEFT_X + 0.3, y, WALL_H - 0.19), rot=(0, -20, 0), col=col, material=steel, verts=14, bev=0.004)

    # ------------------------------------------------------------ the shopfront
    y0, y1 = FRONT_Y + 0.02, BACK_Y + 0.04
    geo.box('sill_a', (0.14, DOOR[0] - y0, 0.12), (FRONT_X, (y0 + DOOR[0]) / 2, 0), col=col, material=steel, bev=0.006)
    geo.box('sill_b', (0.14, y1 - DOOR[1], 0.12), (FRONT_X, (DOOR[1] + y1) / 2, 0), col=col, material=steel, bev=0.006)
    south = [y0 + 0.02, -2.4, -1.55, DOOR[0] - 0.14]
    north = [DOOR[1] + 0.14, 1.95, y1 - 0.02]
    for y in south + north:
        geo.box(f'mullion_{y:.2f}', (0.05, 0.05, CUT), (FRONT_X, y, 0), col=col, material=steel, bev=0.004)
    for i, (a_, b_) in enumerate(((y0, DOOR[0] - 0.12), (DOOR[1] + 0.12, y1))):
        geo.box(f'cut_rail_{i}', (0.07, b_ - a_ - 0.02, 0.04), (FRONT_X, (a_ + b_) / 2, CUT), col=col, material=steel, bev=0.004)
    glass = geo.pbr('shop_glass', '#b9d3dc', rough=0.05, alpha=0.2)
    for side in (south, north):
        for i in range(len(side) - 1):
            a_, b_ = side[i] + 0.03, side[i + 1] - 0.03
            geo.box(f'pane_{a_:.2f}', (0.012, b_ - a_, CUT - 0.13), (FRONT_X, (a_ + b_) / 2, 0.12), col=col, material=glass, bev=0, role='prop')
    # The doorway, cut away like the glazing (a model's shopfront): posts, the
    # automatic doors, the shutter's housing over them, and the shop's name on
    # a blade sign standing out from the facade, where the camera can read it.
    for y in (DOOR[0] - 0.08, DOOR[1] + 0.08):
        geo.box(f'portal_{y:.2f}', (0.14, 0.12, DOOR_H + 0.1), (FRONT_X, y, 0), col=col, material=steel, bev=0.008)
    for leaf in R.sliding_door('door', w=DOOR[1] - DOOR[0], h=DOOR_H - 0.02):
        placed(leaf, (FRONT_X + 0.02, sum(DOOR) / 2, 0.02), 90, col)
    housing, shutter = R.roller_shutter('shutter', w=DOOR[1] - DOOR[0] + 0.12, h=DOOR_H - 0.02)
    placed(housing, (FRONT_X + 0.13, sum(DOOR) / 2), 90, col)
    placed(shutter, (FRONT_X + 0.13, sum(DOOR) / 2, DOOR_H - 0.02), 90, col)
    shutter.scale = (1, 1, 0.03)  # rolled up; the page lowers it at closing
    geo.box('blade_post', (0.04, 0.04, 2.35), (FRONT_X + 0.1, DOOR[0] - 0.3, 0), col=col, material=steel, bev=0.004)
    geo.box('blade_arm', (0.7, 0.03, 0.03), (FRONT_X + 0.42, DOOR[0] - 0.3, 2.22), col=col, material=steel, bev=0.004)
    blade = R.sign('fascia', 'ATELIER', w=0.62, h=0.24)
    geo.place(blade, (FRONT_X + 0.44, DOOR[0] - 0.3, 1.9))
    C.move_to(blade, col)
    geo.box('entrance_mat', (0.9, DOOR[1] - DOOR[0] - 0.1, 0.012), (FRONT_X - 0.55, sum(DOOR) / 2, 0), col=col,
            material=geo.textured('mat', 'rubber_tiles', tint='#3a3a3e', rough=0.9, scale=0.5), bev=0.003)

    # ------------------------------------------------------------ the street
    pave = geo.textured('pavement', 'patterned_paving_02', tint='#9a958d', rough=0.8, scale=0.5)
    street_y = (FRONT_Y, BLOCK_Y)
    geo.box('pavement', (5.0 - FRONT_X - 0.06, street_y[1] - street_y[0], 0.035), ((FRONT_X + 0.06 + 5.0) / 2, sum(street_y) / 2, 0), col=col, material=pave, bev=0.004)
    geo.box('kerb', (0.12, street_y[1] - street_y[0], 0.06), (5.06, sum(street_y) / 2, 0), col=col,
            material=geo.textured('kerb', 'smooth_concrete_floor', tint='#b3aea6', rough=0.8, scale=0.5), bev=0.012)
    geo.box('road', (HW - 0.05 - 5.12, BLOCK_Y - FRONT_Y + 0.05, 0.02), ((5.12 + HW - 0.05) / 2, (FRONT_Y - 0.05 + BLOCK_Y) / 2, 0), col=col,
            material=geo.textured('road', 'asphalt_02', tint='#3b3c40', rough=0.9, scale=0.35), bev=0.003)
    geo.box('road_line', (0.06, BLOCK_Y - FRONT_Y - 0.3, 0.004), (HW - 0.25, (FRONT_Y + BLOCK_Y) / 2, 0.02), col=col, material=geo.pbr('road_paint', '#e8e4d8', rough=0.7), bev=0)
    lamp = R.lamp_post('lamp', h=2.7)
    geo.place(lamp, (4.85, -0.8, 0.035), (0, 0, -90))
    C.move_to(lamp, col)
    bol = geo.cyl('bollard_proto', 0.045, 0.62, (0, 0, 0), material=steel, verts=16, bev=0.01, role='prop')
    C.apply_modifiers(bol)
    C.apply_transform(bol, loc=True)
    C.move_to(bol, col)
    geo.retire(bol)
    for i, y in enumerate((-3.2, -2.4, 1.9)):
        geo.instance(bol, f'bollard_{i}', (4.85, y, 0.035), col=col)
    bn = R.bench('street_bench', w=1.2)
    geo.place(bn, (4.72, -1.75, 0.035), (0, 0, 90))  # faces the road
    C.move_to(bn, col)
    pl = R.planter('street_planter', w=0.9, d=0.4, h=0.42)
    geo.place(pl, (4.72, 0.55, 0.035), (0, 0, 90))
    C.move_to(pl, col)
    shrub = props.plant('shrub_proto', h=0.75, leaves=16, seed=5)
    C.move_to(shrub, col)
    geo.instance(shrub, 'shrub_0', (4.72, 0.55, 0.45), (0, 0, 40), (0.8, 0.8, 0.8), col=col)
    geo.instance(shrub, 'shrub_1', (4.75, -3.3, 0.035), (0, 0, 10), (0.85, 0.85, 0.85), col=col)

    # The next building: brick, with a passage through it (the arcade) where
    # the street carries on out of sight.
    brick = geo.textured('brick', 'red_brick_03', tint='#9c5b46', rough=0.85, scale=0.5)
    blk_h = 2.9
    geo.box('block_w', (ARCH[0] - FRONT_X - 0.06, BACK_Y + 0.04 - BLOCK_Y, blk_h), ((FRONT_X + 0.06 + ARCH[0]) / 2, (BLOCK_Y + BACK_Y + 0.04) / 2, 0), col=col, material=brick, bev=0.01)
    geo.box('block_e', (HW - 0.05 - ARCH[1], HD - 0.05 - BLOCK_Y, blk_h), ((ARCH[1] + HW - 0.05) / 2, (BLOCK_Y + HD - 0.05) / 2, 0), col=col, material=brick, bev=0.01)
    geo.box('block_lintel', (ARCH[1] - ARCH[0], 0.4, blk_h - 2.2), (sum(ARCH) / 2, BLOCK_Y + 0.2, 2.2), col=col, material=brick, bev=0.01)
    geo.box('block_roof', (HW - 0.05 - FRONT_X - 0.06, HD - 0.05 - BLOCK_Y, 0.12), ((FRONT_X + 0.06 + HW - 0.05) / 2, (BLOCK_Y + HD - 0.05) / 2, blk_h), col=col,
            material=geo.pbr('roof_felt', '#3a3b40', rough=0.9), bev=0.01)
    geo.box('passage_floor', (ARCH[1] - ARCH[0], HD - 0.1 - BLOCK_Y, 0.03), (sum(ARCH) / 2, (BLOCK_Y + HD - 0.1) / 2, 0), col=col,
            material=geo.textured('passage_tiles', 'terrazzo_tiles', tint='#5e5852', rough=0.6, scale=0.4), bev=0.004)
    for i, z in enumerate((0.9, 1.75)):
        geo.box(f'block_window_{i}', (0.7, 0.02, 0.55), ((ARCH[1] + HW) / 2, BLOCK_Y - 0.01, z), col=col,
                material=geo.pbr('dark_glass', '#1c2530', rough=0.1, emit='#ffcf8a', emit_strength=0.25), bev=0.004)
    geo.box('arcade_sign', (0.9, 0.03, 0.16), (sum(ARCH) / 2, BLOCK_Y - 0.02, 2.4), col=col,
            material=geo.pbr('arcade_sign', '#1f2024', emit='#f3d7a6', emit_strength=0.5), bev=0.006)

    # ------------------------------------------------------------ the checkout
    till = R.cash_wrap('cash_wrap', w=2.0, d=0.65)
    geo.place(till, (TILL[0], TILL[1], 0), (0, 0, 90))  # customer side faces +X
    C.move_to(till, col)
    st = R.stanchion('stanchion_proto')
    C.move_to(st, col)
    posts = [(-3.5, ROPE_Y), (-2.7, ROPE_Y), (-1.9, ROPE_Y), (-1.1, ROPE_Y)]
    for i, (x, y) in enumerate(posts):
        geo.instance(st, f'stanchion_{i}', (x, y, 0), col=col)
    geo.retire(st)
    for i in range(len(posts) - 1):
        rp = R.rope(f'rope_{i}', posts[i], posts[i + 1])
        C.move_to(rp, col)
        geo.tag(rp, 'set')
    ne = R.neon('neon', 'ATELIER', size=0.22)
    geo.place(ne, (LEFT_X + 0.05, TILL[1], 1.6), (0, 0, 90))
    C.move_to(ne, col)

    # ------------------------------------------------------------ fitting rooms
    booths = []
    for i, (x, c) in enumerate(((-4.85, '#6b5a4c'), (-3.8, '#4f5a52'), (-2.75, '#6f5f73'))):
        b, cur = R.booth(f'booth_{i}', w=1.0, d=1.1, curtain=c)
        geo.place(b, (x, BACK_Y - 0.04 - 0.55, 0))
        C.move_to(b, col)
        placed(cur, (x - 0.5, BACK_Y - 0.04 - 1.1 + 0.05, 0), 0, col)
        cur.scale = (0.26, 1, 1)  # gathered open; the page draws it shut
        booths.append(x)
    geo.box('fit_mirror', (0.02, 0.6, 1.6), (LEFT_X + 0.05, 0.7, 0.3), col=col, material=geo.pbr('mirror_w', '#a8b6bd', rough=0.06, metal=1.0), bev=0.003)
    geo.box('fit_mirror_frame', (0.03, 0.66, 1.66), (LEFT_X + 0.04, 0.7, 0.27), col=col, material=R.walnut('frame'), bev=0.006)
    # Against the side wall between the mirror and the first booth, clear of every booth's way in.
    geo.cyl('pouf', 0.24, 0.42, (-5.12, 1.38, 0), col=col, material=geo.textured('boucle', 'wool_boucle', tint='#cfc3b4', rough=0.95, scale=0.3), verts=28, bev=0.04)

    # ------------------------------------------------------------ the denim wall
    dw_w, dw_x = 2.0, -1.2
    dw = R.denim_wall('denim_wall', w=dw_w, h=2.0, cols=5, rows=5, d=0.32)
    dy = BACK_Y - 0.04 - 0.16
    geo.place(dw, (dw_x, dy, 0))
    C.move_to(dw, col)
    for c in range(5):
        for r in range(5):
            cx = dw_x - dw_w / 2 + (c + 0.5) * dw_w / 5
            z = 0.03 + r * (2.0 - 0.03) / 5
            for k in range(4 if r else 3):
                color = R.JEANS[(c + r + k) % len(R.JEANS)] if r != 4 else R.TEES[(c + k) % len(R.TEES)]
                maker = R.folded_jeans if r != 4 else R.folded_tee
                o = maker(f'stock_{c}_{r}_{k}', color, (cx + rnd.range(-0.01, 0.01), dy + 0.01, z + 0.004 + k * 0.044), rnd.range(-3, 3))
                C.move_to(o, col)
    fr = R.frame('print_0', 0.55, 0.72, ('#c8553d', '#e9e4da', '#3f4b3a'))
    geo.place(fr, (-5.4 + 0.05, -0.35, 1.3), (0, 0, 90))
    C.move_to(fr, col)
    ck = R.clock('clock')
    geo.place(ck, (LEFT_X + 0.05, 2.0 - 0.9, 2.05), (0, 0, 90))
    C.move_to(ck, col)

    # ------------------------------------------------------------ the floor
    # Far enough apart that someone browsing either table's end leaves room to pass between them.
    tables = {'table_1': (-0.75, -1.3, 5), 'table_2': (1.9, -1.35, -4)}
    for name, (tx, ty, rot) in tables.items():
        tbl = R.display_table(name, w=1.2, d=0.7)
        geo.place(tbl, (tx, ty, 0), (0, 0, rot))
        C.move_to(tbl, col)
        for i in range(4):
            for k in range(4 - (i % 2)):
                o = R.folded_tee(f'{name}_tee_{i}_{k}', R.TEES[(i * 2 + k + len(name)) % len(R.TEES)],
                                 (tx - 0.4 + i * 0.27, ty + (0.1 if i % 2 else -0.1), 0.72 + k * 0.03), rnd.range(-5, 5) + rot)
                C.move_to(o, col)
    # A planter closes the gap between the second table and the shopfront
    # (too narrow to walk: nobody should try).
    pt = R.planter('planter_front', w=0.8, d=0.36, h=0.42)
    geo.place(pt, (FRONT_X - 0.33, -1.35, 0), (0, 0, 90))
    C.move_to(pt, col)
    # The window display: two dress forms on a walnut plinth, turned to the street.
    geo.box('display', (0.8, 0.95, 0.1), (2.7, -2.85, 0), col=col, material=R.walnut('display'), bev=0.02)
    for i, (y, colors, rot) in enumerate(((-3.1, ('#a35d4f', '#2d3340'), 60), (-2.6, ('#e9e4da', '#4c5d78'), 75))):
        m = R.mannequin(f'mannequin_{i}', pose=i, top=colors[0], bottom=colors[1])
        geo.place(m, (2.7, y, 0.1), (0, 0, rot))
        C.move_to(m, col)
    # Two rails people can move (dyn), their shirts riding with them.
    rails = {}
    for name, (x, y, rot, colors) in {
        'rail_a': (-1.4, 0.35, 0, ['#e9e4da', '#6f7f94', '#c9b79c', '#a35d4f', '#3f4b3a', '#e9e4da', '#d8b4a0', '#6f7f94']),
        'rail_b': (0.9, -0.2, 0, ['#3f4b3a', '#d8b4a0', '#e9e4da', '#8a8f7a', '#a35d4f', '#c9b79c', '#2c3548', '#e9e4da']),
    }.items():
        r = R.rail(name, w=1.15, h=1.34)
        geo.place(r, (x, y, 0), (0, 0, rot))
        C.move_to(r, col)
        geo.tag(r, 'dyn', pick='drag', hint='Drag the rail')
        protos = {}
        for i, c in enumerate(colors):
            if c not in protos:
                protos[c] = R.shirt(f'{name}_shirt_{c[1:]}', c)
                C.move_to(protos[c], col)
            s_ = geo.instance(protos[c], f'{name}_shirt_{i}', (-0.44 + i * 0.125, 0.0, 1.34), (0, 0, 90 + (i % 3 - 1) * 7), col=col)
            s_.parent = r
        for p in protos.values():
            geo.retire(p)
        rails[name] = (x, y, rot)
    pl = props.plant('plant_proto', h=1.1, leaves=18, seed=3)
    C.move_to(pl, col)
    geo.instance(pl, 'plant_0', (LEFT_X + 0.35, -3.2, 0), (0, 0, 20), col=col)
    geo.instance(pl, 'plant_1', (-5.05, 0.05, 0), (0, 0, -40), (0.9, 0.9, 0.9), col=col)
    geo.retire(pl)

    # ------------------------------------------------------------ back of house
    part = geo.textured('partition', 'white_plaster_02', tint='#ddd5c8', rough=0.85, scale=0.7, strength=0.5)
    cap = R.walnut('cap')
    ox0, ox1 = OFFICE_X
    # The office: a glass front with a door, a partition to the stock room.
    frame, panes = R.glass_wall('office_front', ox1 - ox0, h=PART_H + 0.3, door=(-(ox1 - ox0) / 2 + 0.05, -(ox1 - ox0) / 2 + 0.55), panes=4)
    geo.place(frame, ((ox0 + ox1) / 2, PART_Y, 0))
    C.move_to(frame, col)
    for g in panes:
        g.location = (g.location[0] + (ox0 + ox1) / 2, g.location[1] + PART_Y, g.location[2])
        C.move_to(g, col)
    geo.box('office_side', (0.08, BACK_Y - PART_Y, PART_H + 0.3), (ox0, (PART_Y + BACK_Y) / 2, 0), col=col, material=part, bev=0.008)
    geo.box('office_div', (0.08, BACK_Y - PART_Y, PART_H), (ox1, (PART_Y + BACK_Y) / 2, 0), col=col, material=part, bev=0.008)
    geo.box('office_floor', (ox1 - ox0 - 0.08, BACK_Y - PART_Y - 0.08, 0.012), ((ox0 + ox1) / 2, (PART_Y + BACK_Y) / 2, 0), col=col,
            material=geo.textured('office_wood', 'wood_floor', tint='#8a6a4e', rough=0.6, scale=0.4), bev=0.002)
    # The desk faces the glass: its monitor shows the live dashboard to the
    # floor (and the camera); the manager works it from the side.
    dk = R.desk('desk', w=1.0, d=0.5)
    geo.place(dk, ((ox0 + ox1) / 2, 2.3, 0))
    C.move_to(dk, col)
    scr = R.monitor_screen('dashboard_screen', 0.56, 0.33)
    geo.place(scr, ((ox0 + ox1) / 2, 2.3 + 0.08 - 0.0175 - 0.003, 0.74 + 0.14 + 0.025))  # a box's origin is its base centre
    C.move_to(scr, col)
    # The staff and stock room: its front partition with the staff door, the
    # badge reader beside the door, lockers, racking, and the service door out.
    sd0, sd1 = STAFF_DOOR
    geo.box('part_a', (sd0 - ox1, 0.08, PART_H), ((ox1 + sd0) / 2, PART_Y, 0), col=col, material=part, bev=0.008)
    geo.box('part_b', (FRONT_X - sd1, 0.08, PART_H), ((sd1 + FRONT_X) / 2, PART_Y, 0), col=col, material=part, bev=0.008)
    geo.box('part_cap_a', (sd0 - ox1, 0.1, 0.03), ((ox1 + sd0) / 2, PART_Y, PART_H), col=col, material=cap, bev=0.006)
    geo.box('part_cap_b', (FRONT_X - sd1, 0.1, 0.03), ((sd1 + FRONT_X) / 2, PART_Y, PART_H), col=col, material=cap, bev=0.006)
    # On the partition beside the door, not over the doorway (it has no header:
    # a sign there would hang at head height).
    geo.box('staff_sign', (0.34, 0.012, 0.1), (sd1 + 0.28, PART_Y - 0.047, 1.12), col=col,
            material=geo.pbr('staff_sign', '#1f2024', emit='#f5d9a8', emit_strength=0.4), bev=0.004)
    br = R.badge_reader('badge_reader')
    geo.place(br, (sd0 - 0.18, PART_Y - 0.055, 1.05))
    C.move_to(br, col)
    lk = R.lockers('lockers', n=3, w=0.36, d=0.45, h=1.5)
    geo.place(lk, (ox1 + 0.25, 2.2, 0), (0, 0, -90))  # doors face +X, into the room
    C.move_to(lk, col)
    shelf = R.shelving('shelving', w=1.3, d=0.36, h=1.9)
    geo.place(shelf, (FRONT_X - 0.25, 2.05, 0), (0, 0, 90))
    C.move_to(shelf, col)
    ct = R.carton('carton_proto')
    C.move_to(ct, col)
    for i, (y, z) in enumerate(((1.6, 0.12), (2.05, 0.12), (2.5, 0.12), (1.7, 0.72), (2.3, 0.72), (1.9, 1.3), (2.45, 1.3), (1.75, 1.9))):
        geo.instance(ct, f'carton_{i}', (FRONT_X - 0.25, y, z), (0, 0, 90 + rnd.range(-6, 6)), (0.85, 0.85, 0.85), col=col)
    geo.retire(ct)
    sv = R.service_door('service_door')
    geo.place(sv, (sum(SERVICE) / 2, BACK_Y, 0))
    C.move_to(sv, col)
    # The alley behind the store: where staff come and go (and, after hours, someone else).
    geo.box('alley', (FRONT_X - LEFT_X, HD - 0.08 - BACK_Y - 0.04, 0.02), ((FRONT_X + LEFT_X) / 2, (BACK_Y + 0.04 + HD - 0.08) / 2, 0), col=col,
            material=geo.textured('alley', 'smooth_concrete_floor', tint='#7a7670', rough=0.9, scale=0.6), bev=0.002)

    # ------------------------------------------------------------ the store's six cameras
    cams = {
        'entrance': ((FRONT_X - 0.14, sum(DOOR) / 2, WALL_H - 0.08), (1.3, sum(DOOR) / 2 - 0.3, 0.1)),
        'checkout': ((LEFT_X + 0.1, -2.5, WALL_H - 0.1), (-3.7, -1.5, 0.5)),
        'floor': ((dw_x + 1.25, BACK_Y - 0.1, WALL_H - 0.08), (0.0, -1.2, 0.3)),
        'stockroom': ((FRONT_X - 0.12, BACK_Y - 0.12, 2.2), (2.2, 1.6, 0.3)),
        'staff_only': ((sd1 + 0.12, PART_Y - 0.06, PART_H - 0.06), ((sd0 + sd1) / 2 - 0.3, PART_Y - 1.0, 0.4)),
        'perimeter': ((FRONT_X + 0.12, -1.45, WALL_H - 0.2), (4.4, -3.2, 0.3)),
    }
    dome = props.dome_camera('dome_proto')
    C.move_to(dome, col)
    for role, (pos, look) in cams.items():
        if role in ('perimeter', 'staff_only'):
            c = props.wall_camera(f'cam_{role}')
            yaw = math.degrees(math.atan2(-(look[0] - pos[0]), look[1] - pos[1]))  # its lens looks along -Y
            geo.place(c, pos, (0, 0, yaw + 180))
            C.move_to(c, col)
        else:
            geo.instance(dome, f'cam_{role}', pos, col=col)
    geo.retire(dome)

    # ------------------------------------------------------------ what the page needs to know
    door_mid = sum(DOOR) / 2
    spots = {
        # The street and the door (keep right: in by the north half, out by the south).
        # (lane spots are walked through, never stood on: 'lane' keeps them out of the spacing check)
        'door_out': {'at': (FRONT_X + 0.6, door_mid), 'lane': True},
        'door_in': {'at': (FRONT_X - 0.7, door_mid), 'lane': True},
        'in_out': {'at': (FRONT_X + 0.6, door_mid + 0.35), 'lane': True},
        'in_in': {'at': (FRONT_X - 0.7, door_mid + 0.35), 'lane': True},
        'out_in': {'at': (FRONT_X - 0.7, door_mid - 0.35), 'lane': True},
        'out_out': {'at': (FRONT_X + 0.6, door_mid - 0.35), 'lane': True},
        'arcade_mouth': {'at': (sum(ARCH) / 2, BLOCK_Y - 0.45)},
        'window_view': {'at': (FRONT_X + 0.55, -2.6), 'face': face_to((0, 0), (-1, 0))},
        'bench_view': {'at': (4.35, -1.75), 'face': face_to((0, 0), (1, 0))},
        # The till.
        'pay': {'at': (TILL[0] + 0.62, -1.55), 'face': face_to((0, 0), (-1, 0))},
        'terminal': {'at': (TILL[0] + 0.14, -1.6), 'fixed': True},
        'cashier': {'at': (TILL[0] - 0.55, -1.3), 'face': face_to((0, 0), (1, 0)), 'fixed': True},
        # 0.7 m apart: two bodies and a little room (people queue with a gap).
        'queue_0': {'at': (-3.75, QUEUE_Y + 0.05), 'face': face_to((0, 0), (-0.4, 1))},
        'queue_1': {'at': (-3.05, QUEUE_Y), 'face': face_to((0, 0), (-1, 0))},
        'queue_2': {'at': (-2.35, QUEUE_Y), 'face': face_to((0, 0), (-1, 0))},
        'queue_3': {'at': (-1.65, QUEUE_Y), 'face': face_to((0, 0), (-1, 0))},
        # The floor.
        'table_front': {'at': (tables['table_1'][0], tables['table_1'][1] - 0.62), 'face': face_to((0, 0), (0, 1))},
        'table_side': {'at': (tables['table_1'][0] + 0.85, tables['table_1'][1]), 'face': face_to((0, 0), (-1, 0))},
        'fold': {'at': (tables['table_1'][0], tables['table_1'][1] + 0.62), 'face': face_to((0, 0), (0, -1))},
        'table_2': {'at': (tables['table_2'][0], tables['table_2'][1] + 0.62), 'face': face_to((0, 0), (0, -1))},
        'table_2_side': {'at': (tables['table_2'][0] - 0.85, tables['table_2'][1]), 'face': face_to((0, 0), (1, 0))},
        'denim': {'at': (dw_x - 0.6, dy - 0.55), 'face': face_to((0, 0), (0, 1))},
        'denim_2': {'at': (dw_x + 0.1, dy - 0.55), 'face': face_to((0, 0), (0, 1))},
        'denim_3': {'at': (dw_x + 0.8, dy - 0.55), 'face': face_to((0, 0), (0, 1))},
        'mannequins': {'at': (1.95, -2.55), 'face': face_to((0, 0), (1, -0.4))},
        # Fitting rooms.
        'fit_0': {'at': (booths[0], BACK_Y - 0.6), 'face': face_to((0, 0), (0, 1))},
        'fit_1': {'at': (booths[1], BACK_Y - 0.6), 'face': face_to((0, 0), (0, 1))},
        'fit_2': {'at': (booths[2], BACK_Y - 0.6), 'face': face_to((0, 0), (0, 1))},
        'fit_wait': {'at': (-3.2, 1.2), 'face': face_to((0, 0), (-0.3, 1))},
        'mirror': {'at': (LEFT_X + 0.62, 0.7), 'face': face_to((0, 0), (-1, 0))},
        # Back of house.
        'badge': {'at': (sd0 - 0.18, PART_Y - 0.4), 'face': face_to((0, 0), (0, 1))},
        'stock_door': {'at': ((sd0 + sd1) / 2 + 0.1, PART_Y - 0.5)},
        'stock_shelf': {'at': (FRONT_X - 0.72, 1.75), 'face': face_to((0, 0), (1, 0))},
        'lockers': {'at': (ox1 + 0.85, 2.4), 'face': face_to((0, 0), (-1, 0))},
        'office': {'at': ((ox0 + ox1) / 2 + 0.25, 1.62), 'face': face_to((0, 0), (-0.3, 1))},
        'office_door': {'at': (ox0 + 0.35, PART_Y - 0.45)},
        'service_out': {'at': (sum(SERVICE) / 2, BACK_Y + 0.42)},
    }
    for name, (x, y, rot) in rails.items():
        # Browse spots on both long sides of each rail, recomputed on the page when it moves.
        spots[f'{name}_front'] = {'at': (x, y - 0.45) if rot == 0 else (x + 0.45, y), 'rail': name, 'side': -1}
        spots[f'{name}_back'] = {'at': (x, y + 0.45) if rot == 0 else (x - 0.45, y), 'rail': name, 'side': 1}
    # Where people come and go: out of sight, through the next building and the alley.
    portals = {
        'arcade': {'at': (sum(ARCH) / 2, BLOCK_Y + 1.15), 'r': 0.5},
        'alley': {'at': (1.0, BACK_Y + 0.46), 'r': 0.35},
    }
    zones = {
        'entrance': [(FRONT_X - 1.0, DOOR[0] - 0.2), (FRONT_X - 0.06, DOOR[0] - 0.2), (FRONT_X - 0.06, DOOR[1] + 0.2), (FRONT_X - 1.0, DOOR[1] + 0.2)],
        'fitting': [(LEFT_X + 0.08, 0.95), (-2.15, 0.95), (-2.15, BACK_Y - 0.06), (LEFT_X + 0.08, BACK_Y - 0.06)],
        'denim': [(dw_x - 1.1, dy - 1.0), (dw_x + 1.1, dy - 1.0), (dw_x + 1.1, dy - 0.2), (dw_x - 1.1, dy - 0.2)],
        'till': [(-4.2, FRONT_Y + 0.15), (-1.0, FRONT_Y + 0.15), (-1.0, ROPE_Y + 0.05), (-3.45, ROPE_Y + 0.05), (-3.45, -0.35), (-4.2, -0.35)],
        'window': [(1.8, FRONT_Y + 0.15), (FRONT_X - 0.06, FRONT_Y + 0.15), (FRONT_X - 0.06, -2.0), (1.8, -2.0)],
    }
    lines = {'entrance': [(FRONT_X - 0.35, DOOR[0] + 0.08), (FRONT_X - 0.35, DOOR[1] - 0.08)]}
    cameras = {role: {'pos': pos, 'look': look, 'fov': 78 if role != 'perimeter' else 64,
                      'mount': 'wall' if role in ('perimeter', 'staff_only') else 'dome'} for role, (pos, look) in cams.items()}
    paths = {'street': [(4.2, FRONT_Y + 0.4), (4.2, BLOCK_Y - 0.4)]}

    staff = {'top': '#1d1d22', 'bottom': '#26262b', 'badge': '#8b5cf6', 'trim': '#1d1d22'}
    cast = [
        {'body': 'body_a', 'hair': 'crop', 'role': 'cashier', 'outfit': {**staff, 'skin': C.MAT['skin_b'], 'hair': '#1a1512'},
         'clip': 'type', 'at': spots['cashier']['at'], 'face': spots['cashier']['face'], 'phase': 0.2},
        {'body': 'body_c', 'hair': 'bun', 'role': 'staff', 'outfit': {**staff, 'skin': C.MAT['skin_a'], 'hair': '#3b2a20'},
         'clip': 'fold', 'at': spots['fold']['at'], 'face': spots['fold']['face'], 'phase': 0.4},
        {'body': 'body_b', 'hair': 'short', 'role': 'stock', 'carry': ['box'], 'outfit': {**staff, 'skin': C.MAT['skin_c'], 'hair': '#141111', 'accent': '#b58a5c'},
         'clip': 'carry', 'at': (2.25, 1.85), 'face': face_to((0, 0), (0, -1)), 'phase': 0.1},
        {'body': 'body_a', 'hair': 'crop', 'role': 'staff', 'wear': ['glasses'], 'outfit': {**staff, 'skin': C.MAT['skin_c'], 'hair': '#241c16'},
         'clip': 'point', 'at': spots['denim_3']['at'], 'face': spots['denim_3']['face'], 'phase': 0.3},
        {'body': 'body_b', 'hair': 'quiff', 'role': 'manager', 'outfit': {'top': '#2f3a4a', 'bottom': '#1f2126', 'skin': C.MAT['skin_a'], 'hair': '#2a2320', 'badge': '#8b5cf6'},
         'clip': 'point', 'at': spots['office']['at'], 'face': spots['office']['face'], 'phase': 0.5},
        {'body': 'body_b', 'hair': 'curly', 'role': 'shopper', 'carry': ['card'], 'outfit': {'top': '#3f6f5d', 'bottom': '#2b2d33', 'skin': C.MAT['skin_c'], 'hair': '#1c1612', 'accent': '#2f6fe0'},
         'clip': 'pay', 'at': spots['pay']['at'], 'face': spots['pay']['face'], 'phase': 0.3},
        {'body': 'body_a', 'hair': 'long', 'role': 'shopper', 'carry': ['bag'], 'outfit': {'top': '#c9b79c', 'bottom': '#3a3530', 'skin': C.MAT['skin_a'], 'hair': '#5a3a22', 'accent': '#c8553d'},
         'clip': 'queue', 'at': spots['queue_0']['at'], 'face': spots['queue_0']['face'], 'phase': 0.5},
        {'body': 'body_c', 'hair': 'ponytail', 'role': 'shopper', 'outfit': {'top': '#e9e4da', 'bottom': '#4c5d78', 'skin': C.MAT['skin_b'], 'hair': '#231a14'},
         'clip': 'browse', 'at': spots['rail_a_front']['at'], 'face': face_to(spots['rail_a_front']['at'], rails['rail_a'][:2]), 'phase': 0.3},
        {'body': 'body_a', 'hair': 'quiff', 'role': 'shopper', 'wear': ['glasses'], 'outfit': {'top': '#7a1f2b', 'bottom': '#1f2126', 'skin': C.MAT['skin_a'], 'hair': '#2a2320'},
         'clip': 'walk', 'at': (FRONT_X - 0.9, door_mid + 0.3), 'face': face_to((0, 0), (-1, 0)), 'phase': 0.0},
        {'body': 'body_b', 'hair': 'short', 'role': 'shopper', 'party': 1, 'outfit': {'top': '#6f7f94', 'bottom': '#2d3340', 'skin': C.MAT['skin_b'], 'hair': '#241c16'},
         'clip': 'idle', 'at': (1.55, -2.5), 'face': face_to((1.55, -2.5), (2.7, -2.85)), 'phase': 0.1},
        {'body': 'body_c', 'hair': 'bob', 'role': 'shopper', 'party': 1, 'carry': ['bag'], 'outfit': {'top': '#d8b4a0', 'bottom': '#3a3530', 'skin': C.MAT['skin_b'], 'hair': '#3b2a20', 'accent': '#e9e4da'},
         'clip': 'point', 'at': (2.1, -2.15), 'face': face_to((2.1, -2.15), (2.7, -2.85)), 'phase': 0.2},
        {'body': 'body_c', 'hair': 'quiff', 'role': 'shopper', 'party': 1, 'scale': 0.82, 'outfit': {'top': '#f59e0b', 'bottom': '#2d3340', 'skin': C.MAT['skin_b'], 'hair': '#241c16'},
         'clip': 'phone', 'carry': ['phone'], 'at': (1.0, -2.2), 'face': face_to((0, 0), (0.3, -1)), 'phase': 0.3},
        {'body': 'body_a', 'hair': 'bob', 'role': 'shopper', 'scale': 0.97, 'outfit': {'top': '#8a5a44', 'bottom': '#23262d', 'skin': C.MAT['skin_c'], 'hair': '#141111'},
         'clip': 'tryon', 'at': spots['fit_1']['at'], 'face': spots['fit_1']['face'], 'phase': 0.4},
        {'body': 'body_c', 'hair': 'long', 'role': 'shopper', 'outfit': {'top': '#3f4b3a', 'bottom': '#c9b79c', 'skin': C.MAT['skin_a'], 'hair': '#1a1512'},
         'clip': 'browse', 'at': spots['denim']['at'], 'face': spots['denim']['face'], 'phase': 0.6},
        {'body': 'body_b', 'hair': 'crop', 'role': 'shopper', 'outfit': {'top': '#4c5d78', 'bottom': '#2b2d33', 'skin': C.MAT['skin_b'], 'hair': '#141111'},
         'clip': 'browse', 'at': spots['table_2']['at'], 'face': spots['table_2']['face'], 'phase': 0.2},
        {'body': 'body_a', 'hair': 'ponytail', 'role': 'passer', 'carry': ['bag'], 'outfit': {'top': '#b89452', 'bottom': '#3a3530', 'skin': C.MAT['skin_c'], 'hair': '#231a14'},
         'clip': 'walk', 'at': (4.2, -0.2), 'face': face_to((0, 0), (0, -1)), 'phase': 0.5},
        {'body': 'body_b', 'hair': 'short', 'role': 'passer', 'outfit': {'top': '#5e6b5c', 'bottom': '#23262d', 'skin': C.MAT['skin_a'], 'hair': '#3b2a20'},
         'clip': 'walk', 'at': (4.35, 1.4), 'face': face_to((0, 0), (0, 1)), 'phase': 0.1},
    ]

    return {'plinth': {k: v for k, v in base.items() if k != 'parts'}, 'anchors': {}, 'paths': paths, 'cast': cast,
            'spots': spots, 'zones': zones, 'cameras': cameras, 'lines': lines, 'portals': portals}
