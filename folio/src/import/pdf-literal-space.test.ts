import {describe,expect,it} from 'vitest';
import {PDFDocument,PDFName} from 'pdf-lib';
import {assertStandaloneActualTextOperators,classifyLiteralSpaceActualText,hasLiteralSpaceActualTextSource} from './pdf-literal-space';
import {originalOperators,type RawOperator} from './pdf-image-trace';

const body='q 1 0 0 -1 0 100 cm BT 1 0 0 -1 40 50 Tm /Fictional 12 Tf ( ) Tj ET Q';
const parse=(text:string)=>originalOperators(text,undefined,true,true,true);
async function source(contents:string[]){
 const document=await PDFDocument.create();for(const text of contents){const page=document.addPage([200,200]);page.node.set(PDFName.of('Contents'),document.context.register(document.context.flateStream(new TextEncoder().encode(text))));}return document;
}

describe('literal ASCII-space ActualText source class',()=>{
 it('classifies only the closed single-key literal-space dictionary with legal PDF whitespace',()=>{
  for(const raw of ['<< /ActualText ( ) >>','<</ActualText( )>>','<<\n/ActualText\r\n( )\t>>','<<\0/ActualText\f( )\0>>']){const property=classifyLiteralSpaceActualText(raw)!;expect(property).toEqual({kind:'space-actual-text',actualText:' '});expect(Object.isFrozen(property)).toBe(true);}
 });

 it('keeps literal space distinct from zero-width, NBSP, ligature, escaped and hex declarations',()=>{
  for(const raw of ['<< /ActualText <FEFF200B> >>','<< /ActualText (\u00a0) >>','<< /ActualText (fi) >>','<< /ActualText (\\040) >>','<< /ActualText <20> >>','<< /ActualText (  ) >>','<< /ActualText () >>','<< /ActualText (\t) >>'])expect(classifyLiteralSpaceActualText(raw)).toBeUndefined();
 });

 it('refuses duplicate keys, references, nested properties and trailing data',()=>{
  for(const raw of ['<< /ActualText ( ) /ActualText ( ) >>','<< /ActualText ( ) /MCID 1 >>','<< /ActualText 1 0 R >>','<< /ActualText << /ActualText ( ) >> >>','<< /ActualText ( ) >> BDC','<< /ActualText ( )','<< /ActualTextExtra ( ) >>','<< % comment\n /ActualText ( ) >>','<< /ActualText ( ) '+ ' '.repeat(4096)+'>>'])expect(classifyLiteralSpaceActualText(raw)).toBeUndefined();
 });

 it('selects an actual Span BDC including an escaped Span name and preserves source bytes',async()=>{
  for(const name of ['Span','Sp#61n']){const document=await source([`/${name} << /ActualText ( ) >> BDC ${body} EMC`]),before=document.getPages()[0].node.Contents()!.toString();expect(hasLiteralSpaceActualTextSource(document)).toBe(true);expect(document.getPages()[0].node.Contents()!.toString()).toBe(before);}
 });

 it('ignores comment, string, array and unrelated marked-tag lookalikes',async()=>{
  for(const text of ['% /Span << /ActualText ( ) >> BDC\nq Q','( /Span << /ActualText \\( \\) >> BDC ) Tj','/Span [<< /ActualText ( ) >>] BDC EMC','/Artifact << /ActualText ( ) >> BDC EMC','<< /ActualText ( ) >> Unrelated','/Span << /ActualText <FEFF200B> >> BDC EMC'])expect(hasLiteralSpaceActualTextSource(await source([text]))).toBe(false);
 });

 it('checks aggregate token work after finding a marker instead of skipping later pages',async()=>{
  const first=`/Span << /ActualText ( ) >> BDC ${body} EMC`;
  const document=await source([first+' q Q'.repeat(30_000),'q Q '.repeat(30_000)]);expect(()=>hasLiteralSpaceActualTextSource(document)).toThrow();
 });
});

describe('self-contained alternate-text operator scope',()=>{
 it('accepts the exact standalone sequence without changing its raw operators or lexemes',()=>{
  const ops=parse(body),before=structuredClone(ops);expect(()=>assertStandaloneActualTextOperators(ops)).not.toThrow();expect(ops).toEqual(before);
  expect(()=>assertStandaloneActualTextOperators(parse(body.replace('( )','<20>')))).not.toThrow();
 });

 it('requires every save, text reset, font selection and restore in the specified order',()=>{
  const ops=parse(body);for(let index=0;index<ops.length;index++)expect(()=>assertStandaloneActualTextOperators(ops.filter((_,i)=>i!==index))).toThrow();
  const swapped=structuredClone(ops);[swapped[3],swapped[4]]=[swapped[4],swapped[3]];expect(()=>assertStandaloneActualTextOperators(swapped)).toThrow();
 });

 it('rejects nested marked scopes, text scopes, extra paint and TJ cursor recipes',()=>{
  for(const text of [body.replace('( ) Tj','/Span << /MCID 1 >> BDC ( ) Tj EMC'),body.replace('( ) Tj','BT ( ) Tj ET'),body+' 0 g',body.replace('( ) Tj','[( )] TJ'),body.replace('( ) Tj','( ) Tj ( ) Tj')])expect(()=>assertStandaloneActualTextOperators(parse(text))).toThrow();
 });

 it('bounds transform arity, finite coordinates and otherwise invisible operands',()=>{
  const ops=parse(body);for(const index of [1,3])for(const value of [NaN,Infinity,1_000_001]){const changed=structuredClone(ops);changed[index].args[0]=value;expect(()=>assertStandaloneActualTextOperators(changed)).toThrow();}
  for(const index of [0,2,6,7]){const changed=structuredClone(ops);changed[index].args.push(1);expect(()=>assertStandaloneActualTextOperators(changed)).toThrow();}
  const shortened=structuredClone(ops);shortened[1].args.pop();expect(()=>assertStandaloneActualTextOperators(shortened)).toThrow();
 });

 it('requires a bounded font name and positive finite size rather than a dictionary or alias',()=>{
  for(const args of [[{name:''},12],[{name:'x'.repeat(129)},12],[{opaque:true},12],[{name:'F'},0],[{name:'F'},-1],[{name:'F'},NaN],[{name:'F'},1_000_001],[{name:'F'},12,1]]){const ops=parse(body);ops[4].args=args as RawOperator['args'];expect(()=>assertStandaloneActualTextOperators(ops)).toThrow();}
 });

 it('requires exactly one captured physical string operand and grants no glyph proof itself',()=>{
  for(const args of [[],[{opaque:true}],[{opaque:true,rawArray:'[( )]'}],[{opaque:true,rawString:'( )'},{opaque:true,rawString:'( )'}]]){const ops=parse(body);ops[5].args=args as RawOperator['args'];expect(()=>assertStandaloneActualTextOperators(ops)).toThrow();}
  // A valid grammar containing two glyph bytes still needs the caller's
  // independent one-physical-glyph proof; this helper never mints that authority.
  expect(()=>assertStandaloneActualTextOperators(parse(body.replace('( )','(ab)')))).not.toThrow();
 });
});
