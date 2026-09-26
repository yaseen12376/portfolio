"""
Props shared across scenes. Each builder returns ONE joined object with its
modifiers applied, origin at its footprint centre on the floor (z = 0), facing
-Y, so a scene can place it, or instance it many times.

Scale is real-world metres; the figures are ~1.4 m vinyl toys, so furniture
is built at a slightly compressed "toy world" scale that keeps them in step.
"""

from __future__ import annotations

import math

import bpy

import common as C
from kit import geo


def _join(parts, name, role='prop', **extras):
    return geo.parts_to(parts, name, role=role, **extras)


# ---------------------------------------------------------------- furniture

def table(name='table', w=1.2, d=0.62, h=0.72, top='wood', legs='trim', role='set'):
    t = 0.045
    parts = [geo.box(f'{name}_top', (w, d, t), (0, 0, h - t), material=geo.mat(top, rough=0.5), bev=0.012)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(geo.box(f'{name}_leg', (0.05, 0.05, h - t), (sx * (w / 2 - 0.06), sy * (d / 2 - 0.06), 0),
                                 material=geo.mat(legs, rough=0.6), bev=0.008))
    parts.append(geo.box(f'{name}_apron', (w - 0.14, 0.03, 0.08), (0, -(d / 2 - 0.08), h - t - 0.08),
                         material=geo.mat(legs, rough=0.6), bev=0.006))
    return _join(parts, name, role)


def stool(name='stool', h=0.46):
    seat = geo.cyl(f'{name}_seat', 0.17, 0.05, (0, 0, h - 0.05), material=geo.mat('wood', rough=0.45), bev=0.012, verts=28)
    legs = []
    for i in range(3):
        a = math.radians(90 + i * 120)
        top = (0.1 * math.cos(a), 0.1 * math.sin(a), h - 0.05)
        foot = (0.15 * math.cos(a), 0.15 * math.sin(a), 0.0)
        legs.append(geo.tube(f'{name}_leg{i}', [foot, top], 0.013, material=geo.mat('trim', rough=0.4)))
    ring = geo.tube(f'{name}_ring', [(0.12 * math.cos(math.radians(t)), 0.12 * math.sin(math.radians(t)), 0.16) for t in range(0, 361, 20)],
                    0.008, material=geo.mat('trim', rough=0.4), closed=True)
    return _join([seat, ring] + legs, name)


def crate(name='crate', s=(0.5, 0.36, 0.32)):
    w, d, h = s
    wood = geo.mat('wood', rough=0.7)
    parts = [geo.box(f'{name}_base', (w, d, 0.02), (0, 0, 0), material=wood, bev=0.004)]
    for i in range(3):
        z = 0.03 + i * (h - 0.05) / 3
        for sy in (-1, 1):
            parts.append(geo.box(f'{name}_slat', (w, 0.018, (h - 0.05) / 3 - 0.02), (0, sy * (d / 2 - 0.009), z),
                                 material=wood, bev=0.004))
        for sx in (-1, 1):
            parts.append(geo.box(f'{name}_slat', (0.018, d - 0.036, (h - 0.05) / 3 - 0.02), (sx * (w / 2 - 0.009), 0, z),
                                 material=wood, bev=0.004))
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(geo.box(f'{name}_post', (0.035, 0.035, h), (sx * (w / 2 - 0.018), sy * (d / 2 - 0.018), 0),
                                 material=geo.mat('wood_dark', rough=0.7), bev=0.005))
    return _join(parts, name)


def plant(name='plant', h=0.9, leaves=14, seed=1):
    r = C.Rand(seed)
    pot_h = h * 0.32
    pot = geo.lathe(f'{name}_pot', [(0.0, 0.0), (0.13, 0.0), (0.155, pot_h * 0.9), (0.165, pot_h), (0.15, pot_h), (0.0, pot_h * 0.92)],
                    material=geo.mat('pot', rough=0.8), segments=28)
    soil = geo.cyl(f'{name}_soil', 0.145, 0.01, (0, 0, pot_h * 0.9), material=geo.mat('soil', rough=1.0), bev=0, verts=24)
    parts = [pot, soil]
    for i in range(leaves):
        a = 2 * math.pi * i / leaves + r.range(-0.2, 0.2)
        tilt = r.range(20, 55)
        length = h * r.range(0.42, 0.62)
        leaf = geo.sphere(f'{name}_leaf', 1.0, (0, 0, 0), (0.07, 0.018, length / 2), material=geo.mat(
            'plant' if i % 3 else 'plant_dark', rough=0.55), seg=12)
        leaf.location = (0, 0, length / 2)
        C.apply_transform(leaf, loc=True)
        leaf.rotation_euler = (math.radians(tilt) * math.sin(a), math.radians(-tilt) * math.cos(a), a)
        leaf.location = (0.03 * math.cos(a), 0.03 * math.sin(a), pot_h * 0.92)
        C.apply_transform(leaf, loc=True)
        parts.append(leaf)
    return _join(parts, name)


# ---------------------------------------------------------------- retail

TEE = [(-0.2, 0.0), (0.2, 0.0), (0.2, 0.42), (0.3, 0.36), (0.36, 0.46), (0.22, 0.56), (0.08, 0.56),
       (0.0, 0.52), (-0.08, 0.56), (-0.22, 0.56), (-0.36, 0.46), (-0.3, 0.36), (-0.2, 0.42)]


def shirt(name='shirt', color='fabric_a', long=False):
    """A shirt on a hanger, seen hanging: a softly bevelled silhouette with
    thickness, plus a wire hanger. Origin at the hanger hook's top."""
    poly = [(x * 0.62, y * (0.62 if not long else 0.72)) for x, y in TEE]
    body = geo.extrude(f'{name}_cloth', poly, 0.028, 0, material=geo.mat(color, rough=0.9), bev=0.009)
    body.rotation_euler = (math.radians(90), 0, 0)
    C.apply_transform(body)
    top = max(v.co.z for v in body.data.vertices)
    body.location = (0, 0.014, -top - 0.03)
    C.apply_transform(body, loc=True)
    wire = geo.mat('chrome', rough=0.2)
    hook = geo.tube(f'{name}_hook', [(0, 0, -0.03), (0, 0, 0.0), (0.02, 0, 0.018), (0.035, 0, 0.0)], 0.0035, material=wire)
    bar = geo.tube(f'{name}_bar', [(-0.17, 0, -0.08), (0, 0, -0.03), (0.17, 0, -0.08)], 0.0045, material=wire)
    return _join([body, hook, bar], name)


def folded_tee(name='tee', color='fabric_e'):
    w, d, t = 0.3, 0.24, 0.03
    slab = geo.box(f'{name}_fold', (w, d, t), (0, 0, 0), material=geo.mat(color, rough=0.9), bev=0.011)
    collar = geo.box(f'{name}_collar', (0.1, 0.02, 0.006), (0, -d / 2 + 0.03, t - 0.001), material=geo.mat(color, rough=0.9), bev=0.003)
    return _join([slab, collar], name)


def rail(name='rail', w=1.4, h=1.45):
    """A chrome garment rail on two T-feet. Origin at floor centre."""
    chrome = geo.mat('chrome', rough=0.16)
    parts = [geo.tube(f'{name}_bar', [(-w / 2, 0, h), (w / 2, 0, h)], 0.016, material=chrome)]
    for sx in (-1, 1):
        x = sx * (w / 2 - 0.03)
        parts.append(geo.tube(f'{name}_post', [(x, 0, 0.03), (x, 0, h)], 0.018, material=chrome))
        parts.append(geo.box(f'{name}_foot', (0.05, 0.5, 0.03), (x, 0, 0), material=geo.mat('trim', rough=0.5), bev=0.01))
        for sy in (-1, 1):
            parts.append(geo.cyl(f'{name}_caster', 0.022, 0.03, (x, sy * 0.22, -0.005), rot=(90, 0, 0),
                                 material=geo.mat('rubber'), verts=16, bev=0.003))
    return _join(parts, name, role='dyn')


def dome_camera(name='domecam'):
    base = geo.cyl(f'{name}_base', 0.07, 0.025, (0, 0, -0.025), material=geo.mat('plastic_w', rough=0.4), verts=28, bev=0.006)
    dome = geo.sphere(f'{name}_dome', 0.055, (0, 0, -0.025), (1, 1, 0.9), material=geo.pbr('dome', '#15171c', rough=0.08), seg=24)
    return _join([base, dome], name)


def wall_camera(name='cam'):
    """A bullet camera on a wall arm. Origin at the wall mount; looks along -Y."""
    white = geo.mat('plastic_w', rough=0.35)
    mount = geo.box(f'{name}_mount', (0.08, 0.02, 0.1), (0, 0, -0.05), material=white, bev=0.006)
    arm = geo.tube(f'{name}_arm', [(0, -0.01, 0), (0, -0.12, -0.03)], 0.012, material=white)
    body = geo.cyl(f'{name}_body', 0.035, 0.2, (0, -0.12, -0.03), rot=(90, 0, 0), material=white, verts=20, bev=0.008)
    body.location.y -= 0.0
    lens = geo.cyl(f'{name}_lens', 0.024, 0.012, (0, -0.325, -0.03), rot=(90, 0, 0), material=geo.pbr('lens', '#0c0d10', rough=0.05),
                   verts=20, bev=0.002)
    hood = geo.box(f'{name}_hood', (0.085, 0.22, 0.012), (0, -0.215, 0.005), material=white, bev=0.004)
    return _join([mount, arm, body, lens, hood], name, role='set')
