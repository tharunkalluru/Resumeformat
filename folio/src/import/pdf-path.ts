/** Bounded PDF.js straight path. Repeated identical initial moves paint no ink. */
export function simpleSourcePath(data: ArrayLike<number> | undefined): { points: number[][]; closed: boolean } | undefined {
  if (!data || !data.length || data.length > 65536) return undefined;
  const points: number[][] = [];
  let closed = false, moves = 0;
  for (let i = 0; i < data.length;) {
    const command = data[i++];
    if (command === 0 || command === 1) {
      if (closed || i + 1 >= data.length || !Number.isFinite(data[i]) || !Number.isFinite(data[i + 1])) return undefined;
      const point = [data[i++], data[i++]];
      if (command === 0) {
        if (moves === 1 && points.length === 1 && point.every((value, axis) => value === points[0][axis])) continue;
        if (++moves !== 1) return undefined;
      } else if (moves !== 1) return undefined;
      points.push(point);
      if (points.length > 5) return undefined;
    } else if (command === 4 && moves === 1 && !closed) closed = true;
    else return undefined;
  }
  return moves === 1 && points.length ? { points, closed } : undefined;
}
