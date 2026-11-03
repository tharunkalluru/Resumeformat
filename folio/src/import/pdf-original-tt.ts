import {captureSimpleNativeDescriptor,type NativeDescriptorMetrics} from './pdf-composite-font-metrics';
import {MAX_SOURCE_PAGES} from '../core/model';
import {parseDocumentScopedProgram,type DocumentScopedProperties} from '../layout/document-scoped-program';
import {originalMacRomanSelectors} from './pdf-macroman';
import {originalSymbolicByteSelectors} from './pdf-symbolic';
import {PDFArray,PDFDict,PDFDocument,PDFName,PDFNumber,PDFRawStream,PDFRef,decodePDFRawStream} from 'pdf-lib';
import {OPS,type PDFPageProxy} from 'pdfjs-dist/legacy/build/pdf.mjs';
import type {Font} from '@pdf-lib/fontkit';
import {FolioError} from '../core/errors';
import {sha256Sync,type SourceFontAsset,type Template} from '../core/model';
import {originalSourceHasNoCmap,originalTrueTypePermissions,parseOriginalSourceProgram,parseSourceProgram,sourceProgramStyle,sourceProgramNumericalStyle} from '../layout/source-fonts';
import {isTrustedLegacyTrueTypeProgram} from '../layout/legacy-tt-program';
import {parseOriginalToUnicode} from './pdf-to-unicode';
import {originalWinAnsiSelectors} from './pdf-winansi';
import {originalDirectImageResources,originalOperators,originalPageContent} from './pdf-image-trace';

const fail=():never=>{throw new FolioError('PDF_ORIGINAL_TT_PROOF','The original Identity-H font resource, Unicode, selector or source advance cannot be proved.');};
const MAX_STREAM=4*1024*1024;
const bytesOf=(stream:unknown,limit=MAX_STREAM):Uint8Array=>{if(!(stream instanceof PDFRawStream))return fail();const bytes=new Uint8Array(decodePDFRawStream(stream).getBytes(limit+1));if(bytes.length>limit)return fail();return bytes;};
const ascii=(bytes:Uint8Array)=>new TextDecoder('latin1').decode(bytes);
const numberOf=(value:unknown):number=>{if(!(value instanceof PDFNumber)||!Number.isFinite(value.asNumber()))return fail();return value.asNumber();};
const named=(dict:PDFDict,key:string,name:string)=>dict.lookupMaybe(PDFName.of(key),PDFName)?.decodeText()===name;

export interface OriginalTfEvent {resourceName:string;size:number}
/** Read only top-level Tf operands. Strings/containers cannot manufacture events. */
export function originalTfEvents(text:string,provedDirectImages=false):{events:OriginalTfEvent[];graphicsStates:string[]} {
 if(text.length>16*1024*1024)return fail();
 let index=0,tokens=0;const events:OriginalTfEvent[]=[],graphicsStates:string[]=[],args:({name:string}|{array:[number,number]}|number|undefined)[]=[];
 const whitespace=()=>{while(index<text.length){if(/[\x00\x09\x0a\x0c\x0d\x20]/.test(text[index]))index++;else if(text[index]==='%'){while(index<text.length&&!/[\r\n]/.test(text[index]))index++;}else break;}};
 const delimiter=(char:string)=>/[\x00\x09\x0a\x0c\x0d\x20\[\]()<>\/%]/.test(char);
 const skip=(depth=0):void=>{
  if(depth>64)return fail();whitespace();const first=text[index++];
  if(first==='('){let nesting=1;while(index<text.length&&nesting){const char=text[index++];if(char==='\\'){if(index>=text.length)return fail();const next=text[index++];if(next==='\r'&&text[index]==='\n')index++;}else if(char==='(')nesting++;else if(char===')')nesting--;if(nesting>64)return fail();}if(nesting)return fail();return;}
  if(first==='<'&&text[index]!=='<'){while(index<text.length&&text[index]!=='>'){if(!/[\da-f\x00\x09\x0a\x0c\x0d\x20]/i.test(text[index++]))return fail();}if(text[index++]!=='>')return fail();return;}
  if(first==='['||first==='<'&&text[index]==='<'){if(first==='<')index++;const end=first==='['?']':'>>';while(index<text.length){whitespace();if(text.startsWith(end,index)){index+=end.length;return;}if('([<'.includes(text[index]))skip(depth+1);else {if('])>'.includes(text[index]))return fail();while(index<text.length&&!delimiter(text[index]))index++;if(text[index]==='/'){index++;while(index<text.length&&!delimiter(text[index]))index++;}}}return fail();}
  return fail();
 };
 const textArray=(bounds:[number,number]):void=>{
  const saved=index;index=bounds[0]+1;
  while(index<bounds[1]){whitespace();if(text[index]===']'){index++;if(index!==bounds[1])return fail();index=saved;return;}
   if(++tokens>100000)return fail();const first=text[index];
   if(first==='('||first==='<'&&text[index+1]!=='<')skip();
   else{const start=index;while(index<bounds[1]&&!delimiter(text[index]))index++;const value=text.slice(start,index);if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)||!Number.isFinite(Number(value)))return fail();}
  }
  return fail();
 };
 while(index<text.length){whitespace();if(index>=text.length)break;if(++tokens>100000)return fail();const first=text[index];
  if('([<'.includes(first)){const start=index;skip();args.push(first==='['?{array:[start,index]}:undefined);}
  else if(first==='/'){index++;const start=index;while(index<text.length&&!delimiter(text[index]))index++;const raw=text.slice(start,index);if(/#(?![\da-f]{2})/i.test(raw))return fail();args.push({name:raw.replace(/#([\da-f]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)))});}
  else {const start=index;while(index<text.length&&!delimiter(text[index]))index++;if(start===index)return fail();const word=text.slice(start,index);
   if(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(word)){const value=Number(word);if(!Number.isFinite(value))return fail();args.push(value);}
   else {if(word==='BI'||word==='Do'&&!provedDirectImages||word==="'"||word==='"')return fail();
    if(word==='Do'&&(args.length!==1||!args[0]||typeof args[0]!=='object'||!('name'in args[0])))return fail();
    if(word==='Tf'){if(args.length!==2||!args[0]||typeof args[0]!=='object'||!('name'in args[0])||typeof args[1]!=='number'||args[1]<=0||args[1]>144)return fail();events.push({resourceName:args[0].name,size:args[1]});}
    if(word==='TJ'){if(args.length!==1||!args[0]||typeof args[0]!=='object'||!('array'in args[0]))return fail();textArray(args[0].array);}
    if(word==='gs'){if(args.length!==1||!args[0]||typeof args[0]!=='object'||!('name'in args[0]))return fail();graphicsStates.push(args[0].name);}
    args.length=0;
   }
  }
  if(args.length>128)return fail();
 }
 if(args.length||!events.length||events.length>100000)return fail();return {events,graphicsStates};
}
/** Narrow two-byte Identity-H ToUnicode: finite bfchar and scalar bfrange. */
export function originalUnicodeMap(text:string):Map<number,string> {
 if(text.length>MAX_STREAM||/\busecmap\b/.test(text))return fail();text=text.replace(/%[^\r\n]*/g,'');
 const spaces=[...text.matchAll(/(\d+)\s+begincodespacerange([\s\S]*?)endcodespacerange/g)];
 if(spaces.length!==1||spaces[0][1]!=='1'||!/^\s*<0000>\s*<ffff>\s*$/i.test(spaces[0][2]))return fail();
 const maps=new Map<number,string>();
 // Unused font declarations are metadata. Painted V4 mappings independently
 // require one noncontrol scalar and a positive source-owned selector.
 const add=(cid:number,hex:string)=>{if(!Number.isInteger(cid)||cid<0||cid>65535||!/^([\da-f]{4}){1,32}$/i.test(hex)||maps.has(cid)||maps.size>=65536)return fail();const unicode=String.fromCharCode(...(hex.match(/.{4}/g)??[]).map(part=>parseInt(part,16)));if(Array.from(unicode).length>16||/\p{Surrogate}/u.test(unicode))return fail();maps.set(cid,unicode);};
 for(const block of text.matchAll(/(\d+)\s+beginbfchar([\s\S]*?)endbfchar/g)){const rows=[...block[2].matchAll(/<([\da-f]{4})>\s*<([\da-f]+)>/gi)];if(rows.length!==Number(block[1])||block[2].replace(/<[\da-f]{4}>\s*<[\da-f]+>/gi,'').trim())return fail();for(const row of rows)add(parseInt(row[1],16),row[2]);}
 for(const block of text.matchAll(/(\d+)\s+beginbfrange([\s\S]*?)endbfrange/g)){const rows=[...block[2].matchAll(/<([\da-f]{4})>\s*<([\da-f]{4})>\s*<([\da-f]{4})>/gi)];if(rows.length!==Number(block[1])||block[2].replace(/<[\da-f]{4}>\s*<[\da-f]{4}>\s*<[\da-f]{4}>/gi,'').trim())return fail();for(const row of rows){const start=parseInt(row[1],16),end=parseInt(row[2],16),unicode=parseInt(row[3],16);if(end<start||unicode+end-start>65535)return fail();for(let cid=start;cid<=end;cid++)add(cid,(unicode+cid-start).toString(16).padStart(4,'0'));}}
 if(!maps.size)return fail();return maps;
}
function originalWidths(array:PDFArray):Map<number,number> {
 const widths=new Map<number,number>();const add=(cid:number,width:number)=>{if(!Number.isInteger(cid)||cid<0||cid>65535||width<0||width>10000||widths.has(cid)||widths.size>=65536)return fail();widths.set(cid,width);};
 for(let i=0;i<array.size();){const start=numberOf(array.lookup(i++));const next=array.lookup(i++);if(next instanceof PDFArray){for(let j=0;j<next.size();j++)add(start+j,numberOf(next.lookup(j)));}else {const end=numberOf(next),width=numberOf(array.lookup(i++));if(end<start||end>65535)return fail();for(let cid=start;cid<=end;cid++)add(cid,width);}}
 return widths;
}
export interface OriginalTrueTypeProof {bytes:Uint8Array;sha256:string;pdfFontRef:string;font:Font;unicode:ReadonlyMap<number,string>;widths:ReadonlyMap<number,number>;defaultWidth:number;selectorContract:'identity-h-v1'|'winansi-3-1-v1'|'macroman-1-0-format6-v1'|'symbolic-raw-byte-1-0-format6-v1';documentScoped?:DocumentScopedProperties;namelessDescriptor?:NativeDescriptorMetrics;groupedDescriptor?:NativeDescriptorMetrics;glyphIds?:ReadonlyMap<number,{glyphId:number;encodingUnicode?:number}>;requiresV6:boolean;requiresV11?:boolean;numericStyle?:{fontWeight:number;italic:boolean};licensedDerivation?:import('../core/model').LicensedSubsetDerivation;catalogueIdentity?:import('./pdf-fonts').PdfFontIdentity}

/** The source PDF resource owns physical selection; ToUnicode only owns semantics. */
function originalFontProof(document:PDFDocument,dictionary:PDFDict,key:string,allowV6=true):OriginalTrueTypeProof {
 let owner:PDFDict,selectorContract:OriginalTrueTypeProof['selectorContract'];
 if(named(dictionary,'Subtype','Type0')&&named(dictionary,'Encoding','Identity-H')){
  const descendants=dictionary.lookupMaybe(PDFName.of('DescendantFonts'),PDFArray);if(!descendants||descendants.size()!==1)return fail();owner=descendants.lookup(0,PDFDict);
  if(!named(owner,'Subtype','CIDFontType2')||!named(owner,'CIDToGIDMap','Identity'))return fail();selectorContract='identity-h-v1';
 }else if(allowV6&&named(dictionary,'Subtype','TrueType')&&named(dictionary,'Encoding','WinAnsiEncoding')){owner=dictionary;selectorContract='winansi-3-1-v1';}
 else if(allowV6&&named(dictionary,'Subtype','TrueType')&&named(dictionary,'Encoding','MacRomanEncoding')){owner=dictionary;selectorContract='macroman-1-0-format6-v1';}
 else if(allowV6&&named(dictionary,'Subtype','TrueType')&&!dictionary.has(PDFName.of('Encoding'))){owner=dictionary;selectorContract='symbolic-raw-byte-1-0-format6-v1';}
 else return fail();
 const descriptor=owner.lookup(PDFName.of('FontDescriptor'),PDFDict),program=bytesOf(descriptor.lookup(PDFName.of('FontFile2')));
 const documentScoped=(selectorContract==='macroman-1-0-format6-v1'||selectorContract==='symbolic-raw-byte-1-0-format6-v1')?parseDocumentScopedProgram(program,{flags:numberOf(descriptor.lookup(PDFName.of('Flags'))),italicAngle:numberOf(descriptor.lookup(PDFName.of('ItalicAngle')))},selectorContract):undefined;
 if(!documentScoped)originalTrueTypePermissions(program);const font=documentScoped?.font??parseOriginalSourceProgram(program);const declared=documentScoped?undefined:sourceProgramNumericalStyle(font),numericStyle=declared&&declared.fontWeight!==400&&declared.fontWeight!==700?declared:undefined;if(numericStyle&&selectorContract!=='identity-h-v1')return fail();
 let unicode:ReadonlyMap<number,string>,widths:ReadonlyMap<number,number>,defaultWidth:number,glyphIds:OriginalTrueTypeProof['glyphIds'],requiresV11=false,requiresV6=selectorContract==='winansi-3-1-v1'||selectorContract==='identity-h-v1'&&originalSourceHasNoCmap(font);
 if(selectorContract==='identity-h-v1'){
  const text=ascii(bytesOf(dictionary.lookup(PDFName.of('ToUnicode'))));
  if(allowV6){unicode=parseOriginalToUnicode(text,2,true,(code)=>{if(numericStyle||code<1||code>=font.numGlyphs)return false;const glyph=font.getGlyph(code);if(!glyph.path.toSVG()||glyph.advanceWidth<=0)return false;requiresV11=true;return true;});try{originalUnicodeMap(text);}catch{requiresV6=true;}}else unicode=originalUnicodeMap(text);
  // CIDFont W is optional: absent entries use the source's DW (default 1000).
  // Preserve that distinction; a present malformed W must still fail closed.
  widths=owner.has(PDFName.of('W'))?originalWidths(owner.lookup(PDFName.of('W'),PDFArray)):new Map<number,number>();defaultWidth=owner.has(PDFName.of('DW'))?numberOf(owner.lookup(PDFName.of('DW'))):1000;
 }else{
  glyphIds=selectorContract==='symbolic-raw-byte-1-0-format6-v1'?originalSymbolicByteSelectors(program,numberOf(descriptor.lookup(PDFName.of('Flags'))),font.numGlyphs):selectorContract==='macroman-1-0-format6-v1'?originalMacRomanSelectors(program,numberOf(descriptor.lookup(PDFName.of('Flags'))),font.numGlyphs):originalWinAnsiSelectors(program,numberOf(descriptor.lookup(PDFName.of('Flags'))),font.numGlyphs);
  const first=numberOf(dictionary.lookup(PDFName.of('FirstChar'))),last=numberOf(dictionary.lookup(PDFName.of('LastChar'))),array=dictionary.lookup(PDFName.of('Widths'),PDFArray);
  if(!Number.isInteger(first)||!Number.isInteger(last)||first<0||last>255||last<first||array.size()!==last-first+1)return fail();
  const result=new Map<number,number>();for(let i=0;i<array.size();i++){const width=numberOf(array.lookup(i));if(width<0||width>10000)return fail();result.set(first+i,width);}widths=result;defaultWidth=NaN;
  if(selectorContract==='symbolic-raw-byte-1-0-format6-v1'&&!dictionary.has(PDFName.of('ToUnicode')))return fail();
  unicode=dictionary.has(PDFName.of('ToUnicode'))?parseOriginalToUnicode(ascii(bytesOf(dictionary.lookup(PDFName.of('ToUnicode')))),1,true):new Map([...glyphIds.keys()].map(code=>[code,String.fromCodePoint(glyphIds!.get(code)!.encodingUnicode!)]));
 }
 if(selectorContract==='identity-h-v1'&&(defaultWidth<0||defaultWidth>10000))return fail();
 let groupedDescriptor:NativeDescriptorMetrics|undefined;if(documentScoped){try{groupedDescriptor=captureSimpleNativeDescriptor(document,key);}catch{/* Grouped document replay requires closed numeric descriptor ownership. */}}
 let namelessDescriptor:NativeDescriptorMetrics|undefined;if(documentScoped?.properties.post===null&&selectorContract==='symbolic-raw-byte-1-0-format6-v1'){try{namelessDescriptor=captureSimpleNativeDescriptor(document,key);}catch{/* Closed descriptor support is required only for newly admitted outlined occurrences. */}}
 return {...(groupedDescriptor?{groupedDescriptor}:{}),...(namelessDescriptor?{namelessDescriptor}:{}),bytes:program,sha256:sha256Sync(program),pdfFontRef:key,font,unicode,widths,defaultWidth,selectorContract,glyphIds,requiresV6,...(requiresV11?{requiresV11:true}:{}),...(numericStyle?{numericStyle}:{}),...(documentScoped?{documentScoped:documentScoped.properties}:{})};
}

/** Exact original Tf ordering/size binds PDF.js aliases to actual resource refs. */
export async function originalTrueTypeBindings(page:PDFPageProxy,bytes:Uint8Array,pageNumber:number,ops:{fnArray:number[];argsArray:any[][]}):Promise<Map<string,OriginalTrueTypeProof>> {
 const document=await PDFDocument.load(new Uint8Array(bytes)),originalPage=document.getPages()[pageNumber-1];if(!originalPage)return fail();
 const contents=originalPage.node.Contents(),streams=contents instanceof PDFArray?Array.from({length:contents.size()},(_,i)=>contents.lookup(i)):[contents];
 let text='';for(const stream of streams){text+=ascii(bytesOf(stream))+'\n';if(text.length>16*1024*1024)return fail();}
 const hasImages=/\bDo\b/.test(text)&&originalOperators(text).some(o=>o.word==='Do');if(hasImages)originalDirectImageResources(document,pageNumber,text);
 const {events,graphicsStates}=originalTfEvents(text,hasImages),resources=originalPage.node.Resources();if(!resources)return fail();
 for(const name of graphicsStates){const states=resources.lookupMaybe(PDFName.of('ExtGState'),PDFDict),state=states?.lookupMaybe(PDFName.of(name),PDFDict);if(!state||state.has(PDFName.of('Font')))return fail();}
 const fontResources=resources.lookupMaybe(PDFName.of('Font'),PDFDict);if(!fontResources||fontResources.entries().length>32)return fail();
 const selected=ops.fnArray.flatMap((op,index)=>op===OPS.setFont?[ops.argsArray[index]]:[]);if(selected.length!==events.length)return fail();
 const originals=new Map<string,OriginalTrueTypeProof>(),bindings=new Map<string,OriginalTrueTypeProof>();let aggregate=0;
 for(let i=0;i<events.length;i++){
  const event=events[i],raw=selected[i];if(raw.length!==2||typeof raw[0]!=='string'||raw[1]!==event.size)return fail();
  const ref=fontResources.get(PDFName.of(event.resourceName));if(!(ref instanceof PDFRef))return fail();const key=ref.toString();let proof=originals.get(key);
  if(!proof){proof=originalFontProof(document,document.context.lookup(ref,PDFDict),key);aggregate+=proof.bytes.length;if(aggregate>16*1024*1024)return fail();originals.set(key,proof);}

  const previous=bindings.get(raw[0]);if(previous&&previous.pdfFontRef!==key)return fail();bindings.set(raw[0],proof);
 }
 for(const [resource,proof] of bindings){const converted=page.commonObjs.get(resource) as {data?:Uint8Array};if(!converted?.data)return fail();const font=parseSourceProgram(converted.data);if(font.unitsPerEm!==proof.font.unitsPerEm||!proof.documentScoped&&JSON.stringify(proof.numericStyle?sourceProgramNumericalStyle(font):sourceProgramStyle(font))!==JSON.stringify(proof.numericStyle?sourceProgramNumericalStyle(proof.font):sourceProgramStyle(proof.font)))return fail();}
 return bindings;
}

/** A recovered declaration is a new source class, rederived from the original at every render. */
export function hasOriginalNullLigatureSource(document:PDFDocument):boolean {
 for(const page of document.getPages()){
  const resources=page.node.Resources()?.lookupMaybe(PDFName.of('Font'),PDFDict);if(!resources)continue;
  const n=document.getPages().indexOf(page)+1,content=originalPageContent(document,n,true),selected=new Set(originalOperators(content,undefined,true,true).filter(o=>o.word==='Tf').map(o=>typeof o.args[0]==='object'&&'name'in o.args[0]?o.args[0].name:''));
  for(const name of selected){const ref=resources.get(PDFName.of(name));if(!(ref instanceof PDFRef))continue;const dictionary=document.context.lookup(ref,PDFDict);if(!named(dictionary,'Subtype','Type0')||!named(dictionary,'Encoding','Identity-H'))continue;const cmap=dictionary.lookup(PDFName.of('ToUnicode'));if(!(cmap instanceof PDFRawStream))continue;const text=ascii(bytesOf(cmap));if(!/<[\da-f]{4}>\s*<0000>/i.test(text)||!/<(?:0066){1,2}(?:0069|006c)>|<00730074>/i.test(text))continue;if(originalFontProof(document,dictionary,ref.toString()).requiresV11)return true;}
 }
 return false;
}

/** Only the measured licensed full legacy program can use this compatibility path. */
function legacyOriginalMappings(document:PDFDocument,ref:PDFRef):{unicode:ReadonlyMap<number,string>;widths:ReadonlyMap<number,number>;defaultWidth:number;gid:(code:number)=>number;programSha256:string;programBytes:number}|undefined {
 const dict=document.context.lookup(ref,PDFDict);if(!named(dict,'Subtype','Type0')||!named(dict,'Encoding','Identity-H'))return;
 const descendants=dict.lookupMaybe(PDFName.of('DescendantFonts'),PDFArray);if(!descendants||descendants.size()!==1)return;const owner=descendants.lookup(0,PDFDict);if(!named(owner,'Subtype','CIDFontType2'))return;
 const program=bytesOf(owner.lookup(PDFName.of('FontDescriptor'),PDFDict).lookup(PDFName.of('FontFile2')));if(!isTrustedLegacyTrueTypeProgram(program))return;
 const selector=owner.lookup(PDFName.of('CIDToGIDMap'));let gid:(code:number)=>number;
 if(selector instanceof PDFName&&selector.decodeText()==='Identity')gid=code=>code;
 else if(selector instanceof PDFRawStream){const codes=bytesOf(selector,131072);if(!codes.length||codes.length%2)return;gid=code=>code*2+1<codes.length?codes[code*2]*256+codes[code*2+1]:0;}
 else return;
 const unicode=parseOriginalToUnicode(ascii(bytesOf(dict.lookup(PDFName.of('ToUnicode')))),2,true),widths=originalWidths(owner.lookup(PDFName.of('W'),PDFArray)),defaultWidth=owner.has(PDFName.of('DW'))?numberOf(owner.lookup(PDFName.of('DW'))):1000;
 if(defaultWidth<0||defaultWidth>10000)return;return {unicode,widths,defaultWidth,gid,programSha256:sha256Sync(program),programBytes:program.length};
}

/** Reclassify selected original resources independently of all saved font/version labels. */
export async function validateDocumentScopedSourceClass(bytes:Uint8Array,assets:readonly SourceFontAsset[],template?:Template):Promise<void>{
 // PDF.js accepts a header within its first 1024 bytes. A leading-byte graft
 // must not turn an actual selected source class into an unparsed legacy record.
 if(!new TextDecoder('ascii').decode(bytes.subarray(0,1024)).includes('%PDF-')){if(assets.some(f=>f.sourceVersion===7)||template?.importerVersion==='folio-import-v14')return fail();return;}
 const document=await PDFDocument.load(new Uint8Array(bytes));if(document.getPageCount()>MAX_SOURCE_PAGES)return fail();
 const required=new Map<string,string>(),inspected=new Set<string>();let programBytes=0;
 for(const page of document.getPages()){
  const resources=page.node.Resources()?.lookupMaybe(PDFName.of('Font'),PDFDict);if(!resources)continue;
  if(resources.entries().length>32)return fail();
  const candidates=new Map<string,PDFRef>();
  for(const [name,ref] of resources.entries()){if(!(ref instanceof PDFRef))continue;const dict=document.context.lookup(ref,PDFDict);if(named(dict,'Subtype','TrueType')&&(named(dict,'Encoding','MacRomanEncoding')||!dict.has(PDFName.of('Encoding'))))candidates.set(name.decodeText(),ref);}
  if(!candidates.size)continue;
  const contents=page.node.Contents(),streams=contents instanceof PDFArray?Array.from({length:contents.size()},(_,i)=>contents.lookup(i)):[contents];let text='';for(const stream of streams){text+=ascii(bytesOf(stream))+'\n';if(text.length>16*1024*1024)return fail();}
  for(const event of originalTfEvents(text,true).events){const ref=candidates.get(event.resourceName);if(!ref||inspected.has(ref.toString()))continue;inspected.add(ref.toString());if(inspected.size>32)return fail();const dict=document.context.lookup(ref,PDFDict),descriptor=dict.lookup(PDFName.of('FontDescriptor'),PDFDict),program=bytesOf(descriptor.lookup(PDFName.of('FontFile2')));programBytes+=program.length;if(program.length<12||programBytes>16*1024*1024)return fail();const view=new DataView(program.buffer,program.byteOffset,program.byteLength),count=view.getUint16(4);if(count>128||12+16*count>program.length)return fail();let hasOS2=false;for(let i=0;i<count;i++)if(String.fromCharCode(...program.subarray(12+i*16,16+i*16))==='OS/2')hasOS2=true;
   if(!hasOS2){const proof=originalFontProof(document,dict,ref.toString());if(!proof.documentScoped)return fail();required.set(ref.toString(),proof.sha256);}
  }
 }
 const scoped=assets.filter(f=>f.sourceVersion===7);
 if(template?.importerVersion!=='folio-import-v31'&&scoped.some(f=>f.declaredStyle.post===null&&f.glyphMap.some(m=>!m.nonPainting))!== (['folio-import-v26','folio-import-v27','folio-import-v28'].includes(template?.importerVersion??'')))return fail();
 if(required.size!==scoped.length||scoped.some(f=>required.get(f.originalProgram.pdfFontRef)!==f.originalProgram.sha256))return fail();
 const nativeDocument=template?.importerVersion==='folio-import-v31'&&template.sourceCompositePages?.version==='original-native-composite-v10'&&template.sourceCompositePages.sourceSha256===sha256Sync(bytes)&&scoped.length===assets.length||template?.importerVersion==='folio-import-v30'&&template.sourceCompositePages?.version==='original-native-composite-v9'&&template.sourceCompositePages.sourceSha256===sha256Sync(bytes)&&scoped.length===assets.length&&scoped.every(f=>!f.namelessDescriptor&&!f.groupedDescriptor&&f.declaredStyle.post!==null);
 if(required.size&&!nativeDocument&&(!template||!template.sourceScopedPages||!template.sourceImageContract||!['folio-import-v14','folio-import-v26','folio-import-v27','folio-import-v28'].includes(template.importerVersion)||template.sourceScopedPages.sourceSha256!==sha256Sync(bytes)))return fail();
}

/** Portable restoration recomputes original program/ref and source CID semantics. */
export async function validateOriginalPrograms(bytes:Uint8Array,assets:readonly SourceFontAsset[],template?:Template):Promise<void> {
 await validateDocumentScopedSourceClass(bytes,assets,template);
 await (await import('./pdf-licensed-source')).validateLicensedSubsetSourceClass(bytes,assets,template);
 const fonts=assets.filter(asset=>asset.format==='truetype'&&(asset.sourceVersion===4||asset.sourceVersion===5||asset.sourceVersion===6||asset.sourceVersion===7||asset.sourceVersion===11));
 // Production admission never treats a mutable importer label or invalid PDF
 // bytes as permission to downgrade a new face into generic legacy metrics.
 const legacy=assets.filter(asset=>asset.format==='truetype'&&!asset.originalProgram);if(legacy.some(asset=>!isTrustedLegacyTrueTypeProgram(asset.bytes)))return fail();
 if(!fonts.length&&!legacy.length)return;
 if(assets.length>32||assets.reduce((count,asset)=>count+asset.bytes.length+(asset.format==='truetype'?asset.originalProgram?.bytes.length??0:0),0)>16*1024*1024||assets.reduce((count,asset)=>count+asset.glyphMap.length,0)>100000)return fail();
 const document=await PDFDocument.load(new Uint8Array(bytes));
 if(document.catalog.has(PDFName.of('OCProperties')))return fail();
 const usedRefs=new Set<string>(),pageBindings:{events:OriginalTfEvent[];refs:string[]}[]=[];
 if(document.getPageCount()>MAX_SOURCE_PAGES)return fail();
 for(const page of document.getPages()){
  const contents=page.node.Contents(),streams=contents instanceof PDFArray?Array.from({length:contents.size()},(_,i)=>contents.lookup(i)):[contents];
  let text='';for(const stream of streams){text+=ascii(bytesOf(stream))+'\n';if(text.length>16*1024*1024)return fail();}
  const hasImages=/\bDo\b/.test(text)&&originalOperators(text).some(o=>o.word==='Do');if(hasImages)originalDirectImageResources(document,document.getPages().indexOf(page)+1,text);
  const trace=originalTfEvents(text,hasImages),resources=page.node.Resources(),fonts=resources?.lookupMaybe(PDFName.of('Font'),PDFDict);if(!resources||!fonts||fonts.entries().length>32)return fail();
  for(const stateName of trace.graphicsStates){const states=resources.lookupMaybe(PDFName.of('ExtGState'),PDFDict),state=states?.lookupMaybe(PDFName.of(stateName),PDFDict);if(!state||state.has(PDFName.of('Font')))return fail();}
  const refs:string[]=[];for(const event of trace.events){const ref=fonts.get(PDFName.of(event.resourceName));if(!(ref instanceof PDFRef))return fail();usedRefs.add(ref.toString());refs.push(ref.toString());}pageBindings.push({events:trace.events,refs});
 }
 const occurrenceOwners=new Map<string,Set<string>>();
 if(legacy.length){
  if(!template)return fail();
  const candidates=new Map<string,Map<string,number[]>>(),programs=new Set<string>();let programBytes=0,mappingCount=0;
  for(const key of usedRefs){const match=/^([1-9]\d{0,9}) (\d{1,5}) R$/.exec(key);if(!match)return fail();const source=legacyOriginalMappings(document,PDFRef.of(Number(match[1]),Number(match[2])));if(!source)continue;
   if(!programs.has(source.programSha256)){programs.add(source.programSha256);programBytes+=source.programBytes;if(programBytes>16*1024*1024)return fail();}mappingCount+=source.unicode.size;if(mappingCount>100000)return fail();
   const tuples=new Map<string,Set<number>>();for(const [code,unicode] of source.unicode){const gid=source.gid(code);if(gid<=0||gid>=2783)continue;const tuple=JSON.stringify([unicode,gid]),widths=tuples.get(tuple)??new Set<number>();widths.add(source.widths.get(code)??source.defaultWidth);tuples.set(tuple,widths);}candidates.set(key,new Map([...tuples].map(([tuple,widths])=>[tuple,[...widths].sort((a,b)=>a-b)])));
  }
  const matchesWidth=(widths:readonly number[]|undefined,width:number)=>{if(!widths)return false;let lo=0,hi=widths.length;while(lo<hi){const mid=(lo+hi)>>>1;if(widths[mid]<width-.00001)lo=mid+1;else hi=mid;}return lo<widths.length&&Math.abs(widths[lo]-width)<.00001;};
  for(const asset of legacy){const refs=new Set<string>();for(const [ref,tuples] of candidates)if(asset.glyphMap.every(map=>map.glyphId>0&&map.glyphId<2783&&matchesWidth(tuples.get(JSON.stringify([map.unicode,map.glyphId])),map.pdfWidth)))refs.add(ref);if(!refs.size)return fail();occurrenceOwners.set(asset.id,refs);}
 }
 for(const asset of fonts){if(asset.format!=='truetype'||!asset.originalProgram)return fail();const proof=asset.originalProgram,match=/^([1-9]\d{0,9}) (\d{1,5}) R$/.exec(proof.pdfFontRef);if(!match)return fail();
  if(!usedRefs.has(proof.pdfFontRef))return fail();
  const ref=PDFRef.of(Number(match[1]),Number(match[2])),dictionary=document.context.lookup(ref,PDFDict);
  const actual=originalFontProof(document,dictionary,proof.pdfFontRef,asset.sourceVersion===6||asset.sourceVersion===7||asset.sourceVersion===11),program=actual.bytes;
  if(sha256Sync(program)!==proof.sha256||program.length!==proof.bytes.length||program.some((byte,index)=>byte!==proof.bytes[index]))return fail();
  if((asset.sourceVersion===6||asset.sourceVersion===7||asset.sourceVersion===11)&&proof.selectorContract!==actual.selectorContract)return fail();
  if(!!actual.requiresV11!==(asset.sourceVersion===11))return fail();
  if(!!actual.documentScoped!==(asset.sourceVersion===7)||asset.sourceVersion===7&&JSON.stringify(actual.documentScoped)!==JSON.stringify(asset.declaredStyle))return fail();
  if(asset.sourceVersion===7&&asset.groupedDescriptor&&JSON.stringify(asset.groupedDescriptor)!==JSON.stringify(actual.groupedDescriptor))return fail();
  if(asset.sourceVersion===7&&asset.namelessDescriptor&&JSON.stringify(asset.namelessDescriptor)!==JSON.stringify(actual.namelessDescriptor))return fail();
  for(const map of asset.glyphMap){const code=map.originalCharCode,gid=actual.selectorContract==='identity-h-v1'?code:actual.glyphIds?.get(code!)?.glyphId;
   if(!code||gid!==map.originalGlyphId||actual.unicode.get(code)!==map.unicode||!Number.isFinite(actual.widths.get(code)??actual.defaultWidth)||Math.abs((actual.widths.get(code)??actual.defaultWidth)-map.pdfWidth)>.00001)return fail();
  }
  if(template&&!template.sourceScopedPages)occurrenceOwners.set(asset.id,new Set([proof.pdfFontRef]));
 }
 if(template&&occurrenceOwners.size)await (await import('./pdf-legacy-tt-owner')).validateLegacyTrueTypeOccurrences(bytes,template,occurrenceOwners,pageBindings);
}

/** Routing only: native artwork combined with fully parsed document-scoped
 * simple TrueType resources. Full paint, selector and image proof follows. */
export function hasDocumentScopedNativeArtwork(document:PDFDocument):boolean {
 if(document.getPageCount()>MAX_SOURCE_PAGES)return false;
 const pages=document.getPages().map((page,i)=>({page,ops:originalOperators(originalPageContent(document,i+1,true))}));
 if(!pages.some(({page,ops})=>ops.some(op=>{if(op.word!=='Do'||op.args.length!==1||typeof op.args[0]!=='object'||!('name'in op.args[0]))return false;const ref=page.node.Resources()?.lookupMaybe(PDFName.of('XObject'),PDFDict)?.get(PDFName.of(op.args[0].name)),object=ref&&document.context.lookup(ref);return object instanceof PDFRawStream&&named(object.dict,'Subtype','Image');})))return false;
 const seen=new Set<string>();let total=0;
 for(const {page,ops}of pages){const resources=page.node.Resources()?.lookupMaybe(PDFName.of('Font'),PDFDict);if(!resources||resources.entries().length>32)return false;
  for(const op of ops){if(op.word!=='Tf')continue;const alias=op.args[0];if(!alias||typeof alias!=='object'||!('name'in alias))return false;const ref=resources.get(PDFName.of(alias.name));if(!(ref instanceof PDFRef))return false;if(seen.has(ref.toString()))continue;if(seen.size>=32)return false;const dictionary=document.context.lookup(ref);if(!(dictionary instanceof PDFDict))return false;try{const proof=originalFontProof(document,dictionary,ref.toString());if(!proof.documentScoped||(total+=proof.bytes.length)>16*1024*1024)return false;}catch{return false;}seen.add(ref.toString());}
 }
 return seen.size>0;
}
