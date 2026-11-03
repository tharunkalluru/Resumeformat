import {PDFDocument,PDFName,PDFDict} from 'pdf-lib';
import {originalOperators,originalPageContent} from './pdf-image-trace';
/** Source classifier only. Full font, paint, matrix and byte proof is mandatory later. */
export function hasQuarterTurnSimpleSource(document:PDFDocument):boolean {
 let rotated=false;
 for(let n=1;n<=document.getPageCount();n++){
  const fonts=document.getPages()[n-1].node.Resources()?.lookupMaybe(PDFName.of('Font'),PDFDict);if(!fonts)return false;
  const ops=originalOperators(originalPageContent(document,n,true),undefined,true,true),selected=new Set(ops.filter(o=>o.word==='Tf').map(o=>typeof o.args[0]==='object'&&'name'in o.args[0]?o.args[0].name:''));
  if(!selected.size)return false;
  for(const name of selected){const font=fonts.lookupMaybe(PDFName.of(name),PDFDict);if(font?.lookupMaybe(PDFName.of('Subtype'),PDFName)?.decodeText()!=='TrueType'||font.lookupMaybe(PDFName.of('Encoding'),PDFName)?.decodeText()!=='WinAnsiEncoding')return false;}
  for(const op of ops)if(op.word==='Tm'&&op.args.length===6&&op.args.every(v=>typeof v==='number'&&Number.isFinite(v))){const[a,b,c,d]=op.args as number[],scale=Math.hypot(a,b);if(scale>0&&Math.abs(a)<=scale*1e-6&&Math.abs(d)<=scale*1e-6&&b*c<0)rotated=true;}
 }
 return rotated;
}
