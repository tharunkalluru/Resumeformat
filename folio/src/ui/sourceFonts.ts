import type { SourceFontAsset } from '../core/model';
import { canonicalJson, sha256Sync } from '../core/model';
import { FolioError } from '../core/errors';
import {browserCffFontFamily,deriveBrowserCffFont,verifyNativeCffCaret,type BrowserCffFontDerivation,type NativeCffCaretProof} from './sourceCffFonts';
import { loadSourceFont,parseSourceProgram,originalTrueTypePermissions } from '../layout/source-fonts';

const ADAPTER_VERSION = 'folio-browser-source-cmap-v1';
const MAX_PROGRAM = 4 * 1024 * 1024;

export function browserSourceFontFamily(asset: SourceFontAsset): string {
  if(asset.format==='opentype-cff')return browserCffFontFamily(asset);
  const identity = canonicalJson({ version: ADAPTER_VERSION, id: asset.id, sha256: asset.sha256, glyphMap: asset.glyphMap,sourceVersion:asset.sourceVersion,...(asset.sourceVersion===8?{capability:asset.capability,licensedDerivation:asset.licensedDerivation}:{}),...(asset.sourceVersion===7?{capability:asset.capability,originalPermission:asset.originalPermission,registrationFaceToken:asset.registrationFaceToken,declaredStyle:asset.declaredStyle}:{}),originalProgramSha256:asset.originalProgram?.sha256 });
  return `FolioSource-${sha256Sync(new TextEncoder().encode(identity)).slice(0, 32)}`;
}

function checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    const value = ((bytes[i] ?? 0) * 0x1000000 + (bytes[i + 1] ?? 0) * 0x10000 + (bytes[i + 2] ?? 0) * 0x100 + (bytes[i + 3] ?? 0)) >>> 0;
    sum = (sum + value) >>> 0;
  }
  return sum;
}

/** Browser-only derivative. The source program and exported CID map stay immutable. */
export function rewriteTrueTypeUnicodeCmap(bytes: Uint8Array, mappings: ReadonlyMap<number, number>): Uint8Array {
  if (bytes.length < 12 || bytes.length > MAX_PROGRAM) throw new FolioError('SOURCE_BROWSER_FONT', 'The source editing font exceeds the local TrueType limit.');
  const input = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (input.getUint32(0) !== 0x00010000) throw new FolioError('SOURCE_BROWSER_FONT', 'The source editing font is not a TrueType program.');
  const count = input.getUint16(4);
  if (!count || count > 128 || 12 + count * 16 > bytes.length || mappings.size > 100000) throw new FolioError('SOURCE_BROWSER_FONT', 'The source editing font has invalid table bounds.');
  const descriptors: { tag: number; offset: number; length: number }[] = [];
  const tags = new Set<number>();
  let copiedSize = 0;
  for (let i = 0; i < count; i++) {
    const entry = 12 + i * 16, tag = input.getUint32(entry), offset = input.getUint32(entry + 8), length = input.getUint32(entry + 12);
    if (tags.has(tag) || offset < 12 + count * 16 || offset + length > bytes.length) throw new FolioError('SOURCE_BROWSER_FONT', 'The source editing font has invalid or duplicate tables.');
    tags.add(tag);
    copiedSize += (length + 3) & ~3;
    if (copiedSize > MAX_PROGRAM) throw new FolioError('SOURCE_BROWSER_FONT', 'The source editing font has excessive table data.');
    descriptors.push({ tag, offset, length });
  }
  const ranges = descriptors.filter(table => table.length > 0).sort((a, b) => a.offset - b.offset);
  if (ranges.some((table, i) => i > 0 && table.offset < ranges[i - 1].offset + ranges[i - 1].length)) throw new FolioError('SOURCE_BROWSER_FONT', 'The source editing font has overlapping tables.');
  const tables: { tag: number; bytes: Uint8Array }[] = descriptors.map(({ tag, offset, length }) => {
    const data = bytes.slice(offset, offset + length);
    if (tag === 0x68656164) {
      if (data.length < 54) throw new FolioError('SOURCE_BROWSER_FONT', 'The source editing font has an invalid header.');
      new DataView(data.buffer).setUint32(8, 0);
    }
    return { tag, bytes: data };
  });
  if (!tags.has(0x68656164) || !tags.has(0x636d6170)) throw new FolioError('SOURCE_BROWSER_FONT', 'The source editing font has missing required tables.');
  const ordered = [...mappings].sort(([a], [b]) => a - b);
  const groups: { start: number; end: number; glyph: number }[] = [];
  for (const [code, glyph] of ordered) {
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff || !Number.isInteger(glyph) || glyph <= 0 || glyph > 65535) throw new FolioError('SOURCE_BROWSER_FONT', 'The source editing character map is invalid.');
    const last = groups.at(-1);
    if (last && code === last.end + 1 && glyph === last.glyph + code - last.start) last.end = code;
    else groups.push({ start: code, end: code, glyph });
  }
  const cmap = new Uint8Array(36 + groups.length * 12), view = new DataView(cmap.buffer);
  view.setUint16(2, 2);
  view.setUint16(4, 0); view.setUint16(6, 4); view.setUint32(8, 20);
  view.setUint16(12, 3); view.setUint16(14, 10); view.setUint32(16, 20);
  view.setUint16(20, 12); view.setUint32(24, cmap.length - 20); view.setUint32(32, groups.length);
  groups.forEach((group, i) => { const at = 36 + i * 12; view.setUint32(at, group.start); view.setUint32(at + 4, group.end); view.setUint32(at + 8, group.glyph); });
  tables.find(table => table.tag === 0x636d6170)!.bytes = cmap;
  tables.sort((a, b) => a.tag - b.tag);
  const size = 12 + count * 16 + tables.reduce((sum, table) => sum + ((table.bytes.length + 3) & ~3), 0);
  if (size > 8 * 1024 * 1024) throw new FolioError('SOURCE_BROWSER_FONT', 'The derived source editing font exceeds the local limit.');
  const output = new Uint8Array(size), out = new DataView(output.buffer);
  out.setUint32(0, 0x00010000); out.setUint16(4, count);
  const power = 2 ** Math.floor(Math.log2(count));
  out.setUint16(6, power * 16); out.setUint16(8, Math.log2(power)); out.setUint16(10, count * 16 - power * 16);
  let offset = 12 + count * 16, headerOffset = 0;
  tables.forEach((table, i) => {
    const at = 12 + i * 16;
    out.setUint32(at, table.tag); out.setUint32(at + 4, checksum(table.bytes)); out.setUint32(at + 8, offset); out.setUint32(at + 12, table.bytes.length);
    output.set(table.bytes, offset);
    if (table.tag === 0x68656164) headerOffset = offset;
    offset += (table.bytes.length + 3) & ~3;
  });
  out.setUint32(headerOffset + 8, (0xb1b0afba - checksum(output)) >>> 0);
  return output;
}

/** Converter OS/2 is compatibility data, never evidence of original permissions. */
function converterOs2(bytes:Uint8Array):Uint8Array{const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);for(let i=0;i<v.getUint16(4);i++){const at=12+i*16;if(v.getUint32(at)===0x4f532f32)return bytes.subarray(v.getUint32(at+8),v.getUint32(at+8)+v.getUint32(at+12));}throw new FolioError('SOURCE_BROWSER_FONT','Missing browser compatibility table.');}
/** Add only unambiguous source-proven Unicode aliases, including a proved empty space. */
export function browserSourceFontBytes(asset: SourceFontAsset): Uint8Array {
  if(asset.format!=='truetype')throw new FolioError('SOURCE_BROWSER_FONT','CFF source fonts require the asynchronous neutral conversion adapter.');
  const face = loadSourceFont(asset), mappings = new Map<number, number>();
  for (const code of face.font.characterSet) {
    const glyph = face.font.glyphForCodePoint(code).id;
    if (glyph > 0) mappings.set(code, glyph);
  }
  for (const entry of asset.glyphMap) {
    const scalars = Array.from(entry.unicode);
    if (scalars.length !== 1) throw new FolioError('SOURCE_BROWSER_FONT', 'This source glyph needs an editing adapter that is not available yet.');
    const mapping = face.mapping(entry.unicode);
    if (!mapping || mapping.glyphId !== entry.glyphId) throw new FolioError('SOURCE_BROWSER_FONT', 'This source character has ambiguous editing glyphs.');
    mappings.set(scalars[0].codePointAt(0)!, mapping.glyphId);
  }
  const bytes=rewriteTrueTypeUnicodeCmap(asset.bytes,mappings),derived=parseSourceProgram(bytes);
  const compatibilityUnchanged=asset.sourceVersion===7?sha256Sync(converterOs2(bytes))===sha256Sync(converterOs2(asset.bytes)):originalTrueTypePermissions(bytes)===originalTrueTypePermissions(asset.bytes);
  if(derived.unitsPerEm!==face.font.unitsPerEm||!compatibilityUnchanged)throw new FolioError('SOURCE_BROWSER_FONT','The derived source metrics or permissions changed.');
  for(const entry of asset.glyphMap){const glyph=derived.glyphForCodePoint(entry.unicode.codePointAt(0)!);if(glyph.id!==entry.glyphId||glyph.path.toSVG()!==face.font.getGlyph(entry.glyphId).path.toSVG()||glyph.advanceWidth!==face.font.getGlyph(entry.glyphId).advanceWidth)throw new FolioError('SOURCE_BROWSER_FONT','The derived native selector, outline or advance changed.');}
  return bytes;
}

export interface BrowserSourceRegistration {status:'editable'|'readOnly';reason?:string;derivation?:BrowserCffFontDerivation;nativeProof?:NativeCffCaretProof}
/** Per-face CFF refusal never removes a successfully registered sibling. */
export async function registerBrowserSourceFontSet(assets:readonly SourceFontAsset[]):Promise<{registrations:Map<string,BrowserSourceRegistration>;dispose:()=>void}> {
 const faces:FontFace[]=[],registrations=new Map<string,BrowserSourceRegistration>();
 for(const asset of assets){if(asset.sourceVersion===11){registrations.set(asset.id,{status:'readOnly',reason:'Original ligature font native editing is not qualified. Use supported Resume wording spans and the canonical PDF.'});continue;}let face:FontFace|undefined;
  try{const derivation=asset.format==='opentype-cff'?await deriveBrowserCffFont(asset):undefined,bytes=derivation?.bytes??browserSourceFontBytes(asset);
   face=new FontFace(browserSourceFontFamily(asset),new Uint8Array(bytes).buffer,{weight:String(asset.sourceVersion===7?400:asset.format==='truetype'?asset.fontWeight:asset.declaredStyle.weightClass??500),style:(asset.sourceVersion===7?false:asset.format==='truetype'?asset.italic:asset.declaredStyle.italic??false)?'italic':'normal',display:'block'});
   await face.load();document.fonts.add(face);faces.push(face);
   const nativeProof=asset.format==='opentype-cff'&&derivation?verifyNativeCffCaret(asset,derivation):undefined;registrations.set(asset.id,{status:asset.sourceVersion===10?'readOnly':'editable',...(asset.sourceVersion===10?{reason:'Numerical source font native editing is not qualified.'}:{}),...(derivation?{derivation,nativeProof}:{})});
  }catch(error){if(face){document.fonts.delete(face);const index=faces.indexOf(face);if(index>=0)faces.splice(index,1);}if(asset.format==='truetype'&&(asset.sourceVersion!==4&&asset.sourceVersion!==5&&asset.sourceVersion!==6&&asset.sourceVersion!==7&&asset.sourceVersion!==8&&asset.sourceVersion!==10)){faces.forEach(f=>document.fonts.delete(f));throw error;}registrations.set(asset.id,{status:'readOnly',reason:error instanceof Error?error.message:'The current source native font mapping is unavailable.'});}
 }
 return {registrations,dispose:()=>{faces.forEach(face=>document.fonts.delete(face));}};
}
/** Legacy v1 API; root's v2 canvas uses the per-face registration reports above. */
export async function registerBrowserSourceFonts(assets:readonly SourceFontAsset[]):Promise<()=>void>{return (await registerBrowserSourceFontSet(assets)).dispose;}
