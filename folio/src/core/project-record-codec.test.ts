import {MAX_SOURCE_PAGES} from './model';
import {describe,expect,it} from 'vitest';
import {canonicalJson,sha256Sync} from './model';
import {packRecordMetadata,unpackRecordMetadata} from './project-record-codec';
import {packScopedMetadata,unpackScopedMetadata} from './source-scoped-codec';

const id='00000000-0000-4000-8000-000000000001';
const paint=()=>({version:'source-scoped-occurrence-v1',kind:'text',sourceSha256:'a'.repeat(64),pageNumber:1,rawOperatorIndex:3,operatorIndex:4,color:{space:'DeviceGray',components:[.123456]},clipStack:[],effectiveClip:{x:0,y:0,width:612,height:792},stateHash:'b'.repeat(64)});
const metadata=()=>({
 id,name:'Fictional record transport',template:{pages:[{id:'page',regions:[{kind:'text',id,pageId:'page',bounds:{x:40,y:50,width:100,height:12},order:4,contentId:'block',role:'body',style:{fontFamily:'sans',fontSize:12,fontWeight:400,italic:false,color:'#123456',lineHeight:14,alignment:'left',baselineOffset:0,sourceFontId:id},sourceLocator:'page 1 item 1',sourceLayout:{version:1,sourceSha256:'a'.repeat(64),baselineRunsHash:'b'.repeat(64),anchor:'start',startX:40,endX:52,baseline:60,fontSize:12,glyphEncoding:'shared-font-tuple-v1',glyphs:[[1,'a',40,6,4],[2,' ',46,6,4,1]]},sourceScopedPaint:paint()}]}],sourceFonts:[]},
 baseline:{revision:1,blocks:[{id:'block',runs:[{text:'Fictional exact quote',bold:false,italic:true,underline:false,href:'https://example.org/',sourceFactIds:[]},{text:'',sourceFactIds:[id,id]}],sourceFactIds:[id]}]},
 draft:{revision:2,blocks:[{id:'block',runs:[{text:'Fictional draft',bold:false}],sourceFactIds:[]}]},
 facts:[{id,text:'Fictional evidence',kind:'resume',locator:'page 1 item 1',confirmed:false}],
 memorySnapshot:{id:'snapshot',eligibleFactIds:[id],evidence:[{factId:id,provenance:{sourceId:'original',sourceName:'Fictional.pdf',sourceHash:'a'.repeat(64),sourceKind:'resume',locator:'page 1 item 1',originalQuote:'Exact fictional quotation',quoteHash:'c'.repeat(64),resumeFactId:id},confirmation:null}]},
 folio:{state:'ready',jobIdentity:'job',privateNotes:'',historyKnown:true,completions:[],versions:[{id:'v1',kind:'firstResult',createdAt:'2026-10-09T00:00:00.000Z',content:{revision:1,blocks:[{id:'history',runs:[{text:'Retained original result',italic:false,sourceFactIds:[]}],sourceFactIds:[id]}]}},{id:'v2',kind:'download',createdAt:'2026-10-09T01:00:00.000Z',content:{revision:2,blocks:[]}}],changes:{}}
});
const pack=(v:unknown)=>packRecordMetadata(packScopedMetadata(v));
const unpack=(v:unknown)=>unpackScopedMetadata(unpackRecordMetadata(v));
const packed=()=>pack(metadata()) as any;
const region=(v:any)=>v.project.template.pages[0].regions[0];
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const hash=(v:unknown)=>sha256Sync(new TextEncoder().encode(canonicalJson(v)));
const refusal=(fn:()=>unknown)=>expect(fn).toThrowError(expect.objectContaining({code:'PROJECT_RECORD_TRANSPORT'}));

describe('full explicit project record transport',()=>{
 it('keeps legacy block wire tuples byte exact and roundtrips grouped current and history ownership',()=>{
  const original=metadata() as any,old=pack(original) as any;expect(old.project.baseline.blocks[0]).toHaveLength(3);expect(old.project.draft.blocks[0]).toHaveLength(3);expect(unpack(old)).toEqual(original);
  original.draft.blocks[0].sourceParagraphGroupId='paragraph:'+ 'c'.repeat(64);original.folio.versions[0].content.blocks[0].sourceParagraphGroupId='paragraph:'+ 'c'.repeat(64);
  const wire=pack(original) as any;expect(wire.project.draft.blocks[0]).toHaveLength(5);expect(wire.project.baseline.blocks[0]).toEqual(old.project.baseline.blocks[0]);expect(unpack(clone(wire))).toEqual(original);
 });
 it.each(['source-scoped-occurrence-v1','source-scoped-occurrence-v2'] as const)('roundtrips all32 record pages with scoped page ownership and every retained baseline field (%s)',version=>{
  const value=metadata();value.template.pages=Array.from({length:MAX_SOURCE_PAGES},(_,i)=>{const page=structuredClone(value.template.pages[0]);page.id=`page${i+1}`;page.regions[0].pageId=page.id;page.regions[0].id=`region${i+1}`;page.regions[0].sourceScopedPaint.pageNumber=i+1;page.regions[0].sourceScopedPaint.version=version;return page;});
  const restored=unpack(clone(pack(value))) as typeof value;expect(canonicalJson(restored)).toBe(canonicalJson(value));expect(restored.template.pages).toHaveLength(MAX_SOURCE_PAGES);expect(restored.template.pages.at(-1)!.regions[0].sourceScopedPaint.pageNumber).toBe(MAX_SOURCE_PAGES);
 });
 it('roundtrips canonical metadata and hashes while preserving complete evidence, glyph tuples and every history version',()=>{
  const original=metadata(),before=structuredClone(original),wire=pack(original),restored=unpack(clone(wire));
  expect(original).toEqual(before);expect(restored).toEqual(original);expect(canonicalJson(restored)).toBe(canonicalJson(original));expect(hash(restored)).toBe(hash(original));
  expect((wire as any).project.memorySnapshot).toBe(original.memorySnapshot);expect((restored as any).memorySnapshot).toEqual(original.memorySnapshot);
  expect(region(wire)[10][8]).toEqual(original.template.pages[0].regions[0].sourceLayout.glyphs);
  expect(JSON.stringify(wire).length).toBeLessThan(JSON.stringify(original).length);
 });
 it('keeps false, zero, empty strings/arrays and absent run/style optional fields distinct',()=>{
  const original=metadata();const decoded=unpack(clone(pack(original))) as any;
  const runs=decoded.baseline.blocks[0].runs;expect(runs[0]).toMatchObject({bold:false,italic:true,underline:false,sourceFactIds:[]});expect(Object.hasOwn(runs[1],'bold')).toBe(false);expect(runs[1].text).toBe('');expect(runs[1].sourceFactIds).toEqual([id,id]);
  expect(decoded.template.pages[0].regions[0].style.baselineOffset).toBe(0);expect(Object.hasOwn(decoded.draft.blocks[0].runs[0],'sourceFactIds')).toBe(false);
 });
 it.each([id,'00000000-0000-4000-8000-000000000ABC','=literal','~literal','Arbitrary source ID'])('preserves the exact ID spelling %s in typed slots',value=>{
  const original=metadata();original.template.pages[0].regions[0].id=value;expect((unpack(clone(pack(original))) as any).template.pages[0].regions[0].id).toBe(value);
 });
 it('does not transform ID-like text, hyperlinks, hashes, PDF resource references or immutable memory',()=>{
  const original=metadata();original.baseline.blocks[0].runs[0].text=id;const wire=pack(original) as any;
  expect(wire.project.baseline.blocks[0][1][0][0]).toBe(id);expect(wire.project.memorySnapshot).toEqual(original.memorySnapshot);expect(region(wire)[10][1]).toBe('a'.repeat(64));expect(unpack(clone(wire))).toEqual(original);
 });
 it.each([1,2,3])('preserves complete layout version %i without modifying its glyph payload',version=>{
  const original=metadata() as any,l=original.template.pages[0].regions[0].sourceLayout;l.version=version;
  if(version===2){l.baselineStyle={fontWeight:700,italic:false};l.editPolicy='baselineOnly';l.editReason='sourceLigature';}
  if(version===3){l.characterSpacing=-.077;l.editPolicy='baselineOnly';l.editReason='nonPositiveStep';}
  expect(unpack(clone(pack(original)))).toEqual(original);
 });
 it('preserves full legacy glyph records including independent font ID and inferred flag',()=>{
  const original=metadata() as any,l=original.template.pages[0].regions[0].sourceLayout;delete l.glyphEncoding;l.glyphs=[{fontId:id,cid:1,unicode:'a',x:40,advance:6,operatorIndex:4},{fontId:'different-font',cid:2,unicode:' ',x:46,advance:6,operatorIndex:4,inferredGap:true}];expect(unpack(clone(pack(original)))).toEqual(original);
 });
 it('passes untargeted legacy metadata by identity before record budgets',()=>{
  const value={template:{pages:[{regions:Array.from({length:1001},(_,i)=>({kind:'text',id:`legacy${i}`}))}]}};expect(packRecordMetadata(value)).toBe(value);expect(unpackRecordMetadata(value)).toBe(value);
 });
 it.each(['tag','envelopeKey','missingProject','double','fullTextMixed','fullBlockMixed','fullRunMixed','fullFactMixed','regionArity','regionSparse','regionNamed','optionalMask','optionalMissing','optionalUndefined','idPrefix','idLength','idAlphabet','idLowBits','idLiteralAlias','styleUnknown','layoutUnknown','layoutVersion','glyphArity','glyphFlag','layoutPolicy','runMask','runExtra','factKind','clipArity','clipStack','clipFinite','clipVersion'] as const)('refuses malformed %s rather than expanding it',mode=>{
  const value=packed(),r=region(value);
  if(mode==='tag')value.encoding='folio-record-tuples-v2';else if(mode==='envelopeKey')value.extra=1;else if(mode==='missingProject')delete value.project;else if(mode==='double')value.project=value;
  else if(mode==='fullTextMixed')value.project.template.pages[0].regions.push(metadata().template.pages[0].regions[0]);else if(mode==='fullBlockMixed')value.project.baseline.blocks.push(metadata().baseline.blocks[0]);else if(mode==='fullRunMixed')value.project.baseline.blocks[0][1].push({text:'mixed'});else if(mode==='fullFactMixed')value.project.facts.push(metadata().facts[0]);
  else if(mode==='regionArity')r.push(0);else if(mode==='regionSparse')delete r[2];else if(mode==='regionNamed')r.extra=0;else if(mode==='optionalMask')r[9]=4;else if(mode==='optionalMissing')r.pop();else if(mode==='optionalUndefined')r[10]=undefined;
  else if(mode==='idPrefix')r[1]='unknown';else if(mode==='idLength')r[1]='~AAAA';else if(mode==='idAlphabet')r[1]='~AAAAAAAAAAAAAAAAAAAAA!';else if(mode==='idLowBits')r[1]='~AAAAAAAAAAAAAAAAAAAAAR';else if(mode==='idLiteralAlias')r[1]='='+id;
  else if(mode==='styleUnknown')r[7].push('unknown');else if(mode==='layoutUnknown')r[10].push('unknown');else if(mode==='layoutVersion')r[10][0]=4;else if(mode==='glyphArity')r[10][8][0].push(0,0);else if(mode==='glyphFlag')r[10][8][1][5]=0;else if(mode==='layoutPolicy')r[10][9]=9;
  else if(mode==='runMask')value.project.baseline.blocks[0][1][0][1]=32;else if(mode==='runExtra')value.project.baseline.blocks[0][1][0].push(0);else if(mode==='factKind')value.project.facts[0][2]='invented';
  else if(mode==='clipArity')r[11][8].push(0);else if(mode==='clipStack')r[11][7]=Array(65).fill([1,2,3,'nonzero',[1,0,0,1,0,0],[0,0,100,100]]);else if(mode==='clipFinite')r[11][8][0]=Infinity;else r[11][0]='scoped-paint-tuple-v2';
  refusal(()=>unpackRecordMetadata(value));
 });
 it('rejects unknown full record keys and double packing',()=>{
  const value=metadata() as any;value.template.pages[0].regions[0].invented=true;refusal(()=>pack(value));refusal(()=>packRecordMetadata(packed()));
 });
 it.each(['pages','regions','glyphs','fontMaps','histories','blocks','runs','refs','strings'] as const)('preflights aggregate %s before decoded allocation',mode=>{
  const value=packed(),p=value.project,r=region(value);
  if(mode==='pages')p.template.pages=Array(MAX_SOURCE_PAGES + 1).fill(p.template.pages[0]);else if(mode==='regions')p.template.pages[0].regions=Array(1001).fill(r);else if(mode==='glyphs')r[10][8]=Array(100001).fill([1,'a',40,6,4]);else if(mode==='fontMaps')p.template.sourceFonts=[{glyphMap:Array(60000).fill({})},{glyphMap:Array(60000).fill({})}];else if(mode==='histories')p.folio.versions=Array(13).fill(p.folio.versions[0]);else if(mode==='blocks')p.baseline.blocks=Array(4001).fill(p.baseline.blocks[0]);else if(mode==='runs')p.baseline.blocks[0][1]=Array(1001).fill(p.baseline.blocks[0][1][0]);else if(mode==='refs')p.baseline.blocks[0][2]=Array(101).fill('=id');else p.memorySnapshot.evidence[0].provenance.originalQuote='x'.repeat(4*1024*1024+1);
  refusal(()=>unpackRecordMetadata(value));
 });
 it('lets full ordinary scoped metadata remain an explicit legacy read without decoding record tuples',()=>{
  const full=packScopedMetadata(metadata());expect(unpackRecordMetadata(full)).toBe(full);expect(unpackScopedMetadata(full)).toEqual(metadata());
 });
});
