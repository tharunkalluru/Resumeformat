import {PDFArray,PDFDict,PDFName,PDFNumber,PDFRawStream} from 'pdf-lib';
import {canonicalJson,sha256Sync} from '../core/model';
import {FolioError} from '../core/errors';
import {decodeBoundedContentStream} from './bounded-content-stream';
import {originalOperators} from './pdf-image-trace';
import {originalPdfByteString,parseOriginalInlineImage} from './pdf-original-inline-image';
const key=PDFName.of;
const fail=():never=>{throw new FolioError('PDF_TYPE3_BITMAP','This Type 3 font has no bounded original bitmap-glyph proof.');};
const closed=(d:PDFDict,keys:string[])=>{if(d.keys().some(k=>!keys.includes(k.decodeText())))fail();};
const number=(d:PDFDict,k:string)=>{const n=d.lookup(key(k));if(!(n instanceof PDFNumber)||!Number.isFinite(n.asNumber())||Math.abs(n.asNumber())>4096)return fail();return n.asNumber();};
const array=(d:PDFDict,k:string,n:number)=>{const a=d.lookup(key(k));if(!(a instanceof PDFArray)||a.size()!==n)return fail();return a.asArray().map(v=>{const x=d.context.lookup(v);if(!(x instanceof PDFNumber)||!Number.isFinite(x.asNumber())||Math.abs(x.asNumber())>4096)return fail();return x.asNumber();});};
/** A closed, immutable font graph. Byte payload boundaries come from mask row
 * lengths, never an EI search. The original stream and inherited paint survive. */
export function captureType3BitmapFont(font:PDFDict):{sha256:string;glyphs:number;decodedBytes:number;compressedBytes:number;pixels:number;codes:readonly number[]}{
 closed(font,['Type','Subtype','Name','FontMatrix','FontBBox','Resources','FirstChar','LastChar','Widths','Encoding','CharProcs']);
 if(font.lookupMaybe(key('Type'),PDFName)?.decodeText()!=='Font'||font.lookupMaybe(key('Subtype'),PDFName)?.decodeText()!=='Type3')return fail();
 const name=font.lookupMaybe(key('Name'),PDFName)?.decodeText();if(name!==undefined&&name.length>128)return fail();
 const matrix=array(font,'FontMatrix',6),bbox=array(font,'FontBBox',4),first=number(font,'FirstChar'),last=number(font,'LastChar');
 if(!(matrix[0]>0&&matrix[0]<=1&&matrix[3]>0&&matrix[3]<=1)||matrix.some((v,i)=>![0,3].includes(i)&&v!==0)||bbox[0]>=bbox[2]||bbox[1]>=bbox[3]||!Number.isInteger(first)||!Number.isInteger(last)||first<0||last>255||first>last)return fail();
 const widths=array(font,'Widths',last-first+1);if(widths.some(n=>n<0))return fail();
 const resources=font.lookupMaybe(key('Resources'),PDFDict);let procSet:string[]|undefined;
 if(resources){closed(resources,['ProcSet']);const p=resources.lookupMaybe(key('ProcSet'),PDFArray);if(p){if(p.size()>2)return fail();procSet=p.asArray().map(v=>{const n=font.context.lookup(v);if(!(n instanceof PDFName)||!['PDF','ImageB'].includes(n.decodeText()))return fail();return n.decodeText();});if(new Set(procSet).size!==procSet.length)return fail();}}
 const encoding=font.lookup(key('Encoding')),procs=font.lookup(key('CharProcs'));if(!(encoding instanceof PDFDict)||!(procs instanceof PDFDict)||!procs.keys().length||procs.keys().length>256)return fail();
 closed(encoding,['Type','Differences']);if(encoding.has(key('Type'))&&encoding.lookupMaybe(key('Type'),PDFName)?.decodeText()!=='Encoding')return fail();
 const differences=encoding.lookupMaybe(key('Differences'),PDFArray);if(!differences||differences.size()>512)return fail();
 const mapping=new Map<number,string>();let code=-1;
 for(const v of differences.asArray()){const x=font.context.lookup(v);if(x instanceof PDFNumber){code=x.asNumber();if(!Number.isInteger(code)||code<0||code>255)return fail();}else if(x instanceof PDFName){const n=x.decodeText();if(code<0||code>255||mapping.has(code)||n.length>128)return fail();mapping.set(code++,n);}else return fail();}
 const used=new Set<string>(),codes:number[]=[];
 for(let c=first;c<=last;c++){const n=mapping.get(c);if(n&&n!=='.notdef'){if(!procs.has(key(n))||widths[c-first]<=0)return fail();used.add(n);codes.push(c);}else if(widths[c-first]!==0)return fail();}
 if([...mapping].some(([c,n])=>n!=='.notdef'&&(c<first||c>last))||used.size!==procs.keys().length)return fail();
 let decodedBytes=0,compressedBytes=0,pixels=0;const glyphs:unknown[]=[];
 for(const [n,ref]of procs.entries()){
  if(!used.has(n.decodeText()))return fail();const stream=font.context.lookup(ref);if(!(stream instanceof PDFRawStream))return fail();closed(stream.dict,['Length','Filter']);
  const filter=stream.dict.lookupMaybe(key('Filter'),PDFName)?.decodeText();if(filter!==undefined&&filter!=='FlateDecode'||stream.contents.length>1024*1024)return fail();
  compressedBytes+=stream.contents.length;if(compressedBytes>1024*1024)return fail();
  const bytes=decodeBoundedContentStream(stream,1024*1024);decodedBytes+=bytes.length;if(decodedBytes>1024*1024)return fail();
  const text=originalPdfByteString(bytes),bi=text.indexOf('BI');if(bi<0||bi>4096||text.slice(0,bi).includes('%'))return fail();
  const prefix=originalOperators(text.slice(0,bi)),[metric,save,transform]=prefix;
  if(prefix.length!==3||metric.word!=='d1'||metric.args.length!==6||metric.args.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>4096)||save.word!=='q'||save.args.length||transform.word!=='cm'||transform.args.length!==6||transform.args.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>4096))return fail();
  const d=metric.args as number[],m=transform.args as number[];
  if(d[0]<=0||d[1]!==0||d[2]>=d[4]||d[3]>=d[5]||d[2]<bbox[0]||d[3]<bbox[1]||d[4]>bbox[2]||d[5]>bbox[3]||m[0]<=0||m[3]<=0||m[1]!==0||m[2]!==0||m[4]<d[2]||m[5]<d[3]||m[4]+m[0]>d[4]||m[5]+m[3]>d[5])return fail();
  if([...mapping].some(([c,name])=>name===n.decodeText()&&widths[c-first]!==d[0]))return fail();
  const image=parseOriginalInlineImage(text,bi+2,{remainingPixels:1_000_000-pixels,remainingEncodedBytes:1024*1024,remainingDecodedBytes:1024*1024});pixels+=image.pixelCount;
  if(!image.imageMask||image.bitsPerComponent!==1||image.filter!==null||image.interpolate||image.dictionary.some(p=>!['Width','Height','ImageMask','BitsPerComponent','Decode','Interpolate'].includes(p.canonicalKey))||image.decode&&!(image.decode.length===2&&((image.decode[0]===0&&image.decode[1]===1)||(image.decode[0]===1&&image.decode[1]===0))))return fail();
  const suffix=originalOperators(text.slice(image.endIndex));if(suffix.length!==1||suffix[0].word!=='Q'||suffix[0].args.length)return fail();
  glyphs.push({name:n.decodeText(),sha256:sha256Sync(bytes)});
 }
 return {sha256:sha256Sync(new TextEncoder().encode(canonicalJson({name,matrix,bbox,first,last,widths,procSet,mapping:[...mapping],glyphs}))),glyphs:glyphs.length,decodedBytes,compressedBytes,pixels,codes};
}
