import fontkit from '@pdf-lib/fontkit';
import {Encodings,Font,FontNames} from '@pdf-lib/standard-fonts';
import {FontFaceMetrics,type FontKey,type TextMeasurement} from './fonts';
import type {SourceStandardFont} from '../core/model';
import {sha256Sync,canonicalJson} from '../core/model';
import {FolioError} from '../core/errors';
export const STANDARD_NAMES:readonly string[]=Object.values(FontNames).filter(n=>n!=='Symbol'&&n!=='ZapfDingbats');
export const standardStyle=(name:string)=>({fontWeight:(/Bold/.test(name)?700:400) as 400|700,italic:/Italic|Oblique/.test(name),fontFamily:(name.startsWith('Times')?'times':name.startsWith('Courier')?'mono':'sans') as 'times'|'mono'|'sans'});
export const standardFontKey=(id:string):FontKey=>`standard:${id}`;
export const standardFontIdentity=(asset:SourceStandardFont)=>sha256Sync(new TextEncoder().encode(canonicalJson({...asset,id:undefined,sourceResource:undefined,nativeAdapter:{...asset.nativeAdapter,bytes:undefined}})));
function fail(s:string):never{throw new FolioError('PDF_STANDARD_FONT',s);}
export function standardEncodingTable(name:string,widths?:SourceStandardFont['widths']):Omit<SourceStandardFont['glyphMap'][number],'nativeGlyphId'>[]{
 if(!STANDARD_NAMES.includes(name as FontNames))fail('The original standard font is outside the supported WinAnsi Times, Helvetica and Courier slice.');
 const metrics=Font.load(name as FontNames),table:Omit<SourceStandardFont['glyphMap'][number],'nativeGlyphId'>[]=[];
 for(const scalar of Encodings.WinAnsi.supportedCodePoints){const {code,name:glyphName}=Encodings.WinAnsi.encodeUnicodeCodePoint(scalar),base=metrics.getWidthOfGlyph(glyphName);if(!Number.isFinite(base)||base===undefined)continue;const pdfWidth=widths&&code>=widths.firstChar&&code<=widths.lastChar?widths.values[code-widths.firstChar]:base;if(!Number.isFinite(pdfWidth)||pdfWidth<0||pdfWidth>10000)fail('The original standard font width is not bounded and finite.');const unicode=String.fromCodePoint(scalar);if(/[\p{Control}\p{Format}\p{Mark}]/u.test(unicode))continue;table.push({code,unicode,glyphName,pdfWidth});}
 return table.sort((a,b)=>a.code-b.code);
}
/** Cmap/hmtx browser adapter only; all source PDF metrics and declarations stay separate. */
export function standardBrowserProgramme(bytes:Uint8Array,table:SourceStandardFont['glyphMap']):Uint8Array{
 if(bytes.length<12||bytes.length>4*1024*1024)fail('The local standard font adapter exceeds its programme budget.');
 const f=fontkit.create(bytes),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=v.getUint16(4);if(count<1||count>128||12+count*16>bytes.length)fail('The standard native programme table envelope is invalid.');
 const tables=new Map<number,Uint8Array>();for(let i=0;i<count;i++){const at=12+i*16,tag=v.getUint32(at),off=v.getUint32(at+8),len=v.getUint32(at+12);if(tables.has(tag)||off>bytes.length||len>bytes.length-off)fail('The native table is duplicated or out of bounds.');tables.set(tag,bytes.slice(off,off+len));}
 const hhea=tables.get(0x68686561),head=tables.get(0x68656164),old=tables.get(0x686d7478);if(!hhea||hhea.length<36||!head||head.length<54||!old)fail('The standard native horizontal programme is incomplete.');const hv=new DataView(hhea.buffer),n=hv.getUint16(34),ov=new DataView(old.buffer);if(n<1||n>f.numGlyphs||old.length<n*4+(f.numGlyphs-n)*2)fail('The standard native horizontal metrics are malformed.');
 const full=new Uint8Array(f.numGlyphs*4),fv=new DataView(full.buffer),assigned=new Map<number,number>();for(let gid=0;gid<f.numGlyphs;gid++){fv.setUint16(gid*4,ov.getUint16(Math.min(gid,n-1)*4));fv.setInt16(gid*4+2,ov.getInt16(gid<n?gid*4+2:n*4+(gid-n)*2));}
 const unicode=new Map<number,number>();for(const m of table){const gid=m.nativeGlyphId;if(!Number.isInteger(gid)||gid<1||gid>=f.numGlyphs)continue;const cp=m.unicode.codePointAt(0)!,width=Math.round(m.pdfWidth*f.unitsPerEm/1000);if(width<0||width>65535||assigned.has(gid)&&assigned.get(gid)!==width)fail('A standard browser glyph has ambiguous metrics.');assigned.set(gid,width);fv.setUint16(gid*4,width);if(unicode.has(cp)&&unicode.get(cp)!==gid)fail('The standard browser Unicode selector is ambiguous.');unicode.set(cp,gid);}
 const entries=[...unicode].sort(([a],[b])=>a-b),cmap=new Uint8Array(36+entries.length*12),cv=new DataView(cmap.buffer);cv.setUint16(2,2);cv.setUint16(6,4);cv.setUint32(8,20);cv.setUint16(12,3);cv.setUint16(14,10);cv.setUint32(16,20);cv.setUint16(20,12);cv.setUint32(24,cmap.length-20);cv.setUint32(32,entries.length);entries.forEach(([cp,gid],i)=>{cv.setUint32(36+i*12,cp);cv.setUint32(40+i*12,cp);cv.setUint32(44+i*12,gid);});hv.setUint16(34,f.numGlyphs);tables.set(0x686d7478,full);tables.set(0x636d6170,cmap);new DataView(head.buffer).setUint32(8,0);
 const sorted=[...tables].sort(([a],[b])=>a-b),size=12+count*16+sorted.reduce((s,[,b])=>s+Math.ceil(b.length/4)*4,0);if(size>4*1024*1024)fail('The derived standard browser programme exceeds its byte budget.');const result=new Uint8Array(size),rv=new DataView(result.buffer);result.set(bytes.subarray(0,12));let offset=12+count*16,headAt=0;const sum=(b:Uint8Array)=>{let s=0;for(let i=0;i<b.length;i+=4)s=(s+(((b[i]??0)*0x1000000+(b[i+1]??0)*0x10000+(b[i+2]??0)*0x100+(b[i+3]??0))>>>0))>>>0;return s;};sorted.forEach(([tag,b],i)=>{rv.setUint32(12+i*16,tag);rv.setUint32(16+i*16,sum(b));rv.setUint32(20+i*16,offset);rv.setUint32(24+i*16,b.length);result.set(b,offset);if(tag===0x68656164)headAt=offset;offset+=Math.ceil(b.length/4)*4;});rv.setUint32(headAt+8,(0xb1b0afba-sum(result))>>>0);const derived=fontkit.create(result);for(const m of table)if(m.nativeGlyphId>0){const glyph=derived.glyphForCodePoint(m.unicode.codePointAt(0)!);if(glyph.id!==m.nativeGlyphId||glyph.path.toSVG()!==f.getGlyph(m.nativeGlyphId).path.toSVG())fail('The standard native adapter changed its selected outline.');}return result;
}
export class StandardFontFaceMetrics extends FontFaceMetrics{
 constructor(readonly asset:SourceStandardFont){super(standardFontKey(asset.id),asset.nativeAdapter.bytes,fontkit.create(asset.nativeAdapter.bytes));}
 mapping(char:string){const rows=this.asset.glyphMap.filter(m=>m.unicode===char);return rows.length===1?rows[0]:undefined;}
 override unsupportedCharacters(text:string){return [...new Set(Array.from(text).filter(c=>!this.mapping(c)))];}
 override ascent(size:number){const afm=Font.load(this.asset.baseFont as FontNames);return (afm.Ascender??afm.FontBBox[3])*size/1000;}
 override descent(size:number){const afm=Font.load(this.asset.baseFont as FontNames);return -(afm.Descender??afm.FontBBox[1])*size/1000;}
 override measure(text:string,size:number):TextMeasurement{let x=0,left=0,right=0,top=0,bottom=0;for(const c of Array.from(text)){const m=this.mapping(c);if(!m)fail('This original standard face has no proved character.');if(m.nativeGlyphId>0&&c!==' '){const box=this.font.getGlyph(m.nativeGlyphId).bbox,s=size/this.font.unitsPerEm;left=Math.min(left,x+box.minX*s);right=Math.max(right,x+box.maxX*s);top=Math.min(top,-box.maxY*s);bottom=Math.max(bottom,-box.minY*s);}x+=m.pdfWidth*size/1000;}return{width:x,left,right:Math.max(right,x),top,bottom};}
}
export function loadStandardFont(asset:SourceStandardFont):StandardFontFaceMetrics{
 if(asset.version!=='standard14-winansi-v1'||asset.encoding!=='WinAnsiEncoding'||asset.nativeAdapter.version!=='pdfjs-standard14-native-v1'||sha256Sync(asset.nativeAdapter.bytes)!==asset.nativeAdapter.sha256)fail('The standard native programme is missing or changed.');
 const expected=standardEncodingTable(asset.baseFont,asset.widths);if(canonicalJson(expected)!==canonicalJson(asset.glyphMap.map(({nativeGlyphId:_gid,...m})=>m)))fail('The standard font code, Unicode or original width table changed.');return new StandardFontFaceMetrics(asset);
}
