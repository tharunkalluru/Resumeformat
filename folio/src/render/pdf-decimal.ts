import {FolioError} from '../core/errors';
/** Exact Number round-trip in PDF decimal syntax, never exponent or truncation. */
export function pdfDecimal(value:number):string {
 if(!Number.isFinite(value)||Math.abs(value)>1_000_000)throw new FolioError('PDF_TEXT_DECOMPOSITION','The text operand exceeds the finite source bounds.');
 if(value===0)return '0';const raw=String(value);let result=raw;
 if(/[eE]/.test(raw)){const negative=raw.startsWith('-'),unsigned=negative?raw.slice(1):raw,[mantissa,exponent]=unsigned.split(/[eE]/),parts=mantissa.split('.'),digits=parts.join(''),position=parts[0].length+Number(exponent);result=(negative?'-':'')+(position<=0?'0.'+'0'.repeat(-position)+digits:position>=digits.length?digits+'0'.repeat(position-digits.length):digits.slice(0,position)+'.'+digits.slice(position));}
 if(result.length>350||!/^[-]?(?:\d+)(?:\.\d+)?$/.test(result)||Number(result)!==value)throw new FolioError('PDF_TEXT_DECOMPOSITION','The text operand has no exact bounded decimal encoding.');return result;
}
