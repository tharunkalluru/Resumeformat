import {MAX_SOURCE_PAGES} from '../core/model';
import {PDFArray,PDFDict,PDFDocument,PDFName,PDFRef} from 'pdf-lib';
import {canonicalJson,MAX_SOURCE_BYTES,sha256Sync,type SourceFontAsset,type Template} from '../core/model';
import {FolioError} from '../core/errors';
import {originalPageContent,originalOperators,originalDirectImageResources} from './pdf-image-trace';
import {originalTfEvents} from './pdf-original-tt';
import {licensedSubsetStreamBytes} from './pdf-catalogue-subset';

const fail=():never=>{throw new FolioError('PDF_LICENSED_SUBSET','The retained source does not prove this licensed subset and its complete original occurrence inventory.');};
const named=(d:PDFDict,k:string,n:string)=>d.lookupMaybe(PDFName.of(k),PDFName)?.decodeText()===n;
/** Absence is a source-class trigger, never evidence of permission. Only actual Tf selections count. */
export async function selectedLicensedSubsetClass(bytes:Uint8Array):Promise<ReadonlyMap<string,string>>{
 if(!(bytes instanceof Uint8Array)||bytes.length>MAX_SOURCE_BYTES)return fail();
 if(!new TextDecoder('ascii').decode(bytes.subarray(0,1024)).includes('%PDF-'))return new Map();
 const pdf=await PDFDocument.load(new Uint8Array(bytes));if(pdf.getPageCount()>MAX_SOURCE_PAGES)return fail();
 const required=new Map<string,string>(),seen=new Set<string>();let aggregate=0;
 for(let p=1;p<=pdf.getPageCount();p++){
  const page=pdf.getPages()[p-1],fonts=page.node.Resources()?.lookupMaybe(PDFName.of('Font'),PDFDict);if(!fonts)continue;
  // Do not reinterpret legacy non-TrueType pages. Once a candidate is present,
  // existing strict Tf/Form/graphics-state grammar establishes actual selection.
  const candidates=new Map<string,PDFRef>();
  for(const [name,ref]of fonts.entries()){if(!(ref instanceof PDFRef))continue;const d=pdf.context.lookup(ref,PDFDict);if(!named(d,'Subtype','Type0')||!named(d,'Encoding','Identity-H'))continue;const children=d.lookupMaybe(PDFName.of('DescendantFonts'),PDFArray);if(children?.size()!==1)continue;const child=children.lookup(0,PDFDict);if(named(child,'Subtype','CIDFontType2'))candidates.set(name.decodeText(),ref);}
  if(!candidates.size)continue;if(fonts.entries().length>32)return fail();const text=originalPageContent(pdf,p),hasImages=originalOperators(text).some(o=>o.word==='Do');if(hasImages)originalDirectImageResources(pdf,p,text);const trace=originalTfEvents(text,hasImages);
  for(const state of trace.graphicsStates){const d=page.node.Resources()?.lookupMaybe(PDFName.of('ExtGState'),PDFDict)?.lookupMaybe(PDFName.of(state),PDFDict);if(!d||d.has(PDFName.of('Font')))return fail();}
  for(const event of trace.events){const ref=candidates.get(event.resourceName);if(!ref||seen.has(ref.toString()))continue;seen.add(ref.toString());if(seen.size>32)return fail();const d=pdf.context.lookup(ref,PDFDict),child=d.lookup(PDFName.of('DescendantFonts'),PDFArray).lookup(0,PDFDict),descriptor=child.lookup(PDFName.of('FontDescriptor'),PDFDict);if(!descriptor.has(PDFName.of('FontFile2')))continue;
   const program=licensedSubsetStreamBytes(descriptor.lookup(PDFName.of('FontFile2')),Math.min(4*1024*1024,16*1024*1024-aggregate));aggregate+=program.length;if(program.length<12)return fail();const view=new DataView(program.buffer,program.byteOffset,program.byteLength),count=view.getUint16(4);if(!count||count>128||12+count*16>program.length)return fail();let os2=false;for(let t=0;t<count;t++)if(String.fromCharCode(...program.subarray(12+t*16,16+t*16))==='OS/2')os2=true;if(!os2)required.set(ref.toString(),sha256Sync(program));
  }
 }
 return required;
}
/** Source-first, label-independent authority. Re-import has no save/render/validation recursion. */
export async function validateLicensedSubsetSourceClass(bytes:Uint8Array,assets:readonly SourceFontAsset[],template?:Template):Promise<void>{
 const required=await selectedLicensedSubsetClass(bytes),saved=assets.filter(f=>f.sourceVersion===8);
 if(!required.size){if(saved.length||template?.importerVersion==='folio-import-v15')return fail();return;}
 if(!template||template.importerVersion!=='folio-import-v15'||!template.sourceScopedPages||!template.sourceImageContract||saved.length!==required.size||saved.some(f=>f.format!=='truetype'||required.get(f.originalProgram?.pdfFontRef??'')!==f.originalProgram?.sha256))return fail();
 const {importPdf}=await import('./pdf');const fresh=await importPdf(new File([new Uint8Array(bytes)],'retained-licensed-source.pdf',{type:'application/pdf'}),new Uint8Array(bytes));
 const actual=fresh.template.sourceFonts??[];if(actual.length!==assets.length||actual.filter(f=>f.sourceVersion===8).length!==required.size)return fail();
 const projection=(f:SourceFontAsset)=>{const {id:_id,sourceResource:_alias,bytes:_bytes,...rest}=f;return rest;};
 const used=new Set<SourceFontAsset>();
 for(const asset of assets){const match=actual.find(f=>!used.has(f)&&f.format===asset.format&&f.sourceVersion===asset.sourceVersion&&f.format==='truetype'&&asset.format==='truetype'&&f.originalProgram?.pdfFontRef===asset.originalProgram?.pdfFontRef);if(!match||canonicalJson(projection(match))!==canonicalJson(projection(asset)))return fail();used.add(match);}
}
