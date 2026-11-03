import type {SourcePositionedGlyph} from '../core/model';
/** Fixed local layout precision; never an eligibility decision or tolerance. */
export const SOURCE_NATIVE_SCALE=16;
export const SOURCE_NATIVE_ADAPTER='folio-native-local-layout-v1';
const PT=4/3,EDGE=.06;
export function sourceNativeStyles(size:number,lineHeight:number,spacing:number,width:number,highResolution:boolean):Partial<CSSStyleDeclaration>{
 const k=highResolution?SOURCE_NATIVE_SCALE:1;
 if(![size,lineHeight,spacing,width].every(Number.isFinite)||size<=0||lineHeight<=0||width<0)throw Error('Invalid native geometry');
 return {fontSize:`${size*k}pt`,lineHeight:`${lineHeight*k}pt`,letterSpacing:`${spacing*k}pt`,width:`${width*k}pt`,transform:highResolution?'scale(0.0625)':'none',transformOrigin:'0 0'};
}
/** All coordinates are effective viewport pixels, normalized only by outer page zoom. */
export function sourceNativeDomMatches(element:HTMLElement,page:HTMLElement,glyphs:readonly SourcePositionedGlyph[],text:string,spacing:number,origin:number,outerScale:number,vertical?:{baseline:number;ascent:number}):boolean{
 if(!element.isConnected||!page.isConnected||!element.getClientRects().length||!Number.isFinite(outerScale)||outerScale<=0||glyphs.length>5000||element.textContent!==text||glyphs.map(g=>g.unicode).join('')!==text||element.style.transform!=='scale(0.0625)')return false;
 const nodes:Text[]=[];const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node:Node|null;while((node=walker.nextNode()))nodes.push(node as Text);
 if(!nodes.length||!glyphs.length)return false; // Empty lines remain restorable by normal Undo; no invented caret proof.
 const at=(offset:number):[Text,number]|undefined=>{let n=offset;for(let i=0;i<nodes.length;i++){const length=nodes[i].data.length;if(n<=length)return[nodes[i],n];n-=length;}return;};
 const rangeAt=(a:number,b:number)=>{const start=at(a),end=at(b);if(!start||!end)throw Error('range');const range=document.createRange();range.setStart(...start);range.setEnd(...end);return range.getBoundingClientRect();};
 try{
  const left=page.getBoundingClientRect().left;let offset=0;
  const caret=(index:number,x:number)=>{const rect=rangeAt(index,index);return Number.isFinite(rect.x)&&rect.height>0&&Math.abs((rect.x-left)/outerScale-x*PT)<=EDGE;};
  for(const glyph of glyphs){const end=offset+glyph.unicode.length,rect=rangeAt(offset,end);if(!Number.isFinite(rect.x)||!Number.isFinite(rect.width)||rect.height<=0||Math.abs((rect.x-left)/outerScale-glyph.x*PT)>EDGE||Math.abs(rect.width/outerScale-(glyph.advance+spacing)*PT)>EDGE||!caret(offset,glyph.x))return false;offset=end;}
  const last=glyphs.at(-1)!,full=rangeAt(0,offset),endpoint=last.x+last.advance+spacing;
  if(vertical&&Math.abs((full.top-page.getBoundingClientRect().top)/outerScale+vertical.ascent*PT-vertical.baseline*PT)>EDGE)return false;
  return Math.abs((full.x-left)/outerScale-origin*PT)<=EDGE&&Math.abs(full.width/outerScale-(endpoint-origin)*PT)<=EDGE&&caret(offset,endpoint);
 }catch{return false;}
}
/** Scale a local polygon from its exact physical-point source clip, without moving its origin. */
export function sourceNativeClip(polygon:string,highResolution:boolean):string{
 if(!highResolution)return polygon;
 return polygon.replace(/(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)pt/gi,(_match,n:string)=>`${Number(n)*SOURCE_NATIVE_SCALE}pt`);
}

/** The pre-existing native baseline alignment, measured in effective page points. */
export function sourceNativeBaselineAdjustment(element:HTMLElement,page:HTMLElement,outerScale:number,baseline:number,ascent:number):number|undefined{
 if(!element.isConnected||outerScale<=0)return;const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let text:Node|null;while((text=walker.nextNode()))if(text.textContent?.length){const range=document.createRange();range.setStart(text,0);range.setEnd(text,1);const rect=range.getBoundingClientRect();if(rect.height<=0)return;const delta=baseline-((rect.top-page.getBoundingClientRect().top)/(outerScale*PT)+ascent);return Number.isFinite(delta)?delta:undefined;}return;
}
