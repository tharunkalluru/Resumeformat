import type {Project} from '../core/model';
import {sha256Sync} from '../core/model';
import {renderDocument} from '../render/pdf';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {PDFArray,PDFDocument,PDFRawStream,PDFName,decodePDFRawStream} from 'pdf-lib';
import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {resolve} from 'node:path';
import {captureSourceGlyphs} from './pdf-source';
import {sourceGlyphs} from '../core/source-graph';

/** Test data factory, never an admission bypass: attach a real authored PDF. */
export async function retainFictionalLegacySource(project:Project):Promise<void>{
 const rendered=await renderDocument(project.template,project.baseline,project.assets),pdf=await PDFDocument.load(rendered.bytes);
 // A spacing fixture must author its claimed original Tc, rather than graft it
 // onto a PDF which only painted unspaced glyphs. Each explicit Tm keeps x exact.
 for(const [i,page] of project.template.pages.entries()){
  const spacing=new Set(page.regions.flatMap(region=>region.kind==='text'&&region.sourceLayout?[region.sourceLayout.version===3?region.sourceLayout.characterSpacing:0]:[]));
  if(spacing.size>1)throw Error('The fictional legacy author supports one Tc per page.');const tc=[...spacing][0]??0;
  if(tc!==0){const original=pdf.getPages()[i],contents=original.node.Contents(),streams=contents instanceof PDFArray?contents.asArray().map(ref=>pdf.context.lookup(ref)):[contents];const text=streams.map(stream=>{if(!(stream instanceof PDFRawStream))throw Error();return new TextDecoder().decode(decodePDFRawStream(stream).decode());}).join('\n').replace(/\bBT\b/g,`BT ${tc} Tc`);original.node.set(PDFName.of('Contents'),pdf.context.register(pdf.context.flateStream(new TextEncoder().encode(text))));}
 }
 project.source.bytes=new Uint8Array(await pdf.save());project.source.sha256=sha256Sync(project.source.bytes);
 for(const font of project.template.sourceFonts??[])font.sourceSha256=project.source.sha256;
 for(const page of project.template.pages)for(const region of page.regions)if(region.kind==='text'&&region.sourceLayout)region.sourceLayout.sourceSha256=project.source.sha256;
 Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
 const task=getDocument({data:new Uint8Array(project.source.bytes),useSystemFonts:false,isOffscreenCanvasSupported:false,fontExtraProperties:true,verbosity:0});
 try{const document=await task.promise;for(const [i,savedPage] of project.template.pages.entries()){
  const page=await document.getPage(i+1),assets:import('../core/model').SourceFontAsset[]=[],actual=await captureSourceGlyphs(page,page.getViewport({scale:1}).transform,project.source.sha256,assets,project.source.bytes,i+1);if(!actual)throw Error('The authored legacy fixture has no source graph.');let cursor=0;
  for(const region of [...savedPage.regions].sort((a,b)=>a.order-b.order))if(region.kind==='text'&&region.sourceLayout){const graph=region.sourceLayout;if(graph.glyphEncoding)throw Error('Author legacy object fixture before normalization.');
   for(const glyph of sourceGlyphs(region)){const painted=actual[cursor++];if(!painted||painted.unicode!==glyph.unicode||Math.abs(painted.x-glyph.x)>.0001||Math.abs(painted.advance-glyph.advance)>.0001)throw Error('The fictional source must really paint each claimed glyph.');glyph.operatorIndex=painted.operatorIndex;glyph.x=painted.x;glyph.advance=painted.advance;graph.baseline=painted.baseline;graph.fontSize=painted.size;}
   graph.startX=graph.glyphs[0].x;graph.endX=graph.glyphs.at(-1)!.x+graph.glyphs.at(-1)!.advance;region.order=graph.glyphs[0].operatorIndex;
  }
  if(cursor!==actual.length)throw Error('The authored fixture has unexpected source paints.');
 }}finally{await task.destroy();}
}
