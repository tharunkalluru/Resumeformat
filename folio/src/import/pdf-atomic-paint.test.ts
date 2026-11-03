import {PDFDocument,PDFName} from 'pdf-lib';
import {resolve} from 'node:path';
import {authoredMacRomanSource} from './document-scoped-test-fixture';
import {localPdfDecoderOptions} from '../render/pdf-decoder-options';
import {describe,it,expect} from 'vitest';
import {getDocument,GlobalWorkerOptions,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {originalWholeShows,originalStringBytes,originalAdjustedParts,sourceClipLifetimePlan} from './pdf-atomic-paint';
import {traceScopedPaint,type ScopedPaintInventory} from './pdf-scoped-paint';
import {originalPageContent,originalOperators} from './pdf-image-trace';
const decoded=(codes=[65,32,66]):{fnArray:number[];argsArray:any[][]}=>({fnArray:[OPS.setTextMatrix,OPS.setCharSpacing,OPS.showText],argsArray:[[new Float32Array([45,0,0,45,166.66666666666666,2700])],[.1],[codes.map(originalCharCode=>({originalCharCode}))]]});
const text='BT /F1 1 Tf .1 Tc 45 0 0 45 166.66666666666666 2700 Tm <412042> Tj ET';
const trace=(s:string)=>traceScopedPaint(originalOperators(s),{viewport:[1,0,0,-1,0,700],pageBounds:{x:0,y:0,width:500,height:700}});
const plan=(inventory:ScopedPaintInventory)=>sourceClipLifetimePlan(inventory,new Map(inventory.occurrences.map((p,i)=>[i,p])));
describe('bounded whole-show and clip lifetime candidates',()=>{
 it('preserves full raw translation, Tc and exact code order including genuine space',()=>{const s=originalWholeShows(text,decoded()).get(2)!;expect(s.fullTextMatrix).toEqual([45,0,0,45,166.66666666666666,2700]);expect(s.characterSpacing).toBe(.1);expect(s.codes).toEqual([65,32,66]);expect(Object.isFrozen(s.codes)).toBe(true);});
 it.each(['(A\\040B)','<412042>'])('decodes original bounded string %s',v=>expect(originalStringBytes(v)).toEqual([65,32,66]));
 it('matches two-byte codes independently and refuses changed/dropped/duplicate decoded codes',()=>{expect(originalWholeShows(text.replace('<412042>','<004100200042>'),decoded()).size).toBe(1);for(const codes of [[65,66],[65,32,67],[65,32,66,66]])expect(()=>originalWholeShows(text,decoded(codes))).toThrow();});
 it.each(['continuation','move','rise','word','scale','mode'])('does not qualify %s as complete explicit-reset Tj',kind=>{let t=text;if(kind==='TJ')t=t.replace('<412042> Tj','[<412042>] TJ');if(kind==='continuation')t=t.replace('45 0 0 45 166.66666666666666 2700 Tm ','');if(kind==='move')t=t.replace('<412042>','1 0 Td <412042>');if(kind==='rise')t=t.replace('.1 Tc','.1 Tc 1 Ts');if(kind==='word')t=t.replace('.1 Tc','.1 Tc 1 Tw');if(kind==='scale')t=t.replace('.1 Tc','.1 Tc 90 Tz');if(kind==='mode')t=t.replace('.1 Tc','.1 Tc 1 Tr');expect(originalWholeShows(t,decoded()).size).toBe(0);});
 it('second show requires a new explicit reset',()=>{const d=decoded();d.fnArray.push(OPS.showText);d.argsArray.push(d.argsArray[2]);expect(originalWholeShows(text.replace(' ET',' <412042> Tj ET'),d).size).toBe(1);d.fnArray.splice(3,0,OPS.setTextMatrix);d.argsArray.splice(3,0,[new Float32Array([45,0,0,45,200,2700])]);expect(originalWholeShows(text.replace(' ET',' 45 0 0 45 200 2700 Tm <412042> Tj ET'),d).size).toBe(2);});
 it('keeps shared, nested and sibling original identities instead of merging bounds',()=>{const i=trace('q 0 0 400 400 re W n 1 1 2 2 re f q 0 0 300 300 re W n 2 2 2 2 re f Q q 0 0 300 300 re W n 3 3 2 2 re f Q 4 4 2 2 re f Q 5 5 2 2 re f');const p=plan(i);expect(p.map(x=>x.clips.length)).toEqual([1,2,2,1,0]);expect(p[1].clips[1].clipOperatorIndex).not.toBe(p[2].clips[1].clipOperatorIndex);});
 it('pending W consumed by fill paints before clip activation, including source operator zero',()=>{const i=trace('0 0 400 400 re W f 1 1 2 2 re f');expect(i.clips[0].pathOperatorIndex).toBe(0);expect(plan(i).map(p=>p.clips.length)).toEqual([0,1]);});
 it.each(['empty','reappear','duplicate','changed','parent','missing'])('refuses %s clip lifetime proof',kind=>{const i=trace('q 0 0 400 400 re W n 1 1 2 2 re f 2 2 2 2 re f Q 3 3 2 2 re f');if(kind==='empty')i.clips.push({...i.clips[0],clipOperatorIndex:999});if(kind==='reappear'){i.occurrences[1].clipStack=[];i.occurrences[2].clipStack=[i.clips[0]];}if(kind==='duplicate')i.occurrences[0].clipStack.push(i.clips[0]);if(kind==='changed')i.occurrences[0].clipStack[0].bounds.x++;if(kind==='parent'){const c={...i.clips[0],clipOperatorIndex:999};i.clips.push(c);i.occurrences[1].clipStack=[c,i.clips[0]];}if(kind==='missing')i.clips=[];expect(()=>plan(i)).toThrow();});
 it('retains binary literal bytes and rejects decoded Unicode masquerading as bytes',()=>{expect(originalStringBytes('('+String.fromCharCode(128,130,159)+')')).toEqual([128,130,159]);expect(originalStringBytes('(\\200\\202\\237)')).toEqual([128,130,159]);expect(originalStringBytes('<80829f>')).toEqual([128,130,159]);expect(originalStringBytes('(\\777)')).toEqual([255]);expect(()=>originalStringBytes('(€)')).toThrow();});
 it.each(['translation','spacing'])('rejects raw/decoded %s disagreement',kind=>{const d=decoded();if(kind==='translation')d.argsArray[0]=[new Float32Array([45,0,0,45,167,2700])];else d.argsArray[1]=[.2];expect(()=>originalWholeShows(text,d)).toThrow();});
 it('no-clip and source q/Q without new clips remain valid',()=>{expect(plan(trace('q 1 1 2 2 re f Q'))[0].clips).toEqual([]);});
});

describe('original binary content transport',()=>{
 it.each(['literal','escaped','hex'])('binds authored MacRoman high bytes to pinned decoded codes: %s',async kind=>{
  const codes=[128,130,159],source=await authoredMacRomanSource({codes}),pdf=await PDFDocument.load(source.bytes);
  const literal=kind==='literal'?'('+String.fromCharCode(...codes)+')':kind==='escaped'?'(\\200\\202\\237)':'<80829f>';
  const raw='q BT /F1 12 Tf 1 0 0 1 40 648 Tm '+literal+' Tj ET Q';
  pdf.getPages()[0].node.set(PDFName.of('Contents'),pdf.context.register(pdf.context.flateStream(Uint8Array.from(raw,c=>c.charCodeAt(0)))));
  const bytes=new Uint8Array(await pdf.save()),retained=await PDFDocument.load(bytes);
  const binary=originalPageContent(retained,1,true);expect(binary).toBe(raw+'\n');
  if(kind==='literal'){expect(originalPageContent(retained,1)).not.toBe(binary);expect(()=>originalStringBytes('('+new TextDecoder('latin1').decode(new Uint8Array(codes))+')')).toThrow();}
  Object.assign(globalThis,{pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  const task=getDocument({...localPdfDecoderOptions(),data:bytes,useSystemFonts:false,isOffscreenCanvasSupported:false,fontExtraProperties:true,verbosity:0});
  try{const doc=await task.promise,ops=await(await doc.getPage(1)).getOperatorList(),actual=ops.argsArray[ops.fnArray.indexOf(OPS.showText)][0].map((g:{originalCharCode:number})=>g.originalCharCode);expect(actual).toEqual(codes);expect([...originalWholeShows(binary,ops).values()][0].codes).toEqual(codes);}finally{await task.destroy();}
 });
});

it('preserves flat TJ strings, empty strings and exact signed adjustments against decoder sequence',()=>{const d=decoded();d.argsArray[2]=[[{originalCharCode:65},-12.5,{originalCharCode:32},0,{originalCharCode:66}]];const raw=text.replace('<412042> Tj','[<41> -12.5 () ( ) 0 <42>] TJ');const show=originalWholeShows(raw,d).get(2)!;expect(show.kind).toBe('TJ');expect(show.parts).toEqual([[65],-12.5,[],[32],0,[66]]);for(const changed of ['-12.4','12.5'])expect(()=>originalWholeShows(raw.replace('-12.5',changed),d)).toThrow();});
it.each(['[[<41>]]','[<41> /Name]','[<41> 1e3]','[<41> NaN]','[<41> 1000001]','[<< /A 1 >>]','[(unterminated]'])('rejects invalid flat adjusted syntax %s',raw=>expect(()=>originalAdjustedParts(raw)).toThrow());
it('decodes binary and escaped high bytes inside adjusted arrays without Unicode substitution',()=>{expect(originalAdjustedParts('[(\\200\\202\\237) -4 <80829f>]')).toEqual([[128,130,159],-4,[128,130,159]]);expect(()=>originalAdjustedParts('[(€)]')).toThrow();});
