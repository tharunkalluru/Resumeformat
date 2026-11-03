import {FolioError} from '../core/errors';

const fail=():never=>{throw new FolioError('PDF_WINANSI_SELECTOR','The original nonsymbolic WinAnsi physical selector is not proved.');};
/** PDF.js6.4.299 WinAnsi glyph-name/AGL route, distinct from ToUnicode semantics. */
export function winAnsiEncodingUnicode(code:number):number|undefined {
 if(!Number.isInteger(code)||code<32||code>255)return;
 if(code<127)return code;
 if(code===127)return 0x2022;
 const high=[0x20ac,0x2022,0x201a,0x0192,0x201e,0x2026,0x2020,0x2021,0x02c6,0x2030,0x0160,0x2039,0x0152,0x2022,0x017d,0x2022,0x2022,0x2018,0x2019,0x201c,0x201d,0x2022,0x2013,0x2014,0x02dc,0x2122,0x0161,0x203a,0x0153,0x2022,0x017e,0x0178];
 if(code<160)return high[code-128];
 return code===160?32:code===173?45:code;
}
export interface WinAnsiPhysicalSelector {glyphId:number;encodingUnicode:number}
/** Explicit original Microsoft(3,1) format4 lookup; fontkit preference never owns selection. */
export function originalWinAnsiSelectors(bytes:Uint8Array,flags:number,numGlyphs:number):ReadonlyMap<number,WinAnsiPhysicalSelector> {
 if(!(bytes instanceof Uint8Array)||bytes.length<12||bytes.length>4*1024*1024||!Number.isInteger(flags)||flags<0||flags>0x7fffffff||!(flags&32)||(flags&4)||!Number.isInteger(numGlyphs)||numGlyphs<1||numGlyphs>65535)return fail();
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=v.getUint16(4);if(v.getUint32(0)!==0x00010000||count<1||count>128||12+count*16>bytes.length)return fail();
 let cmap:{offset:number;length:number}|undefined;
 for(let i=0;i<count;i++){const p=12+i*16;if(String.fromCharCode(...bytes.subarray(p,p+4))!=='cmap')continue;if(cmap)return fail();const offset=v.getUint32(p+8),length=v.getUint32(p+12);if(offset<12+count*16||length<4||offset>bytes.length-length)return fail();cmap={offset,length};}
 if(!cmap)return fail();const start=cmap.offset,tables=v.getUint16(start+2);if(v.getUint16(start)!==0||tables<1||tables>128||4+tables*8>cmap.length)return fail();
 let selected:number|undefined;
 for(let i=0;i<tables;i++){const p=start+4+i*8;if(v.getUint16(p)===3&&v.getUint16(p+2)===1){if(selected!==undefined)return fail();const offset=v.getUint32(p+4);if(offset<4+tables*8||offset>cmap.length-16)return fail();selected=start+offset;}}
 if(selected===undefined||v.getUint16(selected)!==4)return fail();
 const length=v.getUint16(selected+2),segments=v.getUint16(selected+6)/2;if(length<16||selected+length>start+cmap.length||!Number.isInteger(segments)||segments<1||segments>8192||16+segments*8>length||v.getUint16(selected+14+segments*2)!==0)return fail();
 const endBase=selected+14,startBase=endBase+segments*2+2,deltaBase=startBase+segments*2,rangeBase=deltaBase+segments*2,glyphBase=rangeBase+segments*2;
 let previous=-1;
 for(let i=0;i<segments;i++){const lo=v.getUint16(startBase+i*2),hi=v.getUint16(endBase+i*2),range=v.getUint16(rangeBase+i*2);if(lo>hi||lo<=previous||range%2||range&&(rangeBase+i*2+range<glyphBase||rangeBase+i*2+range+(hi-lo)*2+2>selected+length))return fail();previous=hi;}
 if(previous!==65535)return fail();
 const result=new Map<number,WinAnsiPhysicalSelector>();
 for(let code=32;code<=255;code++){const unicode=winAnsiEncodingUnicode(code)!;let left=0,right=segments-1;while(left<right){const mid=(left+right)>>>1;if(v.getUint16(endBase+mid*2)<unicode)left=mid+1;else right=mid;}if(unicode<v.getUint16(startBase+left*2)||unicode>v.getUint16(endBase+left*2))continue;
  const delta=v.getInt16(deltaBase+left*2),range=v.getUint16(rangeBase+left*2);let glyph=range?v.getUint16(rangeBase+left*2+range+(unicode-v.getUint16(startBase+left*2))*2):unicode;if(!range||glyph)glyph=(glyph+delta)&65535;if(!glyph)continue;if(glyph>=numGlyphs)return fail();result.set(code,{glyphId:glyph,encodingUnicode:unicode});
 }
 return result;
}
