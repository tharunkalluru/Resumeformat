import {PDFArray,PDFBool,PDFDict,PDFDocument,PDFName,PDFNumber,PDFRawStream,PDFRef} from 'pdf-lib';
import {FolioError} from '../core/errors';
import {canonicalJson,sha256Sync} from '../core/model';
import {decodeBoundedContentStream} from './bounded-content-stream';
import {originalOperators} from './pdf-image-trace';
import {originalPageContent} from './pdf-image-trace';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {localPdfDecoderOptions} from '../render/pdf-decoder-options';

/** Staged primitive, not an importer admission rule. Forms remain blocked until
 * complete page invocation/decoded paint correspondence has been qualified. */
export interface NativeVectorForm {
 readonly ref:string;
 readonly fingerprint:string;
 readonly streamSha256:string;
 readonly bbox:readonly number[];
 readonly matrix:readonly number[];
 readonly isolated:boolean;
 readonly pathPaints:number;
}
type State=Record<string,number|string>;
interface Snapshot {bytes:Uint8Array;bbox:number[];matrix?:number[];group?:{I:boolean;K?:boolean};states:Record<string,State>;procSet?:string[];explicitType:boolean;formType?:number;filter?:string}
const owned=new WeakMap<NativeVectorForm,Snapshot>();
const fail=(reason:string):never=>{throw new FolioError('PDF_COMPOSITE_PROOF','Native vector Form cannot be proved: '+reason);};
const finite=(v:number)=>Number.isFinite(v)&&Math.abs(v)<=1_000_000;
const numberArray=(d:PDFDict,key:string,n:number)=>{const a=d.lookup(PDFName.of(key),PDFArray);if(a.size()!==n)return fail(key+' arity');const values=a.asArray().map(v=>d.context.lookup(v));if(values.some(v=>!(v instanceof PDFNumber)||!finite(v.asNumber())))return fail(key+' numbers');return values.map(v=>(v as PDFNumber).asNumber());};
const only=(d:PDFDict,keys:string[])=>{if(d.entries().some(([k])=>!keys.includes(k.decodeText())))return fail('unsupported dictionary field');};

/** Closed, font-free vector leaf: no nested objects, text, images, masks,
 * patterns or active content. Resources resolve only in this Form's dictionary. */
export function captureNativeVectorForm(document:PDFDocument,resources:PDFDict,name:string):NativeVectorForm {
 const objects=resources.lookupMaybe(PDFName.of('XObject'),PDFDict),ref=objects?.get(PDFName.of(name));
 if(!objects||objects.entries().length>30||!(ref instanceof PDFRef))return fail('resource reference');
 const stream=document.context.lookup(ref);if(!(stream instanceof PDFRawStream))return fail('stream owner');const d=stream.dict;
 only(d,['Type','Subtype','FormType','BBox','Matrix','Resources','Group','Length','Filter']);
 if(d.lookupMaybe(PDFName.of('Subtype'),PDFName)?.decodeText()!=='Form'||d.has(PDFName.of('Type'))&&d.lookupMaybe(PDFName.of('Type'),PDFName)?.decodeText()!=='XObject')return fail('subtype');
 const formType=d.has(PDFName.of('FormType'))?d.lookup(PDFName.of('FormType'),PDFNumber).asNumber():undefined;if(formType!==undefined&&formType!==1)return fail('FormType');
 const bbox=numberArray(d,'BBox',4);if(bbox[2]<=bbox[0]||bbox[3]<=bbox[1])return fail('BBox extent');
 const matrix=d.has(PDFName.of('Matrix'))?numberArray(d,'Matrix',6):undefined;if(matrix&&matrix[0]*matrix[3]-matrix[1]*matrix[2]===0)return fail('singular Matrix');
 const filter=d.has(PDFName.of('Filter'))?d.lookup(PDFName.of('Filter'),PDFName).decodeText():undefined;if(filter!==undefined&&filter!=='FlateDecode')return fail('filter');
 if(stream.contents.length>256*1024)return fail('encoded stream budget');const decoded=decodeBoundedContentStream(stream);if(decoded.length>256*1024)return fail('decoded stream budget');
 const r=d.lookup(PDFName.of('Resources'),PDFDict);only(r,['ProcSet','ExtGState']);let procSet:string[]|undefined;
 if(r.has(PDFName.of('ProcSet'))){const p=r.lookup(PDFName.of('ProcSet'),PDFArray);if(p.size()>5)return fail('ProcSet budget');procSet=p.asArray().map(v=>{const n=document.context.lookup(v);if(!(n instanceof PDFName)||!['PDF','Text','ImageB','ImageC','ImageI'].includes(n.decodeText()))return fail('ProcSet');return n.decodeText();});}
 const states:Record<string,State>=Object.create(null),gs=r.lookupMaybe(PDFName.of('ExtGState'),PDFDict);if(gs&&gs.entries().length>32)return fail('state budget');
 for(const [key] of gs?.entries()??[]){const state=gs!.lookup(key,PDFDict);only(state,['Type','ca','CA','BM','SMask']);const values:State=Object.create(null);for(const [k,v] of state.entries()){const x=document.context.lookup(v),field=k.decodeText();if(field==='Type'){if(!(x instanceof PDFName)||x.decodeText()!=='ExtGState')return fail('state Type');values[field]='ExtGState';}else if(field==='ca'||field==='CA'){if(!(x instanceof PDFNumber)||!Number.isFinite(x.asNumber())||x.asNumber()<0||x.asNumber()>1)return fail('alpha');values[field]=x.asNumber();}else{if(!(x instanceof PDFName)||x.decodeText()!==(field==='BM'?'Normal':'None'))return fail('blend/mask');values[field]=x.decodeText();}}states[key.decodeText()]=values;}
 let group:Snapshot['group'];if(d.has(PDFName.of('Group'))){const g=d.lookup(PDFName.of('Group'),PDFDict);only(g,['Type','S','I','K']);if(g.lookupMaybe(PDFName.of('Type'),PDFName)?.decodeText()!=='Group'||g.lookupMaybe(PDFName.of('S'),PDFName)?.decodeText()!=='Transparency'||!g.lookup(PDFName.of('I'),PDFBool).asBoolean())return fail('isolated group required');const k=g.has(PDFName.of('K'))?g.lookup(PDFName.of('K'),PDFBool).asBoolean():undefined;if(k)return fail('knockout');group={I:true,...(k!==undefined?{K:k}:{})};}
 let text='';for(let i=0;i<decoded.length;i+=8192)text+=String.fromCharCode(...decoded.subarray(i,i+8192));
 const ops=originalOperators(text);if(ops.length>4096)return fail('operator budget');let depth=0,path=false,current=false,clip=false,pathPaints=0,ctm=matrix?[...matrix]:[1,0,0,1,0,0];const matrices:number[][]=[];
 for(const op of ops){const w=op.word,a=op.args;
  const numbers=(n:number)=>{if(a.length!==n||a.some(x=>typeof x!=='number'||!finite(x)))return fail('numeric operands');return a as number[];};
  const empty=()=>{if(a.length)return fail('unexpected operands');};
  if(clip&&!['n','f','F','f*'].includes(w))return fail('pending clip');
  if(w==='q'||w==='Q'){empty();if(path)return fail('path across graphics state');if(w==='q'){if(++depth>32)return fail('stack budget');matrices.push([...ctm]);}else{if(--depth<0)return fail('stack underflow');ctm=matrices.pop()!;}}
  else if(w==='cm'){if(path)return fail('transform during path');const m=numbers(6);if(m[0]*m[3]-m[1]*m[2]===0)return fail('singular transform');const a=ctm;ctm=[a[0]*m[0]+a[2]*m[1],a[1]*m[0]+a[3]*m[1],a[0]*m[2]+a[2]*m[3],a[1]*m[2]+a[3]*m[3],a[0]*m[4]+a[2]*m[5]+a[4],a[1]*m[4]+a[3]*m[5]+a[5]];if(!ctm.every(finite)||ctm[0]*ctm[3]-ctm[1]*ctm[2]===0)return fail('derived transform');}
  else if(['g','G','rg','RG','k','K'].includes(w)){const values=numbers(w.length===1&&w.toLowerCase()==='g'?1:w.toLowerCase()==='rg'?3:4);if(values.some(v=>v<0||v>1))return fail('color range');}
  else if(w==='gs'){if(a.length!==1||typeof a[0]!=='object'||!('name'in a[0])||!Object.hasOwn(states,a[0].name))return fail('child state owner');}
  else if(w==='m'||w==='re'){numbers(w==='m'?2:4);path=true;current=true;}
  else if(['l','c','v','y'].includes(w)){if(!current)return fail('missing current point');numbers(w==='l'?2:w==='c'?6:4);path=true;}
  else if(w==='h'){empty();if(!current)return fail('close without path');}
  else if(w==='W'||w==='W*'){empty();if(!path||clip)return fail('clip owner');clip=true;}
  else if(['n','f','F','f*'].includes(w)){empty();if(!path)return fail('empty path');if(w!=='n')pathPaints++;path=false;current=false;clip=false;}
  else return fail('unsupported leaf operator '+w);
 }
 if(depth||path||clip||!pathPaints)return fail('complete balanced paint required');
 const snapshot:Snapshot={bytes:new Uint8Array(stream.contents),bbox,...(matrix?{matrix}:{}),...(group?{group}:{}),states,...(procSet?{procSet}:{}),explicitType:d.has(PDFName.of('Type')),...(formType!==undefined?{formType}:{}),...(filter?{filter}:{})};
 const streamSha256=sha256Sync(snapshot.bytes),handle:NativeVectorForm={ref:ref.toString(),fingerprint:sha256Sync(new TextEncoder().encode(canonicalJson({...snapshot,bytes:undefined,streamSha256}))),streamSha256,bbox:[...bbox],matrix:matrix?[...matrix]:[1,0,0,1,0,0],isolated:!!group,pathPaints};owned.set(handle,structuredClone(snapshot));return handle;
}

/** Emit the captured native stream with fresh closed resources. Never copy an
 * unchecked source object graph or trust a caller's mutated public snapshot. */
export function installNativeVectorForm(out:PDFDocument,handle:NativeVectorForm):PDFRef {
 const s=owned.get(handle);if(!s)return fail('unowned snapshot');const states:Record<string,PDFRef>=Object.create(null);
 for(const [name,state] of Object.entries(s.states))states[name]=out.context.register(out.context.obj(Object.fromEntries(Object.entries(state).map(([key,value])=>[key,typeof value==='string'?PDFName.of(value):value]))));
 const dict=out.context.obj({...(s.explicitType?{Type:PDFName.of('XObject')}:{}),Subtype:PDFName.of('Form'),...(s.formType!==undefined?{FormType:s.formType}:{}),BBox:s.bbox,...(s.matrix?{Matrix:s.matrix}:{}),Resources:{ExtGState:states,...(s.procSet?{ProcSet:s.procSet.map(v=>PDFName.of(v))}:{})},...(s.group?{Group:{Type:PDFName.of('Group'),S:PDFName.of('Transparency'),...s.group}}:{}),...(s.filter?{Filter:PDFName.of(s.filter)}:{}),Length:s.bytes.length});
 return out.context.register(PDFRawStream.of(dict,new Uint8Array(s.bytes)));
}

export function hasNativeFormSource(document:PDFDocument):boolean {
 for(const [i,page] of document.getPages().entries()){
  const objects=page.node.Resources()?.lookupMaybe(PDFName.of('XObject'),PDFDict);
  for(const op of originalOperators(originalPageContent(document,i+1,true)))if(op.word==='Do'){
   const name=op.args[0];if(op.args.length!==1||!name||typeof name!=='object'||!('name'in name))return fail('Do operands');
   const ref=objects?.get(PDFName.of(name.name)),stream=ref&&document.context.lookup(ref);
   if(stream instanceof PDFRawStream&&stream.dict.lookupMaybe(PDFName.of('Subtype'),PDFName)?.decodeText()==='Form')return true;
  }
 }
 return false;
}

/** Decode only the freshly installed, closed native leaf. The page compiler
 * compares this complete sequence with the actual original invocation, retaining
 * the original page's indices for all subsequent text and paint ownership. */
export async function decodedNativeVectorForm(handle:NativeVectorForm){
 const d=await PDFDocument.create(),p=d.addPage([1000,1000]),ref=installNativeVectorForm(d,handle);
 p.node.set(PDFName.of('Resources'),d.context.obj({XObject:{NativeLeaf:ref}}));p.node.set(PDFName.of('Contents'),d.context.register(d.context.stream('/NativeLeaf Do')));
 const task=getDocument({...localPdfDecoderOptions(),data:new Uint8Array(await d.save()),verbosity:0,stopAtErrors:true});
 try{return await(await(await task.promise).getPage(1)).getOperatorList();}finally{await task.destroy();}
}

export function assertNativeFormInvocation(actual:{fnArray:number[];argsArray:unknown[]},expected:{fnArray:number[];argsArray:unknown[]},start:number):number {
 const end=start+expected.fnArray.length-1;
 if(!Number.isInteger(start)||start<0||expected.fnArray.length<2||expected.fnArray.length>8192||actual.fnArray.length!==actual.argsArray.length||expected.fnArray.length!==expected.argsArray.length||end>=actual.fnArray.length||canonicalJson(actual.fnArray.slice(start,end+1))!==canonicalJson(expected.fnArray)||canonicalJson(actual.argsArray.slice(start,end+1))!==canonicalJson(expected.argsArray))return fail('complete native Form/group decoded correspondence');
 return end;
}
