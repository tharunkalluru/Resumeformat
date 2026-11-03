import {describe,it,expect} from 'vitest';
import {Schema} from '@tiptap/pm/model';
import {EditorState,Plugin} from '@tiptap/pm/state';
import {history,undo} from '@tiptap/pm/history';
import type {Project} from '../core/model';
import {documentScopedMarksAllowed,licensedSubsetInputAllowed} from './documentScopedInput';
const schema=new Schema({nodes:{doc:{content:'folioRegion+'},folioRegion:{attrs:{id:{default:''}},content:'text*'},text:{}},marks:{bold:{},italic:{},underline:{}}});
const project={template:{sourceFonts:[{id:'owned',sourceVersion:7}],pages:[{regions:[{id:'source',kind:'text',style:{sourceFontId:'owned'}},{id:'other',kind:'text',style:{}}]}]}} as unknown as Project;
const doc=()=>schema.node('doc',null,[schema.node('folioRegion',{id:'source'},schema.text('Authored text')),schema.node('folioRegion',{id:'other'},schema.text('Other text'))]);
describe('document-scoped actual editor transaction marks',()=>{
 it.each(['bold','italic'])('refuses injected and pasted %s marks on the owned face',mark=>{
  const state=EditorState.create({schema,doc:doc()}),injected=state.tr.addMark(1,5,schema.marks[mark].create());expect(documentScopedMarksAllowed(project,injected.doc)).toBe(false);
  const pasted=state.tr.replaceWith(1,5,schema.text('paste',[schema.marks[mark].create()]));expect(documentScopedMarksAllowed(project,pasted.doc)).toBe(false);
 });
 it('preserves normal text, original-face underline, and unrelated catalogue formatting',()=>{
  const state=EditorState.create({schema,doc:doc()});expect(documentScopedMarksAllowed(project,state.tr.insertText('edit',1).doc)).toBe(true);
  expect(documentScopedMarksAllowed(project,state.tr.addMark(1,5,schema.marks.underline.create()).doc)).toBe(true);
  const other=state.doc.firstChild!.nodeSize+1;expect(documentScopedMarksAllowed(project,state.tr.addMark(other,other+3,schema.marks.bold.create()).doc)).toBe(true);
 });
});

describe('licensed whole paragraph native transaction boundary',()=>{
 const p={baseline:{blocks:[]},template:{sourceFonts:[{id:'owned',sourceVersion:8}],pages:[{id:'page',regions:[{id:'source',pageId:'page',order:1,kind:'text',style:{sourceFontId:'owned'}},{id:'other',pageId:'page',order:2,kind:'text',style:{}}]}]}} as unknown as Project;
 it('allows a full selected paragraph deletion and leaves unrelated edits untouched',()=>{const state=EditorState.create({schema,doc:doc()});expect(licensedSubsetInputAllowed(p,state.tr.delete(1,1+'Authored text'.length).doc,state.doc)).toBe(true);expect(licensedSubsetInputAllowed(p,state.tr.insertText('addition',state.doc.firstChild!.nodeSize+1).doc,state.doc)).toBe(true);});
 it.each(['partial','replace','bold','italic','underline'])('refuses %s before modifying native editor content',kind=>{const state=EditorState.create({schema,doc:doc()});const tr=kind==='partial'?state.tr.delete(1,2):kind==='replace'?state.tr.insertText('Other',1,14):state.tr.addMark(1,5,schema.marks[kind].create());expect(licensedSubsetInputAllowed(p,tr.doc,state.doc)).toBe(false);});
});

 it('permits genuine PM history Undo only back to the exact baseline paragraph and marks',()=>{
  const actual=new Schema({nodes:{doc:{content:'folioRegion+'},folioRegion:{attrs:{id:{default:''}},content:'paragraph+'},paragraph:{content:'text*'},text:{}},marks:{bold:{},italic:{},underline:{},folioEvidence:{attrs:{ids:{default:[]}}}}});
  const original=actual.node('doc',null,[actual.node('folioRegion',{id:'source'},[actual.node('paragraph',null,actual.text('Authored complete paragraph',[actual.marks.bold.create(),actual.marks.folioEvidence.create({ids:['fact']})]))])]);
  const p={baseline:{blocks:[{id:'block',runs:[{text:'Authored complete paragraph',bold:true,sourceFactIds:['fact']}],sourceFactIds:['fact']}]},template:{sourceFonts:[{id:'owned',sourceVersion:8}],pages:[{id:'page',regions:[{id:'source',contentId:'block',pageId:'page',order:1,kind:'text',style:{sourceFontId:'owned',fontWeight:700,italic:false}}]}]}} as unknown as Project;
  let state=EditorState.create({schema:actual,doc:original,plugins:[history(),new Plugin({filterTransaction:(tr,previous)=>licensedSubsetInputAllowed(p,tr.doc,previous.doc)})]});
  state=state.apply(state.tr.delete(2,2+'Authored complete paragraph'.length));expect(state.doc.textContent).toBe('');
  expect(undo(state,tr=>{state=state.apply(tr);})).toBe(true);expect(state.doc.eq(original)).toBe(true);
  expect(licensedSubsetInputAllowed(p,state.tr.removeMark(2,8,actual.marks.bold).doc,state.doc)).toBe(false);
  expect(licensedSubsetInputAllowed(p,state.tr.insertText('other',2,10).doc,state.doc)).toBe(false);
 });

it('accepts actual covered PM selection rewrite and history Undo while refusing injected marks and uncovered input',()=>{
 const actual=new Schema({nodes:{doc:{content:'folioRegion+'},folioRegion:{attrs:{id:{default:''}},content:'paragraph+'},paragraph:{content:'text*'},text:{}},marks:{bold:{},italic:{},underline:{},folioEvidence:{attrs:{ids:{default:[]}}}}});
 const wording='Designed accessible interfaces for a fictional library.',replacement='Designed interfaces for a fictional library.';
 const original=actual.node('doc',null,[actual.node('folioRegion',{id:'source'},[actual.node('paragraph',null,actual.text(wording,[actual.marks.folioEvidence.create({ids:['fact']})]))])]);
 const map=Array.from(new Set(wording)).map((unicode,i)=>({cid:i+1,unicode,glyphId:i+1,originalGlyphId:i+1,originalCharCode:i+1,pdfWidth:500,nativeWidth:500}));
 const p={facts:[{id:'fact',kind:'resume',text:wording}],baseline:{blocks:[{id:'block',runs:[{text:wording,sourceFactIds:['fact']}],sourceFactIds:['fact']}]},template:{sourceFonts:[{id:'owned',sourceVersion:8,glyphMap:map}],pages:[{id:'page',regions:[{id:'source',contentId:'block',pageId:'page',order:1,kind:'text',sourceLayout:{anchor:'start'},style:{sourceFontId:'owned',fontWeight:400,italic:false}}]}]}} as unknown as Project;
 let state=EditorState.create({schema:actual,doc:original,plugins:[history(),new Plugin({filterTransaction:(tr,previous)=>licensedSubsetInputAllowed(p,tr.doc,previous.doc)})]});
 const rewrite=state.tr.replaceWith(2,2+wording.length,actual.text(replacement,[actual.marks.folioEvidence.create({ids:['fact']})]));expect(licensedSubsetInputAllowed(p,rewrite.doc,state.doc,()=>false)).toBe(false);expect(licensedSubsetInputAllowed(p,state.tr.delete(2,2+wording.length).doc,state.doc,()=>false)).toBe(true);state=state.apply(rewrite);expect(state.doc.textContent).toBe(replacement);
 expect(undo(state,tr=>{state=state.apply(tr);})).toBe(true);expect(state.doc.eq(original)).toBe(true);
 const before=state.doc;state=state.apply(state.tr.insertText('🧪',2));expect(state.doc.eq(before)).toBe(true);state=state.apply(state.tr.addMark(2,10,actual.marks.bold.create()));expect(state.doc.eq(before)).toBe(true);
});
