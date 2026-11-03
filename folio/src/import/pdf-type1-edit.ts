import {proveOriginalCffOccurrence,type OriginalCffResource} from './pdf-original-cff';
import {sourceType1Encoding} from './type1-encoding';
import {PDFArray,PDFDict,PDFName,PDFNumber,PDFRawStream,PDFString,PDFHexString} from 'pdf-lib';
import {OPS,Util,type PDFPageProxy} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {sha256Sync,canonicalJson,type TextRegion,type Type1EditableSlot} from '../core/model';
import {decodeBoundedContentStream} from './bounded-content-stream';
import {originalOperators} from './pdf-image-trace';
import {parseType1UnicodeMap} from './type1-unicode-map';

export interface Type1PaintPage {width:number;height:number;paint:Uint8Array;fonts:Map<string,PDFDict>;annotations:PDFDict[];cff?:Map<string,OriginalCffResource>}
type Code={unicode:string;code:number;pdfWidth:number};
type Profile={unicode?:(code:number)=>string|undefined;hash:string;names:Map<number,string>;unicodeMap?:Map<number,string>;width:(code:number)=>number;codes:Map<string,Code>;upright:boolean;gaps:number[];ambiguous:Set<string>};
const key=PDFName.of;
const glyphNames:Record<string,string>={zero:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9',space:' ',period:'.',comma:',',colon:':',semicolon:';',hyphen:'-',plus:'+',equal:'=',percent:'%',slash:'/',parenleft:'(',parenright:')',quotedbl:'"',quotesingle:"'",at:'@',asterisk:'*',ampersand:'&',question:'?',exclam:'!',underscore:'_',numbersign:'#',dollar:'$',less:'<',greater:'>',bracketleft:'[',backslash:'\\',bracketright:']',asciicircum:'^',grave:'`',braceleft:'{',bar:'|',braceright:'}',asciitilde:'~',ff:'ﬀ',fi:'ﬁ',fl:'ﬂ',ffi:'ﬃ',ffl:'ﬄ'};
const unicodeForName=(name:string|undefined)=>name&&(/^[A-Za-z]$/.test(name)?name:glyphNames[name]);
const binary=(b:Uint8Array)=>{let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return s;};
function profile(font:PDFDict,cff?:OriginalCffResource):Profile|undefined{
 try{
  if(cff){if(![0,8].includes(cff.permission.fsType??-1)||cff.selectorBytes!==1)return;return{hash:cff.programSha256,names:new Map(),unicode:code=>{try{return proveOriginalCffOccurrence(cff,code).unicode;}catch{return;}},width:code=>proveOriginalCffOccurrence(cff,code).pdfWidth,codes:new Map(),ambiguous:new Set(),upright:font.lookup(key('FontDescriptor'),PDFDict).lookupMaybe(key('ItalicAngle'),PDFNumber)?.asNumber()===0,gaps:[]};}
  let unicodeMap:Map<number,string>|undefined;
  if(font.has(key('ToUnicode'))){const stream=font.lookup(key('ToUnicode'));if(!(stream instanceof PDFRawStream))return;unicodeMap=parseType1UnicodeMap(new TextDecoder('ascii').decode(decodeBoundedContentStream(stream)));if(!unicodeMap)return;}
  const descriptor=font.lookup(key('FontDescriptor'),PDFDict),program=descriptor.lookup(key('FontFile'));if(!(program instanceof PDFRawStream))return;
  const data=decodeBoundedContentStream(program),header=new TextDecoder('ascii').decode(data.subarray(0,program.dict.lookup(key('Length1'),PDFNumber).asNumber())),names=sourceType1Encoding(font,header,name=>!!unicodeForName(name));if(!names)return;
  const first=font.lookup(key('FirstChar'),PDFNumber).asNumber(),widths=font.lookup(key('Widths'),PDFArray);
  return {hash:sha256Sync(data),names,unicodeMap,width:code=>widths.lookup(code-first,PDFNumber).asNumber(),codes:new Map(),ambiguous:new Set(),upright:descriptor.lookupMaybe(key('ItalicAngle'),PDFNumber)?.asNumber()===0,gaps:[]};
 }catch{return;}
}

/** Capability proof only: original encoding + actual decoded painted selectors,
 * a unique complete semantic line, upright fixed-origin state and a bounded frame.
 * No filename, source digest, phrase, resource name or fixed coordinate admission. */
export async function captureType1EditableSlots(page:Type1PaintPage,decoded:PDFPageProxy,regions:TextRegion[],itemFonts:Map<string,{fontName:string;text:string}>,pageNumber:number):Promise<Type1EditableSlot[]>{
 const text=binary(page.paint),ops=originalOperators(text,undefined,true,false,true),operatorList=await decoded.getOperatorList();
 if(ops.some(o=>o.word==="'"||o.word==='"'))return [];
 const shows=operatorList.fnArray.flatMap((op,i)=>op===OPS.showText||op===OPS.showSpacedText?[operatorList.argsArray[i][0]]:[]),fonts=operatorList.fnArray.flatMap((op,i)=>op===OPS.setFont?[operatorList.argsArray[i]]:[]);
 if(shows.length!==ops.filter(o=>o.word==='Tj'||o.word==='TJ').length||fonts.length!==ops.filter(o=>o.word==='Tf').length)return [];
 const profiles=new Map([...page.fonts].map(([alias,font])=>[alias,profile(font,page.cff?.get(alias))]));
 const identity=()=>[1,0,0,1,0,0];let ctm=identity(),tm=identity(),x=0,y=0,lx=0,ly=0,size=0,alias='',decoderFont='',leading=0,tc=0,tw=0,tz=100,rise=0,inText=false,clip=false,valid=true,fi=0,si=0;
 const stack:{ctm:number[];clip:boolean;size:number;alias:string;decoderFont:string;leading:number;tc:number;tw:number;tz:number;rise:number;valid:boolean}[]=[];
 const pending:{slot:Type1EditableSlot;region:TextRegion;gaps:number[];profile:Profile}[]=[];
 const bytesOf=(raw:string)=>raw.startsWith('(')?PDFString.of(raw.slice(1,-1)).asBytes():PDFHexString.of(raw.slice(1,-1)).asBytes();
 for(const op of ops){const a=op.args,n=a.filter((v):v is number=>typeof v==='number');
  if(op.word==='q'){if(inText)return [];stack.push({ctm:[...ctm],clip,size,alias,decoderFont,leading,tc,tw,tz,rise,valid});}
  else if(op.word==='Q'){if(inText)return [];const s=stack.pop();if(!s)return [];({ctm,clip,size,alias,decoderFont,leading,tc,tw,tz,rise,valid}=s);}
  else if(op.word==='cm'){if(n.length!==6||inText)return [];ctm=Util.transform(ctm,n);}
  else if(op.word==='W'||op.word==='W*')clip=true;
  else if(op.word==='BT'){inText=true;tm=identity();x=y=lx=ly=0;valid=true;}
  else if(op.word==='ET')inText=false;
  else if(op.word==='Tf'){const name=a[0],f=fonts[fi++];if(typeof name!=='object'||!('name'in name)||f?.[1]!==a[1])return [];alias=name.name;decoderFont=f[0];size=n[0];}
  else if(op.word==='Tm'){if(n.length!==6)return [];tm=n;x=y=lx=ly=0;valid=true;}
  else if(op.word==='Td'||op.word==='TD'){if(n.length!==2)return [];lx+=n[0];ly+=n[1];x=lx;y=ly;valid=true;if(op.word==='TD')leading=-n[1];}
  else if(op.word==='T*'){ly-=leading;x=lx;y=ly;valid=true;}
  else if(op.word==='TL')leading=n[0];else if(op.word==='Tc')tc=n[0];else if(op.word==='Tw')tw=n[0];else if(op.word==='Tz')tz=n[0];else if(op.word==='Ts')rise=n[0];
  if(op.word!=='Tj'&&op.word!=='TJ')continue;
  const glyphs=shows[si++],arg=a[0],p=profiles.get(alias);if(!Array.isArray(glyphs)||typeof arg!=='object'||!('opaque'in arg))return [];
  const segments=op.word==='Tj'&&arg.rawString?[{opaque:true,rawString:arg.rawString}]:arg.rawArray?originalOperators(arg.rawArray.slice(1,-1)+' END',undefined,true)[0]?.args:undefined;if(!segments)return [];
  let gi=0,advance=0,plain='',proved=!!p,positiveGap=0;const glyphParts:{unicode:string;gap:number}[]=[];
  for(const segment of segments){if(typeof segment==='number'){if(glyphs[gi++]!==segment)return [];advance-=segment;positiveGap-=segment;continue;}
   if(typeof segment!=='object'||!('rawString'in segment)||!segment.rawString)return [];
   for(const code of bytesOf(segment.rawString)){const g=glyphs[gi++];if(!g||typeof g==='number'||g.originalCharCode!==code)return [];
    const width=g.width;advance+=width;plain+=g.unicode;glyphParts.push({unicode:g.unicode,gap:positiveGap});positiveGap=0;
    if(!p)continue;let rawWidth;try{rawWidth=p.width(code);}catch{proved=false;continue;}
    const u=p.unicode?p.unicode(code):unicodeForName(p.names.get(code));if(!u||u!==g.unicode||p.unicodeMap&&p.unicodeMap.get(code)!==u||width!==rawWidth||!g.isInFont||g.accent||!Number.isFinite(width)||width<=0){proved=false;continue;}
    const prior=p.codes.get(u);if(p.ambiguous.has(u)){proved=false;continue;}if(prior&&prior.code!==code){p.codes.delete(u);p.ambiguous.add(u);proved=false;continue;}p.codes.set(u,{unicode:u,code,pdfWidth:width});
   }
  }
  if(gi!==glyphs.length)return [];
  const m=Util.transform(ctm,tm),sx=m[0]*x+m[2]*y+m[4],sy=m[1]*x+m[3]*y+m[5],effectiveSize=size*m[3],horizontalScale=m[0]/m[3],drawWidth=advance*size*m[0]/1000;
  // Fractional Type1 widths differ between consumers. A dependent show needs
  // an exact line-origin reset and a source-width blank-font advance recipe.
  let cursorIsolated=false;for(let next=op.index+1;next<ops.length;next++){const w=ops[next].word;if(['Tm','Td','TD','T*','ET'].includes(w)){cursorIsolated=true;break;}if(w==='Tj'||w==='TJ')break;}
  const cursorRestore=!page.cff&&!cursorIsolated&&x===lx&&y===ly?{version:'type1-blank-advance-v1' as const,fontSize:size}:undefined;
  const eligible=(cursorIsolated||cursorRestore)&&valid&&inText&&!clip&&p?.upright&&proved&&tc===0&&tw===0&&tz===100&&rise===0&&m[0]>0&&Math.abs(m[1])<1e-10&&Math.abs(m[2])<1e-10&&m[3]>0&&Number.isFinite(horizontalScale)&&horizontalScale>0&&horizontalScale<=4&&op.sourceSpan;
  const matches=eligible?regions.filter(r=>r.sourceLocator&&itemFonts.get(r.sourceLocator)?.fontName===decoderFont&&Math.abs(r.bounds.x-sx)<.0001&&Math.abs(page.height-r.bounds.y-r.style.fontSize*.75-sy)<.0001&&Math.abs(r.style.fontSize-effectiveSize)<.0001&&Math.abs(r.bounds.width-drawWidth)<.0001):[];
  if(matches.length===1&&p){const region=matches[0],baselineText=itemFonts.get(region.sourceLocator!)?.text??'';
   // A single show split into semantic columns, or an unreadable glyph, never owns a line.
   if(baselineText.replace(/ /g,'')===plain.replace(/ /g,'')&&baselineText.length<=2048&&/^[^\s\p{C}]+(?: [^\s\p{C}]+)*$/u.test(baselineText)&&region.bounds.x>=0&&region.bounds.y>=0&&region.bounds.x+region.bounds.width<=page.width+.0001&&region.bounds.y+region.bounds.height<=page.height+.0001&&region.bounds.x<page.width*.45&&Math.abs(region.bounds.x+region.bounds.width/2-page.width/2)>.01){
    let offset=0,matched=true;const gaps:number[]=[];
    for(const part of glyphParts){if(part.unicode===' '){if(baselineText[offset++]!==' ')matched=false;continue;}if(baselineText[offset]===' '){if(part.gap<=0)matched=false;else gaps.push(-part.gap);offset++;}if(baselineText.slice(offset,offset+part.unicode.length)!==part.unicode)matched=false;offset+=part.unicode.length;}
    const linked=page.annotations.some(d=>{const rect=d.lookup(key('Rect'),PDFArray).asArray().map(v=>d.context.lookup(v,PDFNumber).asNumber());return region.bounds.x<rect[2]&&region.bounds.x+region.bounds.width>rect[0]&&sy-effectiveSize*.25<rect[3]&&sy+effectiveSize*.75>rect[1];});
    if(matched&&offset===baselineText.length&&!linked){p.gaps.push(...gaps);pending.push({region,profile:p,gaps,slot:{...(horizontalScale!==1?{horizontalScale}:{}),pageNumber,sourceLocator:region.sourceLocator!,operatorIndex:op.index,fontResource:alias,fontProgramSha256:p.hash,baselineText,originalAdvance:advance,spaceAdjustment:0,maximumWidth:region.bounds.width,...(cursorRestore?{cursorRestore}:{}),codes:[],operatorWord:op.word as 'Tj'|'TJ',operatorSha256:sha256Sync(new TextEncoder().encode(text.slice(op.sourceSpan!.start,op.sourceSpan!.end))),stateSha256:sha256Sync(new TextEncoder().encode(canonicalJson({m,x,y,lx,ly,size,alias,tc,tw,tz,rise,clip})))}});}
   }
  }
  if(page.fonts.get(alias)?.lookupMaybe(key('Subtype'),PDFName)?.decodeText()==='Type3'||tc!==0||tw!==0||tz!==100||!Number.isFinite(advance))valid=false;else x+=advance*size/1000;
 }
 return pending.flatMap(({slot,region,gaps,profile:p})=>{
  if(Array.from(slot.baselineText).some(c=>c!==' '&&!p.codes.has(c)))return [];
  const available=gaps.length?gaps:p.gaps,space=p.codes.get(' ');if(!available.length&&!space)return [];
  slot.spaceAdjustment=available.length?[...available].sort((a,b)=>a-b)[Math.floor(available.length/2)]:-space!.pdfWidth;
  const cohort=regions.filter(r=>Math.abs(r.bounds.x-region.bounds.x)<.0001&&Math.abs(r.style.fontSize-region.style.fontSize)<.0001),right=Math.max(...cohort.map(r=>r.bounds.x+r.bounds.width));
  const neighbors=regions.filter(r=>r!==region&&r.bounds.x>=region.bounds.x+region.bounds.width-.0001&&Math.abs(r.bounds.y-region.bounds.y)<.0001),limit=neighbors.length?Math.min(...neighbors.map(r=>r.bounds.x))-3:right;
  slot.maximumWidth=Math.max(region.bounds.width,Math.min(right,limit,page.width)-region.bounds.x);slot.codes=[...p.codes.values()].filter(c=>c.unicode!==' ').sort((a,b)=>a.code-b.code);return [slot];
 });
}
