import {originalOperators,type RawOperator} from './pdf-image-trace';
import {originalStringBytes,decodedPdfDecimal} from './pdf-atomic-paint';
import {FolioError} from '../core/errors';
export type SimpleShowPart={codes:number[]}|{adjustment:number;lexeme:string};
const fail=():never=>{throw new FolioError('PDF_SIMPLE_SHOW','The complete original byte-selector show cannot be proved.');};
/** Retain each string boundary and each original decimal spelling in a flat TJ. */
export function simpleShowParts(op:RawOperator):SimpleShowPart[]{
 if(op.args.length!==1)return fail();const raw=op.args[0];if(typeof raw!=='object')return fail();
 if(op.word==='Tj'&&'rawString'in raw&&raw.rawString){const codes=originalStringBytes(raw.rawString);if(codes.length>100000)return fail();return [{codes}];}
 if(op.word!=='TJ'||!('rawArray'in raw)||!raw.rawArray||raw.rawArray.length>4*1024*1024)return fail();
 const array=raw.rawArray;if(array[0]!=='['||array.at(-1)!==']')return fail();
 const parsed=originalOperators(array.slice(1,-1)+' FolioParts',undefined,true,true);if(parsed.length!==1||parsed[0].word!=='FolioParts'||parsed[0].args.length>100000)return fail();let bytes=0;
 return parsed[0].args.map((part,index)=>{if(typeof part==='number'){const lexeme=parsed[0].numberLexemes?.[index];if(!lexeme||!Number.isFinite(part)||Math.abs(part)>1e6)return fail();return {adjustment:decodedPdfDecimal(lexeme),lexeme};}if(!('rawString'in part)||!part.rawString)return fail();const codes=originalStringBytes(part.rawString);if((bytes+=codes.length)>100000)return fail();return {codes};});
}
