"""
The collectible plinth every diorama stands on.

From the top: the scene's own floor slab, a stack of cut strata separated by
fine reveal lines (the "cut-away" that says miniature), a dark anodised base
with a lip, a brushed-steel band, and an engraved nameplate on the front face,
the way "THE CURATOR" is engraved under the figurine in the hero.

The scene's floor top sits at z = 0; the plinth hangs below it. The camera
looks from the front-right (+X, -Y), so the nameplate is on the -Y face.
"""

from __future__ import annotations

import math
import os

import common as C
from kit import geo


def rounded_rect(w, d, r, seg=10, inset=0.0):
    """Counter-clockwise outline of a w x d rectangle with radius-r corners."""
    w, d, r = w - 2 * inset, d - 2 * inset, max(0.001, r - inset)
    hx, hy = w / 2, d / 2
    pts = []
    for cx, cy, a0 in ((hx - r, -hy + r, -90), (hx - r, hy - r, 0), (-hx + r, hy - r, 90), (-hx + r, -hy + r, 180)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def build(col, w, d, *, top, strata, label, radius=0.16, base_h=0.26, lip=0.05, font=None):
    """
    top      material of the scene's floor slab (the surface the world stands on)
    strata   [(material, thickness), ...] below it, top to bottom
    label    nameplate text, e.g. '01 / RETAIL ANALYTICS'
    Returns {'bottom': z of the base's underside, 'front': y of the front face}.
    """
    groove = geo.mat('trim', rough=0.8)
    z = 0.0
    parts = []

    # The floor slab. Thin and crisp: the world is built on its top face.
    slab_t = 0.05
    parts.append(geo.extrude('plinth_top', rounded_rect(w, d, radius), slab_t, z - slab_t, col, top, bev=0.006, caps='top'))
    z -= slab_t

    # Strata, each separated by a 6 mm recessed reveal.
    for i, (m, t) in enumerate(strata):
        parts.append(geo.extrude(f'plinth_reveal_{i}', rounded_rect(w, d, radius, inset=0.008), 0.006, z - 0.006, col, groove,
                                 bev=0, caps='none'))
        z -= 0.006
        parts.append(geo.extrude(f'plinth_stratum_{i}', rounded_rect(w, d, radius), t, z - t, col, m, bev=0, caps='none'))
        z -= t

    # The base: wider than the strata by `lip`, a chamfered top edge.
    parts.append(geo.extrude('plinth_reveal_base', rounded_rect(w, d, radius, inset=0.01), 0.012, z - 0.012, col, groove,
                             bev=0, caps='none'))
    z -= 0.012
    bw, bd = w + 2 * lip, d + 2 * lip
    base_mat = geo.mat('plinth')
    # Sides only, plus the visible lip ring on top: a full top cap would be
    # buried under the strata and waste lightmap on a face nobody sees.
    parts.append(geo.extrude('plinth_base', rounded_rect(bw, bd, radius + lip), base_h, z - base_h, col, base_mat, bev=0, caps='none'))
    parts.append(geo.annulus('plinth_lip', rounded_rect(bw, bd, radius + lip), rounded_rect(w, d, radius, inset=0.01), z, col, base_mat))

    # A brushed-steel band around the base, a little proud of it.
    band_h = 0.05
    band_z = z - base_h * 0.55 - band_h / 2
    parts.append(geo.extrude('plinth_band', rounded_rect(bw + 0.008, bd + 0.008, radius + lip + 0.004), band_h, band_z, col,
                             geo.mat('steel', rough=0.38), bev=0, caps='none'))
    z_bottom = z - base_h

    # The nameplate: a brass plate on the band's front face, engraved.
    front = -(bd / 2) - 0.004
    plate_w = min(bw * 0.62, 0.075 * len(label) + 0.3)
    plate_h = band_h * 0.84
    parts.append(geo.box('plinth_plate', (plate_w, 0.006, plate_h), (0, front - 0.002, band_z + (band_h - plate_h) / 2), col=col,
                         material=geo.mat('brass', rough=0.34), bev=0.0025))
    font = font or os.path.join(C.FONTS, 'geist-mono-latin-wght-normal.woff2')
    txt = geo.text('plinth_label', label.upper(), size=plate_h * 0.46, depth=0.0012,
                   loc=(0, front - 0.0052, band_z + band_h / 2), rot=(90, 0, 0), col=col,
                   material=geo.pbr('engrave', '#2a2418', rough=0.6), font_path=font if os.path.exists(font) else None)
    parts.append(txt)

    for p in parts:
        geo.tag(p, 'set', bake='plinth')
    return {'bottom': z_bottom, 'front': front, 'width': bw, 'depth': bd, 'parts': parts}


def kicker(pl, yaw_deg, power=90.0, color='#fff1e2'):
    """A strip softbox low in front of the collectible, as a product shot
    lights a display base. Without it the plinth's sides see only the dim
    world and, drawn from a diffuse lightmap (no glossy highlights), read as a
    hole in the page. A narrow spread, aimed a little down, keeps it below the
    floor line so it never lights the room."""
    mid = pl['bottom'] + 0.2
    yaw = math.radians(yaw_deg)
    dist = max(pl['width'], pl['depth']) * 1.1
    ob = C.area_light('kicker', (math.sin(yaw) * dist, -math.cos(yaw) * dist, mid - 0.08), (0, 0, mid - 0.24),
                      power, color=color, shape='RECTANGLE')
    ob.data.size = max(pl['width'], pl['depth']) * 1.3
    ob.data.size_y = 0.22
    try:
        ob.data.spread = math.radians(24)
    except AttributeError:
        pass
    return ob
