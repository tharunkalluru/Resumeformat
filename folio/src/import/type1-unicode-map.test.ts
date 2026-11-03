import {describe,expect,it} from 'vitest';
import {parseType1UnicodeMap} from './type1-unicode-map';

const cmap=(body:string)=>`/CIDInit /ProcSet findresource begin 12 dict begin begincmap
/CIDSystemInfo << /Registry (Example) /Ordering (Builtin) /Supplement 0 >> def
/CMapName /Example-Builtin def /CMapType 2 def
1 begincodespacerange <00> <FF> endcodespacerange
${body}
endcmap CMapName currentdict /CMap defineresource pop end end`;
describe('bounded original Type1 Unicode maps',()=>{
  it('reads single-byte ranges and explicit Unicode sequences without evaluating PostScript',()=>{
    const map=parseType1UnicodeMap(cmap('1 beginbfrange <41> <43> <0041> endbfrange 2 beginbfchar <0B> <00660066> <80> <D83DDE00> endbfchar'))!;
    expect([...map]).toEqual([[65,'A'],[66,'B'],[67,'C'],[11,'ff'],[128,'😀']]);
  });
  it('refuses ambiguous selectors, invalid UTF16, mismatched counts and range overflow',()=>{
    for(const body of ['2 beginbfchar <41> <0041> <41> <0042> endbfchar','1 beginbfrange <41> <43> <FFFF> endbfrange','1 beginbfchar <41> <D800> endbfchar','1 beginbfchar <41> <DC00> endbfchar','2 beginbfchar <41> <0041> endbfchar','1 beginbfrange <43> <41> <0041> endbfrange'])expect(parseType1UnicodeMap(cmap(body))).toBeUndefined();
  });
  it('keeps external CMaps, multibyte codes, executable additions and unsupported ranges read-only',()=>{
    for(const body of ['/Other usecmap','1 beginbfchar <0041> <0041> endbfchar','1 beginbfrange <41> <42> [<0041> <0042>] endbfrange','1 beginbfchar <41> <0041> endbfchar (data) run'])expect(parseType1UnicodeMap(cmap(body))).toBeUndefined();
    expect(parseType1UnicodeMap(cmap('1 beginbfchar <41> <0041> endbfchar').replace('<00> <FF>','<0000> <FFFF>'))).toBeUndefined();
  });
});
