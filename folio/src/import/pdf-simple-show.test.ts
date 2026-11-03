import {it,expect} from 'vitest';
import {originalOperators} from './pdf-image-trace';
import {simpleShowParts} from './pdf-simple-show';
const parse=(s:string)=>simpleShowParts(originalOperators(s,undefined,true,true)[0]);
it('owns literal/hex bytes, empty strings and decimal TJ spellings',()=>expect(parse('[(A\\050B\\051) -003.250 <43> +.125 () 0] TJ')).toEqual([{codes:[65,40,66,41]},{adjustment:-3.25,lexeme:'-003.250'},{codes:[67]},{adjustment:.125,lexeme:'+.125'},{codes:[]},{adjustment:0,lexeme:'0'}]));
it('owns an escaped literal Tj',()=>expect(parse('(A\\101\\nB) Tj')).toEqual([{codes:[65,65,10,66]}]));
it.each(['[[<41>]] TJ','[/Name] TJ','[<< /X 1 >>] TJ','[true] TJ','[1e2] TJ','[1000001] TJ','<41> TJ','[<41>] Tj'])('rejects unowned structure %s',s=>expect(()=>parse(s)).toThrow());
it('does not collapse or reorder zero adjustments',()=>expect(parse('[<41> 0 -0 +0 <42>] TJ')).toHaveLength(5));
it('enforces source byte budgets',()=>expect(()=>parse('<'+'41'.repeat(100001)+'> Tj')).toThrow());
