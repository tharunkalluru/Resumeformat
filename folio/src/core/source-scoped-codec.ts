import {MAX_SOURCE_PAGES} from './model';
import {validScopedV2} from './source-color-schema';
import {FolioError} from './errors';
import {exactSourceTuple} from './source-graph';
import type {Rect,SourceScopedClip,SourceScopedPaint} from './model';

const TAG='scoped-paint-tuple-v1';
const fail=():never=>{throw new FolioError('SOURCE_SCOPED_TRANSPORT','The scoped source metadata has an invalid or oversized transport encoding.');};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const keys=(v:unknown,required:readonly string[],optional:readonly string[]=[]):v is Record<string,unknown>=>record(v)&&required.every(k=>Object.hasOwn(v,k))&&Reflect.ownKeys(v).every(k=>typeof k==='string'&&(required.includes(k)||optional.includes(k)));
const integer=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const paintKind=(v:unknown)=>v==='text'||v==='fillRect'||v==='strokeRule';
const array=(v:unknown,max:number):v is unknown[]=>Array.isArray(v)&&v.length<=max&&exactSourceTuple(v,[v.length]);
const rectTuple=(v:unknown):v is [number,number,number,number]=>exactSourceTuple(v,[4])&&v.every(finite)&&v[2]>=0&&v[2]<=5000&&v[3]>=0&&v[3]<=5000;
const colorTuple=(v:unknown):v is ['DeviceRGB'|'DeviceGray',number[]]=>exactSourceTuple(v,[2])&&(v[0]==='DeviceRGB'||v[0]==='DeviceGray')&&exactSourceTuple(v[1],[v[0]==='DeviceRGB'?3:1])&&v[1].every(n=>finite(n)&&n>=0&&n<=1);
const rectObject=(v:unknown)=>keys(v,['x','y','width','height'])&&finite(v.x)&&finite(v.y)&&finite(v.width)&&v.width>=0&&v.width<=5000&&finite(v.height)&&v.height>=0&&v.height<=5000;
const colorObject=(v:unknown)=>keys(v,['space','components'])&&(v.space==='DeviceRGB'||v.space==='DeviceGray')&&exactSourceTuple(v.components,[v.space==='DeviceRGB'?3:1])&&v.components.every(n=>finite(n)&&n>=0&&n<=1);
const clipTuple=(v:unknown):v is [number,number,number,'nonzero'|'evenodd',number[],[number,number,number,number]]=>exactSourceTuple(v,[6])&&integer(v[0],0,100000)&&integer(v[1],0,100000)&&integer(v[2],0,100000)&&(v[3]==='nonzero'||v[3]==='evenodd')&&exactSourceTuple(v[4],[6])&&v[4].every(finite)&&rectTuple(v[5]);
const bounds=(v:Rect):[number,number,number,number]=>[v.x,v.y,v.width,v.height];
const rect=(v:[number,number,number,number]):Rect=>({x:v[0],y:v[1],width:v[2],height:v[3]});
const packedClip=(v:SourceScopedClip)=>[v.pathOperatorIndex,v.clipOperatorIndex,v.endOperatorIndex,v.fillRule,[...v.constructionCtm],bounds(v.bounds)];
const packedPaint=(v:SourceScopedPaint)=>[TAG,v.kind,v.sourceSha256,v.pageNumber,v.rawOperatorIndex,v.operatorIndex,[v.color.space,[...v.color.components]],v.clipStack.map(packedClip),bounds(v.effectiveClip),v.stateHash,v.derivedGaps?.count??0];

/** Validation has no allocation proportional to a decoded clip or glyph graph. */
function validateTuple(value:unknown):asserts value is unknown[]{
 if(!exactSourceTuple(value,[11])||value[0]!==TAG||!paintKind(value[1])||!hash(value[2])||!integer(value[3],1,MAX_SOURCE_PAGES)||!integer(value[4],0,100000)||!integer(value[5],0,100000)||!colorTuple(value[6])||!array(value[7],64)||!value[7].every(clipTuple)||!rectTuple(value[8])||!hash(value[9])||!integer(value[10],0,100000))fail();
}
function validateFull(value:unknown):asserts value is SourceScopedPaint{
 if(record(value)&&['source-scoped-occurrence-v2','source-scoped-occurrence-v3','source-scoped-occurrence-v4','source-scoped-occurrence-v5'].includes(String(value.version))){if(!validScopedV2(value))return fail();return;}
 if(!keys(value,['version','kind','sourceSha256','pageNumber','rawOperatorIndex','operatorIndex','color','clipStack','effectiveClip','stateHash'],['derivedGaps']))return fail();
 if(value.version!=='source-scoped-occurrence-v1'||!paintKind(value.kind)||!hash(value.sourceSha256)||!integer(value.pageNumber,1,MAX_SOURCE_PAGES)||!integer(value.rawOperatorIndex,0,100000)||!integer(value.operatorIndex,0,100000)||!colorObject(value.color)||!rectObject(value.effectiveClip)||!hash(value.stateHash)||!array(value.clipStack,64))return fail();
 for(const clip of value.clipStack)if(!keys(clip,['pathOperatorIndex','clipOperatorIndex','endOperatorIndex','fillRule','constructionCtm','bounds'])||!integer(clip.pathOperatorIndex,0,100000)||!integer(clip.clipOperatorIndex,0,100000)||!integer(clip.endOperatorIndex,0,100000)||(clip.fillRule!=='nonzero'&&clip.fillRule!=='evenodd')||!exactSourceTuple(clip.constructionCtm,[6])||!clip.constructionCtm.every(finite)||!rectObject(clip.bounds))return fail();
 if(value.derivedGaps!==undefined&&(!keys(value.derivedGaps,['version','count'])||value.derivedGaps.version!=='pinned-extractor-gap-v1'||!integer(value.derivedGaps.count,1,100000)))return fail();
}
function unpackPaint(value:unknown):SourceScopedPaint{
 validateTuple(value);const [_,kind,sourceSha256,pageNumber,rawOperatorIndex,operatorIndex,color,clips,effectiveClip,stateHash,count]=value as [string,SourceScopedPaint['kind'],string,number,number,number,['DeviceRGB'|'DeviceGray',number[]],Parameters<typeof clipTuple>[0][],[number,number,number,number],string,number];
 return {version:'source-scoped-occurrence-v1',kind,sourceSha256,pageNumber,rawOperatorIndex,operatorIndex,color:{space:color[0],components:[...color[1]]},clipStack:clips.map(c=>{if(!clipTuple(c))return fail();return {pathOperatorIndex:c[0],clipOperatorIndex:c[1],endOperatorIndex:c[2],fillRule:c[3],constructionCtm:[...c[4]],bounds:rect(c[5])};}),effectiveClip:rect(effectiveClip),stateHash,...(count?{derivedGaps:{version:'pinned-extractor-gap-v1',count}}:{})};
}

function transform(value:unknown,pack:boolean):unknown{
 if(!record(value)||!record(value.template)||!Array.isArray(value.template.pages))return value;
 const pages=value.template.pages;let mode:'full'|'tuple'|undefined,paintCount=0,clipCount=0,glyphCount=0,showCount=0;
 if(!pages.some(page=>record(page)&&Array.isArray(page.regions)&&page.regions.some(region=>record(region)&&region.sourceScopedPaint!==undefined)))return value;
 if(value.template.sourceFonts!==undefined){if(!array(value.template.sourceFonts,32))return fail();let maps=0;for(const font of value.template.sourceFonts){if(!record(font)||!Array.isArray(font.glyphMap))return fail();maps+=font.glyphMap.length+(Array.isArray(font.shapeMap)?font.shapeMap.length:0);if(maps>100000)return fail();}}
 // Preflight the whole bounded metadata before constructing decoded records.
 if(!array(pages,MAX_SOURCE_PAGES))return fail();let regionCount=0;
 for(const page of pages){if(!record(page)||!array(page.regions,1000))return fail();regionCount+=page.regions.length;if(regionCount>1000)return fail();
  for(const region of page.regions){if(!record(region))return fail();if(record(region.sourceLayout)&&Array.isArray(region.sourceLayout.glyphs)){glyphCount+=region.sourceLayout.glyphs.length;if(glyphCount>100000)return fail();}
   const paint=region.sourceScopedPaint;if(paint===undefined)continue;if(record(paint)&&['source-scoped-occurrence-v2','source-scoped-occurrence-v3','source-scoped-occurrence-v4','source-scoped-occurrence-v5'].includes(String(paint.version))){validateFull(paint);showCount+=paint.showGroup?.operators.length??1;if(showCount>100000)return fail();clipCount+=paint.clipStack.length*Math.max(1,paint.showGroup?.operators.length??1);if(++paintCount>1000||clipCount>100000)return fail();continue;}const next=Array.isArray(paint)?'tuple':'full';if(mode&&mode!==next||pack&&next!=='full')return fail();mode=next;if(++paintCount>1000)return fail();if(next==='tuple'){validateTuple(paint);if(++showCount>100000)return fail();clipCount+=(paint[7] as unknown[]).length;}else{validateFull(paint);showCount+=paint.showGroup?.operators.length??1;if(showCount>100000)return fail();clipCount+=paint.clipStack.length*Math.max(1,paint.showGroup?.operators.length??1);}if(clipCount>100000)return fail();
  }
 }
 if(!mode||!pack&&mode==='full')return value;
 return {...value,template:{...value.template,pages:pages.map(page=>{const p=page as Record<string,unknown>;return {...p,regions:(p.regions as Record<string,unknown>[]).map(region=>region.sourceScopedPaint===undefined||record(region.sourceScopedPaint)&&['source-scoped-occurrence-v2','source-scoped-occurrence-v3','source-scoped-occurrence-v4','source-scoped-occurrence-v5'].includes(String(region.sourceScopedPaint.version))?region:{...region,sourceScopedPaint:pack?packedPaint(region.sourceScopedPaint as SourceScopedPaint):unpackPaint(region.sourceScopedPaint)})};})}};
}
/** JSON transport only. Runtime source evidence and hashes remain full objects. */
export const packScopedMetadata=(value:unknown):unknown=>transform(value,true);
/** Call after the existing serialized byte cap and before schema/source validation. */
export const unpackScopedMetadata=(value:unknown):unknown=>transform(value,false);
