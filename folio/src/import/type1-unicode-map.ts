/** A bounded data reader for single-byte Type1 ToUnicode CMaps. Never executes
 * PostScript or resolves usecmap resources. Unsupported syntax stays read-only. */
export function parseType1UnicodeMap(text: string): Map<number, string> | undefined {
  if (text.length > 65536 || /[^\x09\x0a\x0d\x20-\x7e]/.test(text)) return;
  const clean = text.replace(/%[^\r\n]*/g, '').trim();
  const wrapper = clean.match(/^\/CIDInit\s+\/ProcSet\s+findresource\s+begin\s+\d+\s+dict\s+begin\s+begincmap\s+([\s\S]*?)\s+endcmap\s+CMapName\s+currentdict\s+\/CMap\s+defineresource\s+pop\s+end\s+end$/);
  if (!wrapper) return;
  let body = wrapper[1];
  for (const definition of [
    /\/CIDSystemInfo\s*<<\s*\/Registry\s+\([^()\\]*\)\s+\/Ordering\s+\([^()\\]*\)\s+\/Supplement\s+\d+\s*>>\s+def/g,
    /\/CMapName\s+\/[A-Za-z0-9._+-]+\s+def/g,
    /\/CMapType\s+2\s+def/g,
  ]) {
    if ([...body.matchAll(definition)].length !== 1) return;
    body = body.replace(definition, '');
  }
  const result = new Map<number, string>();
  let codespace = false;
  const utf16 = (hex: string): string | undefined => {
    if (!/^(?:[\da-fA-F]{4}){1,8}$/.test(hex)) return;
    const units = hex.match(/.{4}/g)!.map(v => parseInt(v, 16));
    for (let i = 0; i < units.length; i++) {
      if (units[i] >= 0xd800 && units[i] <= 0xdbff) {
        if (++i >= units.length || units[i] < 0xdc00 || units[i] > 0xdfff) return;
      } else if (units[i] >= 0xdc00 && units[i] <= 0xdfff) return;
    }
    return String.fromCharCode(...units);
  };
  const put = (code: number, hex: string): boolean => {
    const unicode = utf16(hex);
    if (unicode === undefined || result.has(code)) return false;
    result.set(code, unicode);
    return true;
  };
  while (body.trim()) {
    const section = body.match(/^\s*(\d{1,3})\s+begin(codespacerange|bfchar|bfrange)\s+([\s\S]*?)\s+end\2/);
    if (!section) return;
    const count = Number(section[1]), kind = section[2], entries = section[3].trim();
    if (count < 1 || count > 256) return;
    if (kind === 'codespacerange') {
      if (codespace || count !== 1 || !/^<00>\s+<ff>$/i.test(entries)) return;
      codespace = true;
    } else {
      if (!codespace) return;
      const pattern = kind === 'bfchar' ? /<([\da-f]{2})>\s*<([\da-f]+)>/gi : /<([\da-f]{2})>\s*<([\da-f]{2})>\s*<([\da-f]{4})>/gi;
      const pairs = [...entries.matchAll(pattern)];
      if (pairs.length !== count || entries.replace(pattern, '').trim()) return;
      for (const pair of pairs) {
        const first = parseInt(pair[1], 16);
        if (kind === 'bfchar') {
          if (!put(first, pair[2])) return;
        } else {
          const last = parseInt(pair[2], 16), start = parseInt(pair[3], 16);
          if (last < first || start + last - first > 0xffff) return;
          for (let code = first; code <= last; code++) {
            if (!put(code, (start + code - first).toString(16).padStart(4, '0'))) return;
          }
        }
      }
    }
    body = body.slice(section[0].length);
  }
  return codespace && result.size ? result : undefined;
}
