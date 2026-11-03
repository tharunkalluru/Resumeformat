import {localPdfDecoderOptions} from '../render/pdf-decoder-options';
import {getDocument,GlobalWorkerOptions,OPS,Util} from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import {canonicalJson,sha256Sync,type SourceRulePaint,type Template,type SourceFontAsset} from '../core/model';
import {sourceGlyphAt} from '../core/source-graph';
import {FolioError} from '../core/errors';
import {simpleSourcePath} from './pdf-path';
import {captureSourceGlyphs} from './pdf-source';
import {preflightPdfImages} from './pdf-image-preflight';

GlobalWorkerOptions.workerSrc=workerUrl;
interface Operators {fnArray:number[];argsArray:any[]}
interface State {matrix:number[];color:string;width:number;cap:number;join:number;solid:boolean;opacity:number;blend:string;mask:boolean}
const fail=():never=>{throw new FolioError('SOURCE_RULE_PAINT','An original rule overlap no longer matches the retained PDF paint.');};

/** Only actual opaque horizontal stroke operators; no ambiguous page/form clipping context. */
export function captureSourceRulePaint(operators:Operators,viewport:number[],pageNumber:number,sourceSha256:string):Map<number,SourceRulePaint> {
  const result=new Map<number,SourceRulePaint>();
  if(operators.fnArray.length>100000)throw new FolioError('SOURCE_RULE_LIMIT','The original rule paint exceeds100000 operations.');
  if(operators.fnArray.some(op=>[OPS.clip,OPS.eoClip,OPS.paintFormXObjectBegin,OPS.paintFormXObjectEnd,OPS.beginGroup,OPS.endGroup,OPS.setStrokeColorSpace,OPS.setStrokeColor,OPS.setStrokeColorN,OPS.setStrokeCMYKColor,OPS.setStrokeGray,OPS.setStrokeTransparent].includes(op)))return result;
  let state:State={matrix:[1,0,0,1,0,0],color:'#000000',width:1,cap:0,join:0,solid:true,opacity:1,blend:'Normal',mask:false};
  const stack:State[]=[];
  for(let index=0;index<operators.fnArray.length;index++){
    const op=operators.fnArray[index],args=operators.argsArray[index];
    if(op===OPS.save)stack.push({...state,matrix:[...state.matrix]});
    else if(op===OPS.restore){if(!stack.length)return new Map();state=stack.pop()!;}
    else if(op===OPS.transform){if(!Array.isArray(args)||args.length!==6||!args.every(Number.isFinite))return new Map();state.matrix=Util.transform(state.matrix,args);}
    else if(op===OPS.setLineWidth)state.width=Number(args[0]);
    else if(op===OPS.setLineCap)state.cap=Number(args[0]);
    else if(op===OPS.setLineJoin)state.join=Number(args[0]);
    else if(op===OPS.setDash)state.solid=Array.isArray(args[0])&&args[0].length===0;
    else if(op===OPS.setStrokeRGBColor)state.color=typeof args[0]==='string'&&/^#[a-f\d]{6}$/i.test(args[0])?args[0]:'';
    else if(op===OPS.setGState){
      if(!Array.isArray(args[0]))return new Map();
      for(const [key,value] of args[0]){
        if(key==='LW')state.width=Number(value);
        else if(key==='LC')state.cap=Number(value);
        else if(key==='LJ')state.join=Number(value);
        // A two-point open stroke has no join; a valid miter limit cannot change its ink.
        else if(key==='ML'){if(typeof value!=='number'||!Number.isFinite(value)||value<1)return new Map();}
        else if(key==='D')state.solid=Array.isArray(value)&&Array.isArray(value[0])&&value[0].length===0;
        else if(key==='CA')state.opacity=Number(value);
        else if(key==='ca'){if(value!==1)return new Map();}
        else if(key==='BM')state.blend=String(value);
        else if(key==='SMask')state.mask=!!value&&value!=='None';
        else return new Map();
      }
    }else if(op===OPS.constructPath){
      const path=simpleSourcePath(args[1]?.[0]);
      if(args[0]!==OPS.stroke||!path||path.closed||path.points.length!==2||!state.solid||state.cap!==0||state.join!==0||state.opacity!==1||state.mask||!['Normal','source-over'].includes(state.blend)||!state.color)continue;
      const m=Util.transform(viewport,state.matrix);
      // This slice proves a uniform axis-aligned transform and an unclamped positive stroke.
      if(!m.every(Number.isFinite)||m[1]!==0||m[2]!==0||!m[0]||Math.abs(m[0])!==Math.abs(m[3]))continue;
      const points=path.points.map(p=>{const copy=[...p];Util.applyTransform(copy,m);return copy;});
      const width=Math.abs(points[1][0]-points[0][0]),thickness=state.width*Math.hypot(state.matrix[0],state.matrix[1]);
      if(points[0][1]!==points[1][1]||!(width>0)||!Number.isFinite(thickness)||thickness<.1||thickness>100)continue;
      result.set(index,{kind:'horizontal-solid-stroke-v1',sourceSha256,pageNumber,operatorIndex:index,bounds:{x:Math.min(points[0][0],points[1][0]),y:points[0][1],width,height:0},color:state.color,thickness,lineCap:0,lineJoin:0,opacity:1,blendMode:'Normal'});
    }
  }
  return stack.length?new Map():result;
}

/** Reopen/backup ownership check rederives paint from retained bytes, never from manifest hashes. */
export async function validateSourceRulePaint(bytes:Uint8Array,template:Template):Promise<void> {
  if(!template.sourceRuleOverlaps?.length)return;
  if(template.sourceRuleOverlaps.length>1000)fail();
  const sourceSha256=sha256Sync(bytes),wanted=new Map<number,Map<number,SourceRulePaint>>(),ruleIds=new Set(template.sourceRuleOverlaps.map(p=>p.ruleId));
  for(const [pageIndex,page] of template.pages.entries())for(const rule of page.regions)if(ruleIds.has(rule.id)){
    if(rule.kind!=='rule')return fail();
    if(!rule.sourcePaint)return fail();
    const paint=rule.sourcePaint;
    if(paint.sourceSha256!==sourceSha256||paint.pageNumber!==pageIndex+1||paint.operatorIndex!==rule.order||canonicalJson([rule.bounds,rule.color,rule.thickness])!==canonicalJson([paint.bounds,paint.color,paint.thickness]))fail();
    const group=wanted.get(paint.pageNumber)??new Map();if(group.has(paint.operatorIndex))fail();group.set(paint.operatorIndex,paint);wanted.set(paint.pageNumber,group);ruleIds.delete(rule.id);
  }
  if(ruleIds.size)fail();
  await preflightPdfImages(bytes);
  const task=getDocument({...localPdfDecoderOptions(),data:new Uint8Array(bytes),useSystemFonts:false,isOffscreenCanvasSupported:false,fontExtraProperties:true,stopAtErrors:true,maxImageSize:20000000,verbosity:0});
  try{
    const pdf=await task.promise;if(pdf.numPages!==template.pages.length||(await pdf.getPermissions())!==null)fail();
    if(Array.from(await pdf.getOptionalContentConfig()).length)fail();
    const fonts=new Map((template.sourceFonts??[]).map(f=>[f.id,f]));
    const signature=(asset:SourceFontAsset|undefined,cid:number,unicode:string,operatorIndex:number,x:number,advance:number,baseline:number,size:number,color:string,spacing:number)=>{
      if(!asset||!('originalProgram'in asset)||(asset.sourceVersion!==4&&asset.sourceVersion!==5&&asset.sourceVersion!==6&&asset.sourceVersion!==7&&asset.sourceVersion!==8&&asset.sourceVersion!==9&&asset.sourceVersion!==10)||!asset.originalProgram||asset.sourceSha256!==sourceSha256)return fail();
      const map=asset.glyphMap.find(m=>m.cid===cid);if(!map||map.nonPainting||map.unicode!==unicode)return fail();
      return canonicalJson([asset.originalProgram.pdfFontRef,asset.originalProgram.sha256,asset.sha256,map.originalCharCode,map.originalGlyphId,map.glyphId,map.fontChar,map.pdfWidth,unicode,operatorIndex,x,advance,baseline,size,color,spacing,...(asset.sourceVersion===9?[asset.originalCff.sha256]:[])]);
    };
    for(const [pageNumber,group] of wanted){
      const page=await pdf.getPage(pageNumber),viewport=page.getViewport({scale:1}).transform,actual=captureSourceRulePaint(await page.getOperatorList(),viewport,pageNumber,sourceSha256);
      for(const [operatorIndex,paint] of group)if(canonicalJson(actual.get(operatorIndex))!==canonicalJson(paint))fail();
      // Reuse the positive original Tf/CID/program/outline gate, never a claimed template coordinate.
      const originalAssets:SourceFontAsset[]=[],originalGlyphs=await captureSourceGlyphs(page,viewport,sourceSha256,originalAssets,bytes,pageNumber);if(!originalGlyphs)return fail();
      const actualFonts=new Map(originalAssets.map(f=>[f.id,f])),counts=new Map<string,number>();
      for(const glyph of originalGlyphs){const asset=actualFonts.get(glyph.fontId),map=asset?.glyphMap.find(m=>m.cid===glyph.cid);if(!asset||!('originalProgram'in asset)||(asset.sourceVersion!==4&&asset.sourceVersion!==5&&asset.sourceVersion!==6&&asset.sourceVersion!==7&&asset.sourceVersion!==8&&asset.sourceVersion!==9&&asset.sourceVersion!==10)||!map||map.nonPainting)continue;const key=signature(asset,glyph.cid,glyph.unicode,glyph.operatorIndex,glyph.x,glyph.advance,glyph.baseline,glyph.size,glyph.color,glyph.characterSpacing??0);counts.set(key,(counts.get(key)??0)+1);}
      const seen=new Set<string>();
      for(const proof of template.sourceRuleOverlaps){const region=template.pages[pageNumber-1].regions.find(r=>r.id===proof.glyph.regionId);if(!region)continue;if(region.kind!=='text'||!region.sourceLayout)return fail();
        const occurrence=canonicalJson([region.id,proof.glyph.glyphOrdinal]);if(seen.has(occurrence))continue;seen.add(occurrence);
        const glyph=sourceGlyphAt(region,proof.glyph.glyphOrdinal),graph=region.sourceLayout;if(graph.sourceSha256!==sourceSha256)return fail();
        const key=signature(fonts.get(glyph.fontId),glyph.cid,glyph.unicode,glyph.operatorIndex,glyph.x,glyph.advance,graph.baseline,graph.fontSize,region.style.color,graph.version===3?graph.characterSpacing:0),count=counts.get(key)??0;if(count<1)return fail();counts.set(key,count-1);
      }
    }
  }finally{await task.destroy();}
}
