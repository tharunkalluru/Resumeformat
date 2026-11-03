import {PDFArray,PDFDict,PDFDocument,PDFHexString,PDFName,PDFRawStream,PDFRef,PDFString,type PDFObject} from 'pdf-lib';
import {canonicalJson,hashTextSync,MAX_SOURCE_PAGES} from '../core/model';
import {FolioError} from '../core/errors';

declare const visibleLayersBrand:unique symbol;
export interface VisibleLayersHandle {readonly fingerprint:string;readonly [visibleLayersBrand]:true}
type Node={kind:'name'|'string'|'hex';value:string}|{kind:'array';values:Node[]}|{kind:'dict';entries:[string,Node][]}|{kind:'ref';id:string;value:Node}|{kind:'group';id:string};
type Graph={catalog:Node;groups:Map<string,Node>;references:Map<string,PDFObject>;properties:Map<PDFDict,{dictionary:PDFDict;aliases:Map<string,string>}>;snapshot:string};
type Owner={document:PDFDocument;graph:Graph};
const owners=new WeakMap<VisibleLayersHandle,Owner>(),installed=new WeakMap<PDFDocument,{handle:VisibleLayersHandle;groups:Map<string,PDFRef>;catalogSnapshot:string}>();
const key=PDFName.of;
const fail=():never=>{throw new FolioError('PDF_VISIBLE_LAYERS','The original optional layers have no closed, initially visible ownership proof.');};
const closed=(dictionary:PDFDict,allowed:readonly string[])=>{if(dictionary.keys().some(name=>!allowed.includes(name.decodeText())))fail();};

/** Only the immutable, all-visible default configuration is admitted. No
 * action, membership expression, alternate configuration or general graph copy
 * enters this contract. Source reference identity is retained in the proof. */
function readGraph(document:PDFDocument,includeResources=true):Graph|undefined{
 const raw=document.catalog.get(key('OCProperties'));if(!raw)return;
 const context=document.context,object=context.lookup(raw);if(!(object instanceof PDFDict)||object.context!==context)return fail();
 closed(object,['OCGs','D']);
 const list=object.lookup(key('OCGs'));if(!(list instanceof PDFArray)||!list.size()||list.size()>32)return fail();
 const declared=new Map<string,PDFRef>();for(const value of list.asArray()){if(!(value instanceof PDFRef)||declared.has(value.toString()))return fail();declared.set(value.toString(),value);}
 let work=0,textBytes=0;const active=new Set<string>(),references=new Map<string,PDFObject>();
 const parse=(value:PDFObject|undefined,depth:number,body:(resolved:PDFObject,depth:number)=>Node):Node=>{
  if(!value||depth>16||++work>4096)return fail();
  if(value instanceof PDFRef){const id=value.toString();if(active.has(id))return fail();const resolved=context.lookup(value);if(!resolved)return fail();references.set(id,resolved);active.add(id);const node=body(resolved,depth+1);active.delete(id);return {kind:'ref',id,value:node};}
  return body(value,depth);
 };
 const dict=(value:PDFObject|undefined,depth:number,allowed:readonly string[],field:(name:string,value:PDFObject,depth:number)=>Node):Node=>parse(value,depth,(resolved,d)=>{
  if(!(resolved instanceof PDFDict)||resolved.context!==context)return fail();closed(resolved,allowed);return {kind:'dict',entries:resolved.entries().map(([name,value])=>[name.decodeText(),field(name.decodeText(),value,d+1)])};
 });
 const name=(value:PDFObject|undefined,depth:number,allowed:readonly string[]):Node=>parse(value,depth,resolved=>{
  if(!(resolved instanceof PDFName)||resolved.asBytes().length>128||!allowed.includes(resolved.decodeText()))return fail();return {kind:'name',value:resolved.decodeText()};
 });
 const string=(value:PDFObject|undefined,depth:number):Node=>parse(value,depth,resolved=>{
  if(!(resolved instanceof PDFString||resolved instanceof PDFHexString)||resolved.asString().length>8192)return fail();const bytes=resolved.asBytes();textBytes+=bytes.length;if(!bytes.length||bytes.length>1024||textBytes>65536)return fail();return {kind:resolved instanceof PDFString?'string':'hex',value:resolved.asString()};
 });
 const group=(value:PDFObject,depth:number):Node=>{
  if(depth>16||++work>4096||!(value instanceof PDFRef)||!declared.has(value.toString()))return fail();return {kind:'group',id:value.toString()};
 };
 const array=(value:PDFObject|undefined,depth:number,entry:(value:PDFObject,depth:number)=>Node,max=512):Node=>parse(value,depth,(resolved,d)=>{
  if(!(resolved instanceof PDFArray)||resolved.size()>max)return fail();return {kind:'array',values:resolved.asArray().map(value=>entry(value,d+1))};
 });
 const groupsArray=(value:PDFObject|undefined,depth:number):Node=>{const seen=new Set<string>();return array(value,depth,(value,d)=>{const node=group(value,d);if(node.kind!=='group'||seen.has(node.id))return fail();seen.add(node.id);return node;},32);};
 const intent=(value:PDFObject,depth:number):Node=>{
  const resolved=context.lookup(value);if(resolved instanceof PDFName)return name(value,depth,['View']);
  const seen=new Set<string>();const node=array(value,depth,(value,d)=>{const resolved=context.lookup(value);if(!(resolved instanceof PDFName)||seen.has(resolved.decodeText()))return fail();seen.add(resolved.decodeText());return name(value,d,['View','Design']);},2);if(!seen.has('View'))return fail();return node;
 };
 const order=(value:PDFObject,depth:number):Node=>array(value,depth,(value,d)=>{
  if(value instanceof PDFRef&&declared.has(value.toString()))return group(value,d);
  const resolved=context.lookup(value);if(resolved instanceof PDFArray)return order(value,d);if(resolved instanceof PDFString||resolved instanceof PDFHexString)return string(value,d);return fail();
 });
 const usage=(value:PDFObject,depth:number):Node=>dict(value,depth,['CreatorInfo','View','Print','Export'],(field,value,d)=>{
  if(field==='CreatorInfo')return dict(value,d,['Creator','Subtype'],(name,value,d)=>name==='Creator'?string(value,d):nameValue(value,d,['Artwork']));
  const state=field+'State';return dict(value,d,field==='Print'?[state,'Subtype']:[state],(field,value,d)=>field==='Subtype'?nameValue(value,d,['Artwork','Watermark']):nameValue(value,d,['ON']));
 });
 const nameValue=name;
 const groups=new Map<string,Node>();
 for(const [id,ref]of declared){const node=dict(ref,0,['Type','Name','Intent','Usage'],(field,value,d)=>field==='Type'?name(value,d,['OCG']):field==='Name'?string(value,d):field==='Intent'?intent(value,d):usage(value,d));const resolved=context.lookup(ref);if(!(resolved instanceof PDFDict)||!resolved.has(key('Type'))||!resolved.has(key('Name')))return fail();groups.set(id,node);}
 const catalog=dict(raw,0,['OCGs','D'],(field,value,d)=>field==='OCGs'?groupsArray(value,d):dict(value,d,['Name','Creator','BaseState','ON','Order','RBGroups','Locked','Intent','ListMode'],(field,value,d)=>{
  if(field==='Name'||field==='Creator')return string(value,d);if(field==='BaseState')return name(value,d,['ON']);if(field==='ON'||field==='Locked')return groupsArray(value,d);if(field==='Order')return order(value,d);if(field==='Intent')return intent(value,d);if(field==='ListMode')return name(value,d,['AllPages','VisiblePages']);
  return array(value,d,()=>fail(),0);
 }));
 if(!object.has(key('D')))return fail();
 const properties=new Map<PDFDict,{dictionary:PDFDict;aliases:Map<string,string>}>(),bindings:unknown[]=[];let propertyCount=0,resourceCount=0;
 if(includeResources){const pages=document.getPages();if(!pages.length||pages.length>MAX_SOURCE_PAGES)return fail();const visitedForms=new Set<string>();
  const walk=(resources:PDFDict,path:Set<string>,depth:number,owner:string):void=>{
   if(depth>16||resources.context!==context||++resourceCount>512)return fail();
   const rawProperties=resources.get(key('Properties'));if(rawProperties){const dictionary=context.lookup(rawProperties);if(!(dictionary instanceof PDFDict)||dictionary.context!==context)return fail();if(rawProperties instanceof PDFRef)references.set(rawProperties.toString(),dictionary);const aliases=new Map<string,string>();for(const [name,value]of dictionary.entries()){if(++propertyCount>256||name.asBytes().length>128||!(value instanceof PDFRef)||!declared.has(value.toString()))return fail();aliases.set(name.decodeText(),value.toString());}properties.set(resources,{dictionary,aliases});bindings.push([owner,rawProperties instanceof PDFRef?rawProperties.toString():null,[...aliases]]);}
   const objects=resources.lookupMaybe(key('XObject'),PDFDict);if(!objects)return;if(objects.keys().length>256)return fail();for(const [,value]of objects.entries()){const stream=context.lookup(value);if(!(stream instanceof PDFRawStream)||stream.dict.lookupMaybe(key('Subtype'),PDFName)?.decodeText()!=='Form')continue;if(!(value instanceof PDFRef))return fail();const id=value.toString();if(path.has(id))return fail();if(visitedForms.has(id))continue;visitedForms.add(id);const nested=stream.dict.lookupMaybe(key('Resources'),PDFDict)??resources;const next=new Set(path);next.add(id);walk(nested,next,depth+1,'form:'+id);}
  };
  pages.forEach((page,index)=>{const resources=page.node.Resources();if(resources)walk(resources,new Set(),0,'page:'+(index+1));});
 }
 return {catalog,groups,references,properties,snapshot:canonicalJson({catalog,groups:[...groups],bindings})};
}

function owner(handle:VisibleLayersHandle):Owner{
 const saved=owners.get(handle);if(!saved||handle.fingerprint!==hashTextSync(saved.graph.snapshot))return fail();const fresh=readGraph(saved.document);if(!fresh||fresh.snapshot!==saved.graph.snapshot||fresh.properties.size!==saved.graph.properties.size)return fail();
 for(const [id,object]of saved.graph.references){const [number,generation]=id.split(' ');if(saved.document.context.lookup(PDFRef.of(Number(number),Number(generation)))!==object)return fail();}
 for(const [resources,properties]of saved.graph.properties)if(fresh.properties.get(resources)?.dictionary!==properties.dictionary)return fail();return saved;
}

export function captureVisibleLayers(document:PDFDocument):VisibleLayersHandle|undefined{
 const graph=readGraph(document);if(!graph)return;const handle=Object.freeze({fingerprint:hashTextSync(graph.snapshot)}) as VisibleLayersHandle;owners.set(handle,{document,graph});return handle;
}

export function proveVisibleLayerProperty(handle:VisibleLayersHandle,resources:PDFDict,name:string):string{
 const saved=owner(handle);if(resources.context!==saved.document.context)return fail();const id=saved.graph.properties.get(resources)?.aliases.get(name);return id??fail();
}

export function installVisibleLayers(out:PDFDocument,handle:VisibleLayersHandle):Map<string,PDFRef>{
 const saved=owner(handle);if(out===saved.document||out.context===saved.document.context)return fail();const previous=installed.get(out);
 if(previous){if(previous.handle!==handle||readGraph(out,false)?.snapshot!==previous.catalogSnapshot)return fail();return new Map(previous.groups);}
 if(out.catalog.has(key('OCProperties')))return fail();const groups=new Map<string,PDFRef>(),references=new Map<string,PDFRef>();
 for(const id of saved.graph.groups.keys()){const ref=out.context.register(out.context.obj({}));groups.set(id,ref);references.set(id,ref);}
 const emit=(node:Node):PDFObject=>{
  if(node.kind==='name')return key(node.value);if(node.kind==='string')return PDFString.of(node.value);if(node.kind==='hex')return PDFHexString.of(node.value);if(node.kind==='group')return groups.get(node.id)??fail();
  if(node.kind==='ref'){const existing=references.get(node.id);if(existing)return existing;const ref=out.context.register(emit(node.value));references.set(node.id,ref);return ref;}
  if(node.kind==='array')return out.context.obj(node.values.map(emit));if(node.kind!=='dict')return fail();const dictionary=out.context.obj({});for(const [name,value]of node.entries)dictionary.set(key(name),emit(value));return dictionary;
 };
 for(const [id,node]of saved.graph.groups){if(node.kind!=='ref')return fail();out.context.assign(groups.get(id)!,emit(node.value));}
 out.catalog.set(key('OCProperties'),emit(saved.graph.catalog));const snapshot=readGraph(out,false)?.snapshot;if(!snapshot)return fail();installed.set(out,{handle,groups:new Map(groups),catalogSnapshot:snapshot});return new Map(groups);
}
