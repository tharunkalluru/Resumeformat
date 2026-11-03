import {installNativeDescriptor} from '../import/pdf-composite-font-metrics';
import {installCffResourceSpec} from '../import/cff-resource-spec';
import {assertGeneratedCurrent,type GeneratedCurrentShow} from './licensed-current';
import {assertDocumentCurrent,type GeneratedDocumentCurrent} from './document-current';
import {assertParagraphLine,type GeneratedParagraphLine} from './source-paragraph-current';
import type {WholeTextShow} from '../import/pdf-atomic-paint';
import type {TextDecomposition} from '../import/pdf-text-decomposition';
import {pdfDecimal} from './pdf-decimal';
import {iccColorOperators} from './source-color';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, PDFOperator, PDFOperatorNames, pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setTextMatrix, showText, setFillingRgbColor,setFillingGrayscaleColor } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import type { SourceFontAsset, SourcePositionedGlyph,SourceScopedColor } from '../core/model';
import { FolioError } from '../core/errors';
import {validateSourceFontAsset} from '../layout/source-fonts';

const cidHex = (cid:number) => cid.toString(16).padStart(4,'0');
function utf16Hex(text:string):string { return Array.from({length:text.length},(_,i)=>text.charCodeAt(i).toString(16).padStart(4,'0')).join(''); }
/** Explicit CID aliases preserve real Unicode, source PDF widths and blank outlines. */
export function installSourceCidMap(document:PDFDocument,font:PDFFont,asset:SourceFontAsset):void {
  if(asset.sourceVersion===9){validateSourceFontAsset(asset);document.context.assign(font.ref,installCffResourceSpec(document.context,asset.originalCff,asset.originalProgram.bytes));return;}
  const dictionary=document.context.lookup(font.ref,PDFDict), descendant=dictionary.lookup(PDFName.of('DescendantFonts'),PDFArray).lookup(0,PDFDict);
  const widths:(number|number[])[]=[];
  if(asset.format==='opentype-cff') {
    const descriptor=descendant.lookup(PDFName.of('FontDescriptor'),PDFDict),reference=descriptor.get(PDFName.of('FontFile2'));
    if(!reference)throw new FolioError('SOURCE_FONT_CFF','The source CFF program was not embedded.');
    const stream=document.context.lookup(reference);if(!(stream instanceof PDFRawStream))throw new FolioError('SOURCE_FONT_CFF','The embedded source CFF stream is invalid.');stream.dict.set(PDFName.of('Subtype'),PDFName.of('OpenType'));
    descriptor.delete(PDFName.of('FontFile2'));descriptor.set(PDFName.of('FontFile3'),reference);descendant.set(PDFName.of('Subtype'),PDFName.of('CIDFontType0'));descendant.delete(PDFName.of('CIDToGIDMap'));
    const selectorWidths=new Map<number,number>();
    for(const map of asset.glyphMap){const previous=selectorWidths.get(map.glyphId);if(previous!==undefined&&Math.abs(previous-map.pdfWidth)>.000001)throw new FolioError('SOURCE_FONT_WIDTH_ALIAS','The source CFF selector has conflicting widths.');selectorWidths.set(map.glyphId,map.pdfWidth);}
    for(const [selector,width] of selectorWidths)widths.push(selector,[width]);
    const batches:string[]=[];for(let start=0;start<asset.glyphMap.length;start+=100){const batch=asset.glyphMap.slice(start,start+100);batches.push(`${batch.length} begincidchar\n${batch.map(map=>`<${cidHex(map.cid)}> ${map.glyphId}`).join('\n')}\nendcidchar`);}
    const encoding=`/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def\n/CMapName /FolioSourceEncoding def\n/CMapType 1 def\n/WMode 0 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${batches.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
    dictionary.set(PDFName.of('Encoding'),document.context.register(document.context.flateStream(encoding)));
  } else {
    const originalOwned=asset.sourceVersion===4||asset.sourceVersion===5||asset.sourceVersion===6||asset.sourceVersion===7||asset.sourceVersion===8||asset.sourceVersion===10||asset.sourceVersion===11;
    if(originalOwned){
      // The original and converter programs have proved equal physical glyphs
      // and native advances, but converter sanitization can change hint paint.
      // Retain the exact owned original program, including its instructions.
      validateSourceFontAsset(asset);
      const proof=asset.originalProgram;if(!proof)throw new FolioError('SOURCE_FONT_ORIGINAL','Original source export requires its owned font program.');
      const descriptor=descendant.lookup(PDFName.of('FontDescriptor'),PDFDict),reference=descriptor.get(PDFName.of('FontFile2'));
      if(!(reference instanceof PDFRef)||!(document.context.lookup(reference) instanceof PDFRawStream))throw new FolioError('SOURCE_FONT_ORIGINAL','The original source export has no bounded TrueType stream.');
      document.context.assign(reference,document.context.flateStream(proof.bytes,{Length1:proof.bytes.length}));
      if(asset.sourceVersion===7&&(asset.groupedDescriptor||asset.namelessDescriptor))installNativeDescriptor(document,font.ref,asset.groupedDescriptor??asset.namelessDescriptor!);
      if(asset.sourceVersion===7){descriptor.set(PDFName.of('Flags'),document.context.obj(asset.declaredStyle.descriptor.flags));descriptor.set(PDFName.of('ItalicAngle'),document.context.obj(asset.declaredStyle.descriptor.italicAngle));}
    }
    const max=Math.max(0,...asset.glyphMap.map(map=>map.cid)),gids=new Uint8Array((max+1)*2),view=new DataView(gids.buffer);
    for(const map of asset.glyphMap){view.setUint16(map.cid*2,originalOwned?map.originalGlyphId!:map.glyphId);widths.push(map.cid,[map.pdfWidth]);}
    descendant.set(PDFName.of('CIDToGIDMap'),document.context.register(document.context.flateStream(gids)));
  }
  descendant.set(PDFName.of('W'),document.context.obj(widths));descendant.set(PDFName.of('DW'),document.context.obj(0));
  const chunks:string[]=[];
  for(let start=0;start<asset.glyphMap.length;start+=100) { const batch=asset.glyphMap.slice(start,start+100);chunks.push(`${batch.length} beginbfchar\n${batch.map(map=>`<${cidHex(map.cid)}> <${utf16Hex(map.unicode)}>`).join('\n')}\nendbfchar`); }
  const cmap=`/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Folio) /Ordering (Unicode) /Supplement 0 >> def\n/CMapName /FolioSourceUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${chunks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
  dictionary.set(PDFName.of('ToUnicode'),document.context.register(document.context.flateStream(cmap)));
}
export function paintSourceGlyphs(page:PDFPage,font:PDFFont,asset:SourceFontAsset,glyphs:readonly SourcePositionedGlyph[],baseline:number,size:number,color:string,sourceColor?:SourceScopedColor,sourceIccKey?:PDFName,decomposition?:TextDecomposition,wholeShow?:WholeTextShow,generated?:GeneratedCurrentShow|GeneratedParagraphLine|GeneratedDocumentCurrent):void {
  if(!/^#[\da-f]{6}$/i.test(color))throw new FolioError('SOURCE_FONT_PAINT','The source span color is invalid.');
  const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255);
  if(sourceColor&&(!sourceColor.components.every(c=>Number.isFinite(c)&&c>=0&&c<=1)||sourceColor.components.length!==(sourceColor.space==='DeviceGray'?1:3)))throw new FolioError('SOURCE_FONT_PAINT','The original device color is invalid.');
  for(const glyph of glyphs) {
    if(glyph.fontId!==asset.id||!asset.glyphMap.some(map=>map.cid===glyph.cid&&map.unicode===glyph.unicode))throw new FolioError('SOURCE_FONT_MAP','The canonical glyph graph is not bound to its source font.');
  }
  if(!glyphs.length)return;
  const selector=(cid:number)=>{if(asset.sourceVersion!==9)return cidHex(cid);const mapping=asset.glyphMap.find(m=>m.cid===cid);if(!mapping||!Number.isInteger(mapping.originalCharCode))throw new FolioError('SOURCE_CFF_RESOURCE','Original CFF selector missing.');return mapping.originalCharCode!.toString(16).padStart(asset.originalCff.selectorBytes*2,'0');};
  const key=page.node.newFontDictionary('FolioSource',font.ref);
  if(sourceColor?.space==='ICCBased'&&!sourceIccKey)throw new FolioError('PDF_ICC_PROOF','The original ICC paint has no source-bound output resource.');
  const paintColor=sourceColor?.space==='ICCBased'?undefined:sourceColor?.space==='DeviceGray'?setFillingGrayscaleColor(sourceColor.components[0]):setFillingRgbColor(...(sourceColor?sourceColor.components:rgb) as [number,number,number]);
  // Keep each existing run isolated. Absolute matrices preserve every original
  // glyph position without depending on the advance of the preceding Tj.
  if(decomposition){
    const d=decomposition,c=d.ctm,m=d.linearTextMatrix;
    if(!generated&&d.effectiveFontSize!==size||c.length!==6||m.length!==4||c[1]!==0||c[2]!==0||!c[0]||!c[3]||m[1]!==0||m[2]!==0||!m[0]||!m[3]||d.nominalFontSize<=0||d.nominalFontSize>144)throw new FolioError('PDF_TEXT_DECOMPOSITION','The verified matrix cannot paint this run.');
    if(generated){
     if(generated.kind==='generated-source-paragraph-v1')assertParagraphLine(generated,asset,glyphs);else if(generated.kind==='generated-document-current-v1')assertDocumentCurrent(generated,asset,glyphs);else assertGeneratedCurrent(generated,asset,glyphs);if(wholeShow||generated.fontSize!==size||generated.baseline!==baseline)throw new FolioError('PDF_LICENSED_CONTENT','Generated current geometry differs from its paint owner.');
     page.pushOperators(pushGraphicsState(),PDFOperator.of(PDFOperatorNames.ConcatTransformationMatrix,generated.ctm.map(pdfDecimal)),beginText(),...(sourceColor?.space==='ICCBased'?iccColorOperators(sourceIccKey!,sourceColor.components):[paintColor!]),PDFOperator.of(PDFOperatorNames.SetFontAndSize,[key,pdfDecimal(generated.nominalFontSize)]),PDFOperator.of(PDFOperatorNames.SetCharacterSpacing,[pdfDecimal(generated.characterSpacing)]),PDFOperator.of(PDFOperatorNames.SetWordSpacing,['0']),PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling,['100']),PDFOperator.of(PDFOperatorNames.SetTextRise,['0']),PDFOperator.of(PDFOperatorNames.SetTextRenderingMode,['0']),PDFOperator.of(PDFOperatorNames.SetTextMatrix,generated.textMatrix.map(pdfDecimal)),showText(PDFHexString.of(glyphs.map(g=>selector(g.cid)).join(''))),endText(),popGraphicsState());return;
    }
    if(wholeShow){
     if(wholeShow.operatorIndex!==d.operatorIndex||wholeShow.rawOperatorIndex!==d.rawOperatorIndex||wholeShow.codes.length!==glyphs.length||wholeShow.fullTextMatrix.slice(0,4).some((v,i)=>v!==m[i])||!Number.isFinite(wholeShow.characterSpacing)||Math.abs(wholeShow.characterSpacing)>d.nominalFontSize)throw new FolioError('PDF_ATOMIC_PAINT','The whole show differs from its matrix owner.');
     let cursor=0;const pieces=wholeShow.parts.map(part=>typeof part==='number'?pdfDecimal(part):'<'+part.map(code=>{const glyph=glyphs[cursor++],mapping=asset.glyphMap.find(m=>m.cid===glyph?.cid);if(!glyph||mapping?.originalCharCode!==code)throw new FolioError('PDF_ATOMIC_PAINT','The adjusted show selector differs.');return selector(glyph.cid);}).join('')+'>');if(cursor!==glyphs.length)throw new FolioError('PDF_ATOMIC_PAINT','The adjusted show is incomplete.');
     const showOperator=wholeShow.kind==='TJ'?PDFOperator.of(PDFOperatorNames.ShowTextAdjusted,['['+pieces.join(' ')+']']):showText(PDFHexString.of(glyphs.map(g=>selector(g.cid)).join('')));
     page.pushOperators(pushGraphicsState(),PDFOperator.of(PDFOperatorNames.ConcatTransformationMatrix,c.map(pdfDecimal)),beginText(),...(sourceColor?.space==='ICCBased'?iccColorOperators(sourceIccKey!,sourceColor.components):[paintColor!]),PDFOperator.of(PDFOperatorNames.SetFontAndSize,[key,pdfDecimal(d.nominalFontSize)]),PDFOperator.of(PDFOperatorNames.SetCharacterSpacing,[pdfDecimal(wholeShow.characterSpacing)]),PDFOperator.of(PDFOperatorNames.SetWordSpacing,['0']),PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling,['100']),PDFOperator.of(PDFOperatorNames.SetTextRise,['0']),PDFOperator.of(PDFOperatorNames.SetTextRenderingMode,['0']),PDFOperator.of(PDFOperatorNames.SetTextMatrix,wholeShow.fullTextMatrix.map(pdfDecimal)),showOperator,endText(),popGraphicsState());return;
    }
    const matrices=glyphs.map(g=>[...m,(g.x-c[4])/c[0],(page.getHeight()-baseline-c[5])/c[3]].map(pdfDecimal)),ctm=c.map(pdfDecimal),nominal=pdfDecimal(d.nominalFontSize);
    page.pushOperators(pushGraphicsState(),PDFOperator.of(PDFOperatorNames.ConcatTransformationMatrix,ctm),beginText(),...(sourceColor?.space==='ICCBased'?iccColorOperators(sourceIccKey!,sourceColor.components):[paintColor!]),PDFOperator.of(PDFOperatorNames.SetFontAndSize,[key,nominal]));
    for(let i=0;i<glyphs.length;i++)page.pushOperators(PDFOperator.of(PDFOperatorNames.SetTextMatrix,matrices[i]),showText(PDFHexString.of(selector(glyphs[i].cid))));
    page.pushOperators(endText(),popGraphicsState());return;
  }
  page.pushOperators(beginText(),...(sourceColor?.space==='ICCBased'?iccColorOperators(sourceIccKey!,sourceColor.components):[paintColor!]),setFontAndSize(key,size));
  for(const glyph of glyphs)page.pushOperators(setTextMatrix(1,0,0,1,glyph.x,page.getHeight()-baseline),showText(PDFHexString.of(selector(glyph.cid))));
  page.pushOperators(endText());
}
