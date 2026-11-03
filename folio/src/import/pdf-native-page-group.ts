import {PDFBool,PDFDict,PDFName} from 'pdf-lib';
import {FolioError} from '../core/errors';
export interface NativePageGroup {S:'Transparency';CS:'DeviceRGB';Type?:'Group';I?:boolean;K?:false}
const fail=():never=>{throw new FolioError('PDF_PAGE_GROUP','The original page transparency group is outside the closed DeviceRGB contract.');};
export function captureNativePageGroup(page:PDFDict):NativePageGroup|undefined {
 if(!page.has(PDFName.of('Group')))return undefined;
 const d=page.lookupMaybe(PDFName.of('Group'),PDFDict);if(!d||d.entries().some(([k])=>!['Type','S','CS','I','K'].includes(k.decodeText()))||d.lookupMaybe(PDFName.of('S'),PDFName)?.decodeText()!=='Transparency'||d.lookupMaybe(PDFName.of('CS'),PDFName)?.decodeText()!=='DeviceRGB')return fail();
 const result:NativePageGroup={S:'Transparency',CS:'DeviceRGB'};
 if(d.has(PDFName.of('Type'))){if(d.lookupMaybe(PDFName.of('Type'),PDFName)?.decodeText()!=='Group')return fail();result.Type='Group';}
 for(const k of ['I','K'] as const)if(d.has(PDFName.of(k))){const value=d.lookupMaybe(PDFName.of(k),PDFBool);if(!value||k==='K'&&value.asBoolean())return fail();if(k==='K')result.K=false;else result.I=value.asBoolean();}
 return result;
}
