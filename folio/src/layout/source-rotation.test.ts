import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import {rightAngleSourceBasis,sourceRotationPoint,sourceRotationLocal,rotatedSourceInk,validateSourceRotation} from './source-rotation';
it.each([1,-1])('retains the exact quarter-turn direction %s',s=>{const r=rightAngleSourceBasis([0,s,s,0])!;expect(r.scale).toBe(1);expect(sourceRotationPoint(r.basis,12,30)).toEqual([-s*30,s*12]);expect(sourceRotationLocal(r.basis,...sourceRotationPoint(r.basis,12,30))).toEqual([12,30]);});
it('retains actual tiny matrix residues instead of snapping them away',()=>{const e=Math.fround(-4.4e-8),r=rightAngleSourceBasis([e,-1,-1,-e])!;expect(r.basis[0]).not.toBe(0);expect(sourceRotationPoint(r.basis,...sourceRotationLocal(r.basis,392.9,188.71))[0]).toBeCloseTo(392.9,12);});
it.each([[1,1,0,-1],[0,1,2,0],[0,1,-1,0],[0,0,0,0],[NaN,1,1,0]].map(m=>({m})))('rejects unsupported matrix $m',({m})=>{if(m.every(x=>x===0))expect(rightAngleSourceBasis(m)).toBeUndefined();else expect(()=>rightAngleSourceBasis(m)).toThrow();});
it('measures transformed outlines, including original font extrema',()=>{const f=fontkit.create(new Uint8Array(readFileSync('public/fonts/DejaVuSans.ttf'))),p=f.glyphForCodePoint(106).path,scale=12/f.unitsPerEm,b=rotatedSourceInk(p,[0,-1,1,0],40,90,scale),old=p.bbox;expect(b.x).toBeCloseTo(90-old.maxY*scale,12);expect(b.y).toBeCloseTo(-40-old.maxX*scale,12);expect(b.width).toBeCloseTo(old.height*scale,12);expect(b.height).toBeCloseTo(old.width*scale,12);});
it.each([[0,1,1,0],[0,2,-1,0],[0,1,-1],[0,1,-1,Infinity]].map(m=>({m})))('refuses forged basis $m',({m})=>expect(()=>validateSourceRotation(m)).toThrow());
