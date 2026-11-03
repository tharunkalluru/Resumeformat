import {packSpacingGlyphs,unpackSpacingGlyphs} from './source-spacing-codec';
import {MAX_SOURCE_PAGES} from './model';
import {validScopedV2} from './source-color-schema';
import {FolioError} from './errors';
import {exactSourceTuple} from './source-graph';

const TAG='folio-record-tuples-v1';
const fail=():never=>{throw new FolioError('PROJECT_RECORD_TRANSPORT','The project record transport is invalid or exceeds its bounded metadata limits.');};
type RecordValue=Record<string,unknown>;
const record=(v:unknown):v is RecordValue=>!!v&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const present=(v:RecordValue,k:string)=>Object.hasOwn(v,k)&&v[k]!==undefined;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const integer=(v:unknown,min:number,max=Number.MAX_SAFE_INTEGER)=>finite(v)&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const string=(v:unknown,max:number,min=0):v is string=>typeof v==='string'&&v.length>=min&&v.length<=max;
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f\d]{64}$/.test(v);
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/;
const dense=(v:unknown,max:number):v is unknown[]=>Array.isArray(v)&&v.length<=max&&exactSourceTuple(v,[v.length]);

function encodeId(value:string):string{
 if(!uuid.test(value))return '='+value;
 const hex=value.replaceAll('-','');let bytes='';for(let i=0;i<32;i+=2)bytes+=String.fromCharCode(Number.parseInt(hex.slice(i,i+2),16));
 return '~'+btoa(bytes).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}
function decodeId(value:unknown):string{
 if(typeof value!=='string')return fail();
 if(value.startsWith('=')){const literal=value.slice(1);if(!string(literal,150,1)||uuid.test(literal))return fail();return literal;}
 if(!/^~[a-zA-Z0-9_-]{22}$/.test(value))return fail();
 let bytes:string;try{bytes=atob(value.slice(1).replaceAll('-','+').replaceAll('_','/')+'==');}catch{return fail();}
 if(bytes.length!==16)return fail();let hex='';for(let i=0;i<16;i++)hex+=bytes.charCodeAt(i).toString(16).padStart(2,'0');
 const literal=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
 if(encodeId(literal)!==value)return fail();return literal;
}

interface Budget{regions:number;glyphs:number;blocks:number;runs:number;refs:number;ids:number}
type Check=(v:unknown,encoded:boolean,b:Budget)=>void;
type Field={name:string;check:Check;encode?:(v:unknown)=>unknown;decode?:(v:unknown)=>unknown};
const field=(name:string,check:Check,encode?:Field['encode'],decode?:Field['decode']):Field=>({name,check,encode,decode});
const check=(predicate:(v:unknown)=>boolean):Check=>(v)=>{if(!predicate(v))fail();};
const idCheck:Check=(v,encoded,b)=>{if(++b.ids>200000)fail();if(encoded)decodeId(v);else if(!string(v,150,1))fail();};
const idField=(name:string)=>field(name,idCheck,v=>encodeId(v as string),decodeId);
const textCheck=(max:number,min=0)=>check(v=>string(v,max,min));
const enumCheck=(values:readonly unknown[])=>check(v=>values.includes(v));
const bool=check(v=>typeof v==='boolean'),point=check(finite),sha=check(hash);
const idList:Check=(v,encoded,b)=>{if(!dense(v,100))return fail();b.refs+=v.length;if(b.refs>200000)fail();for(const id of v)idCheck(id,encoded,b);};
const idsField=(name:string)=>field(name,idList,v=>(v as string[]).map(encodeId),v=>(v as unknown[]).map(decodeId));

class Shape{
 constructor(readonly required:Field[],readonly optional:Field[]=[]){ }
 get(value:unknown,name:string,encoded:boolean):unknown{
  if(!encoded)return (value as RecordValue)[name];const tuple=value as unknown[];
  const fixed=this.required.findIndex(f=>f.name===name);if(fixed>=0)return tuple[fixed];
  const index=this.optional.findIndex(f=>f.name===name);if(index<0)return undefined;
  const mask=tuple[this.required.length] as number;if(!(mask&2**index))return undefined;
  let offset=this.required.length+1;for(let i=0;i<index;i++)if(mask&2**i)offset++;return tuple[offset];
 }
 validate(value:unknown,encoded:boolean,b:Budget):void{
  if(encoded){if(!Array.isArray(value))return fail();let count=this.required.length;
   if(this.optional.length){const mask=value[count];if(!integer(mask,0,2**this.optional.length-1))return fail();count++;for(let i=0;i<this.optional.length;i++)if(mask&2**i)count++;}
   if(!exactSourceTuple(value,[count]))return fail();
  }else{if(!record(value))return fail();const allowed=[...this.required,...this.optional].map(f=>f.name);for(const key of Reflect.ownKeys(value))if(typeof key!=='string'||!allowed.includes(key))return fail();for(const f of this.required)if(!Object.hasOwn(value,f.name))return fail();}
  for(const f of this.required)f.check(this.get(value,f.name,encoded),encoded,b);
  for(let i=0;i<this.optional.length;i++){const f=this.optional[i],v=this.get(value,f.name,encoded);if(encoded?((value as number[])[this.required.length]&2**i)!==0:v!==undefined)f.check(v,encoded,b);}
 }
 encode(value:RecordValue):unknown[]{
  const output=this.required.map(f=>f.encode?f.encode(value[f.name]):value[f.name]);
  if(this.optional.length){let mask=0;for(let i=0;i<this.optional.length;i++)if(present(value,this.optional[i].name))mask|=2**i;output.push(mask);for(const f of this.optional)if(present(value,f.name))output.push(f.encode?f.encode(value[f.name]):value[f.name]);}return output;
 }
 decode(value:unknown[]):RecordValue{
  const output:RecordValue={};for(const f of [...this.required,...this.optional]){const v=this.get(value,f.name,true);if(v!==undefined)output[f.name]=f.decode?f.decode(v):v;}return output;
 }
}
const nested=(name:string,shape:Shape):Field=>field(name,(v,e,b)=>shape.validate(v,e,b),v=>shape.encode(v as RecordValue),v=>shape.decode(v as unknown[]));
const rect=new Shape(['x','y','width','height'].map(k=>field(k,k==='width'||k==='height'?check(v=>finite(v)&&v>=0&&v<=5000):point)));
const baselineStyle=new Shape([field('fontWeight',enumCheck([400,700])),field('italic',bool)]);
const style=new Shape([
 field('fontFamily',enumCheck(['sans','serif','mono','times'])),field('fontSize',check(v=>finite(v)&&v>0&&v<=200)),field('fontWeight',check(v=>integer(v,1,1000))),field('italic',bool),field('color',check(v=>typeof v==='string'&&/^#[a-f\d]{6}$/i.test(v))),field('lineHeight',check(v=>finite(v)&&v>0&&v<=500)),field('alignment',enumCheck(['left','center','right']))
],[field('baselineOffset',point),idField('sourceFontId')]);
const glyphArray:Check=(v,_e,b)=>{if(!dense(v,100000)||!v.length)return fail();b.glyphs+=v.length;if(b.glyphs>100000)fail();};
const layout=new Shape([
 field('version',enumCheck([1,2,3,4,5])),field('sourceSha256',sha),field('baselineRunsHash',sha),field('anchor',enumCheck(['start','end'])),field('startX',point),field('endX',point),field('baseline',point),field('fontSize',check(v=>finite(v)&&v>0&&v<=144)),field('glyphs',glyphArray)
],[field('glyphEncoding',enumCheck(['shared-font-tuple-v1'])),nested('baselineStyle',baselineStyle),field('characterSpacing',point),field('editPolicy',enumCheck(['scalarCovered','baselineOnly'])),field('editReason',enumCheck(['sourceLigature','nativeMappingUnproved','nonPositiveStep'])),field('shearX',check(v=>finite(v)&&v!==0&&Math.abs(v)<=1)),field('showSpacing',check(v=>dense(v,100000)&&v.length>=2&&v.every(p=>exactSourceTuple(p,[2])&&integer(p[0],0,100000)&&finite(p[1]))))]);
function validateLayout(v:unknown,e:boolean,b:Budget){
 layout.validate(v,e,b);const get=(k:string)=>layout.get(v,k,e);const version=get('version'),policy=get('editPolicy'),reason=get('editReason');
 if(version===1&&(get('baselineStyle')!==undefined||get('characterSpacing')!==undefined||policy!==undefined||reason!==undefined)||version===2&&(get('baselineStyle')===undefined||policy===undefined||get('characterSpacing')!==undefined||reason==='nonPositiveStep')||version===3&&(get('characterSpacing')===undefined||policy===undefined||get('baselineStyle')!==undefined||reason==='sourceLigature'))return fail();
 if(version!==4&&get('shearX')!==undefined||version===4&&(get('shearX')===undefined||get('characterSpacing')===undefined||policy!=='baselineOnly'||reason!==undefined||get('baselineStyle')!==undefined))return fail();
 if((version===5)!==(get('showSpacing')!==undefined)||version===5&&(policy!=='baselineOnly'||reason!==undefined||get('baselineStyle')!==undefined||get('characterSpacing')!==undefined))return fail();
 const shared=get('glyphEncoding')!==undefined;
 for(const g of get('glyphs') as unknown[]){
  if(shared){if(!exactSourceTuple(g,[5,6])||!integer(g[0],1,65535)||!string(g[1],32,1)||!finite(g[2])||!finite(g[3])||g[3]<0||g[3]>2000||!integer(g[4],0,100000)||g.length===6&&g[5]!==1)return fail();}
  else{if(!record(g)||Reflect.ownKeys(g).some(k=>typeof k!=='string'||!['fontId','cid','unicode','x','advance','operatorIndex','inferredGap'].includes(k))||!string(g.fontId,150,1)||!integer(g.cid,1,65535)||!string(g.unicode,32,1)||!finite(g.x)||!finite(g.advance)||g.advance<0||g.advance>2000||!integer(g.operatorIndex,0,100000)||present(g,'inferredGap')&&g.inferredGap!==true)return fail();}
 }
}
const fullKeys=(v:unknown,required:string[],optional:string[]=[]):v is RecordValue=>record(v)&&required.every(k=>Object.hasOwn(v,k))&&Reflect.ownKeys(v).every(k=>typeof k==='string'&&(required.includes(k)||optional.includes(k)));
const rectTuple=(v:unknown)=>exactSourceTuple(v,[4])&&finite(v[0])&&finite(v[1])&&finite(v[2])&&v[2]>=0&&v[2]<=5000&&finite(v[3])&&v[3]>=0&&v[3]<=5000;
const matrix=(v:unknown)=>exactSourceTuple(v,[6])&&v.every(finite);
const scopedColor=(space:unknown,components:unknown)=>['DeviceRGB','DeviceGray'].includes(space as string)&&exactSourceTuple(components,[space==='DeviceRGB'?3:1])&&components.every(n=>finite(n)&&n>=0&&n<=1);
/** Same full evidence grammar as the independent scoped codec; no records expand here. */
function scopedClipCount(v:unknown):number{
 if(record(v)&&['source-scoped-occurrence-v2','source-scoped-occurrence-v3','source-scoped-occurrence-v4','source-scoped-occurrence-v5'].includes(String(v.version))){if(!validScopedV2(v))return fail();return (v.clipStack as unknown[]).length*(['source-scoped-occurrence-v3','source-scoped-occurrence-v4','source-scoped-occurrence-v5'].includes(String(v.version))?(v.showGroup as {operators:unknown[]}).operators.length:1);}
 if(Array.isArray(v)){
  if(!exactSourceTuple(v,[11])||v[0]!=='scoped-paint-tuple-v1'||!['text','fillRect','strokeRule'].includes(v[1] as string)||!hash(v[2])||!integer(v[3],1,MAX_SOURCE_PAGES)||!integer(v[4],0,100000)||!integer(v[5],0,100000)||!exactSourceTuple(v[6],[2])||!scopedColor(v[6][0],v[6][1])||!dense(v[7],64)||!rectTuple(v[8])||!hash(v[9])||!integer(v[10],0,100000))return fail();
  for(const c of v[7])if(!exactSourceTuple(c,[6])||!integer(c[0],0,100000)||!integer(c[1],0,100000)||!integer(c[2],0,100000)||!['nonzero','evenodd'].includes(c[3] as string)||!matrix(c[4])||!rectTuple(c[5]))return fail();return v[7].length;
 }
 if(!fullKeys(v,['version','kind','sourceSha256','pageNumber','rawOperatorIndex','operatorIndex','color','clipStack','effectiveClip','stateHash'],['derivedGaps'])||v.version!=='source-scoped-occurrence-v1'||!['text','fillRect','strokeRule'].includes(v.kind as string)||!hash(v.sourceSha256)||!integer(v.pageNumber,1,MAX_SOURCE_PAGES)||!integer(v.rawOperatorIndex,0,100000)||!integer(v.operatorIndex,0,100000)||!fullKeys(v.color,['space','components'])||!scopedColor(v.color.space,v.color.components)||!dense(v.clipStack,64)||!hash(v.stateHash))return fail();
 const b:Budget={regions:0,glyphs:0,blocks:0,runs:0,refs:0,ids:0};rect.validate(v.effectiveClip,false,b);
 for(const c of v.clipStack){if(!fullKeys(c,['pathOperatorIndex','clipOperatorIndex','endOperatorIndex','fillRule','constructionCtm','bounds'])||!integer(c.pathOperatorIndex,0,100000)||!integer(c.clipOperatorIndex,0,100000)||!integer(c.endOperatorIndex,0,100000)||!['nonzero','evenodd'].includes(c.fillRule as string)||!matrix(c.constructionCtm))return fail();rect.validate(c.bounds,false,b);}
 if(present(v,'derivedGaps')&&(!fullKeys(v.derivedGaps,['version','count'])||v.derivedGaps.version!=='pinned-extractor-gap-v1'||!integer(v.derivedGaps.count,1,100000)))return fail();return v.clipStack.length;
}
const scoped:Check=v=>{scopedClipCount(v);};
const textRegion=new Shape([
 field('kind',enumCheck(['text'])),idField('id'),idField('pageId'),nested('bounds',rect),field('order',point),idField('contentId'),field('role',enumCheck(['heading','body','bullet','contact'])),nested('style',style),field('sourceLocator',textCheck(1000))
],[field('sourceLayout',validateLayout,v=>layout.encode(v as RecordValue),v=>layout.decode(v as unknown[])),field('sourceScopedPaint',scoped)]);
const run=new Shape([field('text',textCheck(100000))],[field('bold',bool),field('italic',bool),field('underline',bool),field('href',textCheck(2048)),idsField('sourceFactIds')]);
const runs:Check=(v,e,b)=>{if(!dense(v,1000))return fail();b.runs+=v.length;if(b.runs>100000)fail();for(const r of v)run.validate(r,e,b);};
const blockFields=[idField('id'),field('runs',runs,v=>(v as RecordValue[]).map(r=>run.encode(r)),v=>(v as unknown[][]).map(r=>run.decode(r))),idsField('sourceFactIds')];
const legacyBlock=new Shape(blockFields),paragraphBlock=new Shape(blockFields,[idField('sourceParagraphGroupId')]);
// Preserve the original three-field wire tuple for every ungrouped saved block.
const block={
 validate(v:unknown,e:boolean,b:Budget){(e&&Array.isArray(v)&&v.length===3||!e&&record(v)&&!present(v,'sourceParagraphGroupId')?legacyBlock:paragraphBlock).validate(v,e,b);},
 encode(v:RecordValue){return (present(v,'sourceParagraphGroupId')?paragraphBlock:legacyBlock).encode(v);},
 decode(v:unknown[]){return (v.length===3?legacyBlock:paragraphBlock).decode(v);}
};
const fact=new Shape([idField('id'),field('text',textCheck(100000)),field('kind',enumCheck(['resume','careerNote','applicantEdit'])),field('locator',textCheck(1000)),field('confirmed',bool)]);

function nativeArtworkRecord(value:unknown):boolean {
 return record(value)&&record(value.template)&&value.template.importerVersion==='folio-import-v31'&&record(value.template.sourceCompositePages)&&value.template.sourceCompositePages.version==='original-native-composite-v10'&&dense(value.template.sourceFonts,32)&&value.template.sourceFonts.length>0&&value.template.sourceFonts.every(f=>record(f)&&f.sourceVersion===7);
}
function hasScoped(value:unknown):boolean{
 if(!record(value)||!record(value.template)||!Array.isArray(value.template.pages))return false;
 for(const page of value.template.pages)if(record(page)&&Array.isArray(page.regions))for(const r of page.regions)if(record(r)&&present(r,'sourceScopedPaint'))return true;
 return false;
}
/** Allocation-free graph expansion preflight; memory evidence is scanned but never encoded. */
function jsonBudget(v:unknown,depth=0,state={nodes:0,strings:0}):void{
 if(++state.nodes>2000000||depth>32)return fail();if(v===null||v===undefined||typeof v==='boolean')return;
 if(typeof v==='number'){if(!finite(v))fail();return;}
 if(typeof v==='string'){state.strings+=v.length;if(state.strings>4*1024*1024)fail();return;}
 if(Array.isArray(v)){if(!dense(v,200000))return fail();for(const item of v)jsonBudget(item,depth+1,state);return;}
 if(!record(v))return fail();for(const k of Reflect.ownKeys(v)){if(typeof k!=='string')return fail();state.strings+=k.length;if(state.strings>4*1024*1024)fail();jsonBudget(v[k],depth+1,state);}
}
function validateContent(v:unknown,e:boolean,b:Budget):void{
 if(!record(v)||Reflect.ownKeys(v).some(k=>k!=='revision'&&k!=='blocks')||!integer(v.revision,1)||!dense(v.blocks,4000))return fail();b.blocks+=v.blocks.length;if(b.blocks>56000)fail();for(const item of v.blocks)block.validate(item,e,b);
}
function preflight(value:unknown,e:boolean):asserts value is RecordValue{
 jsonBudget(value);if(!record(value)||!record(value.template)||!dense(value.template.pages,MAX_SOURCE_PAGES)||!value.template.pages.length)return fail();const b:Budget={regions:0,glyphs:0,blocks:0,runs:0,refs:0,ids:0};let shows=0,paints=0,clips=0,paintMode:'tuple'|'full'|undefined;
 for(const page of value.template.pages){if(!record(page)||!dense(page.regions,1000))return fail();b.regions+=page.regions.length;if(b.regions>1000)fail();
  for(const region of page.regions){let paint:unknown;
   if(e){if(Array.isArray(region)){textRegion.validate(region,true,b);paint=textRegion.get(region,'sourceScopedPaint',true);}else if(!record(region)||region.kind==='text')return fail();else paint=region.sourceScopedPaint;}
   else{if(!record(region))return fail();if(region.kind==='text')textRegion.validate(region,false,b);paint=region.sourceScopedPaint;}
   if(paint!==undefined){if(!(record(paint)&&['source-scoped-occurrence-v2','source-scoped-occurrence-v3','source-scoped-occurrence-v4','source-scoped-occurrence-v5'].includes(String(paint.version)))){const mode=Array.isArray(paint)?'tuple':'full';if(paintMode&&paintMode!==mode)return fail();paintMode=mode;}if(++paints>1000)return fail();shows+=record(paint)&&['source-scoped-occurrence-v3','source-scoped-occurrence-v4','source-scoped-occurrence-v5'].includes(String(paint.version))&&(paint.showGroup as {operators:unknown[]})?.operators?((paint.showGroup as {operators:unknown[]}).operators.length):1;if(shows>100000)return fail();clips+=scopedClipCount(paint);if(clips>100000)return fail();}
  }
 }
 if(!paints&&!nativeArtworkRecord(value)||nativeArtworkRecord(value)&&paints)return fail();
 if(value.template.sourceFonts!==undefined){if(!dense(value.template.sourceFonts,32))return fail();let maps=0;for(const font of value.template.sourceFonts){if(!record(font)||!dense(font.glyphMap,65535))return fail();maps+=font.glyphMap.length;if(font.shapeMap!==undefined){if(!dense(font.shapeMap,100000))return fail();maps+=font.shapeMap.length;}if(maps>100000)return fail();}}
 // Numerical styles never become catalogue or legacy-font declarations.
 for(const page of value.template.pages as RecordValue[])for(const region of page.regions as unknown[]){if(!(e?Array.isArray(region):record(region)&&region.kind==='text'))continue;const painted=textRegion.get(region,'style',e),weight=style.get(painted,'fontWeight',e),fontIdRaw=style.get(painted,'sourceFontId',e),fontId=e&&fontIdRaw!==undefined?decodeId(fontIdRaw):fontIdRaw;if(weight===400||weight===700)continue;const fonts=value.template.sourceFonts;if(!dense(fonts,32)||!fonts.some(f=>record(f)&&f.id===fontId&&f.format==='truetype'&&f.sourceVersion===10&&f.capability==='original-tt-numeric-style-v1'&&f.fontWeight===weight))return fail();}
 if(value.memorySnapshot!==undefined){if(!record(value.memorySnapshot)||!dense(value.memorySnapshot.evidence,10000)||!dense(value.memorySnapshot.eligibleFactIds,10000))return fail();for(const id of value.memorySnapshot.eligibleFactIds)idCheck(id,false,b);
  for(const evidence of value.memorySnapshot.evidence){if(!record(evidence)||!record(evidence.provenance))return fail();idCheck(evidence.factId,false,b);if(present(evidence,'assertionId'))idCheck(evidence.assertionId,false,b);for(const k of ['sourceId','resumeFactId','sourceSegmentId'])if(present(evidence.provenance,k))idCheck(evidence.provenance[k],false,b);}
 }
 validateContent(value.baseline,e,b);validateContent(value.draft,e,b);
 if(!dense(value.facts,10000))return fail();for(const f of value.facts)fact.validate(f,e,b);
 if(value.folio!==undefined){if(!record(value.folio)||!dense(value.folio.versions,12))return fail();for(const version of value.folio.versions){if(!record(version))return fail();validateContent(version.content,e,b);}}
}
const convertContent=(v:RecordValue,pack:boolean)=>({...v,blocks:(v.blocks as unknown[]).map(b=>pack?block.encode(b as RecordValue):block.decode(b as unknown[]))});
function convert(value:RecordValue,pack:boolean):RecordValue{
 const template=value.template as RecordValue;
 return {...value,template:{...template,pages:(template.pages as RecordValue[]).map(p=>({...p,regions:(p.regions as unknown[]).map(r=>pack?(record(r)&&r.kind==='text'?textRegion.encode(r):r):(Array.isArray(r)?textRegion.decode(r):r))}))},
  baseline:convertContent(value.baseline as RecordValue,pack),draft:convertContent(value.draft as RecordValue,pack),facts:(value.facts as unknown[]).map(f=>pack?fact.encode(f as RecordValue):fact.decode(f as unknown[])),
  ...(value.folio!==undefined?{folio:{...(value.folio as RecordValue),versions:((value.folio as RecordValue).versions as RecordValue[]).map(v=>({...v,content:convertContent(v.content as RecordValue,pack)}))}}:{})};
}
/** Only the new source class uses columns; every prior wire record is unchanged. */
function spacingColumns(value:RecordValue,pack:boolean):RecordValue{
 const template=value.template as RecordValue;if(template.importerVersion!=='folio-import-v28'&&!nativeArtworkRecord(value))return fail();const budget={glyphs:0};
 return {...value,template:{...template,pages:(template.pages as RecordValue[]).map(page=>({...page,regions:(page.regions as unknown[]).map(region=>{
  if(!Array.isArray(region))return region;
  const l=textRegion.get(region,'sourceLayout',true);if(!Array.isArray(l)||layout.get(l,'glyphEncoding',true)!=='shared-font-tuple-v1')return fail();
  const glyphs=layout.get(l,'glyphs',true),next=[...l];next[8]=pack?packSpacingGlyphs(glyphs):unpackSpacingGlyphs(glyphs,budget);
  const r=[...region];const index=r.indexOf(l);if(index<0)return fail();r[index]=next;return r;
 })}))}};
}
/** Compose AFTER packScopedMetadata. Untargeted legacy metadata keeps its identity. */
export function packRecordMetadata(value:unknown):unknown{
 if(record(value)&&Object.hasOwn(value,'encoding'))return fail();if(!hasScoped(value)&&!nativeArtworkRecord(value))return value;preflight(value,false);const converted=convert(value,true);if(nativeArtworkRecord(value))return {encoding:'folio-record-native-artwork-tuples-v1',project:spacingColumns(converted,true)};return (value.template as RecordValue).importerVersion==='folio-import-v28'?{encoding:'folio-record-spacing-tuples-v1',project:spacingColumns(converted,true)}:{encoding:TAG,project:converted};
}
/** Compose BEFORE unpackScopedMetadata, after the existing serialized 2 MiB cap. */
export function unpackRecordMetadata(value:unknown):unknown{
 if(!record(value)||!Object.hasOwn(value,'encoding'))return value;
 if(value.encoding==='folio-record-native-artwork-tuples-v1'||value.encoding==='folio-record-spacing-tuples-v1'){if(value.encoding==='folio-record-native-artwork-tuples-v1'?!nativeArtworkRecord(value.project):nativeArtworkRecord(value.project))return fail();if(Reflect.ownKeys(value).length!==2||!Object.hasOwn(value,'project'))return fail();jsonBudget(value.project);if(!record(value.project)||!record(value.project.template)||!dense(value.project.template.pages,MAX_SOURCE_PAGES))return fail();for(const p of value.project.template.pages)if(!record(p)||!dense(p.regions,1000))return fail();const expanded=spacingColumns(value.project,false);preflight(expanded,true);return convert(expanded,false);}
 if(value.encoding!==TAG||Reflect.ownKeys(value).length!==2||!Object.hasOwn(value,'project'))return fail();preflight(value.project,true);return convert(value.project,false);
}
