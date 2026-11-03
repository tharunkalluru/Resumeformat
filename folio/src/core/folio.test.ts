import { describe, expect, it } from 'vitest';
import { approveTemplate, editBlock } from './commands';
import { createApplication } from './applications';
import { completedTailoring, jobIdentity, presentation, saveVersion, setPresentation } from './folio';
import { fixtureProject } from './testFixture';
import { validateProject } from './schema';

describe('isolated tailoring receipts and content versions', () => {
  it('deduplicates completion IDs and groups the same normalized job context across applications', async () => {
    const source=await approveTemplate(await fixtureProject(),[]);
    const a=await createApplication(source,{title:'Engineer',company:'Fictional',description:' React   TypeScript\n dashboards '}),b=await createApplication(source,{title:'Other label',company:'Fictional',description:'react typescript dashboards'});
    const ready=completedTailoring(setPresentation(a,{historyKnown:true}),'receipt-a','2026-10-07T12:00:00.000Z');
    expect(completedTailoring(ready,'receipt-a')).toBe(ready);
    expect(ready.folio?.jobIdentity).toBe(jobIdentity(b));
    expect(a.folio).toBeUndefined();expect(source.workspace.kind).toBe('resume');
    const other=await createApplication(source,{...b.job,description:'React mobile accessibility'});
    expect(jobIdentity(other)).not.toBe(jobIdentity(a));
  });
  it('keeps prior versions and original template immutable and rejects foreign blocks', async () => {
    const source=await approveTemplate(await fixtureProject(),[]),app=await createApplication(source);
    const original=structuredClone(app),first=saveVersion(app,'firstResult');
    const edited=editBlock(first,first.draft.blocks[0].id,[{text:'My precise confirmed edit.'}]);
    expect(first.folio?.versions[0].content).toEqual(original.draft);
    expect(edited.template).toEqual(app.template);expect(app).toEqual(original);
    const bad=structuredClone(first);bad.folio!.versions[0].content.blocks[0].id='foreign-block';
    expect(()=>validateProject(bad)).toThrow();
    let bounded=first;for(let i=1;i<12;i++)bounded=saveVersion(bounded,'download');
    expect(()=>saveVersion(bounded,'restored')).toThrow('12 recorded versions');
    expect(bounded.folio?.versions).toHaveLength(12);
  });
  it('refuses oversized history without truncating earlier versions',async()=>{
    const source=await fixtureProject(),block=source.baseline.blocks[0],region=source.template.pages[0].regions[0];
    for(let index=1;index<20;index++){const id=`block-${index}`;source.baseline.blocks.push({...structuredClone(block),id});source.draft.blocks.push({...structuredClone(block),id});if(region.kind==='text')source.template.pages[0].regions.push({...structuredClone(region),id:`region-${index}`,contentId:id,order:index,bounds:{...region.bounds,y:50+index*32}});}
    const app=await createApplication(await approveTemplate(source,[])),history=saveVersion(app,'firstResult');
    const oversized=structuredClone(history);oversized.folio!.versions=Array.from({length:12},(_,index)=>({...structuredClone(history.folio!.versions[0]),id:`version-${index}`,content:{revision:1,blocks:app.draft.blocks.map(block=>({...structuredClone(block),runs:[{text:'x'.repeat(10000)}]}))}}));
    expect(()=>validateProject(oversized)).toThrow('history metadata');expect(history.folio?.versions).toHaveLength(1);
  });
  it('shows legacy history as unknown without mutating a saved application', async () => {
    const app=await createApplication(await approveTemplate(await fixtureProject(),[]));
    const before=structuredClone(app);expect(presentation(app).historyKnown).toBe(false);expect(app).toEqual(before);
    expect(()=>setPresentation(app,{held:[{blockId:'foreign',text:'Invented',factIds:[app.facts[0].id],reason:'Test'}]})).toThrow();
  });
});
