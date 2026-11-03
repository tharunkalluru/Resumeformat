import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {JSDOM} from 'jsdom';
import JSZip from 'jszip';
import {PDFDocument} from 'pdf-lib';
import {importDocx} from './docx';
import {MAX_SOURCE_PAGES,makeProject,sha256Sync} from '../core/model';
import {validateProject} from '../core/schema';
import {setFontLoader} from '../layout/fonts';
import {renderProjectDocument} from '../render/pdf';
import {localPdfDecoderOptions} from '../render/pdf-decoder-options';

let restore:()=>void,dom:JSDOM;
beforeAll(async()=>{
 dom=new JSDOM('');Object.assign(globalThis,{DOMParser:dom.window.DOMParser,XMLSerializer:dom.window.XMLSerializer,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});
 const {GlobalWorkerOptions}=await import('pdfjs-dist/legacy/build/pdf.mjs');GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
 restore=setFontLoader(async name=>new Uint8Array(await readFile(resolve('public/fonts',name))));
});
afterAll(()=>{restore();dom.window.close();});
async function authored(pages:number,trailingBreak=false){
 const zip=new JSZip();
 zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="root" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 const paragraphs=Array.from({length:pages},(_,i)=>`<w:p>${i?'<w:pPr><w:pageBreakBefore/></w:pPr>':''}<w:r><w:t>Fictional retained page ${i+1}</w:t>${trailingBreak&&i===pages-1?'<w:br w:type="page"/>':''}</w:r></w:p>`).join('');
 zip.file('word/document.xml',`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>`);
 return new Uint8Array(await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}));
}
const file=(b:Uint8Array)=>new File([new Uint8Array(b).buffer],'fictional-bounded-pages.docx');
describe('bounded Word pagination uses the common document cap',()=>{
 it('retains all32 content pages including finalpage and does not invent a33rd page for a trailingbreak',async()=>{
  const bytes=await authored(MAX_SOURCE_PAGES,true),hash=sha256Sync(bytes),project=validateProject(makeProject(await importDocx(file(bytes),bytes)));
  expect(project.template.pages).toHaveLength(MAX_SOURCE_PAGES);expect(project.source.sourcePageCount).toBeNull();expect(project.source.bytes).toEqual(bytes);
  expect(project.baseline.blocks.map(b=>b.runs.map(r=>r.text).join(''))).toEqual(Array.from({length:MAX_SOURCE_PAGES},(_,i)=>`Fictional retained page ${i+1}`));
  expect(project.facts).toHaveLength(MAX_SOURCE_PAGES);const last=project.template.pages.at(-1)!;expect(last.regions).toHaveLength(1);expect(last.regions[0]).toMatchObject({kind:'text',bounds:{x:72,y:72,width:468}});
  const before=structuredClone(project),output=await renderProjectDocument(project,'baselinePreview');expect((await PDFDocument.load(output.bytes)).getPageCount()).toBe(MAX_SOURCE_PAGES);
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs'),task=getDocument({...localPdfDecoderOptions(),data:new Uint8Array(output.bytes),verbosity:0});
  try{const pdf=await task.promise,text=await(await pdf.getPage(MAX_SOURCE_PAGES)).getTextContent();expect(text.items.filter((i):i is typeof i&{str:string}=>'str'in i).map(i=>i.str).join('')).toBe(`Fictional retained page ${MAX_SOURCE_PAGES}`);}finally{await task.destroy();}
  expect(project).toEqual(before);expect(sha256Sync(project.source.bytes)).toBe(hash);expect(sha256Sync(bytes)).toBe(hash);
 });
 it('refuses the33rd contentpage with the exact page-limit code and unchanged input',async()=>{
  const bytes=await authored(MAX_SOURCE_PAGES+1),hash=sha256Sync(bytes);await expect(importDocx(file(bytes),bytes)).rejects.toMatchObject({code:'PAGE_LIMIT',message:`This DOCX reconstructs to more than ${MAX_SOURCE_PAGES} pages. Choose a shorter document.`});expect(sha256Sync(bytes)).toBe(hash);
 });
});
