"""
Calibration: a corner of a clothing store, small enough to build in seconds,
that exercises every part of the pipeline once: the plinth, a baked set,
instanced props, a draggable (dyn) rail, and two animated figures.
"""

from __future__ import annotations

import math

import common as C
from kit import geo, plinth, props

META = {
    'id': '_calibration',
    'label': '00 / CALIBRATION',
    'plinth': {'w': 3.0, 'd': 2.2, 'top': ('terrazzo', {'rough': 0.42}),
               'strata': [('screed', 0.06), ('soil', 0.17), ('stone', 0.13)]},
    # Camera: look at `target` from `yaw` degrees right of front, `pitch`
    # degrees up; fit the `fit` box (width, height in metres) in frame.
    'view': {'yaw': 34, 'pitch': 30, 'fov': 28, 'margin': 1.05},
    'post': {'focus': 0.5, 'band': 0.17, 'ramp': 0.32, 'bloom': 0.28, 'sat': 1.06, 'vignette': 0.3},
    'lightmap': 1024,
    'atlas': 2048,
    'world': ('#101016', 0.35),
}


def lights(sc):
    key = C.area_light('key', (2.6, -2.4, 3.6), (0.1, 0.2, 0.4), 1100, size=2.4, color='#ffe6c7')
    C.area_light('fill', (-2.8, -2.2, 2.0), (0, 0, 0.6), 220, size=3.0, color='#c9d6ff')
    C.area_light('rim', (-1.6, 2.6, 2.6), (0, 0, 0.8), 200, size=1.6, color='#b9a6ff')
    return key


def build(col):
    P = META['plinth']
    top_key, top_kw = P['top']
    base = plinth.build(col, P['w'], P['d'], top=geo.textured('terrazzo', 'terrazzo_tiles', tint=C.MAT['terrazzo'], rough=0.42, scale=0.45),
                        strata=[(geo.mat(k, rough=0.9), t) for k, t in P['strata']], label=META['label'])

    hw, hd = P['w'] / 2, P['d'] / 2
    wall_h, wall_t = 2.35, 0.08
    wall = geo.textured('wall_warm', 'white_plaster_02', tint=C.MAT['wall_warm'], rough=0.85, scale=0.6, strength=0.7)
    trim = geo.mat('trim', rough=0.6)
    # Two walls: back (+Y) and left (-X). The front and right are open: the cut-away.
    geo.box('wall_back', (P['w'] - 0.18, wall_t, wall_h), (0.0, hd - 0.13, 0), col=col, material=wall, bev=0.01)
    geo.box('wall_left', (wall_t, P['d'] - 0.18, wall_h), (-hw + 0.13, 0.0, 0), col=col, material=wall, bev=0.01)
    geo.box('base_back', (P['w'] - 0.2, 0.02, 0.09), (0.0, hd - 0.18, 0), col=col, material=trim, bev=0.004)
    geo.box('base_left', (0.02, P['d'] - 0.2, 0.09), (-hw + 0.18, 0.0, 0), col=col, material=trim, bev=0.004)
    # A wall shelf with folded stock, and a mirror frame.
    geo.box('shelf', (0.22, 1.1, 0.03), (-hw + 0.28, 0.1, 1.38), col=col,
            material=geo.textured('shelf_oak', 'oak_veneer_01', tint=C.MAT['wood'], rough=0.5, scale=0.3), bev=0.006)
    geo.box('mirror_frame', (0.7, 0.03, 1.5), (0.55, hd - 0.18, 0.35), col=col, material=trim, bev=0.008)
    geo.box('mirror', (0.62, 0.012, 1.42), (0.55, hd - 0.2, 0.39), col=col,
            material=geo.pbr('mirror', '#8aa0ab', rough=0.04, metal=1.0), bev=0.002)
    geo.box('rug', (1.3, 0.85, 0.012), (0.35, -0.15, 0), col=col, material=geo.textured('rug', 'wool_boucle', tint='#5b4a63', rough=0.95, scale=0.35), bev=0.004)

    # The table, with stacks of folded tees (instanced).
    tbl = props.table('table', w=0.95, d=0.55, h=0.62)
    geo.place(tbl, (-0.55, 0.45, 0))
    C.move_to(tbl, col)
    tee = props.folded_tee('tee_proto', 'fabric_e')
    C.move_to(tee, col)
    tee_n = 0
    for i, (x, colr) in enumerate(((-0.82, 'fabric_e'), (-0.55, 'fabric_b'), (-0.28, 'fabric_c'))):
        proto = tee if colr == 'fabric_e' else props.folded_tee(f'tee_{colr}', colr)
        C.move_to(proto, col)
        for k in range(4):
            geo.instance(proto, f'tee_{tee_n}', (x, 0.45 + (k % 2) * 0.004, 0.62 + k * 0.03), (0, 0, (k % 2) * 3 - 1.5), col=col)
            tee_n += 1
        if proto is not tee:
            geo.retire(proto)
    # Folded stock on the shelf too.
    for k in range(3):
        geo.instance(tee, f'shelf_tee_{k}', (-hw + 0.28, -0.25 + k * 0.33, 1.41), (0, 0, 90), col=col)
    geo.retire(tee)

    # The garment rail: draggable, so 'dyn'. Its shirts are its children and
    # move with it; they share mesh data, so each colour is one instanced draw.
    r = props.rail('rail', w=1.15, h=1.3)
    geo.place(r, (0.55, 0.05, 0))
    C.move_to(r, col)
    geo.tag(r, 'dyn', pick='drag', hint='Drag the rail')
    protos = {c: props.shirt(f'shirt_{c}', c) for c in ('fabric_a', 'fabric_b', 'fabric_c', 'fabric_d')}
    for c, p in protos.items():
        C.move_to(p, col)
    order = ['fabric_a', 'fabric_b', 'fabric_c', 'fabric_a', 'fabric_d', 'fabric_b', 'fabric_c', 'fabric_d', 'fabric_a']
    for i, c in enumerate(order):
        # Local to the rail (which has no rotation), so no parent-inverse needed.
        s = geo.instance(protos[c], f'shirt_{i}', (-0.46 + i * 0.115, 0.0, 1.3), (0, 0, 90 + (i % 3 - 1) * 6), col=col)
        s.parent = r
    for p in protos.values():
        geo.retire(p)

    # Plants and stools: repeated, so instanced.
    pl = props.plant('plant_proto', h=0.95, seed=3)
    C.move_to(pl, col)
    geo.instance(pl, 'plant_0', (-hw + 0.35, hd - 0.35, 0), (0, 0, 20), col=col)
    geo.instance(pl, 'plant_1', (hw - 0.3, hd - 0.4, 0), (0, 0, -40), (0.85, 0.85, 0.85), col=col)
    geo.retire(pl)
    st = props.stool('stool_proto')
    C.move_to(st, col)
    geo.instance(st, 'stool_0', (-1.05, -0.35, 0), (0, 0, 10), col=col)
    geo.retire(st)

    cam = props.wall_camera('cam_0')
    geo.place(cam, (hw - 0.45, hd - 0.18, 2.15), (0, 0, 205))
    C.move_to(cam, col)

    cr = props.crate('crate')
    geo.place(cr, (1.05, -0.7, 0), (0, 0, 18))
    C.move_to(cr, col)
    geo.tag(cr, 'dyn', pick='click', hint='Click the crate')

    anchors = {
        'hot_cam': (hw - 0.45, hd - 0.5, 2.12),
        'hot_rail': (0.55, 0.05, 1.45),
    }
    for k, v in anchors.items():
        geo.tag(C.empty(k, col, v), 'set', anchor=1)

    # The cast, in Blender coordinates; build-time stills pose them at t = 0,
    # the page drives them from here on.
    paths = {'loop': [(-0.2, -0.75), (0.95, -0.75), (1.05, -0.2), (0.3, -0.35), (-0.25, -0.2), (-0.2, -0.75)]}
    cast = [
        {'body': 'body_a', 'hair': 'quiff', 'carry': ['bag'],
         'outfit': {'top': '#6f7f94', 'bottom': '#2d3340', 'skin': C.MAT['skin_b'], 'hair': '#221c19', 'accent': '#c8553d'},
         'clip': 'walk', 'path': 'loop', 'along': 0.0, 'phase': 0.0},
        {'body': 'body_c', 'hair': 'bun', 'scale': 0.96,
         'outfit': {'top': '#c9b79c', 'bottom': '#3a3530', 'skin': C.MAT['skin_a'], 'hair': '#5a3a22'},
         'clip': 'browse', 'at': (0.62, -0.42), 'face': 175, 'phase': 0.25},
    ]
    return {'plinth': {k: v for k, v in base.items() if k != 'parts'}, 'anchors': anchors, 'paths': paths, 'cast': cast}
