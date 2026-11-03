import {OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {FolioError} from '../core/errors';
import {canonicalJson} from '../core/model';
import {pageCoveringClipOperands} from '../core/source-clip-domain';
import {originalOperators} from './pdf-image-trace';
import {classifyScopedMarkedDictionary,type ScopedPaintClip,type ScopedPaintInventory,type ScopedPaintOccurrence,type RawClipConstruction,type RawClipTransform,type RawRectangleConstruction} from './pdf-scoped-paint';

const fail=(why:string):never=>{throw new FolioError('PDF_ATOMIC_PAINT',`Original atomic paint cannot be replayed: ${why}`);};
/** Strict numeric subset of pinned PDF.js 6.4.299 Lexer.getNumber.
 * Its digit accumulation can differ from Number(decimal) by an ULP. Prove
 * decoder state by this exact algorithm, while retaining the source value for
 * output. No epsilon, rounding bucket, malformed number or exponent qualifies.
 */
export function decodedPdfDecimal(token:string):number {
 if(token.length>64||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token))return fail('decimal token');
 let i=0,sign=1,divideBy=0;if(token[i]==='-'||token[i]==='+'){sign=token[i]==='-'?-1:1;i++;}
 if(token[i]==='.'){divideBy=10;i++;}
 let value=Number(token[i++]);
 for(;i<token.length;i++){if(token[i]==='.'){divideBy=1;continue;}if(divideBy)divideBy*=10;value=value*10+Number(token[i]);}
 value=sign*(divideBy?value/divideBy:value);if(!Number.isFinite(value)||Math.abs(value)>1e6)return fail('decimal bounds');return value;
}
export interface WholeTextShow {readonly rawOperatorIndex:number;readonly operatorIndex:number;readonly resource:string;readonly fullTextMatrix:readonly number[];readonly characterSpacing:number;readonly codes:readonly number[];readonly kind:'Tj'|'TJ';readonly parts:readonly (number|readonly number[])[];readonly decodedTextScaleX:number}
/** Decodes only bounded literal/hex PDF strings, never source text semantics. */
export function originalStringBytes(raw:string):number[]{
 if(raw.length>4*1024*1024)return fail('string budget');const bytes:number[]=[];
 const add=(n:number)=>{if(bytes.length>=100000)return fail('glyph budget');if(!Number.isInteger(n)||n<0||n>255)return fail('literal byte');bytes.push(n);};
 if(raw[0]==='<'){const h=raw.slice(1,-1).replace(/[\x00\x09\x0a\x0c\x0d\x20]/g,'');if(raw.at(-1)!=='>'||!/^[\da-f]*$/i.test(h))return fail('hex string');for(let i=0;i<h.length;i+=2)add(parseInt(h.slice(i,i+2).padEnd(2,'0'),16));return bytes;}
 if(raw[0]!=='('||raw.at(-1)!==')')return fail('literal string');
 for(let i=1;i<raw.length-1;i++){let c=raw.charCodeAt(i);if(c===92){const next=raw[++i];if(next===undefined)return fail('escape');if(next==='\r'||next==='\n'){if(next==='\r'&&raw[i+1]==='\n')i++;continue;}if(/[0-7]/.test(next)){let oct=next;for(let j=0;j<2&&/[0-7]/.test(raw[i+1]??'');j++)oct+=raw[++i];c=parseInt(oct,8)&255;}else c=({n:10,r:13,t:9,b:8,f:12}as Record<string,number>)[next]??next.charCodeAt(0);}else if(c===13){if(raw[i+1]==='\n')i++;c=10;}add(c);}
 return bytes;
}
/** Flat bounded PDF TJ only; nested arrays/names/dictionaries never qualify. */
export function originalAdjustedParts(raw:string):(number|number[])[]{
 if(raw.length>4*1024*1024||raw[0]!=='['||raw.at(-1)!==']')return fail('TJ array');
 const parts:(number|number[])[]=[];let i=1,total=0;
 while(i<raw.length-1){if(/[\x00\x09\x0a\x0c\x0d\x20]/.test(raw[i])){i++;continue;}if(raw[i]==='%'){while(i<raw.length-1&&!/[\r\n]/.test(raw[i]))i++;continue;}
  const start=i,c=raw[i];if(c==='('){i++;let depth=1;while(i<raw.length-1&&depth){const x=raw[i++];if(x==='\\'){if(i>=raw.length-1)return fail('TJ escape');if(raw[i++]==='\r'&&raw[i]==='\n')i++;}else if(x==='('){if(++depth>64)return fail('TJ nesting');}else if(x===')')depth--;}if(depth)return fail('TJ string');}
  else if(c==='<'){if(raw[i+1]==='<')return fail('TJ dictionary');i++;while(i<raw.length-1&&raw[i]!=='>')i++;if(raw[i++]!=='>')return fail('TJ hex');}
  else{const match=raw.slice(i).match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)/);if(!match)return fail('TJ operand');i+=match[0].length;if(!/[\x00\x09\x0a\x0c\x0d\x20\[\]()<>%]/.test(raw[i]??''))return fail('TJ delimiter');const n=Number(match[0]);if(!Number.isFinite(n)||Math.abs(n)>1e6)return fail('TJ adjustment');parts.push(n);if(parts.length>100000)return fail('TJ parts');continue;}
  const bytes=originalStringBytes(raw.slice(start,i));if((total+=bytes.length)>200000)return fail('TJ bytes');parts.push(bytes);if(parts.length>100000)return fail('TJ parts');
 }return parts;
}
/** Candidates only; full source graph/resource ownership is proved by caller. */
export function originalWholeShows(text:string,ops:{fnArray:number[];argsArray:any[][]},collectInitialTd=false):ReadonlyMap<number,WholeTextShow>{
 if(ops.fnArray.length>100000||ops.fnArray.length!==ops.argsArray.length)return fail('operator budget');
 let active={resource:'',tc:0,tw:0,tz:100,ts:0,tr:0};const stack:typeof active[]=[];let inside=false,tm:number[]|undefined,freshText=false,initialTd:number[]|undefined;
 const raw:{index:number;initialTd?:readonly number[];candidate?:{rawOperatorIndex:number;resource:string;fullTextMatrix:readonly number[];characterSpacing:number;kind:'Tj'|'TJ'};parts?:(number|number[])[]}[]=[];
 for(const op of originalOperators(text,classifyScopedMarkedDictionary,true,true)){
  if(op.word==='q'){if(inside||stack.length>=64)return fail('graphics stack');stack.push({...active});}else if(op.word==='Q'){if(inside||!stack.length)return fail('graphics stack');active=stack.pop()!;}
  else if(op.word==='BT'){if(inside)return fail('nested text');inside=true;tm=undefined;freshText=true;initialTd=undefined;}else if(op.word==='ET'){if(!inside)return fail('text end');inside=false;tm=undefined;freshText=false;}
  else if(op.word==='Tf'){const a=op.args[0];if(!a||typeof a!=='object'||!('name'in a))return fail('font name');active.resource=a.name;}
  else if(['Tc','Tw','Tz','Ts','Tr'].includes(op.word)){const n=op.args[0];if(op.args.length!==1||typeof n!=='number'||!Number.isFinite(n))return fail('text state');active={...active,[op.word.toLowerCase()]:n};}
  else if(op.word==='Tm'){if(!inside||op.args.length!==6||op.args.some(x=>typeof x!=='number'||!Number.isFinite(x)||Math.abs(x)>1e6))return fail('text matrix');tm=op.args as number[];freshText=false;initialTd=undefined;}
  else if(op.word==='Td'){if(collectInitialTd&&inside&&freshText){if(op.args.length!==2||op.args.some(x=>typeof x!=='number'||!Number.isFinite(x)||Math.abs(x)>1e6)||op.numberLexemes?.some(x=>x===undefined))return fail('initial Td');tm=[1,0,0,1,...op.args as number[]];initialTd=[1,0,0,1,...op.numberLexemes!.map(x=>decodedPdfDecimal(x!))];}else tm=undefined;freshText=false;}else if(['TD','T*'].includes(op.word)){tm=undefined;freshText=false;}
  else if(op.word==='Tj'||op.word==='TJ'){
   if(!inside)return fail('show outside text');const a=op.args[0],literal=a&&typeof a==='object'&&'rawString'in a?a.rawString:undefined,array=a&&typeof a==='object'&&'rawArray'in a?a.rawArray:undefined;
   const valid=op.args.length===1&&(op.word==='Tj'?literal!==undefined:array!==undefined)&&tm&&active.resource&&active.tw===0&&active.tz===100&&active.ts===0&&active.tr===0;
   raw.push({index:op.index,...(initialTd?{initialTd}:{}),...(valid?{candidate:{rawOperatorIndex:op.index,resource:active.resource,fullTextMatrix:Object.freeze([...tm!]),characterSpacing:active.tc,kind:op.word},parts:op.word==='Tj'?[originalStringBytes(literal!)]:originalAdjustedParts(array!)}:{})});tm=undefined;freshText=false;
  }
 }
 if(inside||stack.length)return fail('unbalanced source');const decoded=ops.fnArray.flatMap((op,i)=>op===OPS.showText||op===OPS.showSpacedText?[i]:[]);if(decoded.length!==raw.length)return fail('show count');
 const decodedState=new Map<number,{tm:number[];tc:number}>();let dtm=[1,0,0,1,0,0],dtc=0,decodedFresh=false;const dst:number[]=[];
 for(let i=0;i<ops.fnArray.length;i++){const op=ops.fnArray[i],a=ops.argsArray[i];if(op===OPS.save)dst.push(dtc);else if(op===OPS.restore){if(!dst.length)return fail('decoded graphics');dtc=dst.pop()!;}else if(op===OPS.beginText){dtm=[1,0,0,1,0,0];decodedFresh=true;}else if(op===OPS.setTextMatrix){dtm=a.length===1?Array.from(a[0]):[...a];decodedFresh=false;}else if(op===OPS.moveText){if(decodedFresh){if(a.length!==2||a.some(x=>typeof x!=='number'||!Number.isFinite(x)||Math.abs(x)>1e6))return fail('decoded initial Td');dtm=[1,0,0,1,a[0],a[1]];}decodedFresh=false;}else if(op===OPS.setCharSpacing)dtc=a[0];else if(op===OPS.showText||op===OPS.showSpacedText){decodedState.set(i,{tm:[...dtm],tc:dtc});decodedFresh=false;}}
 if(dst.length)return fail('decoded graphics');
 const result=new Map<number,WholeTextShow>();let total=0;
 for(let i=0;i<raw.length;i++){const r=raw[i];if(!r.candidate)continue;const state=decodedState.get(decoded[i]);if(!state||state.tc!==r.candidate.characterSpacing||state.tm.length!==6||(r.initialTd?r.initialTd.some((v,j)=>v!==state.tm[j]):r.candidate.fullTextMatrix.some((v,j)=>v!==state.tm[j]&&Math.fround(v)!==state.tm[j]))){if(r.initialTd)continue;return fail('raw/decoded initial matrix or Tc');}const sequence=ops.argsArray[decoded[i]][0];if(!Array.isArray(sequence)||sequence.some(g=>typeof g==='number'?!Number.isFinite(g):!g||!Number.isInteger(g.originalCharCode)||g.originalCharCode<0||g.originalCharCode>65535))return fail('decoded codes');total+=sequence.length;if(total>100000)return fail('decoded glyph budget');const codes=sequence.filter(g=>typeof g!=='number').map(g=>g.originalCharCode),parts=r.parts!,byteCount=parts.reduce<number>((n,p)=>n+(typeof p==='number'?0:p.length),0);
  const width=byteCount===codes.length?1:byteCount===codes.length*2?2:0;if(!width||!codes.length)return fail('raw/decoded code sequence');let cursor=0;const qualified:(number|readonly number[])[]=[];
  for(const part of parts){if(typeof part==='number'){if(sequence[cursor++]!==part)return fail('raw/decoded adjustment');qualified.push(part);continue;}if(part.length%width)return fail('split code bytes');const selected:number[]=[];for(let j=0;j<part.length;j+=width){const c=width===1?part[j]:part[j]*256+part[j+1],g=sequence[cursor++];if(!g||typeof g==='number'||g.originalCharCode!==c)return fail('raw/decoded code sequence');selected.push(c);}qualified.push(Object.freeze(selected));}
  if(cursor!==sequence.length)return fail('raw/decoded sequence length');result.set(decoded[i],Object.freeze({...r.candidate,operatorIndex:decoded[i],codes:Object.freeze(codes),parts:Object.freeze(qualified),decodedTextScaleX:state.tm[0]}));
 }
 return result;
}
type RectanglePaint=Extract<ScopedPaintOccurrence,{kind:'fillRect'}>;
export interface OriginalRectangleReplay {readonly construction:RawRectangleConstruction;readonly transforms:readonly RawClipTransform[];readonly occurrence:Readonly<RectanglePaint>}
export interface ClipPlanPaint {readonly operatorIndex:number;readonly clips:readonly ScopedPaintClip[];readonly rawClips?:readonly RawClipConstruction[];readonly originalRectangle?:OriginalRectangleReplay}
/** Complete inventory establishes each clip's nonempty nested paint interval. */
export function sourceClipLifetimePlan(inventory:ScopedPaintInventory,byOperator:ReadonlyMap<number,unknown>,rawClips?:ReadonlyMap<number,RawClipConstruction>,owner?:{sourceSha256:string;pageNumber:number},rawRectangles?:ReadonlyMap<number,RawRectangleConstruction>):readonly ClipPlanPaint[]{
 if(inventory.clips.length>4096||inventory.occurrences.length>100000||byOperator.size!==inventory.occurrences.length)return fail('clip inventory budget');
 let work=0;const charge=(length:number)=>{if(!Number.isSafeInteger(length)||length<0||length>100000-work-7)return fail('raw construction replay budget');work+=length+7;};
 if(rawClips){if(!owner||rawClips.size!==inventory.clips.length)return fail('raw clip inventory ownership');for(const clip of inventory.clips){const raw=rawClips.get(clip.clipOperatorIndex);if(!raw||raw.sourceSha256!==owner.sourceSha256||raw.pageNumber!==owner.pageNumber||raw.clipKey!==JSON.stringify(clip))return fail('raw clip owner');charge(raw.chain?.length??0);}}
 const rectangles=inventory.occurrences.filter((paint):paint is RectanglePaint=>paint.kind==='fillRect'&&!paint.rectanglePath),rectangleReplays=new Map<number,OriginalRectangleReplay>();
 if(rawRectangles){if(!owner||rawRectangles.size!==rectangles.length)return fail('raw rectangle inventory ownership');for(const paint of rectangles){const raw=rawRectangles.get(paint.rawOperatorIndex);if(!raw||raw.sourceSha256!==owner.sourceSha256||raw.pageNumber!==owner.pageNumber||raw.paintKey!==JSON.stringify(paint))return fail('raw rectangle owner');charge(raw.chain?.length??0);}}
 // Preflight the entire combined construction cost before traversing even the
 // first linked chain. Clip and rectangle replay do not get separate budgets.
 if(rawClips)for(const clip of inventory.clips)rawClipTransformChain(rawClips.get(clip.clipOperatorIndex)!,clip);
 if(rawRectangles)for(const paint of rectangles){const raw=rawRectangles.get(paint.rawOperatorIndex)!,transforms=rawRectangleTransformChain(raw,paint),occurrence=structuredClone(paint);Object.freeze(occurrence.bounds);Object.freeze(occurrence.color.components);Object.freeze(occurrence.color);Object.freeze(occurrence.clipStack);Object.freeze(occurrence.effectiveClip);rectangleReplays.set(paint.rawOperatorIndex,Object.freeze({construction:raw,transforms,occurrence:Object.freeze(occurrence)}));}
 const keys=new Map<number,string>(),parents=new Map<number,string>(),seen=new Set<number>(),closed=new Set<number>();let active:number[]=[],refs=0;
 for(const c of inventory.clips){if(!Number.isSafeInteger(c.clipOperatorIndex)||c.clipOperatorIndex<0||keys.has(c.clipOperatorIndex))return fail('clip identity');keys.set(c.clipOperatorIndex,canonicalJson(c));}
 const operators=[...byOperator.keys()],plan:ClipPlanPaint[]=[];
 for(let i=0;i<inventory.occurrences.length;i++){const paint=inventory.occurrences[i],clips=paint.clipStack;if(clips.length>64||(refs+=clips.length)>100000)return fail('clip reference budget');const ids=clips.map(c=>c.clipOperatorIndex);if(new Set(ids).size!==ids.length)return fail('duplicate clip stack');
  for(let j=0;j<clips.length;j++){const c=clips[j],key=canonicalJson(c),parent=canonicalJson(ids.slice(0,j));if(keys.get(ids[j])!==key||parents.has(ids[j])&&parents.get(ids[j])!==parent)return fail('changed clip or parent');parents.set(ids[j],parent);}
  let common=0;while(common<active.length&&common<ids.length&&active[common]===ids[common])common++;for(const id of active.slice(common))closed.add(id);
  for(const id of ids.slice(common)){if(closed.has(id))return fail('clip lifetime reappeared');seen.add(id);}active=ids;
  plan.push(Object.freeze({operatorIndex:operators[i],...(rectangleReplays.has(paint.rawOperatorIndex)?{originalRectangle:rectangleReplays.get(paint.rawOperatorIndex)}:{}),...(rawClips?{rawClips:Object.freeze(clips.map(c=>rawClips.get(c.clipOperatorIndex)!))}:{}),clips:Object.freeze(clips.map(c=>Object.freeze({...c,bounds:Object.freeze({...c.bounds}),constructionCtm:Object.freeze([...c.constructionCtm]) as unknown as number[],...(c.pageCover?{pageCover:Object.freeze({...c.pageCover,operands:Object.freeze([...c.pageCover.operands]) as unknown as number[]})}:{})})))}));
 }
 if(seen.size!==keys.size)return fail('empty clip lifetime');return Object.freeze(plan);
}

/** Bounded exact source construction; no inverse viewport or inverse matrix. */
export function rawClipTransformChain(raw:RawClipConstruction,clip:ScopedPaintClip):readonly RawClipTransform[]{
 if(raw.clipKey!==JSON.stringify(clip))return fail('raw clip identity');
 if(clip.pageCover&&canonicalJson(raw.operands)!==canonicalJson(clip.pageCover.operands))return fail('page-cover source operands');
 return rawConstructionChain(raw,clip.pathOperatorIndex,clip.constructionCtm,clip.bounds,!!clip.pageCover);
}
/** Caller has rederived the complete raw construction chain from the source. */
export function rawClipReplayOperands(raw:RawClipConstruction,clip:ScopedPaintClip):readonly number[]{
 if(!clip.pageCover){if(raw.operands.length!==4||raw.operands.some(n=>!Number.isFinite(n)||Math.abs(n)>1e6))return fail('raw clip replay bounds');return raw.operands;}
 if(raw.clipKey!==JSON.stringify(clip)||canonicalJson(raw.operands)!==canonicalJson(clip.pageCover.operands))return fail('page-cover replay identity');
 const bounded=pageCoveringClipOperands(raw.operands,clip.constructionCtm,clip.bounds);if(!bounded)return fail('page-cover replay projection');return bounded;
}
/** Pure candidates remain untrusted; only a complete renderer-private plan can emit them. */
export function rawRectangleTransformChain(raw:RawRectangleConstruction,paint:RectanglePaint):readonly RawClipTransform[]{
 if(paint.rectanglePath||raw.paintKey!==JSON.stringify(paint)||raw.pathOperatorIndex!==paint.pathOperatorIndex||raw.paintOperatorIndex!==paint.rawOperatorIndex||!Number.isSafeInteger(raw.pathOperatorIndex)||raw.pathOperatorIndex<0||!Number.isSafeInteger(raw.paintOperatorIndex)||raw.paintOperatorIndex<=raw.pathOperatorIndex||!['f','F','f*'].includes(raw.fillOperator)||(raw.fillOperator==='f*'?'evenodd':'nonzero')!==paint.fillRule)return fail('raw rectangle identity');
 return rawConstructionChain(raw,raw.pathOperatorIndex,raw.constructionCtm,paint.bounds);
}
function rawConstructionChain(raw:Pick<RawClipConstruction,'operands'|'chain'|'viewport'>,pathOperatorIndex:number,constructionCtm:readonly number[],expectedBounds:import('../core/model').Rect,pageCover=false):readonly RawClipTransform[]{
 const finite=(v:number)=>Number.isFinite(v)&&Math.abs(v)<=1e6;
 if(raw.operands.length!==4||!raw.operands.every(pageCover?Number.isSafeInteger:finite)||raw.viewport.length!==6||!raw.viewport.every(finite)||raw.viewport[0]!==1||raw.viewport[1]!==0||raw.viewport[2]!==0||raw.viewport[3]!==-1||raw.viewport[4]!==0)return fail('raw construction operands');
 if(raw.chain&&(!Number.isSafeInteger(raw.chain.length)||raw.chain.length<1||raw.chain.length>100000))return fail('raw clip chain budget');
 const reverse:RawClipTransform[]=[];let node=raw.chain,last=pathOperatorIndex;
 while(node){if(reverse.length>=100000||node.length!==(node.parent?.length??0)+1||!Number.isSafeInteger(node.operatorIndex)||node.operatorIndex<0||node.operatorIndex>=last||node.operands.length!==6||!node.operands.every(finite)||node.operands[1]!==0||node.operands[2]!==0||node.operands[0]===0||node.operands[3]===0)return fail('raw clip transform');reverse.push(node);last=node.operatorIndex;node=node.parent;}
 if(reverse.length!==(raw.chain?.length??0))return fail('raw clip chain length');
 const chain=reverse.reverse();let m=[1,0,0,1,0,0];for(const n of chain){const b=n.operands;m=[m[0]*b[0],0,0,m[3]*b[3],m[0]*b[4]+m[4],m[3]*b[5]+m[5]];if(!m.every(finite))return fail('raw clip transform bounds');}
 const v=raw.viewport,c=[v[0]*m[0],0,0,v[3]*m[3],v[0]*m[4]+v[4],v[3]*m[5]+v[5]], [x,y,w,h]=raw.operands,a=[c[0]*x+c[4],c[3]*y+c[5]],b=[c[0]*(x+w)+c[4],c[3]*(y+h)+c[5]],bounds={x:Math.min(a[0],b[0]),y:Math.min(a[1],b[1]),width:Math.abs(b[0]-a[0]),height:Math.abs(b[1]-a[1])};
 if(canonicalJson(c)!==canonicalJson(constructionCtm)||(pageCover?!pageCoveringClipOperands(raw.operands,c,expectedBounds):![...a,...b].every(finite)||canonicalJson(bounds)!==canonicalJson(expectedBounds)))return fail('raw construction projection');return Object.freeze(chain);
}
