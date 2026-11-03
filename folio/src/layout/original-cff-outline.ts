import fontkit from '@pdf-lib/fontkit';
import type {Font} from '@pdf-lib/fontkit';
import {validateOriginalCffBaseline} from '../import/pdf-original-cff';
import {FolioError} from '../core/errors';
/** Pinned fontkit's CFF table decoder reads the ORIGINAL charstrings/subrs. The
 * sfnt shell supplies no glyph outline and never becomes a source programme. */
export function originalCffOutlineReader(program:Uint8Array,derivative:Uint8Array):Font{
 const parsed=validateOriginalCffBaseline(program),font=fontkit.create(new Uint8Array(derivative)) as Font;
 type Stream={pos:number;buffer:{constructor:{from(input:Uint8Array):Uint8Array}}};type Internal={stream:Stream&{constructor:new(bytes:Uint8Array)=>Stream};'CFF ':{constructor:{decode(stream:Stream):unknown}}};
 const internal=font as unknown as Internal;
 try{const StreamClass=internal.stream.constructor,CffClass=internal['CFF '].constructor,sourceStream=new StreamClass(internal.stream.buffer.constructor.from(new Uint8Array(program))),original=CffClass.decode(sourceStream),reader=Object.create(font) as Font;Object.defineProperties(reader,{stream:{value:sourceStream},'CFF ':{value:original},numGlyphs:{value:parsed.glyphCount},unitsPerEm:{value:1000},_glyphs:{value:{}}});return reader;}catch{throw new FolioError('SOURCE_CFF_OUTLINE','The original CFF outline reader is unavailable.');}
}
