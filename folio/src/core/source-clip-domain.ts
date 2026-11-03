import type {Rect} from './model';

/** Exact page-domain equivalence for an oversized, integer, unit-axis clip.
 * This does not admit a painted path, general transform, partial or empty clip.
 * All integer operations stay within their exact IEEE-754 range; no tolerance,
 * coordinate clamping or larger ordinary geometry budget is involved.
 */
export function pageCoveringClipOperands(raw:readonly number[],ctm:readonly number[],page:Rect):readonly number[]|undefined {
 if(raw.length!==4||!raw.every(Number.isSafeInteger)||raw.every(n=>Math.abs(n)<=1e6)||ctm.length!==6||!ctm.every(Number.isSafeInteger)||Math.abs(ctm[0])!==1||Math.abs(ctm[3])!==1||ctm[1]!==0||ctm[2]!==0||Math.abs(ctm[4])>1e6||Math.abs(ctm[5])>1e6||page.x!==0||page.y!==0||![page.width,page.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=5000))return;
 const [x,y,w,h]=raw,ends=[x+w,y+h];if(!ends.every(Number.isSafeInteger)||w===0||h===0)return;
 const a=[ctm[0]*x+ctm[4],ctm[3]*y+ctm[5]],b=[ctm[0]*ends[0]+ctm[4],ctm[3]*ends[1]+ctm[5]];
 if(![...a,...b].every(Number.isSafeInteger)||Math.min(a[0],b[0])>=0||Math.min(a[1],b[1])>=0||Math.max(a[0],b[0])<=page.width||Math.max(a[1],b[1])<=page.height)return;
 const p=[-ctm[4]/ctm[0],-ctm[5]/ctm[3]],q=[(page.width-ctm[4])/ctm[0],(page.height-ctm[5])/ctm[3]],result=[w>0?Math.min(p[0],q[0]):Math.max(p[0],q[0]),h>0?Math.min(p[1],q[1]):Math.max(p[1],q[1]),Math.sign(w)*page.width,Math.sign(h)*page.height];
 if(!result.every(n=>Number.isSafeInteger(n)&&Math.abs(n)<=1e6))return;
 return Object.freeze(result.map(n=>n===0?0:n));
}

/** Fractional page extents, with the exact canonical PDF-to-page viewport only.
 * Containment is proved in source coordinates: all oversized endpoints are safe
 * integers and the unchanged page bounds are finite. No large transformed float
 * subtraction, tolerance, inverse transform, or ordinary-budget expansion. */
export function fractionalPageCoveringClipOperands(raw:readonly number[],ctm:readonly number[],page:Rect):readonly number[]|undefined {
 if(raw.length!==4||!raw.every(Number.isSafeInteger)||raw.every(n=>Math.abs(n)<=1e6)||page.x!==0||page.y!==0||![page.width,page.height].every(n=>Number.isFinite(n)&&n>0&&n<=5000)||[page.width,page.height].every(Number.isSafeInteger)||ctm.length!==6||ctm.some((n,i)=>n!==[1,0,0,-1,0,page.height][i]))return;
 const [x,y,w,h]=raw,ex=x+w,ey=y+h;if(!Number.isSafeInteger(ex)||!Number.isSafeInteger(ey)||w===0||h===0||Math.min(x,ex)>=0||Math.min(y,ey)>=0||Math.max(x,ex)<=page.width||Math.max(y,ey)<=page.height)return;
 return Object.freeze([w>0?0:page.width,h>0?0:page.height,Math.sign(w)*page.width,Math.sign(h)*page.height]);
}
export function versionedPageCoveringClipOperands(version:'integer-page-cover-v1'|'fractional-page-cover-v2',raw:readonly number[],ctm:readonly number[],page:Rect):readonly number[]|undefined {
 return version==='integer-page-cover-v1'?pageCoveringClipOperands(raw,ctm,page):version==='fractional-page-cover-v2'?fractionalPageCoveringClipOperands(raw,ctm,page):undefined;
}
