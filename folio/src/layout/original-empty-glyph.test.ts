import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {parseSourceProgram,parseOriginalSourceProgram,originalEmptyGlyphAdvance} from './source-fonts';
const table=(b:Uint8Array,tag:string)=>{const v=new DataView(b.buffer);for(let i=0;i<v.getUint16(4);i++){const n=12+16*i;if(String.fromCharCode(...b.slice(n,n+4))===tag)return {offset:v.getUint32(n+8),length:v.getUint32(n+12)};}throw Error(tag);};
it('derives only a zero-length original glyph advance from bounded loca/hmtx without mutating the font',async()=>{
 const bytes=new Uint8Array(await readFile('public/fonts/DejaVuSans.ttf')),before=new Uint8Array(bytes),font=parseSourceProgram(bytes),blank=font.glyphForCodePoint(32),a=font.glyphForCodePoint(65);
 expect(originalEmptyGlyphAdvance(bytes,blank.id,font.numGlyphs)).toBe(blank.advanceWidth);expect(originalEmptyGlyphAdvance(bytes,a.id,font.numGlyphs)).toBeUndefined();const original=parseOriginalSourceProgram(bytes);expect(original.getGlyph(blank.id).path.toSVG()).toBe('');expect(original.getGlyph(blank.id).advanceWidth).toBe(blank.advanceWidth);expect(original.getGlyph(a.id).path.toSVG()).toBe(a.path.toSVG());expect(bytes).toEqual(before);
 for(const mode of ['hmtx-count','negative-range','beyond-glyf'] as const){const bad=new Uint8Array(bytes),v=new DataView(bad.buffer);if(mode==='hmtx-count')v.setUint16(table(bad,'hhea').offset+34,0);else{const loca=table(bad,'loca'),glyf=table(bad,'glyf'),format=v.getInt16(table(bad,'head').offset+50);expect(format).toBe(1);const at=loca.offset+blank.id*4,start=v.getUint32(at);if(mode==='negative-range'){v.setUint32(at,start+2);v.setUint32(at+4,start);}else v.setUint32(at+4,glyf.length+4);}expect(()=>originalEmptyGlyphAdvance(bad,blank.id,font.numGlyphs)).toThrow();}
});
