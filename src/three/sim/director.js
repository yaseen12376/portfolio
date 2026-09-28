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
   * (three.js x, z) first, or, when `to` is a function, lowest `to(a)` (a
   * scene's own reckoning: say, whoever moving thins a crowd). Null if nobody fits.
   */
  cast(pool, ok, to = null) {
    let best = null;
    let bd = Infinity;
    for (const a of pool) {
      if (!a.visible || a.fadeDir || !ok(a)) continue;
      const d = typeof to === 'function' ? to(a) : to ? Math.hypot(a.pos.x - to.x, a.pos.y - to.z) : 0;
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

  /** `a` is on the director's errand `job` for `secs`: never cast for another meanwhile. */
  hire(a, job, secs) {
    if (a) {
      a.job = job;
      a.jobUntil = this.time + secs;
    }
    return a;
  }

  /** Is `a` still on errand `job`? */
  onJob(a, job) {
    return a.job === job && a.jobUntil > this.time;
  }

  /** On any errand of the director's? */
  busy(a) {
    return a.jobUntil > this.time;
  }

  /** The first of `tests` anyone in `pool` passes: the best-suited, falling back to less so. */
  castFirst(pool, tests, to) {
    for (const ok of tests) {
      const p = this.cast(pool, ok, to);
      if (p) return p;
    }
    return null;
  }

  /**
   * Break up any pile, checked every second: a district holding more groups
   * than it should for 6 s, or four or more groups within a metre of someone
   * for 4 s: whoever of the `movable` has stood there longest moves on
   * (`moveOn`, to their next stop, somewhere quiet).
   * @param {{ districts: import('./spread.js').Districts, people: () => object[], here: () => object[],
   *           movable: (a) => boolean, moveOn: (a) => object, when?: () => boolean }} o
   *   here: the people who count towards a knot (on the floor, not in a queue).
   */
  breakUpPiles({ districts, people, here, movable, moveOn, when = () => true }) {
    let knotT = 0;
    const key = (o) => (o.party ? `p${o.party}` : o.id);
    this.flow('spread', {
      every: 1,
      when,
      run: () => {
        const over = districts.worst(6);
        if (over) {
          const p = people().filter((q) => movable(q) && districts.of(q.pos.x, q.pos.y) === over).sort((x, y) => y.timer - x.timer)[0];
          if (p) {
            over.over = 0;
            return moveOn(p);
          }
        }
        const on = here();
        const knot = on.find((q) => new Set(on.filter((o) => Math.hypot(o.pos.x - q.pos.x, o.pos.y - q.pos.y) <= 1).map(key)).size >= 4);
        knotT = knot ? knotT + 1 : 0;
        if (knotT >= 4) {
          const p = on.filter((q) => movable(q) && Math.hypot(q.pos.x - knot.pos.x, q.pos.y - knot.pos.y) <= 1.2).sort((x, y) => y.timer - x.timer)[0];
          if (p) {
            knotT = 0;
            return moveOn(p);
          }
        }
        return null;
      },
    });
  }
}

/**
 * A casting score (lower is better, for `cast`'s `to`) that prefers whoever
 * moving would thin a crowd (the groups in their district and the people
 * within a metre of them), then whoever is nearest `to`:
 * `director.cast(pool, ok, crowdScore({ districts, people })(spot))`.
 */
export function crowdScore({ districts, people }) {
  const crowdAt = (p) => (districts.of(p.pos.x, p.pos.y)?.groups ?? 0) + people.filter((q) => q !== p && q.visible && Math.hypot(q.pos.x - p.pos.x, q.pos.y - p.pos.y) < 1).length;
  return (to) => (p) => -2 * crowdAt(p) + 0.1 * Math.hypot(p.pos.x - to.x, p.pos.y - to.z);
}
