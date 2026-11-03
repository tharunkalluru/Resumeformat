import {OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {originalHorizontalShear} from '../layout/source-shear';
import {FolioError} from '../core/errors';
import {originalOperators} from './pdf-image-trace';
import {classifyScopedMarkedDictionary} from './pdf-scoped-paint';

export interface TextDecomposition {readonly ctm:readonly number[];readonly nominalFontSize:number;readonly linearTextMatrix:readonly number[];readonly effectiveFontSize:number;readonly rawOperatorIndex:number;readonly operatorIndex:number}
const fail=():never=>{throw new FolioError('PDF_TEXT_DECOMPOSITION','The original text matrix decomposition cannot be proved.');};
const identity=()=>[1,0,0,1,0,0];
const finite=(v:number)=>Number.isFinite(v)&&Math.abs(v)<=1_000_000;
function matrix(values:readonly number[]):number[]{if(values.length!==6||!values.every(finite)||values[1]!==0||values[2]!==0||values[0]===0||values[3]===0)return fail();return [...values];}
function textMatrix(values:readonly number[]):number[]{if(values.length!==6||!values.every(finite)||!values[0]||!values[3]||values[1]!==0||Math.abs(values[2]/values[0])>1)return fail();return [...values];}
function multiply(a:number[],b:number[]):number[]{return matrix([a[0]*b[0],0,0,a[3]*b[3],a[0]*b[4]+a[4],a[3]*b[5]+a[5]]);}
interface State{ctm:number[];size:number}
interface Paint{index:number;ctm:number[];size:number;linear:number[]}
/** Parallel numeric trace only. Existing complete scoped parser owns operator admission. */
export function originalTextDecompositions(text:string,ops:{fnArray:number[];argsArray:any[][]},allowHorizontalShear=false):ReadonlyMap<number,TextDecomposition>{
 if(ops.fnArray.length>100000||ops.fnArray.length!==ops.argsArray.length)return fail();
 const raw:Paint[]=[],decoded:Paint[]=[];
 let state:State={ctm:identity(),size:0},linear=[1,0,0,1],stack:State[]=[],inText=false;
 const save=()=>{if(stack.length>=100000)return fail();stack.push({ctm:[...state.ctm],size:state.size});};
 const restore=()=>{if(!stack.length)return fail();state=stack.pop()!;};
 const font=(size:unknown)=>{if(typeof size!=='number'||!Number.isFinite(size)||size<=0||size>144)return fail();state.size=size;};
 const paint=(list:Paint[],index:number)=>{if(!inText||!state.size)return fail();list.push({index,ctm:[...state.ctm],size:state.size,linear:[...linear]});};
 for(const op of originalOperators(text,classifyScopedMarkedDictionary)){
  const args=op.args;
  if(op.word==='q'){if(inText)return fail();save();}else if(op.word==='Q'){if(inText)return fail();restore();}else if(op.word==='cm')state.ctm=multiply(state.ctm,matrix(args as number[]));
  else if(op.word==='BT'){if(inText)return fail();inText=true;linear=[1,0,0,1];}else if(op.word==='ET'){if(!inText)return fail();inText=false;}
  else if(op.word==='Tf')font(args[1]);else if(op.word==='Tm'){if(!inText)return fail();linear=(allowHorizontalShear?textMatrix:matrix)(args as number[]).slice(0,4);}
  else if(op.word==='Tj'||op.word==='TJ')paint(raw,op.index);
  // Td/TD/T*/TL/TJ advances affect translation, never the retained linear matrix.
 }
 if(inText||stack.length)return fail();state={ctm:identity(),size:0};linear=[1,0,0,1];stack=[];
 for(let i=0;i<ops.fnArray.length;i++){const op=ops.fnArray[i],a=ops.argsArray[i];
  if(op===OPS.save){if(inText)return fail();save();}else if(op===OPS.restore){if(inText)return fail();restore();}else if(op===OPS.transform)state.ctm=multiply(state.ctm,matrix(a));
  else if(op===OPS.beginText){if(inText)return fail();inText=true;linear=[1,0,0,1];}else if(op===OPS.endText){if(!inText)return fail();inText=false;}
  else if(op===OPS.setFont)font(a[1]);else if(op===OPS.setTextMatrix){if(!inText)return fail();linear=(allowHorizontalShear?textMatrix:matrix)(a.length===1?Array.from(a[0]):a).slice(0,4);}
  else if(op===OPS.showText||op===OPS.showSpacedText)paint(decoded,i);
  else if(op===OPS.paintFormXObjectBegin||op===OPS.paintFormXObjectEnd||op===OPS.nextLineShowText||op===OPS.nextLineSetSpacingShowText)return fail();
 }
 if(inText||stack.length||raw.length!==decoded.length)return fail();const result=new Map<number,TextDecomposition>();
 for(let i=0;i<raw.length;i++){const a=raw[i],d=decoded[i];
  // Pinned PDF.js stores Tm as Float32Array; do not use a free tolerance.
  if(a.size!==d.size||a.ctm.some((v,k)=>v!==d.ctm[k])||a.linear.some((v,k)=>v!==d.linear[k]&&Math.fround(v)!==d.linear[k]))return fail();
  originalHorizontalShear(d.ctm,d.linear);
  const effective=d.size*(d.ctm[0]*d.linear[0]);if(!Number.isFinite(effective)||effective<=0||effective>200||Math.abs(d.ctm[0]*d.linear[0]-d.ctm[3]*d.linear[3])>.000001)return fail();
  result.set(d.index,Object.freeze({ctm:Object.freeze(a.ctm),nominalFontSize:a.size,linearTextMatrix:Object.freeze(a.linear),effectiveFontSize:effective,rawOperatorIndex:a.index,operatorIndex:d.index}));
 }
 return result;
}
