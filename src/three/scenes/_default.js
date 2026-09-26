/** A diorama with no toy of its own yet: its cast lives, you can orbit it. */
import { base } from './base.js';

export async function create(ctx) {
  const b = base(ctx);
  for (const c of ctx.stage.data.cast ?? []) b.figure(c);
  return {
    pickables: () => b.picks,
    update: (dt) => b.update(dt),
    snapshot: () => ({}),
    dispose: () => b.dispose(),
  };
}
