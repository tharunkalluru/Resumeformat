import 'fake-indexeddb/auto';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {captureSourceRulePaint,validateSourceRulePaint} from './pdf-source-rules';
import {validateOriginalPrograms} from './pdf-original-tt';
import {validateSourceScopedPaint} from './pdf-scoped-source';
import {fictionalRuleImport as makeFictionalRuleImport} from '../core/sourceRuleTestFixture';
import {setFontLoader} from '../layout/fonts';
import {renderDocument} from '../render/pdf';
import {sourceGlyphs} from '../core/source-graph';
import {makeProject,type ImportResult,type RuleRegion,type TextRegion} from '../core/model';
import {validateProject} from '../core/schema';
import {computeLayout} from '../layout/engine';
import {buildSourceRuleOverlapManifest,sourceRuleOverlapProof,validatedSourceRuleOverlapKeys} from '../layout/source-overlaps';

let pdfjs:typeof import('pdfjs-dist/legacy/build/pdf.mjs'),restore:()=>void,program:Uint8Array;
beforeAll(async()=>{program=new Uint8Array(await readFile(resolve('public/fonts/DejaVuSans.ttf')));Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});restore=setFontLoader(async file=>new Uint8Array(await readFile(resolve('public/fonts',file))));await import('./pdf');pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});
afterAll(()=>restore?.());

async function fictionalRuleImport(offset=1):Promise<ImportResult>{
 const r=await makeFictionalRuleImport(program,offset);
 // Exercise the historical V11 rule-only representation explicitly. The same
 // unchanged authored original must independently qualify for that route; a
 // changed label or omitted current proof is not sufficient for admission.
 expect(r.template.sourceFonts!.every(f=>f.format==='truetype'&&f.sourceVersion===4)).toBe(true);
 r.template.importerVersion='folio-import-v11';delete r.template.sourceScopedPages;delete r.template.sourceImageContract;
 for(const region of r.template.pages.flatMap(p=>p.regions))if('sourceScopedPaint'in region)delete region.sourceScopedPaint;
 validateProject(makeProject(r));await validateOriginalPrograms(r.source.bytes,r.template.sourceFonts!,r.template);await validateSourceRulePaint(r.source.bytes,r.template);await validateSourceScopedPaint(r.source.bytes,r.template,r.assets);
 return r;
}
const glyphRegion=(r:ImportResult)=>r.template.pages[0].regions.find((r):r is TextRegion=>r.kind==='text'&&r.sourceLayout!==undefined&&Array.from(sourceGlyphs(r)).map(g=>g.unicode).join('')==='gag')!;
const sourceRule=(r:ImportResult)=>r.template.pages[0].regions.find((r):r is RuleRegion=>r.kind==='rule')!;

describe('bounded original solid horizontal stroke paint',()=>{
 it('keeps current normal import independently scoped while genuine V11 rule-only source remains restorable',async()=>{
  const current=await makeFictionalRuleImport(program),historical=await fictionalRuleImport();expect(current.template.sourceScopedPages).toBeDefined();expect(sourceRule(current).sourceScopedPaint).toBeDefined();expect(historical.template.sourceScopedPages).toBeUndefined();expect(sourceRule(historical).sourcePaint).toBeDefined();
  // Current scoped ownership independently preserves this unchanged baseline;
  // changing one source word still creates a fresh, visible collision.
  delete current.template.sourceRuleOverlaps;expect((await computeLayout(current.template,current.baseline)).overflows).toEqual([]);const changed=structuredClone(current.baseline);changed.blocks.find(b=>b.id===glyphRegion(current).contentId)!.runs[0].text='aga';expect((await computeLayout(current.template,changed)).overflows.some(o=>o.code==='collision')).toBe(true);
 });
 it('retains exact actual source rule/glyph intersections and selectable PDF paint without shrinking',async()=>{
  const r=await fictionalRuleImport(),glyphs=Array.from(sourceGlyphs(glyphRegion(r))),proofs=r.template.sourceRuleOverlaps!;
  expect(r.template.warnings.filter(w=>w.severity==='blocking'||w.code==='FONT_SUBSTITUTION')).toEqual([]);expect(proofs).toHaveLength(2);
  expect(proofs.map(p=>p.glyph.glyphOrdinal)).toEqual([0,2]);expect(validatedSourceRuleOverlapKeys(r.template).size).toBe(2);
  expect(sourceRule(r).sourcePaint).toMatchObject({kind:'horizontal-solid-stroke-v1',lineCap:0,lineJoin:0,opacity:1,blendMode:'Normal'});
  validateProject(makeProject(r));await validateSourceRulePaint(r.source.bytes,r.template);
  const render=await renderDocument(r.template,r.baseline,r.assets);expect(render.layout.overflows).toEqual([]);
  const task=pdfjs.getDocument({data:new Uint8Array(render.bytes),useSystemFonts:false,verbosity:0});try{const page=await(await task.promise).getPage(1),text=await page.getTextContent({disableNormalization:true});expect(text.items.filter(i=>'str'in i).map(i=>'str'in i?i.str:'').join('')).toBe('gagabc');const actual=captureSourceRulePaint(await page.getOperatorList(),page.getViewport({scale:1}).transform,1,r.source.sha256);expect([...actual.values()].map(p=>[p.bounds,p.color,p.thickness])).toEqual([[sourceRule(r).bounds,sourceRule(r).color,sourceRule(r).thickness]]);}finally{await task.destroy();}
  expect(render.layout.regions.find(p=>p.regionId===glyphRegion(r).id)!.lines[0].runs.flatMap(p=>p.sourceGlyphs??[])).toEqual(glyphs);
 });
 it('does not reuse original ordinal exemptions for different wording or new decoration',async()=>{
  const r=await fictionalRuleImport(),region=glyphRegion(r),draft=structuredClone(r.baseline),block=draft.blocks.find(b=>b.id===region.contentId)!;
  block.runs=[{...block.runs[0],text:'aga'}];expect((await computeLayout(r.template,draft)).overflows.some(o=>o.code==='collision')).toBe(true);
  // A separate authored original places the static rule at the face's underline ribbon.
  const decorated=await fictionalRuleImport(.25),decoratedDraft=structuredClone(decorated.baseline);decoratedDraft.blocks.find(b=>b.id===glyphRegion(decorated).contentId)!.runs[0].underline=true;expect((await computeLayout(decorated.template,decoratedDraft)).overflows.some(o=>o.code==='collision')).toBe(true);
 });
 it.each(['rulePosition','ruleWidth','ruleColor','ruleThickness','sourceHash','glyphPosition','glyphProgram','glyphColor','paintOrder','hash','ordinal','duplicate','extraPaint'] as const)('refuses changed %s paint and never exempts a fresh collision',async kind=>{
  const r=await fictionalRuleImport(),rule=sourceRule(r),region=glyphRegion(r),proof=r.template.sourceRuleOverlaps![0];
  switch(kind){case'rulePosition':rule.bounds.y+=.1;break;case'ruleWidth':rule.bounds.width+=1;break;case'ruleColor':rule.color='#ff0000';break;case'ruleThickness':rule.thickness+=.1;break;case'sourceHash':rule.sourcePaint!.sourceSha256='0'.repeat(64);break;case'glyphPosition':if(region.sourceLayout!.glyphEncoding==='shared-font-tuple-v1')region.sourceLayout!.glyphs[0][2]+=.1;break;case'glyphProgram':r.template.sourceFonts![0].sourceResource='changed-actual-resource';break;case'glyphColor':region.style.color='#ff0000';break;case'paintOrder':region.order=rule.order+1;break;case'hash':proof.proofHash='0'.repeat(64);break;case'ordinal':proof.glyph.glyphOrdinal=1;break;case'duplicate':r.template.sourceRuleOverlaps!.push(structuredClone(proof));break;case'extraPaint':{const extra=structuredClone(rule);extra.id='new-rule';delete extra.sourcePaint;r.template.pages[0].regions.push(extra);break;}}
  if(kind!=='extraPaint')expect(()=>validatedSourceRuleOverlapKeys(r.template)).toThrow();
  if(kind!=='duplicate')expect((await computeLayout(r.template,r.baseline)).overflows.some(o=>o.code==='collision')).toBe(true);
 });
 it('independently rejects a self-consistent forged paint record against retained source operators',async()=>{
  const r=await fictionalRuleImport(),rule=sourceRule(r);rule.bounds.y+=.1;rule.sourcePaint!.bounds.y+=.1;r.template.sourceRuleOverlaps=r.template.sourceRuleOverlaps!.map(p=>sourceRuleOverlapProof(r.template,p.glyph,p.ruleId));
  expect(()=>validateProject(makeProject(r))).not.toThrow();await expect(validateSourceRulePaint(r.source.bytes,r.template)).rejects.toThrow(/retained PDF paint/);
  await expect(validateSourceRulePaint(new Uint8Array([1,2,3]),r.template)).rejects.toThrow();
 });
 it.each(['position','baseline','color','operator','fontRef'] as const)('independently refuses rehashed claimed original glyph %s against actual source paint',async kind=>{
  const r=await fictionalRuleImport(),region=glyphRegion(r),graph=region.sourceLayout!;
  if(graph.glyphEncoding!=='shared-font-tuple-v1')throw Error('Expected current normalized source graph');
  if(kind==='position'){graph.glyphs[2][2]+=.1;graph.endX+=.1;}
  else if(kind==='baseline'){graph.baseline+=.1;region.bounds.y+=.1;}
  else if(kind==='color')region.style.color='#ff0000';
  else if(kind==='operator')graph.glyphs[2][4]+=1;
  else {const asset=r.template.sourceFonts![0];if(asset.format!=='truetype')throw Error();asset.originalProgram!.pdfFontRef='999 0 R';}
  r.template.sourceRuleOverlaps=r.template.sourceRuleOverlaps!.map(p=>sourceRuleOverlapProof(r.template,p.glyph,p.ruleId));
  expect(()=>validateProject(makeProject(r))).not.toThrow();await expect(validateSourceRulePaint(r.source.bytes,r.template)).rejects.toThrow(/retained PDF paint/);
 });
 it('preserves legacy text overlap behavior and does not invent a proof for an unowned rule',async()=>{
  const r=await fictionalRuleImport();delete sourceRule(r).sourcePaint;delete r.template.sourceRuleOverlaps;
  expect(buildSourceRuleOverlapManifest(r.template)).toEqual([]);await expect(validateSourceRulePaint(new Uint8Array([1]),r.template)).resolves.toBeUndefined();expect((await computeLayout(r.template,r.baseline)).overflows.some(o=>o.code==='collision')).toBe(true);
 });
 it('proves effective default/explicit GS and q/Q while refusing clipped, dashed, transformed or ambiguous strokes',()=>{
  const O=pdfjs.OPS,base={fnArray:[O.constructPath],argsArray:[[O.stroke,[new Float32Array([0,40,648,1,65,648])]]]},v=[1,0,0,-1,0,700],sha='1'.repeat(64),withOp=(op:number,args:unknown[])=>({fnArray:[op,...base.fnArray],argsArray:[args,...base.argsArray]});
  expect(captureSourceRulePaint(base,v,1,sha).size).toBe(1);
  expect(captureSourceRulePaint({fnArray:[O.save,O.setLineCap,O.restore,...base.fnArray],argsArray:[[],[1],[],...base.argsArray]},v,1,sha).size).toBe(1);
  expect(captureSourceRulePaint(withOp(O.setGState,[[['LC',0],['LJ',0],['ML',10],['CA',1],['BM','source-over'],['D',[[],0]]]]),v,1,sha).size).toBe(1);
  for(const [op,args] of [[O.clip,[]],[O.eoClip,[]],[O.paintFormXObjectBegin,[]],[O.setStrokeColorN,[]],[O.setLineCap,[1]],[O.setLineJoin,[1]],[O.setDash,[[2,1],0]],[O.setLineWidth,[.01]],[O.setGState,[[['ML',0]]]],[O.setGState,[[['CA',.5]]]],[O.setGState,[[['ca',.5]]]],[O.setGState,[[['unsupported',1]]]],[O.setGState,[[['BM','multiply']]]],[O.setGState,[[['SMask',{}]]]],[O.transform,[2,0,0,1,0,0]],[O.transform,[1,.1,0,1,0,0]],[O.restore,[]]] as [number,unknown[]][])expect(captureSourceRulePaint(withOp(op,args),v,1,sha).size).toBe(0);
  expect(captureSourceRulePaint({fnArray:[O.save,...base.fnArray],argsArray:[[],...base.argsArray]},v,1,sha).size).toBe(0);
 });
});
