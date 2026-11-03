import {rightAngleSourceBasis,sourceRotationLocal,type SourceRotation} from '../layout/source-rotation';
import {associateNamelessSourceItems} from './pdf-nameless-source';
import {PDFDocument,PDFRef} from 'pdf-lib';
import {proveOriginalCffResource,proveOriginalCffOccurrence,type OriginalCffResource} from './pdf-original-cff';
import {captureCffResourceSpec,originalCffProgramBytes} from './cff-resource-spec';
import {selectedOriginalFonts,bindSelectedOriginalFonts} from './pdf-selected-fonts';
import { OPS, Util, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { newId, sha256Sync, type SourceFontAsset, type SourceGlyphMapping, type SourcePositionedGlyph, type SourceFontAssetV2, type SourceGlyphMappingV2 } from '../core/model';
import { FolioError } from '../core/errors';
import type { Font } from '@pdf-lib/fontkit';
import { parseSourceProgram, sourceProgramStyle, sourceProgramNumericalStyle, sourceCffDeclaredStyle,restoreOriginalTrueTypePermissions,sourceGlyphHasEncoding } from '../layout/source-fonts';
import {originalTrueTypeBindings,type OriginalTrueTypeProof} from './pdf-original-tt';
import {proveLicensedCatalogueSubsets} from './pdf-catalogue-subset';
import type {PdfFontIdentity} from './pdf-fonts';
import {usesOnlyNonembeddedStandardFonts} from './pdf-standard-fonts';
import {isTrustedLegacyTrueTypeProgram} from '../layout/legacy-tt-program';
import {preflightPdfImages} from './pdf-image-preflight';
import {originalHorizontalShear} from '../layout/source-shear';
import {exactTrueTypeFillOutline} from '../layout/source-outline';
import {hasInterShowSemanticPair,recordInterShowSemanticUse,type InterShowSemanticProof} from './pdf-semantic-gap';

type Matrix = number[];
interface SourceResource { name?: string; data?: Uint8Array; fontMatrix?: number[]; defaultEncoding?:string[]; widths?:Record<number,number>; isType3Font?: boolean; vertical?: boolean; missingFile?: boolean; remeasure?: boolean }
export interface SourcePaintGlyph extends SourcePositionedGlyph { resource: string; baseline: number; size: number; color: string; characterSpacing?:number; shearX?:number; rotation?:SourceRotation; shapeOnly?:true;glyphId?:number;fontChar?:number;originalCharCode?:number|null }
interface State { ctm: Matrix; tm: Matrix; x: number; y: number; lineX: number; lineY: number; leading: number; size: number; font: string; color: string; rise: number; hScale: number; charSpacing: number; wordSpacing: number; mode: number }
const initial = (): State => ({ ctm:[1,0,0,1,0,0],tm:[1,0,0,1,0,0],x:0,y:0,lineX:0,lineY:0,leading:0,size:0,font:'',color:'#000000',rise:0,hScale:1,charSpacing:0,wordSpacing:0,mode:0 });
const fail = (message: string): never => { throw new FolioError('PDF_SOURCE_PROOF', message); };
const close = (a: number,b: number) => Math.abs(a-b) <= .025;
function glyphMapping(asset: SourceFontAsset, raw: any, font: Font, original?:OriginalTrueTypeProof,cff?:OriginalCffResource): SourceGlyphMapping {
  if (!raw || typeof raw !== 'object' || typeof raw.unicode !== 'string' || (asset.format==='truetype'?(asset.sourceVersion===11?!['ff','fi','fl','ffi','ffl','st'].includes(raw.unicode)&&Array.from(raw.unicode).length!==1:Array.from(raw.unicode).length!==1):Array.from(raw.unicode).length<1||Array.from(raw.unicode).length>16)||/[\p{Control}\p{Format}\p{Surrogate}]/u.test(raw.unicode) || typeof raw.fontChar !== 'string' || Array.from(raw.fontChar).length !== 1 || raw.accent || !Number.isFinite(raw.width) || raw.width < 0 || raw.width > 10000) return fail('A source glyph lacks an exact supported Unicode, outline or advance mapping.');
  const fontChar = raw.fontChar.codePointAt(0)!;
  let glyphId:number,originalGlyphId:number|undefined,nativeWidth:number|undefined,nonPainting=!raw.isInFont,selectorProvenance:SourceGlyphMapping['selectorProvenance'];
  if(asset.format==='opentype-cff') {
    if(asset.sourceVersion===9){if(!cff||!Number.isInteger(raw.originalCharCode))return fail('Original CFF selector absent.');const proof=proveOriginalCffOccurrence(cff,raw.originalCharCode);if(proof.unicode!==raw.unicode||Math.abs(proof.pdfWidth-raw.width)>.00001)return fail('Original CFF semantic or PDF advance differs.');originalGlyphId=proof.originalGID;nativeWidth=proof.nativeWidth;}
    glyphId=font.glyphForCodePoint(fontChar).id;
    const empty=font.getGlyph(glyphId).path.toSVG()==='';
    if(empty) {if(raw.unicode!==' '||asset.sourceVersion!==9&&glyphId!==0)return fail('CFF concealed text or nonzero empty source glyph is unproved.');nonPainting=true;}
    else if(nonPainting||!glyphId)return fail('A CFF painted source glyph has no verified outline or paint ownership.');
  } else if((asset.sourceVersion===4||asset.sourceVersion===5||asset.sourceVersion===6||asset.sourceVersion===7||asset.sourceVersion===8||asset.sourceVersion===10||asset.sourceVersion===11)) {
    const code=raw.originalCharCode;
    if(!original||!Number.isInteger(code)||code<1||code>65535||original.unicode.get(code)!==raw.unicode||!Number.isFinite(original.widths.get(code)??original.defaultWidth)||Math.abs((original.widths.get(code)??original.defaultWidth)-raw.width)>.00001)return fail('A source glyph has no original selector, Unicode and PDF-width ownership.');
    originalGlyphId=original.selectorContract==='identity-h-v1'?code:original.glyphIds?.get(code)?.glyphId;
    if(!originalGlyphId||originalGlyphId>=original.font.numGlyphs)return fail('The source physical selector has no positive original glyph.');
    glyphId=nonPainting?originalGlyphId:font.glyphForCodePoint(fontChar).id;
    if(glyphId<=0||glyphId>=font.numGlyphs)return fail('The converted physical selector is not a positive glyph.');
    const sourceGlyph=original.font.getGlyph(originalGlyphId),converted=font.getGlyph(glyphId);
    if(original.documentScoped?.post===null&&(raw.unicode!==' '||!nonPainting)&&(!original.namelessDescriptor||asset.sourceVersion!==7||original.selectorContract!=='symbolic-raw-byte-1-0-format6-v1'))return fail('An absent-post outlined glyph requires exact original symbolic selector and numeric descriptor ownership.');
    if((asset.sourceVersion===7||asset.sourceVersion===8||asset.sourceVersion===10||asset.sourceVersion===11)&&raw.unicode===' '&&sourceGlyph.path.toSVG())return fail('A document-scoped space selector contains original ink.');
    nativeWidth=sourceGlyph.advanceWidth*1000/original.font.unitsPerEm;
    const semanticNbsp=nonPainting&&raw.unicode==='\u00a0'&&raw.width>0&&nativeWidth>0&&!sourceGlyph.path.toSVG()&&!converted.path.toSVG()&&Math.abs(converted.advanceWidth*1000/font.unitsPerEm-nativeWidth)<=.00001;
    const unencodedBlank=nonPainting&&(raw.unicode===' '||semanticNbsp)&&raw.width>0&&glyphId===originalGlyphId&&font.glyphForCodePoint(fontChar).id===0&&!sourceGlyph.path.toSVG()&&!converted.path.toSVG()&&!sourceGlyphHasEncoding(font,glyphId);
    if(!exactTrueTypeFillOutline(sourceGlyph.path,converted.path)||Math.abs(converted.advanceWidth*1000/font.unitsPerEm-nativeWidth)>.00001||(nonPainting?raw.unicode!==' '&&!semanticNbsp||!!converted.path.toSVG():!converted.path.toSVG()))return fail('A source glyph lacks exact original and converted outline or immutable native advance proof.');
    if(asset.sourceVersion===7&&original.documentScoped?.post===null&&!nonPainting)asset.namelessDescriptor=structuredClone(original.namelessDescriptor!);
    if(semanticNbsp){
      if(original.selectorContract!=='identity-h-v1')return fail('A nonbreaking blank needs exact original Identity-H ownership.');
      const numeric=sourceProgramNumericalStyle(original.font);Object.assign(asset,{sourceVersion:10,capability:'original-tt-numeric-style-v1',...numeric,semanticBlankPolicy:'original-space-and-nbsp-v1'});asset.originalProgram!.selectorContract='identity-h-v1';
      for(const prior of asset.glyphMap){prior.nativeWidth=original.font.getGlyph(prior.originalGlyphId!).advanceWidth*1000/original.font.unitsPerEm;if(prior.selectorProvenance)prior.selectorProvenance='original-positive-blank-v2';}
    }
    const needsV6=original.requiresV6||Math.abs(nativeWidth-raw.width)>.00001||!unencodedBlank&&original.font.glyphForCodePoint(raw.unicode.codePointAt(0)).id!==originalGlyphId;
    if(asset.sourceVersion===7||asset.sourceVersion===8||asset.sourceVersion===10){if(unencodedBlank)selectorProvenance='original-positive-blank-v2';}
    else if(asset.sourceVersion===11){if(!original.requiresV11||original.selectorContract!=='identity-h-v1')return fail('Ligature source class lacks its original declaration owner.');if(unencodedBlank)selectorProvenance='original-positive-blank-v2';}
    else if(needsV6||asset.sourceVersion===6){
      if(asset.sourceVersion!==6){asset.sourceVersion=6;for(const prior of asset.glyphMap){prior.nativeWidth=original.font.getGlyph(prior.originalGlyphId!).advanceWidth*1000/original.font.unitsPerEm;if(prior.selectorProvenance)prior.selectorProvenance='original-positive-blank-v2';}}
      if(original.selectorContract==='macroman-1-0-format6-v1'||original.selectorContract==='symbolic-raw-byte-1-0-format6-v1')return fail('A document-scoped selector cannot be downgraded.');asset.originalProgram!.selectorContract=original.selectorContract;
      if(unencodedBlank)selectorProvenance='original-positive-blank-v2';
    }else{nativeWidth=undefined;if(unencodedBlank){asset.sourceVersion=5;selectorProvenance='original-identity-positive-blank-v1';}}
  } else if(nonPainting) {
    // PDF.js retains a PDF character code for omitted empty outlines. A CID
    // exporter can renumber that code; it is not a painted cmap selector.
    if(raw.unicode!==' '||raw.width!==226)return fail('A nonpainting source glyph is not the proved Carlito blank-space mapping.');
    glyphId=2;if(font.getGlyph(glyphId).path.toSVG().length)return fail('The source blank-space glyph contains visible ink.');
  } else {glyphId=font.glyphForCodePoint(fontChar).id;if(!glyphId||!font.getGlyph(glyphId).path.toSVG().length)return fail('A painted source glyph has no verified outline.');}
  let map = asset.glyphMap.find(entry => entry.unicode === raw.unicode && entry.glyphId === glyphId && entry.fontChar === fontChar && entry.pdfWidth === raw.width && entry.nonPainting === nonPainting && (asset.sourceVersion!==9||entry.originalCharCode===raw.originalCharCode) && (asset.format!=='truetype'||asset.sourceVersion!==6&&asset.sourceVersion!==11&&asset.sourceVersion!==7&&asset.sourceVersion!==8||entry.originalCharCode===raw.originalCharCode));
  if (!map) { if (asset.glyphMap.length >= 65535) return fail('The source font glyph map exceeds its CID limit.'); map = { cid:asset.glyphMap.length+1,glyphId,fontChar,unicode:raw.unicode,pdfWidth:raw.width,nonPainting,...(selectorProvenance?{selectorProvenance}:{}),...(nativeWidth!==undefined?{nativeWidth}:{}),...((asset.sourceVersion===9||asset.format==='truetype'&&(asset.sourceVersion===4||asset.sourceVersion===5||asset.sourceVersion===6||asset.sourceVersion===7||asset.sourceVersion===8||asset.sourceVersion===10||asset.sourceVersion===11))?{originalGlyphId,originalCharCode:raw.originalCharCode}:{}),...(asset.format==='opentype-cff'?{editPolicy:((asset.sourceVersion===9||!nonPainting)&&Array.from(raw.unicode).length===1?'coveredScalar':'baselineOnly') as 'coveredScalar'|'baselineOnly',widthProvenance:'sourceGlyph' as const}: {}) }; (asset.glyphMap as SourceGlyphMapping[]).push(map); }
  return map;
}
/** Version-coupled, bounded PDF.js 6.4.299 adapter. No source page copying. */
export async function captureSourceGlyphs(page: PDFPageProxy, viewport: Matrix, sourceHash: string, assets: SourceFontAsset[],sourceBytes?:Uint8Array,pageNumber=1,catalogueFaces?:Map<string,PdfFontIdentity>,allowRotation=false): Promise<SourcePaintGlyph[] | undefined> {
  if(sourceBytes)await preflightPdfImages(sourceBytes);
  const selected=sourceBytes?(await selectedOriginalFonts(sourceBytes)).find(p=>p.pageNumber===pageNumber):undefined;
  const unsupported=():undefined=>{if(selected?.events.length)return fail('A selected source font cannot fall back to decoder or catalogue metrics.');return undefined;};
  const ops = await page.getOperatorList();
  if(sourceBytes&&await usesOnlyNonembeddedStandardFonts(sourceBytes,pageNumber,ops,true))return undefined;
  if(selected){if(selected.events.length&&!selected.embedded)return fail('A decoder-provided font program has no embedded original source owner.');bindSelectedOriginalFonts(selected,ops);}
  const resources = new Map<string, SourceResource>();
  for (let i=0;i<ops.fnArray.length;i++) if (ops.fnArray[i] === OPS.setFont) {
    const name = String(ops.argsArray[i][0]);
    try { resources.set(name, page.commonObjs.get(name) as SourceResource); } catch { return unsupported(); }
  }
  if (!resources.size || [...resources.values()].some(r => !r?.data || r.data.byteLength < 12)) return unsupported();
  // Direction stays with the existing explicit PDF direction/refusal path.
  // Vertical text never receives a horizontal source-font qualification.
  if([...resources.values()].some(resource=>resource.vertical))return unsupported();
  if (resources.size > 32 || [...resources.values()].reduce((total, r) => total + r.data!.byteLength, 0) > 16 * 1024 * 1024) return fail('The source font inventory exceeds its local resource budget.');
  
  // A PDF resource name is an arbitrary alias, including in our own exports.
  // Admit by the validated embedded program, never by a Folio name prefix.
  const programs = new Map<string, Font>();
  for (const [resource, r] of resources) {
    const format = new DataView(r.data!.buffer, r.data!.byteOffset, r.data!.byteLength).getUint32(0) === 0x4f54544f ? 'opentype-cff' : 'truetype';
    const font = parseSourceProgram(r.data!, format);
    programs.set(resource, font);
  }
  const needsOriginal=[...programs].some(([resource,font])=>new DataView(resources.get(resource)!.data!.buffer,resources.get(resource)!.data!.byteOffset,resources.get(resource)!.data!.byteLength).getUint32(0)===0x00010000&&!isTrustedLegacyTrueTypeProgram(resources.get(resource)!.data!));
  // New families require actual original-resource proof; legacy Carlito/CFF stays bounded.
  let originals:Map<string,OriginalTrueTypeProof>|undefined;
  if(needsOriginal&&sourceBytes){try{originals=await originalTrueTypeBindings(page,sourceBytes,pageNumber,ops);}catch(error){
    const matched=await proveLicensedCatalogueSubsets(page,sourceBytes,pageNumber,ops);
    if(!matched)throw error;originals=new Map([...matched].map(([resource,proof])=>[resource,proof.original]));
  }}
  if(needsOriginal&&!originals)return unsupported();
  const cffOriginals=new Map<string,OriginalCffResource>();const cffSpecs=new Map<string,ReturnType<typeof captureCffResourceSpec>>();
  if([...resources.values()].some(r=>new DataView(r.data!.buffer,r.data!.byteOffset).getUint32(0)===0x4f54544f)){if(!sourceBytes||!selected)return unsupported();const originalDocument=await PDFDocument.load(new Uint8Array(sourceBytes));let selectedIndex=0;for(let i=0;i<ops.fnArray.length;i++)if(ops.fnArray[i]===OPS.setFont){const name=String(ops.argsArray[i][0]),reference=selected.refs?.[selectedIndex++];if(!reference)return unsupported();if(new DataView(resources.get(name)!.data!.buffer,resources.get(name)!.data!.byteOffset).getUint32(0)!==0x4f54544f||cffOriginals.has(name))continue;const [object,generation]=reference.split(' ').map(Number),ref=PDFRef.of(object,generation),proof=proveOriginalCffResource(originalDocument,ref,sourceHash);if(!proof)return fail('Converted CFF lacks its original Type1C owner.');cffOriginals.set(name,proof);cffSpecs.set(name,captureCffResourceSpec(originalDocument,ref,proof));}}
  const faceByResource = new Map<string, SourceFontAsset>();
  for (const [resource,r] of resources) {
    if (!resource || resource.length>128 || /[\u0000-\u001f\u007f-\u009f]/.test(resource) || !r.data || r.isType3Font || r.vertical || r.missingFile || r.remeasure || !r.fontMatrix || r.fontMatrix.length !== 6 || !r.fontMatrix.every(Number.isFinite) || Math.abs(r.fontMatrix[0]-.001)>.00000001 || Math.abs(r.fontMatrix[3]-.001)>.00000001 || r.fontMatrix.slice(1,3).some(v=>v!==0) || r.fontMatrix.slice(4).some(v=>v!==0)) return fail('The source font resource has unsupported program or matrix metadata.');
    const format=new DataView(r.data.buffer,r.data.byteOffset,r.data.byteLength).getUint32(0)===0x4f54544f?'opentype-cff':'truetype';
    const font = programs.get(resource)!;
    const original=originals?.get(resource),cff=cffOriginals.get(resource);
    if(format==='opentype-cff'&&!cff)return fail('CFF requires exact original resource ownership.');
    if(format==='truetype'&&!isTrustedLegacyTrueTypeProgram(resources.get(resource)!.data!)&&!original)return fail('This source TrueType face has no proved original resource owner.');
    const program=original&&!original.documentScoped&&!original.licensedDerivation?restoreOriginalTrueTypePermissions(r.data,original.bytes):new Uint8Array(r.data);
    const style = original?.licensedDerivation?{sourceVersion:8 as const,capability:'licensed-catalogue-subset-v1' as const,licensedDerivation:original.licensedDerivation,fontWeight:original.catalogueIdentity!.fontWeight,italic:original.catalogueIdentity!.italic}:original?.numericStyle?{sourceVersion:10 as const,capability:'original-tt-numeric-style-v1' as const,...original.numericStyle}:original?.documentScoped?{sourceVersion:7 as const,capability:'document-scoped-source-v1' as const,originalPermission:'absent' as const,registrationFaceToken:'neutral-400-normal-v1' as const,declaredStyle:original.documentScoped}:format==='truetype'?sourceProgramStyle(font):{sourceVersion:9 as const,capability:'original-cff-glyphs-v1' as const,declaredStyle:{weightClass:null,italic:null,semanticBold:'unknown' as const},originalProgram:{bytes:originalCffProgramBytes(cff!),sha256:cff!.programSha256,pdfFontRef:cff!.pdfFontRef},originalCff:cffSpecs.get(resource)!}, hash = sha256Sync(program);
    let asset = assets.find(a=>a.sourceResource === resource && a.sha256 === hash&&(!original||a.format==='truetype'&&a.originalProgram?.pdfFontRef===original.pdfFontRef&&a.originalProgram.sha256===original.sha256));
    if (!asset) { asset = { id:newId(),sourceSha256:sourceHash,sourceResource:resource,sha256:hash,bytes:program,format,unitsPerEm:font.unitsPerEm,...style,...(original?.requiresV11?{capability:'original-tt-null-ligature-v1' as const}:{}),...(original?{sourceVersion:original.licensedDerivation?8 as const:original.numericStyle?10 as const:original.documentScoped?7 as const:original.requiresV11?11 as const:original.requiresV6?6 as const:4 as const,originalProgram:{bytes:new Uint8Array(original.bytes),sha256:original.sha256,pdfFontRef:original.pdfFontRef,...(original.requiresV11||original.requiresV6||original.documentScoped||original.numericStyle?{selectorContract:original.selectorContract}:{})}}:{}),glyphMap:[] } as SourceFontAsset; assets.push(asset); }
    if(asset.format==='opentype-cff'&&asset.sourceVersion!==9&&r.defaultEncoding?.[32]==='space'&&Object.hasOwn(r.widths??{},32)&&Number.isFinite(r.widths?.[32])&&r.widths![32]>0&&!asset.glyphMap.some(m=>m.unicode===' '&&m.editPolicy==='coveredScalar'))asset.glyphMap.push({cid:asset.glyphMap.length+1,glyphId:0,fontChar:32,unicode:' ',pdfWidth:r.widths![32],nonPainting:true,editPolicy:'coveredScalar',widthProvenance:'sourceEncodingWidths'});
    if (assets.length>32 || assets.reduce((count,asset)=>count+asset.bytes.byteLength+('originalProgram'in asset?asset.originalProgram?.bytes.length??0:0),0)>16*1024*1024) return fail('The source font inventory exceeds its local resource budget.');
    faceByResource.set(resource,asset);
  }
  const graph=positionSourceGlyphs(ops,viewport,faceByResource,originals,cffOriginals,allowRotation);
  for(const asset of faceByResource.values())if(asset.format==='opentype-cff'&&asset.sourceVersion!==9&&!asset.glyphMap.some(m=>m.unicode===' '&&m.nonPainting))asset.glyphMap.push({cid:asset.glyphMap.length+1,glyphId:0,fontChar:32,unicode:' ',pdfWidth:0,nonPainting:true,editPolicy:'baselineOnly',widthProvenance:'baselineGap'});
  if(assets.some(f=>f.sourceVersion===7&&f.namelessDescriptor))for(const [resource,asset] of faceByResource){if(asset.sourceVersion===7&&asset.declaredStyle.post===null){const descriptor=originals?.get(resource)?.namelessDescriptor;if(!descriptor)return fail('Nameless page font has no original numeric descriptor.');asset.namelessDescriptor=structuredClone(descriptor);}}
  if(assets.some(f=>f.sourceVersion===7&&f.namelessDescriptor)&&assets.some(f=>f.sourceVersion===7&&f.declaredStyle.post!==null))for(const [resource,asset] of faceByResource){if(asset.sourceVersion!==7)return fail('Mixed document groups require original document-scoped fonts.');const descriptor=originals?.get(resource)?.groupedDescriptor;if(!descriptor)return fail('Grouped page font has no original numeric descriptor.');asset.groupedDescriptor=structuredClone(descriptor);}
  return graph;
}
/** Pure operator-state seam; callers must first validate resources and admission. */
export function positionSourceGlyphs(ops:{fnArray:number[];argsArray:any[][]},viewport:Matrix,faceByResource:ReadonlyMap<string,SourceFontAsset>,originals?:ReadonlyMap<string,OriginalTrueTypeProof>,cffOriginals?:ReadonlyMap<string,OriginalCffResource>,allowRotation=false):SourcePaintGlyph[] {
  if(ops.fnArray.length>100000||ops.fnArray.length!==ops.argsArray.length)return fail('The source operator inventory exceeds its bounded limit.');
  const programs=new Map([...faceByResource.values()].map(asset=>[asset.id,parseSourceProgram(asset.bytes,asset.format)]));
  let state = initial(); const stack: State[] = [], glyphs: SourcePaintGlyph[] = [];
  const copy = () => ({...state,ctm:[...state.ctm],tm:[...state.tm]});
  const move = (x:number,y:number) => { state.x=state.lineX+=x; state.y=state.lineY+=y; };
  for (let i=0;i<ops.fnArray.length;i++) {
    const op=ops.fnArray[i],args=ops.argsArray[i] as any[];
    if (op===OPS.save) stack.push(copy());
    else if(op===OPS.restore) { if(!stack.length)return fail('Source text graphics state is unbalanced.'); state=stack.pop()!; }
    else if(op===OPS.transform) state.ctm=Util.transform(state.ctm,args);
    else if(op===OPS.paintFormXObjectBegin) { stack.push(copy()); if(args[0])state.ctm=Util.transform(state.ctm,args[0]); }
    else if(op===OPS.paintFormXObjectEnd) { if(!stack.length)return fail('Source form text state is unbalanced.'); state=stack.pop()!; }
    else if(op===OPS.beginText) { state.tm=[1,0,0,1,0,0]; state.x=state.y=state.lineX=state.lineY=0; }
    else if(op===OPS.setFont) { state.font=String(args[0]);state.size=Number(args[1]); }
    else if(op===OPS.setFillRGBColor) state.color=String(args[0]);
    else if(op===OPS.setTextMatrix) {
      // PDF.js 6 carries Tm in one Float32Array; pure fixtures may use six args.
      const matrix = args.length === 1 && (args[0] instanceof Float32Array || Array.isArray(args[0])) ? Array.from(args[0]) : args;
      if (matrix.length !== 6 || !matrix.every(value => typeof value === 'number' && Number.isFinite(value))) return fail('The source text matrix is not six finite numbers.');
      state.tm = [...matrix]; state.x=state.y=state.lineX=state.lineY=0;
    }
    else if(op===OPS.moveText) move(Number(args[0]),Number(args[1]));
    else if(op===OPS.setLeading) state.leading=-Number(args[0]);
    else if(op===OPS.setLeadingMoveText) { state.leading=Number(args[1]);move(Number(args[0]),Number(args[1])); }
    else if(op===OPS.nextLine) move(0,state.leading);
    else if(op===OPS.setTextRise) state.rise=Number(args[0]);
    else if(op===OPS.setHScale) state.hScale=Number(args[0])/100;
    else if(op===OPS.setCharSpacing) state.charSpacing=Number(args[0]);
    else if(op===OPS.setWordSpacing) state.wordSpacing=Number(args[0]);
    else if(op===OPS.setTextRenderingMode) state.mode=Number(args[0]);
    else if(op===OPS.showText || op===OPS.showSpacedText || op===OPS.nextLineShowText) {
      if(op===OPS.nextLineShowText)move(0,state.leading);
      const matrix=Util.transform(Util.transform(viewport,state.ctm),state.tm), asset=faceByResource.get(state.font);
      const rotation=allowRotation?rightAngleSourceBasis(matrix):undefined,paintScale=rotation?.scale??matrix[0],rotationOrigin=rotation?sourceRotationLocal(rotation.basis,matrix[4],matrix[5]):undefined;
      if (!asset || !matrix.every(Number.isFinite) || !rotation&&(matrix[0]<=0 || matrix[3]>=0 || Math.abs(matrix[1])>.000001 || Math.abs(matrix[0]+matrix[3])>.000001) || state.size<=0 || state.size>144 || state.hScale!==1 || !Number.isFinite(state.charSpacing) || Math.abs(state.charSpacing)>state.size || asset.format!=='truetype'&&asset.sourceVersion!==9&&state.charSpacing!==0 || state.wordSpacing!==0 || state.rise!==0 || state.mode!==0 || !/^#[\da-f]{6}$/i.test(state.color)) return fail('Source text uses unsupported transform, spacing, paint or geometry.');
      if(rotation&&(asset.format!=='truetype'||![4,5,6].includes(asset.sourceVersion??0)||!originals?.has(state.font)))return fail('Rotation requires its original permitted TrueType selector owner.');
      const shear=rotation?0:originalHorizontalShear(state.ctm,state.tm.slice(0,4));
      if(shear!==0&&(asset.format!=='truetype'||![4,5].includes(asset.sourceVersion??0)||!originals?.has(state.font)))return fail('Horizontal shear requires its permitted original TrueType selector owner.');
      if(!Array.isArray(args[0])||args[0].length>200000||glyphs.length+args[0].reduce((count:number,raw:unknown)=>count+(typeof raw==='number'?0:1),0)>100000)return fail('Source text has no bounded glyph list or exceeds100000 paint entries.');
      for(const raw of args[0]) {
        if(typeof raw==='number') { if(!Number.isFinite(raw))return fail('Source text adjustment is not finite.'); state.x-=raw*state.size/1000; continue; }
        const program=programs.get(asset.id)!;
        if(asset.sourceVersion===9&&raw?.unicode==='\u0005')return fail('Original CFF decorative selector is not an editable text occurrence.');
        if(asset.format==='opentype-cff'&&raw?.unicode==='\u0005') {
          if(typeof raw.fontChar!=='string'||Array.from(raw.fontChar).length!==1||!raw.isInFont||raw.accent||!Number.isFinite(raw.width)||raw.width<0||raw.width>10000)return fail('The source control-coded decoration lacks exact paint proof.');
          const fontChar=raw.fontChar.codePointAt(0)!,glyphId=program.glyphForCodePoint(fontChar).id,path=program.getGlyph(glyphId).path.toSVG(),box=program.getGlyph(glyphId).bbox;
          if(glyphId<=0||!path||path.length>1024*1024||![box.minX,box.minY,box.maxX,box.maxY].every(Number.isFinite))return fail('The source control-coded decoration lacks a finite positive outline.');
          asset.shapeMap??=[];if(!asset.shapeMap.some(m=>m.glyphId===glyphId&&m.fontChar===fontChar))asset.shapeMap.push({glyphId,fontChar});
          const point=[state.x,state.y];Util.applyTransform(point,matrix);glyphs.push({fontId:asset.id,cid:0,unicode:raw.unicode,x:point[0],advance:raw.width*state.size/1000*matrix[0],operatorIndex:i,resource:state.font,baseline:point[1],size:state.size*matrix[0],color:state.color,shapeOnly:true,glyphId,fontChar,originalCharCode:Number.isInteger(raw.originalCharCode)&&raw.originalCharCode>=0&&raw.originalCharCode<=65535?raw.originalCharCode:null});if(glyphs.length>100000)return fail('The source paint graph exceeds100000 entries.');state.x+=raw.width*state.size/1000;continue;
        }
        const map=glyphMapping(asset,raw,program,originals?.get(state.font),cffOriginals?.get(state.font)), point=[state.x,state.y]; Util.applyTransform(point,matrix);if(rotationOrigin)point.splice(0,2,rotationOrigin[0]+state.x*paintScale,rotationOrigin[1]-state.y*paintScale);
        if(shear!==0&&(asset.format!=='truetype'||![4,5].includes(asset.sourceVersion??0)))return fail('Sheared source glyphs cannot acquire a broader font selector contract.');
        const advance=map.pdfWidth*state.size/1000*paintScale;
        glyphs.push({fontId:asset.id,cid:map.cid,unicode:map.unicode,x:point[0],advance,operatorIndex:i,resource:state.font,baseline:point[1],size:state.size*paintScale,color:state.color,...(rotation?{rotation:rotation.basis}:{}),...(shear!==0?{shearX:shear}:{}),...(state.charSpacing!==0?{characterSpacing:state.charSpacing*paintScale}:{})});
        // Tc advances the cursor after every source glyph, including the last.
        // Visible item endpoints use its raw advance, without that final Tc.
        state.x+=map.pdfWidth*state.size/1000+state.charSpacing;
        if(glyphs.length>100000)return fail('The source glyph graph exceeds 100,000 entries.');
      }
    }
  }
  return glyphs;
}
export interface AssociatedSourceItem { item: TextItem; index: number; glyphs: SourcePaintGlyph[]; semanticSplit?:true; semanticText?:string }
/** Monotonic exact Unicode + face + origin + baseline association; no substring search. */
export function associateSourceItems(items: readonly (TextItem | object)[], glyphs: readonly SourcePaintGlyph[], viewport: Matrix, assets?: readonly SourceFontAsset[],interShowProof?:InterShowSemanticProof,mixedSpacing=true): AssociatedSourceItem[] {
  if(assets?.some(f=>f.sourceVersion===7&&f.namelessDescriptor))return associateNamelessSourceItems(items,glyphs,viewport,assets,mixedSpacing);
  const associated: AssociatedSourceItem[] = []; let cursor=0;
  const space=(glyph:SourcePaintGlyph|undefined)=>!!glyph&&/^\s+$/u.test(glyph.unicode);
  const standaloneBlank=(glyph:SourcePaintGlyph)=>Number.isFinite(glyph.advance)&&glyph.advance>0&&glyph.advance<=2000&&Number.isFinite(glyph.size)&&glyph.size>0&&glyph.size<=200&&assets?.some(a=>a.id===glyph.fontId&&a.format==='truetype'&&(a.sourceVersion===5||a.sourceVersion===6||a.sourceVersion===7||a.sourceVersion===8||a.sourceVersion===10&&a.semanticBlankPolicy==='original-space-and-nbsp-v1')&&a.glyphMap.some(m=>m.cid===glyph.cid&&(m.unicode===' '||a.sourceVersion===10&&a.semanticBlankPolicy==='original-space-and-nbsp-v1'&&m.unicode==='\u00A0'&&glyph.unicode==='\u00A0')&&m.nonPainting&&m.glyphId>0&&!!m.originalGlyphId&&!!m.originalCharCode&&(m.selectorProvenance==='original-identity-positive-blank-v1'||m.selectorProvenance==='original-positive-blank-v2')));
  for(let index=0;index<items.length;index++) {
    const item=items[index]; if(!('str'in item)||typeof item.str!=='string'||!item.str)continue;
    const current=item as TextItem, transform=Util.transform(viewport,current.transform), selected:SourcePaintGlyph[]=[],semanticCuts=new Set<number>();
    const rotation=glyphs[cursor]?.rotation?rightAngleSourceBasis(transform):undefined;if(rotation){const local=sourceRotationLocal(rotation.basis,transform[4],transform[5]);transform.splice(0,6,rotation.scale,0,0,-rotation.scale,...local);}
    if(current.dir!=='ltr'||Math.abs(transform[1])>.000001||transform[0]<=0||transform[3]>=0||Math.abs(transform[0]+transform[3])>.000001||!Number.isFinite(transform[2]/transform[0])||Math.abs(transform[2]/transform[0])>1)return fail('Source text extraction has an unsupported direction or transform.');
    const position=(glyph:SourcePaintGlyph|undefined)=>!!glyph&&(!rotation&&!glyph.rotation||!!rotation&&!!glyph.rotation&&rotation.basis.every((v,i)=>Math.abs(v-glyph.rotation![i])<=1e-12))&&close(glyph.baseline,transform[5])&&close(glyph.size,Math.abs(transform[3]))&&(glyph.shearX??0)===transform[2]/transform[0];
    const same=(glyph:SourcePaintGlyph|undefined)=>!!glyph&&glyph.resource===current.fontName&&position(glyph);
    // PDF.js height-zero separators can report an unscaled synthetic width.
    // Preserve every actual V5 blank and bind both neighboring painted origins.
    if(current.height===0&&/^ +$/.test(current.str)&&space(glyphs[cursor])&&standaloneBlank(glyphs[cursor])){
      const blanks:SourcePaintGlyph[]=[];let end=cursor;while(space(glyphs[end])&&standaloneBlank(glyphs[end]))blanks.push({...glyphs[end++]});
      const previous=associated.at(-1)?.glyphs.at(-1),next=glyphs[end];let followingIndex=index+1;while(followingIndex<items.length&&'str'in items[followingIndex]&&(items[followingIndex] as TextItem).str==='')followingIndex++;
      const following=items[followingIndex],nextItem=following&&'str'in following?following as TextItem:undefined,nextTransform=nextItem?Util.transform(viewport,nextItem.transform):undefined,last=blanks.at(-1);
      // TJ adjustments and independent Tm resets can place the actual blank
      // anywhere in this monotonic source sequence. They never make the
      // extractor's synthetic width or inferred blank origin authoritative.
      if(!previous||!next||!last||!nextItem||!nextTransform||blanks.some((blank,i)=>!Number.isFinite(blank.x)||blank.x<(i?blanks[i-1].x:previous.x)-.025||!close(blank.baseline,transform[5])&&!close(blank.baseline,next.baseline))||next.x<last.x-.025||!nextItem.str.startsWith(next.unicode)||next.resource!==nextItem.fontName||!close(previous.x+previous.advance,transform[4])||!close(previous.baseline,transform[5])||!close(next.x,nextTransform[4])||!close(next.baseline,nextTransform[5])||!close(next.size,Math.abs(nextTransform[3]))||nextItem.dir!=='ltr'||Math.abs(nextTransform[1])>.000001||Math.abs(nextTransform[2])>.000001)return fail('A height-zero extractor separator lacks exact original blank and neighboring paint ownership.');
      associated.push({item:{...current,fontName:blanks[0].resource,str:blanks.map(g=>g.unicode).join('')},index,glyphs:blanks});cursor=end;continue;
    }
    while(space(glyphs[cursor])) {
      const previous=associated.at(-1),glyph=glyphs[cursor];
      if(standaloneBlank(glyph)&&(!previous||!close(previous.glyphs[0].baseline,glyph.baseline)||!close(previous.glyphs[0].size,glyph.size))&&(!close(glyph.baseline,transform[5])||!close(glyph.size,Math.abs(transform[3]))||glyph.x<transform[4]-.025)){
        associated.push({item:{...current,fontName:glyph.resource,str:glyph.unicode},index,glyphs:[{...glyph}]});cursor++;continue;
      }
      if(!previous||!close(previous.glyphs[0].baseline,glyph.baseline)||!close(previous.glyphs[0].size,glyph.size)||close(glyph.baseline,transform[5])&&glyph.x>=transform[4]-.025)break;
      if(previous.glyphs[0].fontId===glyph.fontId){previous.glyphs.push({...glyph});previous.item={...previous.item,str:previous.glyphs.map(g=>g.unicode).join('')};}
      else associated.push({item:{...current,fontName:glyph.resource,str:glyph.unicode},index:previous.index,glyphs:[{...glyph}]});
      cursor++;
    }

    // A privately bound inter-show item is semantic whitespace, with no glyph.
    if(current.str===' '&&!space(glyphs[cursor])){
      const previous=associated.at(-1)?.glyphs.at(-1),next=glyphs[cursor];
      if(previous&&next&&hasInterShowSemanticPair(interShowProof,previous,next,index,current.str)){
        let followingIndex=index+1;while(followingIndex<items.length&&'str'in items[followingIndex]&&(items[followingIndex] as TextItem).str==='')followingIndex++;
        const following=items[followingIndex],nextItem=following&&'str'in following?following as TextItem:undefined,nextTransform=nextItem?Util.transform(viewport,nextItem.transform):undefined;
        if(!nextItem||!nextTransform||!nextItem.str.startsWith(next.unicode)||current.fontName!==previous.resource&&current.fontName!==next.resource||next.resource!==nextItem.fontName||!position(next)||!close(previous.x+previous.advance,transform[4])||!close(next.x,nextTransform[4])||!close(next.baseline,nextTransform[5])||!close(next.size,Math.abs(nextTransform[3]))||nextItem.dir!=='ltr')return fail('A semantic separator lacks its exact adjacent original endpoints');
        recordInterShowSemanticUse(interShowProof,previous,next,index,current.str);continue;
      }
    }
    // Proved CFF and original-owned TT extractor separators have synthetic widths.
    // Bind both adjacent visible origins; never consume a raw blank or invent a target.
    if(current.height===0&&/^ +$/.test(current.str)&&!space(glyphs[cursor])&&assets?.some(a=>a.id===glyphs[cursor]?.fontId&&(a.format==='opentype-cff'||(a.sourceVersion===4||a.sourceVersion===5||a.sourceVersion===6||a.sourceVersion===7||a.sourceVersion===8)))) {
      const previous=associated.at(-1)?.glyphs.at(-1),next=glyphs[cursor];let followingIndex=index+1;
      while(followingIndex<items.length&&'str'in items[followingIndex]&&(items[followingIndex] as TextItem).str==='')followingIndex++;
      const following=items[followingIndex],nextItem=following&&'str'in following?following as TextItem:undefined,nextTransform=nextItem?Util.transform(viewport,nextItem.transform):undefined;
      if(!previous||!next||!nextItem||!nextTransform||!nextItem.str.startsWith(next.unicode)||next.resource!==nextItem.fontName||!close(previous.x+previous.advance,transform[4])||!close(previous.baseline,transform[5])||!close(next.x,nextTransform[4])||!close(next.baseline,nextTransform[5])||!close(next.size,Math.abs(nextTransform[3]))||nextItem.dir!=='ltr'||Math.abs(nextTransform[1])>.000001||Math.abs(nextTransform[2])>.000001||!Number.isFinite(next.x-previous.x-previous.advance)||next.x<previous.x+previous.advance-.025)return fail('An extractor separator lacks exact adjacent visible source ownership.');
      continue;
    }
    if(/^\s+$/u.test(current.str) && !space(glyphs[cursor])) {
      const asset=assets?.find(a=>a.sourceResource===current.fontName),blank=asset?.glyphMap.find(m=>m.unicode===' '&&m.nonPainting), next=glyphs[cursor], previous=associated.at(-1)?.glyphs.at(-1), width=current.width*Math.hypot(viewport[0],viewport[1]);
      if(!asset||!blank||!next||!previous||Math.abs(next.baseline-transform[5])>Math.min(next.size,Math.abs(transform[3]))*.15||!close(previous.baseline,transform[5])||!close(previous.x+previous.advance,transform[4])||!close(transform[4]+width,next.x)||width<=0)return fail(`An extracted blank gap is not proven between consecutive source glyphs (item ${index}, glyph ${cursor}, asset=${!!asset}, blank=${!!blank}, next baseline delta=${next?next.baseline-transform[5]:null}, previous baseline delta=${previous?previous.baseline-transform[5]:null}, position=${position(next)}, left delta=${previous?previous.x+previous.advance-transform[4]:null}, right delta=${next?transform[4]+width-next.x:null}, width=${width}).`);
      const gap:SourcePaintGlyph={fontId:asset.id,cid:blank.cid,unicode:' ',x:transform[4],advance:width,operatorIndex:next.operatorIndex,resource:current.fontName,baseline:transform[5],size:Math.abs(transform[3]),color:next.color,inferredGap:true};
      associated.push({item:{...current,str:' '},index,glyphs:[gap]});continue;
    }
    // PDF.js omits trailing raw spaces. Their exact position proves previous ownership.
    while(space(glyphs[cursor]) && position(glyphs[cursor]) && glyphs[cursor].x<transform[4]-.025) {
      const previous=associated.at(-1); if(!previous||previous.glyphs.at(-1)!.resource!==glyphs[cursor].resource||!close(previous.glyphs[0].baseline,transform[5]))return fail('A source blank has ambiguous item ownership.');
      previous.glyphs.push({...glyphs[cursor++]}); previous.item={...previous.item,str:previous.glyphs.map(g=>g.unicode).join('')};
    }
    for(let textOffset=0;textOffset<current.str.length;) {
      const char=String.fromCodePoint(current.str.codePointAt(textOffset)!);textOffset+=char.length;
      // Extractor whitespace normalization may collapse or omit raw blank glyphs.
      if(space(glyphs[cursor])&&position(glyphs[cursor])) {
        while(space(glyphs[cursor])&&position(glyphs[cursor]))selected.push({...glyphs[cursor++]});
        if(/^\s$/u.test(char))continue;
      }
      const glyph=glyphs[cursor];
      if(/^\s$/u.test(char)&&glyph&&!space(glyph)&&position(glyph)) {
        const previous=selected.at(-1),gap=previous?glyph.x-previous.x-previous.advance:0;
        const asset=assets?.find(a=>a.id===glyph.fontId),blank=asset?.glyphMap.find(m=>m.unicode===' '&&m.nonPainting);
        if(!blank&&asset?.format==='truetype'&&asset.originalProgram&&[4,5,6,7,8,10,11].includes(asset.sourceVersion??0)){
          const owned=(g:SourcePaintGlyph)=>(assets?.find(a=>a.id===g.fontId)?.glyphMap??[]).some(m=>m.cid===g.cid&&m.unicode===g.unicode&&!m.nonPainting&&!!m.originalCharCode&&!!m.originalGlyphId&&m.glyphId>0);
          const privatelyOwned=!!previous&&hasInterShowSemanticPair(interShowProof,previous,glyph,index,current.str);
          // Extractor-only ASCII whitespace has no font selector. Retain its
          // complete semantic item separately and split only physical spans.
          if(char!==' '||!previous||!/\S/u.test(current.str[textOffset]??'')||!Number.isFinite(gap)||gap<=.025||gap>2000||previous.inferredGap||glyph.inferredGap||previous.shapeOnly||glyph.shapeOnly||!privatelyOwned&&(previous.fontId!==glyph.fontId||previous.resource!==glyph.resource||previous.operatorIndex!==glyph.operatorIndex||previous.baseline!==glyph.baseline)||previous.size!==glyph.size||previous.color!==glyph.color||(previous.shearX??0)!==(glyph.shearX??0)||(previous.characterSpacing??0)!==(glyph.characterSpacing??0)||!owned(previous)||!owned(glyph)||semanticCuts.has(selected.length))return fail('An extractor-only internal separator lacks exact consecutive original show ownership.');
          if(previous.operatorIndex!==glyph.operatorIndex)recordInterShowSemanticUse(interShowProof,previous,glyph,index,current.str);
          semanticCuts.add(selected.length);continue;
        }
        if(!previous||!blank||gap<=.025)return fail(`An inferred extractor gap has no proved nonpainting space and measured ownership (item ${index}, glyph ${cursor}, preceding=${!!previous}, blank=${!!blank}, gap=${gap}, itemLength=${current.str.length}, itemBlank=${/^\s+$/.test(current.str)}, itemX=${transform[4]}, glyphX=${glyph.x}).`);
        selected.push({...glyph,cid:blank.cid,unicode:' ',x:previous.x+previous.advance,advance:gap,inferredGap:true});continue;
      }
      if(!glyph||!current.str.startsWith(glyph.unicode,textOffset-char.length)||(!selected.length||!assets?.some(a=>a.id===glyph.fontId&&(a.format==='opentype-cff'||a.format==='truetype'&&!!a.originalProgram&&selected[0].fontId===glyph.fontId&&selected[0].resource===glyph.resource&&selected[0].baseline===glyph.baseline&&close(glyph.baseline,transform[5])&&a.glyphMap.some(m=>m.cid===glyph.cid&&!!m.originalGlyphId&&m.originalGlyphId>0&&m.glyphId>0))))&&!position(glyph)||!selected.length&&glyph.resource!==current.fontName)return fail(`Source glyphs and extracted text lack an exact monotonic association (item ${index}, glyph ${cursor}, unicode equal=${glyph?.unicode===char}, font equal=${glyph?.resource===current.fontName}, itemBlank=${/^\s+$/.test(current.str)}, itemX=${transform[4]}, glyphX=${glyph?.x}, baseline delta=${glyph?glyph.baseline-transform[5]:null}, size delta=${glyph?glyph.size-Math.abs(transform[3]):null}).`);
      if(!selected.length&&!close(glyph.x,transform[4]))return fail('The extracted source item origin disagrees with its first glyph.');
      if(selected.length&&glyph.x<selected.at(-1)!.x-.025)return fail('The source glyph sequence is not horizontal and monotonic.');
      textOffset+=glyph.unicode.length-char.length;selected.push({...glyph});cursor++;
    }
    if(!selected.length)return fail('An extracted item has no source-owned glyphs.');
    const end=selected.at(-1)!, expectedEnd=transform[4]+current.width*Math.hypot(viewport[0],viewport[1]);
    if(!close(end.x+end.advance,expectedEnd))return fail(`The extracted source item width disagrees with its glyph graph (item ${index}, delta ${(end.x+end.advance-expectedEnd).toFixed(4)}).`);
    const groups:SourcePaintGlyph[][]=[];for(const [ordinal,glyph] of selected.entries()){const group=groups.at(-1);if(!semanticCuts.has(ordinal)&&group?.[0].fontId===glyph.fontId&&Math.abs(group[0].baseline-glyph.baseline)<.0000001&&Math.abs(group[0].size-glyph.size)<.0000001&&group[0].color===glyph.color&&(group[0].shearX??0)===(glyph.shearX??0)&&JSON.stringify(group[0].rotation)===JSON.stringify(glyph.rotation)&&!!group[0].shapeOnly===!!glyph.shapeOnly)group.push(glyph);else groups.push([glyph]);}
    for(const group of groups)associated.push({item:{...current,fontName:group[0].resource,str:group.map(g=>g.unicode).join('')},index,glyphs:group,...(semanticCuts.size?{semanticSplit:true as const,semanticText:current.str}:{})});
  }
  while(space(glyphs[cursor])) {const previous=associated.at(-1),glyph=glyphs[cursor];if(!previous||previous.item.fontName!==glyph.resource||!close(previous.glyphs[0].baseline,glyph.baseline)){if(!standaloneBlank(glyph)||!previous)return fail('A trailing source blank has ambiguous item ownership.');associated.push({item:{...previous.item,fontName:glyph.resource,str:glyph.unicode},index:previous.index,glyphs:[{...glyph}]});}else{previous.glyphs.push({...glyph});previous.item={...previous.item,str:previous.glyphs.map(g=>g.unicode).join('')};}cursor++;}
  if(cursor!==glyphs.length)return fail('Some source glyphs are not owned by an extracted text item.');
  // Trailing raw blanks may be attached after initial association. Split again
  // here so every stored span has one exact face, paint state and Tc value.
  return associated.flatMap(entry=>{
    const groups:SourcePaintGlyph[][]=[];
    for(const glyph of entry.glyphs){const group=groups.at(-1),first=group?.[0];if(first&&first.fontId===glyph.fontId&&first.baseline===glyph.baseline&&first.size===glyph.size&&first.color===glyph.color&&(first.shearX??0)===(glyph.shearX??0)&&JSON.stringify(first.rotation)===JSON.stringify(glyph.rotation)&&!!first.shapeOnly===!!glyph.shapeOnly&&(first.characterSpacing??0)===(glyph.characterSpacing??0))group!.push(glyph);else groups.push([glyph]);}
    return groups.map(group=>({...entry,item:{...entry.item,fontName:group[0].resource,str:group.map(g=>g.unicode).join('')},glyphs:group}));
  });
}
