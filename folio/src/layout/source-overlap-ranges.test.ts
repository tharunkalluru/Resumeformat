import {it,expect} from 'vitest';
import {SourceOverlapRanges} from './source-overlap-ranges';
const key=(n:number,r='r',p='p')=>JSON.stringify([JSON.stringify([r,n]),p]);
it('compacts exact consecutive pairs without admitting absent ordinals or other owners',()=>{const r=new SourceOverlapRanges();for(let i=0;i<1500;i++)r.add(key(i));r.add(key(1502));expect(r.size).toBe(2);expect(r.has(key(1499))).toBe(true);expect(r.has(key(1501))).toBe(false);expect(r.has(key(1,'other'))).toBe(false);expect(r.has(key(1,'r','other'))).toBe(false);});
it('retains a strict 1000-range bound and rejects duplicate/out-of-order additions',()=>{const r=new SourceOverlapRanges();for(let i=0;i<1000;i++)r.add(key(i*2));expect(()=>r.add(key(2000))).toThrow();expect(()=>r.add(key(0))).toThrow();});
