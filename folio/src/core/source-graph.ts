import type {SourceGlyphTuple,SourcePositionedGlyph,SourceOverlapProof,SourceOverlapTuple,Template,TextRegion} from './model';
import {FolioError} from './errors';

function fail():never{throw new FolioError('SOURCE_FONT_GRAPH','The source graph has an invalid encoding, tuple or bounded owner.');}
const own=(value:object,key:PropertyKey)=>Object.prototype.hasOwnProperty.call(value,key);
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const identity=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=150;
const integer=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isInteger(value)&&value>=min&&value<=max;
/** Reject sparse, extra or named tuple slots before resolving an occurrence. */
export function exactSourceTuple(value:unknown,lengths:readonly number[]):value is unknown[] {
  if(!Array.isArray(value)||!lengths.includes(value.length)||Reflect.ownKeys(value).length!==value.length+1)return false;
  for(let i=0;i<value.length;i++)if(!own(value,i))return false;
  return true;
}
export function sourceGlyphCount(region:TextRegion):number {
  const layout=region.sourceLayout;
  if(!layout||!Array.isArray(layout.glyphs)||layout.glyphs.length<1||layout.glyphs.length>100000)fail();
  if(own(layout,'glyphEncoding')&&layout.glyphEncoding!=='shared-font-tuple-v1')fail();
  return layout.glyphs.length;
}
/** No cache: a tuple always resolves through its current owning region. */
export function sourceGlyphAt(region:TextRegion,ordinal:number):SourcePositionedGlyph {
  const count=sourceGlyphCount(region),layout=region.sourceLayout!;
  if(!integer(ordinal,0,count-1)||!own(layout.glyphs,ordinal))fail();
  const raw=layout.glyphs[ordinal];
  if(layout.glyphEncoding==='shared-font-tuple-v1') {
    if(!exactSourceTuple(raw,[5,6])||!identity(region.style.sourceFontId)||!integer(raw[0],1,65535)||typeof raw[1]!=='string'||raw[1].length<1||raw[1].length>32||!Number.isFinite(raw[2])||!Number.isFinite(raw[3])||raw[3]<0||raw[3]>2000||!integer(raw[4],0,100000)||raw.length===6&&raw[5]!==1)fail();
    return {fontId:region.style.sourceFontId,cid:raw[0],unicode:raw[1],x:raw[2],advance:raw[3],operatorIndex:raw[4],...(raw.length===6?{inferredGap:true as const}:{})};
  }
  if(Array.isArray(raw)||!raw||typeof raw!=='object')fail();
  return raw;
}
export function* sourceGlyphs(region:TextRegion):Generator<SourcePositionedGlyph> {
  const count=sourceGlyphCount(region);
  for(let i=0;i<count;i++)yield sourceGlyphAt(region,i);
}
export function sourceGlyphText(region:TextRegion):string {
  let text='';for(const glyph of sourceGlyphs(region))text+=glyph.unicode;return text;
}
/** Aggregate guard runs before font/witness indexes or derived occurrence arrays. */
export function checkSourceGraphBudget(template:Template):void {
  let glyphs=0,maps=0;
  for(const page of template.pages)for(const region of page.regions){glyphs+=region.kind==='sourceShape'?1:region.kind==='text'&&region.sourceLayout?sourceGlyphCount(region):0;if(glyphs>100000)fail();}
  for(const font of template.sourceFonts??[]){maps+=font.glyphMap.length+(font.format==='opentype-cff'?(font.shapeMap?.length??0):0);if(maps>100000)fail();}
}
export function* sourceOverlapProofs(template:Template):Generator<SourceOverlapProof> {
  const overlaps=template.sourceOverlaps;if(overlaps===undefined)return;
  if(Array.isArray(overlaps)) {
    if(overlaps.length<1||overlaps.length>1000)fail();
    for(let i=0;i<overlaps.length;i++){if(!own(overlaps,i))fail();yield overlaps[i];}return;
  }
  if(!overlaps||overlaps.encoding!=='occurrence-tuples-v1'||!hash(overlaps.sourceSha256)||!Array.isArray(overlaps.pairs)||overlaps.pairs.length<1||overlaps.pairs.length>1000)fail();
  for(let i=0;i<overlaps.pairs.length;i++){
    if(!own(overlaps.pairs,i))fail();const pair=overlaps.pairs[i];
    if(!exactSourceTuple(pair,[5])||!identity(pair[0])||!integer(pair[1],0,100000)||!identity(pair[2])||!integer(pair[3],0,100000)||!hash(pair[4]))fail();
    yield {first:{regionId:pair[0],glyphOrdinal:pair[1]},second:{regionId:pair[2],glyphOrdinal:pair[3]},sourceSha256:overlaps.sourceSha256,proofHash:pair[4]};
  }
}
/** Fresh import only. Legacy reads/saves/backup restores never call this function. */
export function normalizeFreshSourceTemplate(template:Template,sourceSha256:string):Template {
  checkSourceGraphBudget(template);
  const proofs=Array.from(sourceOverlapProofs(template));
  if(proofs.some(proof=>proof.sourceSha256!==sourceSha256))fail();
  const pages=template.pages.map(page=>({...page,regions:page.regions.map(region=>{
    if(region.kind!=='text'||!region.sourceLayout)return region;
    const glyphs:SourceGlyphTuple[]=Array.from(sourceGlyphs(region),glyph=>{
      if(glyph.fontId!==region.style.sourceFontId||region.sourceLayout!.sourceSha256!==sourceSha256)fail();
      return glyph.inferredGap?[glyph.cid,glyph.unicode,glyph.x,glyph.advance,glyph.operatorIndex,1]:[glyph.cid,glyph.unicode,glyph.x,glyph.advance,glyph.operatorIndex];
    });
    return {...region,sourceLayout:{...region.sourceLayout,glyphEncoding:'shared-font-tuple-v1' as const,glyphs}};
  })}));
  const pairs:SourceOverlapTuple[]=proofs.map(proof=>[proof.first.regionId,proof.first.glyphOrdinal,proof.second.regionId,proof.second.glyphOrdinal,proof.proofHash]);
  return {...template,pages,...(pairs.length?{sourceOverlaps:{encoding:'occurrence-tuples-v1' as const,sourceSha256,pairs}}:{})};
}
