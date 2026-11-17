/**
 * Running Blender headless, shared by the two 3D builders
 * (scripts/build-3d.mjs for the dioramas, scripts/build-pieces.mjs for the
 * collection under glass).
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BLENDER = process.env.BLENDER || 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
// A stage that runs longer is killed: 20 minutes suits the laptop's GPU; a
// CPU-only machine bakes slower (BLENDER_TIMEOUT_MIN=120).
export const TIMEOUT_MIN = Number(process.env.BLENDER_TIMEOUT_MIN) > 0 ? Number(process.env.BLENDER_TIMEOUT_MIN) : 20;

const KEEP = /BAKED|RENDERED|EXPORTED|MERGED|NAV|Error|Traceback|File "|Exception/;

/**
 * Run one Blender script in its own process and resolve with the seconds it
 * took. Lines matching `keep` are echoed as they arrive; the tail of the
 * output is in the error when it fails.
 */
export function blender(script, args, label, { timeoutMin = TIMEOUT_MIN, keep = KEEP } = {}) {
  return new Promise((ok, fail) => {
    const t0 = Date.now();
    const p = spawn(BLENDER, ['--background', '--factory-startup', '--python', join(ROOT, script), '--', ...args], { cwd: ROOT });
    let tail = '';
    const onData = (b) => {
      for (const line of b.toString().split(/\r?\n/)) {
        if (!line) continue;
        tail = (tail + '\n' + line).slice(-4000);
        if (keep.test(line) && !/HIPEW/.test(line)) console.log(`    ${label}: ${line.trim()}`);
      }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    const timer = setTimeout(() => p.kill(), timeoutMin * 60 * 1000);
    p.on('close', (code) => {
      clearTimeout(timer);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (code === 0 && !/Traceback/.test(tail)) return ok(secs);
      fail(new Error(`${label} failed (exit ${code}) after ${secs}s\n${tail.slice(-1500)}`));
    });
  });
}

/** A short content hash of repo files (paths relative to the repo) plus any extra string. */
export async function hashFiles(files, extra = '') {
  const h = createHash('sha256');
  for (const f of [...files].sort()) h.update(f).update(await readFile(join(ROOT, f)));
  h.update(extra);
  return h.digest('hex').slice(0, 16);
}
