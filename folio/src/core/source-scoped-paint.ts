import {canonicalJson,sha256Sync,type Region,type SourceFontAsset,type SourceScopedPaint,type Template} from './model';
import {sourceGlyphs} from './source-graph';
import {FolioError} from './errors';

export function sourceScopedStateHash(region:Region,fonts:readonly SourceFontAsset[]):string{
 const state=region.kind==='text'?(()=>{if(!region.sourceLayout)throw new FolioError('SOURCE_SCOPED_PAINT','A scoped text paint needs its original graph.');const font=fonts.find(asset=>asset.id===region.style.sourceFontId);return [region.kind,region.order,region.bounds,region.style,region.sourceLayout.sourceSha256,region.sourceLayout.baseline,region.sourceLayout.fontSize,region.sourceLayout.version===3||region.sourceLayout.version===4?region.sourceLayout.characterSpacing:0,region.sourceLayout.baselineRunsHash,font?.sha256,Array.from(sourceGlyphs(region)),...(region.sourceLayout.version===5?['source-show-spacing-v1',region.sourceLayout.showSpacing]:[]),...(region.sourceLayout.version===4?['horizontal-shear-v1',region.sourceLayout.shearX]:[])];})():region.kind==='rectangle'?[region.kind,region.order,region.bounds,region.fill,region.stroke,region.thickness]:region.kind==='rule'?[region.kind,region.order,region.bounds,region.color,region.thickness]:undefined;
 if(!state)throw new FolioError('SOURCE_SCOPED_PAINT','This source paint kind has no current replay proof.');return sha256Sync(new TextEncoder().encode(canonicalJson(state)));
}
export function currentSourceScopedPaint(region:Region,template:Template):SourceScopedPaint|undefined{
 const paint='sourceScopedPaint'in region?region.sourceScopedPaint:undefined;if(!paint)return;
 const page=template.pages[paint.pageNumber-1],proof=template.sourceScopedPages?.pages[paint.pageNumber-1];
 if(['source-scoped-occurrence-v4','source-scoped-occurrence-v5'].includes(paint.version)&&(region.kind!=='text'||!['folio-import-v27','folio-import-v28'].includes(template.importerVersion)||!paint.showGroup||!template.sourceFonts?.some(f=>f.id===region.style.sourceFontId&&f.sourceVersion===7)))throw new FolioError('SOURCE_SCOPED_PAINT','Grouped document text requires complete V27 source ownership.');
 if((paint.version==='source-scoped-occurrence-v5')!==(region.kind==='text'&&region.sourceLayout?.version===5)||paint.version==='source-scoped-occurrence-v5'&&template.importerVersion!=='folio-import-v28')throw new FolioError('SOURCE_SCOPED_PAINT','Variable spacing requires exact V28 show ownership.');
 if(paint.version==='source-scoped-occurrence-v3'&&(region.kind!=='text'||!['folio-import-v16','folio-import-v17','folio-import-v18'].includes(template.importerVersion)||!paint.showGroup))throw new FolioError('SOURCE_SCOPED_PAINT','Grouped text needs its current complete source contract.');
 if(region.kind==='text'&&region.sourceLayout?.version===4&&(template.importerVersion!=='folio-import-v17'))throw new FolioError('SOURCE_SCOPED_PAINT','Sheared source text requires its complete V17 show ownership.');
 const gaps=region.kind==='text'?Array.from(sourceGlyphs(region)).filter(glyph=>glyph.inferredGap).length:0;
 if((paint.derivedGaps?.count??0)!==gaps||!!paint.derivedGaps!==!!gaps)throw new FolioError('SOURCE_SCOPED_PAINT','The derived spacing count no longer matches its source occurrence.');
 if(!['folio-import-v13','folio-import-v14','folio-import-v26','folio-import-v27','folio-import-v28','folio-import-v15','folio-import-v16','folio-import-v17','folio-import-v18'].includes(template.importerVersion)||!template.sourceScopedPages||!page||page.id!==region.pageId||!proof||proof.width!==page.width||proof.height!==page.height||paint.sourceSha256!==template.sourceScopedPages.sourceSha256||paint.operatorIndex!==region.order||paint.stateHash!==sourceScopedStateHash(region,template.sourceFonts??[]))throw new FolioError('SOURCE_SCOPED_PAINT','The original scoped paint no longer matches its template occurrence.');return paint;
}
/** A first-painted, unclipped white page underlay remains painted in the PDF.
 * It occupies no reserved foreground ink. Partial, later or changed rectangles
 * retain the existing collision and pair budgets.
 */
export function isSourcePageBackground(region:Region,template:Template):boolean{
 if(!['folio-import-v16','folio-import-v17','folio-import-v18'].includes(template.importerVersion)||region.kind!=='rectangle'||region.fill!=='#ffffff'||region.stroke||region.thickness!==0)return false;
 const paint=currentSourceScopedPaint(region,template),page=template.pages.find(p=>p.id===region.pageId);
 if(!paint||!page||paint.kind!=='fillRect'||paint.color.space==='ICCBased'||paint.color.components.some(c=>c!==1)||paint.clipStack.length||region.order!==Math.min(...page.regions.map(r=>r.order)))return false;
 const full={x:0,y:0,width:page.width,height:page.height};
 return canonicalJson(region.bounds)===canonicalJson(full)&&canonicalJson(paint.effectiveClip)===canonicalJson(full);
}
/** CSS keeps the original component precision rather than the decoded hex approximation. */
export function sourceScopedCssColor(paint:SourceScopedPaint,displayColor='#000000'):string{
 if(paint.color.space==='ICCBased')return displayColor; // Unqualified read-only derivative; PDF preview owns original color.
 const c=paint.color.components,values=paint.color.space==='DeviceGray'?[c[0],c[0],c[0]]:c;
 return `rgb(${values.map(value=>String(value*255)).join(' ')})`;
}
/** Clip the paint child; selection boundaries are deliberately outside this clip. */
export function sourceScopedCssClip(paint:SourceScopedPaint,origin:{x:number;y:number}):string{
 const b=paint.effectiveClip,x=b.x-origin.x,y=b.y-origin.y;
 return `polygon(${x}pt ${y}pt, ${x+b.width}pt ${y}pt, ${x+b.width}pt ${y+b.height}pt, ${x}pt ${y+b.height}pt)`;
}
