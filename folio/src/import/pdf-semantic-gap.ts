import {canonicalJson} from '../core/model';
import type {SourcePaintGlyph} from './pdf-source';
import {FolioError} from '../core/errors';
import {readCompositeSemanticIssuer} from './pdf-composite-program';

export interface SemanticShowOwner {
 rawOperatorIndex:number;decodedOperatorIndex:number;paintOrdinal:number;
 effectiveTextState:string;effectivePaintState:string;fontRef:string;fontProgramSha256:string;codes:readonly number[];cids:readonly number[];explicitReset:boolean;glyphs:readonly SourcePaintGlyph[];
}
/** Ephemeral association authority; it carries no render or edit grant. */
export interface InterShowSemanticProof {readonly version:'inter-show-extractor-gap-v1'}
export interface InterShowSemanticUse {itemIndex:number;text:string;previous:SourcePaintGlyph;next:SourcePaintGlyph;previousRawOperatorIndex:number;nextRawOperatorIndex:number;stateHash:string;nextStateHash:string}
const owned=new WeakMap<InterShowSemanticProof,{pairs:ReadonlyMap<string,{left:SemanticShowOwner;right:SemanticShowOwner}>;items:ReadonlyMap<number,string>;uses:InterShowSemanticUse[];textChars:number;payloadBytes:number}>();
const signature=(g:SourcePaintGlyph)=>canonicalJson(g);
const key=(a:SourcePaintGlyph,b:SourcePaintGlyph)=>signature(a)+'\n'+signature(b);
export function mintInterShowSemanticProof(issuer:object):InterShowSemanticProof {
 const {shows,scope}=readCompositeSemanticIssuer(issuer);
 if(shows.length>100000||!(/^[a-f0-9]{64}$/.test(scope.sourceSha256))||!Number.isInteger(scope.pageNumber)||scope.pageNumber<1||scope.pageNumber>32||scope.items.length>100000||scope.items.reduce((n,i)=>n+i.text.length,0)>100000)throw new FolioError('PDF_SEMANTIC_GAP_PROOF','Semantic source association exceeds its existing bounds.');
 const pairs=new Map<string,{left:SemanticShowOwner;right:SemanticShowOwner}>();
 for(let i=1;i<shows.length;i++){
  const left=shows[i-1],right=shows[i],a=left.glyphs.at(-1),b=right.glyphs[0];
  if(!semanticBoundaryPolicy(left,right))continue;
  pairs.set(key(a!,b!),{left:structuredClone(left),right:structuredClone(right)});
 }
 const handle={version:'inter-show-extractor-gap-v1' as const};owned.set(handle,{pairs,items:new Map(scope.items.map(i=>[i.index,i.text])),uses:[],textChars:0,payloadBytes:0});return handle;
}
/** Pure eligibility policy; this function never creates association authority. */
export function semanticBoundaryPolicy(left:SemanticShowOwner,right:SemanticShowOwner):boolean {
 const a=left.glyphs.at(-1),b=right.glyphs[0];
 const complete=(s:SemanticShowOwner)=>s.glyphs.length===s.codes.length&&canonicalJson(s.glyphs.map(g=>g.cid))===canonicalJson(s.cids)&&s.codes.every(n=>Number.isInteger(n)&&n>=0&&n<=65535)&&/^\d+ \d+ R$/.test(s.fontRef)&&/^[a-f0-9]{64}$/.test(s.fontProgramSha256);
 const sameFont=(left.effectiveTextState===right.effectiveTextState||left.effectivePaintState===right.effectivePaintState)&&a?.fontId===b?.fontId&&a?.resource===b?.resource;
 const mixedFont=left.fontRef!==right.fontRef&&left.effectivePaintState===right.effectivePaintState;
 return !(!a||!b||!complete(left)||!complete(right)||right.paintOrdinal!==left.paintOrdinal+1||right.rawOperatorIndex<=left.rawOperatorIndex||right.decodedOperatorIndex<=left.decodedOperatorIndex||!left.explicitReset||!right.explicitReset||!sameFont&&!mixedFont||a.operatorIndex!==left.decodedOperatorIndex||b.operatorIndex!==right.decodedOperatorIndex||Math.abs(a.baseline-b.baseline)>.025||a.size!==b.size||a.color!==b.color||a.shearX!==b.shearX||a.characterSpacing!==b.characterSpacing||a.inferredGap||b.inferredGap||a.shapeOnly||b.shapeOnly||!Number.isFinite(b.x-a.x-a.advance)||b.x-a.x-a.advance<=.025||b.x-a.x-a.advance>2000);
}
export function hasInterShowSemanticPair(handle:InterShowSemanticProof|undefined,a:SourcePaintGlyph,b:SourcePaintGlyph,index:number,text:string):boolean{const proof=handle&&owned.get(handle);return !!proof&&proof.items.get(index)===text&&proof.pairs.has(key(a,b));}
export function recordInterShowSemanticUse(handle:InterShowSemanticProof|undefined,a:SourcePaintGlyph,b:SourcePaintGlyph,index:number,text:string):void {
 const proof=handle&&owned.get(handle),pair=proof?.pairs.get(key(a,b));
 if(!proof||!pair||proof.items.get(index)!==text||proof.uses.length>=100000||proof.textChars+text.length>100000)throw new FolioError('PDF_SEMANTIC_GAP_PROOF','Unowned or excessive semantic source relation.');
 const use={itemIndex:index,text,previous:a,next:b,previousRawOperatorIndex:pair.left.rawOperatorIndex,nextRawOperatorIndex:pair.right.rawOperatorIndex,stateHash:pair.left.effectiveTextState,nextStateHash:pair.right.effectiveTextState};
 const bytes=new TextEncoder().encode(canonicalJson(use)).length;
 if(proof.payloadBytes+bytes>2*1024*1024)throw new FolioError('PDF_SEMANTIC_GAP_PROOF','Semantic source relation metadata exceeds its existing 2 MiB bound.');
 proof.textChars+=text.length;proof.payloadBytes+=bytes;proof.uses.push(structuredClone(use));
}
export function interShowSemanticUses(handle:InterShowSemanticProof):readonly InterShowSemanticUse[]{const proof=owned.get(handle);if(!proof)throw new FolioError('PDF_SEMANTIC_GAP_PROOF','Unminted semantic source relation.');return structuredClone(proof.uses);}
