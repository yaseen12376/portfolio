/**
 * A diorama's features, one chapter each.
 *
 * The words come from the project's data (src/data/projects.js, scene3d.chapters:
 * id, title, caption, hint), so they exist without WebGL too. The behaviour comes
 * from the scene controller (scenes/<id>.js, controller.chapters), keyed by the
 * same ids:
 *
 *   { id, shot?, enter?(), exit?(), update?(dt), readouts?() -> [{ label, value, tone? }],
 *     actions?() -> [{ id, label, pressed? }], act?(id), pip?: true, qa?() }
 *
 * `pip` asks for a picture-in-picture: the controller's pip() says which of
 * the scene's own cameras to show (the explorer gives it a canvas).
 *
 * On a card the runner tours a few chapters on its own, pausing while the
 * pointer is over the card: the whole island for a moment, then each
 * chapter's district in turn (the camera flies there), then the island again.
 * In a case study the explorer (project-detail.js) drives it.
 *
 * `onEnter(id)` (optional) hears every chapter change: the scene's director
 * uses it to make the chapter's feature happen soon after it opens.
 */
const TOUR_SECS = 6.5;
const HOME_SECS = 1.5;

export class Chapters {
  /**
   * @param {{ rig, list: object[], meta: object[], tour?: string[], context: string }} o
   */
  constructor({ rig, list, meta, tour = [], context, onEnter = null }) {
    this.rig = rig;
    this.meta = new Map((meta ?? []).map((m) => [m.id, m]));
    // Only chapters the page has words for, in the data's order.
    const byId = new Map(list.map((c) => [c.id, c]));
    this.list = (meta ?? []).map((m) => byId.get(m.id)).filter(Boolean);
    this.tour = tour.filter((id) => byId.has(id));
    this.context = context;
    this.current = null;
    this.clock = 0;
    this.readClock = 0;
    this.paused = false;
    this.listeners = new Set();
    this.onEnter = onEnter;
    // Cards open on the whole island before the tour flies to a district.
    this.home = context !== 'case' && this.tour.length ? HOME_SECS : 0;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, data) {
    // (What the buttons were last drawn from, so a change can be spotted.)
    if (type === 'actions') this.actionSig = data.map((x) => `${x.id}:${x.label}:${x.pressed ?? ''}`).join('|');
    for (const fn of this.listeners) fn(type, data);
  }

  get index() {
    return this.list.indexOf(this.current);
  }

  info(ch = this.current) {
    return ch ? { id: ch.id, ...this.meta.get(ch.id) } : null;
  }

  /** Switch to a chapter (id or index). `shot: false` keeps the camera where it is. */
  go(which, { shot = true } = {}) {
    const next = typeof which === 'number' ? this.list[(which + this.list.length) % this.list.length] : this.list.find((c) => c.id === which);
    if (!next || next === this.current) return this.current;
    this.current?.exit?.();
    this.current = next;
    this.clock = 0;
    next.enter?.();
    this.onEnter?.(next.id);
    if (shot && !(this.home > 0)) this.rig.setShot(next.shot ?? null);
    this.emit('chapter', this.info());
    this.emit('actions', next.actions?.() ?? []);
    this.emit('pip', !!next.pip);
    this.readClock = Infinity; // readouts right away
    return next;
  }

  step(d) {
    return this.go(Math.max(0, this.index) + d);
  }

  act(id) {
    this.current?.act?.(id);
    this.emit('actions', this.current?.actions?.() ?? []);
    this.readClock = Infinity;
  }

  pauseTour(on) {
    this.paused = on;
  }

  update(dt) {
    this.current?.update?.(dt);
    if (this.context !== 'case' && this.tour.length > 1 && !this.paused) {
      if (this.home > 0) {
        // On the whole island for a moment, then off to this chapter's district.
        this.home -= dt;
        if (this.home <= 0) this.rig.setShot(this.current?.shot ?? null);
        return this.readouts(dt);
      }
      this.clock += dt;
      if (this.clock > TOUR_SECS) {
        const i = this.tour.indexOf(this.current?.id);
        const next = (i + 1) % this.tour.length;
        // Back to the whole island between rounds.
        if (next === 0) {
          this.home = HOME_SECS;
          this.rig.setShot(null);
        }
        this.go(this.tour[next]);
      }
    }
    this.readouts(dt);
  }

  readouts(dt) {
    this.readClock += dt;
    if (this.readClock > 0.25 && this.listeners.size) {
      this.readClock = 0;
      this.emit('readouts', this.current?.readouts?.() ?? []);
      // Buttons that come and go with what happens (an evidence clip once
      // one is recorded, a review once an alert waits): redrawn when they change.
      const actions = this.current?.actions?.() ?? [];
      const sig = actions.map((x) => `${x.id}:${x.label}:${x.pressed ?? ''}`).join('|');
      if (sig !== this.actionSig) this.emit('actions', actions);
    }
  }

  dispose() {
    this.current?.exit?.();
    this.listeners.clear();
  }
}
