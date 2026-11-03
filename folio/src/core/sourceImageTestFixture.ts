import {PDFArray,PDFDict,PDFDocument,PDFName,PDFNumber} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import UPNG from '@pdf-lib/upng';
import {rewriteTrueTypeUnicodeCmap} from '../ui/sourceFonts';
import {restoreOriginalTrueTypePermissions} from '../layout/source-fonts';

/** Fictional owned unencoded positive blank and image alpha; no real source bytes. */
export async function fictionalImageBlankSource(program:Uint8Array,options:{images?:number;overhang?:number;blankWidth?:number;clipText?:boolean;rootReflection?:boolean;marked?:boolean;rawBlanks?:number;sourceScale?:number;standaloneBlank?:boolean;background?:boolean;unusedLookalike?:boolean}={}):Promise<Uint8Array>{
 const original=fontkit.create(program),blank=original.glyphForCodePoint(32).id,mappings=new Map(original.characterSet.filter(cp=>original.glyphForCodePoint(cp).id!==blank).map(cp=>[cp,original.glyphForCodePoint(cp).id]));
 let bytes=rewriteTrueTypeUnicodeCmap(program,mappings);
 if(options.blankWidth!==undefined){const view=new DataView(bytes.buffer);for(let i=0;i<view.getUint16(4);i++){const at=12+i*16;if(String.fromCharCode(...bytes.slice(at,at+4))==='hmtx')view.setUint16(view.getUint32(at+8)+blank*4,options.blankWidth);}bytes=restoreOriginalTrueTypePermissions(bytes,bytes);}
 const face=fontkit.create(bytes),a=face.glyphForCodePoint(97).id,b=face.glyphForCodePoint(98).id,pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);const font=await pdf.embedFont(bytes,{subset:false}),page=pdf.addPage([500,700]);page.drawText('ab',{font,size:12,x:40,y:648});
 const rgba=new Uint8Array([255,0,0,255,0,255,0,127,0,0,255,0,20,30,40,255]),png=new Uint8Array(UPNG.encode([rgba.buffer],2,2,0)),image=await pdf.embedPng(png);page.node.Resources()!.lookupMaybe(PDFName.of('XObject'),PDFDict)?.set(PDFName.of('OwnedImage'),image.ref);
 if(!page.node.Resources()!.has(PDFName.of('XObject'))){const objects=pdf.context.obj({});objects.set(PDFName.of('OwnedImage'),image.ref);page.node.Resources()!.set(PDFName.of('XObject'),objects);}
 if(options.unusedLookalike){const unused=await pdf.embedPng(png);page.node.Resources()!.lookup(PDFName.of('XObject'),PDFDict).set(PDFName.of('UnusedImage'),unused.ref);}
 await pdf.flush();const dict=pdf.context.lookup(font.ref,PDFDict),desc=dict.lookup(PDFName.of('DescendantFonts'),PDFArray).lookup(0,PDFDict),hex=(gid:number)=>gid.toString(16).padStart(4,'0');
 const cmap=`/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Fictional) /Ordering (Identity) /Supplement 0 >> def /CMapName /Fictional def /CMapType 2 def 1 begincodespacerange <0000> <ffff> endcodespacerange 3 beginbfchar <${hex(blank)}> <0020> <${hex(a)}> <0061> <${hex(b)}> <0062> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`;
 dict.set(PDFName.of('ToUnicode'),pdf.context.register(pdf.context.flateStream(new TextEncoder().encode(cmap))));desc.set(PDFName.of('W'),pdf.context.obj([blank,[face.getGlyph(blank).advanceWidth*1000/face.unitsPerEm],a,[face.getGlyph(a).advanceWidth*1000/face.unitsPerEm],b,[face.getGlyph(b).advanceWidth*1000/face.unitsPerEm]]));
 const resource=page.node.Resources()!.lookup(PDFName.of('Font'),PDFDict).entries()[0][0].toString(),reflected=!!options.rootReflection,text=`BT ${resource} 12 Tf 1 0 0 ${reflected?-1:1} 40 ${reflected?52:648} Tm <${hex(a)}${hex(blank).repeat(options.rawBlanks??1)}${hex(b)}> Tj ET`,count=options.images??1,overhang=options.overhang??0;
 let content=(reflected?'1 0 0 -1 0 700 cm\n':'')+`q ${options.sourceScale?`${options.sourceScale} 0 0 ${options.sourceScale} 0 0 cm\n`:''}`;
 if(options.background)content+=`q .3 .4 .6 rg 30 ${reflected?120:550} 80 30 re f Q\n`;
 if(options.standaloneBlank)content+=`BT ${resource} 12 Tf 1 0 0 ${reflected?-1:1} 25 ${reflected?20:680} Tm <${hex(blank)}> Tj ET\n`;
 content+=`${options.marked?'/P <</MCID 0>> BDC\n':''}q ${text} Q\n${options.marked?'EMC\n':''}`;
 for(let i=0;i<count;i++){const y=reflected?132+i*20:560-i*20;content+=`q 1 0 0 1 5 3 cm 35 ${y-3} 30 8 re W* n q 30 0 0 ${reflected?-8:8} ${35+overhang} ${y-3+(reflected?8:0)} cm ${options.marked?`0 0 0 RG 0 0 0 rg /Figure <</MCID ${i+1}>> BDC `:''}/OwnedImage Do ${options.marked?'EMC ':''}Q ${options.clipText?text:''} Q\n`;}
 content+=`q BT ${resource} 12 Tf 1 0 0 ${reflected?-1:1} 40 ${reflected?220:480} Tm <${hex(a)}${hex(b)}> Tj ET Q\nQ`;
 page.node.set(PDFName.of('Contents'),pdf.context.register(pdf.context.flateStream(new TextEncoder().encode(content))));return new Uint8Array(await pdf.save());
}
