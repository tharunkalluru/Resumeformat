import {PDFContext,PDFDict,PDFArray,PDFName,PDFNumber,PDFString,PDFHexString,PDFBool,PDFNull,PDFRef,PDFRawStream,type PDFDocument,type PDFObject} from 'pdf-lib';
import {FolioError} from '../core/errors';
import {sha256Sync,canonicalJson} from '../core/model';
import {proveOriginalCffResource,proveOriginalCffOccurrence,originalCffProgramBytes,type OriginalCffResource} from './pdf-original-cff';
export type CffResourceValue=number|boolean|null|{name:string}|{hex:string}|{array:CffResourceValue[]}|{dict:Record<string,CffResourceValue>}|{stream:{dictionary:Record<string,CffResourceValue>;hex:string}}|{program:true;subtype:'Type1C'|'CIDFontType0C'};
export interface CffResourceSpec {version:'original-cff-resource-v1';selectorBytes:1|2;dictionary:CffResourceValue;sha256:string;permission:OriginalCffResource['permission']}
const fail=():never=>{throw new FolioError('SOURCE_CFF_RESOURCE','The original CFF resource specification is not bounded or source-owned.');};
const hex=(b:Uint8Array)=>Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');
const bytes=(s:string)=>{if(s.length>2*1024*1024||s.length%2||!/^[0-9a-f]*$/.test(s))return fail();return Uint8Array.from(s.match(/../g)??[],v=>parseInt(v,16));};
const keys=new Set('Type Subtype BaseFont Name Encoding FontDescriptor FirstChar LastChar Widths ToUnicode DescendantFonts CIDSystemInfo Registry Ordering Supplement W DW FontName Flags FontBBox ItalicAngle Ascent Descent CapHeight XHeight StemV StemH AvgWidth MaxWidth MissingWidth Leading FontFile3 CharSet BaseEncoding Differences Length Length1 Length2 Length3 Filter'.split(' '));
/** Structured original font graph only: no source pages, paint operators or scripting. */
export function captureCffResourceSpec(document:PDFDocument,ref:PDFRef,proof:OriginalCffResource):CffResourceSpec{
 let work=0,total=0;const active=new Set<string>();
 const visit=(value:PDFObject,depth=0):CffResourceValue=>{if(++work>100000||depth>16)return fail();if(value instanceof PDFRef){const key=value.toString();if(active.has(key))return fail();active.add(key);const out=visit(document.context.lookup(value)??fail(),depth+1);active.delete(key);return out;}
 if(value instanceof PDFNumber){const n=value.asNumber();if(!Number.isFinite(n)||Math.abs(n)>1e9)return fail();return n;}if(value instanceof PDFBool)return value.asBoolean();if(value===PDFNull)return null;
 if(value instanceof PDFName)return{name:value.decodeText()};if(value instanceof PDFString||value instanceof PDFHexString){const data=value.asBytes();if((total+=data.length)>1024*1024)return fail();return{hex:hex(data)};}
 if(value instanceof PDFArray)return{array:value.asArray().map(v=>visit(v,depth+1))};
 if(value instanceof PDFRawStream){if(value.dict.lookupMaybe(PDFName.of('Subtype'),PDFName)?.decodeText()===proof.subtype)return{program:true,subtype:proof.subtype};if(value.contents.length>1024*1024||(total+=value.contents.length)>1024*1024)return fail();return{stream:{dictionary:dictionary(value.dict,depth),hex:hex(value.contents)}};}
 if(value instanceof PDFDict)return{dict:dictionary(value,depth)};return fail();};
 const dictionary=(value:PDFDict,depth:number):Record<string,CffResourceValue>=>Object.fromEntries(value.entries().map(([key,v])=>{const name=key.decodeText();if(!keys.has(name))return fail();return[name,visit(v,depth+1)];}));
 const dictionaryValue=visit(document.context.lookup(ref)??fail());const result={version:'original-cff-resource-v1' as const,selectorBytes:proof.selectorBytes,dictionary:dictionaryValue,permission:proof.permission};if(canonicalJson(result).length>2*1024*1024)return fail();return{...result,sha256:sha256Sync(new TextEncoder().encode(canonicalJson(result)))};
}
export function installCffResourceSpec(context:PDFContext,spec:CffResourceSpec,program:Uint8Array):PDFDict{
 if(!(program instanceof Uint8Array)||program.length<4||program.length>4*1024*1024)return fail();
 if(!spec||typeof spec!=='object'||Object.keys(spec).sort().join(',')!=='dictionary,permission,selectorBytes,sha256,version'||!spec.permission||Object.keys(spec.permission).sort().join(',')!=='fsType,os2,postScriptPresent'||spec.permission.os2!=='not-applicable'||![null,0,4,8].includes(spec.permission.fsType)||typeof spec.permission.postScriptPresent!=='boolean')return fail();const {sha256,...rest}=spec;if(spec.version!=='original-cff-resource-v1'||![1,2].includes(spec.selectorBytes))return fail();let work=0,programs=0,total=0;
 const visit=(v:CffResourceValue,depth=0):PDFObject=>{if(++work>100000||depth>16)return fail();if(v===null)return PDFNull;if(typeof v==='number'){if(!Number.isFinite(v)||Math.abs(v)>1e9)return fail();return PDFNumber.of(v);}if(typeof v==='boolean')return v?PDFBool.True:PDFBool.False;if(!v||typeof v!=='object')return fail();
 if('program'in v){if(Object.keys(v).length!==2||v.program!==true||!['Type1C','CIDFontType0C'].includes(v.subtype)||++programs!==1)return fail();return context.register(context.flateStream(program,{Subtype:v.subtype}));}
 if(Object.keys(v).length!==1)return fail();if('name'in v){if(typeof v.name!=='string'||v.name.length>255)return fail();return PDFName.of(v.name);}if('hex'in v){const b=bytes(v.hex);if((total+=b.length)>1024*1024)return fail();return PDFHexString.of(v.hex);}if('array'in v){if(!Array.isArray(v.array)||v.array.length>100000)return fail();const out=PDFArray.withContext(context);for(const item of v.array)out.push(visit(item,depth+1));return out;}
 if('dict'in v)return dictionary(v.dict,depth);if('stream'in v){const b=bytes(v.stream.hex);if((total+=b.length)>1024*1024)return fail();return context.register(PDFRawStream.of(dictionary(v.stream.dictionary,depth),b));}return fail();};
 const dictionary=(values:Record<string,CffResourceValue>,depth:number)=>{if(!values||typeof values!=='object'||Array.isArray(values))return fail();const out=PDFDict.withContext(context);for(const [k,v]of Object.entries(values)){if(!keys.has(k))return fail();out.set(PDFName.of(k),visit(v,depth+1));}return out;};
 const result=visit(spec.dictionary);if(!(result instanceof PDFDict)||programs!==1||sha256Sync(new TextEncoder().encode(canonicalJson(rest)))!==sha256)return fail();return result;
}
export function validateCffResourceSpec(spec:CffResourceSpec,program:Uint8Array,sourceSha256:string){const context=PDFContext.create(),dict=installCffResourceSpec(context,spec,program),ref=context.register(dict),proof=proveOriginalCffResource({context} as PDFDocument,ref,sourceSha256);if(!proof||proof.selectorBytes!==spec.selectorBytes||canonicalJson(proof.permission)!==canonicalJson(spec.permission))return fail();return proof;}
export {proveOriginalCffOccurrence,originalCffProgramBytes};
