let counter = 0;

/** Short, collision-resistant id. Deterministic-ish ordering helps debugging. */
export function uid(prefix = 'id'): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${counter.toString(36)}${rand}`;
}
