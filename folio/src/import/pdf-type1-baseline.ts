import {captureLayeredOriginal,installLayeredOriginalResources,type LayeredOriginalCapture} from './pdf-layered-original';
import {captureType3BitmapFont} from './pdf-type3-bitmap';
import {resolveInternalDestination,type InternalDestination} from './pdf-internal-destination';
import {PDFArray,PDFDict,PDFDocument,PDFName,PDFNumber,PDFObjectCopier,PDFRawStream,PDFRef,PDFString,PDFHexString,PDFBool,PDFNull,type PDFObject} from 'pdf-lib';
import {getDocument,Util,OPS,type PDFPageProxy} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {canonicalJson,sha256Sync,hashJson,newId,safeHref,MAX_SOURCE_BYTES,MAX_SOURCE_PAGES,sourceDocumentFingerprint,rendererVersionFor,hasValidApproval,type ImportResult,type Template,type ContentSnapshot,type Project,type RenderedDocument,type TextRegion} from '../core/model';
import {FolioError} from '../core/errors';
import {sourceAsset,warning,MAX_TEXT} from './common';
import {decodeBoundedContentStream} from './bounded-content-stream';
import {originalOperators,originalPageContent} from './pdf-image-trace';
import {localPdfDecoderOptions} from '../render/pdf-decoder-options';
import {type1BaselineSignature,type1CurrentInventoryMatches,type1EditableSlots,type1EditableRegion,type1LineProgram,type1SourceProofContains} from '../core/type1-baseline';
import type {Type1EditableSlot} from '../core/model';
import {captureType1EditableSlots} from './pdf-type1-edit';
import {type1AdvanceRecipe,createType1CursorFont} from './type1-cursor-font';
export {type1BaselineSignature} from '../core/type1-baseline';

const key=PDFName.of;
const paintText=(b:Uint8Array)=>{let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return s;};
function fail(message='This Type 1 PDF is outside the supported original-layout proof.'):never{throw new FolioError('PDF_TYPE1_BASELINE',message);}
const words=new Set('q Q cm w J j M d m l c v y h re S s f F f* B B* b b* n W W* BT ET Tc Tw Tz TL Tf Tr Ts Td TD Tm T* Tj TJ \' " g G rg RG k K'.split(' '));
const fontKeys=new Set('Type Subtype BaseFont Name Encoding FontDescriptor FirstChar LastChar Widths ToUnicode FontName Flags FontBBox ItalicAngle Ascent Descent CapHeight XHeight StemV StemH AvgWidth MaxWidth MissingWidth Leading FontFile CharSet BaseEncoding Differences Length Length1 Length2 Length3 Filter'.split(' '));
type Capture={layered?:LayeredOriginalCapture;document:PDFDocument;pages:{width:number;height:number;paint:Uint8Array;fonts:Map<string,PDFDict>;annotations:PDFDict[];internalDestinations:Map<PDFDict,InternalDestination>;annotationSignature:string}[];pagePaintSha256s:string[];programSha256s:string[];bitmapFontSha256s:string[]};

/** Passive URI and resolved internal links with bounded appearance primitives. No copied page pointer,
 * appearance stream, extra action, JavaScript, widget or file attachment graph. */
function passiveLinks(document:PDFDocument,object:PDFObject|undefined,width:number,height:number):{annotations:PDFDict[];internalDestinations:Map<PDFDict,InternalDestination>;annotationSignature:string}{
 const list=object===undefined?undefined:document.context.lookup(object);if(list!==undefined&&!(list instanceof PDFArray)||list instanceof PDFArray&&list.size()>100)fail('Unsupported Type 1 annotations.');
 const annotations:PDFDict[]=[],internalDestinations=new Map<PDFDict,InternalDestination>(),proof:unknown[]=[];
 for(const ref of list instanceof PDFArray?list.asArray():[]){
  const d=document.context.lookup(ref);if(!(d instanceof PDFDict)||d.keys().some(k=>!['Type','Subtype','Rect','Border','C','H','A'].includes(k.decodeText()))||d.lookupMaybe(key('Subtype'),PDFName)?.decodeText()!=='Link')fail('Only passive URI or internal link annotations are supported.');
  const type=d.lookupMaybe(key('Type'),PDFName)?.decodeText();if(type!==undefined&&type!=='Annot')fail();
  const numbers=(name:string,length:number,min:number,max:number,required=false):number[]|undefined=>{const a=d.lookupMaybe(key(name),PDFArray);if(!a){if(required)fail();return;}if(a.size()!==length)fail();return a.asArray().map(v=>{const n=document.context.lookup(v);if(!(n instanceof PDFNumber)||!Number.isFinite(n.asNumber())||n.asNumber()<min||n.asNumber()>max)fail();return n.asNumber();});};
  const rect=numbers('Rect',4,0,Math.max(width,height),true)!,border=numbers('Border',3,0,16),color=numbers('C',3,0,1),highlight=d.lookupMaybe(key('H'),PDFName)?.decodeText();
  if(rect[0]>=rect[2]||rect[1]>=rect[3]||rect[2]>width||rect[3]>height||highlight!==undefined&&!['N','I','O','P'].includes(highlight))fail();
  const action=d.lookupMaybe(key('A'),PDFDict),actionKind=action?.lookupMaybe(key('S'),PDFName)?.decodeText();if(!action||!['URI','GoTo'].includes(actionKind??'')||action.keys().some(k=>!['Type','S',actionKind==='URI'?'URI':'D'].includes(k.decodeText())))fail();
  const actionType=action.lookupMaybe(key('Type'),PDFName)?.decodeText();if(actionType!==undefined&&actionType!=='Action')fail();
  if(actionKind==='GoTo'){const raw=action.get(key('D'));if(!raw)fail();const destination=resolveInternalDestination(document,raw);internalDestinations.set(d,destination);annotations.push(d);proof.push({type,rect,border,color,highlight,actionType,destination});}
  else {const uri=action.lookup(key('URI'));if(!(uri instanceof PDFString||uri instanceof PDFHexString)||uri.asBytes().length>8192)fail();const href=uri.decodeText();if(href.length>4096||!safeHref(href))fail('The original link uses an unsupported URI.');annotations.push(d);proof.push({type,rect,border,color,highlight,actionType,href});}
 }
 return {annotations,internalDestinations,annotationSignature:sha256Sync(new TextEncoder().encode(canonicalJson(proof)))};
}

/** No page copying, decoder-font substitution, or new text operators. Only the
 * bounded original font graph and complete visible paint are admitted here. */
async function capture(bytes:Uint8Array):Promise<Capture|undefined>{
 if(!(bytes instanceof Uint8Array)||bytes.length>MAX_SOURCE_BYTES)fail();
 const document=await PDFDocument.load(new Uint8Array(bytes));
 if(document.catalog.has(key('OCProperties'))){const layered=await captureLayeredOriginal(bytes);if(!layered)fail();return {...layered,layered};}
 if(document.isEncrypted)fail('Encrypted PDFs need an unencrypted export.');
 if(document.getPageCount()<1||document.getPageCount()>MAX_SOURCE_PAGES)fail();
 const pages:Capture['pages']=[],programs=new Set<string>(),bitmapFonts=new Set<string>();let selected=0,totalPrograms=0,totalPaint=0,totalBitmapBytes=0,totalBitmapPixels=0;
 const seen=new Set<string>();
 const graph=(object:PDFObject,depth=0):void=>{
  if(++selected>100000||depth>16)fail();
  if(object instanceof PDFRef){const id=object.toString();if(seen.has(id))return;seen.add(id);graph(document.context.lookup(object)??fail(),depth+1);return;}
  if(object instanceof PDFRawStream){if(object.contents.length>4*1024*1024)fail();graph(object.dict,depth+1);return;}
  if(object instanceof PDFDict){for(const [k,v]of object.entries()){if(!fontKeys.has(k.decodeText()))fail();graph(v,depth+1);}return;}
  if(object instanceof PDFArray){if(object.size()>100000)fail();for(const v of object.asArray())graph(v,depth+1);return;}
  if(object instanceof PDFNumber){if(!Number.isFinite(object.asNumber())||Math.abs(object.asNumber())>1e9)fail();return;}
  if(object instanceof PDFName){if(object.decodeText().length>255)fail();return;}
  if(object instanceof PDFString||object instanceof PDFHexString){if(object.asBytes().length>1024*1024)fail();return;}
  if(object instanceof PDFBool||object===PDFNull)return;fail();
 };
 let sawType1=false;
 for(const [index,page]of document.getPages().entries()){
  const text=originalPageContent(document,index+1,true),operators=originalOperators(text,undefined,true),resource=page.node.Resources(),table=resource?.lookupMaybe(key('Font'),PDFDict);
  const aliases=[...new Set(operators.filter(o=>o.word==='Tf').map(o=>{const a=o.args[0];if(o.args.length!==2||!a||typeof a!=='object'||!('name'in a)||typeof o.args[1]!=='number'||o.args[1]<=0||o.args[1]>144)fail();return a.name;}))];
  if(!aliases.length||!table||aliases.length>32)return;
  const fonts=new Map<string,PDFDict>(),bitmapCodes=new Map<string,ReadonlySet<number>>();
  for(const alias of aliases){
   const ref=table.get(key(alias));if(!(ref instanceof PDFRef))return;
   const font=document.context.lookup(ref);if(!(font instanceof PDFDict))return;const subtype=font.lookupMaybe(key('Subtype'),PDFName)?.decodeText();
   if(subtype==='Type3'){const bitmap=captureType3BitmapFont(font);if(!bitmapFonts.has(bitmap.sha256)){bitmapFonts.add(bitmap.sha256);totalBitmapBytes+=bitmap.decodedBytes;totalBitmapPixels+=bitmap.pixels;}if(bitmapFonts.size>32||totalBitmapBytes>16*1024*1024||totalBitmapPixels>20_000_000)fail('Original bitmap font inventory exceeds its bounds.');bitmapCodes.set(alias,new Set(bitmap.codes));fonts.set(alias,font);continue;}
   if(subtype!=='Type1')return;
   const descriptor=font.lookupMaybe(key('FontDescriptor'),PDFDict),program=descriptor?.lookup(key('FontFile'));
   if(!(program instanceof PDFRawStream)||descriptor?.has(key('FontFile2'))||descriptor?.has(key('FontFile3')))return;
   sawType1=true;graph(font);
   const data=decodeBoundedContentStream(program),lengths=['Length1','Length2','Length3'].map(n=>program.dict.lookupMaybe(key(n),PDFNumber)?.asNumber());
   if(lengths.some(n=>n===undefined||!Number.isSafeInteger(n)||n<0)||(lengths as number[]).reduce((s,n)=>s+n,0)!==data.length||lengths[0]!<20||lengths[1]!<4)fail();
   const header=new TextDecoder('ascii').decode(data.subarray(0,lengths[0]));
   if(!header.startsWith('%!PS-AdobeFont-1.0:')||!/\/FontType\s+1\s+def/.test(header)||!/currentfile\s+eexec\s*$/.test(header))fail('The embedded Type 1 program header is not supported.');
   const h=sha256Sync(data);if(!programs.has(h)){totalPrograms+=data.length;programs.add(h);}if(programs.size>32||totalPrograms>16*1024*1024)fail();fonts.set(alias,font);
  }
  const media=page.getMediaBox(),crop=page.getCropBox();
  if(page.getRotation().angle!==0||media.x!==0||media.y!==0||crop.x!==0||crop.y!==0||crop.width!==media.width||crop.height!==media.height||media.width<=0||media.height<=0||media.width>2000||media.height>2000||page.node.has(key('UserUnit')))fail('This Type 1 source uses an unsupported page transform.');
  const links=passiveLinks(document,page.node.get(key('Annots')),media.width,media.height);
  let saves=0,inText=false,currentFont='';const fontStack:string[]=[];
  for(const op of operators){
   if(!words.has(op.word))fail('This Type 1 source has unsupported paint resources or active content.');
   if(op.word==='q'){if(op.args.length||++saves>64)fail();fontStack.push(currentFont);}else if(op.word==='Q'){if(op.args.length||saves--<1)fail();currentFont=fontStack.pop()!;}
   if(op.word==='Tf'){const a=op.args[0];if(typeof a!=='object'||!('name'in a))fail();currentFont=a.name;}
   if(bitmapCodes.has(currentFont)&&['Tj','TJ',"'",'"'].includes(op.word)){const operand=op.args[op.word==='"'?2:0];if(typeof operand!=='object'||!('opaque'in operand))fail();const segments=operand.rawArray?originalOperators(operand.rawArray.slice(1,-1)+' END',undefined,true)[0]?.args:[operand];if(!segments)fail();for(const segment of segments){if(typeof segment==='number')continue;if(typeof segment!=='object'||!('rawString'in segment)||!segment.rawString)fail();const raw=segment.rawString,bytes=raw[0]==='('?PDFString.of(raw.slice(1,-1)).asBytes():PDFHexString.of(raw.slice(1,-1)).asBytes();if(Array.from(bytes).some(c=>!bitmapCodes.get(currentFont)!.has(c)))fail('A painted Type 3 selector has no owned bitmap glyph.');}}
   if(op.word==='BT'){if(inText||op.args.length)fail();inText=true;}else if(op.word==='ET'){if(!inText||op.args.length)fail();inText=false;}
   if(['Tj','TJ',"'",'"','Tf'].includes(op.word)&&!inText)fail();
   if(op.word==='Tr'&&(op.args.length!==1||op.args[0]!==0))fail('Invisible or stroked Type 1 text is outside this proof.');
  }
  if(saves||inText)fail();const paint=Uint8Array.from(text,c=>c.charCodeAt(0));totalPaint+=paint.length;if(totalPaint>16*1024*1024)fail();pages.push({width:media.width,height:media.height,paint,fonts,...links});
 }
 if(!sawType1)return;
 return {document,pages,pagePaintSha256s:pages.map(p=>sha256Sync(p.paint)),programSha256s:[...programs].sort(),bitmapFontSha256s:[...bitmapFonts].sort()};
}

export async function importOriginalType1Pdf(file:File,bytes:Uint8Array,editMode:boolean|Type1EditableSlot=true):Promise<ImportResult|undefined>{
 const original=await capture(bytes);if(!original)return;
 const source=await sourceAsset(file,bytes,'pdf');source.sourcePageCount=original.pages.length;
 const task=getDocument({...localPdfDecoderOptions(),data:new Uint8Array(bytes),useSystemFonts:false,fontExtraProperties:true,stopAtErrors:true,verbosity:0});
 try{
  const pdf=await task.promise;if(await pdf.getPermissions()!==null)fail();
  const pages:Template['pages']=[],blocks:ContentSnapshot['blocks']=[],facts:ImportResult['facts']=[];let count=0;const slots:Type1EditableSlot[]=[];
  for(const [index,p]of original.pages.entries()){
   const decoded=await pdf.getPage(index+1),viewport=decoded.getViewport({scale:1}),items=(await decoded.getTextContent({disableNormalization:true})).items,regions:TextRegion[]=[],itemFonts=new Map<string,{fontName:string;text:string}>();
   if(items.length>10000)fail();const pageId=newId();
   for(const [order,item]of items.entries()){
    if(!('str'in item)||!item.str.trim())continue;
    // Some original symbol fonts expose a standalone control-coded decoration.
    // Its original ink stays in the PDF; it is never invented as career evidence.
    if(/^[\p{Control}\p{Format}]+$/u.test(item.str))continue;
    if(/[\p{Control}\p{Surrogate}]/u.test(item.str))fail(`Unreadable Type 1 semantic item ${order+1} on page ${index+1}.`);
    if((count+=item.str.length)>MAX_TEXT)fail();
    const m=Util.transform(viewport.transform,item.transform),size=Math.hypot(m[2],m[3]);if(!m.every(Number.isFinite)||size<=0||size>144)fail();
    const id=newId(),contentId=newId(),factId=newId();facts.push({id:factId,text:item.str,kind:'resume',confirmed:true,locator:`Original Type 1 PDF page${index+1}, item${order+1}`});
    blocks.push({id:contentId,runs:[{text:item.str,sourceFactIds:[factId]}],sourceFactIds:[factId]});
    itemFonts.set(`page${index+1}:item${order+1}`,{fontName:item.fontName,text:item.str});
    regions.push({kind:'text',id,pageId,contentId,order,sourceLocator:`page${index+1}:item${order+1}`,bounds:{x:m[4],y:m[5]-size*.75,width:Math.max(.01,item.width),height:size},style:{fontFamily:'serif',fontSize:size,fontWeight:400,italic:false,color:'#000000',lineHeight:size,alignment:'left',baselineOffset:size*.75},role:'body'});
   }
   if(editMode)slots.push(...await captureType1EditableSlots(p,decoded,regions,itemFonts,index+1));
   pages.push({id:pageId,width:p.width,height:p.height,regions});
  }
  const baseline={revision:1,blocks};
  const linked=original.pages.some(p=>p.annotations.length>0),extended=original.pages.some(p=>p.internalDestinations.size>0)||slots.some(s=>s.horizontalScale!==undefined||original.pages[s.pageNumber-1].fonts.get(s.fontResource)?.has(key('Encoding')));
  const template:Template={id:newId(),revision:1,pages,importerVersion:linked?'folio-original-type1-import-v2':'folio-original-type1-import-v1',warnings:[warning('TYPE1_ORIGINAL_LAYOUT_ONLY','The original Type 1 fonts and layout can be reviewed and downloaded. Wording edits and job tailoring are unavailable for this source. Upload a DOCX or a PDF using supported editable fonts to tailor it.')]};
  template.sourceType1Baseline={version:linked?'original-type1-baseline-v2':'original-type1-baseline-v1',sourceSha256:source.sha256,pagePaintSha256s:original.pagePaintSha256s,...(linked?{pageAnnotationSha256s:original.pages.map(p=>p.annotationSignature)}:{}),programSha256s:original.programSha256s,baselineSignature:type1BaselineSignature(template,baseline)};
  if(typeof editMode==='object'){
   const candidate=slots.find(s=>s.pageNumber===editMode.pageNumber&&s.sourceLocator===editMode.sourceLocator),page=original.pages[editMode.pageNumber-1];
   if(!candidate||linked||originalOperators(paintText(page.paint),undefined,true).slice(candidate.operatorIndex+1).map(o=>o.word).join(' ')!=='ET')fail('The saved Type1 line no longer has its original isolated text state.');
   const {operatorWord:_,operatorSha256:__,stateSha256:___,...legacy}=candidate;legacy.codes=legacy.codes.filter(c=>/^[A-Za-z]$/.test(c.unicode));legacy.maximumWidth=pages[legacy.pageNumber-1].regions.find(r=>r.kind==='text'&&r.sourceLocator===legacy.sourceLocator)!.bounds.width;
   template.importerVersion='folio-original-type1-import-v3';template.sourceType1Baseline.version='original-type1-baseline-v3';template.sourceType1Baseline.editableSlot=legacy;template.warnings=[warning('TYPE1_SINGLE_LINE_EDIT_ONLY','The saved original-font line supports covered-letter edits in its fixed frame. Other wording and job tailoring remain unavailable.')];
  }else if(slots.length){
   if(slots.length>512)fail('This Type1 source has too many editable lines for the bounded proof.');
   template.importerVersion='folio-original-type1-import-v5';template.sourceType1Baseline.version='original-type1-baseline-v5';template.sourceType1Baseline.editableSlots=slots;template.warnings=[warning('TYPE1_PROVED_LINES_ONLY',`${slots.length} complete lines support covered-character edits with their original font and fixed position. Split columns, links and unsupported text stay locked. Full job tailoring and line reflow are unavailable.`)];
  }
  if(extended){template.importerVersion='folio-original-type1-import-v6';template.sourceType1Baseline.version='original-type1-baseline-v6';}
  if(original.bitmapFontSha256s.length){template.importerVersion='folio-original-type1-import-v7';template.sourceType1Baseline.version='original-type1-baseline-v7';template.sourceType1Baseline.bitmapFontSha256s=original.bitmapFontSha256s;}
  if(original.layered){template.importerVersion='folio-original-type1-import-v8';template.sourceType1Baseline.version='original-type1-baseline-v8';template.sourceType1Baseline.layeredResourcesSha256=original.layered.layeredResourcesSha256;template.warnings=[warning(slots.length?'TYPE1_PROVED_LINES_ONLY':'TYPE1_ORIGINAL_LAYOUT_ONLY',slots.length?`${slots.length} complete CFF lines support covered-character edits in their original frames. TrueType text, artwork and layer visibility remain read-only. Full job tailoring and line reflow are unavailable.`:'The original layered layout can be reviewed and downloaded. Its text and artwork remain read-only; job tailoring is unavailable.')];}
  return {source,template,baseline,facts,assets:[]};
 }finally{await task.destroy();}
}

export async function validateType1BaselineSource(bytes:Uint8Array,template:Template):Promise<void>{
 const fresh=await importOriginalType1Pdf(new File([new Uint8Array(bytes)],'source.pdf',{type:'application/pdf'}),bytes,template.sourceType1Baseline?.editableSlot??!!template.sourceType1Baseline?.editableSlots);
 if(!fresh||!type1SourceProofContains(template.sourceType1Baseline,fresh.template.sourceType1Baseline))fail('The original Type 1 source manifest does not match the retained source.');
}
const evidence=(r:RenderedDocument)=>canonicalJson({layout:r.layout,contentRevision:r.contentRevision,rendererVersion:r.rendererVersion,sourceFingerprint:r.sourceFingerprint,documentScopedPurpose:r.documentScopedPurpose,sourceReplay:r.sourceReplay});
const owners=new WeakMap<RenderedDocument,{projectId:string;fingerprint:string;bytes:Uint8Array;revision:number;evidence:string}>();
export function type1CurrentReviewAllows(render:RenderedDocument|null,project:Project):boolean{
 const owner=render&&owners.get(render);return !!owner&&!!render&&hasValidApproval(project)&&render.documentScopedPurpose==='current'&&['original-type1-baseline','original-type1-current'].includes(render.sourceReplay??'')&&owner.projectId===project.id&&owner.revision===project.draft.revision&&owner.fingerprint===sourceDocumentFingerprint(project.template,project.draft)&&render.sourceFingerprint===owner.fingerprint&&render.rendererVersion===rendererVersionFor(project.template)&&evidence(render)===owner.evidence&&owner.bytes.length===render.bytes.length&&owner.bytes.every((b,i)=>render.bytes[i]===b);
}

export async function renderOriginalType1Baseline(project:Project,purpose:'baselinePreview'|'current'|'historyPreview',content:ContentSnapshot):Promise<RenderedDocument>{
 const spec=project.template.sourceType1Baseline;if(!spec||sha256Sync(project.source.bytes)!==project.source.sha256||spec.sourceSha256!==project.source.sha256||project.assets.length||project.template.sourceFonts?.length||project.template.sourceStandardFonts?.length)fail();
 if(purpose!=='baselinePreview'&&(!hasValidApproval(project)||project.approval!.layoutHash!==await hashJson(project.template)||project.approval!.baselineHash!==await hashJson(project.baseline.blocks)))fail('Approve this original Type 1 layout and its font reuse choice before current or saved-version rendering.');
 if(!type1CurrentInventoryMatches(project.template,project.baseline,content)||type1BaselineSignature(project.template,project.baseline)!==spec.baselineSignature)fail('This Type1 wording or layout change has no supported original owner. Saved data remains preserved.');
 const fresh=await importOriginalType1Pdf(new File([new Uint8Array(project.source.bytes)],project.source.name,{type:'application/pdf'}),project.source.bytes,spec.editableSlot??!!spec.editableSlots);if(!fresh||!type1SourceProofContains(spec,fresh.template.sourceType1Baseline))fail('The Type 1 layout inventory no longer matches its original source.');
 const source=await capture(project.source.bytes);if(!source)fail();
 const output=await PDFDocument.create(),copier=PDFObjectCopier.for(source.document.context,output.context),changes=type1EditableSlots(project.template).flatMap(slot=>{const region=type1EditableRegion(project.template,slot.sourceLocator),block=region&&content.blocks.find(b=>b.id===region.contentId);return block&&block.runs.map(r=>r.text).join('')!==slot.baselineText?[{slot,region:region!,plan:type1LineProgram(project.template,block.runs,slot.sourceLocator)}]:[];});
 const cursorFonts=new Map<number,Map<string,PDFRef>>();
 for(const [pageIndex,p]of source.pages.entries()){
  let text=paintText(p.paint);const ops=originalOperators(text,undefined,true,false,true),pageChanges=changes.filter(c=>c.slot.pageNumber===pageIndex+1),helpers=new Map<string,{alias:string;codes:Set<number>}>();
  for(const {slot} of pageChanges.filter(c=>c.slot.cursorRestore)){const op=ops[slot.operatorIndex];if(!op)fail();const recipe=type1AdvanceRecipe(op.word,op.args[0]);let helper=helpers.get(slot.fontResource);if(!helper){let serial=helpers.size,alias='FolioAdvance'+serial;while(p.fonts.has(alias)||[...helpers.values()].some(h=>h.alias===alias))alias='FolioAdvance'+(++serial);helper={alias,codes:new Set()};helpers.set(slot.fontResource,helper);}recipe.codes.forEach(c=>helper.codes.add(c));}
  const additions=new Map<string,PDFRef>();for(const [original,helper]of helpers){const font=p.fonts.get(original);if(!font)fail();additions.set(helper.alias,createType1CursorFont(output.context,copier,font,[...helper.codes].sort((a,b)=>a-b)));}cursorFonts.set(pageIndex,additions);
  const replacements=pageChanges.map(({slot,plan})=>{
   const op=ops[slot.operatorIndex];if(!op?.sourceSpan||!['TJ','Tj'].includes(op.word)||slot.operatorSha256&&sha256Sync(new TextEncoder().encode(text.slice(op.sourceSpan.start,op.sourceSpan.end)))!==slot.operatorSha256)fail('The original text operator owner changed.');
   const helper=slot.cursorRestore&&helpers.get(slot.fontResource),size=slot.cursorRestore?.fontSize;
   const restore=helper?' 0 0 Td '+PDFName.of(helper.alias).toString()+' '+size+' Tf '+type1AdvanceRecipe(op.word,op.args[0]).program+' '+PDFName.of(slot.fontResource).toString()+' '+size+' Tf':'';
   return {...op.sourceSpan,value:plan.program+' TJ'+restore};
  }).sort((a,b)=>b.start-a.start);let previous=text.length;for(const replacement of replacements){if(replacement.end>previous)fail('Overlapping Type1 edit owners.');text=text.slice(0,replacement.start)+replacement.value+text.slice(replacement.end);previous=replacement.start;}p.paint=Uint8Array.from(text,c=>c.charCodeAt(0));
 }
 const outputPages=source.pages.map(p=>output.addPage([p.width,p.height]));
 const layeredResources=source.layered?await installLayeredOriginalResources(source.layered,output):undefined;
 for(const [pageIndex,p]of source.pages.entries()){const page=outputPages[pageIndex],fonts=PDFDict.withContext(output.context);for(const [name,font]of p.fonts)fonts.set(key(name),output.context.register(copier.copy(font)));for(const [name,font]of cursorFonts.get(pageIndex)??[])fonts.set(key(name),font);page.node.set(key('Resources'),layeredResources?.[pageIndex]??output.context.obj({Font:fonts}));if(source.layered?.pages[pageIndex].group)page.node.set(key('Group'),copier.copy(source.layered.pages[pageIndex].group!));page.node.set(key('Contents'),output.context.register(output.context.flateStream(p.paint)));if(p.annotations.length)page.node.set(key('Annots'),output.context.obj(p.annotations.map(a=>{const destination=p.internalDestinations.get(a);if(!destination)return output.context.register(copier.copy(a));const clone=PDFDict.withContext(output.context);for(const [k,v]of a.entries())if(k.decodeText()!=='A')clone.set(k,copier.copy(v));const originalAction=a.lookup(key('A'),PDFDict),action=output.context.obj({S:'GoTo',D:[outputPages[destination.pageNumber-1].ref,PDFName.of(destination.mode),...destination.args],...(originalAction.has(key('Type'))?{Type:'Action'}:{})});clone.set(key('A'),action);return output.context.register(clone);})));}
 const render:RenderedDocument={bytes:await output.save({useObjectStreams:true}),layout:{regions:project.template.pages.flatMap(p=>p.regions.map(r=>({regionId:r.id,pageId:p.id,bounds:{...r.bounds},lines:[]}))),overflows:changes.filter(c=>c.plan.width>c.slot.maximumWidth+.00001).map(c=>({regionId:c.region.id,pageId:c.region.pageId,code:'width' as const,required:c.plan.width,available:c.slot.maximumWidth,message:'The edited line exceeds its fixed frame. Shorten the wording before download.'}))},contentRevision:content.revision,rendererVersion:rendererVersionFor(project.template),documentScopedPurpose:purpose,sourceReplay:changes.length?'original-type1-current':'original-type1-baseline',sourceFingerprint:sourceDocumentFingerprint(project.template,content)};
 if(purpose==='current')owners.set(render,{projectId:project.id,fingerprint:render.sourceFingerprint!,bytes:new Uint8Array(render.bytes),revision:project.draft.revision,evidence:evidence(render)});return render;
}
