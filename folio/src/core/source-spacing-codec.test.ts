import {it,expect} from 'vitest';
import {packSpacingGlyphs,unpackSpacingGlyphs} from './source-spacing-codec';
const glyphs=[[1,'A',40.01234567890123,6.00123456789012,10],[2,'B',46.01358024679135,5.125,10],[1,'A',52.2,6.00123456789012,20]];
it('losslessly roundtrips exact float positions, repeated advances, Unicode and operators',()=>{expect(unpackSpacingGlyphs(packSpacingGlyphs(glyphs),{glyphs:0})).toEqual(glyphs);});
it.each(['tag','dictionary','unused','order','index','nan','budget'] as const)('rejects invalid column %s',kind=>{const p=packSpacingGlyphs(glyphs) as any[],budget={glyphs:0};if(kind==='tag')p[0]='other';else if(kind==='dictionary')p[1].push(p[1][0]);else if(kind==='unused')p[1].push('C');else if(kind==='order')p[3].reverse();else if(kind==='index')p[3][0][1][0][1]=100;else if(kind==='nan')p[3][0][1][0][2]=NaN;else budget.glyphs=99999;expect(()=>unpackSpacingGlyphs(p,budget)).toThrow();});
