import {FolioError} from '../core/errors';
import {originalFormat6GlyphIds} from './pdf-macroman';
export type DocumentScopedSelectorContract='macroman-1-0-format6-v1'|'symbolic-raw-byte-1-0-format6-v1';
/** Sole Macintosh(1,0) format6 physical selectors. Unicode must come separately from source ToUnicode. */
export function originalSymbolicByteSelectors(bytes:Uint8Array,flags:number,numGlyphs:number):ReadonlyMap<number,{glyphId:number}> {
 if(!Number.isInteger(flags)||flags<0||flags>0x7fffffff||!(flags&4)||(flags&32))throw new FolioError('PDF_SYMBOLIC_SELECTOR','The original symbolic raw-byte physical selector is not proved.');
 return new Map([...originalFormat6GlyphIds(bytes,numGlyphs)].map(([code,glyphId])=>[code,{glyphId}]));
}
