/** Postgres timestamptz text ("2026-10-14 11:56:17.645092+05:30") -> ISO UTC. */
export function toIso(v: unknown) {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const d = new Date(v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
    return Number.isNaN(d.getTime()) ? v : d.toISOString();
  }
  return v;
}
