import {beforeAll,it,expect} from 'vitest';
import {PDFDocument,PDFName,PDFDict,PDFArray,PDFNumber,PDFString,StandardFonts} from 'pdf-lib';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {resolve} from 'node:path';
import {importPdf} from './pdf';
import {makeProject} from '../core/model';
import {renderProjectDocument} from '../render/pdf';
import {sourceLinkProofHash,currentSourceLinks} from '../core/source-links';
import {backupProject,restoreProject} from '../storage/projects';
import 'fake-indexeddb/auto';
beforeAll(async()=>{Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});
async function linked(options:{unsafe?:boolean;appearance?:boolean;unowned?:boolean}={}){
 const d=await PDFDocument.create(),f=await d.embedFont(StandardFonts.Helvetica),p=d.addPage([500,700]),prefix='Fictional contact: ',text=prefix+'example.com';p.drawText(text,{font:f,size:12,x:50,y:600});const x=50+f.widthOfTextAtSize(prefix,12),width=f.widthOfTextAtSize('example.com',12),rect=[x,options.unowned?300:596,x+width,options.unowned?314:610];const annotation=d.context.obj({Type:'Annot',Subtype:'Link',Rect:rect,Border:[0,0,0],F:4,A:{S:'URI',URI:PDFString.of(options.unsafe?'javascript:alert(1)':'https://example.com/profile')},...(options.appearance?{AP:{N:d.context.register(d.context.flateStream('q Q',{Type:'XObject',Subtype:'Form',BBox:[0,0,10,10]}))}}:{})});p.node.addAnnot(d.context.register(annotation));const bytes=await d.save();return{bytes,rect,prefix,text};
}
async function project(options?:Parameters<typeof linked>[0]){const f=await linked(options);return{...f,project:makeProject(await importPdf(new File([new Uint8Array(f.bytes).buffer],'authored-link.pdf',{type:'application/pdf'}),f.bytes),true)};}
it('retains the exact original URI rectangle and links only the selected part of a single source show',async()=>{
 const f=await project(),p=f.project,block=p.baseline.blocks[0],link=p.template.sourceLinks![0];expect(block.runs.map(r=>[r.text,r.href])).toEqual([[f.prefix,undefined],['example.com','https://example.com/profile']]);expect(link.bindings[0].utf16Range).toEqual([f.prefix.length,f.text.length]);expect(currentSourceLinks(p.template,p.baseline,p.template.pages[0].id).links).toHaveLength(1);
 const output=await PDFDocument.load((await renderProjectDocument(p,'baselinePreview')).bytes),annotations=output.getPage(0).node.Annots()!;expect(annotations.size()).toBe(1);const annotation=annotations.lookup(0,PDFDict);expect(annotation.lookup(PDFName.of('Rect'),PDFArray).asArray().map((_,i)=>(annotation.lookup(PDFName.of('Rect'),PDFArray).lookup(i) as PDFNumber).asNumber())).toEqual(f.rect);expect(annotation.lookup(PDFName.of('A'),PDFDict).lookup(PDFName.of('URI'),PDFString).decodeText()).toBe('https://example.com/profile');
});
it('refuses unsafe destinations, unrendered annotation appearances and unowned text rectangles',async()=>{for(const options of [{unsafe:true},{appearance:true},{unowned:true}])await expect(project(options)).rejects.toMatchObject({code:'PDF_STANDARD_LINK'});});
it('coherent link-rectangle changes cannot replace freshly captured source geometry',async()=>{const {project:p}=await project(),link=p.template.sourceLinks![0];link.bounds.x+=1;link.proofHash=sourceLinkProofHash(link);await expect(renderProjectDocument(p,'baselinePreview')).rejects.toMatchObject({code:'PDF_STANDARD_FONT'});await expect(backupProject(p)).rejects.toMatchObject({code:'PDF_STANDARD_FONT'});});
it('round trips the complete original link binding and does not retain its old rectangle after a text edit',async()=>{
 const {project:p}=await project(),blob=await backupProject(p),restored=await restoreProject(new File([await blob.arrayBuffer()],'authored-link.folio'));expect(restored.template.sourceLinks).toEqual(p.template.sourceLinks);await renderProjectDocument(restored,'baselinePreview');const changed=structuredClone(restored.draft);changed.blocks[0].runs[0].text='Contact: ';expect(currentSourceLinks(restored.template,changed,restored.template.pages[0].id).links).toHaveLength(0);
});
