"""
Build the shared cast: public/3d/_shared/people.glb (+ people.json).

  blender --background --factory-startup --python scripts/blender/people_build.py -- [--preview]

One armature; bodies bound to it (three builds, two of them also in a hi-vis
vest); eight sculpted hair styles and the things people wear and carry as
rigid pieces the page parents to a bone; every clip as its own glTF
animation. --preview also renders build/3d/_shared/people-board.png (a lineup
in different clips and outfits) and people-faces.png (close-ups), to judge
proportions, faces and poses by eye.
"""

from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import bpy  # noqa: E402
from mathutils import Matrix  # noqa: E402

import common as C  # noqa: E402
from kit import geo, people as P  # noqa: E402

BODIES = ['a', 'b', 'c']
VESTS = ['a', 'b']


def build(col):
    rig = P.build_rig(col)
    figure = geo.pbr('figure', '#ffffff', rough=0.46)
    bodies = []
    for v in BODIES:
        b = P.build_body(v, col)
        P.bind(b, rig)
        bodies.append(b)
    for v in VESTS:
        w = P.build_vest(v, col)
        P.bind(w, rig)
        bodies.append(w)
    hairs = [P.build_hair(s, col) for s in P.HAIR_STYLES]
    things = P.build_attachments(col)
    for o in bodies + hairs + things:
        o.data.materials.clear()
        o.data.materials.append(figure)
        # No texture on a figure: UVs would only add bytes to every vertex.
        for uv in list(o.data.uv_layers):
            o.data.uv_layers.remove(uv)
    clips = P.key_clips(rig)
    return rig, bodies, hairs, things, clips


def export(rig, bodies, rigid, clips):
    C.out_dir('_shared', public=True)
    C.select([rig] + bodies + rigid, rig)
    kw = dict(filepath=os.path.join(C.BUILD, '_shared', 'people.glb'), export_format='GLB', use_selection=True,
              export_apply=True, export_yup=True, export_animations=True, export_animation_mode='ACTIONS',
              export_skins=True, export_def_bones=True, export_optimize_animation_size=True, export_force_sampling=True,
              export_materials='EXPORT', export_vertex_color='ACTIVE', export_lights=False, export_cameras=False,
              export_extras=True)
    os.makedirs(os.path.join(C.BUILD, '_shared'), exist_ok=True)
    while True:
        try:
            bpy.ops.export_scene.gltf(**kw)
            break
        except TypeError as e:
            bad = str(e).split('"')[1] if '"' in str(e) else None
            if not bad or bad not in kw:
                raise
            print('gltf: dropping unsupported option', bad)
            kw.pop(bad)
    C.write_json(os.path.join(C.BUILD, '_shared', 'people.json'), {
        'regions': list(P.REGIONS),
        'bodies': [b.name for b in bodies if not b.name.startswith('vest_')],
        # Skinned overlays for a build (body_a + vest_a = a worker in hi-vis).
        'overlays': [b.name for b in bodies if b.name.startswith('vest_')],
        'hair': [f'hair_{s}' for s in P.HAIR_STYLES],
        # Rigid pieces and the bone each rides on.
        'attachments': {o.name: o['attach'] for o in rigid},
        'clips': clips,
        'walkStride': P.measure_stride(),
        'height': round(P.HEAD_C[2] + P.HEAD_R, 3),
    })
    print('EXPORTED people', [b.name for b in bodies], len(rigid), 'rigid pieces', list(clips))


LINEUP = [
    # body, hair, outfit, clip, phase, carried
    ('body_a', 'quiff', {'skin': C.MAT['skin_a'], 'top': '#7a1f2b', 'bottom': '#1f2126', 'hair': '#2a2320'}, 'idle', 0.2, ()),
    ('body_b', 'short', {'skin': C.MAT['skin_b'], 'top': '#a35d4f', 'bottom': '#3a3530', 'hair': '#1c1612'}, 'walk', 0.1, ('bag',)),
    ('body_c', 'bun', {'skin': C.MAT['skin_c'], 'top': '#d8d4cc', 'bottom': '#4a5a3a', 'hair': '#141111', 'accent': '#b6452c'}, 'pay', 0.3, ('card',)),
    ('body_a', 'long', {'skin': C.MAT['skin_a'], 'top': '#3f6f5d', 'bottom': '#2d3340', 'hair': '#5a3a22'}, 'phone', 0.4, ('phone',)),
    ('body_c', 'curly', {'skin': C.MAT['skin_b'], 'top': '#e9e4da', 'bottom': '#2b2d33', 'hair': '#231a14', 'badge': '#8b5cf6'}, 'talk', 0.3, ()),
    ('body_a+vest', 'crop', {'skin': C.MAT['skin_b'], 'top': '#4d5a6b', 'bottom': '#33383f', 'vest': '#f2c230', 'strip': '#e8e8e0', 'accent': '#f2c230'}, 'hammer', 0.3, ('hat', 'hammer')),
    ('body_b+vest', 'ponytail', {'skin': C.MAT['skin_a'], 'top': '#6b4a3a', 'bottom': '#2e3238', 'vest': '#ff7a1a', 'accent': '#ffffff'}, 'carry', 0.2, ('hat', 'box')),
    ('body_c', 'bob', {'skin': C.MAT['skin_c'], 'top': '#c9b79c', 'bottom': '#23262d', 'hair': '#3b2a20'}, 'tryon', 0.4, ('glasses',)),
]


def preview():
    """Rebuilds the cast in a fresh file and renders two review boards."""
    sc = C.reset()
    geo._MATS.clear()  # the reset removed every cached material and piece
    P._CACHE.clear()
    C.engine(sc, 'CYCLES')
    C.view_transform(sc)
    sc.cycles.samples = 128
    sc.cycles.use_denoising = True
    C.world(sc, '#15151a', 0.6)
    col = C.collection('board')
    geo.box('floor', (10, 5, 0.02), (0, 0.8, -0.02), material=geo.pbr('fl', '#bdb6aa', rough=0.7), bev=0)
    n = len(LINEUP)
    for i, (body, hair, outfit, clip, ph, carry) in enumerate(LINEUP):
        P.spawn(col, body, outfit, ((i - (n - 1) / 2) * 0.62, 0), 0, clip, ph, f'fig{i}', hair=hair, attach=carry)
    C.area_light('key', (2.5, -3.5, 4.2), (0, 0, 0.8), 1100, size=2.5, color='#fff4e6')
    C.area_light('fill', (-3.0, -3.0, 1.8), (0, 0, 0.8), 260, size=3.0, color='#dfe6ff')
    C.area_light('rim', (-2.5, 2.5, 3.0), (0, 0, 1.0), 450, size=2.0, color='#b9a6ff')
    sc.render.resolution_x, sc.render.resolution_y = 2400, 900
    C.camera(sc, (1.6, -6.2, 2.5), (0.0, 0, 0.66), fov_deg=30)
    sc.render.filepath = os.path.join(C.BUILD, '_shared', 'people-board.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED board')
    # Faces: close on the first four heads.
    sc.render.resolution_x, sc.render.resolution_y = 2000, 700
    C.camera(sc, (-0.62 * 1.5, -2.2, 1.3), (-0.62 * 1.5, 0, 1.18), fov_deg=34)
    sc.render.filepath = os.path.join(C.BUILD, '_shared', 'people-faces.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED faces')


if __name__ == '__main__':
    a = C.argv()
    sc = C.reset()
    col = C.collection('people')
    rig, bodies, hairs, things, clips = build(col)
    export(rig, bodies, hairs + things, clips)
    if a.get('preview'):
        preview()
