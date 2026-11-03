import {PDFDocument,PDFDict,PDFArray,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {originalOperators,originalPageContent} from './pdf-image-trace';
import {parseOriginalToUnicode} from './pdf-to-unicode';

/** Routing only: a repeated original Identity-H show with no SPACE declaration
 * needs complete native inter-show association. This grants no glyph/edit proof.
 * Every selected program, show, state and endpoint is validated by capture. */
export function hasUnspacedIdentityShows(document:PDFDocument):boolean {
 for(let n=1;n<=document.getPageCount();n++){
  const fonts=document.getPages()[n-1].node.Resources()?.lookupMaybe(PDFName.of('Font'),PDFDict);if(!fonts||fonts.entries().length>32)continue;
  const unspaced=new Set<string>();
  for(const [name,value]of fonts.entries()){
   const font=document.context.lookup(value);if(!(font instanceof PDFDict)||font.lookupMaybe(PDFName.of('Subtype'),PDFName)?.decodeText()!=='Type0'||font.lookupMaybe(PDFName.of('Encoding'),PDFName)?.decodeText()!=='Identity-H')continue;
   const children=font.lookupMaybe(PDFName.of('DescendantFonts'),PDFArray);if(!children||children.size()!==1||children.lookup(0,PDFDict).lookupMaybe(PDFName.of('Subtype'),PDFName)?.decodeText()!=='CIDFontType2')continue;
   if(!font.has(PDFName.of('ToUnicode')))continue;const map=font.lookup(PDFName.of('ToUnicode'));if(!(map instanceof PDFRawStream))continue;
   const bytes=decodePDFRawStream(map).getBytes(4*1024*1024+1);if(bytes.length>4*1024*1024)continue;
   try{const unicode=parseOriginalToUnicode(new TextDecoder('latin1').decode(bytes),2,true);if(![...unicode.values()].some(v=>/\s/u.test(v)))unspaced.add(name.decodeText());}catch{/* Other source classes retain their own refusal. */}
  }
  if(!unspaced.size)continue;
  // Read complete tokens, never search text strings for operator-looking words.
  let font='',counts=new Map<string,number>(),selected=new Set<string>();
  for(const op of originalOperators(originalPageContent(document,n,true),undefined,true,true)){
   if(op.word==='Tf'&&typeof op.args[0]==='object'&&op.args[0]&&'name'in op.args[0]){font=op.args[0].name;selected.add(font);}
   if(op.word==='Tj'&&unspaced.has(font)){const count=(counts.get(font)??0)+1;counts.set(font,count);}
  }
  if(selected.size&&[...selected].every(name=>unspaced.has(name))&&[...counts.values()].some(count=>count>1))return true;
 }
 return false;
}
