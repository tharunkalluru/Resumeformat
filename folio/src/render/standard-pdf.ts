import {PDFOperator,PDFOperatorNames,PDFHexString,pushGraphicsState,popGraphicsState,type PDFPage,type PDFRef} from 'pdf-lib';
import type {SourceStandardFont,SourceStandardLayout,SourceStandardGlyph} from '../core/model';
import {FolioError} from '../core/errors';
import {pdfDecimal} from './pdf-decimal';

/** Rebuild a text show from selectors and numeric glyph geometry. Keeping the
 * transform factors and local cursor avoids changing consumer float hinting.
 * No original show strings, operators, streams or resources are retained. */
export function paintStandardGlyphs(page:PDFPage,ref:PDFRef,asset:SourceStandardFont,source:SourceStandardLayout,glyphs:SourceStandardGlyph[],baseline:number,fontSize:number):void {
 const name=page.node.newFontDictionary('FolioStandard',ref),linear=source.linearMatrix,frame=source.coordinateFrame,nominal=source.nominalFontSize;
 const spacing=frame?.characterSpacing??source.characterSpacing/linear[0];
 const local=(glyph:SourceStandardGlyph)=>{
  if(!frame)return glyph.x/linear[0];
  const expectedX=(frame.ctm[0]*frame.textMatrix[0])*glyph.textX!+(frame.ctm[0]*frame.textMatrix[4]+frame.ctm[4]);
  if(glyph.textX===undefined||glyph.x!==expectedX)throw new FolioError('PDF_STANDARD_FONT','The standard glyph has inconsistent local and page coordinates.');
  return glyph.textX;
 };
 const parts:(PDFHexString|string)[]=[];let encoded='',cursor=glyphs[0]?local(glyphs[0]):0;
 for(const glyph of glyphs){
  const map=asset.glyphMap.find(m=>m.code===glyph.code);
  if(!map||map.unicode!==glyph.unicode||Math.abs(glyph.advance-map.pdfWidth*fontSize/1000)>.000001)throw new FolioError('PDF_STANDARD_FONT','The current standard glyph code, Unicode or width is unproved.');
  const gap=local(glyph)-cursor;
  if(gap!==0){if(encoded){parts.push(PDFHexString.of(encoded));encoded='';}parts.push(pdfDecimal(-gap*1000/nominal));}
  encoded+=glyph.code.toString(16).padStart(2,'0');cursor=local(glyph)+(map.pdfWidth*nominal/1000+spacing);
 }
 if(encoded)parts.push(PDFHexString.of(encoded));
 page.pushOperators(pushGraphicsState(),
  ...(frame?[PDFOperator.of(PDFOperatorNames.ConcatTransformationMatrix,frame.ctm.map(pdfDecimal))]:[]),
  PDFOperator.of(PDFOperatorNames.BeginText,[]),
  PDFOperator.of(PDFOperatorNames.SetFontAndSize,[name,pdfDecimal(nominal)]),
  PDFOperator.of(source.colorSpace==='DeviceGray'?PDFOperatorNames.NonStrokingColorGray:PDFOperatorNames.NonStrokingColorRgb,source.colorComponents.map(pdfDecimal)),
  PDFOperator.of(PDFOperatorNames.SetCharacterSpacing,[pdfDecimal(spacing)]),
  ...(frame?[
   PDFOperator.of(PDFOperatorNames.SetTextMatrix,frame.textMatrix.map(pdfDecimal)),
   PDFOperator.of(PDFOperatorNames.MoveText,[pdfDecimal(glyphs[0]?local(glyphs[0]):frame.cursorX),pdfDecimal(frame.cursorY)]),
  ]:[PDFOperator.of(PDFOperatorNames.SetTextMatrix,[...linear,glyphs[0]?.x??0,page.getHeight()-baseline].map(pdfDecimal))]),
  PDFOperator.of(PDFOperatorNames.ShowTextAdjusted,[`[${parts.map(p=>p.toString()).join(' ')}]`]),
  PDFOperator.of(PDFOperatorNames.EndText,[]),popGraphicsState());
}
