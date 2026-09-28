/**
 * An alert queue, as the products keep one: the newest first, the last `max`
 * kept, and optionally a cooldown per key (a camera and an alert type, say)
 * during which the same alert is held back and counted rather than raised.
 *
 * What an alert holds, and what happens to it after (a person reviews it, a
 * dashboard turns it into cards), is the scene's own; `make()` builds it only
 * once the alert is actually raised, so nothing expensive (a screenshot) is
 * done for one that is held back.
 */
export function alertQueue({ list = [], max = 20, cooldown = 0, now = () => 0 } = {}) {
  const clear = new Map(); // key -> when it may be raised again
  const q = {
    list,
    suppressed: 0,
    /** Raise an alert under `key` (null: never held back). Returns it, or null if it was held back. */
    raise(key, make) {
      if (cooldown && key != null) {
        if (now() < (clear.get(key) ?? -Infinity)) {
          q.suppressed++;
          return null;
        }
        clear.set(key, now() + cooldown);
      }
      const item = make();
      list.unshift(item);
      if (list.length > max) list.pop();
      return item;
    },
  };
  return q;
}
