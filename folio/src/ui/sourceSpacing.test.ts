import {beforeAll,afterEach,describe,it,expect,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {fictionalSourceTemplate} from '../core/sourceFontTestFixture';
import {sha256Sync} from '../core/model';
import {sourceSpacingAvailability,clearSourceSpacingProofs} from './sourceSpacing';
import {rewriteTrueTypeUnicodeCmap} from './sourceFonts';
import {parseSourceProgram} from '../layout/source-fonts';
let bytes:Uint8Array;
beforeAll(async()=>{bytes=new Uint8Array(await readFile('public/fonts/DejaVuSans.ttf'));});
afterEach(()=>{clearSourceSpacingProofs();vi.unstubAllGlobals();});
/** Synthetic boundary fixture; release also requires actual native browser proof. */
function fixture(originalOwned=false,positiveBlank=false,nativeBlankDrift=0){const f=fictionalSourceTemplate(bytes,'ab'),old=f.region.sourceLayout!;if(old.version!==1)throw Error();const spacing=originalOwned?0:-.25,glyphs=old.glyphs.map((g,i)=>({...g,x:g.x+spacing*i}));
 if(originalOwned){f.asset.sourceVersion=4;f.asset.originalProgram={bytes:new Uint8Array(bytes),sha256:sha256Sync(bytes),pdfFontRef:'1 0 R'};f.asset.glyphMap=f.asset.glyphMap.filter(m=>m.unicode==='a'||m.unicode==='b').map(m=>({...m,originalGlyphId:m.glyphId,originalCharCode:m.glyphId}));f.region.sourceLayout={...old,glyphs};}
 else f.region.sourceLayout={...old,version:3,characterSpacing:spacing,editPolicy:'scalarCovered',glyphs,endX:glyphs[1].x+glyphs[1].advance};
 if(positiveBlank){const face=parseSourceProgram(bytes),gid=face.glyphForCodePoint(32).id;f.asset.bytes=rewriteTrueTypeUnicodeCmap(bytes,new Map(face.characterSet.filter(cp=>face.glyphForCodePoint(cp).id!==gid).map(cp=>[cp,face.glyphForCodePoint(cp).id])));f.asset.sha256=sha256Sync(f.asset.bytes);f.asset.sourceVersion=5;f.asset.glyphMap.push({cid:Math.max(...f.asset.glyphMap.map(m=>m.cid))+1,glyphId:gid,fontChar:gid,unicode:' ',pdfWidth:face.getGlyph(gid).advanceWidth*1000/face.unitsPerEm,nonPainting:true,originalCharCode:gid,originalGlyphId:gid,selectorProvenance:'original-identity-positive-blank-v1'});}
 const node={textContent:''},span={style:{} as Record<string,string>,firstChild:node,get textContent(){return node.textContent},set textContent(t:string){node.textContent=t},getBoundingClientRect:()=>({x:0}),remove(){}};let ranges=0;vi.stubGlobal('document',{fonts:{check:()=>true},body:{append(){}},createElement:()=>span,createRange:()=>{let start=0,end=0;return{setStart(_n:unknown,i:number){start=i},setEnd(_n:unknown,i:number){end=i},getBoundingClientRect(){ranges++;const steps=Array.from(node.textContent).map(c=>f.asset.glyphMap.find(m=>m.unicode===c)!.pdfWidth*12/1000*4/3+spacing*4/3+(c===' '?nativeBlankDrift:0));return{x:steps.slice(0,start).reduce((a,b)=>a+b,0),width:steps.slice(start,end).reduce((a,b)=>a+b,0)};}};}});return{...f,glyphs,ranges:()=>ranges};}
describe('native spacing proof ownership and refresh',()=>{
 it('keeps partially clipped original ink read-only while retaining the same native edge threshold',()=>{
  const f=fixture(true),font=parseSourceProgram(bytes),glyph=f.glyphs[0],map=f.asset.glyphMap.find(m=>m.cid===glyph.cid)!,box=font.getGlyph(map.glyphId).bbox,x=glyph.x+box.minX*12/font.unitsPerEm;
  f.region.sourceScopedPaint={version:'source-scoped-occurrence-v1',kind:'text',sourceSha256:f.asset.sourceSha256,pageNumber:1,rawOperatorIndex:0,operatorIndex:f.region.order,color:{space:'DeviceGray',components:[0]},clipStack:[],effectiveClip:{x:0,y:0,width:500,height:700},stateHash:'a'.repeat(64)};
  expect(sourceSpacingAvailability(f.region,f.asset,f.glyphs,'ab').editable).toBe(true);f.region.sourceScopedPaint.effectiveClip.x=x+1;
  expect(sourceSpacingAvailability(f.region,f.asset,f.glyphs,'ab')).toMatchObject({editable:false});
 });
 it('checks current native ink against the retained clip after a position change',()=>{
  const f=fixture(true);f.region.sourceScopedPaint={version:'source-scoped-occurrence-v1',kind:'text',sourceSha256:f.asset.sourceSha256,pageNumber:1,rawOperatorIndex:0,operatorIndex:f.region.order,color:{space:'DeviceGray',components:[0]},clipStack:[],effectiveClip:{x:0,y:0,width:100,height:700},stateHash:'b'.repeat(64)};
  expect(sourceSpacingAvailability(f.region,f.asset,f.glyphs,'ab').editable).toBe(true);const shifted=f.glyphs.map(g=>({...g,x:g.x+100}));expect(sourceSpacingAvailability(f.region,f.asset,shifted,'ab').editable).toBe(false);
 });
 it('rechecks a changed current graph rather than reusing baseline proof',()=>{const f=fixture();expect(sourceSpacingAvailability(f.region,f.asset,f.glyphs).editable).toBe(true);const seen=f.ranges(),edited=f.glyphs.map(g=>({...g}));edited[1].x+=1;expect(sourceSpacingAvailability(f.region,f.asset,edited).editable).toBe(false);expect(f.ranges()).toBeGreaterThan(seen);expect(sourceSpacingAvailability(f.region,f.asset,f.glyphs).editable).toBe(true);});
 it('clears retained native proofs and enforces graph budgets visibly',()=>{const f=fixture();expect(sourceSpacingAvailability(f.region,f.asset,f.glyphs).editable).toBe(true);const n=f.ranges();clearSourceSpacingProofs();expect(sourceSpacingAvailability(f.region,f.asset,f.glyphs).editable).toBe(true);expect(f.ranges()).toBeGreaterThan(n);expect(sourceSpacingAvailability(f.region,f.asset,Array.from({length:5001},()=>f.glyphs[0])).editable).toBe(false);});
 it('never certifies unsupported current text using its covered subset graph',()=>{const f=fixture();expect(sourceSpacingAvailability(f.region,f.asset,f.glyphs,'abΩ').editable).toBe(false);expect(sourceSpacingAvailability(f.region,f.asset,f.glyphs,'ab\nab').editable).toBe(false);expect(sourceSpacingAvailability(f.region,f.asset,f.glyphs,'ab').editable).toBe(true);});
 it('requires native proof for original-owned TT at zero Tc and refreshes after current edits',()=>{const f=fixture(true);expect(f.region.sourceLayout!.version).toBe(1);expect(sourceSpacingAvailability(f.region,f.asset,f.glyphs,'ab').editable).toBe(true);const seen=f.ranges(),drift=f.glyphs.map(g=>({...g}));drift[1].x+=1;expect(sourceSpacingAvailability(f.region,f.asset,drift,'ab').editable).toBe(false);expect(f.ranges()).toBeGreaterThan(seen);expect(sourceSpacingAvailability(f.region,f.asset,f.glyphs,'abΩ').editable).toBe(false);expect(sourceSpacingAvailability(f.region,f.asset,f.glyphs.slice(0,1),'a').editable).toBe(true);});
 it('keeps a source TJ boundary adjustment read-only even though both native scalar mappings pass',()=>{const f=fixture(true),adjusted=f.glyphs.map(g=>({...g}));adjusted[1].x-=15*12/1000;expect(sourceSpacingAvailability(f.region,f.asset,f.glyphs,'ab').editable).toBe(true);expect(sourceSpacingAvailability(f.region,f.asset,adjusted,'ab').editable).toBe(false);});
 it('keeps the V5 positive blank read-only when a loaded native face has an incorrect space caret width',()=>{const exact=fixture(true,true);expect(sourceSpacingAvailability(exact.region,exact.asset,exact.glyphs,'ab').editable).toBe(true);clearSourceSpacingProofs();const wrong=fixture(true,true,.1);expect(sourceSpacingAvailability(wrong.region,wrong.asset,wrong.glyphs,'ab').editable).toBe(false);});
 it('requires current V6 native boundaries despite small per-scalar PDF/native advance differences',()=>{
  const f=fixture(true),font=parseSourceProgram(bytes);f.asset.sourceVersion=6;f.asset.originalProgram!.selectorContract='identity-h-v1';
  for(const map of f.asset.glyphMap){map.nativeWidth=font.getGlyph(map.glyphId).advanceWidth*1000/font.unitsPerEm;map.pdfWidth=map.nativeWidth+.2;}
  const map=f.asset.glyphMap.find(m=>m.unicode==='a')!,step=map.pdfWidth*12/1000;
  const glyphs=Array.from({length:100},(_,i)=>({...f.glyphs[0],unicode:'a',cid:map.cid,x:40+i*step,advance:step}));
  const span={style:{},firstChild:{},textContent:'',getBoundingClientRect:()=>({x:0}),remove(){}};
  vi.stubGlobal('document',{fonts:{check:()=>true},body:{append(){}},createElement:()=>span,createRange:()=>{let start=0,end=0;return{setStart(_n:unknown,i:number){start=i},setEnd(_n:unknown,i:number){end=i},getBoundingClientRect(){const steps=Array.from(span.textContent).map(c=>f.asset.glyphMap.find(m=>m.unicode===c)!.nativeWidth!*12/1000*4/3);return{x:steps.slice(0,start).reduce((a,b)=>a+b,0),width:steps.slice(start,end).reduce((a,b)=>a+b,0)};}};}});
  // These are controlled DOM-range unit measurements, not a real-browser proof.
  expect(sourceSpacingAvailability(f.region,f.asset,glyphs.slice(0,2),'aa').editable).toBe(true);
  expect(sourceSpacingAvailability(f.region,f.asset,glyphs,'a'.repeat(100)).editable).toBe(false);
  expect(sourceSpacingAvailability(f.region,f.asset,glyphs.slice(0,2),'aa').editable).toBe(true);
 });
});
