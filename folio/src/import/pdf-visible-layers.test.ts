import {describe,expect,it} from 'vitest';
import {PDFArray,PDFDict,PDFDocument,PDFHexString,PDFName,PDFRef,PDFString} from 'pdf-lib';
import {captureVisibleLayers,installVisibleLayers,proveVisibleLayerProperty,type VisibleLayersHandle} from './pdf-visible-layers';

const key=PDFName.of;
async function fixture(count=1){
 const document=await PDFDocument.create(),context=document.context,page=document.addPage([612,792]);
 const intent=context.register(context.obj([key('View'),key('Design')])),usage=context.register(context.obj({CreatorInfo:{Creator:PDFString.of('Fictional artwork author'),Subtype:'Artwork'},View:{ViewState:'ON'},Print:{PrintState:'ON',Subtype:'Artwork'},Export:{ExportState:'ON'}}));
 const groups=Array.from({length:count},(_,i)=>context.register(context.obj({Type:'OCG',Name:PDFString.of(`Fictional layer ${i}`),Intent:intent,Usage:usage})));
 const order=context.register(context.obj([PDFString.of('Fictional section'),...groups]));
 const configuration=context.obj({ON:groups,Order:order,RBGroups:[]}),catalog=context.obj({OCGs:groups,D:configuration}),properties=context.obj({Layer:groups[0],Alias:groups[0]}),resources=context.obj({Properties:properties});
 document.catalog.set(key('OCProperties'),catalog);page.node.set(key('Resources'),resources);
 return {document,context,page,intent,usage,groups,order,configuration,catalog,properties,resources};
}
const refuses=(run:()=>unknown)=>expect(run).toThrow();

describe('immutable initially visible optional layer ownership',()=>{
 it('returns no handle for a document without optional content',async()=>{
  const document=await PDFDocument.create();document.addPage([200,200]);expect(captureVisibleLayers(document)).toBeUndefined();
 });

 it('captures the explicit all-visible default and binds only actual page properties',async()=>{
  const f=await fixture(),before=f.catalog.toString(),handle=captureVisibleLayers(f.document)!;
  expect(handle.fingerprint).toMatch(/^[a-f0-9]{64}$/);expect(Object.isFrozen(handle)).toBe(true);expect(proveVisibleLayerProperty(handle,f.resources,'Layer')).toBe(f.groups[0].toString());expect(proveVisibleLayerProperty(handle,f.resources,'Alias')).toBe(f.groups[0].toString());expect(f.catalog.toString()).toBe(before);
 });

 it('preserves closed indirect metadata and shared group references on fresh output',async()=>{
  const f=await fixture(2),handle=captureVisibleLayers(f.document)!,out=await PDFDocument.create(),map=installVisibleLayers(out,handle),oc=out.catalog.lookup(key('OCProperties'),PDFDict),groups=oc.lookup(key('OCGs'),PDFArray),d=oc.lookup(key('D'),PDFDict),on=d.lookup(key('ON'),PDFArray);
  expect(map.size).toBe(2);expect(groups.asArray().map(v=>v.toString())).toEqual([...map.values()].map(v=>v.toString()));expect(on.asArray().map(v=>v.toString())).toEqual(groups.asArray().map(v=>v.toString()));expect(d.get(key('Order'))).toBeInstanceOf(PDFRef);expect(d.lookup(key('RBGroups'),PDFArray).size()).toBe(0);
  const a=out.context.lookup(map.get(f.groups[0].toString())!,PDFDict),b=out.context.lookup(map.get(f.groups[1].toString())!,PDFDict);expect(a.get(key('Intent'))).toBeInstanceOf(PDFRef);expect(a.get(key('Intent'))!.toString()).toBe(b.get(key('Intent'))!.toString());expect(a.get(key('Usage'))!.toString()).toBe(b.get(key('Usage'))!.toString());expect(a.lookup(key('Name'),PDFString).decodeText()).toBe('Fictional layer 0');
  expect(a.lookup(key('Intent'),PDFArray).asArray().map(v=>v.toString())).toEqual(['/View','/Design']);const usage=a.lookup(key('Usage'),PDFDict);expect(usage.lookup(key('CreatorInfo'),PDFDict).lookup(key('Creator'),PDFString).asString()).toBe('Fictional artwork author');for(const event of ['View','Print','Export'])expect(usage.lookup(key(event),PDFDict).lookup(key(event+'State'),PDFName).decodeText()).toBe('ON');
 });

 it('proves declared properties in reachable Form resources without granting foreign resource identity',async()=>{
  const f=await fixture(),nested=f.context.obj({Properties:{Nested:f.groups[0]}}),form=f.context.register(f.context.stream(new TextEncoder().encode('q Q'),{Type:'XObject',Subtype:'Form',BBox:[0,0,10,10],Resources:nested}));f.resources.set(key('XObject'),f.context.obj({F:form}));
  const handle=captureVisibleLayers(f.document)!;expect(proveVisibleLayerProperty(handle,nested,'Nested')).toBe(f.groups[0].toString());const fake=f.context.obj({Properties:f.properties});refuses(()=>proveVisibleLayerProperty(handle,fake,'Layer'));refuses(()=>proveVisibleLayerProperty(handle,f.resources,'Unknown'));
  const other=await fixture();refuses(()=>proveVisibleLayerProperty(handle,other.resources,'Layer'));
 });

 it('refuses cloned or forged handles even when their public fingerprints match',async()=>{
  const f=await fixture(),handle=captureVisibleLayers(f.document)!,fake={...handle} as VisibleLayersHandle,out=await PDFDocument.create();
  refuses(()=>proveVisibleLayerProperty(fake,f.resources,'Layer'));refuses(()=>installVisibleLayers(out,fake));expect(out.catalog.has(key('OCProperties'))).toBe(false);
 });

 it('rejects source configuration, usage and property mutations after capture',async()=>{
  for(const kind of ['configuration','usage','properties','replacement']){
   const f=await fixture(2),handle=captureVisibleLayers(f.document)!,out=await PDFDocument.create();
   if(kind==='configuration')f.configuration.set(key('BaseState'),key('OFF'));if(kind==='usage')f.context.lookup(f.usage,PDFDict).set(key('View'),f.context.obj({ViewState:'OFF'}));if(kind==='properties')f.properties.set(key('Layer'),f.groups[1]);if(kind==='replacement')f.page.node.set(key('Resources'),f.context.obj({Properties:f.properties}));
   refuses(()=>proveVisibleLayerProperty(handle,f.resources,'Layer'));refuses(()=>installVisibleLayers(out,handle));expect(out.catalog.has(key('OCProperties'))).toBe(false);
  }
 });

 it('rejects replacement of captured indirect objects with lookalike metadata',async()=>{
  const f=await fixture(),handle=captureVisibleLayers(f.document)!;f.context.assign(f.intent,f.context.obj([key('View'),key('Design')]));refuses(()=>proveVisibleLayerProperty(handle,f.resources,'Layer'));
 });

 it('requires registered unique groups and refuses OCMD or direct property substitutions',async()=>{
  for(const kind of ['unknown','membership','direct','duplicate']){
   const f=await fixture();
   if(kind==='unknown')f.properties.set(key('Layer'),f.context.register(f.context.obj({Type:'OCG',Name:PDFString.of('Unregistered')})));if(kind==='membership')f.context.lookup(f.groups[0],PDFDict).set(key('Type'),key('OCMD'));if(kind==='direct')f.properties.set(key('Layer'),f.context.lookup(f.groups[0],PDFDict));if(kind==='duplicate')f.catalog.set(key('OCGs'),f.context.obj([f.groups[0],f.groups[0]]));refuses(()=>captureVisibleLayers(f.document));
  }
 });

 it('rejects hidden states, alternate configurations, usage applications and radio toggles',async()=>{
  for(const kind of ['base-off','base-unchanged','off','empty-off','configs','as','radio','design-intent']){
   const f=await fixture();
   if(kind==='base-off')f.configuration.set(key('BaseState'),key('OFF'));if(kind==='base-unchanged')f.configuration.set(key('BaseState'),key('Unchanged'));if(kind==='off')f.configuration.set(key('OFF'),f.context.obj(f.groups));if(kind==='empty-off')f.configuration.set(key('OFF'),f.context.obj([]));if(kind==='configs')f.catalog.set(key('Configs'),f.context.obj([]));if(kind==='as')f.configuration.set(key('AS'),f.context.obj([]));if(kind==='radio')f.configuration.set(key('RBGroups'),f.context.obj([f.groups]));if(kind==='design-intent')f.configuration.set(key('Intent'),key('Design'));refuses(()=>captureVisibleLayers(f.document));
  }
 });

 it('requires visible View, Print and Export usage states and rejects conditional visibility metadata',async()=>{
  for(const field of ['View','Print','Export']){const f=await fixture();f.context.lookup(f.usage,PDFDict).set(key(field),f.context.obj({[field+'State']:'OFF'}));refuses(()=>captureVisibleLayers(f.document));}
  for(const field of ['Zoom','Language','User','PageElement']){const f=await fixture();f.context.lookup(f.usage,PDFDict).set(key(field),f.context.obj({}));refuses(()=>captureVisibleLayers(f.document));}
  const f=await fixture();f.context.lookup(f.usage,PDFDict).lookup(key('CreatorInfo'),PDFDict).set(key('S'),key('JavaScript'));refuses(()=>captureVisibleLayers(f.document));
 });

 it('admits default or explicit View intent and rejects absent-View or duplicate intents',async()=>{
  for(const intent of [undefined,key('View')]){const f=await fixture();const group=f.context.lookup(f.groups[0],PDFDict);if(intent)group.set(key('Intent'),intent);else group.delete(key('Intent'));expect(captureVisibleLayers(f.document)).toBeDefined();}
  for(const values of [['Design'],['View','View'],['View','Unknown'],[]]){const f=await fixture();f.context.assign(f.intent,f.context.obj(values.map(key)));refuses(()=>captureVisibleLayers(f.document));}
 });

 it('closes Order references and bounds cyclic or deeply nested arrays',async()=>{
  const unknown=await fixture();unknown.configuration.set(key('Order'),unknown.context.obj([PDFRef.of(999999)]));refuses(()=>captureVisibleLayers(unknown.document));
  const cyclic=await fixture(),list=cyclic.context.obj([]),ref=cyclic.context.register(list);list.push(ref);cyclic.configuration.set(key('Order'),ref);refuses(()=>captureVisibleLayers(cyclic.document));
  const deep=await fixture();let node:PDFArray=deep.context.obj(deep.groups);for(let i=0;i<20;i++)node=deep.context.obj([node]);deep.configuration.set(key('Order'),node);refuses(()=>captureVisibleLayers(deep.document));
 });

 it('bounds group counts, property aliases and metadata strings without broadening the document',async()=>{
  expect(captureVisibleLayers((await fixture(32)).document)).toBeDefined();refuses(()=>captureVisibleLayers((null as unknown) as PDFDocument));const tooMany=await fixture(33);refuses(()=>captureVisibleLayers(tooMany.document));
  const properties=await fixture();for(let i=0;i<257;i++)properties.properties.set(key('Extra'+i),properties.groups[0]);refuses(()=>captureVisibleLayers(properties.document));
  const text=await fixture();text.context.lookup(text.groups[0],PDFDict).set(key('Name'),PDFString.of('x'.repeat(1025)));refuses(()=>captureVisibleLayers(text.document));
 });

 it('installs once and prevents returned-map mutation from changing cached group ownership',async()=>{
  const f=await fixture(),handle=captureVisibleLayers(f.document)!,out=await PDFDocument.create(),first=installVisibleLayers(out,handle),ref=first.get(f.groups[0].toString())!;first.clear();const second=installVisibleLayers(out,handle);expect(second.size).toBe(1);expect(second.get(f.groups[0].toString())).toBe(ref);expect(out.catalog.lookup(key('OCProperties'),PDFDict).lookup(key('OCGs'),PDFArray).size()).toBe(1);
 });

 it('refuses source output, preexisting output groups, foreign handles and output metadata mutation',async()=>{
  const f=await fixture(),handle=captureVisibleLayers(f.document)!;refuses(()=>installVisibleLayers(f.document,handle));const preexisting=await fixture();refuses(()=>installVisibleLayers(preexisting.document,handle));
  const out=await PDFDocument.create();installVisibleLayers(out,handle);const other=await fixture(),foreign=captureVisibleLayers(other.document)!;refuses(()=>installVisibleLayers(out,foreign));out.catalog.lookup(key('OCProperties'),PDFDict).lookup(key('D'),PDFDict).set(key('BaseState'),key('OFF'));refuses(()=>installVisibleLayers(out,handle));
 });

 it('preserves original literal and hex-string metadata through installation and serialization',async()=>{
  const f=await fixture();f.context.lookup(f.groups[0],PDFDict).set(key('Name'),PDFString.of('Fictional\\(escaped\\) label'));f.context.lookup(f.usage,PDFDict).lookup(key('CreatorInfo'),PDFDict).set(key('Creator'),PDFHexString.of('46696374696f6e616c'));
  const handle=captureVisibleLayers(f.document)!,out=await PDFDocument.create(),map=installVisibleLayers(out,handle),page=out.addPage([612,792]);page.node.set(key('Resources'),out.context.obj({Properties:{Layer:map.get(f.groups[0].toString())!}}));
  const restored=await PDFDocument.load(await out.save({useObjectStreams:false})),fresh=captureVisibleLayers(restored)!;expect(fresh).toBeDefined();const group=restored.catalog.lookup(key('OCProperties'),PDFDict).lookup(key('OCGs'),PDFArray).lookup(0,PDFDict);expect(group.lookup(key('Name'),PDFString).asString()).toBe('Fictional\\(escaped\\) label');expect(group.lookup(key('Usage'),PDFDict).lookup(key('CreatorInfo'),PDFDict).lookup(key('Creator'),PDFHexString).asString()).toBe('46696374696f6e616c');expect(proveVisibleLayerProperty(fresh,restored.getPages()[0].node.Resources()!,'Layer')).toBe(restored.catalog.lookup(key('OCProperties'),PDFDict).lookup(key('OCGs'),PDFArray).get(0).toString());
 });
});
