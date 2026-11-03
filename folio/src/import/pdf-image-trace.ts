import {captureNativeVectorForm} from './pdf-native-form';
import {PDFArray,PDFBool,PDFDict,PDFDocument,PDFName,PDFNumber,PDFRawStream,PDFRef} from 'pdf-lib';
import {Util} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {sha256Sync,type Rect,type SourceImageClip} from '../core/model';
import {intersectImageRect} from '../core/source-images';
import {FolioError} from '../core/errors';
import {decodeBoundedContentStream} from './bounded-content-stream';

const fail=():never=>{throw new FolioError('PDF_IMAGE_PROOF','The original direct image resource, alpha, placement or rectangular clip cannot be proved.');};
export interface RawMarkedProperties {
 blankMarker?:'ltr-open'|'ltr-close';kind:'space-actual-text'|'structured'|'artifact'|'empty'|'ligature-actual-text'|'blank-actual-text';actualText?:' '|'ff'|'fi'|'fl'|'ffi'|'ffl'|'st';mcid?:number;language?:string;
 artifactType?:'Pagination'|'Layout'|'Page'|'Background';
 artifactSubtype?:'Header'|'Footer'|'Watermark';attached?:string[];artifactBounds?:number[];
}
type Operand=number|{name:string}|{opaque:true;rawString?:string;rawArray?:string;emptyArray?:true;mcid?:number;markedProperties?:RawMarkedProperties};
export interface RawOperator {word:string;args:Operand[];index:number;numberLexemes?:readonly (string|undefined)[];sourceSpan?:{start:number;end:number}}
export function originalOperators(text:string,classifyMarkedDictionary?:(raw:string)=>RawMarkedProperties|undefined,captureStrings=false,captureNumbers=false,captureSpans=false):RawOperator[] {
 if(text.length>16*1024*1024)return fail();let i=0,tokens=0,operatorStart=0;const result:RawOperator[]=[],args:Operand[]=[],numberLexemes:(string|undefined)[]=[];
 const ws=()=>{while(i<text.length){if(/[\x00\x09\x0a\x0c\x0d\x20]/.test(text[i]))i++;else if(text[i]==='%'){while(i<text.length&&!/[\r\n]/.test(text[i]))i++;}else break;}};
 const delim=(c:string)=>/[\x00\x09\x0a\x0c\x0d\x20\[\]()<>\/%]/.test(c);
 const skip=(depth=0):void=>{if(depth>64)return fail();ws();const first=text[i++];
  if(first==='('){let n=1;while(i<text.length&&n){const c=text[i++];if(c==='\\'){if(i>=text.length)return fail();const next=text[i++];if(next==='\r'&&text[i]==='\n')i++;}else if(c==='(')n++;else if(c===')')n--;if(n>64)return fail();}if(n)return fail();return;}
  if(first==='<'&&text[i]!=='<'){while(i<text.length&&text[i]!=='>')if(!/[\da-f\x00\x09\x0a\x0c\x0d\x20]/i.test(text[i++]))return fail();if(text[i++]!=='>')return fail();return;}
  if(first==='['||first==='<'&&text[i]==='<'){if(first==='<')i++;const end=first==='['?']':'>>';while(i<text.length){ws();if(text.startsWith(end,i)){i+=end.length;return;}if('([<'.includes(text[i]))skip(depth+1);else{if('])>'.includes(text[i]))return fail();if(text[i]==='/')i++;const start=i;while(i<text.length&&!delim(text[i]))i++;if(start===i)return fail();}}return fail();}return fail();
 };
 while(i<text.length){ws();if(i>=text.length)break;if(++tokens>100000)return fail();if(!args.length)operatorStart=i;const first=text[i];
  if('([<'.includes(first)){const start=i;skip();const raw=text.slice(start,i),dict=raw.match(/^<<\s*\/MCID\s+(0|[1-9]\d{0,5})\s*>>$/),markedProperties=raw.startsWith('<<')?classifyMarkedDictionary?.(raw):undefined,emptyArray=first==='['&&/^\[[\x00\x09\x0a\x0c\x0d\x20]*\]$/.test(raw.replace(/%[^\r\n]*/g,''));args.push({opaque:true,...(captureStrings&&(first==='('||first==='<'&&!raw.startsWith('<<'))?{rawString:raw}:{}),...(captureStrings&&first==='['?{rawArray:raw}:{}),...(emptyArray?{emptyArray:true as const}:{}),...(dict?{mcid:Number(dict[1])}:{}),...(markedProperties?{markedProperties}:{})});}
  else if(first==='/'){i++;const start=i;while(i<text.length&&!delim(text[i]))i++;const raw=text.slice(start,i);if(!raw||/#(?![\da-f]{2})/i.test(raw))return fail();args.push({name:raw.replace(/#([\da-f]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)))});}
  else{const start=i;while(i<text.length&&!delim(text[i]))i++;if(start===i)return fail();const word=text.slice(start,i);if(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(word)){const n=Number(word);if(!Number.isFinite(n))return fail();if(captureNumbers)numberLexemes[args.length]=word;args.push(n);}else{if(word==='BI'||word==='ID'||word==='EI')return fail();result.push({word,args:[...args],index:result.length,...(captureNumbers?{numberLexemes:Array.from({length:args.length},(_,j)=>numberLexemes[j])}:{}),...(captureSpans?{sourceSpan:{start:operatorStart,end:i}}:{})});args.length=0;numberLexemes.length=0;}}
  if(args.length>128||result.length>100000)return fail();
 }if(args.length)return fail();return result;
}
export function originalPageContent(document:PDFDocument,pageNumber:number,binaryStrings=false):string {
 const page=document.getPages()[pageNumber-1];if(!page)return fail();const contents=page.node.Contents(),streams=contents instanceof PDFArray?Array.from({length:contents.size()},(_,i)=>contents.lookup(i)):[contents];let text='';
 for(const stream of streams){if(!(stream instanceof PDFRawStream))return fail();const bytes=decodeBoundedContentStream(stream);if(binaryStrings){for(let offset=0;offset<bytes.length;offset+=8192)text+=String.fromCharCode(...bytes.subarray(offset,offset+8192));text+='\n';}else text+=new TextDecoder('latin1').decode(bytes)+'\n';if(text.length>16*1024*1024)return fail();}return text;
}
/** Font ownership needs only a real top-level image Do, which cannot select a font. */
export function originalDirectImageResources(document:PDFDocument,pageNumber:number,text:string):void {
 const resources=document.getPages()[pageNumber-1]?.node.Resources(),objects=resources?.lookupMaybe(PDFName.of('XObject'),PDFDict);if(!resources)return fail();
 for(const op of originalOperators(text))if(op.word==='Do'){if(op.args.length!==1||typeof op.args[0]!=='object'||!('name'in op.args[0]))return fail();const ref=objects?.get(PDFName.of(op.args[0].name));if(!(ref instanceof PDFRef))return fail();const stream=document.context.lookup(ref);if(!(stream instanceof PDFRawStream))return fail();const subtype=stream.dict.lookupMaybe(PDFName.of('Subtype'),PDFName)?.decodeText();if(subtype==='Form')captureNativeVectorForm(document,resources,op.args[0].name);else if(subtype!=='Image')return fail();}
}
interface ImageOwner {imageRef:string;smaskRef?:string;imageProgramSha256:string;maskProgramSha256?:string;colorProfileSha256?:string;pixelWidth:number;pixelHeight:number;interpolate:false;maskInterpolate:false}
export interface OriginalImageOccurrence extends ImageOwner {rawOperatorIndex:number;imageOrdinal:number;imageCtm:number[];bounds:Rect;clipStack:SourceImageClip[];pageClip?:Rect}
const num=(dict:PDFDict,key:string)=>{const v=dict.lookup(PDFName.of(key));if(!(v instanceof PDFNumber)||!Number.isFinite(v.asNumber()))return fail();return v.asNumber();};
const flag=(dict:PDFDict,key:string)=>{const v=dict.lookupMaybe(PDFName.of(key),PDFBool);if(dict.has(PDFName.of(key))&&!v)return fail();return v?.asBoolean()??false;};
const defaultGrayDecode=(dict:PDFDict)=>{if(!dict.has(PDFName.of('Decode')))return true;const a=dict.lookupMaybe(PDFName.of('Decode'),PDFArray);return a?.size()===2&&a.lookup(0,PDFNumber).asNumber()===0&&a.lookup(1,PDFNumber).asNumber()===1;};
function imageOwner(document:PDFDocument,resources:PDFDict,name:string):ImageOwner {
 const objects=resources.lookupMaybe(PDFName.of('XObject'),PDFDict),ref=objects?.get(PDFName.of(name));if(!(ref instanceof PDFRef)||!objects||objects.entries().length>30)return fail();
 const image=document.context.lookup(ref);if(!(image instanceof PDFRawStream)||image.dict.lookupMaybe(PDFName.of('Subtype'),PDFName)?.decodeText()!=='Image')return fail();
 const d=image.dict,width=num(d,'Width'),height=num(d,'Height');if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||width*height>20000000||num(d,'BitsPerComponent')!==8||flag(d,'ImageMask')||flag(d,'Interpolate')||['Mask','Decode','DecodeParms','SMaskInData','Matte','OC','Alternates','OPI','Intent'].some(k=>d.has(PDFName.of(k)))||image.getContents().length>10*1024*1024)return fail();
 const filter=d.lookupMaybe(PDFName.of('Filter'),PDFName);if(d.has(PDFName.of('Filter'))&&filter?.decodeText()!=='FlateDecode')return fail();
 const color=d.lookup(PDFName.of('ColorSpace'));let colorProfileSha256:string|undefined;
 if(color instanceof PDFName){if(color.decodeText()!=='DeviceRGB'||resources.lookupMaybe(PDFName.of('ColorSpace'),PDFDict)?.has(PDFName.of('DefaultRGB')))return fail();}else if(color instanceof PDFArray&&color.size()===2&&color.lookup(0,PDFName).decodeText()==='ICCBased'){
  const profile=color.lookup(1);if(!(profile instanceof PDFRawStream)||num(profile.dict,'N')!==3||profile.getContents().length>4*1024*1024||profile.dict.entries().some(([k])=>!['N','Length','Filter','Alternate'].includes(k.decodeText()))||profile.dict.has(PDFName.of('Alternate'))&&profile.dict.lookupMaybe(PDFName.of('Alternate'),PDFName)?.decodeText()!=='DeviceRGB'||profile.dict.has(PDFName.of('Filter'))&&profile.dict.lookupMaybe(PDFName.of('Filter'),PDFName)?.decodeText()!=='FlateDecode')return fail();colorProfileSha256=sha256Sync(profile.getContents());
 }else return fail();
 let smaskRef:string|undefined,maskProgramSha256:string|undefined;
 if(d.has(PDFName.of('SMask'))){const mref=d.get(PDFName.of('SMask'));if(!(mref instanceof PDFRef))return fail();const mask=document.context.lookup(mref);if(!(mask instanceof PDFRawStream))return fail();const m=mask.dict;
  if(m.lookupMaybe(PDFName.of('Subtype'),PDFName)?.decodeText()!=='Image'||num(m,'Width')!==width||num(m,'Height')!==height||num(m,'BitsPerComponent')!==8||m.lookupMaybe(PDFName.of('ColorSpace'),PDFName)?.decodeText()!=='DeviceGray'||flag(m,'ImageMask')||flag(m,'Interpolate')||!defaultGrayDecode(m)||['SMask','Mask','DecodeParms','SMaskInData','Matte','OC','Intent'].some(k=>m.has(PDFName.of(k)))||mask.getContents().length>10*1024*1024||m.lookupMaybe(PDFName.of('Filter'),PDFName)?.decodeText()!=='FlateDecode')return fail();smaskRef=mref.toString();maskProgramSha256=sha256Sync(mask.getContents());
 }
 return {imageRef:ref.toString(),smaskRef,imageProgramSha256:sha256Sync(image.getContents()),maskProgramSha256,colorProfileSha256,pixelWidth:width,pixelHeight:height,interpolate:false,maskInterpolate:false};
}
/** Actual direct-image ownership; no fresh common-object name is trusted as a PDFRef. */
export function originalImageOccurrences(document:PDFDocument,pageNumber:number,text=originalPageContent(document,pageNumber),legacySignedTransforms=false):OriginalImageOccurrence[] {
 const page=document.getPages()[pageNumber-1],resources=page?.node.Resources();if(!page||!resources||page.getRotation().angle!==0||page.node.has(PDFName.of('UserUnit'))&&num(page.node,'UserUnit')!==1)return fail();const media=page.getMediaBox(),crop=page.getCropBox();if(media.x!==0||media.y!==0||media.width!==crop.width||media.height!==crop.height||crop.x!==0||crop.y!==0)return fail();
 const view=[1,0,0,-1,0,media.height],result:OriginalImageOccurrence[]=[],owners=new Map<string,ImageOwner>(),stack:{matrix:number[];clips:SourceImageClip[];clip?:Rect;owner?:number}[]=[];
 let state:{matrix:number[];clips:SourceImageClip[];clip?:Rect;owner?:number}={matrix:[1,0,0,1,0,0],clips:[]},path:Rect|undefined,pathUnknown=false,pending:SourceImageClip|undefined,markedDepth=0;const clipUse=new Map<number,number>();
 const numbers=(args:Operand[],count:number)=>{if(args.length!==count||!args.every(v=>typeof v==='number'&&Number.isFinite(v)))return fail();return args as number[];};
 const transformedRect=(r:Rect,m:number[]):Rect=>{if(m[1]!==0||m[2]!==0||m[0]<=0||m[3]>=0)return fail();return{x:m[0]*r.x+m[4],y:m[3]*(r.y+r.height)+m[5],width:m[0]*r.width,height:-m[3]*r.height};};
 const transformedClip=(r:Rect,m:number[]):Rect=>{if(m[1]!==0||m[2]!==0||m[0]<=0||!m[3])return fail();const y1=m[3]*r.y+m[5],y2=m[3]*(r.y+r.height)+m[5];return{x:m[0]*r.x+m[4],y:Math.min(y1,y2),width:m[0]*r.width,height:Math.abs(y2-y1)};};
 for(const op of originalOperators(text)){
  const {word,args}=op;if(word==='q'){if(args.length||stack.length>=64||pending)return fail();stack.push({...state,matrix:[...state.matrix],clips:[...state.clips]});}
  else if(word==='Q'){if(args.length||!stack.length||pending)return fail();const previous=stack.pop()!;if(state.owner!==previous.owner&&state.owner!==undefined&&clipUse.get(state.owner)!==1)return fail();state=previous;}
  else if(word==='cm'){const a=numbers(args,6),rootReflection=op.index===0&&a[0]===1&&a[1]===0&&a[2]===0&&a[3]===-1&&a[4]===0&&a[5]===media.height;if(a[1]!==0||a[2]!==0||a[0]<=0||!a[3]||a[3]<0&&!legacySignedTransforms&&!rootReflection&&!state.clip)return fail();state.matrix=Util.transform(state.matrix,a);}
  else if(word==='re'){const [x,y,width,height]=numbers(args,4);if(path||pathUnknown||width<=0||height<=0||Math.max(Math.abs(x),Math.abs(y),width,height)>100000)return fail();path={x,y,width,height};}
  else if(['m','l','c','v','y','h'].includes(word)){pathUnknown=true;path=undefined;}
  else if(word==='W'||word==='W*'){if(args.length||!path||pathUnknown||pending||!stack.length||state.owner!==undefined)return fail();const ctm=Util.transform(view,state.matrix),bounds=transformedClip(path,ctm);pending={rawOperatorIndex:op.index,ctm,bounds};}
  else if(word==='n'){if(args.length)return fail();if(pending){state.clip=intersectImageRect(state.clip??{x:0,y:0,width:media.width,height:media.height},pending.bounds);if(!state.clip)return fail();state.clips=[...state.clips,pending];state.owner=pending.rawOperatorIndex;pending=undefined;}path=undefined;pathUnknown=false;}
  else if(word==='Do'){if(pending||path||pathUnknown||args.length!==1||typeof args[0]!=='object'||!('name'in args[0]))return fail();const name=args[0].name,owner=owners.get(name)??imageOwner(document,resources,name);owners.set(name,owner);if(result.length>=30)return fail();if(state.owner!==undefined){const n=(clipUse.get(state.owner)??0)+1;if(n!==1)return fail();clipUse.set(state.owner,n);}const imageCtm=Util.transform(view,state.matrix),bounds=transformedRect({x:0,y:0,width:1,height:1},imageCtm);if(![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isFinite)||bounds.width>100000||bounds.height>100000||!intersectImageRect(bounds,state.clip??{x:0,y:0,width:media.width,height:media.height}))return fail();result.push({...owner,rawOperatorIndex:op.index,imageOrdinal:result.length,imageCtm,bounds,clipStack:state.clips.map(c=>({...c,ctm:[...c.ctm],bounds:{...c.bounds}})),...(state.clip?{pageClip:{...state.clip}}:{})});}
  else if(word==='gs'){if(args.length!==1||typeof args[0]!=='object'||!('name'in args[0]))return fail();const gs=resources.lookupMaybe(PDFName.of('ExtGState'),PDFDict)?.lookupMaybe(PDFName.of(args[0].name),PDFDict);if(!gs)return fail();for(const [key,value] of gs.entries()){const name=key.decodeText();if(['Type','LW','LC','LJ','ML','D'].includes(name))continue;if(name==='SA'){if(!(value instanceof PDFBool))return fail();}else if(name==='ca'||name==='CA'){if(!(value instanceof PDFNumber)||value.asNumber()!==1)return fail();}else if(name==='BM'){if(!(value instanceof PDFName)||value.decodeText()!=='Normal')return fail();}else if(name==='SMask'){if(!(value instanceof PDFName)||value.decodeText()!=='None')return fail();}else return fail();}}
  else if(word==='ri'||word==='Tr'&&(numbers(args,1)[0]!==0))return fail();
  else if(['s','S','f','F','f*','B','B*','b','b*','sh','Tj','TJ',"'",'"'].includes(word)){if(state.clip||pending)return fail();if(['s','S','f','F','f*','B','B*','b','b*'].includes(word)){path=undefined;pathUnknown=false;}}
  else if(word==='RG'||word==='rg'){if(numbers(args,3).some(n=>n<0||n>1))return fail();}
  else if(word==='BDC'){if(args.length!==2||typeof args[0]!=='object'||!('name'in args[0])||args[0].name==='OC'||typeof args[1]!=='object'||!('mcid'in args[1])||++markedDepth>64)return fail();}
  else if(word==='EMC'){if(args.length||markedDepth<1)return fail();markedDepth--;}
  else if(word==='BMC'||word==='BX'||word==='EX')return fail();
  else if(state.clip||pending)return fail();
 }if(stack.length||pending||markedDepth)return fail();return result;
}

/** Classify an actual top-level marked scope, never a comment/string lookalike. */
export function hasOriginalBlankActualText(document:PDFDocument,pageNumber:number):boolean {
 return originalOperators(originalPageContent(document,pageNumber,true),raw=>/^<<\s*\/ActualText\s*<[fF][eE][fF][fF]200[bB]>\s*>>$/.test(raw)?{kind:'blank-actual-text'}:undefined).some(op=>op.word==='BDC'&&op.args.length===2&&typeof op.args[0]==='object'&&'name'in op.args[0]&&op.args[0].name==='Span'&&typeof op.args[1]==='object'&&'markedProperties'in op.args[1]&&op.args[1].markedProperties?.kind==='blank-actual-text');
}
