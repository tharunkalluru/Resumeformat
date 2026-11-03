import { deepStrictEqual } from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {unpackRecordMetadata} from '../core/project-record-codec';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openDB } from 'idb';
import JSZip from 'jszip';
import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { fictionalSourceTemplate } from '../core/sourceFontTestFixture';
import { makeProject } from '../core/model';
import { validateProject } from '../core/schema';
import { approveTemplate } from '../core/commands';
import { createApplication } from '../core/applications';
import { parseSourceProgram } from '../layout/source-fonts';
import { backupProject, backupResumeGroup, restoreGroup, restoreProject, saveProject, loadProjects } from './projects';
import {importResume} from '../import';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';

beforeAll(async()=>{Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});

beforeEach(async () => {
  const db = await openDB('folio-local-v1', 2, { upgrade(db) { if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath:'id' }); if (!db.objectStoreNames.contains('groupState')) db.createObjectStore('groupState', { keyPath:'templateGroupId' }); } });
  await db.clear('projects'); await db.clear('groupState'); db.close();
});

async function proofProject() {
  const bytes = new Uint8Array(await readFile(resolve('public/fonts/DejaVuSans.ttf')));
  const font = parseSourceProgram(bytes), pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const embedded = await pdf.embedFont(bytes, {subset:false}); pdf.addPage([500,700]).drawText('abc', {font:embedded,size:12,x:40,y:648});
  const s = fictionalSourceTemplate(bytes, 'abc');
  // An authored minimal CMap keeps this fictional original inside the declared
  // scalar slice; a full font's unused ligature/control entries are outside it.
  await pdf.flush();
  const hex = (value:number) => value.toString(16).padStart(4,'0');
  const cmap = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n${s.asset.glyphMap.length} beginbfchar\n${s.asset.glyphMap.map(map => `<${hex(map.glyphId)}> <${hex(map.unicode.codePointAt(0)!)}>`).join('\n')}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
  pdf.context.lookup(embedded.ref, PDFDict).set(PDFName.of('ToUnicode'), pdf.context.register(pdf.context.flateStream(new TextEncoder().encode(cmap))));
  const original = new Uint8Array(await pdf.save()),result=await importResume(new File([original.buffer],'fictional-owned-truetype.pdf',{type:'application/pdf'}));
  // Recapture real painted selectors/operator positions and the pinned decoder
  // program. A manually authored graph cannot stand in for source ownership.
  expect(result.template.sourceFonts).toHaveLength(1);const owned=result.template.sourceFonts![0];
  expect(owned.format).toBe('truetype');if(owned.format!=='truetype')throw Error();expect(owned.originalProgram!.pdfFontRef).toBe(embedded.ref.toString());deepStrictEqual(owned.originalProgram!.bytes, bytes);
  return approveTemplate(validateProject(makeProject(result,true)),result.template.warnings.filter(w=>w.severity==='review').map(w=>w.id));
}

describe('portable original TrueType proofs', () => {
  it('compares complete binary graphs, metadata, order and prototypes without diagnostic graph traversal', () => {
    const original = {source:{bytes:new Uint8Array([37,80,68,70])},template:{pages:[{order:0,color:'#000000'},{order:1,color:'#123456'}]},facts:[{text:'Authored fact',confirmed:true}]};
    const copy = structuredClone(original);
    deepStrictEqual(copy, original);
    expect(Object.is(copy, original)).toBe(false);
    expect(() => expect(Object.is(original, original)).toBe(false)).toThrow();
    const changedByte = structuredClone(original); changedByte.source.bytes[0] ^= 1;
    expect(() => deepStrictEqual(changedByte, original)).toThrow();
    const changedMetadata = structuredClone(original); changedMetadata.facts[0].confirmed = false;
    expect(() => deepStrictEqual(changedMetadata, original)).toThrow();
    const changedOrder = structuredClone(original); changedOrder.template.pages.reverse();
    expect(() => deepStrictEqual(changedOrder, original)).toThrow();
    const changedPrototype = structuredClone(original); Object.setPrototypeOf(changedPrototype.source, null);
    expect(() => deepStrictEqual(changedPrototype, original)).toThrow();
  });
  it('stores both programs as owned binary attachments and preserves source proof through single/group restore', async () => {
    const p = await proofProject(); await saveProject(p); deepStrictEqual((await loadProjects())[0].template, p.template);
    const backup = await backupProject(p), zip = await JSZip.loadAsync(await backup.arrayBuffer());
    const meta = unpackRecordMetadata(JSON.parse(await zip.file('project.json')!.async('string'))) as any;
    expect(meta.template.sourceFonts[0].originalProgram.bytes).toBeUndefined();
    const owned=p.template.sourceFonts![0];if(owned.format!=='truetype')throw Error();
    deepStrictEqual(await zip.file('fonts/0.original.bin')!.async('uint8array'), owned.originalProgram!.bytes);
    deepStrictEqual(await zip.file('fonts/0.bin')!.async('uint8array'), owned.bytes);
    const restored = await restoreProject(new File([backup], 'proof.folio.zip')); deepStrictEqual(restored.template, p.template);
    const application = await createApplication(p); await saveProject(application);
    const group = await restoreGroup(new File([await backupResumeGroup([p,application])], 'proof-group.folio.zip'));
    expect(group).toHaveLength(2); for (const item of group) deepStrictEqual(item.template, p.template);
  });
  it('refuses missing/tampered original attachments and foreign reference proofs without durable writes', async () => {
    const p = await proofProject(), backup = await backupProject(p);
    for (const mode of ['missing','tamper']) {
      const zip = await JSZip.loadAsync(await backup.arrayBuffer());
      if (mode === 'missing') zip.remove('fonts/0.original.bin'); else zip.file('fonts/0.original.bin', new Uint8Array([1,2,3]));
      await expect(restoreProject(new File([new Uint8Array(await zip.generateAsync({type:'uint8array'})).buffer], 'bad.folio.zip'))).rejects.toThrow();
    }
    const foreign = structuredClone(p), asset = foreign.template.sourceFonts![0];
    if (asset.format === 'truetype') asset.originalProgram!.pdfFontRef = '999 0 R';
    await expect(saveProject(foreign)).rejects.toThrow(); expect(await loadProjects()).toEqual([]);
  });
});
