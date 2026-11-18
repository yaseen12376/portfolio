/**
 * The glTF steps shared by the two 3D builders (scripts/build-3d.mjs for the
 * dioramas, scripts/build-pieces.mjs for the live jars): optimise a Blender
 * export for the web, count what it costs to draw, and validate it.
 */
import { readFile } from 'node:fs/promises';

import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, instance, meshopt, prune, resample, simplifyPrimitive, weld } from '@gltf-transform/functions';
import validator from 'gltf-validator';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

export const io = () =>
  new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/**
 * Drop animation channels that never move: bones never scale, most never
 * translate, and a clip keys every bone. Each channel costs a sampler, two
 * accessors and their buffer views in the glTF JSON, which for a cast of
 * twenty clips was most of the file. A channel is static when every keyframe
 * equals the node's rest value.
 */
function dropStaticChannels(eps = 1e-4) {
  return (doc) => {
    let dropped = 0;
    for (const anim of doc.getRoot().listAnimations()) {
      for (const ch of anim.listChannels()) {
        const node = ch.getTargetNode();
        const path = ch.getTargetPath();
        const out = ch.getSampler()?.getOutput();
        if (!node || !out || !['translation', 'rotation', 'scale'].includes(path)) continue;
        const rest = path === 'translation' ? node.getTranslation() : path === 'rotation' ? node.getRotation() : node.getScale();
        const n = out.getElementSize();
        const arr = out.getArray();
        let still = true;
        for (let i = 0; i < arr.length && still; i += n) {
          // q and -q are the same rotation.
          const same = (sgn) => rest.every((r, k) => Math.abs(arr[i + k] * sgn - r) < eps);
          still = same(1) || (path === 'rotation' && same(-1));
        }
        if (still) {
          const sampler = ch.getSampler();
          ch.dispose();
          if (!sampler.listParents().some((p) => p.propertyType === 'AnimationChannel')) sampler.dispose();
          dropped++;
        }
      }
    }
    console.log(`  animation: dropped ${dropped} static channels`);
  };
}

/**
 * Simplify each triangle list to within `error` of its own radius, leaving out
 * any primitive with vertex colours: those carry a fade or baked occlusion per
 * vertex (a jar's dust, its brass rim) that a positions-only collapse would
 * flatten. UV and normal seams survive (meshopt collapses seam vertices only
 * in pairs), and a texture stays put on what remains, because each atlas
 * island's UVs are an affine projection of its positions.
 */
function simplifyMeshes(error) {
  return async (doc) => {
    await MeshoptSimplifier.ready;
    let before = 0;
    let after = 0;
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMode() !== 4 || !prim.getIndices() || prim.getAttribute('COLOR_0')) continue;
        before += prim.getIndices().getCount() / 3;
        simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: 0, error, lockBorder: false });
        after += prim.getIndices().getCount() / 3;
      }
    }
    console.log(`  simplify: ${before} -> ${after} triangles (error ${error} of each mesh's radius)`);
  };
}

/**
 * @param {object} [o]
 * @param {boolean} [o.animations]  keep the clips (no instancing; resampled, static channels dropped)
 * @param {number} [o.simplify]     error bound for simplifyMeshes(), as a fraction of each mesh's radius
 * @param {'medium'|'high'} [o.level]  meshopt: 'high' adds the filters (octahedral normals and so on)
 */
export async function optimise(src, dst, { animations = false, quantize = {}, simplify = 0, level = 'medium' } = {}) {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const doc = await io().read(src);
  // No prune of attributes or empty nodes: the lightmap UV (TEXCOORD_1) is
  // referenced by no material, and anchors are empty nodes the page reads.
  // Materials are never merged: in the tiled era their names say which photo
  // tile the page draws (Blender exports them with identical defaults).
  const steps = [dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }), weld()];
  if (simplify) steps.push(simplifyMeshes(simplify));
  if (!animations) steps.push(instance({ min: 2 }));
  if (animations) steps.push(resample(), dropStaticChannels());
  steps.push(prune({ propertyTypes: ['accessor', 'material', 'texture', 'animation'], keepAttributes: true, keepLeaves: true }));
  // 8-bit normals are invisible at diorama scale and halve their bytes.
  steps.push(meshopt({ encoder: MeshoptEncoder, level, quantizeNormal: 8, ...quantize }));
  await doc.transform(...steps);
  await io().write(dst, doc);
  return doc;
}

export function stats(doc) {
  const root = doc.getRoot();
  let triangles = 0;
  let drawCalls = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const inst = node.getExtension('EXT_mesh_gpu_instancing');
    const count = inst ? inst.getAttribute('TRANSLATION')?.getCount() ?? 1 : 1;
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const tris = (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
      triangles += tris * count;
      drawCalls += 1; // an instanced primitive is still one draw
    }
  }
  return { triangles: Math.round(triangles), drawCalls, nodes: root.listNodes().length, animations: root.listAnimations().length };
}

export async function validate(path) {
  const r = await validator.validateBytes(new Uint8Array(await readFile(path)), {
    externalResourceFunction: () => Promise.reject(new Error('no external resources')),
  });
  return { errors: r.issues.numErrors, warnings: r.issues.numWarnings, first: r.issues.messages.filter((m) => m.severity === 0).slice(0, 3) };
}
