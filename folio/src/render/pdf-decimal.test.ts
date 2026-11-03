import {describe,it,expect} from 'vitest';
import {pdfDecimal} from './pdf-decimal';
import {originalOperators} from '../import/pdf-image-trace';
describe('exact bounded decimal operands',()=>{
 it.each([0,-0,1,-1,.24,45,1e-7,-1e-7,5e-324,1.2345678901234567e-20,999999.9999999999,1e6])('independently parses the same finite Number %s',value=>{const text=pdfDecimal(value);expect(text).not.toMatch(/[eE]/);const op=originalOperators(`${text} 0 Td`)[0];expect(op.args[0]).toBe(value===0?0:value);expect(Number(text)).toBe(value===0?0:value);});
 it.each([NaN,Infinity,-Infinity,1000001,-1000001])('refuses %s',v=>expect(()=>pdfDecimal(v)).toThrow());
});
