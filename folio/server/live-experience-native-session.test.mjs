import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { MODEL, MAX_OUTPUT_TOKENS, consentHash } from './contract.mjs';
import { EXPERIENCE_PRIOR_FILES, EXPERIENCE_PURPOSE, openExperienceBudget, shaBytes } from './live-experience-budget.mjs';
import { FIT_PRIOR_FILES } from './live-fit-budget.mjs';
import { EXPERIENCE_TEXT, EXPERIENCE_JOB, EXPERIENCE_WIDTH_PT, requestShape, validateExperienceAllowlist, createGuardedExperienceAdapter, captureFictionalGenerationResult } from './live-experience-native-session.mjs';

const KEY='synthetic-native-key-never-real';
const expectCode=code=>error=>error.code===code&&!String(error).includes(KEY);
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const reservationBody=()=>JSON.stringify({model:MODEL,store:false,stream:false,reasoning:{effort:'medium'},max_output_tokens:MAX_OUTPUT_TOKENS,input:'Fictional only'});

async function allowlistedRequest() {
  const historical=JSON.parse(await readFile(new URL('../output/m3-live-ai-fit-native/native-provider-proposal.json',import.meta.url),'utf8'));
  const request=structuredClone(historical.request);
  request.requestId=randomUUID();request.job={...EXPERIENCE_JOB};
  request.facts=request.facts.filter(fact=>fact.text===EXPERIENCE_TEXT);
  request.blocks=[{id:'fictional-experience-block',text:EXPERIENCE_TEXT,textHash:shaBytes(EXPERIENCE_TEXT),requiredFactIds:[request.facts[0].id],
    layoutBudget:{version:1,regionId:'fictional-experience-region',widthPt:EXPERIENCE_WIDTH_PT,heightPt:12.5,
      fontFamily:'sans',fontSizePt:10,fontWeight:400,italic:false,lineHeightPt:12.5,maxLines:1,maxCharacters:EXPERIENCE_TEXT.length}}];
  request.consent.contextHash=consentHash(request);
  return {request,allowlist:{schemaVersion:1,purpose:EXPERIENCE_PURPOSE,fictionalOnly:true,requestShape:requestShape(request)}};
}

async function fakePrior() {
  const root=await mkdtemp(join(tmpdir(),'folio-native-fit-'));
  for(const path of EXPERIENCE_PRIOR_FILES){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),'fictional preserved evidence');}
  const original={schemaVersion:1,model:MODEL,budgetUsd:5,maxGenerationCalls:3,reservationPolicy:'retain-full-reservation-for-every-call',
    entries:[{result:'success',reservationUsd:0.038106,estimatedStandardCostUsd:0.003156}]};
  await writeFile(join(root,'output/m3-live-ai/budget-ledger.json'),JSON.stringify(original));
  const originalHashes=Object.fromEntries(await Promise.all(EXPERIENCE_PRIOR_FILES.filter(path=>path.startsWith('output/m3-live-ai/')).map(async path=>[path.split('/').at(-1),shaBytes(await readFile(join(root,path)))])));
  const expanded={schemaVersion:1,purpose:'expanded-profile-after-overflow',model:MODEL,budgetUsd:5,maxAdditionalGenerationCalls:1,maxCumulativeGenerationCalls:3,reservationPolicy:'retain-full-prior-and-new-reservations',
    anchor:{priorLedgerHash:originalHashes['budget-ledger.json'],priorCommittedReservationUsd:0.038106,priorEstimatedStandardCostUsd:0.003156,priorArtifactHashes:originalHashes},
    entries:[{result:'success',reservationUsd:0.041043,estimatedStandardCostUsd:0.002236}]};
  await writeFile(join(root,'output/m3-live-ai-expanded-profile/cumulative-budget-ledger.json'),JSON.stringify(expanded));
  const thirdAllowlistHash=shaBytes(await readFile(join(root,'output/m3-live-ai-fit-native/native-allowlist.json')));
  const thirdRequestId=randomUUID(),acceptedAt=new Date().toISOString();
  const thirdHashes=Object.fromEntries(await Promise.all(FIT_PRIOR_FILES.map(async path=>[path,shaBytes(await readFile(join(root,path)))])));
  const third={schemaVersion:1,purpose:'fit-profile-native-after-diagnosis',model:MODEL,budgetUsd:5,maxAdditionalGenerationCalls:1,maxCumulativeGenerationCalls:3,reservationPolicy:'retain-full-prior-and-new-reservations',
    anchor:{priorGenerationCalls:2,priorCommittedReservationUsd:0.079149,priorEstimatedStandardCostUsd:0.005392,immutableFileHashes:thirdHashes,allowlistHash:thirdAllowlistHash},
    attempt:{requestId:thirdRequestId,acceptedAt,result:'success'},entries:[{requestId:thirdRequestId,result:'success',reservationUsd:0.046293,estimatedStandardCostUsd:0.005310}]};
  await writeFile(join(root,'output/m3-live-ai-fit-native/cumulative-budget-ledger.json'),JSON.stringify(third));
  await writeFile(join(root,'output/m3-live-ai-fit-native/.native-fit-purpose-consumed.json'),JSON.stringify({purpose:third.purpose,requestId:thirdRequestId,acceptedAt,allowlistHash:thirdAllowlistHash}));
  return root;
}
const options=root=>({root,allowlistHash:shaBytes('fictional-reviewed-allowlist')});
const completed=proposals=>({model:MODEL,status:'completed',error:null,incomplete_details:null,
  output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({proposals})}]}],
  usage:{input_tokens:100,output_tokens:30,total_tokens:130}});

test('experience purpose retains all three prior reservations and consumes its one attempt durably before fetch',async()=>{
  const root=await fakePrior();let budget;
  try{
    budget=await openExperienceBudget(options(root));
    assert.equal(budget.summary().committedReservationUsd,0.125442);
    assert.equal(budget.summary().cumulativeEstimatedStandardCostUsd,0.010702);
    await assert.rejects(openExperienceBudget(options(root)),expectCode('live_validation_locked'));
    const requestId=randomUUID();await budget.begin(requestId);
    const marker=JSON.parse(await readFile(join(root,'output/m3-live-ai-experience-native/.native-experience-purpose-consumed.json')));
    assert.equal(marker.requestId,requestId);
    const reservation=await budget.reserve(requestId,reservationBody());
    const persisted=JSON.parse(await readFile(join(root,'output/m3-live-ai-experience-native/cumulative-budget-ledger.json')));
    assert.equal(persisted.entries[0].result,'reserved');
    assert.equal(budget.summary().cumulativeGenerationCalls,4);
    assert.equal(budget.summary().cumulativeEstimatedStandardCostUsd,null);
    await budget.settle(requestId,{result:'provider_timeout',durationMs:45_000});
    assert.equal(budget.summary().committedReservationUsd,Number((0.125442+reservation.reservationUsd).toFixed(6)));
    const proof=await budget.preservePrior();assert.equal(proof.allThreePriorLedgersBytePreserved,true);
    await budget.close();budget=await openExperienceBudget(options(root));
    assert.throws(()=>budget.assertAvailable(),expectCode('purpose_call_already_consumed'));
    await assert.rejects(budget.begin(randomUUID()),expectCode('purpose_call_already_consumed'));
  }finally{if(budget)await budget.close();await rm(root,{recursive:true,force:true});}
});

test('third ledger, raw evidence and consumed marker cannot be reset or omitted from the fourth-purpose anchor',async()=>{
  for(const mutate of [
    async root=>{await rm(join(root,'output/m3-live-ai-fit-native/.native-fit-purpose-consumed.json'));},
    async root=>{const path=join(root,'output/m3-live-ai-fit-native/cumulative-budget-ledger.json'),third=JSON.parse(await readFile(path));third.entries=[];third.attempt=null;await writeFile(path,JSON.stringify(third));},
    async root=>{const path=join(root,'output/m3-live-ai-fit-native/.native-fit-purpose-consumed.json'),marker=JSON.parse(await readFile(path));marker.requestId=randomUUID();await writeFile(path,JSON.stringify(marker));},
  ]){
    const root=await fakePrior();try{await mutate(root);await assert.rejects(openExperienceBudget(options(root)),error=>['prior_budget_mismatch','cumulative_budget_mismatch'].includes(error.code));}
    finally{await rm(root,{recursive:true,force:true});}
  }
  const root=await fakePrior();let budget;
  try{
    budget=await openExperienceBudget(options(root));await budget.close();budget=null;
    await writeFile(join(root,'output/m3-live-ai-fit-native/native-provider-output-diagnostic.json'),'altered completed response');
    await assert.rejects(openExperienceBudget(options(root)),expectCode('cumulative_budget_mismatch'));
  }finally{if(budget)await budget.close();await rm(root,{recursive:true,force:true});}
});

test('consumed marker blocks a deleted/reset ledger and changed prior evidence fails closed',async()=>{
  const root=await fakePrior();let budget;
  try{
    budget=await openExperienceBudget(options(root));await budget.begin(randomUUID());await budget.close();budget=null;
    const path=join(root,'output/m3-live-ai-experience-native/cumulative-budget-ledger.json');
    const ledger=JSON.parse(await readFile(path));ledger.attempt=null;ledger.entries=[];await writeFile(path,JSON.stringify(ledger));
    await assert.rejects(openExperienceBudget(options(root)),expectCode('purpose_call_already_consumed'));
    await rm(path);await assert.rejects(openExperienceBudget(options(root)),expectCode('purpose_call_already_consumed'));
  }finally{if(budget)await budget.close();await rm(root,{recursive:true,force:true});}
  const changed=await fakePrior();
  try{
    budget=await openExperienceBudget(options(changed));await budget.close();budget=null;
    await writeFile(join(changed,'server/live-expanded-profile-validation.mjs'),'changed guard');
    await assert.rejects(openExperienceBudget(options(changed)),expectCode('prior_budget_mismatch'));
  }finally{if(budget)await budget.close();await rm(changed,{recursive:true,force:true});}
});

test('native exact allowlist rejects foreign facts, changed JD/context and repaired geometry without provider calls',async()=>{
  const {request,allowlist}=await allowlistedRequest();validateExperienceAllowlist(allowlist);
  const wrongWidth=structuredClone(allowlist);wrongWidth.requestShape.blocks[0].layoutBudget.widthPt=385;
  assert.throws(()=>validateExperienceAllowlist(wrongWidth),expectCode('fictional_layout_mismatch'));
  const root=await fakePrior();let budget,calls=0;
  try{
    budget=await openExperienceBudget(options(root));
    const adapter=createGuardedExperienceAdapter({configuration:{apiKey:KEY,model:MODEL,requestsEnabled:false},budget,allowlist,fetchImpl:()=>{calls++;throw Error('must not fetch');}});
    for(const mutate of [value=>{value.job.description+=' changed';},value=>{value.context.projectRevision++;},value=>{value.facts.pop();},value=>{value.blocks[0].layoutBudget.widthPt++;}]){
      const changed=structuredClone(request);mutate(changed);changed.consent.contextHash=consentHash(changed);
      await assert.rejects(adapter.tailor(changed),expectCode('invalid_request'));
    }
    assert.equal(calls,0);assert.equal(budget.summary().additionalGenerationCalls,0);
    await assert.rejects(adapter.tailor(request),expectCode('provider_access'));
    assert.equal(calls,0);
  }finally{if(budget)await budget.close();await rm(root,{recursive:true,force:true});}
});

test('native adapter verifies read-only then reserves one exact browser request, saves actual envelope and refuses retry',async()=>{
  const {request,allowlist}=await allowlistedRequest(),root=await fakePrior();let budget;
  const calls=[];let sentInstructionHash=null;
  try{
    budget=await openExperienceBudget(options(root));
    const adapter=createGuardedExperienceAdapter({configuration:{apiKey:KEY,model:MODEL,requestsEnabled:false},budget,allowlist,fetchImpl:async(url,fetchOptions)=>{
      calls.push({url,method:fetchOptions.method});
      if(fetchOptions.method==='GET')return json({id:MODEL,object:'model'});
      const persisted=JSON.parse(await readFile(join(root,'output/m3-live-ai-experience-native/cumulative-budget-ledger.json')));
      assert.equal(persisted.entries[0].result,'reserved');assert.equal(persisted.attempt.requestId,request.requestId);
      assert.equal(JSON.parse(fetchOptions.body).store,false);
      assert.equal(JSON.parse(fetchOptions.body).reasoning.effort,'medium');
      sentInstructionHash=shaBytes(JSON.parse(fetchOptions.body).instructions);
      return json(completed([]));
    }});
    assert.equal(adapter.status().paidRequestsEnabled,true);assert.equal(calls.length,0);
    await adapter.verify();await adapter.verify();assert.equal(calls.length,1);
    const response=await adapter.tailor(request);assert.deepEqual(response.proposals,[]);
    assert.equal(adapter.status().paidRequestsEnabled,false);
    await assert.rejects(adapter.tailor(request),expectCode('requests_disabled'));
    await assert.rejects(adapter.verify(),expectCode('requests_disabled'));
    assert.deepEqual(calls,[{url:`https://api.openai.com/v1/models/${MODEL}`,method:'GET'},{url:'https://api.openai.com/v1/responses',method:'POST'}]);
    const artifact=JSON.parse(await readFile(join(root,'output/m3-live-ai-experience-native/native-provider-proposal.json')));
    assert.deepEqual(artifact.request,request);assert.deepEqual(artifact.response,response);
    assert.doesNotMatch(JSON.stringify(artifact),new RegExp(KEY));
    const metadata=JSON.parse(await readFile(join(root,'output/m3-live-ai-experience-native/native-provider-result.json')));
    assert.equal(metadata.instructionsHash,sentInstructionHash);
    assert.equal(budget.summary().cumulativeEstimatedStandardCostUsd,0.011202);
  }finally{if(budget)await budget.close();await rm(root,{recursive:true,force:true});}
});

test('invalid real-style proposal remains sanitized diagnostic evidence and consumes scope without transport retry',async()=>{
  const {request,allowlist}=await allowlistedRequest(),root=await fakePrior();let budget,posts=0;
  try{
    budget=await openExperienceBudget(options(root));
    const invalid={blockId:request.blocks[0].id,beforeText:EXPERIENCE_TEXT,afterText:EXPERIENCE_TEXT+'X',factIds:[request.facts[0].id],reason:'Fictional cap failure'};
    const adapter=createGuardedExperienceAdapter({configuration:{apiKey:KEY,model:MODEL,requestsEnabled:false},budget,allowlist,fetchImpl:async(_url,fetchOptions)=>{
      if(fetchOptions.method==='GET')return json({id:MODEL,object:'model'});posts++;return json(completed([invalid]));
    }});
    await adapter.verify();await assert.rejects(adapter.tailor(request),expectCode('provider_invalid_response'));
    await assert.rejects(adapter.tailor(request),expectCode('requests_disabled'));assert.equal(posts,1);
    const diagnostic=JSON.parse(await readFile(join(root,'output/m3-live-ai-experience-native/native-provider-output-diagnostic.json')));
    assert.equal(JSON.parse(diagnostic.proposalJsonText).proposals[0].afterText,EXPERIENCE_TEXT+'X');
    const metadata=JSON.parse(await readFile(join(root,'output/m3-live-ai-experience-native/native-provider-result.json')));
    assert.equal(metadata.result,'failed');assert.equal(metadata.errorCode,'provider_invalid_response');assert.deepEqual(metadata.usage,{inputTokens:100,outputTokens:30,totalTokens:130});
    assert.equal(budget.summary().cumulativeEstimatedStandardCostUsd,0.011202);
  }finally{if(budget)await budget.close();await rm(root,{recursive:true,force:true});}
  const diagnostic=captureFictionalGenerationResult(completed([{afterText:`${KEY} sk-fakeSecretCredential123`}]),KEY);
  assert.equal(diagnostic.credentialEchoRedacted,true);assert.doesNotMatch(diagnostic.proposalJsonText,/synthetic-native-key|sk-fakeSecret/);
  const capped=captureFictionalGenerationResult(completed([{afterText:'X'.repeat(40*1024)}]),KEY);
  assert.equal(capped.textWasTruncated,true);assert.ok(Buffer.byteLength(capped.proposalJsonText)<=32*1024);
  const multibyte=captureFictionalGenerationResult(completed([{afterText:'😀'.repeat(20*1024)}]),KEY);
  assert.equal(multibyte.textWasTruncated,true);assert.ok(Buffer.byteLength(multibyte.proposalJsonText)<=32*1024);
});
