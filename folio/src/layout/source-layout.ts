import {rotatedSourceInk} from './source-rotation';
import {sourceOutlineBox,sourceShear,sourceCharacterSpacing} from './source-shear';
import {sourceGlyphs,sourceGlyphText} from '../core/source-graph';
import { type ContentBlock, type LayoutLine, type LayoutRun, type Overflow, type Rect, type SourceGlyphOccurrence, type SourcePositionedGlyph, type TextRegion } from '../core/model';
import { SourceFontFaceMetrics } from './source-fonts';

export interface SourceCurrentGeometry {readonly glyphs:readonly SourcePositionedGlyph[];readonly baseline:number;readonly fontSize:number}

/** Fixed-line source layout. Baseline graph is immutable even when draft wording changes. */
export function layoutSourceRegion(region: TextRegion, block: ContentBlock | undefined, face: SourceFontFaceMetrics,current?:SourceCurrentGeometry): { line: LayoutLine; ink: Rect[]; inkOccurrences:(SourceGlyphOccurrence|undefined)[]; issues: Pick<Overflow,'code'|'message'|'required'|'available'>[] } {
  const source=current?{...region.sourceLayout!,baseline:current.baseline,fontSize:current.fontSize}:region.sourceLayout!,b=region.bounds,size=source.fontSize,issues:Pick<Overflow,'code'|'message'|'required'|'available'>[]=[];
  const inputRuns=block?.runs??[],requested=current&&inputRuns.length?[{...inputRuns[0],text:inputRuns.map(r=>r.text).join('')}]:inputRuns,text=requested.map(run=>run.text).join(''),unchanged=text===sourceGlyphText(region),baselineStyle=source.version===2?source.baselineStyle:face.editorStyle;
  if(!block)issues.push({code:'asset',message:'The source text block is missing.'});
  if(requested.some(run=>(run.bold ?? region.style.fontWeight===700)!==(baselineStyle.fontWeight===700)||(run.italic ?? region.style.italic)!==baselineStyle.italic))issues.push({code:'glyph',message:'This source span has no proved requested font variant. Retain its original bold and italic style.'});
  if(/[\r\n]/.test(text))issues.push({code:'height',message:'This source target is one fixed line. Remove line breaks; its approved bounds cannot wrap or grow.'});
  if(requested.some(run=>/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(run.text)))issues.push({code:'glyph',message:'A source run boundary splits a Unicode scalar. Retain complete characters within each mark or link range.'});
  if(source.version!==1&&source.editPolicy==='baselineOnly'&&!unchanged)issues.push({code:'glyph',message:'This source region retains source geometry with an unproved editable mapping. Its original text remains readable; editing is unavailable until that mapping is proved.'});
  const unsupported=unchanged?[]:face.unsupportedCharacters(text);
  if(unsupported.length)issues.push({code:'glyph',message:`This source font has no proved glyph and PDF advance for ${unsupported.map(c=>`U+${c.codePointAt(0)!.toString(16).toUpperCase()}`).join(', ')}. Choose characters already supported by this source face.`});
  // Marks, links and fact partitions do not move unchanged source wording.
  let glyphs:SourcePositionedGlyph[];
  if(current)glyphs=current.glyphs.map(g=>({...g}));
  else if(unchanged)glyphs=Array.from(sourceGlyphs(region),glyph=>({...glyph}));
  else {
    let x=0;const spacing=sourceCharacterSpacing(source);
    glyphs=Array.from(text).flatMap(char=>{const map=face.mapping(char);if(!map)return [];const advance=map.pdfWidth*size/1000,glyph={fontId:face.asset.id,cid:map.cid,unicode:char,x,advance,operatorIndex:0};if(source.version===3&&advance+spacing<=0)issues.push({code:'glyph',message:'This candidate has a nonpositive character step at the original spacing. Choose different covered wording; spacing cannot change.'});x+=advance+spacing;return [glyph];});
    const visibleWidth=glyphs.length?x-spacing:0;
    const start=source.anchor==='end'?source.endX-visibleWidth:source.startX;
    glyphs.forEach(glyph=>{glyph.x+=start;});
  }
  const start=glyphs[0]?.x ?? source.startX,end=glyphs.length?glyphs.at(-1)!.x+glyphs.at(-1)!.advance:start,width=end-start;
  const runs:LayoutRun[]=[],ink:Rect[]=[],inkOccurrences:(SourceGlyphOccurrence|undefined)[]=[],scale=size/face.font.unitsPerEm;
  let offset=0,glyphOffset=0,glyphIndex=0;
  for(const run of requested) {
    const endOffset=offset+run.text.length,owned:SourcePositionedGlyph[]=[];
    while(glyphIndex<glyphs.length&&glyphOffset<endOffset) {const glyph=glyphs[glyphIndex++];owned.push(glyph);glyphOffset+=glyph.unicode.length;}
    if(glyphOffset>endOffset)issues.push({code:'glyph',message:'A source ligature cannot be split by an underline, link or run boundary. Keep its complete Unicode sequence in one run.'});
    const x=owned[0]?.x ?? runs.at(-1)?.x ?? start,runEnd=owned.length?owned.at(-1)!.x+owned.at(-1)!.advance:x;
    runs.push({text:run.text,x,width:runEnd-x,bold:baselineStyle.fontWeight===700,italic:baselineStyle.italic,underline:!!run.underline,...(run.href?{href:run.href}:{}),sourceFontId:face.asset.id,sourceGlyphs:owned});
    if(run.underline&&runEnd>x){inkOccurrences.push(undefined);ink.push({x,y:source.baseline+face.underlineOffset(size)-face.underlineThickness(size)/2,width:runEnd-x,height:face.underlineThickness(size)});}
    offset=endOffset;
  }
  for(const [glyphOrdinal,glyph] of glyphs.entries()) {
    const map=face.asset.glyphMap.find(map=>map.cid===glyph.cid);
    if(!map){issues.push({code:'glyph',message:'A source glyph CID is missing its verified map.'});continue;}
    if(map.nonPainting)continue;
    const box=sourceOutlineBox(face.font.getGlyph(map.glyphId).path,sourceShear(source));
    inkOccurrences.push(unchanged&&!current?{regionId:region.id,glyphOrdinal}:undefined);
    ink.push(source.version===6?rotatedSourceInk(face.font.getGlyph(map.glyphId).path,source.rotation,glyph.x,source.baseline,scale):{x:glyph.x+box.minX*scale,y:source.baseline-box.maxY*scale,width:box.width*scale,height:box.height*scale});
  }
  const maxRight=Math.max(source.version===6?b.x:end,...ink.map(rect=>rect.x+rect.width)),minLeft=Math.min(source.version===6?b.x+b.width:start,...ink.map(rect=>rect.x));
  if(source.version!==6&&(end>b.x+b.width+.01||start<b.x-.01)||minLeft<b.x-.01||maxRight>b.x+b.width+.01)issues.push({code:'width',message:'The source line exceeds its fixed approved width. Shorten the wording; source size and anchor stay fixed.',required:maxRight-Math.min(b.x,minLeft),available:b.width});
  if(ink.some(rect=>rect.y<b.y-.01||rect.y+rect.height>b.y+b.height+.01))issues.push({code:'height',message:'The source glyph or underline ink exceeds its fixed approved height.'});
  return {line:{baseline:source.baseline,runs,width},ink,inkOccurrences,issues};
}
