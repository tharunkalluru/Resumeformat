import {exactSourceTuple} from './source-graph';
import {FolioError} from './errors';
const tag='source-show-columns-v1';
const fail=():never=>{throw new FolioError('PROJECT_RECORD_TRANSPORT','Invalid bounded source spacing columns.');};
const dense=(v:unknown,max:number):v is unknown[]=>Array.isArray(v)&&v.length<=max&&exactSourceTuple(v,[v.length]);
/** Wire-only lossless dictionaries. Positions and advances keep their exact IEEE numbers. */
export function packSpacingGlyphs(value:unknown):unknown {
 if(!dense(value,100000)||!value.length)return fail();
 const strings:string[]=[],advances:number[]=[],shows:[number,unknown[][]][]=[],si=new Map<string,number>(),ai=new Map<number,number>();
 for(const raw of value){if(!exactSourceTuple(raw,[5]))return fail();const [cid,u,x,a,op]=raw as [number,string,number,number,number];let ui=si.get(u);if(ui===undefined){ui=strings.length;si.set(u,ui);strings.push(u);}let av=ai.get(a);if(av===undefined){av=advances.length;ai.set(a,av);advances.push(a);}let show=shows.at(-1);if(!show||show[0]!==op){show=[op,[]];shows.push(show);}show[1].push([cid,ui,x,av]);}
 return [tag,strings,advances,shows];
}
export function unpackSpacingGlyphs(value:unknown,budget:{glyphs:number}):unknown[] {
 if(!exactSourceTuple(value,[4])||value[0]!==tag||!dense(value[1],100000)||!dense(value[2],100000)||!dense(value[3],100000))return fail();
 const strings=value[1],advances=value[2],shows=value[3];
 if(!strings.length||!advances.length||!shows.length||strings.some(s=>typeof s!=='string'||!s.length||s.length>32)||advances.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>2000)||new Set(strings).size!==strings.length||new Set(advances).size!==advances.length)return fail();
 const result:unknown[][]=[];let previous=-1;const usedStrings=new Set<number>(),usedAdvances=new Set<number>();
 for(const show of shows){if(!exactSourceTuple(show,[2])||!Number.isSafeInteger(show[0])||(show[0] as number)<=previous||(show[0] as number)>100000||!dense(show[1],100000)||!show[1].length)return fail();previous=show[0] as number;
  for(const row of show[1]){if(++budget.glyphs>100000||!exactSourceTuple(row,[4]))return fail();const [cid,u,x,a]=row;if(!Number.isSafeInteger(cid)||(cid as number)<1||(cid as number)>65535||!Number.isSafeInteger(u)||(u as number)<0||(u as number)>=strings.length||typeof x!=='number'||!Number.isFinite(x)||!Number.isSafeInteger(a)||(a as number)<0||(a as number)>=advances.length)return fail();usedStrings.add(u as number);usedAdvances.add(a as number);result.push([cid,strings[u as number],x,advances[a as number],show[0]]);}
 }
 if(usedStrings.size!==strings.length||usedAdvances.size!==advances.length)return fail();return result;
}
