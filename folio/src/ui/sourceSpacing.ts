import {sourceNativeStyles,SOURCE_NATIVE_ADAPTER} from './sourceNativeGeometry';
import {canonicalJson,hashTextSync,type SourceFontAsset,type TextRegion,type SourcePositionedGlyph} from '../core/model';
import {loadSourceFont,sourceOriginalPostAvailable,sourceOriginalCmapAvailable} from '../layout/source-fonts';
import {browserSourceFontFamily} from './sourceFonts';

const ADAPTER='folio-native-tt-spacing-v2',PT=4/3,EDGE=.06;
const proofs=new Map<string,{editable:boolean;reason?:string}>();
const scalarProofs=new Map<string,boolean>();
export function clearSourceSpacingProofs():void{proofs.clear();scalarProofs.clear();}
/** The last CSS range includes Tc; PDF's visible endpoint excludes it. */
export function spacedRangeMatches(actual:{x:number;width:number},origin:number,advance:number,spacing:number):boolean {
 return [actual.x,actual.width,origin,advance,spacing].every(Number.isFinite)&&advance+spacing>0&&Math.abs(actual.x-origin)<=EDGE&&Math.abs(actual.width-(advance+spacing))<=EDGE;
}
/** Actual native DOM ranges, bound to exact face/map/size/Tc and source graph. */
export function sourceSpacingAvailability(region:TextRegion,asset:SourceFontAsset,currentGlyphs:readonly SourcePositionedGlyph[],currentText=currentGlyphs.map(g=>g.unicode).join(''),highResolution=false):{editable:boolean;reason?:string} {
 if(asset.sourceVersion===9)return {editable:false,reason:'Native editing of the retained original CFF programme is not yet independently proved.'};
 if(!sourceOriginalCmapAvailable(asset))return {editable:false,reason:'The original font uses physical PDF selectors without a cmap. Its PDF baseline remains available, but native editing is not proved.'};
 if(!sourceOriginalPostAvailable(asset))return {editable:false,reason:'The original font lacks post metrics. Its PDF baseline remains available, but native editing is not proved.'};
 if(region.sourceScopedPaint?.color.space==='ICCBased')return {editable:false,reason:'This source uses an embedded color profile. Native editing is unavailable; use the PDF preview to review its original color.'};
 highResolution=highResolution&&asset.sourceVersion===8;
 const source=region.sourceLayout;
 if(source?.version===4)return {editable:false,reason:'This line retains its original text shear. Native caret editing has not been proved; review its PDF appearance.'};
 const originalOwned=asset.format==='truetype'&&(asset.sourceVersion===4||asset.sourceVersion===5||asset.sourceVersion===6||asset.sourceVersion===7||asset.sourceVersion===8);
 if(source?.version!==3&&!originalOwned)return {editable:true};
 if(!source||asset.format!=='truetype'||source.version===3&&source.editPolicy==='baselineOnly')return {editable:false,reason:'This source span is preserved exactly. Its native caret mapping is not yet proved for editing.'};
 const characterSpacing=source.version===3?source.characterSpacing:0;
 if(currentGlyphs.map(g=>g.unicode).join('')!==currentText)return {editable:false,reason:'This draft contains text outside its proved glyph graph. Use Undo to recover the editable source wording.'};
 if(currentGlyphs.length>5000||asset.glyphMap.length>1000)return {editable:false,reason:'This span exceeds the bounded native caret review. Its source appearance remains preserved.'};
 if(region.sourceScopedPaint){const face=loadSourceFont(asset),clip=region.sourceScopedPaint.effectiveClip;for(const glyph of currentGlyphs){const map=face.mapping(glyph.unicode);if(!map)return {editable:false,reason:'This source paint is preserved with its original clip.'};if(map.nonPainting)continue;const box=face.font.getGlyph(map.glyphId).bbox,scale=source.fontSize/face.font.unitsPerEm,x=glyph.x+box.minX*scale,y=source.baseline-box.maxY*scale;if(x<clip.x||y<clip.y||x+box.width*scale>clip.x+clip.width||y+box.height*scale>clip.y+clip.height)return {editable:false,reason:'This source span is partially clipped in the original. Its visible paint remains preserved, with native editing unavailable.'};}}
 const family=browserSourceFontFamily(asset),key=hashTextSync(canonicalJson({adapter:ADAPTER,nativeAdapter:highResolution?SOURCE_NATIVE_ADAPTER:null,family,size:source.fontSize,spacing:characterSpacing,style:region.style,graph:source,clip:region.sourceScopedPaint,currentGlyphs}));
 const cached=proofs.get(key);if(cached)return cached;
 const refused={editable:false,reason:'The original character spacing is preserved exactly. Its native selection and caret positions could not be verified on this device.'};
 if(!document.fonts.check(`${asset.italic?'italic ':''}${(asset.sourceVersion===7?400:asset.fontWeight)} ${source.fontSize}pt "${family}"`))return refused;
 const span=document.createElement('span');
 Object.assign(span.style,{position:'fixed',left:'0',top:'0',visibility:'hidden',whiteSpace:'pre',fontFamily:family,fontSize:`${source.fontSize}pt`,fontWeight:String((asset.sourceVersion===7?400:asset.fontWeight)),fontStyle:asset.italic?'italic':'normal',fontKerning:'none',fontVariantLigatures:'none',fontSynthesis:'none',fontFeatureSettings:'"kern" 0, "liga" 0, "clig" 0',letterSpacing:`${characterSpacing}pt`});
 if(highResolution)Object.assign(span.style,sourceNativeStyles(source.fontSize,region.style.lineHeight,characterSpacing,Math.max(0,source.endX-source.startX+characterSpacing),true));
 document.body.append(span);
 let result:{editable:boolean;reason?:string}=refused;
 try {
  const face=loadSourceFont(asset),spacing=characterSpacing*PT;
  // Check every covered scalar's native step at this exact Tc and size. A
  // negative candidate step is separately refused by canonical layout.
  const scalarKey=hashTextSync(canonicalJson({adapter:ADAPTER,nativeAdapter:highResolution?SOURCE_NATIVE_ADAPTER:null,family,size:source.fontSize,spacing:characterSpacing}));
  if(!scalarProofs.has(scalarKey)){
  for(const map of asset.glyphMap){if(!face.mapping(map.unicode)||Array.from(map.unicode).length!==1)continue;const advance=map.pdfWidth*source.fontSize/1000*PT;if(advance+spacing<=0)continue;
   span.textContent=map.unicode+map.unicode;const text=span.firstChild!,base=span.getBoundingClientRect().x;
   for(let i=0;i<2;i++){const range=document.createRange();range.setStart(text,i*map.unicode.length);range.setEnd(text,(i+1)*map.unicode.length);const rect=range.getBoundingClientRect();if(!spacedRangeMatches({x:rect.x-base,width:rect.width},i*(advance+spacing),advance,spacing))throw Error('scalar');}
  }
  if(scalarProofs.size>=128)scalarProofs.clear();scalarProofs.set(scalarKey,true);
  }
  span.textContent=currentGlyphs.map(g=>g.unicode).join('');const text=span.firstChild!,base=span.getBoundingClientRect().x;let offset=0;
  for(const glyph of currentGlyphs){const range=document.createRange();range.setStart(text,offset);offset+=glyph.unicode.length;range.setEnd(text,offset);const rect=range.getBoundingClientRect();if(!spacedRangeMatches({x:rect.x-base,width:rect.width},(glyph.x-currentGlyphs[0].x)*PT,glyph.advance*PT,spacing))throw Error('source');}
  result={editable:true};
 }catch{/* Preserve exact source ink; never infer native proof from font load. */}
 finally{span.remove();}
 if(proofs.size>=1024)proofs.clear();proofs.set(key,result);return result;
}
