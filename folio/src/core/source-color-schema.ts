import {MAX_SOURCE_PAGES} from './model';
import {z} from 'zod';
import {exactSourceTuple} from './source-graph';
import {pageCoveringClipOperands} from './source-clip-domain';
const number=z.number().finite(),op=number.int().min(0).max(100000),hash=z.string().regex(/^[a-f0-9]{64}$/),ref=z.string().regex(/^\d+ \d+ R$/).max(64);
const rect=z.strictObject({x:number,y:number,width:number.min(0).max(5000),height:number.min(0).max(5000)});
export const scopedColorSchema=z.union([
 z.strictObject({space:z.enum(['DeviceRGB','DeviceGray']),components:z.array(number.min(0).max(1)).min(1).max(3)}).refine(c=>c.components.length===(c.space==='DeviceGray'?1:3)),
 z.strictObject({space:z.literal('ICCBased'),components:z.array(number.min(0).max(1)).length(3),resourceName:z.string().min(1).max(128),profileRef:ref,profileSha256:hash,selectionOperatorIndex:op,componentsOperatorIndex:op.nullable(),componentOperator:z.enum(['sc','scn','default']),renderingIntent:z.literal('RelativeColorimetric')}).refine(c=>(c.componentOperator==='default')===(c.componentsOperatorIndex===null))
]);
export const rectanglePathSchema=z.strictObject({version:z.literal('closed-axis-rectangle-v1'),operatorIndices:z.array(op).length(5),points:z.array(z.array(number).length(2)).length(4),constructionCtm:z.array(number).length(6),fillRule:z.enum(['nonzero','evenodd'])});
const scopedV2Clip=z.strictObject({pathOperatorIndex:op,clipOperatorIndex:op,endOperatorIndex:op,fillRule:z.enum(['nonzero','evenodd']),constructionCtm:z.array(number).length(6),bounds:rect,pageCover:z.strictObject({version:z.literal('integer-page-cover-v1'),operands:z.array(number.refine(Number.isSafeInteger)).length(4)}).optional()}).refine(c=>!c.pageCover||!!pageCoveringClipOperands(c.pageCover.operands,c.constructionCtm,c.bounds));
export const scopedV2Schema=z.strictObject({version:z.literal('source-scoped-occurrence-v2'),kind:z.enum(['text','fillRect','strokeRule']),sourceSha256:hash,pageNumber:number.int().min(1).max(MAX_SOURCE_PAGES),rawOperatorIndex:op,operatorIndex:op,color:scopedColorSchema,clipStack:z.array(scopedV2Clip).max(64),effectiveClip:rect,stateHash:hash,strokeAdjustment:z.literal(true).optional(),zeroFill:z.literal(true).optional(),appleAA:z.boolean().optional(),rectanglePath:rectanglePathSchema.optional(),derivedGaps:z.strictObject({version:z.literal('pinned-extractor-gap-v1'),count:number.int().min(1).max(100000)}).optional()}).refine(paint=>(!paint.strokeAdjustment||paint.kind==='strokeRule')&&(!paint.zeroFill||paint.kind==='fillRect'));
export const scopedV3Schema=z.strictObject({
 version:z.literal('source-scoped-occurrence-v3'),kind:z.literal('text'),sourceSha256:hash,
 pageNumber:number.int().min(1).max(MAX_SOURCE_PAGES),rawOperatorIndex:op,operatorIndex:op,
 color:scopedColorSchema.refine(color=>color.space!=='ICCBased'),clipStack:z.array(scopedV2Clip).max(64),
 effectiveClip:rect,stateHash:hash,appleAA:z.boolean().optional(),
 derivedGaps:z.strictObject({version:z.literal('pinned-extractor-gap-v1'),count:number.int().min(1).max(100000)}).optional(),
 showGroup:z.strictObject({version:z.literal('homogeneous-source-shows-v1'),operators:z.array(z.tuple([op,op])).min(2).max(100000)})
}).refine(paint=>paint.showGroup.operators[0][0]===paint.operatorIndex&&paint.showGroup.operators[0][1]===paint.rawOperatorIndex&&paint.showGroup.operators.every((pair,i,list)=>i===0||pair[0]>list[i-1][0]&&pair[1]>list[i-1][1]));
export const scopedV4Schema=z.strictObject({
 version:z.enum(['source-scoped-occurrence-v4','source-scoped-occurrence-v5']),kind:z.literal('text'),sourceSha256:hash,
 pageNumber:number.int().min(1).max(MAX_SOURCE_PAGES),rawOperatorIndex:op,operatorIndex:op,
 color:scopedColorSchema,clipStack:z.array(scopedV2Clip).max(64),
 effectiveClip:rect,stateHash:hash,appleAA:z.boolean().optional(),
 derivedGaps:z.strictObject({version:z.literal('pinned-extractor-gap-v1'),count:number.int().min(1).max(100000)}).optional(),
 showGroup:z.strictObject({version:z.literal('homogeneous-source-shows-v1'),operators:z.array(z.tuple([op,op])).min(2).max(100000)})
}).refine(paint=>paint.showGroup.operators[0][0]===paint.operatorIndex&&paint.showGroup.operators[0][1]===paint.rawOperatorIndex&&paint.showGroup.operators.every((pair,i,list)=>i===0||pair[0]>list[i-1][0]&&pair[1]>list[i-1][1]));
export const sourceColorProfileSchema=z.strictObject({version:z.literal('original-icc-rgb-v1'),sourceSha256:hash,pdfProfileRef:ref,encodedSha256:hash,encodedLength:number.int().min(1).max(65536),sha256:hash,bytes:z.instanceof(Uint8Array).refine(b=>b.length>=132&&b.length<=65536),N:z.literal(3),filter:z.literal('FlateDecode').nullable(),alternate:z.literal('DeviceRGB').nullable()});

/** Bound nested arrays before Zod constructs its validated object graph. */
export function validScopedV2(value:unknown):boolean{
 const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null)&&Reflect.ownKeys(v).every(k=>typeof k==='string');
 const array=(v:unknown,max:number)=>Array.isArray(v)&&v.length<=max&&exactSourceTuple(v,[v.length]);
 if(!object(value)||!object(value.color)||!array(value.color.components,3)||!array(value.clipStack,64))return false;
 for(const clip of value.clipStack as unknown[]){if(!object(clip)||!array(clip.constructionCtm,6)||!object(clip.bounds)||Object.hasOwn(clip,'pageCover')&&clip.pageCover===undefined)return false;if(clip.pageCover!==undefined&&(!object(clip.pageCover)||!array(clip.pageCover.operands,4)))return false;}
 if(!object(value.effectiveClip))return false;
 for(const key of ['rectanglePath','derivedGaps','strokeAdjustment','zeroFill','appleAA','showGroup'])if(Object.hasOwn(value,key)&&value[key]===undefined)return false;
 if(value.rectanglePath!==undefined){const path=value.rectanglePath;if(!object(path)||!array(path.operatorIndices,5)||!array(path.constructionCtm,6)||!array(path.points,4)||(path.points as unknown[]).some(point=>!array(point,2)))return false;}
 if(value.derivedGaps!==undefined&&!object(value.derivedGaps))return false;
 if(value.version==='source-scoped-occurrence-v3'||['source-scoped-occurrence-v4','source-scoped-occurrence-v5'].includes(String(value.version))){
  if(!object(value.showGroup)||!array(value.showGroup.operators,100000)||(value.showGroup.operators as unknown[]).some(pair=>!array(pair,2)))return false;
  return (['source-scoped-occurrence-v4','source-scoped-occurrence-v5'].includes(String(value.version))?scopedV4Schema:scopedV3Schema).safeParse(value).success;
 }
 return scopedV2Schema.safeParse(value).success;
}
