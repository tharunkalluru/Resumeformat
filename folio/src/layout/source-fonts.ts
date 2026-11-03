import {originalCffOutlineReader} from './original-cff-outline';
import {validateCffResourceSpec,proveOriginalCffOccurrence} from '../import/cff-resource-spec';
import {validateLicensedDerivation} from './licensed-subset';
import {parseDocumentScopedProgram} from './document-scoped-program';
import {originalMacRomanSelectors} from '../import/pdf-macroman';
import {originalSymbolicByteSelectors} from '../import/pdf-symbolic';
import {originalWinAnsiSelectors} from '../import/pdf-winansi';
import fontkit from '@pdf-lib/fontkit';
import type { Font } from '@pdf-lib/fontkit';
import { sha256Sync, canonicalJson, hashTextSync, type SourceFontAsset, type SourceGlyphMapping, type SourceFontAssetV2 } from '../core/model';
import { FolioError } from '../core/errors';
import { FontFaceMetrics } from './fonts';
import {exactTrueTypeFillOutline} from './source-outline';

export const sourceFontKey = (id: string): `source:${string}` => `source:${id}`;
// Parsed programs own this memo. It records cmap membership alone, never asset
// admission, source ownership, mutable mappings, or native editing availability.
const encodedSelectors=new WeakMap<Font,Map<number,boolean>>();
export function sourceGlyphHasEncoding(font:Font,glyphId:number):boolean {
 let selectors=encodedSelectors.get(font);if(!selectors){selectors=new Map();encodedSelectors.set(font,selectors);}
 const known=selectors.get(glyphId);if(known!==undefined)return known;
 const encoded=font.characterSet.some(cp=>font.glyphForCodePoint(cp).id===glyphId);selectors.set(glyphId,encoded);return encoded;
}
const sfntChecksum=(bytes:Uint8Array):number=>{let sum=0;for(let i=0;i<bytes.length;i+=4)sum=(sum+((bytes[i]??0)*0x1000000+(bytes[i+1]??0)*0x10000+(bytes[i+2]??0)*0x100+(bytes[i+3]??0)))>>>0;return sum;};
function sourceTable(bytes:Uint8Array,tag:string):{entry:number;offset:number;length:number}|undefined {
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 for(let i=0;i<view.getUint16(4);i++){const entry=12+i*16;if(String.fromCharCode(...bytes.slice(entry,entry+4))===tag)return {entry,offset:view.getUint32(entry+8),length:view.getUint32(entry+12)};}
}
/** Admission uses actual original rights; PDF.js deliberately clears these bits. */
export function originalTrueTypePermissions(bytes:Uint8Array):number {
 parseOriginalSourceProgram(bytes);const table=sourceTable(bytes,'OS/2')!,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),version=view.getUint16(table.offset),permissions=view.getUint16(table.offset+8);
 if(version>5||![0,8].includes(permissions))throw new FolioError('SOURCE_FONT_PERMISSIONS','The original font does not prove supported editable or installable outline embedding.');
 return permissions;
}
/** Preserve original permissions and repair both table and whole-font checksums. */
export function restoreOriginalTrueTypePermissions(converted:Uint8Array,original:Uint8Array):Uint8Array {
 parseSourceProgram(converted);const permissions=originalTrueTypePermissions(original),bytes=new Uint8Array(converted),view=new DataView(bytes.buffer),os2=sourceTable(bytes,'OS/2')!,head=sourceTable(bytes,'head');
 if(!head||head.length<54)throw new FolioError('SOURCE_FONT_INVALID','The converted source font has no bounded checksum header.');
 view.setUint16(os2.offset+8,permissions);view.setUint32(head.offset+8,0);
 view.setUint32(os2.entry+4,sfntChecksum(bytes.subarray(os2.offset,os2.offset+os2.length)));
 view.setUint32(head.entry+4,sfntChecksum(bytes.subarray(head.offset,head.offset+head.length)));
 view.setUint32(head.offset+8,(0xb1b0afba-sfntChecksum(bytes))>>>0);return bytes;
}
/** Template-owned identity cache. Explicit deletion removes strong registrations. */
const cache = new Map<string, { asset: SourceFontAsset; fingerprint:string; face: SourceFontFaceMetrics; bytes:Uint8Array; originalBytes?:Uint8Array }>();
const MAX_SNAPSHOT_BYTES=16*1024*1024;
const exactBytes=(current:Uint8Array,snapshot:Uint8Array):boolean=>{if(current.length!==snapshot.length)return false;for(let index=0;index<current.length;index++)if(current[index]!==snapshot[index])return false;return true;};
export function clearSourceFontCache(ids?: readonly string[]): void {
  if (!ids) cache.clear(); else for (const id of ids) cache.delete(id);
}
const originalWithoutPost=new WeakSet<Font>();
const originalWithoutCmap=new WeakSet<Font>();
/** Only the original parser can establish actual table absence, never a failed lookup. */
export const originalSourceHasNoCmap=(font:Font):boolean=>originalWithoutCmap.has(font);
function validateOriginalCmapBounds(bytes:Uint8Array,table:{offset:number;length:number}):void {
 const fail=():never=>{throw new FolioError('SOURCE_FONT_INVALID','The original cmap table is present but malformed.');};
 if(table.length<4)return fail();const view=new DataView(bytes.buffer,bytes.byteOffset+table.offset,table.length),count=view.getUint16(2);
 if(view.getUint16(0)!==0||count<1||count>(table.length-4)/8)return fail();
 for(let i=0;i<count;i++){
  const offset=view.getUint32(4+i*8+4);if(offset<4+count*8||offset>table.length-4)return fail();
  const format=view.getUint16(offset),long=[8,10,12,13].includes(format),minimum=({0:262,2:518,4:16,6:10,8:8208,10:20,12:16,13:16,14:10} as Record<number,number>)[format];
  if(minimum===undefined||offset>table.length-minimum)return fail();
  const length=format===14?view.getUint32(offset+2):long?view.getUint32(offset+4):view.getUint16(offset+2);
  if(length<minimum||length>table.length-offset)return fail();
 }
}
/** Original physical proof does not require unused post underline properties. */
export function parseOriginalSourceProgram(bytes:Uint8Array):Font {
 const font=parseBoundedProgram(bytes,'truetype',true),getGlyph=font.getGlyph.bind(font);
 // fontkit 1.1 reads a glyph header for advanceWidth even when loca proves
 // no glyph bytes exist. Read that blank's hmtx advance directly; no padding,
 // replacement outline, font-byte mutation, or malformed-offset fallback.
 font.getGlyph=(id:number)=>{const glyph=getGlyph(id),advance=originalEmptyGlyphAdvance(bytes,id,font.numGlyphs);if(advance!==undefined)Object.defineProperty(glyph,'advanceWidth',{value:advance,configurable:true});return glyph;};return font;
}
export function originalEmptyGlyphAdvance(bytes:Uint8Array,id:number,numGlyphs:number):number|undefined {
 const fail=():never=>{throw new FolioError('SOURCE_FONT_INVALID','Original empty glyph tables are malformed.');};
 if(!Number.isInteger(id)||id<0||id>=numGlyphs)return fail();const loca=sourceTable(bytes,'loca'),glyf=sourceTable(bytes,'glyf'),head=sourceTable(bytes,'head'),hhea=sourceTable(bytes,'hhea'),hmtx=sourceTable(bytes,'hmtx');if(!loca||!glyf||!head||head.length<54||!hhea||hhea.length<36||!hmtx)return fail();const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),format=v.getInt16(head.offset+50);if(format!==0&&format!==1)return fail();const step=format===0?2:4;if(loca.length<(numGlyphs+1)*step)return fail();const offset=(n:number)=>format===0?v.getUint16(loca.offset+n*2)*2:v.getUint32(loca.offset+n*4),start=offset(id),end=offset(id+1);if(end<start||end>glyf.length)return fail();if(start!==end)return;const metrics=v.getUint16(hhea.offset+34);if(metrics<1||metrics>numGlyphs||hmtx.length<metrics*4+(numGlyphs-metrics)*2)return fail();return v.getUint16(hmtx.offset+Math.min(id,metrics-1)*4);
}
export function parseSourceProgram(bytes: Uint8Array, format:'truetype'|'opentype-cff'='truetype'): Font {return parseBoundedProgram(bytes,format,false);}
function parseBoundedProgram(bytes:Uint8Array,format:'truetype'|'opentype-cff',original:boolean):Font {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 4 * 1024 * 1024 ||
      bytes.length < 12 || new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) !== (format==='truetype'?0x00010000:0x4f54544f)) {
    throw new FolioError('SOURCE_FONT_INVALID', 'The source font is not a bounded TrueType program.');
  }
  const tableView=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=tableView.getUint16(4),tables=new Map<string,{offset:number;length:number}>(),ranges:{start:number;end:number}[]=[];let aggregate=0;
  if(count<1||count>128||12+count*16>bytes.length)throw new FolioError('SOURCE_FONT_INVALID','The source font table directory is invalid.');
  for(let i=0;i<count;i++){const start=12+i*16,tag=String.fromCharCode(...bytes.slice(start,start+4)),offset=tableView.getUint32(start+8),length=tableView.getUint32(start+12);if(tables.has(tag)||offset>bytes.length||length>bytes.length-offset||length>0&&offset<12+count*16||length>0&&ranges.some(range=>offset<range.end&&offset+length>range.start)||(aggregate+=Math.ceil(length/4)*4)>4*1024*1024)throw new FolioError('SOURCE_FONT_INVALID','The source font table inventory is invalid.');tables.set(tag,{offset,length});if(length)ranges.push({start:offset,end:offset+length});}
  const os2=tables.get('OS/2');
  if(!os2||os2.length<64||(format==='truetype'? !tables.has('glyf')||!tables.has('loca'): !tables.has('CFF ')||tables.has('CFF2'))||(tableView.getUint16(os2.offset+8)&0x0202)!==0)throw new FolioError('SOURCE_FONT_INVALID','The source TrueType font lacks valid outlines or permits only restricted embedding.');
  const post=tables.get('post'),cmap=tables.get('cmap');
  if(original&&cmap)validateOriginalCmapBounds(bytes,cmap);
  if(original&&post&&post.length<32)throw new FolioError('SOURCE_FONT_INVALID','The original post table is present but malformed.');
  if(original&&(['head','hhea','hmtx','maxp'] as const).some(tag=>!tables.has(tag)||tables.get(tag)!.length<({head:54,hhea:36,hmtx:4,maxp:6})[tag]))throw new FolioError('SOURCE_FONT_INVALID','The original physical font metrics are incomplete.');
  let font: Font;
  try { font = fontkit.create(bytes); } catch { throw new FolioError('SOURCE_FONT_INVALID', 'The source font program could not be decoded.'); }
  const internal = font as Font & { 'OS/2'?: { usWeightClass?: number; fsType?: number; fsSelection?: { italic?: boolean } }; head?: { macStyle?: { italic?: boolean } } };
  if (!Number.isInteger(font.unitsPerEm) || font.unitsPerEm < 16 || font.unitsPerEm > 16384 ||
      ![font.ascent,font.descent,...(original&&!post?[]:[font.underlinePosition,font.underlineThickness])].every(Number.isFinite) ||
      !Number.isInteger(font.numGlyphs) || font.numGlyphs < 1 || font.numGlyphs > 65535 || !internal['OS/2']) {
    throw new FolioError('SOURCE_FONT_INVALID', 'The source font has invalid metrics or restricted embedding.');
  }
  if(original&&!post)originalWithoutPost.add(font);
  if(original&&!cmap)originalWithoutCmap.add(font);
  if(original&&post&&!Number.isFinite(font.italicAngle))throw new FolioError('SOURCE_FONT_INVALID','The original post angle is invalid.');
  if(format==='opentype-cff')validateSourceCffDeclarations(font);
  return font;
}
/** Restrictive source CFF declaration gate; resource text matrices are checked separately. */
export function validateSourceCffDeclarations(font:Font):void {
 const cff=(font as unknown as {'CFF '?:{version:number;isCIDFont:boolean;topDict:{ROS:unknown;FDSelect:unknown;CharStrings:{length:number};charset:{glyphs:unknown[]};FontMatrix:number[];PaintType:number;CharstringType:number;SyntheticBase:unknown;PostScript:unknown}}})['CFF '],d=cff?.topDict;
 if(font.unitsPerEm!==1000||!cff||!d||cff.version!==1||cff.isCIDFont||d.ROS!=null||d.FDSelect!=null||d.CharStrings?.length!==font.numGlyphs||d.charset?.glyphs?.length!==font.numGlyphs-1||!Array.isArray(d.FontMatrix)||d.FontMatrix.length!==6||d.FontMatrix.some((value,i)=>!Number.isFinite(value)||value!==[.001,0,0,.001,0,0][i])||d.PaintType!==0||d.CharstringType!==2||d.SyntheticBase!=null||d.PostScript!=null)throw new FolioError('SOURCE_FONT_CFF','Only bounded name-keyed CFF1, identity source matrix and fill-only resolved Type2 charstrings are supported.');
}
export function sourceProgramNumericalStyle(font: Font): { fontWeight: number; italic: boolean } {
  const internal = font as Font & { 'OS/2': { usWeightClass: number; fsSelection?: { italic?: boolean } }; head?: { macStyle?: { italic?: boolean } } };
  const weight = internal['OS/2'].usWeightClass;
  if (!Number.isInteger(weight) || weight!<1 || weight!>1000) throw new FolioError('SOURCE_FONT_STYLE', 'This source font has an unproved style declaration.');
  return { fontWeight: weight!, italic: !!(internal['OS/2'].fsSelection?.italic || internal.head?.macStyle?.italic || (!originalWithoutPost.has(font)&&font.italicAngle)) };
}
export function sourceProgramStyle(font:Font):{fontWeight:400|700;italic:boolean}{const style=sourceProgramNumericalStyle(font);if(style.fontWeight!==400&&style.fontWeight!==700)throw new FolioError('SOURCE_FONT_STYLE','This source font has an unproved style declaration.');return {fontWeight:style.fontWeight,italic:style.italic};}
export function sourceCffDeclaredStyle(font:Font):SourceFontAssetV2['declaredStyle'] {
  const os2=(font as unknown as {'OS/2'?:{usWeightClass?:number}})['OS/2'],weight=os2?.usWeightClass;
  return {weightClass:Number.isInteger(weight)&&weight!>=1&&weight!<=1000?weight!:null,italic:Number.isFinite(font.italicAngle)?font.italicAngle!==0:null,semanticBold:'unknown'};
}
/** Binary CSS registration tokens are separate from original semantic style declarations. V7 has no known weight. */
export function sourceEditorStyle(asset:Exclude<SourceFontAsset,{sourceVersion:10}>):{fontWeight:400|700;italic:boolean};
export function sourceEditorStyle(asset:SourceFontAsset):{fontWeight:number;italic:boolean};
export function sourceEditorStyle(asset:SourceFontAsset):{fontWeight:number;italic:boolean} {
  return asset.sourceVersion===7?{fontWeight:400,italic:false}:asset.format==='truetype'?{fontWeight:asset.fontWeight,italic:asset.italic}:{fontWeight:400,italic:asset.declaredStyle.italic??false};
}
export function validateSourceFontAsset(asset: SourceFontAsset): Font {
  if (sha256Sync(asset.bytes) !== asset.sha256) throw new FolioError('SOURCE_FONT_CHECKSUM', 'The source font checksum does not match its program.');
  const font=parseSourceProgram(asset.bytes,asset.format);
  let original:Font|undefined;const originalCffOutline=asset.sourceVersion===9?originalCffOutlineReader(asset.originalProgram.bytes,asset.bytes):undefined;const cffOriginal=asset.sourceVersion===9?validateCffResourceSpec(asset.originalCff,asset.originalProgram.bytes,asset.sourceSha256):undefined;
 if(asset.sourceVersion===9&&(asset.capability!=='original-cff-glyphs-v1'||sha256Sync(asset.originalProgram.bytes)!==asset.originalProgram.sha256||asset.declaredStyle.weightClass!==null||asset.declaredStyle.italic!==null||asset.declaredStyle.semanticBold!=='unknown'))throw new FolioError('SOURCE_CFF_RESOURCE','Original CFF programme or absent style changed.');
  if(asset.format==='truetype') {
    if(asset.sourceVersion!==8&&asset.sourceVersion!==7&&asset.sourceVersion!==10&&asset.sourceVersion!==11&&('capability'in asset||'licensedDerivation'in asset))throw new FolioError('SOURCE_LICENSED_SUBSET','Licensed derivation used outside its class.');
    if(((asset.sourceVersion===4||asset.sourceVersion===5||asset.sourceVersion===6||asset.sourceVersion===7||asset.sourceVersion===8||asset.sourceVersion===10||asset.sourceVersion===11))!==!!asset.originalProgram)throw new FolioError('SOURCE_FONT_ORIGINAL','A new TrueType face requires its original resource program proof.');
    if((asset.sourceVersion===4||asset.sourceVersion===5||asset.sourceVersion===6||asset.sourceVersion===7||asset.sourceVersion===8||asset.sourceVersion===10||asset.sourceVersion===11)){const proof=asset.originalProgram!;
      if(!/^[1-9]\d{0,9} \d{1,5} R$/.test(proof.pdfFontRef)||sha256Sync(proof.bytes)!==proof.sha256)throw new FolioError('SOURCE_FONT_ORIGINAL','The original TrueType resource or program checksum is invalid.');
      if(asset.sourceVersion===8){if(asset.capability!=='licensed-catalogue-subset-v1'||!asset.licensedDerivation)throw new FolioError('SOURCE_LICENSED_SUBSET','Missing licensed derivation.');original=validateLicensedDerivation(proof.bytes,asset.licensedDerivation);if(original.unitsPerEm!==font.unitsPerEm||asset.licensedDerivation.catalogueFace!==`${asset.licensedDerivation.catalogueFace.split('-')[0]}-${asset.fontWeight}-${asset.italic?'italic':'normal'}`)throw new FolioError('SOURCE_LICENSED_SUBSET','The licensed face style differs.');}
      else if(asset.sourceVersion===7){const parsed=parseDocumentScopedProgram(proof.bytes,asset.declaredStyle.descriptor,asset.originalProgram.selectorContract);original=parsed.font;if(asset.capability!=='document-scoped-source-v1'||asset.originalPermission!=='absent'||asset.registrationFaceToken!=='neutral-400-normal-v1'||canonicalJson(parsed.properties)!==canonicalJson(asset.declaredStyle)||original.unitsPerEm!==font.unitsPerEm)throw new FolioError('SOURCE_DOCUMENT_FONT','Document-scoped original property evidence changed.');}
      else {const permissions=originalTrueTypePermissions(proof.bytes),convertedOs2=sourceTable(asset.bytes,'OS/2')!;
      if(new DataView(asset.bytes.buffer,asset.bytes.byteOffset,asset.bytes.byteLength).getUint16(convertedOs2.offset+8)!==permissions)throw new FolioError('SOURCE_FONT_PERMISSIONS','Converted source embedding permissions differ from the original program.');
      original=parseOriginalSourceProgram(proof.bytes);
      if(original.unitsPerEm!==font.unitsPerEm||canonicalJson(asset.sourceVersion===10?sourceProgramNumericalStyle(original):sourceProgramStyle(original))!==canonicalJson(asset.sourceVersion===10?sourceProgramNumericalStyle(font):sourceProgramStyle(font)))throw new FolioError('SOURCE_FONT_ORIGINAL','Original and converted source metrics or styles disagree.');}
    }
  }
  if(font.unitsPerEm!==asset.unitsPerEm)throw new FolioError('SOURCE_FONT_INVALID','Source font units do not match its program.');
  if(asset.format==='truetype'&&asset.sourceVersion!==7&&asset.sourceVersion!==8) {const style=asset.sourceVersion===10?sourceProgramNumericalStyle(font):sourceProgramStyle(font);if(asset.sourceVersion===10&&(asset.capability!=='original-tt-numeric-style-v1'||asset.originalProgram.selectorContract!=='identity-h-v1'))throw new FolioError('SOURCE_FONT_STYLE','Numeric style needs its original Identity-H owner.');if(style.fontWeight!==asset.fontWeight||style.italic!==asset.italic)throw new FolioError('SOURCE_FONT_INVALID','Source TrueType declarations do not match the program.');}
  else if(asset.format==='opentype-cff'&&asset.sourceVersion!==9&&(canonicalJson(sourceCffDeclaredStyle(font))!==canonicalJson(asset.declaredStyle)||asset.sourceVersion!==2))throw new FolioError('SOURCE_FONT_INVALID','Source CFF declarations do not match the program.');
  if(asset.format==='opentype-cff'&&asset.shapeMap){const seen=new Set<string>();if(asset.shapeMap.length>100000)throw new FolioError('SOURCE_FONT_MAP','Source shape inventory exceeds its bound.');for(const entry of asset.shapeMap){if(!Number.isInteger(entry.glyphId)||entry.glyphId<=0||entry.glyphId>=font.numGlyphs||!Number.isInteger(entry.fontChar)||entry.fontChar<0||entry.fontChar>0x10ffff)throw new FolioError('SOURCE_FONT_MAP','Source shape selectors are invalid.');const key=`${entry.glyphId}:${entry.fontChar}`,glyph=font.getGlyph(entry.glyphId);if(seen.has(key)||font.glyphForCodePoint(entry.fontChar).id!==entry.glyphId||!glyph.path.toSVG()||glyph.path.toSVG().length>1024*1024||![glyph.bbox.minX,glyph.bbox.minY,glyph.bbox.maxX,glyph.bbox.maxY].every(Number.isFinite))throw new FolioError('SOURCE_FONT_MAP','The source shape outline inventory is invalid.');seen.add(key);}}
  if(asset.sourceVersion===11&&(asset.capability!=='original-tt-null-ligature-v1'||asset.originalProgram.selectorContract!=='identity-h-v1'))throw new FolioError('SOURCE_FONT_ORIGINAL','Null ligature needs its exact original source class.');
  if(asset.sourceVersion===7&&asset.groupedDescriptor){const d=asset.groupedDescriptor;if(d.Flags!==asset.declaredStyle.descriptor.flags||d.ItalicAngle!==asset.declaredStyle.descriptor.italicAngle||Object.entries(d).some(([k,v])=>!['Flags','ItalicAngle','Ascent','Descent','CapHeight','XHeight','StemV','StemH','AvgWidth','MaxWidth','MissingWidth','Leading','FontWeight','FontBBox'].includes(k)||(Array.isArray(v)?k!=='FontBBox'||v.length!==4||v.some(n=>!Number.isFinite(n)||Math.abs(n)>1000000):k==='FontBBox'||!Number.isFinite(v)||Math.abs(v as number)>1000000)))throw new FolioError('SOURCE_DOCUMENT_FONT','Grouped document descriptor evidence changed.');}
  const v6=asset.format==='truetype'&&(asset.sourceVersion===6||asset.sourceVersion===7||asset.sourceVersion===8||asset.sourceVersion===10||asset.sourceVersion===11);
  if(asset.sourceVersion===7){const ink=asset.declaredStyle.post===null&&asset.glyphMap.some(map=>!map.nonPainting);if(ink&&!asset.namelessDescriptor||asset.namelessDescriptor&&(asset.originalProgram.selectorContract!=='symbolic-raw-byte-1-0-format6-v1'||asset.declaredStyle.post!==null||Object.entries(asset.namelessDescriptor).some(([k,v])=>!['Flags','ItalicAngle','Ascent','Descent','CapHeight','XHeight','StemV','StemH','AvgWidth','MaxWidth','MissingWidth','Leading','FontWeight','FontBBox'].includes(k)||(Array.isArray(v)?v.length!==4||v.some(n=>!Number.isFinite(n)||Math.abs(n)>1000000):!Number.isFinite(v)||Math.abs(v as number)>1000000))||asset.namelessDescriptor.Flags!==asset.declaredStyle.descriptor.flags||asset.namelessDescriptor.ItalicAngle!==asset.declaredStyle.descriptor.italicAngle))throw new FolioError('SOURCE_DOCUMENT_FONT','Nameless glyphs require exact original selector, outline, advance and descriptor evidence.');}
  if(asset.format==='truetype'&&(v6?!(asset.sourceVersion===7?['macroman-1-0-format6-v1','symbolic-raw-byte-1-0-format6-v1']:asset.sourceVersion===8||asset.sourceVersion===10||asset.sourceVersion===11?['identity-h-v1']:['identity-h-v1','winansi-3-1-v1']).includes(asset.originalProgram?.selectorContract??''):asset.originalProgram?.selectorContract!==undefined))throw new FolioError('SOURCE_FONT_ORIGINAL','The physical selector contract is absent or used outside V6.');
  const macRoman=asset.sourceVersion===7?(asset.originalProgram.selectorContract==='symbolic-raw-byte-1-0-format6-v1'?originalSymbolicByteSelectors(asset.originalProgram.bytes,asset.declaredStyle.descriptor.flags,original!.numGlyphs):originalMacRomanSelectors(asset.originalProgram.bytes,asset.declaredStyle.descriptor.flags,original!.numGlyphs)):undefined;
  const winAnsi=v6&&asset.originalProgram?.selectorContract==='winansi-3-1-v1'?originalWinAnsiSelectors(asset.originalProgram.bytes,32,original!.numGlyphs):undefined;
  const cids = new Set<number>(), selectorWidths=new Map<number,number>();
  if(asset.format==='truetype'&&asset.sourceVersion===5&&!asset.glyphMap.some(m=>m.selectorProvenance))throw new FolioError('SOURCE_FONT_BLANK','V5 requires an explicit source-owned positive blank selector.');
  if(asset.sourceVersion===10&&(!!asset.semanticBlankPolicy!==asset.glyphMap.some(m=>m.unicode==='\u00a0'&&m.nonPainting)||asset.semanticBlankPolicy&&asset.semanticBlankPolicy!=='original-space-and-nbsp-v1'))throw new FolioError('SOURCE_FONT_BLANK','A semantic blank policy must be rederived from actual NBSP occurrences.');
  for (const map of asset.glyphMap) {
    const semanticNbsp=asset.sourceVersion===10&&asset.semanticBlankPolicy==='original-space-and-nbsp-v1'&&map.unicode==='\u00a0'&&map.nonPainting&&map.pdfWidth>0&&map.nativeWidth!>0;
    if((asset.sourceVersion===7||asset.sourceVersion===8||asset.sourceVersion===10||asset.sourceVersion===11)&&map.unicode===' '&&!map.nonPainting)throw new FolioError('SOURCE_FONT_BLANK','Document-scoped space must have proved nonpainting original ink.');
    if(original){
      const physical=macRoman?macRoman.get(map.originalCharCode!)?.glyphId:v6&&winAnsi?winAnsi.get(map.originalCharCode!)?.glyphId:map.originalCharCode;
      if(!Number.isInteger(map.originalGlyphId)||!map.originalGlyphId||map.originalGlyphId>=original.numGlyphs||physical!==map.originalGlyphId)throw new FolioError('SOURCE_FONT_ORIGINAL','A source glyph lacks its positive original physical selector.');
      const glyph=original.getGlyph(map.originalGlyphId),converted=font.getGlyph(map.glyphId),nativeWidth=v6?map.nativeWidth:map.pdfWidth;
      if(!Number.isFinite(nativeWidth)||nativeWidth!<0||nativeWidth!>10000||!exactTrueTypeFillOutline(glyph.path,converted.path)||Math.abs(glyph.advanceWidth*1000/original.unitsPerEm-nativeWidth!)>0.00001||Math.abs(converted.advanceWidth*1000/font.unitsPerEm-nativeWidth!)>0.00001||!v6&&!map.selectorProvenance&&original.glyphForCodePoint(map.unicode.codePointAt(0)!).id!==map.originalGlyphId)throw new FolioError('SOURCE_FONT_ORIGINAL','Original physical outline or immutable native advance proof disagrees with the converted mapping.');
    } else if(!cffOriginal&&(map.originalGlyphId!==undefined||map.originalCharCode!==undefined))throw new FolioError('SOURCE_FONT_ORIGINAL','An original glyph selector has no original program owner.');
    if (cids.has(map.cid) || map.cid < 1 || map.cid > 65535 || !Number.isInteger(map.cid) ||
        !Number.isInteger(map.glyphId) || (asset.format==='truetype'?map.glyphId<=0:map.glyphId<0) || map.glyphId >= font.numGlyphs ||
        !Number.isFinite(map.pdfWidth) || map.pdfWidth < 0 || map.pdfWidth > 10000 ||
        !Number.isInteger(map.fontChar) || map.fontChar < 0 || map.fontChar > 0x10ffff ||
        !map.unicode || (asset.format==='truetype'?(asset.sourceVersion===11?!['ff','fi','fl','ffi','ffl','st'].includes(map.unicode)&&Array.from(map.unicode).length!==1:Array.from(map.unicode).length!==1):Array.from(map.unicode).length>16) || /[\p{Control}\p{Format}\p{Surrogate}]/u.test(map.unicode)) {
      throw new FolioError('SOURCE_FONT_MAP', 'The source font glyph inventory is invalid.');
    }
    if(!v6&&asset.sourceVersion!==9&&map.nativeWidth!==undefined)throw new FolioError('SOURCE_FONT_MAP','Native advance separation requires V6.');
    if(map.selectorProvenance){
      if(asset.format!=='truetype'||(v6?map.selectorProvenance!=='original-positive-blank-v2':asset.sourceVersion!==5||map.selectorProvenance!=='original-identity-positive-blank-v1')||!original||map.unicode!==' '&&!semanticNbsp||!map.nonPainting||map.pdfWidth<=0||v6&&!(map.nativeWidth!>0)||map.originalGlyphId!==map.glyphId||font.glyphForCodePoint(map.fontChar).id!==0||font.getGlyph(map.glyphId).path.toSVG()||original.getGlyph(map.originalGlyphId).path.toSVG()||sourceGlyphHasEncoding(font,map.glyphId))throw new FolioError('SOURCE_FONT_BLANK','The unencoded blank lacks exact positive original Identity selector ownership.');
    }
    cids.add(map.cid);
    if(asset.sourceVersion===9){const proof=proveOriginalCffOccurrence(cffOriginal!,map.originalCharCode!);if(originalCffOutline!.getGlyph(proof.originalGID).path.toSVG()!==font.getGlyph(map.glyphId).path.toSVG()||proof.originalGID!==map.originalGlyphId||proof.unicode!==map.unicode||proof.pdfWidth!==map.pdfWidth||proof.nativeWidth!==map.nativeWidth||Math.abs(font.getGlyph(map.glyphId).advanceWidth*1000/font.unitsPerEm-proof.nativeWidth)>.00001)throw new FolioError('SOURCE_CFF_RESOURCE','The original and derivative CFF glyph metrics differ.');}
    if(asset.format==='opentype-cff') {
      const v2=map as SourceFontAssetV2['glyphMap'][number],width=selectorWidths.get(map.glyphId);
      if(asset.sourceVersion!==9&&width!==undefined&&Math.abs(width-map.pdfWidth)>.000001)throw new FolioError('SOURCE_FONT_WIDTH_ALIAS','Aliases of one CFF selector have conflicting source widths.');
      selectorWidths.set(map.glyphId,map.pdfWidth);
      if(!['coveredScalar','baselineOnly'].includes(v2.editPolicy)||!['sourceGlyph','sourceEncodingWidths','baselineGap'].includes(v2.widthProvenance)||v2.editPolicy==='coveredScalar'&&Array.from(map.unicode).length!==1||asset.sourceVersion!==9&&v2.nonPainting&&v2.editPolicy==='coveredScalar'&&v2.widthProvenance!=='sourceEncodingWidths')throw new FolioError('SOURCE_FONT_MAP','The CFF edit mapping is unproved.');
    }
    const glyph = font.getGlyph(map.glyphId), box = glyph.bbox;
    if(!Number.isFinite(glyph.advanceWidth)||!map.nonPainting&&![box.minX,box.minY,box.maxX,box.maxY].every(Number.isFinite)||glyph.path.toSVG().length>1024*1024)throw new FolioError('SOURCE_FONT_MAP','The source glyph outline is nonfinite or exceeds its local bound.');
    const empty = !(box.width > 0 && box.height > 0) && !glyph.path.toSVG().length;
    if (map.nonPainting ? map.unicode !== ' '&&!semanticNbsp || !empty : empty || font.glyphForCodePoint(map.fontChar).id !== map.glyphId) throw new FolioError('SOURCE_FONT_MAP', 'The source font glyph map lacks outline or blank-space proof.');
  }
  return font;
}
/** New absent-cmap originals have physical PDF proof, not a new native grant. */
export function sourceOriginalCmapAvailable(asset:SourceFontAsset):boolean {
 if(asset.format!=='truetype'||asset.sourceVersion!==4&&asset.sourceVersion!==5&&asset.sourceVersion!==6&&asset.sourceVersion!==11&&asset.sourceVersion!==10)return true;
 const bytes=asset.originalProgram?.bytes;if(!bytes||bytes.length<12)return false;
 const count=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint16(4);if(count<1||count>128||12+16*count>bytes.length)return false;
 const cmap=sourceTable(bytes,'cmap');return !!cmap&&cmap.length>=4&&cmap.offset<=bytes.length&&cmap.length<=bytes.length-cmap.offset;
}
/** Absence remains absence; a converter's synthetic post cannot authorize underline/native properties. */
export function sourceOriginalPostAvailable(asset:SourceFontAsset):boolean {
 if(asset.sourceVersion===9)return false;
 if(asset.format!=='truetype'||asset.sourceVersion!==4&&asset.sourceVersion!==5&&asset.sourceVersion!==6&&asset.sourceVersion!==11&&asset.sourceVersion!==7&&asset.sourceVersion!==10)return true;
 const bytes=asset.originalProgram?.bytes;if(!bytes||bytes.length<12)return false;
 const count=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint16(4);
 if(count<1||count>128||12+16*count>bytes.length)return false;
 const post=sourceTable(bytes,'post');return !!post&&post.length>=32&&post.offset<=bytes.length&&post.length<=bytes.length-post.offset;
}
export class SourceFontFaceMetrics extends FontFaceMetrics {
  private requireOriginalUnderline():void {if(!sourceOriginalPostAvailable(this.asset))throw new FolioError('SOURCE_FONT_UNDERLINE','The original font has no proved underline metrics.');}

  override underlineOffset(size:number):number {this.requireOriginalUnderline();return this.asset.sourceVersion===7?-this.asset.declaredStyle.post!.underlinePosition*size/this.asset.unitsPerEm:super.underlineOffset(size);}
  override underlineThickness(size:number):number {this.requireOriginalUnderline();return this.asset.sourceVersion===7?this.asset.declaredStyle.post!.underlineThickness*size/this.asset.unitsPerEm:super.underlineThickness(size);}
  get editorStyle(){return sourceEditorStyle(this.asset);}
  constructor(public readonly asset: SourceFontAsset, font: Font) { super(sourceFontKey(asset.id), asset.bytes, font); }
  mapping(character: string): SourceGlyphMapping | undefined {
    const maps = this.asset.glyphMap.filter(map => map.unicode === character && (this.asset.format==='truetype'||(map as SourceFontAssetV2['glyphMap'][number]).editPolicy==='coveredScalar'));
    // Original CID aliases remain valid; edit characters require one proven outline/advance.
    const signatures = new Set(maps.map(map => `${map.glyphId}:${map.pdfWidth}:${map.nonPainting}`));
    return signatures.size === 1 ? maps[0] : undefined;
  }
  override unsupportedCharacters(text: string): string[] { return [...new Set(Array.from(text).filter(char => !this.mapping(char)))]; }
  override measure(text: string, size: number) {
    let width = 0, left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const char of Array.from(text)) {
      const map = this.mapping(char); if (!map) continue;
      const box = this.font.getGlyph(map.glyphId).bbox, scale = size / this.font.unitsPerEm;
      if (!map.nonPainting) { left = Math.min(left, width + box.minX * scale); right = Math.max(right, width + box.maxX * scale); top = Math.min(top, -box.maxY * scale); bottom = Math.max(bottom, -box.minY * scale); }
      width += map.pdfWidth * size / 1000;
    }
    return { width, left: Number.isFinite(left) ? left : 0, right: Number.isFinite(right) ? right : width, top: Number.isFinite(top) ? top : 0, bottom: Number.isFinite(bottom) ? bottom : 0 };
  }
}
export function loadSourceFont(asset: SourceFontAsset): SourceFontFaceMetrics {
  const previous = cache.get(asset.id),fingerprint=hashTextSync(canonicalJson({...asset,bytes:undefined,...('originalProgram'in asset&&asset.originalProgram?{originalProgram:{...asset.originalProgram,bytes:undefined}}:{})}));
  const originalBytes='originalProgram'in asset?asset.originalProgram?.bytes:undefined;
  // These private copies were SHA-validated with the complete original proof.
  // Equality checks every current byte, including in-place mutations, without
  // repeating SHA rounds for every glyph/region in the synchronous canvas.
  if(previous?.asset===asset&&previous.fingerprint===fingerprint&&exactBytes(asset.bytes,previous.bytes)&&((!originalBytes&&!previous.originalBytes)||!!originalBytes&&!!previous.originalBytes&&exactBytes(originalBytes,previous.originalBytes)))return previous.face;
  const face = new SourceFontFaceMetrics(asset, validateSourceFontAsset(asset));
  cache.delete(asset.id);
  const snapshotSize=asset.bytes.length+(originalBytes?.length??0);
  let retainedSize=[...cache.values()].reduce((sum,entry)=>sum+entry.bytes.length+(entry.originalBytes?.length??0),0);
  while(cache.size>=64||retainedSize+snapshotSize>MAX_SNAPSHOT_BYTES){const oldest=cache.keys().next().value;if(oldest===undefined)break;const entry=cache.get(oldest)!;retainedSize-=entry.bytes.length+(entry.originalBytes?.length??0);cache.delete(oldest);}
  cache.set(asset.id, { asset, fingerprint, face,bytes:new Uint8Array(asset.bytes),...(originalBytes?{originalBytes:new Uint8Array(originalBytes)}:{}) });
  return face;
}
export function sourceGlyphPath(face: SourceFontFaceMetrics, glyphId: number): string { return face.font.getGlyph(glyphId).path.toSVG(); }
