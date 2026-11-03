import {Util} from 'pdfjs-dist/legacy/build/pdf.mjs';
import type {TextItem} from 'pdfjs-dist/types/src/display/api';
import type {SourceFontAsset} from '../core/model';
import type {SourcePaintGlyph,AssociatedSourceItem} from './pdf-source';
import {FolioError} from '../core/errors';
/** Extractor separators are semantic only. Geometry stays with each complete
 * proved original show; the scoped compiler independently rederives its paint.
 * Mixed original document fonts may retain varying Tc in a separately proved group.
 */
export function associateNamelessSourceItems(items:readonly (TextItem|object)[],glyphs:readonly SourcePaintGlyph[],viewport:number[],assets:readonly SourceFontAsset[],mixedSpacing=true):AssociatedSourceItem[]{
 const fail=():never=>{throw new FolioError('PDF_SOURCE_PROOF','Nameless text requires complete original physical shows and matching independent page semantics.');};
 const fonts=new Map(assets.map(f=>[f.id,f]));
 if(!glyphs.length||glyphs.length>100000||items.length>10000||glyphs.some(g=>{const f=fonts.get(g.fontId);return f?.sourceVersion!==7||!(f.declaredStyle.post===null&&f.originalProgram.selectorContract==='symbolic-raw-byte-1-0-format6-v1'||f.declaredStyle.post!==null&&f.originalProgram.selectorContract==='macroman-1-0-format6-v1')||g.inferredGap||g.shapeOnly||g.shearX;}))return fail();
 const text=items.flatMap(v=>'str'in v?[v as TextItem]:[]);
 if(text.some(t=>t.dir!=='ltr')||text.map(t=>t.str).join('').replace(/\s+/gu,'')!==glyphs.map(g=>g.unicode).join('').replace(/\s+/gu,''))return fail();
 const mixed=assets.some(f=>f.sourceVersion===7&&f.namelessDescriptor)&&assets.some(f=>f.sourceVersion===7&&f.declaredStyle.post!==null);
 const groups:SourcePaintGlyph[][]=[];
 for(const glyph of glyphs){const group=groups.at(-1),first=group?.[0],last=group?.at(-1);if(first&&(mixed||first.operatorIndex===glyph.operatorIndex)&&first.fontId===glyph.fontId&&first.resource===glyph.resource&&first.baseline===glyph.baseline&&first.size===glyph.size&&first.color===glyph.color&&(mixed&&mixedSpacing||first.characterSpacing===glyph.characterSpacing)){if(glyph.x<last!.x)return fail();group!.push({...glyph});}else groups.push([{...glyph}]);}
 return groups.map((g,index)=>({index,glyphs:g,item:{str:g.map(v=>v.unicode).join(''),dir:'ltr',fontName:g[0].resource,width:g.at(-1)!.x+g.at(-1)!.advance-g[0].x,height:g[0].size,transform:Util.transform(Util.inverseTransform(viewport),[g[0].size,0,0,-g[0].size,g[0].x,g[0].baseline]),hasEOL:false}}));
}
