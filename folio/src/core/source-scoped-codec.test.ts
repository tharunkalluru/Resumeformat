import {MAX_SOURCE_PAGES} from './model';
import {describe,expect,it} from 'vitest';
import {canonicalJson,sha256Sync,type SourceScopedPaint} from './model';
import {packScopedMetadata,unpackScopedMetadata} from './source-scoped-codec';

const paint=():SourceScopedPaint=>({version:'source-scoped-occurrence-v1',kind:'text',sourceSha256:'a'.repeat(64),pageNumber:1,rawOperatorIndex:20,operatorIndex:31,color:{space:'DeviceRGB',components:[.123456,.25,.875]},clipStack:[{pathOperatorIndex:2,clipOperatorIndex:3,endOperatorIndex:4,fillRule:'evenodd',constructionCtm:[1,0,0,-1,0,700],bounds:{x:30.125,y:18.75,width:100.5,height:200.25}}],effectiveClip:{x:30.125,y:18.75,width:100.5,height:200.25},stateHash:'b'.repeat(64),derivedGaps:{version:'pinned-extractor-gap-v1',count:3}});
const metadata=()=>({name:'Fictional codec source',source:{sha256:'a'.repeat(64)},template:{sourceScopedPages:{version:'source-scoped-pages-v1',sourceSha256:'a'.repeat(64)},pages:[{id:'p1',regions:[{kind:'text',order:31,id:'r1',sourceScopedPaint:paint(),sourceLayout:{glyphs:[[1,'a',40,8,31]]}}]}]},baseline:{blocks:[{text:'Unchanged fictional text'}]}});
const packed=()=>packScopedMetadata(metadata()) as any;
const tuple=(value:any)=>value.template.pages[0].regions[0].sourceScopedPaint;
const hash=(value:unknown)=>sha256Sync(new TextEncoder().encode(canonicalJson(value)));
describe('lossless bounded scoped source JSON transport',()=>{
 it.each(['source-scoped-occurrence-v1','source-scoped-occurrence-v2'] as const)('retains all32 full scoped pages and page numbers without changing their canonical evidence (%s)',version=>{
  const value=metadata();value.template.pages=Array.from({length:MAX_SOURCE_PAGES},(_,i)=>{const page=structuredClone(value.template.pages[0]);page.id=`p${i+1}`;page.regions[0].id=`r${i+1}`;page.regions[0].sourceScopedPaint.pageNumber=i+1;page.regions[0].sourceScopedPaint.version=version;return page;});
  const restored=unpackScopedMetadata(JSON.parse(JSON.stringify(packScopedMetadata(value)))) as typeof value;expect(canonicalJson(restored)).toBe(canonicalJson(value));expect(restored.template.pages).toHaveLength(MAX_SOURCE_PAGES);expect(restored.template.pages.at(-1)!.regions[0].sourceScopedPaint.pageNumber).toBe(MAX_SOURCE_PAGES);
 });
 it('retains every explicit identity, numeric value, glyph and proof hash without mutating runtime evidence',()=>{
  const original=metadata(),before=structuredClone(original),wire=packScopedMetadata(original),decoded=unpackScopedMetadata(JSON.parse(JSON.stringify(wire)));expect(original).toEqual(before);expect(decoded).toEqual(original);expect(canonicalJson(decoded)).toBe(canonicalJson(original));expect(hash(decoded)).toBe(hash(original));expect(JSON.stringify(wire).length).toBeLessThan(JSON.stringify(original).length);expect(tuple(wire)[2]).toBe(paint().sourceSha256);expect(tuple(wire)[3]).toBe(1);expect(tuple(wire)[4]).toBe(20);expect(tuple(wire)[5]).toBe(31);
 });
 it('keeps ordinary legacy full metadata unchanged and represents absent derived semantics exactly',()=>{
  const old=metadata();delete old.template.pages[0].regions[0].sourceScopedPaint.derivedGaps;expect(unpackScopedMetadata(old)).toBe(old);expect(unpackScopedMetadata(JSON.parse(JSON.stringify(packScopedMetadata(old))))).toEqual(old);const ordinary={template:{pages:[{regions:[{kind:'text',id:'legacy'}]}]}};expect(packScopedMetadata(ordinary)).toBe(ordinary);expect(unpackScopedMetadata(ordinary)).toBe(ordinary);
 });
 it('does not impose scoped bounds on a generic legacy record with more than 1000 regions',()=>{
  const old={template:{pages:[{regions:Array.from({length:1001},(_,i)=>({kind:'text',id:`legacy-${i}`}))}]}};expect(packScopedMetadata(old)).toBe(old);expect(unpackScopedMetadata(old)).toBe(old);const scoped=structuredClone(old) as any;scoped.template.pages[0].regions[0].sourceScopedPaint=tuple(packed());expect(()=>unpackScopedMetadata(scoped)).toThrowError(expect.objectContaining({code:'SOURCE_SCOPED_TRANSPORT'}));
 });
 it.each(['version','arity','sparse','named','kind','sourceHash','page','rawOp','decodedOp','colorTag','colorArity','colorRange','clipArity','clipOp','fillRule','ctmArity','ctmFinite','rectArity','rectWidth','stateHash','count'] as const)('refuses malformed %s tuple evidence',mode=>{
  const bad=packed(),p=tuple(bad);if(mode==='version')p[0]='scoped-paint-tuple-v2';else if(mode==='arity')p.push(1);else if(mode==='sparse')delete p[2];else if(mode==='named')p.extra=1;else if(mode==='kind')p[1]={toString:()=> 'text'};else if(mode==='sourceHash')p[2]='invalid';else if(mode==='page')p[3]=MAX_SOURCE_PAGES + 1;else if(mode==='rawOp')p[4]=-1;else if(mode==='decodedOp')p[5]=100001;else if(mode==='colorTag')p[6][0]='DeviceCMYK';else if(mode==='colorArity')p[6][1].pop();else if(mode==='colorRange')p[6][1][0]=1.1;else if(mode==='clipArity')p[7][0].push(0);else if(mode==='clipOp')p[7][0][0]=.5;else if(mode==='fillRule')p[7][0][3]='unknown';else if(mode==='ctmArity')p[7][0][4].pop();else if(mode==='ctmFinite')p[7][0][4][0]=NaN;else if(mode==='rectArity')p[8].push(0);else if(mode==='rectWidth')p[8][2]=-1;else if(mode==='stateHash')p[9]='invalid';else p[10]=-1;expect(()=>unpackScopedMetadata(bad)).toThrowError(expect.objectContaining({code:'SOURCE_SCOPED_TRANSPORT'}));
 });
 it('rejects unknown full keys, mixed encodings and double packing',()=>{
  const bad=metadata() as any;bad.template.pages[0].regions[0].sourceScopedPaint.invented=1;expect(()=>packScopedMetadata(bad)).toThrowError(expect.objectContaining({code:'SOURCE_SCOPED_TRANSPORT'}));const mixed=packed();mixed.template.pages[0].regions.push(metadata().template.pages[0].regions[0]);expect(()=>unpackScopedMetadata(mixed)).toThrowError(expect.objectContaining({code:'SOURCE_SCOPED_TRANSPORT'}));expect(()=>packScopedMetadata(packed())).toThrowError(expect.objectContaining({code:'SOURCE_SCOPED_TRANSPORT'}));
 });
 it.each(['pages','regions','clipStack','glyphs','maps'] as const)('preflights aggregate %s bounds before expansion',mode=>{
  const bad=packed(),page=bad.template.pages[0],region=page.regions[0];if(mode==='pages')bad.template.pages=Array(MAX_SOURCE_PAGES + 1).fill(page);else if(mode==='regions')page.regions=Array(1001).fill(region);else if(mode==='clipStack')tuple(bad)[7]=Array(65).fill(tuple(bad)[7][0]);else if(mode==='glyphs')region.sourceLayout.glyphs=Array(100001).fill([1,'a',40,8,31]);else bad.template.sourceFonts=[{glyphMap:Array(100001).fill({cid:1})}];expect(()=>unpackScopedMetadata(bad)).toThrowError(expect.objectContaining({code:'SOURCE_SCOPED_TRANSPORT'}));
 });
});
