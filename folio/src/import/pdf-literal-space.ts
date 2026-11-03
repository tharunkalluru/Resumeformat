import {PDFDocument} from 'pdf-lib';
import {MAX_SOURCE_PAGES} from '../core/model';
import {FolioError} from '../core/errors';
import {originalOperators,originalPageContent,type RawMarkedProperties,type RawOperator} from './pdf-image-trace';

const fail=():never=>{throw new FolioError('PDF_LITERAL_SPACE','The literal alternate space has no closed original standalone scope.');};
const whitespace='[\\x00\\x09\\x0a\\x0c\\x0d\\x20]*';
const literal=new RegExp('^<<'+whitespace+'/ActualText'+whitespace+'\\( \\)'+whitespace+'>>$');

/** This class is distinct from U+200B and never changes the physical advance.
 * Escaped strings, additional keys and other Unicode blanks stay unclassified. */
export function classifyLiteralSpaceActualText(raw:string):RawMarkedProperties|undefined{
 if(raw.length>4096||!literal.test(raw))return;
 return Object.freeze({kind:'space-actual-text' as const,actualText:' ' as const});
}

/** Select only an actual top-level Span BDC. Text, comments and containers that
 * merely contain the same spelling cannot choose the new renderer contract. */
export function hasLiteralSpaceActualTextSource(document:PDFDocument):boolean{
 const pages=document.getPages();if(pages.length>MAX_SOURCE_PAGES)return fail();let bytes=0,tokens=0,found=false;
 for(let pageNumber=1;pageNumber<=pages.length;pageNumber++){
  if(!pages[pageNumber-1].node.Contents())continue;
  const text=originalPageContent(document,pageNumber,true);bytes+=text.length;if(bytes>16*1024*1024)return fail();
  const operations=originalOperators(text,classifyLiteralSpaceActualText);
  for(const op of operations){tokens+=op.args.length+1;if(tokens>100000)return fail();if(op.word==='BDC'&&op.args.length===2&&typeof op.args[0]==='object'&&'name'in op.args[0]&&op.args[0].name==='Span'&&typeof op.args[1]==='object'&&'markedProperties'in op.args[1]&&op.args[1].markedProperties?.kind==='space-actual-text')found=true;}
 }
 return found;
}

/** The caller must separately join every raw/decoded show and prove exactly one
 * original physical glyph. This assertion grants no glyph or editing authority. */
export function assertStandaloneActualTextOperators(ops:readonly RawOperator[]):void{
 const words=['q','cm','BT','Tm','Tf','Tj','ET','Q'];if(ops.length!==words.length||ops.some((op,index)=>op.word!==words[index]))return fail();
 const numbers=(op:RawOperator,count:number)=>{if(op.args.length!==count||op.args.some(value=>typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1_000_000))return fail();};
 for(const index of [0,2,6,7])if(ops[index].args.length)return fail();numbers(ops[1],6);numbers(ops[3],6);
 const font=ops[4].args,size=font[1];if(font.length!==2||typeof font[0]!=='object'||!('name'in font[0])||!font[0].name||font[0].name.length>128||typeof size!=='number'||!Number.isFinite(size)||size<=0||size>1_000_000)return fail();
 const show=ops[5].args;if(show.length!==1||typeof show[0]!=='object'||!('opaque'in show[0])||!show[0].opaque||!show[0].rawString||show[0].rawArray)return fail();
}
