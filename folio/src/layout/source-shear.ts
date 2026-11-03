import type {Path,BoundingBox} from '@pdf-lib/fontkit';
import type {SourceTextLayout} from '../core/model';
import {FolioError} from '../core/errors';

export const MAX_SOURCE_X_SHEAR=1;
export const sourceShear=(layout:SourceTextLayout|undefined):number=>layout?.version===4?layout.shearX:0;
export const sourceCharacterSpacing=(layout:SourceTextLayout|undefined):number=>layout?.version===3||layout?.version===4?layout.characterSpacing:0;
/** A compact variable-spacing owner binds one page-point value per complete show. */
export function sourceShowCharacterSpacing(layout:SourceTextLayout|undefined,operator:number):number {
 if(layout?.version!==5)return sourceCharacterSpacing(layout);
 const pair=layout.showSpacing.find(p=>p[0]===operator);
 if(!pair||!Number.isFinite(pair[1]))throw new FolioError('SOURCE_FONT_GRAPH','Missing original show spacing ownership.');
 return pair[1];
}
/** Only horizontal source Tm shear. CTM rotation/shear and unequal scales stay refused. */
export function originalHorizontalShear(ctm:readonly number[],linear:readonly number[]):number {
 const x=ctm[0]*linear[0],y=ctm[3]*linear[3],shear=linear[2]/linear[0];
 if(ctm.length!==6||linear.length!==4||![...ctm,...linear,x,y,shear].every(Number.isFinite)||ctm[1]!==0||ctm[2]!==0||linear[1]!==0||x<=0||Math.abs(x-y)>.000001||Math.abs(shear)>MAX_SOURCE_X_SHEAR)throw new FolioError('PDF_TEXT_DECOMPOSITION','The source matrix has no supported horizontal shear decomposition.');
 return shear;
}
/** PDF.js's pinned Tm Float32 conversion also owns the retained graph's ratio. */
export const decompositionShear=(d:{ctm:readonly number[];linearTextMatrix:readonly number[]}):number=>originalHorizontalShear(d.ctm,d.linearTextMatrix.map(Math.fround));
/** Transform the actual outline before measuring extrema; do not shear a rectangle. */
export function sourceOutlineBox(path:Path,shear:number):BoundingBox {
 if(!Number.isFinite(shear)||Math.abs(shear)>MAX_SOURCE_X_SHEAR)throw new FolioError('SOURCE_FONT_GRAPH','Invalid retained source shear.');
 if(!shear)return path.bbox;
 // The pinned fontkit Path.transform returns a new path. Its public typings omit it.
 const transformed=(path as Path & {transform(a:number,b:number,c:number,d:number,e:number,f:number):Path}).transform(1,0,shear,1,0,0);
 const box=transformed.bbox;
 if(![box.minX,box.minY,box.maxX,box.maxY,box.width,box.height].every(Number.isFinite))throw new FolioError('SOURCE_FONT_GRAPH','The sheared source outline has no finite bounds.');
 return box;
}
