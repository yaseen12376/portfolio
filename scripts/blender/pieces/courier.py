"""
Courier: a parcel on the counter scale, and its receipt printing.

What the software does at the counter, as its code has it:
  - the parcel is weighed (the scale reads 0.200 kg) and booked
  - an A5 receipt is printed with the consignment's barcode: the layout is the
    repo's own QuestPDF receipt (consignment row with the barcode on the
    right, date, parcel type and weight, the two customers, the charges and
    a total), with a plain header band in place of the client's name
A new receipt feeds out over the last one once a loop.

The boxes and envelope are scanned cardboard and the scale's plate brushed
steel (ambientCG, CC0); the packing tape is glossy.
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
    'id': 'courier',
    'tag': ('COURIER', 'MANAGEMENT', 'BOOKING + RECEIPTS  2026'),
    'accent': '#3b82f6',
    'disc': '#211d19',
}

BLUE = '#1d4f9f'
SLOPE = 54.0                 # the receipt tray, from the horizontal
RW, RH = 0.185, 0.262        # the receipt: A5
SLOT = 0.286                 # where the paper leaves the printer, up the tray


# ---------------------------------------------------------------- the scale + parcel

def _scale(col):
    root = P.group('scale', col, loc=(0.11, 0.075, 0.0), rot=(0, 0, -8.0))
    enamel = geo.pbr('scale_enamel', '#2b3038', rough=0.42)
    steel = S.scanned('scale_steel', 'Metal009', tint='#b9bec5', size=0.16, rough=0.3, metal=1.0, bump=0.08)
    parts = [geo.box('scale_base', (0.3, 0.33, 0.04), (0, 0, 0), col=col, material=enamel, bev=0.01)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(geo.cyl('scale_foot', 0.016, 0.012, (sx * 0.11, sy * 0.115 - 0.02, 0.04), col=col, material=geo.pbr('rubber', '#17181b', rough=0.8), verts=16, bev=0.002))
    parts.append(geo.box('scale_plate', (0.275, 0.262, 0.009), (0, -0.022, 0.052), col=col, material=steel, bev=0.004))
    # the column and the head that shows the weight
    parts.append(geo.box('scale_column', (0.03, 0.026, 0.5), (0, 0.142, 0.04), col=col, material=geo.pbr('scale_chrome', '#aeb3ba', rough=0.22, metal=1.0), bev=0.005))
    for p in parts:
        p.parent = root
    head = P.group('scale_head', col, loc=(0, 0.128, 0.555), rot=(90 - 18, 0, 0), parent=root)
    hp = [geo.box('head_box', (0.19, 0.092, 0.04), (0, 0, -0.04), col=col, material=enamel, bev=0.008)]
    hp.append(geo.box('head_glass', (0.162, 0.062, 0.0012), (0, 0, 0), col=col,
                      material=geo.pbr('head_lcd', '#141a12', rough=0.2, emit='#2a3a18', emit_strength=0.5), bev=0))
    hp.append(P.label('head_digits', '0.200', 0.04, col, geo.glow('head_digit', '#ffc76b', 2.6), x=-0.016, y=0.002, z=0.0014))
    hp.append(P.label('head_unit', 'kg', 0.018, col, geo.glow('head_unit', '#ffc76b', 1.6), x=0.062, y=-0.007, z=0.0014))
    for p in hp:
        p.parent = head
    return root


def _parcel(col, scale):
    """A kraft box tied with string, the address label on top."""
    root = P.group('parcel', col, loc=(0.004, -0.02, 0.061), rot=(0, 0, -9.0), parent=scale)
    w, d, h = 0.205, 0.155, 0.118
    kraft = S.scanned('kraft', 'Cardboard004', tint='#b98d5c', size=0.3, rough=0.82, bump=0.35, detail=0.5)
    parts = [geo.box('parcel_box', (w, d, h), (0, 0, 0), col=col, material=kraft, bev=0.004)]
    tape = geo.pbr('parcel_tape', '#b38b58', rough=0.18, spec=0.7)
    parts.append(geo.box('parcel_tape', (w + 0.001, 0.034, 0.0006), (0, 0, h), col=col, material=tape, bev=0))
    twine = geo.pbr('twine', '#d9c7a3', rough=0.9)
    e = 0.0028

    def loop(name, along_x, at):
        hw, hd = w / 2 + e, d / 2 + e
        if along_x:
            pts = [(-hw, at, -e + 0.002), (hw, at, -e + 0.002), (hw, at, h + e), (-hw, at, h + e)]
        else:
            pts = [(at, -hd, -e + 0.002), (at, hd, -e + 0.002), (at, hd, h + e), (at, -hd, h + e)]
        return geo.tube(name, pts, radius=0.0026, col=col, material=twine, resolution=2, closed=True)

    parts += [loop('twine_x', True, -0.03), loop('twine_y', False, 0.045)]
    kx, ky = 0.045, -0.03
    parts.append(P.ball('twine_knot', 0.0062, col, twine, loc=(kx, ky, h + 0.006), seg=12))
    for i, a in enumerate((35, 150)):
        pts = []
        for j in range(13):
            u = j / 12 * 2 * math.pi
            r = 0.024 * math.sin(u / 2)
            pts.append((kx + r * math.cos(math.radians(a) + 0.5 * math.sin(u)), ky + r * math.sin(math.radians(a) + 0.5 * math.sin(u)), h + 0.006 + 0.008 * math.sin(u / 2)))
        parts.append(geo.tube(f'twine_bow{i}', pts, radius=0.0022, col=col, material=twine, resolution=2))
    lab = P.group('parcel_label', col, loc=(-0.045, 0.028, h + 0.0002), rot=(0, 0, 4.0))
    lp = [geo.box('label_sheet', (0.084, 0.058, 0.0008), (0, 0, 0), col=col, material=P.paper('label_paper', '#f5f2ea'), bev=0)]
    dark = P.ink('label_ink', '#2b2926')
    lp += P.rows('label_rows', col, dark, -0.036, 0.02, 0.018, 3, 0.0085, thick=0.0028, z=0.0008, ragged=(1.0, 0.7, 0.85))
    lp += P.barcode('label_code', col, dark, 0.0, -0.016, 0.066, 0.011, z=0.0008, seed=21)
    for p in lp:
        p.parent = lab
    parts.append(lab)
    for p in parts:
        p.parent = root
    return root


# ---------------------------------------------------------------- the receipt

def _receipt(col, name):
    """One A5 receipt, flat in XY: x centred, y from 0 (its foot) up to RH."""
    white = P.paper('receipt_paper', '#f8f6f0')
    dark = P.ink('receipt_ink', '#28262b')
    grey = P.ink('receipt_grey', '#8f8c86')
    blue = geo.pbr('receipt_blue', BLUE, rough=0.7)
    z = 0.0009
    x0, x1 = -RW / 2 + 0.014, RW / 2 - 0.014
    parts = [geo.box(f'{name}_sheet', (RW, RH, z), (0, RH / 2, 0), col=col, material=white, bev=0)]
    add = parts.append
    # header band
    add(geo.box(f'{name}_band', (RW, 0.036, 0.0003), (0, RH - 0.018, z), col=col, material=blue, bev=0))
    add(P.label(f'{name}_title', 'RECEIPT', 0.0185, col, P.paper('receipt_title', '#ffffff'), x=x0, y=RH - 0.0185, z=z + 0.0003, align='LEFT'))
    add(geo.box(f'{name}_copy', (0.04, 0.0036, 0.0003), (x1 - 0.02, RH - 0.018, z + 0.0003), col=col, material=P.paper('receipt_title', '#ffffff'), bev=0))
    # consignment number, the barcode on the right
    y = RH - 0.058
    add(geo.box(f'{name}_cn_l', (0.052, 0.003, 0.0003), (x0 + 0.026, y + 0.009, z), col=col, material=grey, bev=0))
    add(P.label(f'{name}_cn', 'No. 000128', 0.0125, col, blue, x=x0, y=y - 0.006, z=z, align='LEFT'))
    parts.extend(P.barcode(f'{name}_code', col, dark, x1 - 0.034, y, 0.066, 0.024, z=z, seed=14))
    add(geo.box(f'{name}_r1', (x1 - x0, 0.0008, 0.0003), (0, y - 0.019, z), col=col, material=grey, bev=0))
    # date, parcel type, weight
    y -= 0.034
    for i, wv in enumerate((0.042, 0.03, None)):
        cx = x0 + i * (x1 - x0) / 3
        add(geo.box(f'{name}_f{i}', (0.03, 0.0028, 0.0003), (cx + 0.015, y + 0.006, z), col=col, material=grey, bev=0))
        if wv:
            add(geo.box(f'{name}_fv{i}', (wv, 0.0042, 0.0003), (cx + wv / 2, y - 0.005, z), col=col, material=dark, bev=0))
        else:
            add(P.label(f'{name}_weight', '0.200 kg', 0.0095, col, dark, x=cx, y=y - 0.005, z=z, align='LEFT'))
    add(geo.box(f'{name}_r2', (x1 - x0, 0.0008, 0.0003), (0, y - 0.016, z), col=col, material=grey, bev=0))
    # from and to
    for k in range(2):
        y -= 0.03
        add(geo.box(f'{name}_h{k}', (0.05, 0.0042, 0.0003), (x0 + 0.025, y + 0.004, z), col=col, material=blue, bev=0))
        for j, (wv, dx, dy, m) in enumerate(((0.07, 0.0, -0.007, dark), (0.05, 0.09, -0.007, grey), (0.11, 0.0, -0.015, grey))):
            add(geo.box(f'{name}_p{k}{j}', (wv, 0.003, 0.0003), (x0 + dx + wv / 2, y + dy, z), col=col, material=m, bev=0))
        add(geo.box(f'{name}_r{3 + k}', (x1 - x0, 0.0006, 0.0003), (0, y - 0.022, z), col=col, material=grey, bev=0))
        y -= 0.008
    # charges, then the total
    y -= 0.022
    add(geo.box(f'{name}_ch', (0.042, 0.0042, 0.0003), (x0 + 0.021, y + 0.006, z), col=col, material=blue, bev=0))
    for j, (wl, wr) in enumerate(((0.06, 0.026), (0.045, 0.02), (0.052, 0.022))):
        yy = y - 0.006 - j * 0.0095
        add(geo.box(f'{name}_cl{j}', (wl, 0.003, 0.0003), (x0 + wl / 2, yy, z), col=col, material=grey, bev=0))
        add(geo.box(f'{name}_cr{j}', (wr, 0.003, 0.0003), (x1 - wr / 2, yy, z), col=col, material=dark, bev=0))
    yy = y - 0.04
    add(geo.box(f'{name}_tr', (x1 - x0, 0.001, 0.0003), (0, yy + 0.008, z), col=col, material=dark, bev=0))
    add(geo.box(f'{name}_tl', (0.058, 0.0052, 0.0003), (x0 + 0.029, yy, z), col=col, material=dark, bev=0))
    add(geo.box(f'{name}_tv', (0.04, 0.0058, 0.0003), (x1 - 0.02, yy, z), col=col, material=blue, bev=0))
    add(geo.box(f'{name}_foot', (0.09, 0.0026, 0.0003), (0, 0.012, z), col=col, material=grey, bev=0))
    return P.join(parts, name, col)


def _printer(col):
    """A wedge stand with a receipt printer at its top: paper slides down the
    slope to a lip. Returns the sheet that feeds out, and its rest shape."""
    a = math.radians(SLOPE)
    length = 0.415
    D, H = length * math.cos(a), length * math.sin(a)
    root = P.group('printer', col, loc=(-0.125, -0.212, 0.0), rot=(0, 0, 22.0))
    W = RW + 0.03
    ply = geo.textured('stand_ply', 'plywood', tint='#b08a5e', rough=0.6, scale=0.5, strength=0.6)
    wedge = geo.extrude('stand_wedge', [(0, 0), (D, 0), (D, H)], W, col=col, material=ply, bev=0.003)
    wedge.rotation_euler = (math.radians(90), 0, math.radians(90))
    wedge.location = (-W / 2, 0, 0)
    wedge.parent = root

    slope = P.group('slope', col, loc=(0, 0, 0), rot=(SLOPE, 0, 0), parent=root)
    dark = geo.pbr('printer_dark', '#26282d', rough=0.42)
    body = geo.pbr('printer_body', '#dcd8cf', rough=0.5)
    lip = geo.box('stand_lip', (W, 0.012, 0.014), (0, -0.006, 0), col=col, material=ply, bev=0.002)
    # the printer: it straddles the top of the slope, the paper leaves under its front edge
    box = geo.box('printer_box', (W + 0.012, 0.12, 0.105), (0, SLOT + 0.06, -0.03), col=col, material=body, bev=0.012)
    mouth = geo.box('printer_mouth', (RW + 0.012, 0.008, 0.008), (0, SLOT + 0.002, 0.0), col=col, material=dark, bev=0)
    lid = geo.box('printer_lid', (W - 0.02, 0.07, 0.004), (0, SLOT + 0.07, 0.075), col=col, material=geo.pbr('printer_lid', '#c7c2b7', rough=0.45), bev=0.002)
    led = geo.cyl('printer_led', 0.0055, 0.003, (W / 2 - 0.022, SLOT + 0.022, 0.075), col=col, material=geo.glow('printer_led', '#5fa2ff', 3.0), verts=14, bev=0)
    for o in (lip, box, mouth, lid, led):
        o.parent = slope

    still = _receipt(col, 'receipt_last')
    still.location = (0, 0.0, 0.0002)
    still.parent = slope
    moving = bpy.data.objects.new('receipt_new', still.data.copy())
    col.objects.link(moving)
    moving.location = (0, 0.0, 0.0016)
    moving.parent = slope
    rest = [v.co.copy() for v in moving.data.vertices]
    return root, moving, rest


def _envelopes(col):
    """Two more consignments waiting: a padded envelope and a small box."""
    root = P.group('waiting', col, loc=(-0.2, 0.2, 0.0), rot=(0, 0, -34.0))
    kraft = S.scanned('kraft_b', 'Cardboard004', tint='#a9814f', size=0.3, rough=0.84, bump=0.35, detail=0.5)
    geo.box('small_box', (0.13, 0.1, 0.07), (0, 0, 0), col=col, material=kraft, bev=0.004).parent = root
    env = geo.box('envelope', (0.15, 0.105, 0.016), (0.008, -0.004, 0.07), rot=(0, 0, 16), col=col,
                  material=geo.pbr('envelope', '#d8c9a8', rough=0.8), bev=0.005)
    env.parent = root
    dark = P.ink('label_ink', '#2b2926')
    for b in P.barcode('env_code', col, dark, 0.0, 0.0, 0.05, 0.012, z=0.0862, seed=33):
        b.rotation_euler = (0, 0, math.radians(16))
        x, y = b.location.x, b.location.y
        c, s = math.cos(math.radians(16)), math.sin(math.radians(16))
        b.location = (0.008 + x * c - y * s - 0.03, -0.004 + x * s + y * c + 0.01, b.location.z)
        b.parent = root
    return root


def build(col):
    scale = _scale(col)
    _parcel(col, scale)
    _root, moving, rest = _printer(col)
    _envelopes(col)
    P.no_ghosts(col)
    return {'sheet': moving, 'rest': rest}


def animate(t, st):
    # A new receipt feeds out over the last one. Whatever is still inside the
    # printer is folded onto the slot line, out of sight. (Offset so the
    # still, at t = 0, has a whole receipt lying there, header and all: the
    # next one starts a moment later.)
    u = (t + 0.9) % 1.0
    feed = C.clamp(u / 0.78)
    feed = feed + 0.04 * math.sin(feed * math.pi * 14) * (1 - feed) * 0.15   # the printer's small stutter
    off = SLOT * (1 - C.clamp(feed))
    me = st['sheet'].data
    flat = []
    for r in st['rest']:
        flat += (r.x, min(r.y + off, SLOT), r.z)
    me.vertices.foreach_set('co', flat)
    me.update()


# ---------------------------------------------------------------- the live jar (pieces/live.py)

FEED_START, FEED_LEN = 0.9, 0.78   # animate(): the receipt's offset in the loop, and how long it feeds


def spots(st):
    """The live jar's numbered dots: the weight (on the scale's display),
    the receipt (on the printer) and the tracking (on the consignments
    waiting). Each names the parts a tap opens it from with the glass off.
    The weight and the receipt face the way their faces look, the display's
    glass and the slope the receipt lies on, not out from the axis (the
    default): the scale stands behind the axis with its display turned to
    the front, and the slope looks off to the printer's right, so a chapter
    turned by the axis showed the display from behind and the receipt edge
    on. (As up as the default, so the dots show as long.)"""
    from mathutils import Vector
    from pieces.live import below, box
    bpy.context.view_layer.update()
    _, top_h, head = box('head_box')
    _, top_p, printer = box('printer_box')
    _, top_w, waiting = box('envelope')
    up = Vector((0.0, 0.0, 1.0))

    def face(name):
        n = bpy.data.objects[name].matrix_world.to_3x3() @ up
        n.z = 0.0
        return tuple((n.normalized() * 0.4 + up * 0.6).normalized())

    return [
        {'id': 'weigh', 'at': (head.x, head.y, top_h.z + 0.012), 'out': face('scale_head'), 'parts': below('scale')},
        {'id': 'receipt', 'at': (printer.x, printer.y, top_p.z + 0.012), 'out': face('slope'), 'parts': below('printer')},
        {'id': 'track', 'at': (waiting.x, waiting.y, top_w.z + 0.012), 'parts': below('waiting')},
    ]


def live(st):
    """The receipt feeds out on the page (src/three/pieces/courier.js): the
    whole sheet slides up the tray and what is still inside the printer is
    cut away at its slot, as the render folds it there. It leaves whole, at
    its t = 0 (lying in the tray), apart from the join, in materials of its
    own (copies, `own`: the page cuts these at the slot, not the atlas the
    rest of the model shares)."""
    sheet = st['state']['sheet']
    sheet['hooked'] = 1
    me = sheet.data
    for i, m in enumerate(me.materials):
        if m is not None:
            c = m.copy()
            c.name = f'sheet_{m.name}'
            c['own'] = 1
            me.materials[i] = c


def page(st):
    """What the page's receipt needs: the sheet, the tray it slides up (its
    frame: y up the slope), the slot and the loop's timing."""
    return {'receipt': {'mesh': 'receipt_new', 'tray': 'slope', 'slot': SLOT, 'start': FEED_START, 'feed': FEED_LEN}}
