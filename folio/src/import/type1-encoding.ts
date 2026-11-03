import {PDFArray,PDFDict,PDFName,PDFNumber} from 'pdf-lib';
/** Retain explicit program encodings. StandardEncoding programs are eligible
 * only for explicit PDF Differences selectors; decoded glyph presence, Unicode,
 * original byte and width must still be proved by the caller for every show. */
export function sourceType1Encoding(font:PDFDict,header:string,supportedName:(name:string)=>boolean):Map<number,string>|undefined{
 const body=header.match(/\/Encoding\s+256 array\s+0 1 255 \{1 index exch \/\.notdef put\} for\s+([\s\S]*?)readonly def/),standard=/\/Encoding\s+StandardEncoding\s+def/.test(header);
 if(!body&&!standard||body&&standard)return;
 const names=new Map<number,string>();
 if(body){for(const m of body[1].matchAll(/dup (\d+) \/([A-Za-z0-9.]+) put/g)){const code=Number(m[1]);if(code>255||names.has(code))return;names.set(code,m[2]);}if(body[1].replace(/dup \d+ \/[A-Za-z0-9.]+ put/g,'').trim())return;}
 if(!font.has(PDFName.of('Encoding')))return standard?undefined:names;
 const encoding=font.lookup(PDFName.of('Encoding'));if(!(encoding instanceof PDFDict)||encoding.keys().some(k=>!['Type','Differences'].includes(k.decodeText()))||encoding.has(PDFName.of('Type'))&&encoding.lookupMaybe(PDFName.of('Type'),PDFName)?.decodeText()!=='Encoding')return;
 const differences=encoding.lookupMaybe(PDFName.of('Differences'),PDFArray);if(!differences||differences.size()>512)return;
 const sourceNames=new Set(names.values()),assigned=new Set<number>();let code=-1;
 for(const v of differences.asArray()){const value=font.context.lookup(v);if(value instanceof PDFNumber){code=value.asNumber();if(!Number.isInteger(code)||code<0||code>255)return;}else if(value instanceof PDFName){if(code<0||code>255||assigned.has(code))return;assigned.add(code);const name=value.decodeText();if(standard?supportedName(name):sourceNames.has(name))names.set(code,name);else names.delete(code);code++;}else return;}
 return names;
}
