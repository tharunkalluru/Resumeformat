import {PDFDict,PDFArray,PDFName,PDFNumber,PDFDocument,PDFRef} from 'pdf-lib';
import {FolioError} from '../core/errors';
const fail=():never=>{throw new FolioError('PDF_COMPOSITE_FONT_METRICS','Original numeric font descriptor metrics need a closed bounded TrueType owner.');};
export type NativeDescriptorMetrics=Readonly<Record<string,number|readonly number[]>>;
export function captureNativeDescriptor(document:PDFDocument,fontRef:string):NativeDescriptorMetrics{
 const [n,g]=fontRef.split(' ').map(Number),font=document.context.lookup(PDFRef.of(n,g),PDFDict),children=font.lookup(PDFName.of('DescendantFonts'),PDFArray);if(children.size()!==1)return fail();return captureDescriptorFields(children.lookup(0,PDFDict).lookup(PDFName.of('FontDescriptor'),PDFDict));
}
export function captureSimpleNativeDescriptor(document:PDFDocument,fontRef:string):NativeDescriptorMetrics {
 const [n,g]=fontRef.split(' ').map(Number),font=document.context.lookup(PDFRef.of(n,g),PDFDict);if(font.lookupMaybe(PDFName.of('Subtype'),PDFName)?.decodeText()!=='TrueType')return fail();return captureDescriptorFields(font.lookup(PDFName.of('FontDescriptor'),PDFDict));
}
function captureDescriptorFields(descriptor:PDFDict):NativeDescriptorMetrics {const fields:Record<string,number|number[]>={};
 const numeric=['Flags','ItalicAngle','Ascent','Descent','CapHeight','XHeight','StemV','StemH','AvgWidth','MaxWidth','MissingWidth','Leading','FontWeight'];
 if(descriptor.keys().some(k=>!['Type','FontName','FontFile2','FontBBox',...numeric].includes(k.decodeText())))return fail();if(descriptor.lookupMaybe(PDFName.of('Type'),PDFName)?.decodeText()!=='FontDescriptor'||!descriptor.lookupMaybe(PDFName.of('FontName'),PDFName))return fail();
 for(const key of numeric){if(!descriptor.has(PDFName.of(key)))continue;const value=descriptor.lookupMaybe(PDFName.of(key),PDFNumber)?.asNumber();if(value===undefined||!Number.isFinite(value)||Math.abs(value)>1000000||key==='Flags'&&(!Number.isInteger(value)||value<0||value>0x7fffffff))return fail();fields[key]=value;}
 const box=descriptor.lookupMaybe(PDFName.of('FontBBox'),PDFArray);if(!box||box.size()!==4)return fail();fields.FontBBox=box.asArray().map((_,i)=>{const n=box.lookupMaybe(i,PDFNumber)?.asNumber();if(n===undefined||!Number.isFinite(n)||Math.abs(n)>1000000)return fail();return n;});return fields;
}
export function installNativeDescriptor(document:PDFDocument,fontRef:PDFRef,metrics:NativeDescriptorMetrics):void{
 const descriptor=document.context.lookup(fontRef,PDFDict).lookup(PDFName.of('DescendantFonts'),PDFArray).lookup(0,PDFDict).lookup(PDFName.of('FontDescriptor'),PDFDict);
 for(const key of ['Flags','ItalicAngle','Ascent','Descent','CapHeight','XHeight','StemV','StemH','AvgWidth','MaxWidth','MissingWidth','Leading','FontWeight','FontBBox']){const value=metrics[key];if(value!==undefined)descriptor.set(PDFName.of(key),typeof value==='number'?document.context.obj(value):document.context.obj(Array.from(value)));else descriptor.delete(PDFName.of(key));}
}
