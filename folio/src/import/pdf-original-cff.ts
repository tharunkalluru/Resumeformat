import {PDFArray,PDFDict,PDFDocument,PDFName,PDFNumber,PDFRawStream,PDFRef,PDFString,PDFHexString,decodePDFRawStream} from 'pdf-lib';
import {FolioError} from '../core/errors';
import {sha256Sync,canonicalJson} from '../core/model';
import {boundDecodeBufferGrowth,type DecodeBufferAllocator} from './bounded-decode-buffer';
import {parseOriginalToUnicode} from './pdf-to-unicode';
import {parseOriginalCff1,proveOriginalCffSelector,proveOriginalCffName,originalCffCodeName,readType2Advances,type OriginalCffHandle} from './cff-original.js';
import tables from './cff-reference-tables.json';
import encodings from './cff-pdf-encodings.json';
const fail=():never=>{throw new FolioError('PDF_ORIGINAL_CFF_PROOF','The original CFF resource, physical selector, Unicode or advance cannot be established.');};
const key=(s:string)=>PDFName.of(s);
const named=(v:unknown)=>v instanceof PDFName?v.decodeText():undefined;
const number=(v:unknown,maximum=10000):number=>{if(!(v instanceof PDFNumber)||!Number.isFinite(v.asNumber())||v.asNumber()<0||v.asNumber()>maximum)return fail();return v.asNumber();};
const integer=(v:unknown,maximum=65535):number=>{const n=number(v,maximum);if(!Number.isInteger(n))return fail();return n;};
const dict=(v:unknown):PDFDict=>{if(!(v instanceof PDFDict))return fail();return v;};
const array=(v:unknown):PDFArray=>{if(!(v instanceof PDFArray))return fail();return v;};
const streamBytes=(v:unknown,limit=4*1024*1024):Uint8Array=>{
 if(!(v instanceof PDFRawStream)||v.contents.length>limit||v.dict.has(key('DecodeParms')))return fail();
 const filter=v.dict.lookupMaybe(key('Filter'),PDFName)?.decodeText();if(filter&&filter!=='FlateDecode')return fail();if(!filter)return new Uint8Array(v.contents);
 const decoder=decodePDFRawStream(v) as unknown as DecodeBufferAllocator&{getBytes():Uint8Array};boundDecodeBufferGrowth(decoder,limit);const bytes=decoder.getBytes();if(bytes.length>limit)return fail();return new Uint8Array(bytes);
};
function unicodeComponent(name:string):string|undefined {
 const literal=(encodings.agl as Record<string,string>)[name];
 if(literal){const values=literal.split(' ').map(s=>parseInt(s,16));if(values.some(n=>n>0x10ffff||n>=0xd800&&n<=0xdfff)||values.length>16)return;return String.fromCodePoint(...values);}
 if(/^uni(?:[0-9A-F]{4}){1,16}$/.test(name)){const value=String.fromCharCode(...name.slice(3).match(/.{4}/g)!.map(s=>parseInt(s,16)));if(/\p{Surrogate}/u.test(value))return;return value;}
 if(/^u[0-9A-F]{4,6}$/.test(name)){const n=parseInt(name.slice(1),16);if(n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff))return String.fromCodePoint(n);}
}
/** Adobe AGL specification section2; never use Unicode to choose the physical glyph. */
export function originalCffGlyphNameUnicode(name:string):string|undefined {
 if(typeof name!=='string'||name.length>255)return;
 const parts=name.split('.')[0].split('_');if(!parts.length||parts.length>16)return;const values=parts.map(unicodeComponent);if(values.some(v=>!v))return;const value=values.join('');return Array.from(value).length<=16?value:undefined;
}
function cffUnicode(bytes:Uint8Array,size:1|2):ReadonlyMap<number,string>{
 let text=new TextDecoder('latin1').decode(bytes).replace(/%[^\r\n]*/g,'');
 // CMap permits empty counted mapping blocks. Remove only exactly empty,
 // matching blocks from the parser view; original stream bytes stay untouched.
 text=text.replace(/\b0\s+(beginbfchar|beginbfrange)\b([\s\S]*?)\b(endbfchar|endbfrange)\b/g,(whole,begin:string,body:string,end:string)=>{if(end!==begin.replace('begin','end')||body.trim())return fail();return '';});
 return parseOriginalToUnicode(text,size,true);
}
function widths(owner:PDFDict,composite:boolean):{values:Map<number,number>;defaultWidth?:number}{
 const result=new Map<number,number>();
 if(!composite){const first=integer(owner.lookup(key('FirstChar')),255),last=integer(owner.lookup(key('LastChar')),255),ws=array(owner.lookup(key('Widths')));if(last<first||ws.size()!==last-first+1)return fail();for(let c=first;c<=last;c++)result.set(c,number(ws.lookup(c-first)));return{values:result};}
 const ws=owner.has(key('W'))?array(owner.lookup(key('W'))):undefined,plans:{first:number;last:number;values:number|number[]}[]=[];let cost=ws?.size()??0,previous=-1;
 if(cost>100000)return fail();
 for(let i=0;ws&&i<ws.size();){if(i+1>=ws.size())return fail();const first=integer(ws.lookup(i++)),next=ws.lookup(i++);let last:number,values:number|number[];
  if(next instanceof PDFArray){if(!next.size()||next.size()>65536)return fail();last=first+next.size()-1;values=[];for(let j=0;j<next.size();j++)values.push(number(next.lookup(j)));}
  else{last=integer(next);if(i>=ws.size())return fail();values=number(ws.lookup(i++));}
  if(first<=previous||last<first||last>65535||(cost+=last-first+1)>100000)return fail();previous=last;plans.push({first,last,values});}
 for(const p of plans)for(let c=p.first;c<=p.last;c++)result.set(c,typeof p.values==='number'?p.values:p.values[c-p.first]);
 return{values:result,defaultWidth:owner.has(key('DW'))?number(owner.lookup(key('DW'))):1000};
}
export interface OriginalCffResource {
 readonly sourceSha256:string;readonly pdfFontRef:string;readonly programSha256:string;readonly programBytes:number;readonly subtype:'Type1C'|'CIDFontType0C';readonly selectorBytes:1|2;readonly permission:{readonly os2:'not-applicable';readonly fsType:0|4|8|null;readonly postScriptPresent:boolean};readonly metadataSha256:string;
}
export interface OriginalCffOccurrence {readonly code:number;readonly originalGID:number;readonly unicode:string;readonly pdfWidth:number;readonly nativeWidth:number;readonly charstringSha256:string;readonly programSha256:string}
/** Structural original-program validation only; every painted selector must also be proved. */
export function validateOriginalCffBaseline(program:Uint8Array):OriginalCffHandle {return parseOriginalCff1(program,tables);}
const owned=new WeakMap<OriginalCffResource,{parser:OriginalCffHandle;program:Uint8Array;unicode?:ReadonlyMap<number,string>;names:Map<number,string>;explicitBase:boolean;widths:ReturnType<typeof widths>;cache:Map<number,OriginalCffOccurrence>;budget:{remaining:number}}>();
/** A raw FontFile3 proof; this does not grant native editing, font ownership or export. */
export function proveOriginalCffResource(document:PDFDocument,ref:PDFRef,sourceSha256:string):OriginalCffResource|undefined {
 if(!/^[\da-f]{64}$/.test(sourceSha256))return fail();const font=dict(document.context.lookup(ref));const type=named(font.lookup(key('Subtype')));let owner=font,composite=false;
 if(type==='Type0'){const descendants=array(font.lookup(key('DescendantFonts')));if(descendants.size()!==1)return fail();owner=dict(descendants.lookup(0));if(named(owner.lookup(key('Subtype')))!=='CIDFontType0')return;composite=true;}
 else if(type!=='Type1')return;
 if(!owner.has(key('FontDescriptor')))return;const descriptor=dict(owner.lookup(key('FontDescriptor')));if(!descriptor.has(key('FontFile3')))return;
 if(descriptor.has(key('FontFile'))||descriptor.has(key('FontFile2'))||font.has(key('FontFile3'))||owner.has(key('FontFile3')))return fail();
 const programRef=descriptor.get(key('FontFile3')),stream=descriptor.lookup(key('FontFile3'));if(!(programRef instanceof PDFRef)||!(stream instanceof PDFRawStream))return fail();const subtype=named(stream.dict.lookup(key('Subtype')));if(subtype!==(composite?'CIDFontType0C':'Type1C'))return fail();
 const program=streamBytes(stream),parser=validateOriginalCffBaseline(program);if(parser.cid!==composite)return fail();
 if(composite){const system=dict(owner.lookup(key('CIDSystemInfo'))),registry=system.lookup(key('Registry')),ordering=system.lookup(key('Ordering'));if(!(registry instanceof PDFString||registry instanceof PDFHexString)||!(ordering instanceof PDFString||ordering instanceof PDFHexString)||registry.decodeText()!==parser.ros?.registry||ordering.decodeText()!==parser.ros?.ordering||integer(system.lookup(key('Supplement')))!==parser.ros?.supplement)return fail();}
 if(composite&&(named(font.lookup(key('Encoding')))!=='Identity-H'||owner.has(key('CIDToGIDMap'))||owner.has(key('W2'))||owner.has(key('DW2'))))return fail();
 const names=new Map<number,string>();let explicitBase=false;
 if(!composite){let base=font.has(key('Encoding'))?font.lookup(key('Encoding')):undefined,differences:PDFArray|undefined;
  if(base instanceof PDFDict){if(base.keys().some(k=>!['Type','BaseEncoding','Differences'].includes(k.decodeText())))return fail();differences=base.has(key('Differences'))?array(base.lookup(key('Differences'))):undefined;base=base.has(key('BaseEncoding'))?base.lookup(key('BaseEncoding')):undefined;}
  if(base!==undefined&&named(base)!=='WinAnsiEncoding'&&named(base)!=='StandardEncoding')return fail();
  explicitBase=base!==undefined;const mapping=named(base)==='WinAnsiEncoding'?Object.entries(encodings.winAnsi):named(base)==='StandardEncoding'?tables.standardEncoding.map((name,code)=>[String(code),name] as [string,string]):[];
  for(const [code,name]of mapping)if(name)names.set(Number(code),name);
  if(differences){if(differences.size()>512)return fail();let code=-1;const changed=new Set<number>();for(let i=0;i<differences.size();i++){const value=differences.lookup(i);if(value instanceof PDFNumber)code=integer(value,255);else{const name=named(value);if(!name||code<0||code>255||changed.has(code))return fail();changed.add(code);names.set(code++,name);}}}
 }
 const unicode=font.has(key('ToUnicode'))?cffUnicode(streamBytes(font.lookup(key('ToUnicode'))),composite?2:1):undefined;if(composite&&!unicode)return fail();
 const result:OriginalCffResource=Object.freeze({sourceSha256,pdfFontRef:ref.toString(),programSha256:parser.programSha256,programBytes:program.length,subtype:subtype as 'Type1C'|'CIDFontType0C',selectorBytes:composite?2:1,permission:parser.permission,metadataSha256:sha256Sync(new TextEncoder().encode(canonicalJson({font:font.toString(),descriptor:descriptor.toString(),programRef:programRef.toString()})))});
 owned.set(result,{parser,program,unicode,names,explicitBase,widths:widths(owner,composite),cache:new Map(),budget:{remaining:100000}});return result;
}
export function proveOriginalCffOccurrence(resource:OriginalCffResource,code:number):OriginalCffOccurrence {
 const owner=owned.get(resource);if(!owner||!Number.isInteger(code)||code<0||code>(resource.selectorBytes===1?255:65535))return fail();const cached=owner.cache.get(code);if(cached)return cached;
 const name=owner.names.get(code);if(owner.explicitBase&&!name)return fail();const selector=name?proveOriginalCffName(owner.parser,code,name):proveOriginalCffSelector(owner.parser,code),unicode=owner.unicode?.get(code)??(!owner.unicode&&!owner.parser.cid?originalCffGlyphNameUnicode(name??originalCffCodeName(owner.parser,code)):undefined),pdfWidth=owner.widths.values.get(code)??owner.widths.defaultWidth;
 if(!unicode||Array.from(unicode).length>16||/[\p{Control}\p{Surrogate}]/u.test(unicode)||pdfWidth===undefined||!Number.isFinite(pdfWidth))return fail();
 const advance=readType2Advances(owner.parser,[selector.originalGID],owner.budget)[0];if(!Number.isFinite(advance.fontUnits)||advance.fontUnits<0||advance.fontUnits>10000)return fail();
 const result=Object.freeze({code,originalGID:selector.originalGID,unicode,pdfWidth,nativeWidth:advance.fontUnits,charstringSha256:advance.charstringSha256,programSha256:resource.programSha256});owner.cache.set(code,result);return result;
}

export function originalCffProgramBytes(resource:OriginalCffResource):Uint8Array{const p=owned.get(resource);if(!p)return fail();return new Uint8Array(p.program);}
