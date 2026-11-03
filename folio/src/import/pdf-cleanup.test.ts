import {afterEach,expect,it,vi} from 'vitest';
const control=vi.hoisted(()=>({release:undefined as undefined|(()=>void)}));
vi.mock('./pdf-icc',()=>({sourceIccProfile:async()=>undefined}));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs',async importOriginal=>{
 const actual=await importOriginal<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>();
 return{...actual,getDocument:()=>({promise:Promise.reject(new Error('Authored invalid PDF')),destroy:()=>new Promise<void>(resolve=>{control.release=resolve;})})};
});
afterEach(()=>{control.release?.();control.release=undefined;vi.useRealTimers();});
it('preserves an actionable parse refusal when decoder cleanup does not settle',async()=>{
 vi.useFakeTimers();const {importPdf}=await import('./pdf');
 const bytes=new Uint8Array([37,80,68,70]),pending=importPdf(new File([bytes.buffer],'fictional-invalid.pdf'),bytes).catch(e=>e);
 await vi.advanceTimersByTimeAsync(1);
 expect(await pending).toMatchObject({code:'CORRUPT_PDF'});
});
