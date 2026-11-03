import {describe,it,expect} from 'vitest';
import type {Rect} from './model';
import {fractionalPageCoveringClipOperands,pageCoveringClipOperands} from './source-clip-domain';

const page:Rect={x:0,y:0,width:595.25,height:841.875};
const viewport=(p:Rect):number[]=>[1,0,0,-1,0,p.height];
const raw=[-2_000_000,-3_000_000,4_000_000,6_000_000];
const prove=(r:readonly number[]=raw,c:readonly number[]=viewport(page),p:Rect=page)=>fractionalPageCoveringClipOperands(r,c,p);

describe('fractional page-cover proof',()=>{
 it('derives the exact bounded fractional rectangle without changing caller-owned data',()=>{
  const operands=[...raw],matrix=viewport(page),frame={...page};
  const result=prove(operands,matrix,frame);
  expect(result).toEqual([0,0,page.width,page.height]);expect(Object.isFrozen(result)).toBe(true);
  operands[0]=0;matrix[0]=2;frame.width=100;
  expect(result).toEqual([0,0,page.width,page.height]);expect(raw[0]).toBe(-2_000_000);
 });
 it('preserves all four construction orientations while covering the same source domain',()=>{
  for(const sx of [1,-1])for(const sy of [1,-1]){
   const source=[sx>0?-2_000_000:2_000_000,sy>0?-3_000_000:3_000_000,sx*4_000_000,sy*6_000_000];
   const result=prove(source)!;
   expect(result).toEqual([sx>0?0:page.width,sy>0?0:page.height,sx*page.width,sy*page.height]);
   expect([Math.min(result[0],result[0]+result[2]),Math.min(result[1],result[1]+result[3]),Math.max(result[0],result[0]+result[2]),Math.max(result[1],result[1]+result[3])]).toEqual([0,0,page.width,page.height]);
  }
 });
 it('proves far safe-integer endpoints in source coordinates without transformed cancellation',()=>{
  expect(prove([-4_000_000_000_000_000,-4_000_000_000_000_000,8_000_000_000_000_000,8_000_000_000_000_000])).toEqual([0,0,page.width,page.height]);
 });
 it('keeps integer and fractional proof versions disjoint',()=>{
  const integer={...page,width:600,height:842};
  expect(pageCoveringClipOperands(raw,viewport(integer),integer)).toEqual([0,0,600,842]);
  expect(prove(raw,viewport(integer),integer)).toBeUndefined();
  expect(pageCoveringClipOperands(raw,viewport(page),page)).toBeUndefined();
 });
 it('admits either fractional dimension independently and preserves the existing maximum page extent',()=>{
  for(const p of [{...page,width:600},{...page,height:842},{...page,width:5000}])expect(prove(raw,viewport(p),p)).toEqual([0,0,p.width,p.height]);
 });
 it('refuses ordinary, degenerate, partial and disjoint rectangles rather than clamping them',()=>{
  for(const source of [
   [-1,-1,1000,1000],[-2_000_000,-3_000_000,0,6_000_000],[-2_000_000,-3_000_000,4_000_000,0],
   [-2_000_000,-3_000_000,2_000_595,6_000_000],[-2_000_000,-3_000_000,4_000_000,3_000_841],
   [2_000_000,-3_000_000,4_000_000,6_000_000],[-2_000_000,3_000_000,4_000_000,6_000_000],
  ])expect(prove(source)).toBeUndefined();
 });
 it('requires strict overshoot on every edge, including an integer edge on a fractional page',()=>{
  for(const source of [[0,-3_000_000,4_000_000,6_000_000],[-2_000_000,0,4_000_000,6_000_000]])expect(prove(source)).toBeUndefined();
  const integerWidth={...page,width:600},integerHeight={...page,height:842};
  expect(prove([-2_000_000,-3_000_000,2_000_600,6_000_000],viewport(integerWidth),integerWidth)).toBeUndefined();
  expect(prove([-2_000_000,-3_000_000,4_000_000,3_000_842],viewport(integerHeight),integerHeight)).toBeUndefined();
 });
 it('refuses unsafe raw operands and unsafe integer endpoint sums',()=>{
  for(const value of [NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER+1,-Number.MAX_SAFE_INTEGER-1,.5]){
   for(let i=0;i<4;i++){const source=[...raw];source[i]=value;expect(prove(source)).toBeUndefined();}
  }
  expect(prove([-1,-3_000_000,Number.MAX_SAFE_INTEGER,6_000_000])).toEqual([0,0,page.width,page.height]);
  expect(prove([-Number.MAX_SAFE_INTEGER,-3_000_000,-1,6_000_000])).toBeUndefined();
  expect(prove([-2_000_000,Number.MAX_SAFE_INTEGER,4_000_000,1])).toBeUndefined();
 });
 it('requires the exact canonical viewport and rejects translation, scale, reflection, shear or rotation',()=>{
  const c=viewport(page);
  for(const changed of [
   [2,0,0,-1,0,page.height],[1,0,0,-2,0,page.height],[-1,0,0,-1,0,page.height],[1,0,0,1,0,page.height],
   [1,.0000000001,0,-1,0,page.height],[1,0,.0000000001,-1,0,page.height],[0,1,-1,0,0,page.height],
   [1,0,0,-1,.0000000001,page.height],[1,0,0,-1,0,page.height+.0000000001],
  ])expect(prove(raw,changed)).toBeUndefined();
  for(const value of [NaN,Infinity,-Infinity])for(let i=0;i<c.length;i++){const changed=[...c];changed[i]=value;expect(prove(raw,changed)).toBeUndefined();}
 });
 it('refuses changed page origins and invalid or over-budget dimensions',()=>{
  for(const p of [{...page,x:1},{...page,y:1},{...page,width:0},{...page,height:-1},{...page,width:5000.25},{...page,height:5001},{...page,width:NaN},{...page,height:Infinity}])expect(prove(raw,viewport(p),p)).toBeUndefined();
 });
 it('refuses malformed operand and matrix arities',()=>{
  for(const source of [[],raw.slice(0,3),[...raw,0]])expect(prove(source)).toBeUndefined();
  for(const c of [[],viewport(page).slice(0,5),[...viewport(page),0]])expect(prove(raw,c)).toBeUndefined();
 });
});
