import {beforeAll,describe,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import fontkit from '@pdf-lib/fontkit';
import {fictionalSourceTemplate} from '../core/sourceFontTestFixture';
import {registerBrowserSourceFontSet} from './sourceFonts';
import {fictionalCffTemplate} from '../core/sourceCffTestFixture';
import {sha256Sync} from '../core/model';
import {deriveBrowserCffFont,browserCffFontFamily,browserCffAssetIdentity,cffCoveredScalarsHash,cffRegionEditAvailability,rewriteCffEditingMetrics,nativeCffScalarRangeMatches,NATIVE_CFF_RANGE_EDGE_BOUND_PX,verifyNativeCffCaret,type BrowserCffFontDerivation} from './sourceCffFonts';
let bytes:Uint8Array;
beforeAll(async()=>{Object.assign(globalThis,{DOMMatrix,ImageData,Path2D});bytes=new Uint8Array(await readFile(resolve('public/fonts/Times-Regular.otf')));});
/** Synthetic DOM Range fixture; actual native browser proof is independent QA. */
function stubNativeRanges(derivation:BrowserCffFontDerivation,alter?:(rect:{x:number;width:number},second:boolean)=>{x:number;width:number},loaded=true):{removed:()=>boolean} {
 const font=fontkit.create(derivation.bytes);let removed=false;
 const node={textContent:''},span={style:{},firstChild:node,get textContent(){return node.textContent;},set textContent(text:string){node.textContent=text;},remove(){removed=true;}};
 vi.stubGlobal('document',{fonts:{check:()=>loaded},body:{append:()=>undefined},createElement:()=>span,createRange:()=>{let start=0,end=0;return {setStart:(_node:unknown,offset:number)=>{start=offset;},setEnd:(_node:unknown,offset:number)=>{end=offset;},getBoundingClientRect:()=>{const scalar=Array.from(node.textContent)[0],advance=font.glyphForCodePoint(scalar.codePointAt(0)!).advanceWidth*100/font.unitsPerEm,left=Math.floor(start/scalar.length*advance*64)/64,right=Math.ceil(end/scalar.length*advance*64)/64,rect={x:left,width:right-left};return alter?alter(rect,start>0):rect;}};}});
 return {removed:()=>removed};
}
describe('separate CFF browser-only bridge and native proof identity',()=>{
 it('proves positive empty space, exact scalar outlines and rounded source hmtx while source remains immutable',async()=>{const {asset}=fictionalCffTemplate(bytes),before=new Uint8Array(asset.bytes),derived=await deriveBrowserCffFont(asset),font=fontkit.create(derived.bytes),source=fontkit.create(asset.bytes);expect(derived.nativeCaretVerified).toBe(false);expect(derived.sha256).toBe(sha256Sync(derived.bytes));expect(font.glyphForCodePoint(32).id).toBeGreaterThan(0);expect(font.glyphForCodePoint(32).path.toSVG()).toBe('');expect(font.glyphForCodePoint(32).advanceWidth).toBe(250);for(const map of asset.glyphMap.filter(m=>!m.nonPainting)){const glyph=font.glyphForCodePoint(map.unicode.codePointAt(0)!);expect(glyph.path.toSVG()).toBe(source.getGlyph(map.glyphId).path.toSVG());expect(glyph.advanceWidth).toBe(Math.round(map.pdfWidth));}expect(asset.bytes).toEqual(before);});
 it('refuses unproved baseline-only maps without inventing typed whitespace',async()=>{const {asset}=fictionalCffTemplate(bytes);asset.glyphMap.forEach(m=>{m.editPolicy='baselineOnly';if(m.nonPainting){m.pdfWidth=0;m.widthProvenance='baselineGap';}});await expect(deriveBrowserCffFont(asset)).rejects.toThrow(/no proved scalar/);});
 it('requires the exact asset/map/style/adapter/derivative native proof and keeps ligatures read-only',async()=>{const {asset,region}=fictionalCffTemplate(bytes),d=await deriveBrowserCffFont(asset),proof={assetId:asset.id,assetIdentity:d.assetIdentity,derivativeSha256:d.sha256,family:d.family,adapterVersion:d.adapterVersion,coveredScalarsHash:cffCoveredScalarsHash(d),status:'verified' as const};expect(cffRegionEditAvailability(region,asset,d,proof).editable).toBe(true);for(const bad of [{...proof,assetId:'other'},{...proof,derivativeSha256:'0'.repeat(64)},{...proof,family:'another-face'},{...proof,coveredScalarsHash:'0'.repeat(64)}])expect(cffRegionEditAvailability(region,asset,d,bad).editable).toBe(false);const other={...asset,id:'different-face'};expect(browserCffFontFamily(other)).not.toBe(d.family);expect(browserCffAssetIdentity(other)).not.toBe(d.assetIdentity);expect(cffRegionEditAvailability(region,other,d,proof).editable).toBe(false);asset.glyphMap[0].pdfWidth+=1;expect(cffRegionEditAvailability(region,asset,d,proof).editable).toBe(false);if(region.sourceLayout?.version===2)region.sourceLayout.editPolicy='baselineOnly';expect(cffRegionEditAvailability(region,other,d,proof).editable).toBe(false);});
 it('synthetically keeps a loaded TT sibling when the CFF face has no proven scalar adapter',async()=>{const program=new Uint8Array(await readFile(resolve('public/fonts/DejaVuSans.ttf'))),tt=fictionalSourceTemplate(program).asset,{asset}=fictionalCffTemplate(bytes);asset.glyphMap.forEach(m=>m.editPolicy='baselineOnly');const added=new Set<unknown>();vi.stubGlobal('document',{fonts:{add:(face:unknown)=>added.add(face),delete:(face:unknown)=>added.delete(face)}});vi.stubGlobal('FontFace',class {async load(){return this;}});try{const result=await registerBrowserSourceFontSet([tt,asset]);expect(result.registrations.get(tt.id)?.status).toBe('editable');expect(result.registrations.get(asset.id)?.status).toBe('readOnly');expect(added.size).toBe(1);result.dispose();expect(added.size).toBe(0);}finally{vi.unstubAllGlobals();}});
 it('bounds derivative directory and positive scalar maps without broadening TrueType',()=>{expect(()=>rewriteCffEditingMetrics(bytes,new Map([[32,{glyphId:0,pdfWidth:250}]]))).toThrow();const bad=new Uint8Array(bytes);new DataView(bad.buffer).setUint32(20,4);expect(()=>rewriteCffEditingMetrics(bad,new Map())).toThrow();expect(()=>rewriteCffEditingMetrics(bytes,new Map([[0xd800,{glyphId:2,pdfWidth:250}]]))).toThrow();});
 it.each([
  {source:773.6,units:774,first:77.40625,left:77.390625,second:77.421875},
  {source:768.5,units:769,first:76.90625,left:76.890625,second:76.921875},
  {source:862.5,units:863,first:86.3125,left:86.296875,second:86.3125},
  {source:312.5,units:313,first:31.3125,left:31.296875,second:31.3125},
  {source:453.6,units:454,first:45.40625,left:45.390625,second:45.421875},
 ])('separately bounds integer-unit rounding and outward Range edges for $source PDF units',({source,units,first,left,second})=>{
  const native=units*.1;expect(Math.abs(native-source*.1)).toBeLessThanOrEqual(.05+1e-10);
  // A second selected width combines two rounded boundaries; it is not one advance.
  expect(Math.abs(second-source*.1)).toBeGreaterThan(.06);
  expect(nativeCffScalarRangeMatches(native,{x:0,width:first},{x:left,width:second})).toBe(true);
  expect(nativeCffScalarRangeMatches(native,{x:10,width:first},{x:10+left,width:second})).toBe(true);
 });
 it('keeps an exact 1/64px boundary bound and refuses misplaced carets, enlarged selection and invalid geometry',()=>{
  const native=77.4,a={x:0,width:77.40625},b={x:77.390625,width:77.421875};
  expect(nativeCffScalarRangeMatches(native,a,b)).toBe(true);
  expect(nativeCffScalarRangeMatches(native,{...a,width:native+NATIVE_CFF_RANGE_EDGE_BOUND_PX+1e-5},b)).toBe(false);
  expect(nativeCffScalarRangeMatches(native,a,{...b,x:native-NATIVE_CFF_RANGE_EDGE_BOUND_PX-1e-5})).toBe(false);
  expect(nativeCffScalarRangeMatches(native,a,{...b,width:2*native+NATIVE_CFF_RANGE_EDGE_BOUND_PX+1e-5-b.x})).toBe(false);
  expect(nativeCffScalarRangeMatches(native,a,{...b,x:b.x-.1,width:b.width+.1})).toBe(false);
  for(const invalid of [NaN,Infinity,-1])expect(nativeCffScalarRangeMatches(invalid,a,b)).toBe(false);
  expect(nativeCffScalarRangeMatches(native,{x:NaN,width:a.width},b)).toBe(false);
  expect(nativeCffScalarRangeMatches(native,a,{x:b.x,width:-1})).toBe(false);
  expect(nativeCffScalarRangeMatches(0,{x:0,width:0},{x:0,width:0})).toBe(true);
 });
 it('synthetically verifies a fractional source width against current integer hmtx and retains immutable source bytes',async()=>{
  const {asset}=fictionalCffTemplate(bytes);asset.glyphMap.find(m=>m.unicode==='a')!.pdfWidth=768.5;
  const before=new Uint8Array(asset.bytes),sourceWidth=asset.glyphMap.find(m=>m.unicode==='a')!.pdfWidth,d=await deriveBrowserCffFont(asset),mock=stubNativeRanges(d);
  try{const proof=verifyNativeCffCaret(asset,d);expect(proof.derivativeSha256).toBe(d.sha256);expect(proof.coveredScalarsHash).toBe(cffCoveredScalarsHash(d));expect(mock.removed()).toBe(true);expect(asset.bytes).toEqual(before);expect(asset.glyphMap.find(m=>m.unicode==='a')!.pdfWidth).toBe(sourceWidth);}finally{vi.unstubAllGlobals();}
 });
 it('synthetically refuses a loaded derivative with wrong hmtx even if its checksum and native measurements match',async()=>{
  const {asset}=fictionalCffTemplate(bytes),d=await deriveBrowserCffFont(asset),font=fontkit.create(d.bytes),wrong=rewriteCffEditingMetrics(d.bytes,new Map([[97,{glyphId:font.glyphForCodePoint(97).id,pdfWidth:asset.glyphMap.find(m=>m.unicode==='a')!.pdfWidth+2}]])),bad={...d,bytes:wrong,sha256:sha256Sync(wrong)},mock=stubNativeRanges(bad);
  try{expect(()=>verifyNativeCffCaret(asset,bad)).toThrow(/outline\/integer-advance/);expect(mock.removed()).toBe(true);}finally{vi.unstubAllGlobals();}
 });
 it('synthetically refuses a loaded derivative with a different scalar outline despite matching advance',async()=>{
  const {asset}=fictionalCffTemplate(bytes),d=await deriveBrowserCffFont(asset),font=fontkit.create(d.bytes),wrong=rewriteCffEditingMetrics(d.bytes,new Map([[97,{glyphId:font.glyphForCodePoint(98).id,pdfWidth:asset.glyphMap.find(m=>m.unicode==='a')!.pdfWidth}]])),bad={...d,bytes:wrong,sha256:sha256Sync(wrong)},mock=stubNativeRanges(bad);
  try{expect(()=>verifyNativeCffCaret(asset,bad)).toThrow(/outline\/integer-advance/);expect(mock.removed()).toBe(true);}finally{vi.unstubAllGlobals();}
 });
 it('synthetically keeps metric/fallback/face-identity failures unproved and removes its probe span',async()=>{
  const {asset}=fictionalCffTemplate(bytes),d=await deriveBrowserCffFont(asset);
  for(const loaded of [true,false]){const mock=stubNativeRanges(d,(rect,second)=>second?{...rect,x:rect.x+.1}:rect,loaded);try{expect(()=>verifyNativeCffCaret(asset,d)).toThrow();expect(mock.removed()).toBe(true);}finally{vi.unstubAllGlobals();}}
  stubNativeRanges(d);try{for(const bad of [{...d,assetId:'other-face'},{...d,sourceProgramSha256:'0'.repeat(64)},{...d,sourceSha256:'0'.repeat(64)}])expect(()=>verifyNativeCffCaret(asset,bad)).toThrow(/native caret environment/);}finally{vi.unstubAllGlobals();}
 });
});
