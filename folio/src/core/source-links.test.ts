import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { fictionalSourceTemplate } from './sourceFontTestFixture';
import { canonicalJson, hashTextSync, safeHref, sourceDocumentFingerprint, type SourceLink, type TextRegion } from './model';
import { currentSourceLinks, sourceLinkProofHash, validateSourceLinks } from './source-links';
import { renderDocument, setFontLoader } from '../render/pdf';

let program: Uint8Array;
beforeAll(async () => {
  program = new Uint8Array(await readFile(resolve('public/fonts/DejaVuSans.ttf')));
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  setFontLoader(async file => new Uint8Array(await readFile(resolve('public/fonts', file))));
});
const URI = 'TEL:+1-555-0102;EXT=12';
function fixture() {
  const f = fictionalSourceTemplate(program, 'abc');
  f.content.blocks[0].runs[0].href = URI;
  f.region.sourceLayout!.baselineRunsHash = hashTextSync(canonicalJson(f.content.blocks[0].runs));
  const evidence: Omit<SourceLink, 'proofHash'> = {
    id:'source-link', pageId:f.region.pageId, sourceSha256:f.asset.sourceSha256,
    annotationIndex:0, annotationId:'12R', href:URI, bounds:{x:35,y:38,width:90,height:25},
    bindings:[{regionId:f.region.id,contentId:f.region.contentId,baselineRunsHash:f.region.sourceLayout!.baselineRunsHash}],
  };
  const link = {...evidence,proofHash:sourceLinkProofHash(evidence)};
  f.template.sourceLinks = [link];
  return {...f,link};
}
async function annotations(bytes: Uint8Array) {
  const document = await PDFDocument.load(bytes), page = document.getPages()[0];
  return (page.node.Annots()?.asArray() ?? []).map(ref => {
    const annotation = document.context.lookup(ref, PDFDict), action = annotation.lookup(PDFName.of('A'),PDFDict);
    return {rect:annotation.lookup(PDFName.of('Rect'),PDFArray).asArray().map(n=>Number(n.toString())),href:action.lookup(PDFName.of('URI'),PDFString).decodeText()};
  });
}
describe('source-bound safe telephone links', () => {
  it.each(['tel:+15550102;ext=1','TEL:+15550102;EXT=0012','tel:+1(555)-0102;ext=12345678901234567890'])('retains literal extension destination %s', uri => {
    expect(safeHref(uri)).toBe(uri);
  });
  it.each(['tel://user:secret@host/+15550102;ext=1','tel:+15550102;ext=1;ext=2','tel:+15550102;ext=1;isub=2','tel:+15550102;ext=1#x','tel:+15550102;ext=1?x','tel:+15550102%3Bext%3D1','tel:+15550102;ext=%31','tel:+15550102;ext=','tel:+15550102;ext=abc','tel:+15550102;ext=123456789012345678901','tel:+15550102,12','tel:+15550102;ext=1\n','javascript:alert(1)'])('refuses malformed or active destination %j', uri => {
    expect(safeHref(uri)).toBeUndefined();
  });
  it('emits the exact original rectangle and URI once, without a duplicate generated annotation', async () => {
    const f=fixture();validateSourceLinks(f.template,f.asset.sourceSha256,f.content);
    const result=await renderDocument(f.template,f.content,[]);
    expect(result.layout.overflows).toEqual([]);
    expect(await annotations(result.bytes)).toEqual([{rect:[35,637,125,662],href:URI}]);
  });
  it('uses current visible geometry for a shorter linked edit and emits no old source rectangle', async () => {
    const f=fixture();f.content.blocks[0].runs[0].text='a';
    const result=await renderDocument(f.template,f.content,[]), found=await annotations(result.bytes);
    expect(result.layout.overflows).toEqual([]);expect(found).toHaveLength(1);
    expect(found[0].href).toBe(URI);expect(found[0].rect).not.toEqual([35,637,125,662]);
    expect(result.layout.regions[0].lines[0].runs.map(r=>r.text).join('')).toBe('a');
  });
  it('removes an old annotation when its href is removed and uses only a changed destination', async () => {
    const f=fixture();delete f.content.blocks[0].runs[0].href;
    expect(await annotations((await renderDocument(f.template,f.content,[])).bytes)).toEqual([]);
    f.content.blocks[0].runs[0].href='https://example.com/current';
    const found=await annotations((await renderDocument(f.template,f.content,[])).bytes);
    expect(found).toHaveLength(1);expect(found[0].href).toBe('https://example.com/current');expect(found[0].rect).not.toEqual([35,637,125,662]);
  });
  it('invalidates old geometry for mark/evidence changes while keeping the source proof immutable', () => {
    const f=fixture(),before=structuredClone(f.template);f.content.blocks[0].runs[0].underline=true;
    expect(currentSourceLinks(f.template,f.content,f.region.pageId).links).toEqual([]);
    f.content.blocks[0].runs[0].underline=undefined;f.content.blocks[0].runs[0].sourceFactIds=['current-evidence'];
    expect(currentSourceLinks(f.template,f.content,f.region.pageId).links).toEqual([]);expect(f.template).toEqual(before);
  });
  it('keeps one original annotation spanning multiple source regions; any changed span drops that original', async () => {
    const f=fixture(),region=structuredClone(f.region),block=structuredClone(f.content.blocks[0]);
    region.id='second-region';region.contentId='second-block';region.bounds.x+=40;region.order=1;
    region.sourceLayout!.startX+=40;region.sourceLayout!.endX+=40;region.sourceLayout!.glyphs.forEach(g=>g.x+=40);
    block.id=region.contentId;f.template.pages[0].regions.push(region);f.content.blocks.push(block);
    f.link.bindings.push({regionId:region.id,contentId:region.contentId,baselineRunsHash:region.sourceLayout!.baselineRunsHash});f.link.proofHash=sourceLinkProofHash(f.link);
    validateSourceLinks(f.template,f.asset.sourceSha256,f.content);
    expect(await annotations((await renderDocument(f.template,f.content,[])).bytes)).toEqual([{rect:[35,637,125,662],href:URI}]);
    delete block.runs[0].href;const found=await annotations((await renderDocument(f.template,f.content,[])).bytes);
    expect(found).toHaveLength(1);expect(found[0].rect).not.toEqual([35,637,125,662]);
  });
  it('preserves distinct original annotations without duplicating derived run annotations', async () => {
    const f=fixture(),other=structuredClone(f.link);other.id='other-link';other.annotationIndex=1;other.annotationId='13R';other.bounds.x+=1;other.proofHash=sourceLinkProofHash(other);f.template.sourceLinks!.push(other);
    expect(await annotations((await renderDocument(f.template,f.content,[])).bytes)).toEqual([{rect:[35,637,125,662],href:URI},{rect:[36,637,126,662],href:URI}]);
  });
  it.each(['sourceHash','page','binding','content','baselineHash','rect','oversizedRect','offPageRect','destination','proof','duplicate','missingFont'])('rejects corrupted %s ownership before rendering', type => {
    const f=fixture();
    if(type==='sourceHash')f.link.sourceSha256='0'.repeat(64);
    if(type==='page')f.link.pageId='missing';
    if(type==='binding')f.link.bindings[0].regionId='missing';
    if(type==='content')f.link.bindings[0].contentId='missing';
    if(type==='baselineHash')f.link.bindings[0].baselineRunsHash='0'.repeat(64);
    if(type==='rect')f.link.bounds.width=-1;
    if(type==='oversizedRect')f.link.bounds.width=5001;
    if(type==='offPageRect')f.link.bounds.x=501;
    if(type==='oversizedRect'||type==='offPageRect')f.link.proofHash=sourceLinkProofHash(f.link);
    if(type==='destination')f.link.href='javascript:alert(1)';
    if(type==='proof')f.link.proofHash='0'.repeat(64);
    if(type==='duplicate')f.template.sourceLinks!.push(structuredClone(f.link));
    if(type==='missingFont')f.template.sourceFonts=[];
    expect(()=>validateSourceLinks(f.template,f.asset.sourceSha256,f.content)).toThrow();
  });
  it('includes annotation evidence in current rendering/review identity without legacy backfill', () => {
    const f=fixture(),before=sourceDocumentFingerprint(f.template,f.content);f.link.bounds.x+=1;f.link.proofHash=sourceLinkProofHash(f.link);
    expect(sourceDocumentFingerprint(f.template,f.content)).not.toBe(before);
    delete f.template.sourceLinks;expect(()=>validateSourceLinks(f.template,f.asset.sourceSha256,f.content)).not.toThrow();
  });
});
