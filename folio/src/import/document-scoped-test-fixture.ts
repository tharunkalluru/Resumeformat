// Wholly authored licensed DejaVu fixture; never uses user program bytes.
import {readFile} from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import {PDFDocument,PDFName} from 'pdf-lib';
import {macRomanEncodingEntry,originalMacRomanSelectors} from './pdf-macroman';
interface Table {tag:string;offset:number;length:number}
function tables(bytes:Uint8Array):Table[]{const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);return Array.from({length:v.getUint16(4)},(_,i)=>{const p=12+i*16;return{tag:String.fromCharCode(...bytes.subarray(p,p+4)),offset:v.getUint32(p+8),length:v.getUint32(p+12)};});}
function sum(bytes:Uint8Array){let total=0;for(let p=0;p<bytes.length;p+=4){let n=0;for(let i=0;i<4;i++)n=(n<<8)|(bytes[p+i]??0);total=(total+(n>>>0))>>>0;}return total;}
function replaceCmap(bytes:Uint8Array,cmap:Uint8Array,absent=false,missingPost=false):Uint8Array {
 const entries=tables(bytes).filter(t=>(!absent||t.tag!=='OS/2')&&(!missingPost||t.tag!=='post')).map(t=>({tag:t.tag,data:t.tag==='cmap'?cmap:new Uint8Array(bytes.subarray(t.offset,t.offset+t.length))}));
 const head=entries.find(e=>e.tag==='head')!;new DataView(head.data.buffer).setUint32(8,0);
 const size=12+entries.length*16+entries.reduce((n,e)=>n+Math.ceil(e.data.length/4)*4,0),out=new Uint8Array(size),v=new DataView(out.buffer);out.set(bytes.subarray(0,12));v.setUint16(4,entries.length);const power=2**Math.floor(Math.log2(entries.length));v.setUint16(6,power*16);v.setUint16(8,Math.log2(power));v.setUint16(10,entries.length*16-power*16);let offset=12+entries.length*16;
 for(let i=0;i<entries.length;i++){const e=entries[i],p=12+i*16;out.set(new TextEncoder().encode(e.tag),p);v.setUint32(p+4,sum(e.data));v.setUint32(p+8,offset);v.setUint32(p+12,e.data.length);out.set(e.data,offset);offset+=Math.ceil(e.data.length/4)*4;}
 const h=tables(out).find(t=>t.tag==='head')!;v.setUint32(h.offset+8,(0xb1b0afba-sum(out))>>>0);return out;
}
function cmap6(original:ReturnType<typeof fontkit.create>,first=0,count=256):Uint8Array {
 const out=new Uint8Array(22+count*2),v=new DataView(out.buffer);v.setUint16(2,1);v.setUint16(4,1);v.setUint32(8,12);v.setUint16(12,6);v.setUint16(14,10+count*2);v.setUint16(18,first);v.setUint16(20,count);
 for(let i=0;i<count;i++){const code=first+i,e=macRomanEncodingEntry(code);v.setUint16(22+i*2,e?original.glyphForCodePoint(e.encodingUnicode).id:0);}
 return out;
}

export async function authoredMacRomanSource({absent=true,codes=[65,32,219,202,66],spaceInk=false,semantic,link,secondLine=false}:{secondLine?:boolean;link?:string;absent?:boolean;codes?:number[];spaceInk?:boolean;semantic?:string}={}) {
 const licensed=new Uint8Array(await readFile('public/fonts/DejaVuSans.ttf')),original=fontkit.create(licensed),cmap=cmap6(original);
 // Competing202 entry proves PDF encoding name back-index, not direct byte cmap.
 new DataView(cmap.buffer).setUint16(22+202*2,original.glyphForCodePoint(65).id);
 if(spaceInk)new DataView(cmap.buffer).setUint16(22+32*2,original.glyphForCodePoint(65).id);
 const program=replaceCmap(licensed,cmap,absent),selectors=originalMacRomanSelectors(program,32,original.numGlyphs),pdf=await PDFDocument.create(),c=pdf.context;
 const descriptor=c.register(c.obj({Type:'FontDescriptor',FontName:'AuthoredDocumentMacRoman',Flags:32,FontBBox:[-1100,-500,2100,1200],ItalicAngle:0,Ascent:900,Descent:-300,CapHeight:750,StemV:80,FontFile2:c.register(c.flateStream(program,{Length1:program.length}))}));
 const widths=Array.from({length:256},(_,code)=>{const m=selectors.get(code);return m?original.getGlyph(m.glyphId).advanceWidth*1000/original.unitsPerEm:0;});
 const toUnicode=semantic?c.register(c.flateStream(`/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Authored def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <41> <${semantic.codePointAt(0)!.toString(16).padStart(4,'0')}> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`)):undefined;
 const ref=c.register(c.obj({...(toUnicode?{ToUnicode:toUnicode}:{}),Type:'Font',Subtype:'TrueType',BaseFont:'AuthoredDocumentMacRoman',Encoding:'MacRomanEncoding',FirstChar:0,LastChar:255,Widths:widths,FontDescriptor:descriptor})),page=pdf.addPage([500,700]);page.node.set(PDFName.of('Resources'),c.obj({Font:{F1:ref}}));
 page.node.set(PDFName.of('Contents'),c.register(c.flateStream(`q BT /F1 12 Tf 1 0 0 1 40 648 Tm <${codes.map(code=>code.toString(16).padStart(2,'0')).join('')}> Tj${secondLine?` 1 0 0 1 40 608 Tm <${codes.map(code=>code.toString(16).padStart(2,'0')).join('')}> Tj`:''} ET Q`)));
 if(link){const {PDFString}=await import('pdf-lib');page.node.addAnnot(c.register(c.obj({Type:'Annot',Subtype:'Link',Rect:[39,640,100,666],Border:[0,0,0],A:{S:'URI',URI:PDFString.of(link)}})));}
 return {bytes:new Uint8Array(await pdf.save()),program,selectors,ref:ref.toString(),codes};
}

/** Symbolic raw bytes are physical indices; authored ToUnicode owns unrelated semantic scalars. */
export async function authoredSymbolicSource({absent=true,spaceInk=false,missing=false,missingPost=false,codes=[65,33,66,202]}:{absent?:boolean;spaceInk?:boolean;missing?:boolean;missingPost?:boolean;codes?:number[]}={}) {
 const licensed=new Uint8Array(await readFile('public/fonts/DejaVuSans.ttf')),original=fontkit.create(licensed),cmap=cmap6(original),v=new DataView(cmap.buffer);
 v.setUint16(22+33*2,original.glyphForCodePoint(spaceInk?65:32).id);v.setUint16(22+65*2,missing?0:original.glyphForCodePoint(66).id);v.setUint16(22+202*2,original.glyphForCodePoint(65).id);
 const program=replaceCmap(licensed,cmap,absent,missingPost),pdf=await PDFDocument.create(),c=pdf.context,semantics=new Map([[65,'A'],[33,' '],[66,'B'],[202,'C']]);
 const descriptor=c.register(c.obj({Type:'FontDescriptor',FontName:'AuthoredSymbolic',Flags:4,FontBBox:[-1100,-500,2100,1200],ItalicAngle:0,Ascent:900,Descent:-300,CapHeight:750,StemV:80,FontFile2:c.register(c.flateStream(program,{Length1:program.length}))}));
 const widths=Array.from({length:256},(_,code)=>original.getGlyph(v.getUint16(22+code*2)).advanceWidth*1000/original.unitsPerEm);
 const mappings=codes.map(code=>`<${code.toString(16).padStart(2,'0')}> <${semantics.get(code)!.codePointAt(0)!.toString(16).padStart(4,'0')}>`).join('\n');
 const toUnicode=c.register(c.flateStream(`/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /AuthoredSymbolic def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange ${codes.length} beginbfchar ${mappings} endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`));
 const ref=c.register(c.obj({ToUnicode:toUnicode,Type:'Font',Subtype:'TrueType',BaseFont:'AuthoredSymbolic',FirstChar:0,LastChar:255,Widths:widths,FontDescriptor:descriptor})),page=pdf.addPage([500,700]);page.node.set(PDFName.of('Resources'),c.obj({Font:{F1:ref}}));
 page.node.set(PDFName.of('Contents'),c.register(c.flateStream(`q BT /F1 12 Tf 1 0 0 1 40 648 Tm <${codes.map(code=>code.toString(16).padStart(2,'0')).join('')}> Tj ET Q`)));
 return {bytes:new Uint8Array(await pdf.save()),program,ref:ref.toString(),codes,original};
}
