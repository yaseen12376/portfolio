"""
The floor plan the page's figures walk on (src/three/sim/grid.js).

Every cell of a 5 cm grid over the plinth top is tested with short vertical
rays from ankle to head height (the centre and four inner points of the cell,
so a thin table leg cannot hide between samples). Anything static that a ray
meets blocks the cell: walls, skirting, fixtures, tables, the till. Things
that move on the page (role 'dyn') are skipped here and exported as
footprints instead, which the page stamps and re-stamps as they move.

Run on the assembled scene, before the set is joined and culled for baking:
culling deletes the undersides these rays need.
"""

from __future__ import annotations

import base64
import math

import bpy
from mathutils import Vector

import common as C
from kit.plinth import rounded_rect

# From above a doormat, a pavement slab or a kerb (people step over those) to
# above a head. A skirting board, 10 cm, still blocks.
ANKLE, HEAD = 0.09, 1.5


def _static(obj):
    src = obj.original if hasattr(obj, 'original') else obj
    top = src
    while top.parent is not None:
        top = top.parent
    return src.get('role') not in ('dyn', 'fig', 'fx') and top.get('role') not in ('dyn', 'fig', 'fx'), src


def _hits_static(dg, sc, origin, up=HEAD - ANKLE):
    """Walk a ray upward, stepping past anything that moves at runtime. A
    solid taller than a head that the ray starts inside (a partition with no
    skirting) has nothing to hit below head height: the ray leaves it through
    its top, and one cast down leaves it through its bottom, so that counts too."""
    o = Vector(origin)
    left = up
    while True:
        hit, loc, n, _i, obj, _m = sc.ray_cast(dg, o, Vector((0, 0, 1)), distance=50.0)
        if not hit:
            return False
        static, src = _static(obj)
        d = (loc - o).length
        if static:
            if d <= left:
                return True
            if n.z <= 0:
                return False  # the next thing above is entered from below, well over a head
            # Leaving something through its top: inside it, if a ray down leaves it through its bottom.
            hit2, _l2, n2, _i2, obj2, _m2 = sc.ray_cast(dg, Vector(origin), Vector((0, 0, -1)), distance=5.0)
            if hit2 and n2.z < 0:
                s2 = obj2.original if hasattr(obj2, 'original') else obj2
                return s2 == src
            return False
        left -= d + 1e-3
        o = loc + Vector((0, 0, 1e-3))


def _inside(px, py, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _dist_to_poly(px, py, poly):
    """Distance from a point to a polygon (0 inside), or to a segment when the
    'polygon' is two points (a vertical face seen from above)."""
    if len(poly) >= 3 and _inside(px, py, poly):
        return 0.0
    best = 1e9
    n = len(poly)
    for k in range(n if n > 2 else 1):
        ax, ay = poly[k]
        bx, by = poly[(k + 1) % n]
        lx, ly = bx - ax, by - ay
        l2 = lx * lx + ly * ly or 1e-12
        t = max(0.0, min(1.0, ((px - ax) * lx + (py - ay) * ly) / l2))
        best = min(best, math.hypot(px - ax - lx * t, py - ay - ly * t))
    return best


def _thin_faces(cell):
    """The faces, seen from above, of static pieces thinner than a cell and a
    bit (in their own horizontal axes) that stand between ankle and head
    height: glass panes, posts, poles. What the ray samples may step between."""
    out = []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in bpy.data.objects:
        if o.type != 'MESH' or o.get('passable') or o.hide_render:
            continue
        top = o
        while top.parent is not None:
            top = top.parent
        if o.get('role') in ('dyn', 'fig', 'fx') or top.get('role') in ('dyn', 'fig', 'fx'):
            continue
        dims = o.dimensions
        if min(dims.x, dims.y) > cell * 1.2 or max(dims.x, dims.y) < 0.02:
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = o.matrix_world
        for f in me.polygons:
            pts = [mw @ me.vertices[v].co for v in f.vertices]
            zs = [p.z for p in pts]
            if max(zs) < ANKLE or min(zs) > HEAD:
                continue
            flat = []
            for p in pts:
                q = (round(p.x, 5), round(p.y, 5))
                if q not in flat:
                    flat.append(q)
            # A vertical face projects to a segment: keep its two ends.
            if len(flat) > 2:
                area = 0.0
                for k in range(len(flat)):
                    ax, ay = flat[k]
                    bx, by = flat[(k + 1) % len(flat)]
                    area += ax * by - bx * ay
                if abs(area) < 1e-6:
                    flat.sort()
                    flat = [flat[0], flat[-1]]
            if len(flat) >= 2:
                out.append(flat)
        ev.to_mesh_clear()
    return out


def build(plinth: dict, w: float, d: float, radius: float, cell: float = 0.05):
    """Returns the scene.json 'nav' entry (three.js floor coordinates)."""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    sc = bpy.context.scene
    floor = rounded_rect(w, d, radius, inset=0.02)
    nx, ny = int(math.ceil(w / cell)), int(math.ceil(d / cell))
    x0, y0 = -nx * cell / 2, -ny * cell / 2
    # three.js: x stays, z = -y. Grid rows run along +z, i.e. from Blender's +y down.
    bits = []
    blocked = 0
    for j in range(ny):
        # Row j is three.js z = z0 + (j + 0.5) cell, i.e. Blender y = -z.
        by = (y0 + ny * cell) - (j + 0.5) * cell
        for i in range(nx):
            bx = x0 + (i + 0.5) * cell
            b = 0
            if not _inside(bx, by, floor):
                b = 1
            else:
                q = cell * 0.3
                for ox, oy in ((0, 0), (q, q), (-q, q), (q, -q), (-q, -q)):
                    if _hits_static(dg, sc, (bx + ox, by + oy, ANKLE)):
                        b = 1
                        break
            bits.append(b)
            blocked += b
    # Thin pieces (a glass pane, a post, a rope) can sit between a cell's ray
    # samples: their faces are rasterised instead, grown by half a cell.
    thin = 0
    for poly in _thin_faces(cell):
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        i0 = max(0, int((min(xs) - x0) / cell) - 1)
        i1 = min(nx - 1, int((max(xs) - x0) / cell) + 1)
        j0 = max(0, int(((y0 + ny * cell) - max(ys)) / cell) - 1)
        j1 = min(ny - 1, int(((y0 + ny * cell) - min(ys)) / cell) + 1)
        for j in range(j0, j1 + 1):
            by = (y0 + ny * cell) - (j + 0.5) * cell
            for i in range(i0, i1 + 1):
                k = j * nx + i
                if bits[k]:
                    continue
                bx = x0 + (i + 0.5) * cell
                if _dist_to_poly(bx, by, poly) <= cell * 0.5:
                    bits[k] = 1
                    blocked += 1
                    thin += 1
    raw = bytearray((len(bits) + 7) // 8)
    for k, b in enumerate(bits):
        if b:
            raw[k >> 3] |= 0x80 >> (k & 7)
    print(f'NAV {nx}x{ny} cells, {blocked} blocked ({100 * blocked / len(bits):.0f}%), {thin} by thin pieces')
    return {'origin': [round(x0, 4), round(-(y0 + ny * cell), 4)], 'cell': cell, 'w': nx, 'h': ny,
            'data': base64.b64encode(bytes(raw)).decode('ascii')}


def footprints():
    """Half extents and centre offset, in each moving piece's own x/z (three.js),
    of everything tagged 'dyn' that sits on the floor: the page stamps these on
    the grid wherever the piece is moved."""
    out = {}
    bpy.context.view_layer.update()
    for o in bpy.data.objects:
        # Doors, curtains, shutters move on the page but never block a path.
        if o.get('role') != 'dyn' or o.parent is not None or o.get('passable'):
            continue
        inv = o.matrix_world.inverted()
        lo = Vector((1e9, 1e9, 1e9))
        hi = Vector((-1e9, -1e9, -1e9))
        for m in [o] + list(o.children_recursive):
            if m.type != 'MESH':
                continue
            for c in m.bound_box:
                p = inv @ (m.matrix_world @ Vector(c))
                lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
                hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
        if lo.x > hi.x:
            continue
        s = o.matrix_world.to_scale()
        out[o.name] = {'half': [round((hi.x - lo.x) / 2 * s.x, 4), round((hi.y - lo.y) / 2 * s.y, 4)],
                       # Blender local y becomes three.js local -z.
                       'offset': [round((hi.x + lo.x) / 2 * s.x, 4), round(-(hi.y + lo.y) / 2 * s.y, 4)]}
    return out


def dyn_polys():
    """World-space footprints (Blender x, y corners) of the moving pieces, as
    the page stamps them at their starting places."""
    out = []
    for o in bpy.data.objects:
        # Doors, curtains, shutters move on the page but never block a path.
        if o.get('role') != 'dyn' or o.parent is not None or o.get('passable'):
            continue
        pts = []
        for m in [o] + list(o.children_recursive):
            if m.type == 'MESH':
                pts += [m.matrix_world @ Vector(c) for c in m.bound_box]
        if not pts:
            continue
        inv = o.matrix_world.inverted()
        loc = [inv @ p for p in pts]
        x0, x1 = min(p.x for p in loc), max(p.x for p in loc)
        y0, y1 = min(p.y for p in loc), max(p.y for p in loc)
        out.append([tuple((o.matrix_world @ Vector((x, y, 0)))[:2]) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))])
    return out


def check_reach(nav: dict, spots: dict, radius: float, start: str | None = None, polys=()):
    """Every named spot must be reachable on foot from `start` (or the first
    spot), on the grid as the page dilates it. Returns the unreachable names;
    the bake prints them loudly, because a spot nobody can reach is a figure
    that stands frozen somewhere else on the page."""
    import math as _m
    w, h, cell = nav['w'], nav['h'], nav['cell']
    raw = base64.b64decode(nav['data'])
    blocked = [(raw[k >> 3] >> (7 - (k & 7))) & 1 for k in range(w * h)]
    k = int(_m.ceil(radius / cell))
    kern = [(di, dj) for dj in range(-k, k + 1) for di in range(-k, k + 1) if _m.hypot(di, dj) * cell <= radius + cell * 0.35]
    edge = int(_m.ceil(radius / cell - 0.5))
    occ = [0] * (w * h)
    for j in range(h):
        for i in range(w):
            if i < edge or j < edge or i >= w - edge or j >= h - edge:
                occ[j * w + i] = 1
            if blocked[j * w + i]:
                for di, dj in kern:
                    a, b = i + di, j + dj
                    if 0 <= a < w and 0 <= b < h:
                        occ[b * w + a] = 1
    x0, z0 = nav['origin']

    def cell_of(x, y):  # Blender (x, y) -> grid (three.js z = -y)
        return int((x - x0) // cell), int((-y - z0) // cell)

    # Moving pieces where they start, dilated like everything else.
    for poly in polys:
        for j in range(h):
            for i in range(w):
                x = x0 + (i + 0.5) * cell
                y = -(z0 + (j + 0.5) * cell)
                if _inside(x, y, poly):
                    for di, dj in kern:
                        a, b = i + di, j + dj
                        if 0 <= a < w and 0 <= b < h:
                            occ[b * w + a] = 1

    def nearest_free(i, j):
        for r in range(0, 12):
            for dj in range(-r, r + 1):
                for di in range(-r, r + 1):
                    a, b = i + di, j + dj
                    if 0 <= a < w and 0 <= b < h and not occ[b * w + a]:
                        return b * w + a
        return None

    names = list(spots)
    first = start or names[0]
    s0 = nearest_free(*cell_of(*spots[first]['at']))
    seen = {s0}
    stack = [s0]
    while stack:
        c = stack.pop()
        i, j = c % w, c // w
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            a, b = i + di, j + dj
            n = b * w + a
            if 0 <= a < w and 0 <= b < h and not occ[n] and n not in seen:
                seen.add(n)
                stack.append(n)
    bad = []
    for n in names:
        if spots[n].get('fixed'):
            continue  # someone who works in place (behind a counter) never walks there
        c = nearest_free(*cell_of(*spots[n]['at']))
        if c is None or c not in seen:
            bad.append(n)
    print(f'NAV reach from {first}: {len(seen)} cells; unreachable: {", ".join(bad) or "none"}')
    return bad


def check_spacing(spots: dict, min_gap: float = 0.66):
    """Pairs of spots two people could stand on at the same time, closer than
    two bodies (0.53 m, arms included) plus a hand's breadth: a figure sent to
    one would push into whoever is on the other. Walk-through lane spots,
    fixed ones (a cashier behind a counter) and a rail's own pair are left out.
    Returns [(a, b, distance)]; the bake prints them loudly."""
    names = [n for n, v in spots.items() if not v.get('lane') and not v.get('fixed')]
    out = []
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            pa, pb = spots[a]['at'], spots[b]['at']
            d = math.hypot(pa[0] - pb[0], pa[1] - pb[1])
            if d < min_gap:
                out.append((a, b, round(d, 3)))
    return out
