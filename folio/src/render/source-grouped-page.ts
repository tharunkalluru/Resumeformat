import {installSourceColor} from './source-color';
import {loadSourceFont} from '../layout/source-fonts';
import {PDFBool,PDFDict,PDFDocument,PDFName,PDFNumber,PDFOperator,type PDFOperatorNames,type PDFPage,type PDFFont} from 'pdf-lib';
import {canonicalJson,type ContentSnapshot,type SourceFontAsset,type SourcePositionedGlyph,type TemplatePage,type TextRegion} from '../core/model';
import {sourceGlyphs} from '../core/source-graph';
import {FolioError} from '../core/errors';
import {originalOperators,originalPageContent} from '../import/pdf-image-trace';
import {classifyScopedMarkedDictionary} from '../import/pdf-scoped-paint';
import type {CapturedScopedPage} from '../import/pdf-scoped-source';
import type {PositionedSourceShow} from '../import/pdf-positioned-shows';

type Operation={readonly sourceColor?:import('../core/model').SourceScopedColor;readonly word:string;readonly args:readonly string[];readonly fontId?:string;readonly graphics?:Readonly<Record<string,number|boolean|string>>;readonly owner?:string;readonly show?:PositionedSourceShow;readonly cids?:readonly number[]};
interface Owner {readonly region:TextRegion;readonly operators:readonly number[];readonly first:PositionedSourceShow;readonly font:SourceFontAsset;readonly baseline:ContentSnapshot['blocks'][number]}
export interface GroupedPagePlan {readonly pageId:string;readonly sourceSha256:string;readonly operations:readonly Operation[]}
const minted=new WeakSet<GroupedPagePlan>();
const planOwners=new WeakMap<GroupedPagePlan,ReadonlyMap<string,Owner>>();
const fail=(detail:string):never=>{throw new FolioError('PDF_GROUPED_SOURCE','Reset-positioned source replay is unavailable: '+detail);};
const numeric=new Set(['cm','Tm','Td','TD','TL','Tc','Tw','Tz','Ts','Tr','rg','g','RG','G','w','J','j','M','re','m','l']);
const empty=new Set(['q','Q','BT','ET','T*','h','f','F','f*','S','W','W*','n']);
/** Compile admitted operators, fonts and selectors into a fresh page.
 * No source page, content stream or resource dictionary is copied into output.
 * Relative Td stays relative, including those whose show is replaced.
 */
export async function captureGroupedPagePlan(bytes:Uint8Array,pageNumber:number,page:TemplatePage,fonts:readonly SourceFontAsset[],captured:CapturedScopedPage,baseline:ContentSnapshot,documentScoped=false):Promise<GroupedPagePlan>{
 const document=await PDFDocument.load(new Uint8Array(bytes)),original=document.getPages()[pageNumber-1],resources=original.node.Resources();
 const operators=originalOperators(originalPageContent(document,pageNumber,true),classifyScopedMarkedDictionary,true,true);
 if(operators.length>100000||!resources)return fail('operator/resource budget');
 if(resources.lookupMaybe(PDFName.of('XObject'),PDFDict)?.entries().length)return fail('unused or painted XObject resources need their own compositing proof');
 const fontCopies=new Map<string,SourceFontAsset>();
 const byRaw=new Map<number,{region:TextRegion;show:PositionedSourceShow;cids:number[]}>(),owners=new Map<string,Owner>();
 let count=0;
 for(const region of page.regions){
  if(region.kind==='image'||region.kind==='sourceShape')return fail('mixed image or outline paint');
  if(region.kind!=='text')continue;
  const font=fonts.find(f=>f.id===region.style.sourceFontId),block=baseline.blocks.find(b=>b.id===region.contentId);
  if(!font||font.format!=='truetype'||!(font.sourceVersion===4||font.sourceVersion===5||font.sourceVersion===10||documentScoped&&font.sourceVersion===7)||!font.originalProgram||!block)return fail('original font or baseline owner');
  const maps=new Map(font.glyphMap.map(m=>[m.cid,m])),shows=new Map<number,SourcePositionedGlyph[]>();
  for(const glyph of sourceGlyphs(region)){if(++count>100000)return fail('glyph budget');const list=shows.get(glyph.operatorIndex)??[];list.push(glyph);shows.set(glyph.operatorIndex,list);}
  const owned:number[]=[];
  for(const [operator,glyphs]of shows){
   const show=captured.positionedShows?.get(operator),physical=glyphs.filter(g=>!g.inferredGap),raw=captured.byOperator.get(operator);
   if(!show||raw?.kind!=='text'||show.rawOperatorIndex!==raw.rawOperatorIndex||captured.fontRefs.get(show.resource)!==font.originalProgram.pdfFontRef||show.codes.length!==physical.length||show.codes.some((code,i)=>maps.get(physical[i].cid)?.originalCharCode!==code)||byRaw.has(show.rawOperatorIndex))return fail('each reset-positioned show needs one complete glyph owner');
   byRaw.set(show.rawOperatorIndex,{region,show,cids:physical.map(g=>g.cid)});owned.push(operator);
  }
  const first=captured.positionedShows!.get(owned[0])!;let fontCopy=fontCopies.get(font.id);if(!fontCopy){fontCopy=structuredClone(font);fontCopies.set(font.id,fontCopy);}
  owners.set(region.id,Object.freeze({region:Object.freeze(structuredClone(region)),operators:Object.freeze(owned),first,font:fontCopy,baseline:Object.freeze(structuredClone(block))}));
 }
 if(byRaw.size!==[...captured.byOperator.values()].filter(p=>p.kind==='text').length)return fail('complete text paint coverage');
 const operations:Operation[]=[];let fillComponents=1;const colorStack:number[]=[];
 for(const op of operators){
  let next:Operation;if(op.word==='q')colorStack.push(fillComponents);else if(op.word==='Q'){const restored=colorStack.pop();if(restored===undefined)return fail('color state stack');fillComponents=restored;}
  if(op.word==='Tj'||op.word==='TJ'){
   const owner=byRaw.get(op.index);if(!owner)return fail('missing raw show');
   next={word:op.word,args:[],owner:owner.region.id,show:owner.show,cids:Object.freeze(owner.cids)};
  }else if(op.word==='Tf'){
   const arg=op.args[0],size=op.numberLexemes?.[1];
   const resource=arg&&typeof arg==='object'&&'name'in arg?arg.name:'',ref=captured.fontRefs.get(resource),font=fonts.find(f=>'originalProgram'in f&&f.originalProgram?.pdfFontRef===ref);
   if(!font||!size||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(size)||size.length>64)return fail('raw font selection');
   next={word:'Tf',args:[size],fontId:font.id};
  }else if(op.word==='gs'){
   const arg=op.args[0],name=arg&&typeof arg==='object'&&'name'in arg?arg.name:'',dict=resources.lookupMaybe(PDFName.of('ExtGState'),PDFDict)?.lookupMaybe(PDFName.of(name),PDFDict);
   if(!dict)return fail('graphics resource');const graphics:Record<string,number|boolean|string>={};
   for(const [key,raw]of dict.entries()){
    const value=dict.context.lookup(raw),k=key.decodeText();if(k==='Type'&&value instanceof PDFName&&value.decodeText()==='ExtGState')continue;
    if(['LW','LC','LJ','ML'].includes(k)&&value instanceof PDFNumber)graphics[k]=value.asNumber();
    else if(['ca','CA'].includes(k)&&value instanceof PDFNumber&&(value.asNumber()===1||k==='ca'&&value.asNumber()===0))graphics[k]=value.asNumber();
    else if(['BM','SMask'].includes(k)&&value instanceof PDFName&&value.decodeText()===(k==='BM'?'Normal':'None'))graphics[k]=value.decodeText();
    else if(['SA','AAPL:AA'].includes(k)&&value instanceof PDFBool)graphics[k]=value.asBoolean();
    else return fail('unsupported graphics resource field');
   }
   next={word:'gs',args:[],graphics:Object.freeze(graphics)};
  }else if(documentScoped&&op.word==='cs'&&op.args.length===1&&typeof op.args[0]==='object'&&'name'in op.args[0]&&!['DeviceRGB','DeviceGray'].includes(op.args[0].name)){
   const name=op.args[0].name,paint=[...captured.byOperator.values()].find(p=>p.kind==='text'&&p.color.space==='ICCBased'&&p.color.resourceName===name);
   if(!paint||paint.kind!=='text'||paint.color.space!=='ICCBased')return fail('unproved original ICC selection');
   next={word:'cs',args:[],sourceColor:structuredClone(paint.color)};fillComponents=3;
  }else if(documentScoped&&['sc','scn'].includes(op.word)){
   if(op.args.length!==fillComponents||op.args.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>1)||!op.numberLexemes)return fail('unproved original color components');
   next={word:op.word,args:op.numberLexemes.map(t=>{if(!t||t.length>64)return fail('ICC numeric operands');return t;})};
  }else if(numeric.has(op.word)){
   const args=op.args.map((n,i)=>{const token=op.numberLexemes?.[i];if(typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>1e6||!token||token.length>64||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token))return fail('numeric source operands');return token;});
   next={word:op.word,args};
  }else if(empty.has(op.word)&&op.args.length===0)next={word:op.word,args:[]};
  else if(['cs','CS'].includes(op.word)&&op.args.length===1&&typeof op.args[0]==='object'&&'name'in op.args[0]&&['DeviceRGB','DeviceGray'].includes(op.args[0].name))next={word:op.word,args:[PDFName.of(op.args[0].name).toString()]};
  else if(['BMC','BDC','EMC'].includes(op.word))continue;
  else return fail('unsupported operator '+op.word);
  if(op.word==='g')fillComponents=1;else if(op.word==='rg')fillComponents=3;else if(op.word==='cs'&&typeof op.args[0]==='object'&&'name'in op.args[0]&&['DeviceRGB','DeviceGray'].includes(op.args[0].name))fillComponents=op.args[0].name==='DeviceRGB'?3:1;
  operations.push(Object.freeze({...next,args:Object.freeze([...next.args])}));
 }
 const plan=Object.freeze({pageId:page.id,sourceSha256:fonts[0].sourceSha256,operations:Object.freeze(operations)});
 minted.add(plan);planOwners.set(plan,owners);return plan;
}
const paintRuns=(block:ContentSnapshot['blocks'][number])=>block.runs.map(({sourceFactIds:_,...r})=>r);
export function groupedWordingEligible(plan:GroupedPagePlan,regionId:string):boolean{
 if(!minted.has(plan))return false;const owner=planOwners.get(plan)?.get(regionId);if(!owner)return false;
 const {region,font,first,baseline}=owner,layout=region.sourceLayout;
 return !!region.sourceScopedPaint?.showGroup&&layout?.version===1&&layout.anchor==='start'&&!Array.from(sourceGlyphs(region)).some(g=>g.inferredGap)&&first.characterSpacing===0&&!(typeof first.parts[0]==='number'&&first.parts[0]!==0)&&baseline.runs.length===1&&!baseline.runs[0].href&&!baseline.runs[0].underline&&!baseline.sourceParagraphGroupId&&font.format==='truetype'&&(font.sourceVersion===4||font.sourceVersion===5||region.sourceScopedPaint?.version==='source-scoped-occurrence-v4'&&font.sourceVersion===7);
}
export function paintGroupedSourcePage(plan:GroupedPagePlan,document:PDFDocument,page:PDFPage,embedded:ReadonlyMap<string,PDFFont>,content:ContentSnapshot,approved:boolean,profile?:import('../core/model').SourceColorProfile):void{
 if(!minted.has(plan))return fail('unminted source plan');
 const changes=new Map<string,number[]>(),consumed=new Set<string>(),fonts=new Map<string,PDFName>();
 for(const [id,owner]of planOwners.get(plan)!){
  const block=content.blocks.find(b=>b.id===owner.region.contentId);if(!block)return fail('missing current block');
  if(canonicalJson(paintRuns(block))===canonicalJson(paintRuns(owner.baseline)))continue;
  if(!approved||!groupedWordingEligible(plan,id)||block.runs.length!==1)return fail('unsupported changed grouped owner');
  const strip=({text:_,sourceFactIds:__,...r}:typeof block.runs[number])=>r;
  if(canonicalJson(strip(block.runs[0]))!==canonicalJson(strip(owner.baseline.runs[0]))||/[\r\n]/.test(block.runs[0].text)||block.runs[0].text.length>10000)return fail('fixed original style or line changed');
  const face=loadSourceFont(owner.font),cids:number[]=[];
  for(const char of block.runs[0].text){const mapping=face.mapping(char);if(!mapping||!mapping.originalCharCode||!mapping.originalGlyphId||!Number.isFinite(mapping.pdfWidth)||mapping.pdfWidth<=0)return fail('unproved current selector');cids.push(mapping.cid);}
  changes.set(id,cids);
 }
 const hex=(cids:readonly number[])=>'<'+cids.map(cid=>cid.toString(16).padStart(4,'0')).join('')+'>';
 for(const op of plan.operations){
  let args=[...op.args],word=op.word;
  if(op.sourceColor){const key=installSourceColor(document,page,op.sourceColor,profile);if(!key)return fail('ICC output resource');args=[key.toString()];}
  else if(op.fontId){let key=fonts.get(op.fontId);if(!key){const font=embedded.get('source:'+op.fontId);if(!font)return fail('installed original font');key=page.node.newFontDictionary('FolioSource',font.ref);fonts.set(op.fontId,key);}args=[key.toString(),args[0]];}
  else if(op.graphics)args=[page.node.newExtGState('SourceOwnedState',document.context.register(document.context.obj(Object.fromEntries(Object.entries(op.graphics).map(([k,v])=>[k,typeof v==='string'?PDFName.of(v):v]))))).toString()];
  else if(op.owner&&op.show&&op.cids){
   const changed=changes.get(op.owner);
   if(changed){if(consumed.has(op.owner))continue;consumed.add(op.owner);word='Tj';args=[hex(changed)];}
   else{let cursor=0;const parts=op.show.parts.map(part=>typeof part==='number'?String(part):hex(part.map(()=>op.cids![cursor++])));if(cursor!==op.cids.length)return fail('source selector consumption');args=op.show.kind==='TJ'?['['+parts.join(' ')+']']:[parts[0]];}
  }
  page.pushOperators(PDFOperator.of(word as PDFOperatorNames,args));
 }
 if(consumed.size!==changes.size)return fail('changed show consumption');
}
