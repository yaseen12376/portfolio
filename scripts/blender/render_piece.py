"""
Render one piece of the collection (run inside Blender 5.2, headless).

  blender --background --factory-startup --python scripts/blender/render_piece.py -- \
      --piece <id> --stage draft|still|loop [--size N] [--samples N] [--frames N]
      [--turn 0..1] [--max N] [--force]

  draft   one quick frame (540 px, few samples) for judging the model
  still   one clean frame at --turn (default 0): the poster
  loop    --frames frames of one full turn into build/pieces/<id>/loop/.
          Frames already on disk are skipped, so a stopped render resumes;
          --max caps how many this process renders (a fresh process now and
          then keeps a long headless Cycles run from growing).

Frames are opaque RGB on a black world. The page colour goes in afterwards
(scripts/build-pieces.mjs), not here: the tone curve the dioramas share maps
anything near black to black, so a page-coloured world cannot be rendered.
"""

from __future__ import annotations

import importlib
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))

import bpy  # noqa: E402

import common as C  # noqa: E402
from pieces import _kit as K  # noqa: E402

OUT = os.path.join(C.ROOT, 'build', 'pieces')


def setup(sc, size, samples, threshold):
    kind = C.engine(sc)
    C.view_transform(sc)
    C.world(sc, '#000000', 0.0)
    cy = sc.cycles
    cy.samples = samples
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = threshold
    cy.adaptive_min_samples = min(32, samples)
    cy.use_denoising = True
    for k, v in (('denoiser', 'OPENIMAGEDENOISE'), ('denoising_input_passes', 'RGB_ALBEDO_NORMAL'), ('denoising_prefilter', 'ACCURATE')):
        try:
            setattr(cy, k, v)
        except Exception as e:
            print('cycles setting skipped:', k, e)
    # Glass is four surfaces deep before the far side of the jar is reached.
    cy.max_bounces = 16
    cy.diffuse_bounces = 3
    cy.glossy_bounces = 6
    cy.transmission_bounces = 12
    cy.transparent_max_bounces = 16
    cy.volume_bounces = 0
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.sample_clamp_indirect = 6.0
    cy.blur_glossy = 0.5
    # One seed for every frame: what does not move does not shimmer.
    cy.seed = 11
    cy.use_animated_seed = False
    r = sc.render
    r.use_persistent_data = True
    r.film_transparent = False
    r.resolution_x = r.resolution_y = size
    r.resolution_percentage = 100
    r.image_settings.file_format = 'PNG'
    r.image_settings.color_mode = 'RGB'
    r.image_settings.color_depth = '8'
    r.image_settings.compression = 20
    r.dither_intensity = 1.0
    return kind


def pose(st, piece, t):
    st['turntable'].rotation_euler = (0, 0, 2 * math.pi * t)
    if hasattr(piece, 'animate'):
        piece.animate(t % 1.0, st['state'])
    bpy.context.view_layer.update()


def bounds(st, piece):
    """Say so if anything reaches past the turntable or through the glass."""
    import numpy as np
    cap = K.H_APEX - K.H_WALL
    worst = {}
    for t in (0.0, 0.25, 0.5, 0.75):
        pose(st, piece, t)
        inv = st['turntable'].matrix_world.inverted()
        for o in st['piece'].all_objects:
            if o.type != 'MESH' or not len(o.data.vertices):
                continue
            n = len(o.data.vertices)
            co = np.empty(n * 3, dtype=np.float32)
            o.data.vertices.foreach_get('co', co)
            m = np.array(inv @ o.matrix_world)
            p = co.reshape(n, 3) @ m[:3, :3].T + m[:3, 3]
            r = np.hypot(p[:, 0], p[:, 1])
            top = K.H_WALL + cap * np.sqrt(np.clip(1 - (r / K.R_IN) ** 2, 0, 1)) - K.DISC_H
            out_r = float(r.max()) - (K.DISC_R - 0.004)
            out_z = float((p[:, 2] - top).max()) + 0.015
            low = -0.002 - float(p[:, 2].min())
            bad = max(out_r, out_z, low)
            if bad > 0 and bad > worst.get(o.name, (0,))[0]:
                worst[o.name] = (bad, f'r {float(r.max()):.3f}  z {float(p[:, 2].min()):.3f}..{float(p[:, 2].max()):.3f}  t {t}')
    for name, (bad, note) in sorted(worst.items(), key=lambda kv: -kv[1][0])[:12]:
        print(f'BOUNDS {name}: out by {bad:.3f}  ({note})')
    if not worst:
        print('BOUNDS ok')


def shoot(sc, path):
    t0 = time.time()
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return time.time() - t0


def main():
    a = C.argv()
    pid = a['piece']
    stage = a.get('stage', 'draft')
    piece = importlib.import_module(f'pieces.{pid}')
    out = os.path.join(OUT, pid)
    os.makedirs(os.path.join(out, 'loop'), exist_ok=True)

    sc = C.reset()
    draft = stage in ('draft', 'sheet')
    size = int(a.get('size', 540 if draft else 1080))
    samples = int(a.get('samples', 48 if draft else (384 if stage == 'still' else 192)))
    threshold = 0.05 if draft else (0.01 if stage == 'still' else 0.02)
    kind = setup(sc, size, samples, threshold)

    M = piece.META
    st = K.build(sc, tuple(M.get('tag', ('', ''))), M.get('accent'), M.get('disc', '#1c2622'))
    st['state'] = piece.build(st['piece'])
    K.mount(st)
    if a.get('target'):  # a close look while building: --target x,y,z --frameh 0.5
        K.camera(sc, target=tuple(float(v) for v in str(a['target']).split(',')), frame_h=float(a.get('frameh', 0.5)),
                 pitch_deg=float(a.get('pitch', 20)))
    print(f'BUILT {pid} on {kind}: {len(bpy.data.objects)} objects')
    if draft:
        bounds(st, piece)

    turn = float(a.get('turn', 0))
    if stage == 'sheet':  # four quick views of one turn, for a contact sheet
        for q in (0, 25, 50, 75):
            pose(st, piece, q / 100)
            secs = shoot(sc, os.path.join(out, f'view-{q:02d}.png'))
            print(f'RENDERED view {q:02d} {secs:.1f}s')
        return
    if stage in ('draft', 'still'):
        pose(st, piece, turn)
        name = 'draft.png' if draft else 'still.png'
        if turn and draft:
            name = f'draft-{int(round(turn * 100)):02d}.png'
        secs = shoot(sc, os.path.join(out, name))
        print(f'RENDERED {stage} {name} {size}px {samples}spp {secs:.1f}s')
        return

    frames = int(a.get('frames', 144))
    cap = int(a.get('max', 10 ** 6))
    done = 0
    for i in range(frames):
        path = os.path.join(out, 'loop', f'f_{i:04d}.png')
        if os.path.exists(path) and not a.get('force'):
            continue
        if done >= cap:
            break
        pose(st, piece, i / frames)
        secs = shoot(sc, path)
        done += 1
        print(f'RENDERED frame {i + 1}/{frames} {secs:.1f}s')
    left = sum(1 for i in range(frames) if not os.path.exists(os.path.join(out, 'loop', f'f_{i:04d}.png')))
    print(f'RENDERED loop: {done} new, {left} left')


main()
