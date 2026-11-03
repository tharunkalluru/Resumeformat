import type {Path} from '@pdf-lib/fontkit';
import type {Rect} from '../core/model';
import {FolioError} from '../core/errors';

/** Maps source-local x/down-y to page coordinates; retained without snapping. */
export type SourceRotation = [number,number,number,number];
const fail=():never=>{throw new FolioError('PDF_SOURCE_ROTATION','The original right-angle text matrix cannot be proved.');};
export function rightAngleSourceBasis(matrix:readonly number[]):{basis:SourceRotation;scale:number}|undefined {
 if(matrix.length<4||!matrix.slice(0,4).every(Number.isFinite))return fail();
 const [a,b,c,d]=matrix,scale=Math.hypot(a,b);
 if(b===0)return undefined;
 if(!scale||scale>1000||Math.abs(a)>scale*1e-6||Math.abs(d)>scale*1e-6||b*c<=0||Math.abs(Math.hypot(c,d)-scale)>scale*1e-6||Math.abs(a*c+b*d)>scale*scale*1e-6)return fail();
 // Tiny original rotation residues are data, not errors to round away.
 return {basis:[a/scale,b/scale,-c/scale,-d/scale],scale};
}
export function validateSourceRotation(basis:readonly number[]):asserts basis is SourceRotation {
 if(basis.length!==4||!basis.every(Number.isFinite)||Math.abs(basis[0])>1e-6||Math.abs(basis[3])>1e-6||basis[1]*basis[2]>=0||Math.abs(Math.hypot(basis[0],basis[1])-1)>1e-12||Math.abs(Math.hypot(basis[2],basis[3])-1)>1e-6||Math.abs(basis[0]*basis[2]+basis[1]*basis[3])>1e-6)return fail();
}
export function sourceRotationPoint(basis:SourceRotation,x:number,y:number):[number,number]{validateSourceRotation(basis);if(!Number.isFinite(x)||!Number.isFinite(y))return fail();return [basis[0]*x+basis[2]*y,basis[1]*x+basis[3]*y];}
export function sourceRotationLocal(basis:SourceRotation,x:number,y:number):[number,number]{validateSourceRotation(basis);const det=basis[0]*basis[3]-basis[1]*basis[2];if(!Number.isFinite(x)||!Number.isFinite(y)||det<=0)return fail();return [(basis[3]*x-basis[2]*y)/det,(-basis[1]*x+basis[0]*y)/det];}
export function rotatedSourceInk(path:Path,basis:SourceRotation,x:number,baseline:number,scale:number):Rect {
 validateSourceRotation(basis);if(!Number.isFinite(scale)||scale<=0)return fail();
 const [px,py]=sourceRotationPoint(basis,x,baseline);
 // Pinned fontkit transform() overwrites x before computing y. Map both
 // coordinates from the original point instead; keep the exact curve extrema.
 const transformed=(path as Path & {mapPoints(fn:(x:number,y:number)=>[number,number]):Path}).mapPoints((x,y)=>[basis[0]*scale*x-basis[2]*scale*y+px,basis[1]*scale*x-basis[3]*scale*y+py]),box=transformed.bbox;
 if(![box.minX,box.minY,box.width,box.height].every(Number.isFinite))return fail();
 return {x:box.minX,y:box.minY,width:box.width,height:box.height};
}
