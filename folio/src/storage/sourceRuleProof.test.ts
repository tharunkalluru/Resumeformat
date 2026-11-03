import { deepStrictEqual } from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {openDB} from 'idb';
import JSZip from 'jszip';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {fictionalRuleImport} from '../core/sourceRuleTestFixture';
import {makeProject,type RuleRegion} from '../core/model';
import {validateProject} from '../core/schema';
import {approveTemplate} from '../core/commands';
import {setFontLoader} from '../layout/fonts';
import {sourceRuleOverlapProof} from '../layout/source-overlaps';
import {sourceScopedStateHash} from '../core/source-scoped-paint';
import {backupProject,backupResumeGroup,restoreGroup,restoreProject,saveProject,loadProjects} from './projects';
import {createApplication} from '../core/applications';
import {packScopedMetadata,unpackScopedMetadata} from '../core/source-scoped-codec';
import {packRecordMetadata,unpackRecordMetadata} from '../core/project-record-codec';

let program:Uint8Array,restore:()=>void;
beforeAll(async()=>{program=new Uint8Array(await readFile(resolve('public/fonts/DejaVuSans.ttf')));Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});restore=setFontLoader(async file=>new Uint8Array(await readFile(resolve('public/fonts',file))));await import('../import/pdf');(await import('pdfjs-dist/legacy/build/pdf.mjs')).GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});
afterAll(()=>restore?.());
beforeEach(async()=>{const db=await openDB('folio-local-v1',2,{upgrade(db){if(!db.objectStoreNames.contains('projects'))db.createObjectStore('projects',{keyPath:'id'});if(!db.objectStoreNames.contains('groupState'))db.createObjectStore('groupState',{keyPath:'templateGroupId'});}});await db.clear('projects');await db.clear('groupState');db.close();});
async function project(){const r=await fictionalRuleImport(program);return approveTemplate(validateProject(makeProject(r)),r.template.warnings.filter(w=>w.severity==='review').map(w=>w.id));}

describe('portable original rule paint proof',()=>{
 it('preserves actual source rule proof through save/reload, single and resume-group backups',async()=>{
  const p=await project();await saveProject(p);deepStrictEqual((await loadProjects())[0].template, p.template);
  const restored=await restoreProject(new File([await backupProject(p)],'fictional-rule.folio.zip'));deepStrictEqual(restored.template, p.template);
  const app=await createApplication(p);await saveProject(app);const group=await restoreGroup(new File([await backupResumeGroup([p,app])],'fictional-rules-group.folio.zip'));expect(group).toHaveLength(2);for(const item of group)deepStrictEqual(item.template, p.template);
 });
 it('refuses a self-consistent forged rule record and corrupt manifest before durable restore writes',async()=>{
  const p=await project(),backup=await backupProject(p);
  const forged=structuredClone(p),rule=forged.template.pages[0].regions.find((r):r is RuleRegion=>r.kind==='rule')!;rule.bounds.y+=.1;rule.sourcePaint!.bounds.y+=.1;forged.template.sourceRuleOverlaps=forged.template.sourceRuleOverlaps!.map(pair=>sourceRuleOverlapProof(forged.template,pair.glyph,pair.ruleId));
  rule.sourceScopedPaint!.stateHash=sourceScopedStateHash(rule,forged.template.sourceFonts!);
  expect(()=>validateProject(forged)).not.toThrow();await expect(saveProject(forged)).rejects.toThrow(/retained PDF paint/);expect(await loadProjects()).toEqual([]);
  // The stronger selected-font validator catches a coherently moved glyph before
  // rule recapture. Assert that exact ownership refusal; the forged rule above
  // still exercises the later retained-PDF paint check.
  const falseGlyph=structuredClone(p),glyphRegion=falseGlyph.template.pages[0].regions.find(r=>r.kind==='text'&&falseGlyph.template.sourceRuleOverlaps!.some(pair=>pair.glyph.regionId===r.id));if(glyphRegion?.kind!=='text'||glyphRegion.sourceLayout?.glyphEncoding!=='shared-font-tuple-v1')throw Error();glyphRegion.sourceLayout.glyphs[2][2]+=.1;glyphRegion.sourceLayout.endX+=.1;falseGlyph.template.sourceRuleOverlaps=falseGlyph.template.sourceRuleOverlaps!.map(pair=>sourceRuleOverlapProof(falseGlyph.template,pair.glyph,pair.ruleId));glyphRegion.sourceScopedPaint!.stateHash=sourceScopedStateHash(glyphRegion,falseGlyph.template.sourceFonts!);expect(()=>validateProject(falseGlyph)).not.toThrow();await expect(saveProject(falseGlyph)).rejects.toMatchObject({code:'PDF_SOURCE_PROOF'});expect(await loadProjects()).toEqual([]);
  for(const mode of ['paint','hash']){const zip=await JSZip.loadAsync(await backup.arrayBuffer()),meta=unpackScopedMetadata(unpackRecordMetadata(JSON.parse(await zip.file('project.json')!.async('string')))) as any;if(mode==='paint'){const badRule=meta.template.pages[0].regions.find((r:RuleRegion)=>r.kind==='rule');badRule.sourcePaint.operatorIndex+=1;}else meta.template.sourceRuleOverlaps[0].proofHash='0'.repeat(64);zip.file('project.json',JSON.stringify(packRecordMetadata(packScopedMetadata(meta))));await expect(restoreProject(new File([new Uint8Array(await zip.generateAsync({type:'uint8array'})).buffer],'tampered-rule.folio.zip'))).rejects.toThrow();expect(await loadProjects()).toEqual([]);}
 });
});
