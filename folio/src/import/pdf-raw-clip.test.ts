import {it,expect} from 'vitest';
import {traceScopedPaint,type RawClipCollector} from './pdf-scoped-paint';
import {originalOperators} from './pdf-image-trace';
import {rawClipTransformChain,rawClipReplayOperands,sourceClipLifetimePlan} from './pdf-atomic-paint';
import {canonicalJson} from '../core/model';
const owner={sourceSha256:'a'.repeat(64),pageNumber:1};
function capture(text:string,height=792){const collector:RawClipCollector={...owner,clips:new Map()},options={viewport:[1,0,0,-1,0,height],pageBounds:{x:0,y:0,width:612,height}},ops=originalOperators(text),plain=traceScopedPaint(ops,options),inventory=traceScopedPaint(ops,{...options,rawClipCollector:collector});expect(canonicalJson(inventory)).toBe(canonicalJson(plain));return{inventory,raw:collector.clips,by:new Map(inventory.occurrences.map((p,i)=>[i,p]))};}
const build=(c:ReturnType<typeof capture>)=>sourceClipLifetimePlan(c.inventory,c.by,c.raw,owner);
it.each([[18.59998,754.8,792],[100.1,101.2,700],[.1,.2,500]])('retains source fractional re y=%s h=%s without inverse conversion', (y,h,H)=>{const c=capture(`q 16.6 ${y} 578.8 ${h} re W n 20 30 1 1 re f Q`,H),p=build(c),raw=p[0].rawClips![0];expect(raw.operands).toEqual([16.6,y,578.8,h]);expect(rawClipTransformChain(raw,p[0].clips[0])).toEqual([]);if(H===792)expect(H-p[0].clips[0].bounds.y-p[0].clips[0].bounds.height).not.toBe(y);});
it('retains actual ordered cm chains and restores the construction state with q/Q',()=>{const c=capture('q .5 0 0 .5 3.1 4.2 cm q 2 0 0 2 5 6 cm 0 0 10 20 re W* n 0 0 1 1 re f Q 0 0 30 40 re W n 0 0 1 1 re f Q'),p=build(c);expect(rawClipTransformChain(p[0].rawClips![0],p[0].clips[0]).map(n=>n.operands)).toEqual([[.5,0,0,.5,3.1,4.2],[2,0,0,2,5,6]]);expect(rawClipTransformChain(p[1].rawClips![0],p[1].clips[0]).map(n=>n.operands)).toEqual([[.5,0,0,.5,3.1,4.2]]);expect(p[0].clips[0].fillRule).toBe('evenodd');});
it('current path survives temporary Q and following paint does not inherit its matrix',()=>{const a=capture('q q .5 0 0 .5 3 4 cm 10 20 100 200 re Q W n 20 40 2 3 re f Q'),p=build(a);expect(p[0].clips[0].bounds).toEqual({x:8,y:678,width:50,height:100});expect(a.inventory.occurrences[0]).toMatchObject({bounds:{x:20,y:749,width:2,height:3}});});
it('preserves negative extents and sibling identities with equal bounds',()=>{const c=capture('q 10 20 -5 -6 re W n 1 1 1 1 re f Q q 10 20 -5 -6 re W n 1 1 1 1 re f Q'),p=build(c);expect(p[0].rawClips![0].operands).toEqual([10,20,-5,-6]);expect(p[0].clips[0].clipOperatorIndex).not.toBe(p[1].clips[0].clipOperatorIndex);});
it('W+paint keeps old clip for painting and activates new clip only afterward',()=>{const c=capture('0 0 400 400 re W f 1 1 2 2 re f'),p=build(c);expect(p.map(x=>x.rawClips!.length)).toEqual([0,1]);expect(p[1].clips[0].pathOperatorIndex).toBe(0);});
it.each(['operand','viewport','source','page','key','missing','extra','chain'])('refuses raw witness %s tamper',kind=>{const c=capture('q 0 0 400 400 re W n 1 1 2 2 re f Q'),id=c.inventory.clips[0].clipOperatorIndex,raw=c.raw.get(id)!;if(kind==='missing')c.raw.delete(id);else if(kind==='extra')c.raw.set(999,raw);else{const bad={...raw,operands:[...raw.operands],viewport:[...raw.viewport]};if(kind==='operand')bad.operands[0]=1e-12;if(kind==='viewport')bad.viewport[5]+=1;if(kind==='source')bad.sourceSha256='b'.repeat(64);if(kind==='page')bad.pageNumber=2;if(kind==='key')bad.clipKey+=' ';if(kind==='chain')bad.chain={length:1,operatorIndex:0,operands:[1,0,0,1,1,0]};c.raw.set(id,bad);}expect(()=>build(c)).toThrow();});
it('refuses expanded work before accessing a hostile over-budget transform chain',()=>{const c=capture('q 0 0 400 400 re W n 1 1 2 2 re f Q'),id=c.inventory.clips[0].clipOperatorIndex;let touched=0;const chain={length:100000,get parent():never{touched++;throw Error('unreached');},operatorIndex:0,operands:[1,0,0,1,0,0]};c.raw.set(id,{...c.raw.get(id)!,chain});expect(()=>build(c)).toThrow();expect(touched).toBe(0);});
it('rejects cyclic or inconsistent chains within the bounded proof',()=>{const c=capture('q 1 0 0 1 0 0 cm 0 0 400 400 re W n 1 1 2 2 re f Q'),id=c.inventory.clips[0].clipOperatorIndex,raw=c.raw.get(id)!;const n:any={length:1,operatorIndex:0,operands:[1,0,0,1,0,0]};n.parent=n;c.raw.set(id,{...raw,chain:n});expect(()=>build(c)).toThrow();});
it('retains original empty-lifetime refusal',()=>{const c=capture('q 0 0 400 400 re W n Q 1 1 2 2 re f');expect(()=>build(c)).toThrow();});

it.each(['1 .1 0 1 0 0','0 0 0 1 0 0','1 0 0 1 1000001 0'])('retains unsupported transform refusal %s',matrix=>{expect(()=>capture(`q ${matrix} cm 0 0 10 10 re W n 1 1 1 1 re f Q`)).toThrow();});

const wide='-257698014 -257697254 515396064 515396064 re';
it.each(['W','W*'])('retains exact oversized %s construction while replaying its bounded page intersection',rule=>{
 const c=capture(`q ${wide} ${rule} n BT /F 12 Tf 1 0 0 1 40 648 Tm (a b c) Tj ET 1 0 0 rg 20 30 1 1 re f Q`),p=build(c),clip=p[0].clips[0],raw=p[0].rawClips![0];
 expect(clip.bounds).toEqual({x:0,y:0,width:612,height:792});expect(clip.pageCover).toEqual({version:'integer-page-cover-v1',operands:[-257698014,-257697254,515396064,515396064]});expect(raw.operands).toEqual(clip.pageCover!.operands);expect(rawClipTransformChain(raw,clip)).toEqual([]);expect(rawClipReplayOperands(raw,clip)).toEqual([0,0,612,792]);expect(p[1].clips[0]).toEqual(clip);expect(c.inventory.occurrences.map(x=>x.kind)).toEqual(['text','fillRect']);
});
it('retains nested partial clipping, page-cover lifetime and graphics restoration',()=>{
 const c=capture(`q ${wide} W n 0 0 1 1 re f q 20 30 40 50 re W* n 0 0 1 1 re f Q 0 0 1 1 re f Q 0 0 1 1 re f`),p=build(c);
 expect(p.map(x=>x.clips.length)).toEqual([1,2,1,0]);expect(c.inventory.occurrences[1].effectiveClip).toEqual({x:20,y:712,width:40,height:50});expect(c.inventory.occurrences[2].effectiveClip).toEqual({x:0,y:0,width:612,height:792});expect(p[1].clips[1].fillRule).toBe('evenodd');
});
it('retains reflected and signed source construction without emitting oversized geometry',()=>{
 const c=capture('q -1 0 0 1 612 0 cm 257698050 257698810 -515396064 -515396064 re W n 0 0 1 1 re f Q'),p=build(c),clip=p[0].clips[0],raw=p[0].rawClips![0];expect(rawClipTransformChain(raw,clip).map(x=>x.operands)).toEqual([[-1,0,0,1,612,0]]);expect(rawClipReplayOperands(raw,clip)).toEqual([612,792,-612,-792]);
});
it.each(['f','W f','S','n','W','W n 1 0 0 1 0 0 cm'])('refuses oversized painted or unfinished construction %s',ending=>{
 const text=ending==='W n 1 0 0 1 0 0 cm'?`q ${wide} 1 0 0 1 0 0 cm W n 0 0 1 1 re f Q`:`q ${wide} ${ending} Q`;expect(()=>capture(text)).toThrow();
});
it.each(['-.5 0 0 .5 0 0','1 .1 0 1 0 0'])('does not normalize an unsupported oversized construction transform %s',m=>expect(()=>capture(`q ${m} cm ${wide} W n 0 0 1 1 re f Q`)).toThrow());
it.each(['0 -2000000 2000000 4000000','-2000000 -2000000 2000001 4000000','9007199254740991 -2000000 10 4000000','-2000000.5 -2000000 4000000 4000000'])('refuses partial, unsafe or inexact oversized clip %s',args=>expect(()=>capture(`q ${args} re W n 0 0 1 1 re f Q`)).toThrow());
it.each(['certificate','operand','bounds','matrix'])('refuses oversized page-cover witness %s changes',kind=>{
 const c=capture(`q ${wide} W n 0 0 1 1 re f Q`),clip=c.inventory.clips[0],id=clip.clipOperatorIndex,raw=c.raw.get(id)!;
 if(kind==='certificate')clip.pageCover!.operands[0]+=1;if(kind==='operand')c.raw.set(id,{...raw,operands:[raw.operands[0]+1,...raw.operands.slice(1)]});if(kind==='bounds')clip.bounds.width-=1;if(kind==='matrix')clip.constructionCtm[4]=1;
 expect(()=>build(c)).toThrow();
});
