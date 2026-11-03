import {MAX_SOURCE_PAGES} from '../core/model';
import {PDFArray,PDFDict,PDFDocument,PDFName,PDFNumber,PDFRawStream,PDFRef,PDFNull,decodePDFRawStream,EncryptedPDFError} from 'pdf-lib';
import {FolioError} from '../core/errors';
import {sha256Sync,type SourceColorProfile} from '../core/model';
const fail=():never=>{throw new FolioError('PDF_ICC_PROOF','The original bounded RGB color profile, resource or paint ownership cannot be proved.');};
export function validateRgbIccBytes(bytes:Uint8Array):void{
 if(!(bytes instanceof Uint8Array)||bytes.length<132||bytes.length>65536)return fail();const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),tag=(o:number)=>String.fromCharCode(...bytes.subarray(o,o+4));
 if(v.getUint32(0)!==bytes.length||![2,4].includes(bytes[8])||tag(36)!=='acsp'||tag(16)!=='RGB '||tag(20)!=='XYZ '||!['mntr','scnr'].includes(tag(12))||v.getUint32(64)>3)return fail();
 const count=v.getUint32(128);if(count<1||count>128||132+count*12>bytes.length)return fail();const names=new Set<string>(),ranges:{start:number;end:number}[]=[];
 for(let i=0;i<count;i++){const p=132+i*12,name=tag(p),start=v.getUint32(p+4),length=v.getUint32(p+8);if(names.has(name)||start%4||start<132+count*12||length<8||start+length>bytes.length)return fail();names.add(name);
  if(['wtpt','rXYZ','gXYZ','bXYZ'].includes(name)&&(tag(start)!=='XYZ '||length!==20))return fail();
  if(['rTRC','gTRC','bTRC'].includes(name)){
   if(tag(start)==='curv'){if(length<12)return fail();const count=v.getUint32(start+8);if(count>4096||length!==12+count*2||count===1&&v.getUint16(start+12)===0)return fail();for(let c=1;c<count;c++)if(v.getUint16(start+12+c*2)<v.getUint16(start+10+c*2))return fail();}
   else if(tag(start)==='para'){if(length<12)return fail();const kind=v.getUint16(start+8),sizes=[1,3,4,5,7];if(kind>4||length!==12+sizes[kind]*4||v.getInt32(start+12)<=0)return fail();}
   else return fail();
  }
  if(ranges.some(r=>start<r.end&&start+length>r.start&&(start!==r.start||start+length!==r.end)))return fail();ranges.push({start,end:start+length});}
 if(!['rXYZ','gXYZ','bXYZ','rTRC','gTRC','bTRC','wtpt'].every(t=>names.has(t)))return fail();
}
/** Pinned pdf-lib 1.17.1 FlateStream grows through ensureBuffer for both stored
 * blocks and literal/back-reference writes. Guard that allocation boundary,
 * rather than checking after readBlock has expanded an entire compressed block. */
export function decodeBoundedIccStream(stream:PDFRawStream,flate:boolean):Uint8Array{
 if(stream.contents.length>65536)return fail();
 if(!flate)return new Uint8Array(stream.contents);
 try{
  const decoder=decodePDFRawStream(stream) as unknown as {ensureBuffer:(requested:number)=>Uint8Array;getBytes:()=>Uint8Array};
  if(typeof decoder.ensureBuffer!=='function')return fail();const allocate=decoder.ensureBuffer.bind(decoder);
  decoder.ensureBuffer=(requested:number)=>{if(!Number.isSafeInteger(requested)||requested<0||requested>65536)return fail();const buffer=allocate(requested);if(buffer.length>65536)return fail();return buffer;};
  const bytes=decoder.getBytes();if(bytes.length>65536)return fail();return new Uint8Array(bytes);
 }catch{return fail();}
}
/** Original stream decoding is bounded before any ICC consumer sees the program. */
export function originalRgbProfile(document:PDFDocument,ref:PDFRef,sourceSha256:string):SourceColorProfile{
 const stream=document.context.lookup(ref);if(!(stream instanceof PDFRawStream)||stream.contents.length<1||stream.contents.length>65536)return fail();
 const d=stream.dict;if(d.entries().some(([key])=>!['N','Alternate','Filter','Length'].includes(key.decodeText()))||d.lookupMaybe(PDFName.of('N'),PDFNumber)?.asNumber()!==3)return fail();
 const filter=d.has(PDFName.of('Filter'))?d.lookup(PDFName.of('Filter')):null,alternate=d.has(PDFName.of('Alternate'))?d.lookup(PDFName.of('Alternate')):null;
 if(filter!==null&&(!(filter instanceof PDFName)||filter.decodeText()!=='FlateDecode')||alternate!==null&&(!(alternate instanceof PDFName)||alternate.decodeText()!=='DeviceRGB'))return fail();
 const bytes=decodeBoundedIccStream(stream,filter!==null);validateRgbIccBytes(bytes);
 return {version:'original-icc-rgb-v1',sourceSha256,pdfProfileRef:ref.toString(),encodedSha256:sha256Sync(stream.contents),encodedLength:stream.contents.length,sha256:sha256Sync(bytes),bytes,N:3,filter:filter?'FlateDecode':null,alternate:alternate?'DeviceRGB':null};
}
type ColorTerminal={kind:'nonICC'}|{kind:'icc';ref:PDFRef;indirect:boolean};
type ColorWork={count:number};
const builtinColors=new Set(['DeviceRGB','DeviceGray','DeviceCMYK','Pattern','G','RGB','CMYK','DeviceRGBA']);
const step=(work:ColorWork,depth:number):void=>{if(depth>32||++work.count>1000)return fail();};
/** Classify only semantically used color-space positions; never decode a profile,
 * lookup table, tint function, or Form stream to establish the terminal class.
 * Each reference role matches one pinned PDF.js fetch. A remaining Ref is
 * unestablished, even if repeated fetching could eventually reach a device space. */
function colorTerminal(document:PDFDocument,spaces:PDFDict|undefined,value:unknown,work:ColorWork,depth=0,names=new Set<string>(),refs=new Set<string>(),indirect=false):ColorTerminal{
 step(work,depth);
 if(value instanceof PDFRef){const key=value.toString();if(refs.has(key))return fail();const next=new Set(refs);next.add(key);const resolved=document.context.lookup(value);if(resolved instanceof PDFRef)return fail();return colorTerminal(document,spaces,resolved,work,depth+1,names,next,indirect||resolved instanceof PDFRef);}
 if(value instanceof PDFName){const name=value.decodeText();if(builtinColors.has(name))return{kind:'nonICC'};if(names.has(name))return fail();const next=new Set(names);next.add(name);const selected=spaces?.get(PDFName.of(name));if(!selected)return fail();return colorTerminal(document,spaces,selected,work,depth+1,next,refs,indirect||names.size>0);}
 if(!(value instanceof PDFArray)||value.size()<1||value.size()>5)return fail();
 let head:unknown=value.get(0);const headRefs=new Set(refs);let headDepth=depth;
 if(head instanceof PDFRef){step(work,++headDepth);const key=head.toString();if(headRefs.has(key))return fail();headRefs.add(key);head=document.context.lookup(head);}
 if(!(head instanceof PDFName))return fail();const kind=head.decodeText();
 if(['G','DeviceGray','RGB','DeviceRGB','CMYK','DeviceCMYK','CalGray','CalRGB','Lab'].includes(kind))return{kind:'nonICC'};
 if(kind==='ICCBased'){if(value.size()!==2)return fail();const ref=value.get(1);if(!(ref instanceof PDFRef))return fail();return{kind:'icc',ref,indirect};}
 if(kind==='Pattern'&&(value.size()===1||value.get(1)===PDFNull))return{kind:'nonICC'};
 const index=['Indexed','I','Pattern'].includes(kind)?1:['Separation','DeviceN'].includes(kind)?2:-1;
 if(index<0||value.size()<=index)return fail();return colorTerminal(document,spaces,value.get(index),work,headDepth+1,names,headRefs,true);
}
function boundedColorResources(resources:PDFDict):PDFDict|undefined{
 const spaces=resources.lookupMaybe(PDFName.of('ColorSpace'),PDFDict);if(spaces&&(spaces.entries().length>32||['DefaultRGB','DefaultGray','DefaultCMYK'].some(k=>spaces.has(PDFName.of(k)))))return fail();return spaces;
}
/** Declarations retain inventory bounds; only selected direct ICC routes decode. */
export function originalIccSpaces(document:PDFDocument,resources:PDFDict,sourceSha256:string,operators:readonly import('./pdf-image-trace').RawOperator[]):Map<string,SourceColorProfile>{
 const result=new Map<string,SourceColorProfile>(),spaces=boundedColorResources(resources),selected=new Set<string>(),work={count:0};
 for(const op of operators)if(op.word==='cs'||op.word==='CS'){const value=op.args[0];if(op.args.length!==1||!value||typeof value!=='object'||!('name'in value))return fail();selected.add(value.name);}
 for(const name of selected){const terminal=colorTerminal(document,spaces,PDFName.of(name),work);if(terminal.kind==='nonICC')continue;if(terminal.indirect)return fail();const profile=originalRgbProfile(document,terminal.ref,sourceSha256);if([...result.values()].some(p=>p.pdfProfileRef!==profile.pdfProfileRef||p.sha256!==profile.sha256))return fail();result.set(name,profile);}
 return result;
}

/** Invoked Forms remain unsupported. Inspect bounded resource metadata only. */
function rejectInvokedFormIcc(document:PDFDocument,resources:PDFDict,ref:PDFRef):void{
 const visited=new Set<string>(),work={count:0};
 const walk=(reference:PDFRef,inherited:PDFDict,depth:number):void=>{
  step(work,depth);const key=reference.toString();if(visited.has(key))return;visited.add(key);
  const stream=document.context.lookup(reference);if(!(stream instanceof PDFRawStream))return;const subtype=stream.dict.lookupMaybe(PDFName.of('Subtype'),PDFName)?.decodeText();if(subtype!=='Form')return;
  const own=stream.dict.lookupMaybe(PDFName.of('Resources'),PDFDict)??inherited,spaces=boundedColorResources(own);
  if(spaces)for(const [name]of spaces.entries())if(colorTerminal(document,spaces,name,work,depth).kind==='icc')return fail();
  const objects=own.lookupMaybe(PDFName.of('XObject'),PDFDict);if(objects){if(objects.entries().length>1000)return fail();for(const [,nested]of objects.entries())if(nested instanceof PDFRef)walk(nested,own,depth+1);}
 };walk(ref,resources,0);
}
/** Actual ICC resource selection classifies the source independently of all saved
 * labels and later paint support. Unsupported paint cannot hide that selection. */
export async function sourceIccProfile(bytes:Uint8Array):Promise<SourceColorProfile|undefined>{
 if(!(bytes instanceof Uint8Array)||bytes.length>32*1024*1024)return fail();
 if(new TextDecoder('ascii').decode(bytes.subarray(0,5))!=='%PDF-')return;
 let document:PDFDocument,pageCount:number;
 try{document=await PDFDocument.load(new Uint8Array(bytes));pageCount=document.getPageCount();}catch(error){
  // Pinned pdf-lib's ES5 Error subclass does not retain instanceof in Node.
  // Match its complete SDK-owned message, never a source-controlled prefix.
  if(error instanceof EncryptedPDFError||error instanceof Error&&error.message===new EncryptedPDFError().message)throw new FolioError('ENCRYPTED_DOCUMENT','Encrypted PDFs are not supported. Export an unencrypted PDF first.');
  throw new FolioError('CORRUPT_PDF','This PDF is corrupt or unreadable. Export a fresh PDF and try again.');
 }
 if(pageCount>MAX_SOURCE_PAGES)throw new FolioError('PAGE_LIMIT',`This PDF has more than ${MAX_SOURCE_PAGES} pages. Choose a shorter PDF.`);
 const {originalOperators,originalPageContent}=await import('./pdf-image-trace');let owned:SourceColorProfile|undefined;
 const sourceSha256=sha256Sync(bytes);
 for(let i=0;i<document.getPageCount();i++){
  const page=document.getPages()[i],resources=page.node.Resources()??document.context.obj({}),objects=resources.lookupMaybe(PDFName.of('XObject'),PDFDict);const operators=page.node.Contents()?originalOperators(originalPageContent(document,i+1)):[],spaces=originalIccSpaces(document,resources,sourceSha256,operators);if(!spaces.size&&!objects)continue;
  const stack:({fill?:SourceColorProfile;stroke?:SourceColorProfile})[]=[];let active:{fill?:SourceColorProfile;stroke?:SourceColorProfile}={};
  for(const op of operators){if(op.word==='Do'){const arg=op.args[0];if(arg&&typeof arg==='object'&&'name'in arg){const ref=objects?.get(PDFName.of(arg.name));if(ref instanceof PDFRef)rejectInvokedFormIcc(document,resources,ref);}}if(op.word==='q')stack.push({...active});else if(op.word==='Q'){if(!stack.length)return fail();active=stack.pop()!;}else if(op.word==='cs'||op.word==='CS'){const n=op.args[0];if(op.args.length!==1||!n||typeof n!=='object'||!('name'in n))return fail();const p=spaces.get(n.name);if(p){if(owned&&(owned.pdfProfileRef!==p.pdfProfileRef||owned.sha256!==p.sha256))return fail();owned=p;}active[op.word==='cs'?'fill':'stroke']=p;}else if(['g','rg','k'].includes(op.word))active.fill=undefined;else if(['G','RG','K'].includes(op.word))active.stroke=undefined;
   const p=['Tj','TJ','f','F','f*'].includes(op.word)?active.fill:['S','s'].includes(op.word)?active.stroke:undefined;
   if(p){if(owned&&(owned.pdfProfileRef!==p.pdfProfileRef||owned.sha256!==p.sha256))return fail();owned=p;}
  }
  if(stack.length)return fail();
 }
 return owned;
}
export async function validateSourceColorProfiles(bytes:Uint8Array,template:import('../core/model').Template):Promise<void>{
 const actual=await sourceIccProfile(bytes),saved=template.sourceColorProfile;
 if(!actual){if(saved||template.pages.some(p=>p.regions.some(r=>'sourceScopedPaint'in r&&r.sourceScopedPaint?.color.space==='ICCBased')))return fail();return;}
 if(!saved||!template.sourceScopedPages||template.sourceScopedPages.version!=='source-scoped-pages-v2')return fail();
 const {canonicalJson}=await import('../core/model');if(canonicalJson({...actual,bytes:undefined})!==canonicalJson({...saved,bytes:undefined})||!(saved.bytes instanceof Uint8Array)||saved.bytes.length!==actual.bytes.length)return fail();for(let i=0;i<actual.bytes.length;i++)if(saved.bytes[i]!==actual.bytes[i])return fail();
}
