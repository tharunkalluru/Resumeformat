import { describe, expect, it, vi, afterEach } from 'vitest';
import { applyTailoring, runTailoring } from './flow';
import { sourceReviewIssues } from './sourceSupport';
import { addCareerNote, approveTemplate, confirmDraft, editBlock } from '../core/commands';
import { createApplication } from '../core/applications';
import { fixtureProject } from '../core/testFixture';
import { exportProblems, hashTextSync, RENDERER_VERSION } from '../core/model';
import { AI_MODEL, prepareAiRequest } from './ai';
import type { AiRequest, AiResult, AiStatus } from './ai';
import { renderProjectDocument } from '../render/pdf';
vi.mock('../render/pdf',()=>({renderProjectDocument:vi.fn()}));
afterEach(()=>vi.resetAllMocks());
async function application(){return createApplication(await approveTemplate(await fixtureProject(),[]),{title:'Engineer',company:'Fixture',description:'React dashboards'});}
function result(request:AiRequest,text:string,factIds:string[]):AiResult{return {schemaVersion:1,requestId:request.requestId,context:request.context,contextHash:request.consent.contextHash,model:AI_MODEL,requiresReview:true,usage:null,proposals:[{operation:'replaceParagraphText',blockId:request.blocks[0].id,beforeText:request.blocks[0].text,beforeHash:request.blocks[0].textHash,afterText:text,afterHash:hashTextSync(text),reason:'Use exact supplied evidence.',factIds,factRefs:factIds.map(factId=>{const fact=request.facts.find(fact=>fact.id===factId)!;return {factId,version:fact.version,assertionId:fact.assertionId,sourceId:fact.source.id,sourceVersion:fact.source.version,sourceHash:fact.source.hash,quoteHash:fact.source.quoteHash,textHash:fact.textHash};})}]};}
function fit(overflows=false){vi.mocked(renderProjectDocument).mockResolvedValue({bytes:new Uint8Array(),contentRevision:2,rendererVersion:RENDERER_VERSION,layout:{regions:[],overflows:overflows?[{pageId:'page',regionId:'region',code:'height',message:'Does not fit.'}]:[]}});}
describe('source-proved automatic tailoring',()=>{
  it('applies exact confirmed facts without granting applicant review or export readiness',async()=>{
    const app=addCareerNote(await application(),'Built React dashboards.');const before=structuredClone(app);
    const request=prepareAiRequest(app,app.facts.map(f=>f.id),[app.draft.blocks[0].id],'request-one');fit();
    const output=await applyTailoring(app,request,result(request,app.notes[0].text,app.facts.map(f=>f.id)));
    expect(output.applied).toBe(1);expect(sourceReviewIssues(output.project)).toEqual([]);expect(output.project.reviewedDraftRevision).toBeNull();
    expect(exportProblems(output.project,null)).toContain('Review and confirm the current draft.');
    expect(output.project.facts).toEqual(before.facts);
    expect(output.project.folio?.completions).toHaveLength(1);expect(output.project.folio?.versions).toHaveLength(1);expect(output.project.baseline).toEqual(before.baseline);expect(app).toEqual(before);
    const reviewed=confirmDraft(output.project);
    expect(reviewed.reviewedDraftRevision).toBe(reviewed.draft.revision);
    expect(exportProblems(reviewed,null)).not.toContain('Review and confirm the current draft.');
  });
  it('preserves an existing applicant review when no wording is changed',async()=>{
    const app=confirmDraft(await application()),request=prepareAiRequest(app,app.facts.map(f=>f.id),[app.draft.blocks[0].id],'request-no-change');
    const response=result(request,app.draft.blocks[0].runs[0].text,app.facts.map(f=>f.id));response.proposals=[];fit();
    const output=await applyTailoring(app,request,response);
    expect(output.project.draft).toEqual(app.draft);expect(output.project.reviewedDraftRevision).toBe(app.reviewedDraftRevision);
  });
  it('holds unsupported lowercase claims without silently inventing evidence or changing the draft',async()=>{
    const app=await application(),request=prepareAiRequest(app,app.facts.map(f=>f.id),[app.draft.blocks[0].id],'request-held');fit();
    const output=await applyTailoring(app,request,result(request,'led a team of twenty.',app.facts.map(f=>f.id)));
    expect(output).toMatchObject({applied:0,held:1});expect(output.project.draft).toEqual(app.draft);expect(output.project.facts).toEqual(app.facts);expect(output.project.folio?.held?.[0].text).toBe('led a team of twenty.');
  });
  it('fails atomically on layout overflow and invalid source references',async()=>{
    const app=addCareerNote(await application(),'Built React dashboards.'),before=structuredClone(app),request=prepareAiRequest(app,app.facts.map(f=>f.id),[app.draft.blocks[0].id],'request-overflow'),response=result(request,app.notes[0].text,app.facts.map(f=>f.id));fit(true);
    await expect(applyTailoring(app,request,response)).rejects.toThrow('original layout');expect(app).toEqual(before);
    const bad=structuredClone(response);bad.proposals[0].factRefs[0].sourceHash='0'.repeat(64);
    await expect(applyTailoring(app,request,bad)).rejects.toThrow();expect(app).toEqual(before);
  });
  it('does not automatically attest an existing unsupported manual claim',async()=>{
    const original=await application(),app=editBlock(original,original.draft.blocks[0].id,[{text:'led an unverified team.'}]),request=prepareAiRequest(app,app.facts.map(f=>f.id),[app.draft.blocks[0].id],'request-manual');
    const response=result(request,'Built React dashboards.',app.facts.map(f=>f.id));response.proposals=[];fit();
    const output=await applyTailoring(app,request,response);expect(output.project.reviewedDraftRevision).toBeNull();expect(sourceReviewIssues(output.project)).toEqual([app.draft.blocks[0].id]);expect(output.project.facts).toEqual(app.facts);
  });
  it('stops an already canceled request and cancellation during provider-status lookup',async()=>{
    const app=await application(),controller=new AbortController(),status:AiStatus={keyConfigured:true,modelConfigured:true,supportedModel:true,paidRequestsEnabled:true,accountModelVerified:true,busy:false,verification:'verified'},client={status:vi.fn().mockImplementation(async()=>{controller.abort();return status;}),verify:vi.fn(),tailor:vi.fn()};
    await expect(runTailoring(app,true,controller.signal,()=>{},client)).rejects.toThrow('cancelled');expect(client.tailor).not.toHaveBeenCalled();
    client.status.mockClear();await expect(runTailoring(app,true,controller.signal,()=>{},client)).rejects.toThrow('cancelled');expect(client.status).not.toHaveBeenCalled();
  });
  it('never invokes the provider without consent, a usable JD, and verified enabled status',async()=>{
    const app=await application(),status:AiStatus={keyConfigured:false,modelConfigured:false,supportedModel:false,paidRequestsEnabled:false,accountModelVerified:false,busy:false,verification:'unverified'};
    const client={status:vi.fn().mockResolvedValue(status),verify:vi.fn(),tailor:vi.fn()},signal=new AbortController().signal;
    await expect(runTailoring(app,false,signal,()=>{},client)).rejects.toThrow('allow');expect(client.status).not.toHaveBeenCalled();
    await expect(runTailoring({...app,job:{...app.job,description:'https://example.com/job'}},true,signal,()=>{},client)).rejects.toThrow('job-link');expect(client.status).not.toHaveBeenCalled();
    await expect(runTailoring(app,true,signal,()=>{},client)).rejects.toThrow();expect(client.tailor).not.toHaveBeenCalled();
  });
});
