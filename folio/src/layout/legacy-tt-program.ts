import {sha256Sync} from '../core/model';
import {parseSourceProgram,sourceProgramStyle} from './source-fonts';

const BASE_GLYPHS=2783;
// Licensed tests/fixtures/fonts/Carlito-Regular.ttf and the pinned PDF.js full
// program sanitizer. Native instructions/layout tables are included, while
// Unicode aliases and display names cannot establish physical ownership.
const TRUSTED=new Set<string>(['66f4affede5b0e2283316bd6ce98f80f12922a8f01e095bf74a8f6a55394af70','1165e5b59ce2a703c22397d547d38efbc78d4ad0c1476d33ffc2d05e3c3e35ac']);
const identities=new Map<string,boolean>();
export function legacyTrueTypeProgramFingerprint(bytes:Uint8Array):string|undefined {
 try{
  const font=parseSourceProgram(bytes),style=sourceProgramStyle(font),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(font.unitsPerEm!==2048||font.numGlyphs<BASE_GLYPHS||font.numGlyphs>BASE_GLYPHS+32||style.fontWeight!==400||style.italic)return;
  const tables=new Map<string,{offset:number;length:number}>();for(let i=0;i<v.getUint16(4);i++){const p=12+i*16;tables.set(String.fromCharCode(...bytes.subarray(p,p+4)),{offset:v.getUint32(p+8),length:v.getUint32(p+12)});}
  const head=tables.get('head')!,loca=tables.get('loca')!,glyf=tables.get('glyf')!,hmtx=tables.get('hmtx')!,hhea=tables.get('hhea')!;
  if(v.getInt16(head.offset+50)!==1||v.getUint16(hhea.offset+34)!==BASE_GLYPHS||loca.length<(font.numGlyphs+1)*4||hmtx.length<BASE_GLYPHS*4+(font.numGlyphs-BASE_GLYPHS)*2)return;
  const glyphOffset=(gid:number)=>v.getUint32(loca.offset+gid*4),end=glyphOffset(BASE_GLYPHS),zeroStart=glyphOffset(0),zeroEnd=glyphOffset(1);
  if(end>glyf.length||zeroEnd<zeroStart||zeroEnd>end)return;
  for(let gid=BASE_GLYPHS;gid<font.numGlyphs;gid++){
   const start=glyphOffset(gid),last=glyphOffset(gid+1);if(start>end+32*(zeroEnd-zeroStart)||last>glyf.length||last-start!==zeroEnd-zeroStart||bytes.subarray(glyf.offset+start,glyf.offset+last).some((b,i)=>b!==bytes[glyf.offset+zeroStart+i])||font.getGlyph(gid).advanceWidth!==font.getGlyph(BASE_GLYPHS-1).advanceWidth||v.getInt16(hmtx.offset+BASE_GLYPHS*4+(gid-BASE_GLYPHS)*2)!==v.getInt16(hmtx.offset+2))return;
  }
  const inventory=[...tables].filter(([tag])=>tag!=='cmap'&&tag!=='name').sort(([a],[b])=>a.localeCompare(b)).map(([tag,t])=>{
   let b=new Uint8Array(bytes.subarray(t.offset,t.offset+t.length));if(tag==='head')new DataView(b.buffer).setUint32(8,0);else if(tag==='maxp')new DataView(b.buffer).setUint16(4,BASE_GLYPHS);else if(tag==='glyf')b=b.subarray(0,end);else if(tag==='loca')b=b.subarray(0,(BASE_GLYPHS+1)*4);else if(tag==='hmtx')b=b.subarray(0,BASE_GLYPHS*4);
   return [tag,sha256Sync(b)];
  });return sha256Sync(new TextEncoder().encode(JSON.stringify(inventory)));
 }catch{return;}
}
/** Program bytes, not mutable family names, establish the narrow legacy route. */
export function isTrustedLegacyTrueTypeProgram(bytes:Uint8Array):boolean {
 const sha=sha256Sync(bytes),known=identities.get(sha);if(known!==undefined)return known;
 const fingerprint=legacyTrueTypeProgramFingerprint(bytes),trusted=!!fingerprint&&TRUSTED.has(fingerprint);if(identities.size>=128)identities.clear();identities.set(sha,trusted);return trusted;
}
