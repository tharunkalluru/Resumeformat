import JSZip from 'jszip';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import 'fake-indexeddb/auto';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {PDFDocument,PDFName,PDFDict,PDFArray,PDFRef,PDFRawStream,type PDFObject} from 'pdf-lib';
import {authoredScopedColorSource} from './scoped-color-test-fixture';
import {sourceIccProfile,originalIccSpaces} from './pdf-icc';
import {preflightPdfImages} from './pdf-image-preflight';
import {originalOperators} from './pdf-image-trace';
import {importResume} from './index';
import {makeProject,sha256Sync} from '../core/model';
import {validateProject} from '../core/schema';
import {setFontLoader} from '../layout/fonts';
import {renderProjectDocument} from '../render/pdf';
import {saveProject,backupProject,restoreProject,backupResumeGroup,restoreGroup} from '../storage/projects';
import {packScopedMetadata,unpackScopedMetadata} from '../core/source-scoped-codec';
import {packRecordMetadata,unpackRecordMetadata} from '../core/project-record-codec';
let restore:()=>void;
beforeAll(async()=>{Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});restore=setFontLoader(async f=>new Uint8Array(await readFile(resolve('public/fonts',f))));const {GlobalWorkerOptions}=await import('pdfjs-dist/legacy/build/pdf.mjs');await import('./pdf');GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});afterAll(()=>restore?.());
const source=async()=>{const fixture=await authoredScopedColorSource(),pdf=await PDFDocument.load(fixture.bytes),page=pdf.getPages()[0],resources=page.node.Resources()!,spaces=resources.lookup(PDFName.of('ColorSpace'),PDFDict),icc=spaces.lookup(PDFName.of('OwnedRGB'),PDFArray);return{fixture,pdf,page,resources,spaces,icc};};
const content=(pdf:PDFDocument,text:string)=>pdf.getPages()[0].node.set(PDFName.of('Contents'),pdf.context.register(pdf.context.flateStream(text)));
const bytes=(pdf:PDFDocument)=>pdf.save().then(b=>new Uint8Array(b));
const wrapper=(pdf:PDFDocument,kind:string,base:PDFObject)=>pdf.context.obj(kind==='Indexed'||kind==='I'?[PDFName.of(kind),base,0,'lookup']:kind==='Pattern'?[PDFName.of(kind),base]:[PDFName.of(kind),kind==='DeviceN'?[PDFName.of('Tone')]:PDFName.of('Tone'),base,{FunctionType:2,Domain:[0,1],C0:[0,0,0],C1:[1,1,1],N:1}]);
const stripped=(project:ReturnType<typeof makeProject>,raw:Uint8Array)=>{const p=structuredClone(project);p.source.bytes=raw;p.source.sha256=sha256Sync(raw);p.source.format='docx';delete p.template.sourceColorProfile;delete p.template.sourceScopedPages;delete p.template.sourceImageContract;delete p.template.sourceFonts;p.template.importerVersion='folio-import-v11';for(const page of p.template.pages)for(const r of page.regions){if('sourceScopedPaint'in r)delete r.sourceScopedPaint;if(r.kind==='text'){delete r.sourceLayout;delete r.style.sourceFontId;}}return validateProject(p);};

describe('bounded selected terminal color classification',()=>{
 it.each(['head','resource','base'] as const)('uses exactly one fetch for %s references before terminal classification',async role=>{
  for(const terminal of ['icc','name','array'] as const)for(const hops of [0,1,2]){
   const {pdf,spaces,icc,resources}=await source();let value:PDFObject=role==='head'?PDFName.of(terminal==='icc'?'ICCBased':'DeviceRGB'):terminal==='icc'?icc:terminal==='name'?PDFName.of('DeviceRGB'):pdf.context.obj([PDFName.of('DeviceRGB')]);
   for(let i=0;i<hops;i++)value=pdf.context.register(value);
   if(role==='head')value=terminal==='icc'?pdf.context.obj([value,icc.get(1)]):pdf.context.obj([value]);
   if(role==='base')value=wrapper(pdf,'Pattern',value);
   spaces.set(PDFName.of('Probe'),value);
   const run=()=>originalIccSpaces(pdf,resources,'0'.repeat(64),originalOperators('/Probe cs'));
   if(hops===2||role==='base'&&terminal==='icc')expect(run).toThrowError(expect.objectContaining({code:'PDF_ICC_PROOF'}));
   else expect(run().size).toBe(terminal==='icc'?1:0);
  }
 });
 it.each(['head','resource','base'] as const)('rejects extra %s refs before profile decoding and in invoked Form metadata',async role=>{
  const {pdf,page,spaces,icc,resources}=await source();let value:PDFObject=pdf.context.register(pdf.context.register(role==='head'?PDFName.of('ICCBased'):icc));
  if(role==='head')value=pdf.context.obj([value,icc.get(1)]);if(role==='base')value=wrapper(pdf,'Indexed',value);spaces.set(PDFName.of('Probe'),value);
  const stream=pdf.context.lookup(icc.get(1)) as PDFRawStream;let reads=0;const saved=stream.contents;Object.defineProperty(stream,'contents',{configurable:true,get(){reads++;throw new Error('profile decode sentinel');}});
  expect(()=>originalIccSpaces(pdf,resources,'0'.repeat(64),originalOperators('/Probe cs'))).toThrowError(expect.objectContaining({code:'PDF_ICC_PROOF'}));expect(reads).toBe(0);Object.defineProperty(stream,'contents',{configurable:true,value:saved});
  const form=pdf.context.register(pdf.context.stream(new Uint8Array([1,2,3]),{Type:'XObject',Subtype:'Form',BBox:[0,0,10,10],Resources:resources,Filter:'Unsupported'}));page.node.set(PDFName.of('Resources'),pdf.context.obj({XObject:{Form:form}}));content(pdf,'/DeviceRGB cs');expect(await sourceIccProfile(await bytes(pdf))).toBeUndefined();content(pdf,'/Form Do');await expect(sourceIccProfile(await bytes(pdf))).rejects.toMatchObject({code:'PDF_ICC_PROOF'});
 });
 it.each(['Indexed','I','Pattern','Separation','DeviceN'])('checks the single-fetch boundary of every %s semantic base',async kind=>{
  for(const asArray of [false,true])for(const hops of [1,2]){const {pdf,spaces,resources}=await source();let base:PDFObject=asArray?pdf.context.obj([PDFName.of('DeviceRGB')]):PDFName.of('DeviceRGB');for(let i=0;i<hops;i++)base=pdf.context.register(base);spaces.set(PDFName.of('Probe'),wrapper(pdf,kind,base));const run=()=>originalIccSpaces(pdf,resources,'0'.repeat(64),originalOperators('/Probe cs'));if(hops===1)expect(run().size).toBe(0);else expect(run).toThrowError(expect.objectContaining({code:'PDF_ICC_PROOF'}));}
 });
 it.each(['head','resource','base'] as const)('does not establish a nonICC %s reference chain inside invoked Forms',async role=>{
  const {pdf,page,spaces,resources}=await source();let value:PDFObject=pdf.context.register(pdf.context.register(PDFName.of('DeviceRGB')));if(role==='head')value=pdf.context.obj([value]);if(role==='base')value=wrapper(pdf,'Pattern',value);spaces.set(PDFName.of('Probe'),value);const form=pdf.context.register(pdf.context.stream(new Uint8Array([1]),{Type:'XObject',Subtype:'Form',BBox:[0,0,10,10],Resources:resources,Filter:'Unsupported'}));page.node.set(PDFName.of('Resources'),pdf.context.obj({XObject:{Form:form}}));content(pdf,'/Form Do');await expect(sourceIccProfile(await bytes(pdf))).rejects.toMatchObject({code:'PDF_ICC_PROOF'});
 });
 it('retains direct ICC identity, including an indirect color array',async()=>{const {pdf,spaces,icc,fixture}=await source();spaces.set(PDFName.of('OwnedRGB'),pdf.context.register(icc));const result=await sourceIccProfile(await bytes(pdf));expect(result?.sha256).toBe(sha256Sync(fixture.profile));expect(result?.pdfProfileRef).toBe(fixture.profileRef);});
 it.each(['DeviceRGB','DeviceGray','DeviceCMYK','Pattern','G','RGB','CMYK','DeviceRGBA'])('gives built-in %s precedence over a shadow ICC declaration',async name=>{const {pdf,spaces,icc}=await source();spaces.set(PDFName.of(name),icc);content(pdf,`/${name} cs /${name} CS`);const raw=await bytes(pdf);expect(await sourceIccProfile(raw)).toBeUndefined();await expect(preflightPdfImages(raw)).resolves.toBeUndefined();});
 it.each(['DeviceRGB','CalRGB','CalGray','Lab','Pattern','Indexed','I','Separation','DeviceN'])('preserves established non-ICC terminal %s through a name alias',async kind=>{
  const {pdf,spaces}=await source();let terminal:PDFObject=PDFName.of('DeviceRGB');if(['CalRGB','CalGray','Lab'].includes(kind))terminal=pdf.context.obj([PDFName.of(kind),{WhitePoint:[1,1,1],Unused:[PDFName.of('ICCBased'),PDFRef.of(999)]}]);else if(kind!=='DeviceRGB')terminal=wrapper(pdf,kind,PDFName.of('DeviceRGB'));
  spaces.set(PDFName.of('Plain'),PDFName.of('Terminal'));spaces.set(PDFName.of('Terminal'),terminal as PDFArray);content(pdf,'/Plain cs /Plain CS');const raw=await bytes(pdf);expect(await sourceIccProfile(raw)).toBeUndefined();await expect(preflightPdfImages(raw)).resolves.toBeUndefined();
 });
 it.each(['name','nameRef','refChain'])('refuses selected ICC hidden by an unsupported %s alias without decoding it',async mode=>{const {pdf,spaces,icc}=await source();if(mode==='name')spaces.set(PDFName.of('Alias'),PDFName.of('OwnedRGB'));else if(mode==='nameRef')spaces.set(PDFName.of('Alias'),pdf.context.register(PDFName.of('OwnedRGB')));else spaces.set(PDFName.of('Alias'),pdf.context.register(pdf.context.register(icc)));content(pdf,'.1 .2 .3 rg 0 0 10 10 re f /Alias cs');const raw=await bytes(pdf);await expect(sourceIccProfile(raw)).rejects.toMatchObject({code:'PDF_ICC_PROOF'});await expect(preflightPdfImages(raw)).rejects.toMatchObject({code:'PDF_ICC_PROOF'});});
 it.each(['Indexed','I','Pattern','Separation','DeviceN'])('refuses ICC in selected %s semantic base without wrapper replay',async kind=>{const {pdf,spaces,icc}=await source();spaces.set(PDFName.of('Wrapped'),wrapper(pdf,kind,icc));content(pdf,'.2 g 0 0 10 10 re f /Wrapped cs');const raw=await bytes(pdf);await expect(sourceIccProfile(raw)).rejects.toMatchObject({code:'PDF_ICC_PROOF'});await expect(preflightPdfImages(raw)).rejects.toMatchObject({code:'PDF_ICC_PROOF'});});
 it('follows nested semantic bases, name and indirect references to detect ICC',async()=>{const {pdf,spaces,icc}=await source();spaces.set(PDFName.of('Alternate'),pdf.context.register(wrapper(pdf,'Separation',icc)));spaces.set(PDFName.of('Wrapped'),wrapper(pdf,'Indexed',wrapper(pdf,'Pattern',PDFName.of('Alternate'))));content(pdf,'/Wrapped CS');await expect(sourceIccProfile(await bytes(pdf))).rejects.toMatchObject({code:'PDF_ICC_PROOF'});});
 it('refuses aliased ICC without touching its original stream bytes',async()=>{
  const {pdf,spaces,icc,resources}=await source(),stream=pdf.context.lookup(icc.get(1)) as PDFRawStream;spaces.set(PDFName.of('Alias'),PDFName.of('OwnedRGB'));let reads=0;Object.defineProperty(stream,'contents',{configurable:true,get(){reads++;throw new Error('Authored sentinel: profile bytes must remain untouched');}});
  expect(()=>originalIccSpaces(pdf,resources,'0'.repeat(64),originalOperators('/Alias cs'))).toThrowError(expect.objectContaining({code:'PDF_ICC_PROOF'}));expect(reads).toBe(0);
 });
 it('does not traverse or decode never-selected unsupported declarations',async()=>{const {pdf,spaces}=await source();spaces.set(PDFName.of('Loop'),PDFName.of('Loop'));spaces.set(PDFName.of('Unknown'),PDFName.of('NotDefined'));content(pdf,'/DeviceRGB cs .1 .2 .3 sc 0 0 10 10 re f');expect(await sourceIccProfile(await bytes(pdf))).toBeUndefined();});
 it.each(['nameCycle','refCycle','missing','unknownArray','deep'])('refuses unresolved selected class %s',async mode=>{
  const {pdf,spaces}=await source();if(mode==='nameCycle'){spaces.set(PDFName.of('A'),PDFName.of('B'));spaces.set(PDFName.of('B'),PDFName.of('A'));}else if(mode==='refCycle'){const a=pdf.context.nextRef(),b=pdf.context.nextRef();pdf.context.assign(a,b);pdf.context.assign(b,a);spaces.set(PDFName.of('A'),a);}else if(mode==='missing')spaces.set(PDFName.of('A'),PDFName.of('Missing'));else if(mode==='unknownArray')spaces.set(PDFName.of('A'),pdf.context.obj([PDFName.of('Unestablished'),PDFName.of('DeviceRGB')]));else{let value:PDFObject=PDFName.of('DeviceRGB');for(let i=0;i<33;i++)value=wrapper(pdf,'Pattern',value);spaces.set(PDFName.of('A'),value as PDFArray);}
  expect(()=>originalIccSpaces(pdf,pdf.getPages()[0].node.Resources()!,'0'.repeat(64),originalOperators('0 g 0 0 10 10 re f /A cs'))).toThrowError(expect.objectContaining({code:'PDF_ICC_PROOF'}));
 });
 it('refuses an unknown selection even with no ColorSpace resources after ordinary paint',async()=>{const {pdf,resources}=await source();resources.delete(PDFName.of('ColorSpace'));content(pdf,'0 g 0 0 10 10 re f /Missing cs');await expect(sourceIccProfile(await bytes(pdf))).rejects.toMatchObject({code:'PDF_ICC_PROOF'});});
 it('bounds total selected traversal work and accepts the in-budget counterpart',async()=>{
  for(const count of [30,32]){const {pdf,resources}=await source(),spaces=pdf.context.obj({});for(let i=0;i<count;i++){let value:PDFObject=PDFName.of('DeviceRGB');for(let j=0;j<31;j++)value=wrapper(pdf,'Pattern',value);spaces.set(PDFName.of(`C${i}`),value as PDFArray);}resources.set(PDFName.of('ColorSpace'),spaces);const ops=originalOperators(Array.from({length:count},(_,i)=>`/C${i} cs`).join(' '));if(count===30)expect(originalIccSpaces(pdf,resources,'0'.repeat(64),ops).size).toBe(0);else expect(()=>originalIccSpaces(pdf,resources,'0'.repeat(64),ops)).toThrowError(expect.objectContaining({code:'PDF_ICC_PROOF'}));}
 });
 it.each(['Indexed','I','Pattern','Separation','DeviceN'])('refuses an invoked Form with inline %s ICC base without inflating its stream',async kind=>{
  const {pdf,page,icc}=await source(),formResources=pdf.context.obj({ColorSpace:{Wrapped:wrapper(pdf,kind,icc)}}),form=pdf.context.register(pdf.context.stream(new Uint8Array([1,2,3]),{Type:'XObject',Subtype:'Form',BBox:[0,0,10,10],Resources:formResources,Filter:'Unsupported'}));page.node.set(PDFName.of('Resources'),pdf.context.obj({XObject:{Form:form}}));content(pdf,'/Form Do');await expect(sourceIccProfile(await bytes(pdf))).rejects.toMatchObject({code:'PDF_ICC_PROOF'});
 });
 it('detects nested invoked Form resource wrappers, but ignores uninvoked Forms',async()=>{
  const {pdf,page,icc}=await source(),inner=pdf.context.register(pdf.context.stream(new Uint8Array([1]),{Type:'XObject',Subtype:'Form',BBox:[0,0,10,10],Resources:{ColorSpace:{Nested:wrapper(pdf,'Indexed',icc)}}})),outer=pdf.context.register(pdf.context.stream(new Uint8Array([2]),{Type:'XObject',Subtype:'Form',BBox:[0,0,10,10],Resources:{XObject:{Inner:inner}}}));page.node.set(PDFName.of('Resources'),pdf.context.obj({XObject:{Outer:outer}}));content(pdf,'/DeviceRGB cs');expect(await sourceIccProfile(await bytes(pdf))).toBeUndefined();content(pdf,'/Outer Do');await expect(sourceIccProfile(await bytes(pdf))).rejects.toMatchObject({code:'PDF_ICC_PROOF'});
 });
 it('preserves visited-reference termination and the Form depth bound',async()=>{
  const {pdf,page}=await source(),ref=pdf.context.nextRef(),resources=pdf.context.obj({XObject:{Self:ref},ColorSpace:{Plain:PDFName.of('DeviceRGB')}});pdf.context.assign(ref,pdf.context.stream(new Uint8Array([0]),{Type:'XObject',Subtype:'Form',BBox:[0,0,10,10],Resources:resources}));page.node.set(PDFName.of('Resources'),pdf.context.obj({XObject:{Form:ref}}));content(pdf,'/Form Do');expect(await sourceIccProfile(await bytes(pdf))).toBeUndefined();
  let nested=ref;for(let i=0;i<33;i++)nested=pdf.context.register(pdf.context.stream(new Uint8Array([0]),{Type:'XObject',Subtype:'Form',BBox:[0,0,10,10],Resources:{XObject:{Next:nested}}}));page.node.set(PDFName.of('Resources'),pdf.context.obj({XObject:{Form:nested}}));await expect(sourceIccProfile(await bytes(pdf))).rejects.toMatchObject({code:'PDF_ICC_PROOF'});
 });
 it('enforces combined metadata work across an invoked Form resource graph',async()=>{
  const {pdf,page}=await source(),objects=pdf.context.obj({});for(let i=0;i<400;i++)objects.set(PDFName.of(`F${i}`),pdf.context.register(pdf.context.stream(new Uint8Array([0]),{Type:'XObject',Subtype:'Form',BBox:[0,0,10,10],Resources:{ColorSpace:{Plain:PDFName.of('DeviceRGB')}}})));const outer=pdf.context.register(pdf.context.stream(new Uint8Array([0]),{Type:'XObject',Subtype:'Form',BBox:[0,0,10,10],Resources:{XObject:objects}}));page.node.set(PDFName.of('Resources'),pdf.context.obj({XObject:{Outer:outer}}));content(pdf,'/Outer Do');await expect(sourceIccProfile(await bytes(pdf))).rejects.toMatchObject({code:'PDF_ICC_PROOF'});
 });
 it.each(['alias','wrapper','extraRef'])('rejects coherent %s source deletion and Word-label graft at baseline/current/save/single/group restore',async mode=>{
  const {fixture,pdf,spaces}=await source(),project=makeProject(await importResume(new File([fixture.bytes],'authored.pdf',{type:'application/pdf'})));spaces.set(PDFName.of('Alias'),mode==='alias'?PDFName.of('OwnedRGB'):mode==='extraRef'?pdf.context.register(pdf.context.register(PDFName.of('DeviceRGB'))):wrapper(pdf,'Pattern',PDFName.of('OwnedRGB')));content(pdf,'0 g 0 0 10 10 re f /Alias cs');const raw=await bytes(pdf),changed=stripped(project,raw);await expect(renderProjectDocument(changed,'baselinePreview')).rejects.toMatchObject({code:'PDF_ICC_PROOF'});await expect(renderProjectDocument(changed,'current')).rejects.toMatchObject({code:'PDF_ICC_PROOF'});await expect(saveProject(changed)).rejects.toMatchObject({code:'PDF_ICC_PROOF'});
  for(const group of [false,true]){const backup=group?await backupResumeGroup([project]):await backupProject(project),zip=await JSZip.loadAsync(await backup.arrayBuffer()),prefix=group?'projects/0/':'',metadataPath=prefix+'project.json',metadata=unpackScopedMetadata(unpackRecordMetadata(JSON.parse(await zip.file(metadataPath)!.async('string')))) as any;const replacement=stripped({...metadata,source:{...metadata.source,bytes:project.source.bytes},assets:[]} as typeof project,raw) as any;replacement.source.bytes=undefined;zip.file(metadataPath,JSON.stringify(packRecordMetadata(packScopedMetadata(replacement))));zip.file(prefix+'source.docx',raw);zip.remove(prefix+'source.pdf');for(const name of Object.keys(zip.files))if(name.startsWith(prefix+'fonts/')||name===prefix+'colors/0.icc')zip.remove(name);const manifest=JSON.parse(await zip.file('manifest.json')!.async('string'));manifest.files=[];for(const name of Object.keys(zip.files).filter(n=>n!=='manifest.json'&&!zip.files[n].dir)){const data=new Uint8Array(await zip.file(name)!.async('uint8array'));manifest.files.push({path:name,size:data.length,sha256:sha256Sync(data)});}zip.file('manifest.json',JSON.stringify(manifest));const archive=new File([new Uint8Array(await zip.generateAsync({type:'uint8array'}))],'coherent.folio');await expect(group?restoreGroup(archive):restoreProject(archive)).rejects.toMatchObject({code:'PDF_ICC_PROOF'});}
 });
});
