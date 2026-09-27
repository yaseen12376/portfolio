/**
 * Staff jobs on any site: every member of staff (or worker) does many jobs,
 * and a job board picks where the next one is, so at any moment they are
 * spread over the scene: where no other member of staff is and the fewest
 * customers are, leaning to each person's own part of it, never the same job
 * twice running, never facing someone across an aisle.
 *
 * A scene supplies its jobs: name -> (a) => { d (district), at {x, z},
 * run() -> the first task, cost? } or null when the job can't be done now.
 */
export function jobBoard({ people, districts, rand, staff, customer }) {
  const isStaff = (p) => staff.includes(p.role);
  const aimNear = (at, a, r, ok) =>
    people.filter((p) => {
      if (p === a || !p.visible || !ok(p)) return false;
      const [x, z] = districts.aim(p);
      return Math.hypot(x - at.x, z - at.z) < r;
    });
  const settled = (p) => !(p.task?.go && !p.claim);
  /** Other staff in (or heading to) district `d`. */
  const staffIn = (d, a) => (d ? people.filter((p) => p !== a && p.visible && isStaff(p) && districts.where(p) === d).length : 0);
  /** Anyone (bar passers-by) standing, or about to, within 1.1 m of `at`. */
  const standingBy = (at, a) => aimNear(at, a, 1.1, (p) => p.role !== 'passer' && settled(p)).length > 0;
  /** Customers standing, or about to, within 1.1 m of `at`. */
  const customerBy = (at, a) => aimNear(at, a, 1.1, (p) => p.role === customer && settled(p)).length > 0;
  /** Other staff at, or on their way to, somewhere within 1.8 m of `at`. */
  const staffNear = (at, a) => aimNear(at, a, 1.8, isStaff).length;

  /**
   * The next job for `a` from `jobs` (names in `table`); `home` jobs cost
   * less; `beside` names jobs that are meant to be next to someone (a word
   * with a customer). Returns the job's first task, or null.
   */
  function next(a, jobs, home, table, { beside = ['help'] } = {}) {
    let best = null;
    for (const name of jobs) {
      const j = table[name]?.(a);
      if (!j) continue;
      const by = beside.includes(name);
      if (!by && standingBy(j.at, a)) continue;
      // A part of the floor nobody has used for a while is where a job shows best.
      const quiet = j.d?.feature ? Math.min(3, j.d.idle / 4) : 0;
      const cost = 3 * staffIn(j.d, a) + 2.5 * staffNear(j.at, a) + 2 * (j.d?.groups ?? 0) + (!by && customerBy(j.at, a) ? 4 : 0) - quiet + (home.includes(name) ? 0 : 1.2) + (name === a.st.lastJob ? 5 : 0) +
        0.15 * Math.hypot(j.at.x - a.pos.x, j.at.z - a.pos.y) + rand() * 1.2 + (j.cost ?? 0);
      if (!best || cost < best.cost) best = { name, j, cost };
    }
    if (!best || best.cost > 50) return null;
    a.st.lastJob = best.name;
    a.st.jobs = (a.st.jobs ?? 0) + 1;
    return best.j.run();
  }

  return { next, staffIn, standingBy, customerBy, staffNear };
}
