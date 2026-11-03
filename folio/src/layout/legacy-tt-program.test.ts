import {beforeAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {PDFDocument} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {legacyTrueTypeProgramFingerprint,isTrustedLegacyTrueTypeProgram} from './legacy-tt-program';
let original:Uint8Array;
beforeAll(async()=>{original=new Uint8Array(await readFile('tests/fixtures/fonts/Carlito-Regular.ttf'));Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});});
it('pins native program tables independently of PDF.js Unicode aliases and appended notdef transport',async()=>{
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);const font=await pdf.embedFont(original,{subset:false});pdf.addPage([500,700]).drawText('abc',{font,size:12,x:40,y:648});const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs'),task=pdfjs.getDocument({data:await pdf.save(),useSystemFonts:false,isOffscreenCanvasSupported:false,fontExtraProperties:true,verbosity:0});
 try{const page=await(await task.promise).getPage(1),ops=await page.getOperatorList(),alias=ops.argsArray[ops.fnArray.indexOf(pdfjs.OPS.setFont)][0],converted=page.commonObjs.get(alias).data;expect(isTrustedLegacyTrueTypeProgram(original)).toBe(true);expect(isTrustedLegacyTrueTypeProgram(converted)).toBe(true);}finally{await task.destroy();}
});
it('rejects a generic full TrueType program and modified trusted native instructions',async()=>{const other=new Uint8Array(await readFile('public/fonts/DejaVuSans.ttf'));expect(isTrustedLegacyTrueTypeProgram(other)).toBe(false);const modified=new Uint8Array(original),v=new DataView(modified.buffer);for(let i=0;i<v.getUint16(4);i++){const p=12+i*16;if(String.fromCharCode(...modified.subarray(p,p+4))==='prep'){modified[v.getUint32(p+8)]^=1;break;}}expect(isTrustedLegacyTrueTypeProgram(modified)).toBe(false);});
