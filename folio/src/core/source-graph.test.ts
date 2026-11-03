import {retainFictionalLegacySource} from '../import/legacy-source.fixture';
import 'fake-indexeddb/auto';
import {beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {openDB} from 'idb';
import JSZip from 'jszip';
import {PDFDocument,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {fictionalSourceTemplate} from './sourceFontTestFixture';
import {fictionalCffTemplate} from './sourceCffTestFixture';
import {fixtureProject} from './testFixture';
import {canonicalJson,hashJson,hashTextSync,sha256Sync,type Project,type TextRegion,type LegacySourceTextLayout} from './model';
import {validateProject} from './schema';
import {normalizeFreshSourceTemplate,sourceGlyphAt,sourceGlyphs,sourceOverlapProofs,checkSourceGraphBudget} from './source-graph';
import {buildSourceOverlapManifest,validatedSourceOverlapKeys} from '../layout/source-overlaps';
import {computeLayout} from '../layout/engine';
import {renderDocument,setFontLoader} from '../render/pdf';
import {approveTemplate,editBlock} from './commands';
import {initCareerMemory} from './careerMemory';
import {backupProject,restoreProject,saveProject,loadProjects,loadLibrary,createSavedApplication,backupResumeGroup,restoreGroup,removeGroup,previewGroupRemoval} from '../storage/projects';
let tt:Uint8Array,cff:Uint8Array;
beforeAll(async()=>{tt=new Uint8Array(await readFile(resolve('tests/fixtures/fonts/Carlito-Regular.ttf')));cff=new Uint8Array(await readFile(resolve('public/fonts/Times-Regular.otf')));setFontLoader(async name=>new Uint8Array(await readFile(resolve('public/fonts',name))));});
beforeEach(async()=>{const db=await openDB('folio-local-v1',2,{upgrade(db){if(!db.objectStoreNames.contains('projects'))db.createObjectStore('projects',{keyPath:'id'});if(!db.objectStoreNames.contains('groupState'))db.createObjectStore('groupState',{keyPath:'templateGroupId'});}});await db.clear('projects');await db.clear('groupState');db.close();});
async function legacy(version:1|2|3=1,overlap=false):Promise<Project>{
 const p=await fixtureProject(),f=version===2?fictionalCffTemplate(cff):fictionalSourceTemplate(tt);
 p.template=f.template;p.baseline=f.content;p.draft=structuredClone(f.content);f.asset.sourceSha256=p.source.sha256;f.region.sourceLayout!.sourceSha256=p.source.sha256;
 if(version===3){const old=f.region.sourceLayout!;if(old.version!==1)throw Error();f.region.sourceLayout={...old,version:3,characterSpacing:-.25,editPolicy:'scalarCovered'};const graph=f.region.sourceLayout!;graph.glyphs.forEach((g,i)=>g.x-=.25*i);graph.endX=graph.glyphs.at(-1)!.x+graph.glyphs.at(-1)!.advance;}
 // Prove positive inferred blank advance is retained independently of the width map.
 f.region.sourceLayout!.glyphs[1].inferredGap=true;
 if(overlap){const other=structuredClone(f.region),block=structuredClone(p.baseline.blocks[0]);other.id='neighbor:|region';other.contentId='neighbor-block';other.order=1;block.id=other.contentId;p.template.pages[0].regions.push(other);p.baseline.blocks.push(block);p.draft=structuredClone(p.baseline);p.template.sourceOverlaps=buildSourceOverlapManifest(p.template);}
 if(version!==2){await retainFictionalLegacySource(p);if(overlap)p.template.sourceOverlaps=buildSourceOverlapManifest(p.template);}
 return approveTemplate(initCareerMemory(validateProject(p)),[]);
}
function normalized(p:Project):Project{return validateProject({...structuredClone(p),approval:null,template:normalizeFreshSourceTemplate(p.template,p.source.sha256)});}
function logical(p:Project){return p.template.pages.flatMap(page=>page.regions.filter((r):r is TextRegion=>r.kind==='text'&&!!r.sourceLayout).map(region=>({id:region.id,glyphs:Array.from(sourceGlyphs(region))})));}
function metadata(p:Project){return {...p,source:{...p.source,bytes:undefined},assets:p.assets.map(a=>({...a,bytes:undefined})),template:{...p.template,sourceFonts:p.template.sourceFonts?.map(f=>({...f,bytes:undefined}))},...(p.careerMemory?{careerMemory:{...p.careerMemory,sources:p.careerMemory.sources.map(s=>({...s,bytes:undefined}))}}:{})};}
async function paint(bytes:Uint8Array){const pdf=await PDFDocument.load(bytes);return pdf.context.enumerateIndirectObjects().filter(([,o])=>o instanceof PDFRawStream).map(([,o])=>({dict:(o as PDFRawStream).dict.toString(),data:sha256Sync(decodePDFRawStream(o as PDFRawStream).decode())}));}
describe('lossless bounded source graph representation',()=>{
 it.each([1,2,3] as const)('retains full logical version%s graph, fixed layout, endpoint edits and actual PDF streams',async version=>{
  const old=await legacy(version,version!==1),frozen=structuredClone(old),next=normalized(old);
  expect(logical(next)).toEqual(logical(old));expect(Array.from(sourceOverlapProofs(next.template))).toEqual(Array.from(sourceOverlapProofs(old.template)));expect(validatedSourceOverlapKeys(next.template)).toEqual(validatedSourceOverlapKeys(old.template));
  expect(next.facts).toEqual(old.facts);expect(next.careerMemory).toEqual(old.careerMemory);expect(next.baseline).toEqual(old.baseline);expect(next.template.sourceFonts).toEqual(old.template.sourceFonts);expect(next.template.sourceLinks).toEqual(old.template.sourceLinks);expect(await hashJson(next.template)).not.toBe(old.approval!.layoutHash);
  expect(await computeLayout(next.template,next.draft)).toEqual(await computeLayout(old.template,old.draft));
  const [a,b]=await Promise.all([renderDocument(old.template,old.draft,old.assets),renderDocument(next.template,next.draft,next.assets)]);expect(await paint(b.bytes)).toEqual(await paint(a.bytes));
  for(const anchor of ['start','end'] as const){const oa=structuredClone(old),nb=structuredClone(next);for(const p of [oa,nb]){const region=p.template.pages[0].regions[0] as TextRegion;region.sourceLayout!.anchor=anchor;p.draft.blocks[0].runs=[{text:'a'}];}expect(await computeLayout(nb.template,nb.draft)).toEqual(await computeLayout(oa.template,oa.draft));}
  expect(old).toEqual(frozen);expect(validateProject(old)).toEqual(old);
 });
 it.each(['unknownTag','undefinedTag','missingTag','taggedObjects','untaggedTuples','extraSlot','sparseSlot','namedSlot','symbolSlot','nullGap','undefinedGap','falseGap','badCID','Unicode','surrogate','fontOwner','infiniteX','advance','operator','anchor','baseline','source','policy'])('rejects malformed %s without writing a row',async kind=>{
  const p=normalized(await legacy(3)),r=p.template.pages[0].regions[0] as TextRegion,g=r.sourceLayout! as any,t=g.glyphs[0];
  switch(kind){case'unknownTag':g.glyphEncoding='future';break;case'undefinedTag':g.glyphEncoding=undefined;break;case'missingTag':delete g.glyphEncoding;break;case'taggedObjects':g.glyphs=logical(await legacy(3))[0].glyphs;break;case'untaggedTuples':delete g.glyphEncoding;break;case'extraSlot':t.push(1,2);break;case'sparseSlot':delete t[2];break;case'namedSlot':t.extra=1;break;case'symbolSlot':t[Symbol('extra')]=1;break;case'nullGap':t.push(null);break;case'undefinedGap':t.push(undefined);break;case'falseGap':t.push(false);break;case'badCID':t[0]=999;break;case'Unicode':t[1]='b';break;case'surrogate':t[1]='\ud800';break;case'fontOwner':r.style.sourceFontId='missing';break;case'infiniteX':t[2]=Infinity;break;case'advance':t[3]+=1;break;case'operator':t[4]=.5;break;case'anchor':g.endX+=1;break;case'baseline':g.baselineRunsHash='0'.repeat(64);break;case'source':g.sourceSha256='0'.repeat(64);break;case'policy':g.characterSpacing=-12;break;}
  expect(()=>validateProject(p)).toThrow();if(kind==='symbolSlot'){expect(()=>sourceGlyphAt(r,0)).toThrow();return;}await expect(saveProject(p)).rejects.toThrow();expect(await loadProjects()).toEqual([]);
 });
 it.each(['unknown','missing','source','ordinal','region','hash','extra','sparse','duplicate','reversed','empty','limit'])('rejects malformed overlap %s and retains injective delimiter-bearing IDs',async kind=>{
  const p=normalized(await legacy(2,true)),overlap=p.template.sourceOverlaps as any,pair=overlap.pairs[0];
  switch(kind){case'unknown':overlap.encoding='future';break;case'missing':delete overlap.encoding;break;case'source':overlap.sourceSha256='0'.repeat(64);break;case'ordinal':pair[1]=999;break;case'region':pair[0]='missing';break;case'hash':pair[4]='0'.repeat(64);break;case'extra':pair.push(0);break;case'sparse':delete pair[2];break;case'duplicate':overlap.pairs.push(pair);break;case'reversed':overlap.pairs.push([pair[2],pair[3],pair[0],pair[1],pair[4]]);break;case'empty':overlap.pairs=[];break;case'limit':overlap.pairs=Array.from({length:1001},()=>pair);break;}
  expect(()=>validateProject(p)).toThrow();await expect(saveProject(p)).rejects.toThrow();expect(await loadProjects()).toEqual([]);
 });
 it('bounds aggregate graphs before derived indexes and has no stale decoded owner cache',async()=>{
  const p=normalized(await legacy()),r=p.template.pages[0].regions[0] as TextRegion,initial=sourceGlyphAt(r,0);r.style.sourceFontId='different-owned-id';expect(sourceGlyphAt(r,0).fontId).toBe('different-owned-id');expect(initial.fontId).toBe('owned-font');r.style.sourceFontId=initial.fontId;
  const g=r.sourceLayout!;g.glyphs=Array.from({length:50001},()=>structuredClone(g.glyphs[0])) as typeof g.glyphs;p.template.pages[0].regions.push({...structuredClone(r),id:'other'});expect(()=>checkSourceGraphBudget(p.template)).toThrow();expect(()=>validatedSourceOverlapKeys(p.template)).toThrow();
 });
 it('preserves refusal visibility, original collision witnesses and permits no newly colliding wording',async()=>{
  for(const version of [1,2,3] as const){const p=normalized(await legacy(version));for(const text of ['a\nb','aΩ','a'.repeat(80)]){p.draft.blocks[0].runs=[{text}];const layout=await computeLayout(p.template,p.draft);expect(layout.overflows.length).toBeGreaterThan(0);expect(layout.regions[0].lines[0].runs[0].text).toBe(text);}}
  const old=await legacy(3),r=old.template.pages[0].regions[0] as TextRegion<LegacySourceTextLayout>,g=r.sourceLayout!;if(g.version!==3)throw Error();g.characterSpacing=-5;g.glyphs=Array.from('abc').map((unicode,i)=>{const m=old.template.sourceFonts![0].glyphMap.find(m=>m.unicode===unicode)!;return {fontId:r.style.sourceFontId!,cid:m.cid,unicode,x:40+i*.1,advance:m.pdfWidth*g.fontSize/1000,operatorIndex:1};});old.baseline.blocks[0].runs=[{text:'abc',bold:false,italic:false}];old.draft=structuredClone(old.baseline);g.baselineRunsHash=hashTextSync(canonicalJson(old.baseline.blocks[0].runs));g.endX=g.glyphs.at(-1)!.x+g.glyphs.at(-1)!.advance;old.template.sourceOverlaps=buildSourceOverlapManifest(old.template);const p=normalized(old);expect((await computeLayout(p.template,p.draft)).overflows).toEqual([]);p.draft.blocks[0].runs=[{text:'aaa'}];expect((await computeLayout(p.template,p.draft)).overflows.some(o=>o.code==='collision')).toBe(true);
 });
 it('saves exact tagged graphs, isolates two jobs, retains full snapshots and restores app/group without legacy migration',async()=>{
  const legacyRecord=await legacy(2,true);delete legacyRecord.careerMemory;const p=await approveTemplate(normalized(await legacy(2,true)),[]);await saveProject(legacyRecord);await saveProject(p);
  const a=await createSavedApplication(p,{title:'Job one',company:'',description:'Source-grounded review'}),b=await createSavedApplication(p,{title:'Job two',company:'',description:'Independent application'}),frozenB=structuredClone(b),frozenPrimary=structuredClone(p);
  const edited=editBlock(a,a.draft.blocks[0].id,[{text:'a'}]);await saveProject(edited);const rows=await loadProjects();expect(rows.find(r=>r.id===b.id)).toEqual(frozenB);expect(rows.find(r=>r.id===p.id)).toEqual(frozenPrimary);expect(edited.memorySnapshot).toEqual(a.memorySnapshot);
  const backup=await backupProject(edited),restoredApp=await restoreProject(new File([backup],'application.zip'));expect(restoredApp.template).toEqual(edited.template);expect(restoredApp.memorySnapshot!.evidence).toEqual(edited.memorySnapshot!.evidence);expect(restoredApp.reviewedDraftRevision).toBeNull();
  const restored=await restoreGroup(new File([await backupResumeGroup([p,edited,b])],'group.zip'));expect(restored).toHaveLength(3);for(const row of restored){expect(row.template).toEqual(p.template);expect(row.workspace!.templateGroupId).not.toBe(p.workspace!.templateGroupId);}await removeGroup(restored[0].workspace!.templateGroupId,await previewGroupRemoval(restored[0].workspace!.templateGroupId));expect((await loadProjects()).filter(r=>r.workspace!.templateGroupId===p.workspace!.templateGroupId)).toHaveLength(3);expect((await loadLibrary()).unavailable).toEqual([]);
  const plainLegacy=structuredClone(legacyRecord);delete plainLegacy.careerMemory;const oldBackup=await backupProject(plainLegacy),oldRestored=await restoreProject(new File([oldBackup],'old.zip'));expect(oldRestored.template).toEqual(legacyRecord.template);expect((oldRestored.template.pages[0].regions[0] as TextRegion).sourceLayout!.glyphEncoding).toBeUndefined();
 });
 it.each(['project','application','group'] as const)('refuses rechecksummed corrupt %s backup atomically',async kind=>{
  const p=await approveTemplate(normalized(await legacy(2,true)),[]);if(kind==='project')delete p.careerMemory;const app=await createSavedApplication(p,{title:'',company:'',description:''}),blob=kind==='group'?await backupResumeGroup([p,app]):await backupProject(kind==='application'?app:p),prior=await loadProjects(),zip=await JSZip.loadAsync(await blob.arrayBuffer());
  const target=Object.keys(zip.files).find(path=>path.endsWith('project.json'))!,meta=JSON.parse(await zip.file(target)!.async('string'));meta.template.pages[0].regions[0].sourceLayout.glyphs[0][3]+=1;const data=new TextEncoder().encode(JSON.stringify(meta));
  for(const path of Object.keys(zip.files).filter(path=>path.endsWith('manifest.json'))){const manifest=JSON.parse(await zip.file(path)!.async('string'));for(const entry of manifest.files??[]){if(entry.path==='project.json'||entry.path===target){entry.size=data.length;entry.sha256=sha256Sync(data);}}zip.file(path,JSON.stringify(manifest));}zip.file(target,data);
  const bad=new File([new Uint8Array(await zip.generateAsync({type:'uint8array'})).buffer],'corrupt.zip');await expect(kind==='group'?restoreGroup(bad):restoreProject(bad)).rejects.toThrow();expect(await loadProjects()).toEqual(prior);
 });
 it('keeps the metadata admission guard atomic for an oversized full normalized application',async()=>{
  const p=normalized(await legacy());let seed=17;const dense=()=>Array.from({length:100000},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return String.fromCharCode(33+seed%90)}).join('');
  // This durable boundary fixture really paints its blank in the retained PDF.
  // Derived-gap representation controls above remain separate from admission.
  for(const page of p.template.pages)for(const region of page.regions)if(region.kind==='text'&&region.sourceLayout?.glyphEncoding==='shared-font-tuple-v1')for(const glyph of region.sourceLayout.glyphs)if(glyph.length===6)glyph.pop();
  p.facts=Array.from({length:11},(_,i)=>({id:`large-source-${i}`,kind:'resume' as const,text:dense(),locator:`fictional/source[${i}]`,confirmed:true}));delete p.careerMemory;const resume=await approveTemplate(initCareerMemory(validateProject(p)),[]);await saveProject(resume);const prior=await loadProjects();
  await expect(createSavedApplication(resume,{title:'Too large',company:'',description:''})).rejects.toMatchObject({code:'SOURCE_FONT_METADATA_LIMIT'});expect(await loadProjects()).toEqual(prior);expect((await loadLibrary()).unavailable).toEqual([]);
 });
 it('retains the exact normalized 2M collision work refusal without collecting an expanded persisted graph',async()=>{
  const p=await legacy(3),region=p.template.pages[0].regions[0] as TextRegion<LegacySourceTextLayout>,g=region.sourceLayout!;g.glyphs=Array.from({length:2100},()=>({...g.glyphs[0]}));g.endX=g.startX+g.glyphs[0].advance;p.baseline.blocks[0].runs=[{text:'a'.repeat(2100)}];p.draft=structuredClone(p.baseline);g.baselineRunsHash=hashTextSync(canonicalJson(p.baseline.blocks[0].runs));const template=normalizeFreshSourceTemplate(p.template,p.source.sha256);
  await expect(computeLayout(template,p.draft)).rejects.toThrow(/comparison budget/);expect(()=>buildSourceOverlapManifest(template)).toThrow(/1000 pairs|comparison budget/);
 });
 it.runIf(!!process.env.FOLIO_PRIVATE_GRAPH_RECORD)('measures the exact authorized large record with all IDs, glyphs, proofs and snapshot intact',async()=>{
  const raw=JSON.parse(await readFile(process.env.FOLIO_PRIVATE_GRAPH_RECORD!,'utf8'),(_key,value)=>value?.privateBinaryBase64?new Uint8Array(Buffer.from(value.privateBinaryBase64,'base64')):value),old=validateProject(raw),p=await approveTemplate(normalized(old),old.template.warnings.filter(w=>w.severity==='review').map(w=>w.id));
  expect(logical(p)).toEqual(logical(old));expect(Array.from(sourceOverlapProofs(p.template))).toEqual(Array.from(sourceOverlapProofs(old.template)));expect(p.facts).toEqual(old.facts);expect(p.careerMemory).toEqual(old.careerMemory);expect(p.template.sourceFonts).toEqual(old.template.sourceFonts);expect(p.baseline).toEqual(old.baseline);expect(Array.from(sourceOverlapProofs(p.template))).toHaveLength(993);
  await saveProject(p);const app=await createSavedApplication(p,old.job);expect(new TextEncoder().encode(JSON.stringify(metadata(app))).length).toBeLessThan(2097152);expect(app.memorySnapshot).toBeDefined();
  const {createApplication}=await import('./applications'),oldApp=await createApplication(old,old.job);expect(normalized(oldApp).memorySnapshot).toEqual(oldApp.memorySnapshot);expect(app.memorySnapshot!.evidence).toEqual(oldApp.memorySnapshot!.evidence);expect(app.memorySnapshot!.eligibleFactIds).toEqual(oldApp.memorySnapshot!.eligibleFactIds);
  const results={primaryBytes:new TextEncoder().encode(JSON.stringify(metadata(p))).length,applicationBytes:new TextEncoder().encode(JSON.stringify(metadata(app))).length,glyphs:logical(p).reduce((n,r)=>n+r.glyphs.length,0),originalOverlapPairs:Array.from(sourceOverlapProofs(p.template)).length,logicalGlyphHash:hashTextSync(canonicalJson(logical(p))),logicalOverlapHash:hashTextSync(canonicalJson(Array.from(sourceOverlapProofs(p.template)))),fullSnapshotEvidenceExact:true,allIDsPreserved:true,cap:2097152};
  if(process.env.FOLIO_PRIVATE_GRAPH_RESULT){const {writeFile}=await import('node:fs/promises');await writeFile(process.env.FOLIO_PRIVATE_GRAPH_RESULT,JSON.stringify(results,null,2),{mode:0o600});}
 });
});
