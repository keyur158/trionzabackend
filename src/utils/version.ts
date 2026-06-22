/** Compare dotted numeric versions. Ignores any +build suffix; pads missing segments with 0. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v.split('+')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}