import {PDFArray,PDFDict,PDFDocument,PDFHexString,PDFName,PDFNull,PDFNumber,PDFRef,PDFString,type PDFObject} from 'pdf-lib';
import {FolioError} from '../core/errors';
export interface InternalDestination {pageNumber:number;mode:'XYZ'|'Fit'|'FitH'|'FitV'|'FitR'|'FitB'|'FitBH'|'FitBV';args:(number|null)[]}
const fail=():never=>{throw new FolioError('PDF_INTERNAL_DESTINATION','The internal link has no bounded destination on an original page.');};
const key=PDFName.of;
const nameBytes=(v:PDFObject):string=>{if(!(v instanceof PDFString||v instanceof PDFHexString||v instanceof PDFName))return fail();const b=v.asBytes();if(!b.length||b.length>1024)return fail();return Array.from(b,v=>v.toString(16).padStart(2,'0')).join('');};
/** Resolve only passive, document-local targets. No page graph is copied, and
 * no document action, external file or unresolved named destination is retained. */
export function resolveInternalDestination(document:PDFDocument,value:PDFObject):InternalDestination {
 let target=document.context.lookup(value);if(!target)return fail();
 if(target instanceof PDFString||target instanceof PDFHexString||target instanceof PDFName){
  const wanted=nameBytes(target),matches:PDFObject[]=[],names=new Set<string>(),seen=new Set<PDFDict>();let entries=0,nodes=0;
  const add=(name:PDFObject,destination:PDFObject)=>{const id=nameBytes(name);if(++entries>4096||names.has(id))return fail();names.add(id);if(id===wanted)matches.push(destination);return id;};
  const legacy=document.catalog.lookupMaybe(key('Dests'),PDFDict);if(legacy)for(const [name,dest]of legacy.entries())add(name,dest);
  const tree=document.catalog.lookupMaybe(key('Names'),PDFDict)?.get(key('Dests'));
  const walk=(object:PDFObject,depth=0):[string,string]=>{
   const node=document.context.lookup(object);if(!(node instanceof PDFDict)||depth>16||++nodes>4096||seen.has(node))return fail();seen.add(node);
   if(node.keys().some(k=>!['Names','Kids','Limits'].includes(k.decodeText()))||node.has(key('Names'))===node.has(key('Kids')))return fail();
   let first:string|undefined,last:string|undefined;
   if(node.has(key('Names'))){const list=node.lookupMaybe(key('Names'),PDFArray);if(!list||!list.size()||list.size()%2||list.size()>8192)return fail();for(let i=0;i<list.size();i+=2){const name=document.context.lookup(list.get(i));if(!(name instanceof PDFString||name instanceof PDFHexString))return fail();const id=add(name,list.get(i+1));if(last!==undefined&&id<=last)return fail();first??=id;last=id;}}
   else {const kids=node.lookupMaybe(key('Kids'),PDFArray);if(!kids||!kids.size()||kids.size()>4096)return fail();for(const child of kids.asArray()){const [lo,hi]=walk(child,depth+1);if(last!==undefined&&lo<=last)return fail();first??=lo;last=hi;}}
   if(!first||!last)return fail();if(node.has(key('Limits'))){const limits=node.lookupMaybe(key('Limits'),PDFArray);if(!limits||limits.size()!==2||nameBytes(document.context.lookup(limits.get(0))!)!==first||nameBytes(document.context.lookup(limits.get(1))!)!==last)return fail();}
   return [first,last];
  };
  if(tree)walk(tree);if(matches.length!==1)return fail();target=document.context.lookup(matches[0]);
 }
 if(target instanceof PDFDict){if(target.keys().length!==1||!target.has(key('D')))return fail();target=target.lookup(key('D'));}
 if(!(target instanceof PDFArray)||target.size()<2||target.size()>6)return fail();
 const page=target.get(0);if(!(page instanceof PDFRef))return fail();const pageNumber=document.getPages().findIndex(p=>p.ref.toString()===page.toString())+1;if(!pageNumber)return fail();
 const kind=target.lookup(1);if(!(kind instanceof PDFName))return fail();const mode=kind.decodeText() as InternalDestination['mode'],arity={XYZ:3,Fit:0,FitH:1,FitV:1,FitR:4,FitB:0,FitBH:1,FitBV:1}[mode];if(arity===undefined||target.size()!==arity+2)return fail();
 const args=target.asArray().slice(2).map(v=>{v=document.context.lookup(v)??fail();if(v===PDFNull&&mode!=='FitR')return null;if(!(v instanceof PDFNumber)||!Number.isFinite(v.asNumber())||Math.abs(v.asNumber())>1_000_000)return fail();return v.asNumber();});
 if(mode==='XYZ'&&args[2]!==null&&args[2]<0||mode==='FitR'&&(!(args[0]!<args[2]!)||!(args[1]!<args[3]!)))return fail();
 return {pageNumber,mode,args};
}
