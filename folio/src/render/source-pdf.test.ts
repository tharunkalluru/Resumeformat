import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import fontkit from '@pdf-lib/fontkit';
import {PDFArray,PDFDict,PDFDocument,PDFHexString,PDFName,PDFNumber,PDFOperator,PDFRawStream,beginText,endText,setFontAndSize,setTextMatrix,showText,setFillingGrayscaleColor,setFillingRgbColor,decodePDFRawStream,type PDFFont,type PDFPage,type PDFOperatorNames} from 'pdf-lib';
import type {SourceFontAsset,SourcePositionedGlyph,SourceScopedColor} from '../core/model';
import {sha256Sync} from '../core/model';
import {fictionalSourceTemplate} from '../core/sourceFontTestFixture';
import {parseSourceProgram} from '../layout/source-fonts';
import {preflightPdfImages} from '../import/pdf-image-preflight';
import * as sourcePdf from './source-pdf';
import {renderDocument,setFontLoader} from './pdf';

let program:Uint8Array,restoreLoader:()=>void,pdfjs:typeof import('pdfjs-dist/legacy/build/pdf.mjs'),adapter:typeof import('../import/pdf');
beforeAll(async()=>{
 program=new Uint8Array(await readFile('public/fonts/DejaVuSans.ttf'));
 Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});
 pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');adapter=await import('../import/pdf');
 pdfjs.GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
 restoreLoader=setFontLoader(async file=>new Uint8Array(await readFile(resolve('public/fonts',file))));
});
afterAll(()=>restoreLoader());

// The frozen prior emitter is a test-only reference. No source admission or
// paint proof is substituted, and it is used only for authored fixtures.
function priorPaint(page:PDFPage,font:PDFFont,asset:SourceFontAsset,glyphs:readonly SourcePositionedGlyph[],baseline:number,size:number,color:string,sourceColor?:SourceScopedColor){
 const key=page.node.newFontDictionary('FolioSource',font.ref),rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255);
 const paint=sourceColor?.space==='DeviceGray'?setFillingGrayscaleColor(sourceColor.components[0]):setFillingRgbColor(...(sourceColor?sourceColor.components:rgb) as [number,number,number]);
 for(const glyph of glyphs)page.pushOperators(beginText(),paint,setFontAndSize(key,size),setTextMatrix(1,0,0,1,glyph.x,page.getHeight()-baseline),showText(PDFHexString.of(glyph.cid.toString(16).padStart(4,'0'))),endText());
}
async function document(){const d=await PDFDocument.create();d.registerFontkit(fontkit);const font=await d.embedFont(program,{subset:false});return{d,font};}
function content(d:PDFDocument,page:PDFPage){const streams=page.node.Contents();return(streams instanceof PDFArray?streams.asArray():[streams]).map(ref=>new TextDecoder().decode(decodePDFRawStream(d.context.lookup(ref!) as PDFRawStream).decode())).join('\n');}
const fixtureOperators=(raw:readonly string[])=>raw.map(line=>{const parts=line.split(' '),word=parts.pop()!;return PDFOperator.of(word as PDFOperatorNames,parts.map(value=>PDFNumber.of(Number(value))));});

// Independent, deliberately small interpreter of actual serialized operators.
// It does not call the producer, originalOperators, or positionSourceGlyphs.
// Text clipping and arbitrary PDF content are outside this fill-only fixture.
function effectiveTrace(d:PDFDocument,page:PDFPage){
 const text=content(d,page),tokens=text.match(/<[^<>]*>|\/[A-Za-z0-9-]+|[+-]?(?:\d+(?:\.\d*)?|\.\d+)|[A-Za-z*]+|\[|\]/g)??[];
 expect(text.replace(/<[^<>]*>|\/[A-Za-z0-9-]+|[+-]?(?:\d+(?:\.\d*)?|\.\d+)|[A-Za-z*]+|\[|\]/g,'').trim()).toBe('');
 const fonts=page.node.Resources()!.lookup(PDFName.of('Font'),PDFDict),result:unknown[]=[];
 let state={font:'',size:0,color:{space:'DeviceGray',components:[0]},stroke:[0],width:1,ctm:[1,0,0,1,0,0],clips:[] as number[][],tc:0,tw:0,tz:100,tr:0,ts:0};
 const stack:typeof state[]=[],args:string[]=[],counts=new Map<string,number>();let inText=false,matrix=[1,0,0,1,0,0],path:number[]|undefined,pending=false;
 const numeric=(n:number)=>{expect(args).toHaveLength(n);const values=args.map(Number);expect(values.every(Number.isFinite)).toBe(true);return values;};
 for(const token of tokens){if(token.startsWith('/')||token.startsWith('<')||token==='['||token===']'||/^[+\-.\d]/.test(token)){args.push(token);continue;}counts.set(token,(counts.get(token)??0)+1);
  if(token==='q'){expect(args).toEqual([]);stack.push(structuredClone(state));}
  else if(token==='Q'){expect(args).toEqual([]);expect(stack.length).toBeGreaterThan(0);state=stack.pop()!;}
  else if(token==='BT'){expect(args).toEqual([]);expect(inText).toBe(false);inText=true;matrix=[1,0,0,1,0,0];}
  else if(token==='ET'){expect(args).toEqual([]);expect(inText).toBe(true);inText=false;}
  else if(token==='Tf'){expect(args).toHaveLength(2);state.font=fonts.get(PDFName.of(args[0].slice(1)))!.toString();state.size=Number(args[1]);}
  else if(token==='rg'||token==='g')state.color={space:token==='g'?'DeviceGray':'DeviceRGB',components:numeric(token==='g'?1:3)};
  else if(token==='RG'||token==='G')state.stroke=numeric(token==='G'?1:3);
  else if(token==='Tm')matrix=numeric(6);
  else if(token==='Tc')state.tc=numeric(1)[0];else if(token==='Tw')state.tw=numeric(1)[0];else if(token==='Tz')state.tz=numeric(1)[0];else if(token==='Tr'){state.tr=numeric(1)[0];expect(state.tr).toBe(0);}else if(token==='Ts')state.ts=numeric(1)[0];
  else if(token==='Tj'){expect(inText).toBe(true);expect(args).toHaveLength(1);expect(args[0]).toMatch(/^<[0-9a-f]{4}>$/i);result.push({kind:'glyph',...structuredClone(state),matrix:[...matrix],cid:parseInt(args[0].slice(1,-1),16)});}
  else if(token==='cm'){const b=numeric(6),a=state.ctm;state.ctm=[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
  else if(token==='re')path=numeric(4);else if(token==='W'){expect(args).toEqual([]);pending=true;}else if(token==='n'){expect(args).toEqual([]);if(pending){expect(path).toBeDefined();state.clips.push([...path!,...state.ctm]);}path=undefined;pending=false;}
  else if(token==='m')path=numeric(2);else if(token==='l')path=[...path!,...numeric(2)];else if(token==='w')state.width=numeric(1)[0];
  else if(token==='S'||token==='f'){expect(args).toEqual([]);result.push({kind:token,...structuredClone(state),path:[...path!]});path=undefined;}
  else throw new Error(`Unsupported independent test operator ${token}`);
  args.length=0;
 }
 expect(args).toEqual([]);expect(stack).toEqual([]);expect(inText).toBe(false);return{result,counts,tokens:tokens.length};
}

async function decodedGlyphs(bytes:Uint8Array,pageNumber=1){
 const task=pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:false,isOffscreenCanvasSupported:false,verbosity:0});
 try{const page=await(await task.promise).getPage(pageNumber),ops=await page.getOperatorList();let size=0,matrix:number[]=[];const result:{unicode:string;width:number;size:number;matrix:number[]}[]=[];
  for(let i=0;i<ops.fnArray.length;i++){const op=ops.fnArray[i],args=ops.argsArray[i];if(op===pdfjs.OPS.setFont)size=args[1];else if(op===pdfjs.OPS.setTextMatrix)matrix=Array.from(args[0] instanceof Float32Array?args[0]:args);else if(op===pdfjs.OPS.showText)for(const glyph of args[0]){expect(typeof glyph).toBe('object');result.push({unicode:glyph.unicode,width:glyph.width,size,matrix:[...matrix]});}}
  return result;
 }finally{await task.destroy();}
}

describe('within-run source glyph paint compaction',()=>{
 it('preserves independently traced glyph/font/color/matrix/text-state/clip and inter-run artwork order',async()=>{
  const {d,font}=await document(),{asset}=fictionalSourceTemplate(program,'abcd'),boldProgram=new Uint8Array(await readFile('public/fonts/DejaVuSans-Bold.ttf')),other={...fictionalSourceTemplate(boldProgram,'abcd').asset,id:'other-font'},otherFont=await d.embedFont(boldProgram,{subset:false}),glyphs=asset.glyphMap.filter(m=>m.unicode.trim()).map((map,index)=>({fontId:asset.id,cid:map.cid,unicode:map.unicode,x:40+index*7.125,advance:7.125,operatorIndex:1}));
  const run=(page:PDFPage,paint:typeof sourcePdf.paintSourceGlyphs)=>{
   page.pushOperators(...fixtureOperators(['BT','0.1 Tc','0.2 Tw','97 Tz','0 Tr','0.3 Ts','ET','q','1 0 0 1 2.25 3.5 cm','20 30 200 300 re','W','n']));
   paint(page,font,asset,glyphs,52.375,12,'#123456',{space:'DeviceGray',components:[.34751]});
   page.pushOperators(...fixtureOperators(['0.8 g','40 630 30 1 re','f']));
   paint(page,otherFont,other,[...glyphs].reverse().map(g=>({...g,fontId:other.id})),70.125,10.5,'#abcdef',{space:'DeviceRGB',components:[.12345,.45678,.76543]});
   page.pushOperators(...fixtureOperators(['0 G','1 w','40 625 m','70 625 l','S','Q']));
  };
  run(d.addPage([500,700]),priorPaint);run(d.addPage([500,700]),sourcePdf.paintSourceGlyphs);await d.flush();sourcePdf.installSourceCidMap(d,font,asset);sourcePdf.installSourceCidMap(d,otherFont,other);
  const bytes=new Uint8Array(await d.save()),saved=await PDFDocument.load(bytes),before=effectiveTrace(saved,saved.getPages()[0]),after=effectiveTrace(saved,saved.getPages()[1]);
  expect(after.result).toEqual(before.result);expect(after.counts.get('BT')).toBe(3);expect(before.counts.get('BT')).toBe(glyphs.length*2+1);expect(after.counts.get('Tm')).toBe(glyphs.length*2);expect(new Set(after.result.filter(r=>(r as {kind:string}).kind==='glyph').map(r=>(r as {font:string}).font)).size).toBe(2);expect(after.result.map(r=>(r as {kind:string}).kind)).toEqual([...glyphs.map(()=> 'glyph'),'f',...glyphs.map(()=> 'glyph'),'S']);
  expect(await decodedGlyphs(bytes,2)).toEqual(await decodedGlyphs(bytes,1));
 });
 it('emits no text or font resource for an empty valid run and rejects every binding before any paint',async()=>{
  const {d,font}=await document(),{asset}=fictionalSourceTemplate(program,'ab'),page=d.addPage([500,700]),before=page.node.toString();
  sourcePdf.paintSourceGlyphs(page,font,asset,[],52,12,'#000000');expect(page.node.toString()).toBe(before);expect(page.node.Contents()).toBeUndefined();
  const valid={fontId:asset.id,cid:asset.glyphMap[0].cid,unicode:asset.glyphMap[0].unicode,x:40,advance:6,operatorIndex:1};
  for(const bad of [{...valid,fontId:'unowned'},{...valid,cid:65535},{...valid,unicode:'unowned'}]){expect(()=>sourcePdf.paintSourceGlyphs(page,font,asset,[valid,bad],52,12,'#000000')).toThrow(/not bound/);expect(page.node.toString()).toBe(before);}
  expect(()=>sourcePdf.paintSourceGlyphs(page,font,asset,[],52,12,'invalid')).toThrow(/color/);expect(()=>sourcePdf.paintSourceGlyphs(page,font,asset,[],52,12,'#000000',{space:'DeviceGray',components:[NaN]})).toThrow(/color/);expect(page.node.toString()).toBe(before);
 });
 it.each(['gray','rgb'] as const)('keeps a dense authored %s original and full compact canonical inside unchanged preflight while reproducing the prior token failure',async mode=>{
  const {d,font}=await document(),page=d.addPage([500,700]),f=fictionalSourceTemplate(program,'abcd'),native=parseSourceProgram(program);
  f.asset.sourceVersion=4;f.asset.originalProgram={bytes:new Uint8Array(program),sha256:sha256Sync(program),pdfFontRef:font.ref.toString()};
  f.asset.glyphMap=f.asset.glyphMap.filter(m=>m.unicode.trim()).map(m=>({...m,cid:m.glyphId,originalGlyphId:m.glyphId,originalCharCode:m.glyphId,pdfWidth:native.getGlyph(m.glyphId).advanceWidth*1000/native.unitsPerEm}));
  const key=page.node.newFontDictionary('DenseOriginal',font.ref),text='abcd'.repeat(22)+'ab',encoded=PDFHexString.of(Array.from(text,c=>f.asset.glyphMap.find(m=>m.unicode===c)!.cid.toString(16).padStart(4,'0')).join(''));
  page.pushOperators(beginText(),mode==='gray'?setFillingGrayscaleColor(.34751):setFillingRgbColor(.12345,.45678,.76543),setFontAndSize(key,6));
  for(let row=0;row<80;row++)page.pushOperators(setTextMatrix(1,0,0,1,40,680-row*8),showText(encoded));page.pushOperators(endText());
  await d.flush();sourcePdf.installSourceCidMap(d,font,f.asset);const parent=d.context.lookup(font.ref,PDFDict),child=parent.lookup(PDFName.of('DescendantFonts'),PDFArray).lookup(0,PDFDict);child.set(PDFName.of('CIDToGIDMap'),PDFName.of('Identity'));
  const original=new Uint8Array(await d.save()),source=await PDFDocument.load(original),sourceTokens=(content(source,source.getPages()[0]).match(/<[^<>]*>|\/[A-Za-z0-9-]+|[+-]?(?:\d+(?:\.\d*)?|\.\d+)|[A-Za-z*]+|\[|\]/g)??[]).length;expect(sourceTokens).toBe(mode==='gray'?727:729);await expect(preflightPdfImages(original)).resolves.toBeUndefined();
  const file=new File([new Uint8Array(original).buffer],`fictional-dense-${mode}.pdf`,{type:'application/pdf'}),r=await adapter.importPdf(file,original);
  expect(r.template.warnings.filter(w=>w.severity==='blocking')).toEqual([]);expect(r.template.sourceScopedPages).toBeDefined();expect(r.template.sourceFonts!.every(a=>a.format==='truetype'&&!!a.originalProgram)).toBe(true);
  const baseline=await renderDocument(r.template,r.baseline,r.assets);expect(baseline.layout.overflows).toEqual([]);
  const spy=vi.spyOn(sourcePdf,'paintSourceGlyphs').mockImplementation(priorPaint);let previous:Awaited<ReturnType<typeof renderDocument>>;try{previous=await renderDocument(r.template,r.baseline,r.assets);}finally{spy.mockRestore();}
  expect(previous!.layout.overflows).toEqual([]);await expect(preflightPdfImages(previous!.bytes)).rejects.toMatchObject({code:'PDF_IMAGE_PROOF'});await expect(preflightPdfImages(baseline.bytes)).resolves.toBeUndefined();
  const compact=await PDFDocument.load(baseline.bytes),old=await PDFDocument.load(previous!.bytes),trace=effectiveTrace(compact,compact.getPages()[0]),prior=effectiveTrace(old,old.getPages()[0]);
  // Different generated resource names resolve to the same exact font program;
  // font refs occupy the same fresh-document object index in these two renders.
  expect(trace.result).toEqual(prior.result);expect(prior.tokens).toBe(mode==='gray'?115360:129760);expect(trace.tokens).toBe(mode==='gray'?65520:65680);expect(prior.tokens).toBeGreaterThan(100000);expect(trace.tokens).toBeLessThan(100000);expect(trace.counts.get('Tj')).toBe(7200);expect(trace.counts.get('BT')).toBe(80);
  const actual=await decodedGlyphs(baseline.bytes);expect(actual.map(g=>g.unicode).join('')).toBe(text.repeat(80));expect(actual).toHaveLength(7200);
  const fontDictionary=compact.getPages()[0].node.Resources()!.lookup(PDFName.of('Font'),PDFDict),used=fontDictionary.lookup(fontDictionary.keys()[0],PDFDict),desc=used.lookup(PDFName.of('DescendantFonts'),PDFArray).lookup(0,PDFDict),descriptor=desc.lookup(PDFName.of('FontDescriptor'),PDFDict),stream=compact.context.lookup(descriptor.get(PDFName.of('FontFile2'))) as PDFRawStream;
  expect(sha256Sync(decodePDFRawStream(stream).decode())).toBe(sha256Sync(program));
 });
});
