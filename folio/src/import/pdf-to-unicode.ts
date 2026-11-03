import {FolioError} from '../core/errors';
const fail=():never=>{throw new FolioError('PDF_ORIGINAL_UNICODE','The original ToUnicode mapping is not a bounded complete supported CMap.');};
/** Parse mapping bodies fully; the opt-in null replacement callback must prove an original glyph owner.
 * Strict callers reject every duplicate; later blocks may replace at most 64 null placeholders with known ligatures.
 * Count expanded declarations cumulatively, including overwritten entries.
 * arrays never silently lose malformed or surplus entries. */
export function parseOriginalToUnicode(input:string,sourceBytes:1|2,allowArrays=false,nullLigatureOwner?:(code:number,value:string)=>boolean):ReadonlyMap<number,string> {
 if(input.length>4*1024*1024||!([1,2] as number[]).includes(sourceBytes))return fail();const text=input.replace(/%[^\r\n]*/g,'');if(/\busecmap\b/.test(text))return fail();
 const whitespace=/[\x00\x09\x0a\x0c\x0d\x20]/;
 const maps=new Map<number,string>(),max=sourceBytes===1?255:65535;let spaces=0,declarations=0,redefinitions=0,blockIndex=0;const origins=new Map<number,number>();
 type Token={hex:string}|'['|']';
 const tokens=(body:string):Token[]=>{const out:Token[]=[];let i=0;while(i<body.length){if(whitespace.test(body[i])){i++;continue;}if(body[i]==='['||body[i]===']'){out.push(body[i++] as '['|']');continue;}if(body[i]!=='<')return fail();const end=body.indexOf('>',i+1);if(end<0)return fail();const hex=body.slice(i+1,end);if(!/^[\da-f]+$/i.test(hex)||hex.length>128)return fail();out.push({hex});i=end+1;if(out.length>200000)return fail();}return out;};
 const source=(token:Token|undefined):number=>{if(!token||typeof token==='string'||token.hex.length!==sourceBytes*2)return fail();return parseInt(token.hex,16);};
 const destination=(token:Token|undefined):string=>{if(!token||typeof token==='string'||!/^([\da-f]{4}){1,32}$/i.test(token.hex))return fail();const value=String.fromCharCode(...token.hex.match(/.{4}/g)!.map(part=>parseInt(part,16)));if(Array.from(value).length>16||/\p{Surrogate}/u.test(value))return fail();return value;};
 const add=(code:number,value:string)=>{if(++declarations>65600||code<0||code>max)return fail();if(maps.has(code)){if(sourceBytes!==2||maps.get(code)!=='\u0000'||origins.get(code)===blockIndex||!['ff','fi','fl','ffi','ffl','st'].includes(value)||!nullLigatureOwner?.(code,value)||++redefinitions>64)return fail();}else if(maps.size>=65536)return fail();maps.set(code,value);origins.set(code,blockIndex);};
 const remaining=text.replace(/(\d+)[\x00\x09\x0a\x0c\x0d\x20]+(begincodespacerange|beginbfchar|beginbfrange)\b([\s\S]*?)\b(endcodespacerange|endbfchar|endbfrange)\b/g,(_whole,countText:string,kind:string,body:string,end:string)=>{
  blockIndex++;if(end!==kind.replace('begin','end'))return fail();const count=Number(countText);if(!Number.isSafeInteger(count)||count<1||count>65536)return fail();const list=tokens(body);let offset=0;
  for(let row=0;row<count;row++){
   const start=source(list[offset++]);
   if(kind==='beginbfchar'){add(start,destination(list[offset++]));continue;}
   const last=source(list[offset++]);if(last<start)return fail();
   if(kind==='begincodespacerange'){if(++spaces!==1||count!==1||start!==0||last!==max)return fail();continue;}
   if(list[offset]==='['){if(!allowArrays)return fail();offset++;for(let code=start;code<=last;code++)add(code,destination(list[offset++]));if(list[offset++]!==']')return fail();}
   else{const token=list[offset++];if(!token||typeof token==='string'||token.hex.length!==4)return fail();const first=parseInt(token.hex,16);if(first+last-start>65535)return fail();for(let code=start;code<=last;code++)add(code,destination({hex:(first+code-start).toString(16).padStart(4,'0')}));}
  }
  if(offset!==list.length)return fail();return '';
 });
 if(spaces!==1||!maps.size||/\b(?:begin|end)(?:codespacerange|bfchar|bfrange|cidchar|cidrange)\b/.test(remaining))return fail();return maps;
}
