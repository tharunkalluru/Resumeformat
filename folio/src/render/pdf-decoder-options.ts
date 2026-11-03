/** One pinned local decoder asset configuration for import, recapture and preview. */
export function resolvePdfAssetBase(base:string,pageUrl:string):string {
 // PDF.js fetches these URLs inside its worker, whose URL lives in /assets/.
 // Resolve against the document before handing them across that boundary.
 return new URL(base,pageUrl).href;
}
export function localPdfDecoderOptions(){
 const base=typeof process!=='undefined'&&process.versions?.node?`${process.cwd()}/public/`:resolvePdfAssetBase(import.meta.env.BASE_URL,document.baseURI);
 return {cMapUrl:`${base}pdfjs/cmaps/`,cMapPacked:true,standardFontDataUrl:`${base}pdfjs/standard_fonts/`,wasmUrl:`${base}pdfjs/wasm/`,iccUrl:`${base}pdfjs/iccs/`,useSystemFonts:false,isOffscreenCanvasSupported:false};
}
