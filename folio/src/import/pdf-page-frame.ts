import {PDFArray,PDFDocument,PDFName,PDFNumber,type PDFPage} from 'pdf-lib';
import {FolioError} from '../core/errors';
import type {SourcePageFrame} from '../core/model';

const fail=(detail:string):never=>{throw new FolioError('PDF_PAGE_FRAME','The original page frame cannot be proved: '+detail);};
type Box=[number,number,number,number];
function tuple(page:PDFPage,value:unknown):Box{
 if(!(value instanceof PDFArray)||value.size()!==4)return fail('four original box coordinates are required');
 const values=value.asArray().map(v=>page.doc.context.lookup(v));
 if(!values.every(v=>v instanceof PDFNumber&&Number.isFinite(v.asNumber())&&Math.abs(v.asNumber())<=1_000_000))return fail('invalid original box coordinates');
 const b=values.map(v=>(v as PDFNumber).asNumber()) as Box,w=b[2]-b[0],h=b[3]-b[1];
 if(!(w>0&&h>0&&w<=2000&&h<=2000))return fail('page dimensions exceed the existing bounds');
 return b;
}
/** Equal effective boxes only. Original operands and zero-origin routes stay intact. */
export function originalPageFrame(document:PDFDocument,pageNumber:number):SourcePageFrame{
 const page=document.getPages()[pageNumber-1];if(!page)return fail('missing page');
 const rotation=page.node.Rotate();if(rotation&&rotation.asNumber()!==0)return fail('rotation requires a separate contract');
 const unit=page.node.has(PDFName.of('UserUnit'))?page.node.lookup(PDFName.of('UserUnit')):undefined;if(unit!==undefined&&(!(unit instanceof PDFNumber)||unit.asNumber()!==1))return fail('page unit requires a separate contract');
 const mediaBox=tuple(page,page.node.MediaBox()),crop=page.node.CropBox(),boxes:SourcePageFrame['boxes']={MediaBox:mediaBox};
 if(crop)boxes.CropBox=tuple(page,crop);
 for(const key of ['TrimBox','BleedBox','ArtBox'] as const){const value=page.node.has(PDFName.of(key))?page.node.lookup(PDFName.of(key)):undefined;if(value!==undefined)boxes[key]=tuple(page,value);}
 for(const b of Object.values(boxes))if(b.some((n,i)=>n!==mediaBox[i]))return fail('effective boxes differ');
 const [left,bottom,right,top]=mediaBox;
 return {version:'original-equal-page-boxes-v1',boxes,viewport:[1,0,0,-1,left===0?0:-left,top],width:right-left,height:top-bottom};
}
export function translatedPageFrame(frame:SourcePageFrame):boolean{return frame.boxes.MediaBox[0]!==0||frame.boxes.MediaBox[1]!==0;}
