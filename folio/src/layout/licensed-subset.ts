import fontkit from '@pdf-lib/fontkit';
import type {Font} from '@pdf-lib/fontkit';
import {FolioError} from '../core/errors';
import {sha256Sync,type LicensedSubsetDerivation} from '../core/model';
export const LICENSED_FONT_PINS:Record<string,string>={
 "sans-400-normal": "7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954",
 "sans-400-italic": "4af75fa16ee6d3ad43e1ecec41862c24954af26a55c6bb1ebb27bd486a50f5f4",
 "sans-700-normal": "e6476c1b80502924294eed40894c5b18e06c181444ca953e5334262df9c27724",
 "sans-700-italic": "eb436dca0c2594b73d8b603b892e374fdfd8d885d25ffb4f18df4c4c0b49e50f",
 "serif-400-normal": "42d1edeb7952f31b1f96d767ed7030b08a39e0c372b0071641518864e2bffb51",
 "serif-400-italic": "2e39b1d50f90b933b00c7bb54a96afd3f86419b3d717c7cf202e36f2d4973e47",
 "serif-700-normal": "c47b5527bcdc8dcf9ea8c77054454c5a884beaca2f44851a2a823ee639cbf07f",
 "serif-700-italic": "8d3dd3d31350309042ed226af82b34539bd773518e6107cb352712853ba80308",
 "mono-400-normal": "b4a6c3e4faab8773f4ff761d56451646409f29abedd68f05d38c2df667d3c582",
 "mono-400-italic": "742097840c541870e8d6dc5c9b37bb1ceeea6c0dedd1d475faf903ef9df734b0",
 "mono-700-normal": "bce60f1b4421acd9ea51ba6623d7024ecbe6817a953e3654df62a5e6bdf8f769",
 "mono-700-italic": "91713a71d550bba22c2a6b2bb2a9ad8f9a159e12e4e9f0a5b2677998ba21213e"
};

export const LICENSED_FONT_LICENSE_SHA='7a083b136e64d064794c3419751e5c7dd10d2f64c108fe5ba161eae5e5958a93';
const fail=():never=>{throw new FolioError('SOURCE_LICENSED_SUBSET','The licensed subset physical programme or derivation evidence is invalid.');};
/** Physical subset reader only. It never turns absent source OS/2 into permission. */
export function parseLicensedSubset(bytes:Uint8Array):{font:Font;originalPermission:'absent'|'present-permitted'}{
 if(!(bytes instanceof Uint8Array)||bytes.length<12||bytes.length>4*1024*1024)return fail();const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(![0x00010000,0x74727565].includes(view.getUint32(0)))return fail();const count=view.getUint16(4),tables=new Map<string,{offset:number;length:number}>(),ranges:{a:number;b:number}[]=[];if(!count||count>128||12+16*count>bytes.length)return fail();let aggregate=0;
 for(let i=0;i<count;i++){const at=12+i*16,tag=String.fromCharCode(...bytes.subarray(at,at+4)),offset=view.getUint32(at+8),length=view.getUint32(at+12);if(tables.has(tag)||offset>bytes.length||length>bytes.length-offset||length&&offset<12+count*16||length&&ranges.some(r=>offset<r.b&&offset+length>r.a)||(aggregate+=Math.ceil(length/4)*4)>4*1024*1024)return fail();tables.set(tag,{offset,length});if(length)ranges.push({a:offset,b:offset+length});}
 for(const [tag,min]of [['head',54],['hhea',36],['maxp',6],['hmtx',4],['loca',2],['glyf',0]]as const){const t=tables.get(tag);if(!t||t.length<min)return fail();}if(tables.has('CFF ')||tables.has('CFF2'))return fail();
 const os=tables.get('OS/2');if(os&&(os.length<64||view.getUint16(os.offset)>5||![0,8].includes(view.getUint16(os.offset+8))))return fail();
 let font:Font;try{font=fontkit.create(bytes);}catch{return fail();}if(!Number.isSafeInteger(font.unitsPerEm)||font.unitsPerEm<16||font.unitsPerEm>16384||!Number.isSafeInteger(font.numGlyphs)||font.numGlyphs<1||font.numGlyphs>65535||![font.ascent,font.descent].every(Number.isFinite))return fail();return{font,originalPermission:os?'present-permitted':'absent'};
}
export function validateLicensedDerivation(bytes:Uint8Array,proof:LicensedSubsetDerivation):Font{
 if(proof.version!=='licensed-catalogue-subset-v1'||proof.encoderVersion!=='fontkit-2.0.4'||proof.licenseSha256!==LICENSED_FONT_LICENSE_SHA||LICENSED_FONT_PINS[proof.catalogueFace]!==proof.fullProgramSha256||sha256Sync(bytes)!==proof.subsetProgramSha256)return fail();const parsed=parseLicensedSubset(bytes);if(parsed.originalPermission!==proof.originalPermission)return fail();return parsed.font;
}
