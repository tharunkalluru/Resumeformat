import {rotatedSourceInk} from './source-rotation';
import {SourceOverlapRanges} from './source-overlap-ranges';
import {sourceOutlineBox,sourceShear} from './source-shear';
import {checkSourceGraphBudget,sourceGlyphAt,sourceGlyphCount,sourceOverlapProofs} from '../core/source-graph';
import type {SourceGlyphOccurrence,SourceOverlapProof,SourceRuleOverlapProof,Template,Rect,RuleRegion} from '../core/model';
import {canonicalJson,hashTextSync} from '../core/model';
import {FolioError} from '../core/errors';
import {loadSourceFont} from './source-fonts';
import {currentSourceScopedPaint,isSourcePageBackground} from '../core/source-scoped-paint';
const intersects=(a:Rect,b:Rect)=>Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>.01&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>.01;
export const sourceOccurrenceKey=(o:SourceGlyphOccurrence)=>canonicalJson([o.regionId,o.glyphOrdinal]);
export function sourceOverlapKey(a:SourceGlyphOccurrence,b:SourceGlyphOccurrence):string{return canonicalJson([sourceOccurrenceKey(a),sourceOccurrenceKey(b)].sort());}
function sourceIndex(template:Template){checkSourceGraphBudget(template);return {native:template.importerVersion==='folio-import-v30'&&template.sourceCompositePages?.version==='original-native-composite-v9'||template.importerVersion==='folio-import-v31'&&template.sourceCompositePages?.version==='original-native-composite-v10'||template.importerVersion==='folio-import-v24'&&template.sourceCompositePages?.version==='original-native-composite-v6'||template.importerVersion==='folio-import-v29'&&template.sourceCompositePages?.version==='original-native-composite-v8',spacingPages:new Set(template.pages.filter(p=>p.regions.some(r=>r.kind==='text'&&r.sourceLayout?.version===3)).map(p=>p.id)),regions:new Map(template.pages.flatMap(p=>p.regions).map(r=>[r.id,r])),fonts:new Map((template.sourceFonts??[]).map(f=>[f.id,{asset:f,face:loadSourceFont(f),maps:new Map(f.glyphMap.map(m=>[m.cid,m]))}]))};}
function witness(template:Template,occurrence:SourceGlyphOccurrence,index=sourceIndex(template)){
 const region=index.regions.get(occurrence.regionId);
 if(region?.kind!=='text'||!region.sourceLayout||region.sourceLayout.version===1&&!index.spacingPages.has(region.pageId)&&!index.native||!Number.isInteger(occurrence.glyphOrdinal)||occurrence.glyphOrdinal<0)throw new FolioError('SOURCE_OVERLAP_PROOF','An original overlap references no exact source glyph occurrence.');
 const glyph=sourceGlyphAt(region,occurrence.glyphOrdinal),owned=index.fonts.get(region.style.sourceFontId!),asset=owned?.asset,map=owned?.maps.get(glyph?.cid);
 if(!glyph||!asset||(region.sourceLayout.version===2?asset.format!=='opentype-cff':asset.format!=='truetype'&&asset.sourceVersion!==9)||!map||map.nonPainting||glyph.fontId!==asset.id)throw new FolioError('SOURCE_OVERLAP_PROOF','An original overlap lacks owned source font/outline proof.');
 const face=owned!.face,box=face.font.getGlyph(map.glyphId).bbox,scale=region.style.fontSize/face.font.unitsPerEm;
 return {region,pageId:region.pageId,sourceSha256:region.sourceLayout.sourceSha256,rect:region.sourceLayout.version===6?rotatedSourceInk(face.font.getGlyph(map.glyphId).path,region.sourceLayout.rotation,glyph.x,region.sourceLayout.baseline,scale):{x:glyph.x+box.minX*scale,y:region.sourceLayout.baseline-box.maxY*scale,width:box.width*scale,height:box.height*scale},binding:{occurrence,glyph,...(region.sourceLayout.version===6?{rotation:region.sourceLayout.rotation}:{}),sourceSha256:region.sourceLayout.sourceSha256,sourceFontId:asset.id,sourceProgramSha256:asset.sha256,...(asset.sourceVersion===9?{originalProgram:{sha256:asset.originalProgram.sha256,pdfFontRef:asset.originalProgram.pdfFontRef},originalCff:asset.originalCff.sha256,sourceResource:asset.sourceResource,mapping:map}:{}),glyphId:map.glyphId,fontSize:region.style.fontSize,baseline:region.sourceLayout.baseline,color:region.style.color}};
}
function admittedPair(a:import('../core/model').Region|undefined,b:import('../core/model').Region|undefined,native=false){if(a?.kind!=='text'||b?.kind!=='text')return false;const av=a.sourceLayout?.version,bv=b.sourceLayout?.version;return native&&(av===1||av===6)&&(bv===1||bv===6)||av===2&&bv===2||(av===3&&(bv===3||bv===1)||bv===3&&av===1);}
export function sourceOverlapProof(template:Template,first:SourceGlyphOccurrence,second:SourceGlyphOccurrence,index=sourceIndex(template)):SourceOverlapProof {
 const a=witness(template,first,index),b=witness(template,second,index);
 if(!admittedPair(a.region,b.region,index.native)||(a.region.id===b.region.id&&a.region.sourceLayout?.version!==3)||a.pageId!==b.pageId||a.sourceSha256!==b.sourceSha256||!intersects(a.rect,b.rect))throw new FolioError('SOURCE_OVERLAP_PROOF','The original source glyph pair does not intersect.');
 return {first:{...first},second:{...second},sourceSha256:a.sourceSha256,proofHash:hashTextSync(canonicalJson([a.binding,b.binding]))};
}
/** Bounded import-time original paint inventory, never derived from a changed draft. */
export function buildSourceOverlapManifest(template:Template):SourceOverlapProof[] {
 const result:SourceOverlapProof[]=[],index=sourceIndex(template);let comparisons=0;
 for(const page of template.pages){const glyphs:{occurrence:SourceGlyphOccurrence;rect:Rect}[]=[];
  for(const region of page.regions)if(region.kind==='text'&&(region.sourceLayout?.version===2||region.sourceLayout?.version===3||region.sourceLayout?.version===1&&(index.spacingPages.has(page.id)||index.native)))for(let i=0;i<sourceGlyphCount(region);i++){const occurrence={regionId:region.id,glyphOrdinal:i},map=index.fonts.get(region.style.sourceFontId!)?.maps.get(sourceGlyphAt(region,i).cid);if(!map?.nonPainting)glyphs.push({occurrence,rect:witness(template,occurrence,index).rect});}
  glyphs.sort((a,b)=>a.rect.x-b.rect.x);let active:typeof glyphs=[];
  for(const current of glyphs){active=active.filter(g=>g.rect.x+g.rect.width>current.rect.x+.01);for(const previous of active){if(++comparisons>2_000_000)throw new FolioError('SOURCE_OVERLAP_LIMIT','The source overlap proof exceeds its bounded comparison budget.');if(intersects(previous.rect,current.rect)&&(previous.occurrence.regionId!==current.occurrence.regionId||index.regions.get(current.occurrence.regionId)?.kind==='text'&&(index.regions.get(current.occurrence.regionId) as import('../core/model').TextRegion).sourceLayout?.version===3)&&admittedPair(index.regions.get(previous.occurrence.regionId),index.regions.get(current.occurrence.regionId),index.native)){if(result.length>=1000)throw new FolioError('SOURCE_OVERLAP_LIMIT','The source overlap proof exceeds1000 pairs.');result.push(sourceOverlapProof(template,previous.occurrence,current.occurrence,index));}}active.push(current);}
 }
 return result;
}
export function validatedSourceOverlapKeys(template:Template):Set<string> {
 const result=new Set<string>(),index=sourceIndex(template);for(const proof of sourceOverlapProofs(template)){const actual=sourceOverlapProof(template,proof.first,proof.second,index),key=sourceOverlapKey(proof.first,proof.second);if(result.has(key)||actual.sourceSha256!==proof.sourceSha256||actual.proofHash!==proof.proofHash)throw new FolioError('SOURCE_OVERLAP_PROOF','An immutable original overlap proof no longer matches source paint.');result.add(key);}return result;
}
/** Changed metadata/paint invalidates the exemption while leaving a usable error preview. */
export function currentSourceOverlapKeys(template:Template):Set<string> {const result=new Set<string>(),index=sourceIndex(template);for(const proof of sourceOverlapProofs(template)){try{const actual=sourceOverlapProof(template,proof.first,proof.second,index);if(actual.sourceSha256===proof.sourceSha256&&actual.proofHash===proof.proofHash)result.add(sourceOverlapKey(proof.first,proof.second));}catch{/* Every actual collision remains checked. */}}return result;}

export const sourceRuleOverlapKey=(glyph:SourceGlyphOccurrence,ruleId:string)=>canonicalJson([sourceOccurrenceKey(glyph),ruleId]);
function ruleGlyphWitness(template:Template,occurrence:SourceGlyphOccurrence,index=sourceIndex(template)){
 const region=index.regions.get(occurrence.regionId);
 if(region?.kind!=='text'||!region.sourceLayout||!Number.isInteger(occurrence.glyphOrdinal)||occurrence.glyphOrdinal<0)throw new FolioError('SOURCE_RULE_OVERLAP','An original rule overlap has no owned glyph occurrence.');
 const graph=region.sourceLayout,glyph=sourceGlyphAt(region,occurrence.glyphOrdinal),owned=index.fonts.get(region.style.sourceFontId!),asset=owned?.asset,map=owned?.maps.get(glyph.cid);
 if(!asset||!('originalProgram'in asset)||(asset.sourceVersion!==4&&asset.sourceVersion!==5&&asset.sourceVersion!==6&&asset.sourceVersion!==7&&asset.sourceVersion!==8&&asset.sourceVersion!==9&&asset.sourceVersion!==10)||!asset.originalProgram||graph.version===2||!map||map.nonPainting||glyph.inferredGap||glyph.fontId!==asset.id||glyph.unicode!==map.unicode||asset.sourceSha256!==graph.sourceSha256||graph.fontSize!==region.style.fontSize)throw new FolioError('SOURCE_RULE_OVERLAP','An original rule overlap lacks verified source font paint.');
 const face=owned!.face,box=sourceOutlineBox(face.font.getGlyph(map.glyphId).path,sourceShear(graph)),scale=graph.fontSize/face.font.unitsPerEm;
 return {region,glyph,sourceSha256:graph.sourceSha256,rect:{x:glyph.x+box.minX*scale,y:graph.baseline-box.maxY*scale,width:box.width*scale,height:box.height*scale},binding:{occurrence,glyph,sourceSha256:graph.sourceSha256,sourceFontId:asset.id,sourceResource:asset.sourceResource,sourceProgramSha256:asset.sha256,originalProgram:'originalProgram'in asset?{sha256:asset.originalProgram!.sha256,pdfFontRef:asset.originalProgram!.pdfFontRef}:null,mapping:map,fontSize:graph.fontSize,baseline:graph.baseline,baselineRunsHash:graph.baselineRunsHash,...(graph.version===4?{sourceShear:graph.shearX}:{}),style:region.style,regionBounds:region.bounds,regionOrder:region.order}};
}
function ruleWitness(template:Template,ruleId:string,index=sourceIndex(template)){
 const rule=index.regions.get(ruleId),paint=rule?.kind==='rule'?rule.sourcePaint:undefined,pageIndex=template.pages.findIndex(p=>p.id===rule?.pageId);
 if(rule?.kind!=='rule'||!paint||paint.kind!=='horizontal-solid-stroke-v1'||paint.lineCap!==0||paint.lineJoin!==0||paint.opacity!==1||paint.blendMode!=='Normal'||pageIndex<0||paint.pageNumber!==pageIndex+1||!Number.isInteger(paint.operatorIndex)||paint.operatorIndex<0||paint.operatorIndex>100000||paint.operatorIndex!==rule.order||rule.bounds.height!==0||!(rule.bounds.width>0)||canonicalJson([rule.bounds,rule.color,rule.thickness])!==canonicalJson([paint.bounds,paint.color,paint.thickness]))throw new FolioError('SOURCE_RULE_OVERLAP','The original horizontal rule paint changed.');
 const t=rule.thickness/2;
 return {rule,sourceSha256:paint.sourceSha256,rect:{x:rule.bounds.x-t,y:rule.bounds.y-t,width:rule.bounds.width+2*t,height:2*t},binding:{ruleId,rulePageId:rule.pageId,ruleOrder:rule.order,paint}};
}
export function sourceRuleOverlapProof(template:Template,glyph:SourceGlyphOccurrence,ruleId:string,index=sourceIndex(template)):SourceRuleOverlapProof {
 const a=ruleGlyphWitness(template,glyph,index),b=ruleWitness(template,ruleId,index);
 // Actual export sorts by region order. Only preserve the original relative paint order.
 const originalOrder=Math.sign(a.glyph.operatorIndex-b.rule.sourcePaint!.operatorIndex),renderOrder=Math.sign(a.region.order-b.rule.order);
 if(a.region.pageId!==b.rule.pageId||a.sourceSha256!==b.sourceSha256||!intersects(a.rect,b.rect)||originalOrder===0||originalOrder!==renderOrder)throw new FolioError('SOURCE_RULE_OVERLAP','The original glyph/rule pair has no matching paint intersection or order.');
 return {glyph:{...glyph},ruleId,sourceSha256:a.sourceSha256,proofHash:hashTextSync(canonicalJson([a.binding,b.binding]))};
}
/** Fresh original import only; neither layout nor a changed draft can mint exemptions. */
export function buildSourceRuleOverlapManifest(template:Template):SourceRuleOverlapProof[] {
 const index=sourceIndex(template),result:SourceRuleOverlapProof[]=[];let comparisons=0;
 for(const page of template.pages){
  const rules=page.regions.filter((r):r is RuleRegion=>r.kind==='rule'&&!!r.sourcePaint);if(!rules.length)continue;
  for(const region of page.regions)if(region.kind==='text'&&region.sourceLayout){const asset=index.fonts.get(region.style.sourceFontId!)?.asset;if(!asset||!('originalProgram'in asset)||(asset.sourceVersion!==4&&asset.sourceVersion!==5&&asset.sourceVersion!==6&&asset.sourceVersion!==7&&asset.sourceVersion!==8&&asset.sourceVersion!==9&&asset.sourceVersion!==10))continue;
   for(let ordinal=0;ordinal<sourceGlyphCount(region);ordinal++){const occurrence={regionId:region.id,glyphOrdinal:ordinal},map=index.fonts.get(region.style.sourceFontId!)!.maps.get(sourceGlyphAt(region,ordinal).cid);if(!map||map.nonPainting)continue;
    const glyph=ruleGlyphWitness(template,occurrence,index);
    for(const rule of rules){if(++comparisons>2000000)throw new FolioError('SOURCE_RULE_LIMIT','The source rule overlap proof exceeds its bounded comparison budget.');if(!intersects(glyph.rect,ruleWitness(template,rule.id,index).rect))continue;
     try{const proof=sourceRuleOverlapProof(template,occurrence,rule.id,index);if(result.length>=1000)throw new FolioError('SOURCE_RULE_LIMIT','The source rule overlap proof exceeds1000 pairs.');result.push(proof);}catch(error){if(error instanceof FolioError&&error.code==='SOURCE_RULE_OVERLAP')continue;throw error;}
    }
   }
  }
 }
 return result;
}
export function validatedSourceRuleOverlapKeys(template:Template):Set<string> {
 const result=new Set<string>();if(!template.sourceRuleOverlaps)return result;
 if(!template.sourceRuleOverlaps.length||template.sourceRuleOverlaps.length>1000)throw new FolioError('SOURCE_RULE_LIMIT','The source rule overlap proof has an invalid pair budget.');
 const index=sourceIndex(template);
 for(const proof of template.sourceRuleOverlaps){const actual=sourceRuleOverlapProof(template,proof.glyph,proof.ruleId,index),key=sourceRuleOverlapKey(proof.glyph,proof.ruleId);if(result.has(key)||actual.sourceSha256!==proof.sourceSha256||actual.proofHash!==proof.proofHash)throw new FolioError('SOURCE_RULE_OVERLAP','The immutable original rule overlap proof changed.');result.add(key);}
 return result;
}
export function currentSourceRuleOverlapKeys(template:Template):Set<string> {
 const result=new Set<string>();if(!template.sourceRuleOverlaps?.length)return result;if(template.sourceRuleOverlaps.length>1000)throw new FolioError('SOURCE_RULE_LIMIT','The source rule overlap proof exceeds1000 pairs.');const index=sourceIndex(template);
 for(const proof of template.sourceRuleOverlaps){try{const actual=sourceRuleOverlapProof(template,proof.glyph,proof.ruleId,index);if(actual.sourceSha256===proof.sourceSha256&&actual.proofHash===proof.proofHash)result.add(sourceRuleOverlapKey(proof.glyph,proof.ruleId));}catch{/* Changed paint remains a collision. */}}
 return result;
}

export const sourceScopedOverlapKey=(glyph:SourceGlyphOccurrence,primitiveId:string)=>canonicalJson([sourceOccurrenceKey(glyph),primitiveId]);
/** Exact original pairs only. Source restore independently rederives both paint records.
 * Current text must also keep its baseline runs; the engine enforces that per occurrence. */
export function currentSourceScopedOverlapKeys(template:Template):Pick<Set<string>,'has'|'size'>{
 const result=template.importerVersion==='folio-import-v28'?new SourceOverlapRanges():new Set<string>();if(!template.sourceScopedPages)return result;
 const index=sourceIndex(template);let comparisons=0;
 const clipped=(box:Rect,clip:Rect):Rect=>{const x=Math.max(box.x,clip.x),y=Math.max(box.y,clip.y);return{x,y,width:Math.max(0,Math.min(box.x+box.width,clip.x+clip.width)-x),height:Math.max(0,Math.min(box.y+box.height,clip.y+clip.height)-y)};};
 for(const page of template.pages){
  const primitives=page.regions.flatMap(region=>{const paint=currentSourceScopedPaint(region,template);if(!paint||region.kind!=='rule'&&region.kind!=='rectangle'||isSourcePageBackground(region,template))return[];const b=region.bounds,box=region.kind==='rule'?{x:b.x,y:b.y-region.thickness/2,width:b.width,height:region.thickness}:b;return[{region,paint,box:clipped(box,paint.effectiveClip)}];});
  for(const region of page.regions){if(region.kind!=='text'||!region.sourceLayout)continue;const paint=currentSourceScopedPaint(region,template);if(!paint)continue;const showOperators=new Map(paint.showGroup?.operators??[[paint.operatorIndex,paint.rawOperatorIndex]]);
   for(let ordinal=0;ordinal<sourceGlyphCount(region);ordinal++){
    const occurrence={regionId:region.id,glyphOrdinal:ordinal},map=index.fonts.get(region.style.sourceFontId!)?.maps.get(sourceGlyphAt(region,ordinal).cid);if(!map||map.nonPainting)continue;
    const glyph=ruleGlyphWitness(template,occurrence,index),box=clipped(glyph.rect,paint.effectiveClip);
    for(const primitive of primitives){if(++comparisons>2_000_000)throw new FolioError('SOURCE_SCOPED_PAINT_LIMIT','Original scoped intersection checks exceed their bounded budget.');
     if(paint.sourceSha256!==primitive.paint.sourceSha256||!showOperators.has(glyph.glyph.operatorIndex)||Math.sign(showOperators.get(glyph.glyph.operatorIndex)!-primitive.paint.rawOperatorIndex)!==Math.sign(region.order-primitive.region.order)||region.order===primitive.region.order)throw new FolioError('SOURCE_SCOPED_PAINT','The original glyph/primitive paint order changed.');
     if(intersects(box,primitive.box)){if(result instanceof Set&&result.size>=1000)throw new FolioError('SOURCE_SCOPED_PAINT_LIMIT','Original scoped intersections exceed1000 pairs.');result.add(sourceScopedOverlapKey(occurrence,primitive.region.id));}
    }
   }
  }
 }
 return result;
}

/** Both glyphs belong to immutable scoped source paint, including its replay
 * order and clips. The engine separately requires BOTH current runs unchanged. */
export function currentSourceScopedGlyphOverlapKeys(template:Template):Set<string>{
 const result=new Set<string>();if(!template.sourceScopedPages)return result;
 const index=sourceIndex(template);let comparisons=0;
 for(const page of template.pages){const glyphs:{occurrence:SourceGlyphOccurrence;regionId:string;paint:NonNullable<ReturnType<typeof currentSourceScopedPaint>>;box:Rect;order:number}[]=[];
  for(const region of page.regions){if(region.kind!=='text'||(region.sourceLayout?.version!==1&&region.sourceLayout?.version!==4&&!(template.importerVersion==='folio-import-v28'&&(region.sourceLayout?.version===3||region.sourceLayout?.version===5))))continue;const paint=currentSourceScopedPaint(region,template);if(!paint)continue;const showOperators=new Map(paint.showGroup?.operators??[[paint.operatorIndex,paint.rawOperatorIndex]]);
   for(let ordinal=0;ordinal<sourceGlyphCount(region);ordinal++){const occurrence={regionId:region.id,glyphOrdinal:ordinal},map=index.fonts.get(region.style.sourceFontId!)?.maps.get(sourceGlyphAt(region,ordinal).cid);if(!map||map.nonPainting)continue;const glyph=ruleGlyphWitness(template,occurrence,index);if(!showOperators.has(glyph.glyph.operatorIndex))throw new FolioError('SOURCE_SCOPED_PAINT','Original glyph occurrence order differs from its scoped paint');const b=glyph.rect,c=paint.effectiveClip,x=Math.max(b.x,c.x),y=Math.max(b.y,c.y),box={x,y,width:Math.max(0,Math.min(b.x+b.width,c.x+c.width)-x),height:Math.max(0,Math.min(b.y+b.height,c.y+c.height)-y)};if(box.width>0&&box.height>0)glyphs.push({occurrence,regionId:region.id,paint:{...paint,operatorIndex:glyph.glyph.operatorIndex,rawOperatorIndex:showOperators.get(glyph.glyph.operatorIndex)!},box,order:glyph.glyph.operatorIndex});}
  }
  glyphs.sort((a,b)=>a.box.x-b.box.x);let active:typeof glyphs=[];
  for(const current of glyphs){active=active.filter(g=>g.box.x+g.box.width>current.box.x+.01);for(const previous of active){if(++comparisons>2000000)throw new FolioError('SOURCE_SCOPED_PAINT_LIMIT','Original scoped glyph intersections exceed their comparison budget');const sameShearedOwner=previous.regionId===current.regionId&&(index.regions.get(current.regionId) as import('../core/model').TextRegion).sourceLayout?.version===4;if(previous.regionId===current.regionId&&!sameShearedOwner||previous.order===current.order&&!sameShearedOwner||!intersects(previous.box,current.box))continue;const sign=Math.sign(previous.paint.rawOperatorIndex-current.paint.rawOperatorIndex);if(previous.paint.sourceSha256!==current.paint.sourceSha256||!sign&&!sameShearedOwner||sign!==Math.sign(previous.order-current.order))throw new FolioError('SOURCE_SCOPED_PAINT','Original glyph pair paint order differs');if(result.size>=1000)throw new FolioError('SOURCE_SCOPED_PAINT_LIMIT','Original scoped glyph intersections exceed1000 pairs');result.add(sourceOverlapKey(previous.occurrence,current.occurrence));}active.push(current);}
 }
 return result;
}

/** A proved opaque white rectangle painted before all of this source text is
 * an underlay only when it contains every original ink box. Current ink must
 * still fit that same rectangle; later/partial/changed paint never qualifies. */
export function sourceTextUnderlay(template:Template,textId:string,primitiveId:string):Rect|undefined{
 if(template.importerVersion!=='folio-import-v28')return;
 const index=sourceIndex(template),text=index.regions.get(textId),primitive=index.regions.get(primitiveId);
 if(text?.kind!=='text'||!text.sourceLayout||primitive?.kind!=='rectangle'||primitive.fill!=='#ffffff'||primitive.stroke||primitive.thickness!==0||text.pageId!==primitive.pageId)return;
 const paint=currentSourceScopedPaint(text,template),back=currentSourceScopedPaint(primitive,template);
 if(!paint||!back||back.kind!=='fillRect'||back.zeroFill||back.color.components.some(c=>c!==1)||paint.sourceSha256!==back.sourceSha256||primitive.order>=text.order||back.rawOperatorIndex>=paint.rawOperatorIndex)return;
 const b=primitive.bounds,c=back.effectiveClip,x=Math.max(b.x,c.x),y=Math.max(b.y,c.y),box={x,y,width:Math.max(0,Math.min(b.x+b.width,c.x+c.width)-x),height:Math.max(0,Math.min(b.y+b.height,c.y+c.height)-y)};
 const contains=(a:Rect)=>a.x>=box.x&&a.y>=box.y&&a.x+a.width<=box.x+box.width&&a.y+a.height<=box.y+box.height;
 let painted=0;
 for(let ordinal=0;ordinal<sourceGlyphCount(text);ordinal++){const glyph=sourceGlyphAt(text,ordinal),map=index.fonts.get(text.style.sourceFontId!)?.maps.get(glyph.cid);if(!map)return;if(map.nonPainting)continue;if(!contains(ruleGlyphWitness(template,{regionId:text.id,glyphOrdinal:ordinal},index).rect))return;painted++;}
 return painted?box:undefined;
}
