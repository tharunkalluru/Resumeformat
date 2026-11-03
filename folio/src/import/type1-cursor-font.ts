import {PDFArray,PDFDict,PDFHexString,PDFName,PDFNumber,PDFString,type PDFContext,type PDFObjectCopier,type PDFRef} from 'pdf-lib';
import {FolioError} from '../core/errors';
import {sha256Sync} from '../core/model';
import {originalOperators} from './pdf-image-trace';

const key=PDFName.of,encode=(s:string)=>new TextEncoder().encode(s);
const fail=():never=>{throw new FolioError('PDF_TYPE1_BASELINE','The original cursor advance has no bounded font proof.');};
const join=(parts:Uint8Array[])=>{const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){result.set(p,offset);offset+=p.length;}return result;};
const encrypt=(data:Uint8Array,seed:number)=>{let r=seed;return Uint8Array.from(data,v=>{const c=v^(r>>>8);r=((c+r)*52845+22719)&65535;return c;});};
const integer=(n:number):number[]=>n>=-107&&n<=107?[n+139]:n>=108&&n<=1131?[247+((n-108)>>8),(n-108)&255]:n<=-108&&n>=-1131?[251+((-n-108)>>8),(-n-108)&255]:[255,(n>>24)&255,(n>>16)&255,(n>>8)&255,n&255];

/** Re-encode source selectors as hex. They will refer only to blank glyphs whose
 * Unicode is SPACE, never to the source's old wording. Preserve each original
 * numeric TJ displacement rather than estimating a new cursor correction. */
export function type1AdvanceRecipe(word:string,arg:unknown):{program:string;codes:number[]}{
 if(!arg||typeof arg!=='object'||!('opaque'in arg))return fail();
 const value=arg as {rawString?:string;rawArray?:string};
 const segments=word==='Tj'&&value.rawString?[{rawString:value.rawString}]:word==='TJ'&&value.rawArray?originalOperators(value.rawArray.slice(1,-1)+' END',undefined,true)[0]?.args:undefined;
 if(!segments?.length||segments.length>4096)return fail();const codes=new Set<number>();let count=0;
 const parts=segments.map(s=>{
  if(typeof s==='number'){if(!Number.isFinite(s)||Math.abs(s)>100000)return fail();return String(s);}
  if(!s||typeof s!=='object'||!('rawString'in s)||typeof s.rawString!=='string')return fail();
  const raw=s.rawString,bytes=(raw.startsWith('(')?PDFString.of(raw.slice(1,-1)):PDFHexString.of(raw.slice(1,-1))).asBytes();
  if((count+=bytes.length)>2048)return fail();for(const code of bytes)codes.add(code);
  return '<'+Array.from(bytes,c=>c.toString(16).padStart(2,'0')).join('')+'>';
 });
 if(!codes.size)return fail();return {program:'['+parts.join(' ')+'] TJ',codes:[...codes].sort((a,b)=>a-b)};
}

/** The helper has the same Type1 subtype and unchanged PDF Widths as the source.
 * Each consumer therefore uses its own original width precision. Its charstrings
 * contain only hsbw/endchar, its Unicode is whitespace, and it paints no outline.
 * Visible edited text always uses the untouched original font. */
export function createType1CursorFont(context:PDFContext,copier:PDFObjectCopier,source:PDFDict,codes:number[]):PDFRef{
 const first=source.lookup(key('FirstChar'),PDFNumber).asNumber(),last=source.lookup(key('LastChar'),PDFNumber).asNumber(),widths=source.lookup(key('Widths'),PDFArray);
 if(!Number.isInteger(first)||!Number.isInteger(last)||first<0||last>255||first>last||widths.size()!==last-first+1||!codes.length||codes.length>256||new Set(codes).size!==codes.length)return fail();
 const selected=codes.map(code=>{if(!Number.isInteger(code)||code<first||code>last)return fail();const width=widths.lookup(code-first,PDFNumber).asNumber();if(!Number.isFinite(width)||width<=0||width>10000)return fail();return {code,width};});
 const fontName='FolioAdvance'+sha256Sync(encode(JSON.stringify(selected))).slice(0,24),glyph=(code:number)=>'g'+code.toString(16);
 const header=encode('%!PS-AdobeFont-1.0: '+fontName+' 1.0\n11 dict begin\n/FontName /'+fontName+' def\n/PaintType 0 def\n/FontType 1 def\n/FontMatrix [0.001 0 0 0.001 0 0] readonly def\n/FontBBox [0 0 0 0] readonly def\n/Encoding 256 array\n0 1 255 {1 index exch /.notdef put} for\n'+selected.map(c=>'dup '+c.code+' /'+glyph(c.code)+' put').join('\n')+'\nreadonly def\ncurrentdict end\ncurrentfile eexec\n');
 const privateParts=[new Uint8Array(4),encode('dup /Private 8 dict dup begin\n/RD {string currentfile exch readstring pop} executeonly def\n/ND {noaccess def} executeonly def\n/NP {noaccess put} executeonly def\n/lenIV 4 def\n/BlueValues [] def\n/MinFeature {16 16} def\n/password 5839 def\n/Subrs 0 array def\nend readonly put\ndup /CharStrings '+(selected.length+1)+' dict dup begin\n')];
 for(const c of [{name:'.notdef',width:0},...selected.map(c=>({name:glyph(c.code),width:Math.round(c.width)}))]){const bytes=encrypt(join([new Uint8Array(4),Uint8Array.from([...integer(0),...integer(c.width),13,14])]),4330);privateParts.push(encode('/'+c.name+' '+bytes.length+' RD '),bytes,encode(' ND\n'));}
 privateParts.push(encode('end readonly put\ndup /FontName get exch definefont pop\nmark currentfile closefile\n'));
 const encrypted=encrypt(join(privateParts),55665),footer=encode('0'.repeat(512)+'\ncleartomark\n'),file=context.register(context.flateStream(join([header,encrypted,footer]),{Length1:header.length,Length2:encrypted.length,Length3:footer.length}));
 const cmap='/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Folio) /Ordering (AdvanceOnly) /Supplement 0 >> def /CMapName /Folio-Advance def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange '+codes.length+' beginbfchar '+codes.map(c=>'<'+c.toString(16).padStart(2,'0')+'> <0020>').join(' ')+' endbfchar endcmap CMapName currentdict /CMap defineresource pop end end';
 const descriptor=context.register(context.obj({Type:'FontDescriptor',FontName:fontName,Flags:4,FontBBox:[0,0,0,0],ItalicAngle:0,Ascent:1,Descent:0,CapHeight:1,StemV:0,FontFile:file}));
 return context.register(context.obj({Type:'Font',Subtype:'Type1',BaseFont:fontName,FontDescriptor:descriptor,FirstChar:first,LastChar:last,Widths:copier.copy(widths),ToUnicode:context.register(context.flateStream(cmap))}));
}
