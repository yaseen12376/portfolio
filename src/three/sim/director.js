/**
 * The director: makes sure each chapter's feature is actually seen, soon
 * after the chapter opens, without scripting anyone.
 *
 * Two tools, both working through the simulation (routines, errands, the
 * crowd), never by moving anyone the camera can see:
 *
 *  - flows keep a scene's rhythms going all the time (someone is always on
 *    the way to the door, the till, a fitting room), so a chapter's event is
 *    never far off: every `every` seconds, if `when()` says the rhythm has
 *    gone quiet, `run()` casts someone to restart it.
 *  - beats run when a chapter opens: they cast the most suitable person
 *    nearby to do the thing now (step up to pay, badge in, try something on).
 *
 * Casting picks from people who are free (not paying, not leaving), nearest
 * first, and hands them an errand through `redirect`, which the crowd starts
 * at once.
 */
export class Director {
  /** @param {{ crowd: import('./agents.js').Crowd, rand?: () => number }} o  (rand: the scene's seeded one, so a run can be replayed) */
  constructor({ crowd, rand = Math.random }) {
    this.crowd = crowd;
    this.rand = rand;
    this.flows = [];
    this.beats = new Map();
    this.log = []; // what was cast, for QA
    this.time = 0;
  }

  /** A rhythm to keep going: checked every `every` seconds. */
  flow(name, { every, when, run }) {
    this.flows.push({ name, every, when, run, t: every * this.rand() });
  }

  /** What to do when chapter `id` opens. */
  beat(id, fn) {
    this.beats.set(id, fn);
  }

  /** A chapter opened: run its beat. */
  enter(id) {
    const fn = this.beats.get(id);
    if (!fn) return;
    const who = fn();
    this.log.push({ t: this.time, beat: id, who: who?.id ?? null });
  }

  update(dt) {
    this.time += dt;
    for (const f of this.flows) {
      f.t -= dt;
      if (f.t > 0) continue;
      f.t = f.every;
      if (f.when()) {
        const who = f.run();
        if (who) this.log.push({ t: this.time, flow: f.name, who: who.id });
      }
    }
  }

  /**
   * The best person for a job: `pool` filtered by `ok`, nearest to `to`
   * (three.js x, z) first. Null if nobody fits.
   */
  cast(pool, ok, to = null) {
    let best = null;
    let bd = Infinity;
    for (const a of pool) {
      if (!a.visible || a.fadeDir || !ok(a)) continue;
      const d = to ? Math.hypot(a.pos.x - to.x, a.pos.y - to.z) : 0;
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  /**
   * Start `a` on a new errand now: whatever they were doing ends (and any
   * errands they had queued are dropped), and their routine is asked again,
   * with `setup(a)` having set up what it should answer.
   */
  redirect(a, setup) {
    if (!a) return null;
    a.resume = null;
    a.detour = null;
    if (a.st) a.st.tasks = [];
    setup?.(a);
    this.crowd.next(a);
    return a;
  }
}
