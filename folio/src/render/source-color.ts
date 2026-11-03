import {PDFDocument,PDFDict,PDFName,PDFNumber,PDFOperator,PDFOperatorNames,type PDFPage} from 'pdf-lib';
import {sha256Sync,type SourceColorProfile,type SourceScopedColor} from '../core/model';
import {FolioError} from '../core/errors';
import {validateRgbIccBytes} from '../import/pdf-icc';
export function installSourceColor(document:PDFDocument,page:PDFPage,color:SourceScopedColor,profile?:SourceColorProfile):PDFName|undefined{
 if(color.space!=='ICCBased')return;
 if(!profile||profile.pdfProfileRef!==color.profileRef||profile.sha256!==color.profileSha256||sha256Sync(profile.bytes)!==profile.sha256)throw new FolioError('PDF_ICC_PROOF','The original bounded RGB color profile, resource or paint ownership cannot be proved.');
 validateRgbIccBytes(profile.bytes);const resources=page.node.Resources()!,key=PDFName.of('FolioICC');let spaces=resources.lookupMaybe(PDFName.of('ColorSpace'),PDFDict);if(!spaces){spaces=document.context.obj({});resources.set(PDFName.of('ColorSpace'),spaces);}
 if(!spaces.has(key)){const ref=document.context.register(document.context.flateStream(profile.bytes,{N:3,...(profile.alternate?{Alternate:profile.alternate}:{})}));spaces.set(key,document.context.obj([PDFName.of('ICCBased'),ref]));}return key;
}
export function iccColorOperators(key:PDFName,components:number[],stroke=false):PDFOperator[]{
 if(components.length!==3||components.some(v=>!Number.isFinite(v)||v<0||v>1))throw new FolioError('PDF_ICC_PROOF','The original bounded RGB color profile, resource or paint ownership cannot be proved.');
 return[PDFOperator.of(stroke?PDFOperatorNames.StrokingColorspace:PDFOperatorNames.NonStrokingColorspace,[key]),PDFOperator.of(stroke?PDFOperatorNames.StrokingColorN:PDFOperatorNames.NonStrokingColorN,components.map(PDFNumber.of))];
}
