/** Preserve extraction-owned word boundaries; paint operators supply only proven
 * literal horizontal spaces. Callers must prove cross-item ownership separately. */
export function reconcilePdfText(observed: string, operator: string, restoreLeadingSpace = false): string {
  const split = (value: string) => {
    const characters: string[] = [], boundaries = [''];
    for (const character of value) {
      if (/\s/u.test(character)) boundaries[characters.length] += character;
      else { characters.push(character); boundaries.push(''); }
    }
    return { characters, boundaries };
  };
  const original = split(observed), paint = split(operator);
  if (original.characters.join('') !== paint.characters.join('')) return observed;
  const horizontal = (value: string) => /^[ \u00a0]+$/.test(value);
  const merge = (extracted: string, proven: string) => {
    if (!horizontal(proven)) return extracted;
    if (!extracted) return proven;
    // An observed NBSP or other non-ASCII whitespace remains authoritative.
    return /^ +$/.test(extracted) && proven.length >= extracted.length ? proven : extracted;
  };
  if (!original.characters.length) return merge(observed, operator);
  let result = original.boundaries[0];
  if (!result && restoreLeadingSpace && horizontal(paint.boundaries[0])) result = paint.boundaries[0];
  for (const [index, character] of original.characters.entries()) {
    result += character;
    result += index === original.characters.length - 1
      ? original.boundaries[index + 1]
      : merge(original.boundaries[index + 1], paint.boundaries[index + 1]);
  }
  return result;
}
