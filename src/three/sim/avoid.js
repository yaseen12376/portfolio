/**
 * Local avoidance: each walker picks, every frame, the velocity that best
 * keeps to its route while not heading into anyone in the next few seconds.
 *
 * This is the sampled velocity-obstacle method of Recast/Detour's DetourCrowd
 * (dtObstacleAvoidanceQuery): score a pattern of candidate velocities, refine
 * round the best, keep the cheapest. A candidate's cost is
 *   - how far it is from the preferred velocity (along the route),
 *   - how far from the current one (people don't jink),
 *   - a side preference, so two people meeting both pass the same way
 *     (keeping left, as people do where these stores are),
 *   - how soon it would bring the walker into contact with someone:
 *     1 / time-to-collision, over a 2.5 s horizon, and how far into their
 *     personal space its closest approach would come. Pedestrians react
 *     to the time until they would collide, not to distance (Karamouzas,
 *     Skinner and Guy, "Universal power law governing pedestrian
 *     interactions", PRL 2014), which is why people curve round each other a
 *     metre or two ahead instead of meeting and shuffling.
 *   - how soon it would run into a wall or fixture.
 * Walkers share the effort (each assumes the other steers half: reciprocal
 * velocity obstacles); someone standing is treated as a post.
 */

/** The weights (DetourCrowd's defaults, tuned on scripts/qa/crowd.mjs). */
export const tune = {
  horizon: 2.5, // s: how far ahead people look for collisions
  wallHorizon: 0.8, // s: walls matter only when close; the route already goes round them
  des: 2.0, // keep to the route
  cur: 0.75, // keep to the current velocity
  side: 0.75, // pass on the agreed side
  toi: 2.5, // time to impact with a person
  wall: 1.2, // time to impact with a wall
  hard: 0.35, // s: closer than this to actual contact is almost ruled out
  room: 1.2, // coming within someone's personal space
  back: 2.0, // walking backwards
};

// Candidate headings, relative to the preferred direction: dense ahead, sparse behind.
const ANGLES = [0, 0.24, -0.24, 0.5, -0.5, 0.8, -0.8, 1.15, -1.15, 1.6, -1.6, 2.3, -2.3, Math.PI];
const SPEEDS = [1, 0.62, 0.28];
const MAX = 16;
// Per-neighbour working values, reused every call.
const OX = new Float64Array(MAX);
const OZ = new Float64Array(MAX);
const SG = new Float64Array(MAX);
const BVX = new Float64Array(MAX);
const BVZ = new Float64Array(MAX);
const RR = new Float64Array(MAX);
const CF = new Float64Array(MAX);
const WALK = new Uint8Array(MAX);
const DD = new Float64Array(MAX);

/**
 * Time until two discs, `p` apart (b - a), meet when a moves at `w` relative
 * to b, their radii summing to R. 0 if already touching and closing; Infinity
 * if they never meet (or are moving apart).
 */
export function ttc(px, pz, wx, wz, R) {
  const c = px * px + pz * pz - R * R;
  const b = px * wx + pz * wz;
  if (c < 0) return b > 0 ? 0 : Infinity;
  if (b <= 0) return Infinity;
  const a = wx * wx + wz * wz;
  if (a < 1e-9) return Infinity;
  const disc = b * b - a * c;
  if (disc <= 0) return Infinity;
  return (b - Math.sqrt(disc)) / a;
}

/**
 * The velocity for `a` this frame.
 * @param {object} a       the agent: pos, vel, radius
 * @param {number} px, pz  preferred velocity (route direction times pace)
 * @param {{x:number,z:number,vx:number,vz:number,r:number,mode:string,comfort:number}[]} near
 *   neighbours: mode 'walk' (steers too: share the effort), 'post' (standing,
 *   or not steering: go round), 'kin' (one's own party: close is fine, no side
 *   rule), 'follow' (ahead in single file: fall in behind)
 * @param {(vx:number, vz:number, maxT:number) => number} wallTime  seconds until
 *   moving at (vx, vz) hits an obstacle (Infinity within maxT)
 * @param {number} vmax    the walker's top speed now
 * @param {number[]} out   receives [vx, vz]
 */
export function chooseVelocity(a, px, pz, near, wallTime, vmax, out) {
  const ax = a.pos.x;
  const az = a.pos.y;
  const cvx = a.vel.x;
  const cvz = a.vel.y;
  const pref = Math.hypot(px, pz);
  const inv = 1 / Math.max(vmax, 0.05);

  // Per neighbour: offset, velocity, radii, and which side to pass them on
  // (+1 on one's right: steer left; -1 on one's left). Someone behind and
  // drawing away, or standing well off to the side, can't matter: left out.
  const ox = OX;
  const oz = OZ;
  const sgn = SG;
  const ux = pref > 1e-3 ? px / pref : Math.sin(a.heading ?? 0);
  const uz = pref > 1e-3 ? pz / pref : Math.cos(a.heading ?? 0);
  let n = 0;
  for (const b of near) {
    if (n === MAX) break;
    const x = b.x - ax;
    const z = b.z - az;
    const d = Math.hypot(x, z);
    const R = a.radius + b.r;
    if (d > R + b.comfort + 0.3) {
      if (b.mode === 'post' && d > 2.2) continue;
      if (x * ux + z * uz < 0 && x * (cvx - b.vx) + z * (cvz - b.vz) <= 0) continue;
    }
    ox[n] = x;
    oz[n] = z;
    DD[n] = d || 1;
    BVX[n] = b.vx;
    BVZ[n] = b.vz;
    RR[n] = R;
    CF[n] = b.comfort;
    WALK[n] = b.mode === 'walk' ? 1 : 0;
    const lat = x * uz - z * ux; // > 0: they are on one's left
    sgn[n] = Math.abs(lat) > 0.15 ? (lat > 0 ? -1 : 1) : 1;
    n++;
  }

  const { horizon: HORIZON, wallHorizon: WALL_HORIZON, des: W_DES, cur: W_CUR, side: W_SIDE, toi: W_TOI, wall: W_WALL, hard: HARD, room: W_ROOM, back: W_BACK } = tune;
  const sq = Math.sqrt;
  // Every term is a penalty (none below zero), so a candidate already costing
  // more than the best so far is dropped as soon as that's certain.
  const cost = (vx, vz, limit = Infinity) => {
    const ddx = vx - px;
    const ddz = vz - pz;
    const dcx = vx - cvx;
    const dcz = vz - cvz;
    let pen = W_DES * sq(ddx * ddx + ddz * ddz) * inv + W_CUR * sq(dcx * dcx + dcz * dcz) * inv;
    const sp = sq(vx * vx + vz * vz);
    // People rarely walk backwards: better to stop, or step to the side.
    const back = pref > 1e-3 ? -(vx * px + vz * pz) / pref : 0;
    if (back > 0) pen += W_BACK * back * inv;
    if (pen >= limit) return pen;
    let tmin = HORIZON;
    let hard = Infinity;
    let side = 0;
    let nside = 0;
    for (let i = 0; i < n; i++) {
      const bvx = BVX[i];
      const bvz = BVZ[i];
      // Relative velocity: a walker is expected to take half the avoiding.
      let wx;
      let wz;
      if (WALK[i]) {
        wx = 2 * vx - cvx - bvx;
        wz = 2 * vz - cvz - bvz;
      } else {
        // Someone standing, one's own party, or someone ahead in single file:
        // expect them to carry on as they are, and do all the avoiding.
        wx = vx - bvx;
        wz = vz - bvz;
      }
      const R = RR[i];
      const comfort = CF[i];
      const th = ttc(ox[i], oz[i], vx - bvx, vz - bvz, R + 0.05);
      if (th < hard) hard = th;
      // Time to contact (with a hair's margin), for the main penalty.
      const t = ttc(ox[i], oz[i], wx, wz, R + 0.06);
      if (t < tmin) tmin = t;
      // Personal space: how far inside it the closest approach would come,
      // the sooner the worse. Soft, so where there's no room people still
      // squeeze past rather than stand and wait.
      const room = R + comfort;
      if (comfort > 0) {
        const ww = wx * wx + wz * wz;
        const tca = ww > 1e-9 ? Math.min(HORIZON, Math.max(0, (ox[i] * wx + oz[i] * wz) / ww)) : 0;
        const ex = ox[i] - wx * tca;
        const ez = oz[i] - wz * tca;
        const dmin = sq(ex * ex + ez * ez);
        if (dmin < room) {
          const k = Math.min(1, (room - dmin) / comfort);
          pen += W_ROOM * k * k * (1 - (0.6 * tca) / HORIZON);
        }
      }
      // Already within it (arriving beside them, or they stepped close):
      // don't freeze, but dislike closing in further.
      if (DD[i] < room) {
        const d = DD[i];
        const closing = ((vx - bvx) * ox[i] + (vz - bvz) * oz[i]) / d;
        if (closing > 0) pen += closing * inv;
      }
      // The side to pass on: the side they're already on, if they're clearly
      // to one side; head on, keep left (they pass on one's right). A figure
      // facing +z has +x on its left.
      if (WALK[i] && t < HORIZON && sp > 1e-3) {
        const d = DD[i];
        const lx = oz[i] / d;
        const lz = -ox[i] / d;
        side += (1 - (sgn[i] * (vx * lx + vz * lz)) / sp) * 0.5;
        nside++;
      }
    }
    if (nside) pen += (W_SIDE * side) / nside;
    pen += W_TOI / (0.1 + tmin / HORIZON) - W_TOI / 1.1;
    if (hard < HARD) pen += 12 * (1 - hard / HARD);
    if (pen >= limit) return pen;
    if (sp > 1e-3) {
      const tw = wallTime(vx, vz, WALL_HORIZON);
      // The very next step is into something: nearly ruled out (the move
      // itself would slide along it), but not impossible, so someone brushing
      // a corner is never frozen there.
      if (tw < 0.06) pen += 20;
      else if (tw < WALL_HORIZON) pen += W_WALL * (1 - tw / WALL_HORIZON);
    }
    return pen;
  };

  // The pattern: round the preferred direction (or the way they face), at a
  // few speeds; plus standing still, the preferred and the current velocity.
  let bx = 0;
  let bz = 0;
  let best = cost(0, 0);
  const tryV = (vx, vz) => {
    const c = cost(vx, vz, best);
    if (c < best) {
      best = c;
      bx = vx;
      bz = vz;
    }
  };
  tryV(px, pz);
  tryV(cvx, cvz);
  const base = pref > 1e-3 ? Math.atan2(px, pz) : Math.atan2(cvx, cvz);
  const top = pref > 1e-3 ? pref : 0;
  if (top > 0) {
    for (const s of SPEEDS) {
      for (const da of ANGLES) {
        const ang = base + da;
        tryV(Math.sin(ang) * top * s, Math.cos(ang) * top * s);
      }
    }
    // Refine round the best, twice, at shrinking radius.
    for (const r of [0.18, 0.08]) {
      const cx = bx;
      const cz = bz;
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        let vx = cx + Math.sin(ang) * top * r;
        let vz = cz + Math.cos(ang) * top * r;
        const l = Math.hypot(vx, vz);
        if (l > vmax) {
          vx *= vmax / l;
          vz *= vmax / l;
        }
        tryV(vx, vz);
      }
    }
  }
  out[0] = bx;
  out[1] = bz;
  return best;
}
