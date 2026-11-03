import {it, expect} from 'vitest';
import {getDocument,GlobalWorkerOptions,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {PDFDocument,PDFName} from 'pdf-lib';
import {resolve} from 'node:path';
import {authoredMacRomanSource} from './document-scoped-test-fixture';
import {localPdfDecoderOptions} from '../render/pdf-decoder-options';
import {originalWholeShows,decodedPdfDecimal} from './pdf-atomic-paint';

const text='BT /F1 10 Tf 11.5 TL 39.6000000000000014 172.2000000000000455 Td <00410042> Tj ET';
const decoded=()=>({fnArray:[OPS.beginText,OPS.moveText,OPS.showText,OPS.endText],
  argsArray:[[],[39.6,172.20000000000002],[[{originalCharCode:65},{originalCharCode:66}]],[]]});
it('proves the initial BT identity matrix plus one exact Td before glyph paint',()=>{
  const show=originalWholeShows(text,decoded(),true).get(2)!;
  expect(show.fullTextMatrix).toEqual([1,0,0,1,39.6,172.20000000000005]);
  expect(show.codes).toEqual([65,66]);
});
it('keeps a nonidentical Td in the prior per-glyph route and rejects unbounded operands',()=>{
  const changed=decoded();changed.argsArray[1]=[39.7,172.20000000000005];
  expect(originalWholeShows(text,changed,true).size).toBe(0);
  expect(()=>originalWholeShows(text.replace('39.6000000000000014 172.2000000000000455','1000001 0'),decoded(),true)).toThrow();
});
it('does not infer an advance or reset for subsequent shows or moves',()=>{
  const next=decoded();next.fnArray.splice(3,0,OPS.showText);next.argsArray.splice(3,0,next.argsArray[2]);
  expect(originalWholeShows(text.replace(' ET',' <00410042> Tj ET'),next,true).size).toBe(1);
  expect(originalWholeShows(text.replace(' Td',' Td 1 0 Td'),decoded(),true).size).toBe(0);
});
it('matches the actual pinned decoder decimal algorithm and preserves raw output coordinates',async()=>{
 GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
 const source=await authoredMacRomanSource({codes:[65,66]}),pdf=await PDFDocument.load(source.bytes);
 const raw='BT /F1 10 Tf 39.6000000000000014 172.2000000000000455 Td <4142> Tj ET';
 pdf.getPages()[0].node.set(PDFName.of('Contents'),pdf.context.register(pdf.context.flateStream(raw)));
 const task=getDocument({...localPdfDecoderOptions(),data:new Uint8Array(await pdf.save()),fontExtraProperties:true,verbosity:0});
 try{const page=await(await task.promise).getPage(1),ops=await page.getOperatorList();
  const index=ops.fnArray.indexOf(OPS.moveText);expect(ops.argsArray[index]).toEqual([39.6,172.20000000000002]);
  expect(decodedPdfDecimal('172.2000000000000455')).toBe(ops.argsArray[index][1]);
  expect([...originalWholeShows(raw,ops,true).values()][0].fullTextMatrix).toEqual([1,0,0,1,39.6,172.20000000000005]);
 }finally{await task.destroy();}
});
it.each(['--1','1e2','1.2.3','NaN','1000001','9'.repeat(65)])('refuses noncanonical or unbounded decimal %s',token=>{
 expect(()=>decodedPdfDecimal(token)).toThrow();
});
