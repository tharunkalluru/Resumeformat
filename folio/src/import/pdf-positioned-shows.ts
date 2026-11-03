import {OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {originalOperators} from './pdf-image-trace';
import {classifyScopedMarkedDictionary} from './pdf-scoped-paint';
import {originalAdjustedParts,originalStringBytes} from './pdf-atomic-paint';
import {FolioError} from '../core/errors';

export interface PositionedSourceShow {
 readonly rawOperatorIndex:number;readonly operatorIndex:number;readonly resource:string;
 readonly characterSpacing:number;readonly kind:'Tj'|'TJ';readonly codes:readonly number[];
 readonly parts:readonly (number|readonly number[])[];
}
const fail=():never=>{throw new FolioError('PDF_POSITIONED_SHOW','The reset-positioned source shows are not completely owned.');};
/** Td changes the line matrix independently of the preceding show's advance.
 * Keep the original sequence: no cumulative translation is rounded or flattened.
 */
export function originalPositionedShows(text:string,ops:{fnArray:number[];argsArray:any[][]}):ReadonlyMap<number,PositionedSourceShow>{
 if(ops.fnArray.length>100000||ops.fnArray.length!==ops.argsArray.length)return fail();
 const decoded=ops.fnArray.flatMap((word,index)=>word===OPS.showText||word===OPS.showSpacedText?[index]:[]);
 const raw=originalOperators(text,classifyScopedMarkedDictionary,true,true);
 let resource='',tc=0,tw=0,tz=100,ts=0,tr=0,inside=false,reset=false,cursor=0,total=0;
 const stack:{resource:string;tc:number;tw:number;tz:number;ts:number;tr:number}[]=[],result=new Map<number,PositionedSourceShow>();
 for(const op of raw){
  if(op.word==='q')stack.push({resource,tc,tw,tz,ts,tr});
  else if(op.word==='Q'){const state=stack.pop();if(!state)return fail();({resource,tc,tw,tz,ts,tr}=state);}
  else if(op.word==='BT'){inside=true;reset=false;}
  else if(op.word==='ET'){inside=false;reset=false;}
  else if(op.word==='Tf'){const name=op.args[0];if(!name||typeof name!=='object'||!('name'in name))return fail();resource=name.name;}
  else if(['Tc','Tw','Tz','Ts','Tr'].includes(op.word)){
   const n=op.args[0];if(typeof n!=='number')return fail();
   if(op.word==='Tc')tc=n;else if(op.word==='Tw')tw=n;else if(op.word==='Tz')tz=n;else if(op.word==='Ts')ts=n;else tr=n;
  }else if(['Tm','Td','TD','T*'].includes(op.word))reset=true;
  else if(op.word==='Tj'||op.word==='TJ'){
   const operator=decoded[cursor++],sequence=ops.argsArray[operator]?.[0];
   if(!Array.isArray(sequence))return fail();
   if(!inside||!reset||!resource||tw!==0||tz!==100||ts!==0||tr!==0){reset=false;continue;}
   const a=op.args[0];if(op.args.length!==1||!a||typeof a!=='object')return fail();
   const parts=op.word==='Tj'&&'rawString'in a&&a.rawString!==undefined?[originalStringBytes(a.rawString)]:op.word==='TJ'&&'rawArray'in a&&a.rawArray!==undefined?originalAdjustedParts(a.rawArray):fail();
   const codes=sequence.filter(g=>typeof g!=='number').map(g=>g.originalCharCode);
   if(!codes.length||codes.some(c=>!Number.isSafeInteger(c)||c<0||c>65535)||(total+=sequence.length)>100000)return fail();
   const count=parts.reduce<number>((n,p)=>n+(typeof p==='number'?0:p.length),0),width=count===codes.length?1:count===codes.length*2?2:0;
   if(!width)return fail();let index=0;
   const qualified=parts.map(part=>{
    if(typeof part==='number'){if(sequence[index++]!==part)return fail();return part;}
    if(part.length%width)return fail();const values:number[]=[];
    for(let i=0;i<part.length;i+=width){const c=width===1?part[i]:part[i]*256+part[i+1],g=sequence[index++];if(!g||typeof g==='number'||g.originalCharCode!==c)return fail();values.push(c);}
    return Object.freeze(values);
   });
   if(index!==sequence.length)return fail();
   result.set(operator,Object.freeze({rawOperatorIndex:op.index,operatorIndex:operator,resource,characterSpacing:tc,kind:op.word,codes:Object.freeze(codes),parts:Object.freeze(qualified)}));reset=false;
  }
 }
 if(cursor!==decoded.length||inside||stack.length)return fail();return result;
}
