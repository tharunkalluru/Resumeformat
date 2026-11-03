import {describe,expect,it,vi} from 'vitest';
import {originalOperators,type RawMarkedProperties} from './pdf-image-trace';

describe('optional harmless marked dictionary classification seam',()=>{
 it('captures exact independent operator byte spans only when requested, including repeated text and comments',()=>{const text='% lead\n[(A)]TJ % between\n [(A)] TJ\nET',ops=originalOperators(text,undefined,true,false,true);expect(ops.map(o=>text.slice(o.sourceSpan!.start,o.sourceSpan!.end))).toEqual(['[(A)]TJ','[(A)] TJ','ET']);expect(originalOperators(text,undefined,true).every(o=>o.sourceSpan===undefined)).toBe(true);const first=ops[0].sourceSpan!,edited=text.slice(0,first.start)+'[<42>] TJ'+text.slice(first.end);expect(edited).toContain('% between\n [(A)] TJ');});
 it('captures exact numeric lexemes only on request, with operand indices and reset per operator',()=>{
  const text='/F1 10 Tf 39.6 172.20000000000005 Td <4142> Tj';
  expect(originalOperators(text)[0].numberLexemes).toBeUndefined();
  expect(originalOperators(text,undefined,true,true).map(o=>o.numberLexemes)).toEqual([[undefined,'10'],['39.6','172.20000000000005'],[undefined]]);
 });
 it('marks only a lexically empty PDF array, including exact PDF whitespace and comments',()=>{
  for(const text of ['[] 0 d','[ \t\r\n\x00\f ] 0 d','[% ignored brackets [ ] << >>\n] 0 d'])expect(originalOperators(text)[0].args).toEqual([{opaque:true,emptyArray:true},0]);
  for(const text of ['[0] 0 d','[[]] 0 d','[()] 0 d','[<>] 0 d','<<>> 0 d','([]) 0 d','<[ ]> 0 d']){
   if(text.startsWith('<['))expect(()=>originalOperators(text)).toThrow();else expect(originalOperators(text)[0].args).toEqual([{opaque:true},0]);
  }
 });
 it('preserves the default opaque dictionary and strict MCID behavior',()=>{
  expect(originalOperators('/Span << /MCID 3 >> BDC EMC')[0].args[1]).toEqual({opaque:true,mcid:3});
  expect(originalOperators('/Span << /MCID 3 /Lang (en-US) >> BDC EMC')[0].args[1]).toEqual({opaque:true});
  expect(originalOperators('/Span << /ActualText <FEFF200B> >> BDC EMC')[0].args[1]).toEqual({opaque:true});
 });
 it('calls the classifier only for an entire dictionary and preserves rejected metadata as opaque',()=>{
  const properties:RawMarkedProperties={kind:'structured',mcid:3,language:'en-US'},classify=vi.fn((raw:string)=>raw.includes('/Lang')?properties:undefined),ops=originalOperators('/Span << /MCID 3 /Lang (en-US) >> BDC (<< /MCID 9 >>) Tj [<0061> 4] TJ /Span << /ActualText <FEFF200B> >> BDC',classify);
  expect(classify.mock.calls).toEqual([['<< /MCID 3 /Lang (en-US) >>'],['<< /ActualText <FEFF200B> >>']]);
  expect(ops[0].args[1]).toEqual({opaque:true,markedProperties:properties});expect(ops[3].args[1]).toEqual({opaque:true});
 });
 it('propagates strict classification refusal without manufacturing an admitted dictionary',()=>{
  expect(()=>originalOperators('/Span << /ActualText <FEFF200B> >> BDC',()=>{throw Error('alternate text remains unsupported');})).toThrow('alternate text remains unsupported');
 });
});
