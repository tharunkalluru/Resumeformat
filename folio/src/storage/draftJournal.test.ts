import { beforeEach, describe, expect, it, vi } from 'vitest';
import { approveTemplate, editBlock } from '../core/commands';
import { createApplication } from '../core/applications';
import { fixtureProject } from '../core/testFixture';
import { clearJournal, journalDraft, recoverJournal } from './draftJournal';
beforeEach(()=>{const map=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>map.set(key,value),removeItem:(key:string)=>map.delete(key),clear:()=>map.clear(),key:(index:number)=>[...map.keys()][index]??null,get length(){return map.size;}});});
describe('failed-save content recovery',()=>{
  it('recovers complete job content without replacing originals, fonts or another job',async()=>{
    const app=await createApplication(await approveTemplate(await fixtureProject(),[]));
    const next=editBlock(app,app.draft.blocks[0].id,[{text:'Precise unsaved wording.'}]);expect(journalDraft(next)).toBe(true);
    const recovered=recoverJournal(app)!;expect(recovered.draft).toEqual(next.draft);expect(recovered.source).toEqual(app.source);expect(recovered.template).toEqual(app.template);
    expect(recoverJournal({...app,id:'another-job'})).toBeNull();expect(recoverJournal({...app,template:{...app.template,revision:2}})).toBeNull();
    clearJournal(app.id,app.revision);expect(recoverJournal(app)).not.toBeNull();clearJournal(app.id,next.revision);expect(recoverJournal(app)).toBeNull();
  });
  it('rejects corrupt recovery data and reports failure when the secondary storage is unavailable',async()=>{
    const app=await createApplication(await approveTemplate(await fixtureProject(),[]));
    localStorage.setItem(`folio-unsaved-draft-v1:${app.id}`,'invalid');expect(recoverJournal(app)).toBeNull();
    const unavailable={setItem(){throw new Error('Quota');}} as unknown as Storage;expect(journalDraft(app,unavailable)).toBe(false);
    expect(journalDraft(await fixtureProject())).toBe(false);
  });
});
