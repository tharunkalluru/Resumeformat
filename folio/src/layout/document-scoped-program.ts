import fontkit, {type Font} from '@pdf-lib/fontkit';
import {FolioError} from '../core/errors';
import {originalMacRomanSelectors} from '../import/pdf-macroman';
import {originalSymbolicByteSelectors,type DocumentScopedSelectorContract} from '../import/pdf-symbolic';

export interface DocumentScopedProperties {
  weightClass:null; semanticBold:'unknown';
  post:{italicAngle:number;underlinePosition:number;underlineThickness:number}|null;
  headMacStyle:number;
  descriptor:{flags:number;italicAngle:number};
}
const fail=():never=>{throw new FolioError('SOURCE_DOCUMENT_FONT','The original document font lacks bounded absent-permission physical and property evidence.');};
/** Physical evidence only. This never grants permission or invents OS/2 values. */
export function parseDocumentScopedProgram(bytes:Uint8Array,descriptor:{flags:number;italicAngle:number},contract:DocumentScopedSelectorContract='macroman-1-0-format6-v1'):{font:Font;properties:DocumentScopedProperties} {
 if(!(bytes instanceof Uint8Array)||bytes.length<12||bytes.length>4*1024*1024||!Number.isInteger(descriptor.flags)||!Number.isFinite(descriptor.italicAngle)||Math.abs(descriptor.italicAngle)>90)return fail();
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=view.getUint16(4);
 if(![0x00010000,0x74727565].includes(view.getUint32(0))||count<1||count>128||12+16*count>bytes.length)return fail();
 const tables=new Map<string,{offset:number;length:number}>(),ranges:{offset:number;length:number}[]=[];
 for(let i=0;i<count;i++){const at=12+16*i,tag=String.fromCharCode(...bytes.subarray(at,at+4)),offset=view.getUint32(at+8),length=view.getUint32(at+12);if(tables.has(tag)||offset%4||offset<12+16*count||offset>bytes.length||length>bytes.length-offset||ranges.some(r=>length&&r.length&&offset<r.offset+r.length&&r.offset<offset+length))return fail();tables.set(tag,{offset,length});ranges.push({offset,length});}
 const post=tables.get('post'),head=tables.get('head'),maxp=tables.get('maxp'),hhea=tables.get('hhea');
 if(tables.has('OS/2')||!tables.has('glyf')||!tables.has('loca')||!tables.has('hmtx')||post&&post.length<32||!head||head.length<54||!maxp||maxp.length<32||!hhea||hhea.length<36)return fail();
 // post v1/v2/v3 preserve common metrics; a decoder also validates its payload.
 if(post&&![0x10000,0x20000,0x30000].includes(view.getUint32(post.offset)))return fail();
 // Absence is physical evidence, never synthesized style or underline metrics.
 // Asset/occurrence admission permits only positive, nonpainting space owners.
 const properties:DocumentScopedProperties={weightClass:null,semanticBold:'unknown',post:post?{italicAngle:view.getInt32(post.offset+4)/65536,underlinePosition:view.getInt16(post.offset+8),underlineThickness:view.getInt16(post.offset+10)}:null,headMacStyle:view.getUint16(head.offset+44),descriptor:{...descriptor}};
 if(properties.post&&(Math.abs(properties.post.italicAngle)>90||properties.post.underlineThickness<=0))return fail();
 let font:Font;try{font=fontkit.create(bytes);}catch{return fail();}
 if(!Number.isInteger(font.unitsPerEm)||font.unitsPerEm<16||font.unitsPerEm>16384||!Number.isInteger(font.numGlyphs)||font.numGlyphs<1||font.numGlyphs>65535||![font.ascent,font.descent].every(Number.isFinite))return fail();
 if(contract==='symbolic-raw-byte-1-0-format6-v1')originalSymbolicByteSelectors(bytes,descriptor.flags,font.numGlyphs);else if(contract==='macroman-1-0-format6-v1')originalMacRomanSelectors(bytes,descriptor.flags,font.numGlyphs);else return fail();
 return {font,properties};
}
