import {beforeAll,it,expect} from 'vitest';
import {PDFArray,PDFDocument,PDFName,PDFDict,PDFRef,type PDFObject} from 'pdf-lib';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import {knownPdfFont} from './pdf-fonts';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {usesOnlyNonembeddedStandardFonts} from './pdf-standard-fonts';
import {localPdfDecoderOptions} from '../render/pdf-decoder-options';
import {captureSourceGlyphs} from './pdf-source';
import {sha256Sync,type SourceFontAsset} from '../core/model';
import {OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
const names=['Times-Roman','Times-Bold','Times-Italic','Times-BoldItalic','Helvetica','Helvetica-Bold','Helvetica-Oblique','Helvetica-BoldOblique','Courier','Courier-Bold','Courier-Oblique','Courier-BoldOblique','Symbol','ZapfDingbats'];
beforeAll(async()=>{Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});const p=await import('pdfjs-dist/legacy/build/pdf.mjs');p.GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});
async function authored(name='Helvetica'){
 const pdf=await PDFDocument.create(),page=pdf.addPage([612,792]),font=pdf.context.obj({Type:'Font',Subtype:'Type1',BaseFont:name}),ref=pdf.context.register(font),fonts=pdf.context.obj({F:ref}),resources=pdf.context.obj({Font:fonts});page.node.set(PDFName.of('Resources'),resources);
 const content=(text:string)=>page.node.set(PDFName.of('Contents'),pdf.context.register(pdf.context.flateStream(text)));content('BT /F 11 Tf 1 0 0 1 72 700 Tm (AB) Tj ET');return{pdf,page,font,ref,fonts,resources,content,bytes:async()=>new Uint8Array(await pdf.save())};
}
const ops=()=>({fnArray:[OPS.setFont],argsArray:[['decoded',11] as any[]]});
it.each(names)('classifies nonembedded %s with actual pinned selections, without owned assets',async name=>{
 const a=await authored(name),raw=await a.bytes(),{getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs'),task=getDocument({...localPdfDecoderOptions(),data:new Uint8Array(raw),fontExtraProperties:true,verbosity:0});try{const page=await(await task.promise).getPage(1),list=await page.getOperatorList();expect(await usesOnlyNonembeddedStandardFonts(raw,1,list)).toBe(true);const assets:SourceFontAsset[]=[];expect(await captureSourceGlyphs(page,page.getViewport({scale:1}).transform,sha256Sync(raw),assets,raw,1)).toBeUndefined();expect(assets).toEqual([]);}finally{await task.destroy();}
});
it.each(['FontFile','FontFile2','FontFile3'])('rejects descriptor %s presence including malformed references',async key=>{
 for(const value of ['stream','dangling','number']){const a=await authored('Times-Roman'),entry=value==='stream'?a.pdf.context.register(a.pdf.context.stream(new Uint8Array([0,1,2]))):value==='dangling'?PDFRef.of(900):a.pdf.context.obj(1);a.font.set(PDFName.of('FontDescriptor'),a.pdf.context.obj({[key]:entry,Flags:4}));expect(await usesOnlyNonembeddedStandardFonts(await a.bytes(),1,ops())).toBe(false);}
});
it.each(['Type0','TrueType','Type3'])('does not trust standard names on %s resources',async subtype=>{const a=await authored('Times-Roman');a.font.set(PDFName.of('Subtype'),PDFName.of(subtype));a.font.set(PDFName.of('FontDescriptor'),a.pdf.context.obj({FontFile2:a.pdf.context.register(a.pdf.context.stream(new Uint8Array([0,1,2])))}));expect(await usesOnlyNonembeddedStandardFonts(await a.bytes(),1,ops())).toBe(false);});
it.each(['ABCDEF+Times-Roman','Arial','NotStandard'])('rejects raw name %s without normalization',async name=>{const a=await authored(name);expect(await usesOnlyNonembeddedStandardFonts(await a.bytes(),1,ops())).toBe(false);});
it('accepts a nonembedding descriptor but not malformed descriptors or misplaced files',async()=>{
 const a=await authored();a.font.set(PDFName.of('FontDescriptor'),a.pdf.context.obj({Type:'FontDescriptor',Flags:32}));expect(await usesOnlyNonembeddedStandardFonts(await a.bytes(),1,ops())).toBe(true);
 for(const value of [a.pdf.context.obj(1),PDFName.of('None'),PDFRef.of(999)]){a.font.set(PDFName.of('FontDescriptor'),value);expect(await usesOnlyNonembeddedStandardFonts(await a.bytes(),1,ops())).toBe(false);}
 a.font.delete(PDFName.of('FontDescriptor'));a.font.set(PDFName.of('FontFile2'),PDFRef.of(999));expect(await usesOnlyNonembeddedStandardFonts(await a.bytes(),1,ops())).toBe(false);
});
it('ignores unused decoys but cannot skip mixed embedded/unknown selections',async()=>{
 for(const subtype of ['TrueType','Unknown']){const a=await authored(),ref=a.pdf.context.register(a.pdf.context.obj({Type:'Font',Subtype:subtype,BaseFont:'Times-Roman',FontDescriptor:{FontFile2:PDFRef.of(999)}}));a.fonts.set(PDFName.of('Other'),ref);expect(await usesOnlyNonembeddedStandardFonts(await a.bytes(),1,ops())).toBe(true);a.content('BT /F 11 Tf (A) Tj /Other 11 Tf (B) Tj ET');expect(await usesOnlyNonembeddedStandardFonts(await a.bytes(),1,{fnArray:[OPS.setFont,OPS.setFont],argsArray:[['a',11],['b',11]]})).toBe(false);}
});
it.each(['count','size','alias','missing','direct','gs','form','inline','quote'])('refuses unbound/hidden %s selection',async mode=>{
 const a=await authored();let list=ops();if(mode==='count')list={fnArray:[],argsArray:[]};if(mode==='size')list.argsArray[0][1]=12;if(mode==='alias'){a.content('BT /F 11 Tf (A) Tj /F 11 Tf (B) Tj ET');list={fnArray:[OPS.setFont,OPS.setFont],argsArray:[['a',11],['b',11]]};}if(mode==='missing')a.fonts.delete(PDFName.of('F'));if(mode==='direct')a.fonts.set(PDFName.of('F'),a.font);if(mode==='gs'){a.resources.set(PDFName.of('ExtGState'),a.pdf.context.obj({G:{Font:[a.ref,11]}}));a.content('/G gs BT /F 11 Tf (A) Tj ET');}if(mode==='form'){a.resources.set(PDFName.of('XObject'),a.pdf.context.obj({X:a.pdf.context.register(a.pdf.context.stream(new Uint8Array(),{Subtype:'Form'}))}));a.content('/X Do BT /F 11 Tf (A) Tj ET');}if(mode==='inline')a.content('BI ID xx EI BT /F 11 Tf (A) Tj ET');if(mode==='quote')a.content("BT /F 11 Tf (A) ' ET");expect(await usesOnlyNonembeddedStandardFonts(await a.bytes(),1,list)).toBe(false);
});
it('permits40 duplicate raw dictionaries sharing1 decoded alias, not distinct identities',async()=>{
 const a=await authored(),list={fnArray:[] as number[],argsArray:[] as any[][]},parts=[];for(let i=0;i<40;i++){a.fonts.set(PDFName.of('F'+i),a.pdf.context.register(a.pdf.context.obj({Type:'Font',Subtype:'Type1',BaseFont:'Helvetica'})));parts.push(`/F${i} 11 Tf (A) Tj`);list.fnArray.push(OPS.setFont);list.argsArray.push(['same',11]);}a.content('BT '+parts.join(' ')+' ET');expect(await usesOnlyNonembeddedStandardFonts(await a.bytes(),1,list)).toBe(true);a.fonts.lookup(PDFName.of('F39'),PDFDict).set(PDFName.of('BaseFont'),PDFName.of('Times-Roman'));expect(await usesOnlyNonembeddedStandardFonts(await a.bytes(),1,list)).toBe(false);
});
it('preserves source, page, decoded-face and operator caps',async()=>{
 const a=await authored(),raw=await a.bytes();expect(await usesOnlyNonembeddedStandardFonts(new Uint8Array(10*1024*1024+1),1,ops())).toBe(false);expect(await usesOnlyNonembeddedStandardFonts(raw,2,ops())).toBe(false);expect(await usesOnlyNonembeddedStandardFonts(raw,1,{fnArray:Array(100001).fill(OPS.setFont),argsArray:Array(100001).fill(['same',11])})).toBe(false);
 const list={fnArray:[] as number[],argsArray:[] as any[][]},parts=[];for(let i=0;i<33;i++){a.fonts.set(PDFName.of('N'+i),a.pdf.context.register(a.pdf.context.obj({Type:'Font',Subtype:'Type1',BaseFont:'Helvetica'})));parts.push(`/N${i} 11 Tf (A) Tj`);list.fnArray.push(OPS.setFont);list.argsArray.push(['n'+i,11]);}a.content('BT '+parts.join(' ')+' ET');expect(await usesOnlyNonembeddedStandardFonts(await a.bytes(),1,list)).toBe(false);
});
it('refuses unknown nonembedded decoder programs rather than qualifying bundled bytes',async()=>{
 const a=await authored('Arial'),raw=await a.bytes(),{getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs'),task=getDocument({...localPdfDecoderOptions(),data:new Uint8Array(raw),fontExtraProperties:true,verbosity:0});try{const page=await(await task.promise).getPage(1),list=await page.getOperatorList(),fontId=list.argsArray[list.fnArray.indexOf(OPS.setFont)][0],font=page.commonObjs.get(fontId) as {data?:Uint8Array};expect(font.data?.length).toBeGreaterThan(12);const assets:SourceFontAsset[]=[];await expect(captureSourceGlyphs(page,page.getViewport({scale:1}).transform,sha256Sync(raw),assets,raw,1)).rejects.toMatchObject({code:'PDF_SOURCE_PROOF',message:'A decoder-provided font program has no embedded original source owner.'});expect(assets).toEqual([]);}finally{await task.destroy();}
});
it.each(['cycle','dangling','depth','array','string'])('bounds raw signature %s before comparison',async mode=>{
 const a=await authored();let value:PDFObject;
 if(mode==='cycle'){const ref=a.pdf.context.nextRef();a.pdf.context.assign(ref,a.pdf.context.obj({Again:ref}));value=ref;}else if(mode==='dangling')value=PDFRef.of(999);else if(mode==='array')value=a.pdf.context.obj(Array(257).fill(1));else if(mode==='string')value=a.pdf.context.obj('x'.repeat(4097));else{value=a.pdf.context.obj(1);for(let i=0;i<10;i++)value=a.pdf.context.obj({Nested:value});}a.font.set(PDFName.of('Extra'),value);expect(await usesOnlyNonembeddedStandardFonts(await a.bytes(),1,ops())).toBe(false);
});

it.each(['restricted','missingToUnicode'])('refuses actual %s embedding renamed as known Times, without catalogue fallback',async mode=>{
 const program=new Uint8Array(await readFile(resolve('public/fonts/DejaVuSans.ttf'))),v=new DataView(program.buffer);if(mode==='restricted')for(let i=0;i<v.getUint16(4);i++){const p=12+i*16;if(new TextDecoder().decode(program.subarray(p,p+4))==='OS/2')v.setUint16(v.getUint32(p+8)+8,4);}
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);const embedded=await pdf.embedFont(program,{subset:false}),p=pdf.addPage([500,700]);p.drawText('abc',{font:embedded,size:12,x:40,y:648});await pdf.flush();const top=pdf.context.lookup(embedded.ref,PDFDict),desc=top.lookup(PDFName.of('DescendantFonts'),PDFArray).lookup(0,PDFDict);top.set(PDFName.of('BaseFont'),PDFName.of('Times-Roman'));desc.set(PDFName.of('BaseFont'),PDFName.of('Times-Roman'));desc.lookup(PDFName.of('FontDescriptor'),PDFDict).set(PDFName.of('FontName'),PDFName.of('Times-Roman'));if(mode==='missingToUnicode')top.delete(PDFName.of('ToUnicode'));const raw=new Uint8Array(await pdf.save()),{getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs'),task=getDocument({...localPdfDecoderOptions(),data:new Uint8Array(raw),fontExtraProperties:true,verbosity:0});try{const page=await(await task.promise).getPage(1),list=await page.getOperatorList(),id=list.argsArray[list.fnArray.indexOf(OPS.setFont)][0];expect(knownPdfFont(page,id)?.family).toBe('times');expect(await usesOnlyNonembeddedStandardFonts(raw,1,list)).toBe(false);const assets:SourceFontAsset[]=[];await expect(captureSourceGlyphs(page,page.getViewport({scale:1}).transform,sha256Sync(raw),assets,raw,1)).rejects.toMatchObject({code:mode==='restricted'?'SOURCE_FONT_PERMISSIONS':'PDF_ORIGINAL_TT_PROOF'});expect(assets).toEqual([]);}finally{await task.destroy();}
});
