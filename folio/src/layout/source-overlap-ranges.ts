import {FolioError} from '../core/errors';
/** Exact consecutive ordinals only; gaps and primitive/region boundaries never coalesce. */
export class SourceOverlapRanges {
 private ranges=new Map<string,[number,number][]>();
 private count=0;
 get size():number{return this.count;}
 add(key:string):void{
  const [encoded,primitive]=JSON.parse(key),[region,ordinal]=JSON.parse(encoded),owner=JSON.stringify([region,primitive]);
  if(typeof region!=='string'||typeof primitive!=='string'||!Number.isSafeInteger(ordinal)||ordinal<0||ordinal>=100000)throw new FolioError('SOURCE_SCOPED_PAINT','Invalid source overlap ordinal.');
  const ranges=this.ranges.get(owner)??[],last=ranges.at(-1);
  if(last&&ordinal===last[1]+1)last[1]=ordinal;
  else {if(last&&ordinal<=last[1]||this.count>=1000)throw new FolioError('SOURCE_SCOPED_PAINT_LIMIT','Original scoped intersections exceed1000 exact ordinal ranges.');ranges.push([ordinal,ordinal]);this.count++;}
  this.ranges.set(owner,ranges);
 }
 has(key:string):boolean{
  const [encoded,primitive]=JSON.parse(key),[region,ordinal]=JSON.parse(encoded);
  return this.ranges.get(JSON.stringify([region,primitive]))?.some(([start,end])=>ordinal>=start&&ordinal<=end)??false;
 }
}
