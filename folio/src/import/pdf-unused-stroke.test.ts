import {afterAll,beforeAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {PDFDocument,StandardFonts,setLineWidth,rectangle,fill,stroke,PDFOperator,PDFOperatorNames} from 'pdf-lib';
import {makeProject,sha256Sync} from '../core/model';
import {validateProject} from '../core/schema';
import {setFontLoader} from '../layout/fonts';
import {renderProjectDocument} from '../render/pdf';
import {importResume} from './index';

let restore:()=>void;
beforeAll(async()=>{
 Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});
 restore=setFontLoader(async file=>new Uint8Array(await readFile(resolve('public/fonts',file))));
 await import('./pdf');
 (await import('pdfjs-dist/legacy/build/pdf.mjs')).GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
});
afterAll(()=>restore());
async function authored(paint:'fill'|'evenOdd'|'stroke'){
 const pdf=await PDFDocument.create(),page=pdf.addPage([612,792]),font=await pdf.embedFont(StandardFonts.Helvetica);
 page.drawText('Fictional retained source',{x:40,y:700,size:12,font});
 page.pushOperators(setLineWidth(1000),rectangle(40,690,200,2),paint==='stroke'?stroke():paint==='evenOdd'?PDFOperator.of(PDFOperatorNames.FillEvenOdd):fill());
 return new Uint8Array(await pdf.save({useObjectStreams:false}));
}
it.each(['fill','evenOdd'] as const)('imports and renders a %s rectangle with a large unused stroke state',async paint=>{
 const bytes=await authored(paint),hash=sha256Sync(bytes),result=await importResume(new File([new Uint8Array(bytes).buffer],'fictional-unused-stroke.pdf',{type:'application/pdf'}));
 const project=validateProject(makeProject(result)),rect=project.template.pages[0].regions.find(r=>r.kind==='rectangle');
 expect(rect).toMatchObject({kind:'rectangle',fill:'#000000',thickness:0,bounds:{x:40,y:100,width:200,height:2}});
 expect(rect&&'stroke'in rect?rect.stroke:undefined).toBeUndefined();
 const output=await renderProjectDocument(project,'baselinePreview');
 expect((await PDFDocument.load(output.bytes)).getPageCount()).toBe(1);
 expect(sha256Sync(project.source.bytes)).toBe(hash);expect(sha256Sync(bytes)).toBe(hash);
});
it('keeps an actual oversized stroke subject to the existing geometry limit',async()=>{
 const bytes=await authored('stroke'),result=await importResume(new File([new Uint8Array(bytes).buffer],'fictional-active-stroke.pdf',{type:'application/pdf'}));
 expect(()=>validateProject(makeProject(result))).toThrow();
});
