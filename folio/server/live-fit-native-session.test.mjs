import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { MODEL, MAX_OUTPUT_TOKENS, consentHash } from './contract.mjs';
import { FIT_PRIOR_FILES, FIT_PURPOSE, openFitBudget, shaBytes } from './live-fit-budget.mjs';
import { FIT_PROFILE, FIT_FIGMA, FIT_JOB, FIT_PROFILE_WIDTH_PT, requestShape, validateFitAllowlist, createGuardedFitAdapter, captureFictionalGenerationResult } from './live-fit-native-session.mjs';

const KEY='synthetic-native-key-never-real';
const expectCode=code=>error=>error.code===code&&!String(error).includes(KEY);
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const reservationBody=()=>JSON.stringify({model:MODEL,store:false,stream:false,reasoning:{effort:'medium'},max_output_tokens:MAX_OUTPUT_TOKENS,input:'Fictional only'});

async function allowlistedRequest() {
  const historical=JSON.parse(await readFile(new URL('../output/m3-live-ai-expanded-profile/expanded-profile-proposal.json',import.meta.url),'utf8'));
  const qa=JSON.parse(await readFile(new URL('../output/m3-qa/q10-ai-client-replay-results.json',import.meta.url),'utf8'));
  const selected=qa.requests.find(entry=>entry.path==='/api/ai/tailor'&&entry.method==='POST').selected;
  const request=structuredClone(historical.request);
  request.requestId=randomUUID();request.job={...FIT_JOB};
  request.facts.push(structuredClone(selected.facts.find(fact=>fact.text===FIT_FIGMA)));
  request.blocks[0].requiredFactIds=[request.facts.find(fact=>fact.text===FIT_PROFILE).id];
  request.blocks[0].layoutBudget={version:1,regionId:'fictional-profile-region',widthPt:FIT_PROFILE_WIDTH_PT,heightPt:12.5,
    fontFamily:'sans',fontSizePt:10,fontWeight:400,italic:false,lineHeightPt:12.5,maxLines:1,maxCharacters:75};
  request.consent.contextHash=consentHash(request);
  return {request,allowlist:{schemaVersion:1,purpose:FIT_PURPOSE,fictionalOnly:true,requestShape:requestShape(request)}};
}

async function fakePrior() {
  const root=await mkdtemp(join(tmpdir(),'folio-native-fit-'));
  for(const path of FIT_PRIOR_FILES){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),'fictional preserved evidence');}
  const original={schemaVersion:1,model:MODEL,budgetUsd:5,maxGenerationCalls:3,reservationPolicy:'retain-full-reservation-for-every-call',
    entries:[{result:'success',reservationUsd:0.038106,estimatedStandardCostUsd:0.003156}]};
  await writeFile(join(root,'output/m3-live-ai/budget-ledger.json'),JSON.stringify(original));
  const originalHashes=Object.fromEntries(await Promise.all(FIT_PRIOR_FILES.filter(path=>path.startsWith('output/m3-live-ai/')).map(async path=>[path.split('/').at(-1),shaBytes(await readFile(join(root,path)))])));
  const expanded={schemaVersion:1,purpose:'expanded-profile-after-overflow',model:MODEL,budgetUsd:5,maxAdditionalGenerationCalls:1,maxCumulativeGenerationCalls:3,reservationPolicy:'retain-full-prior-and-new-reservations',
    anchor:{priorLedgerHash:originalHashes['budget-ledger.json'],priorCommittedReservationUsd:0.038106,priorEstimatedStandardCostUsd:0.003156,priorArtifactHashes:originalHashes},
    entries:[{result:'success',reservationUsd:0.041043,estimatedStandardCostUsd:0.002236}]};
  await writeFile(join(root,'output/m3-live-ai-expanded-profile/cumulative-budget-ledger.json'),JSON.stringify(expanded));
  return root;
}
const options=root=>({root,allowlistHash:shaBytes('fictional-reviewed-allowlist')});
const completed=proposals=>({model:MODEL,status:'completed',error:null,incomplete_details:null,
  output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({proposals})}]}],
  usage:{input_tokens:100,output_tokens:30,total_tokens:130}});

test('native purpose includes both prior reservations and durably consumes its single attempt before fetch',async()=>{
  const root=await fakePrior();let budget;
  try{
    budget=await openFitBudget(options(root));
    assert.equal(budget.summary().committedReservationUsd,0.079149);
    assert.equal(budget.summary().cumulativeEstimatedStandardCostUsd,0.005392);
    await assert.rejects(openFitBudget(options(root)),expectCode('live_validation_locked'));
    const requestId=randomUUID();await budget.begin(requestId);
    const marker=JSON.parse(await readFile(join(root,'output/m3-live-ai-fit-native/.native-fit-purpose-consumed.json')));
    assert.equal(marker.requestId,requestId);
    const reservation=await budget.reserve(requestId,reservationBody());
    const persisted=JSON.parse(await readFile(join(root,'output/m3-live-ai-fit-native/cumulative-budget-ledger.json')));
    assert.equal(persisted.entries[0].result,'reserved');
    assert.equal(budget.summary().cumulativeGenerationCalls,3);
    assert.equal(budget.summary().cumulativeEstimatedStandardCostUsd,null);
    await budget.settle(requestId,{result:'provider_timeout',durationMs:45_000});
    assert.equal(budget.summary().committedReservationUsd,Number((0.079149+reservation.reservationUsd).toFixed(6)));
    const proof=await budget.preservePrior();assert.equal(proof.bothPriorLedgersBytePreserved,true);
    await budget.close();budget=await openFitBudget(options(root));
    assert.throws(()=>budget.assertAvailable(),expectCode('purpose_call_already_consumed'));
    await assert.rejects(budget.begin(randomUUID()),expectCode('purpose_call_already_consumed'));
  }finally{if(budget)await budget.close();await rm(root,{recursive:true,force:true});}
});

test('consumed marker blocks a deleted/reset ledger and changed prior evidence fails closed',async()=>{
  const root=await fakePrior();let budget;
  try{
    budget=await openFitBudget(options(root));await budget.begin(randomUUID());await budget.close();budget=null;
    const path=join(root,'output/m3-live-ai-fit-native/cumulative-budget-ledger.json');
    const ledger=JSON.parse(await readFile(path));ledger.attempt=null;ledger.entries=[];await writeFile(path,JSON.stringify(ledger));
    await assert.rejects(openFitBudget(options(root)),expectCode('purpose_call_already_consumed'));
    await rm(path);await assert.rejects(openFitBudget(options(root)),expectCode('purpose_call_already_consumed'));
  }finally{if(budget)await budget.close();await rm(root,{recursive:true,force:true});}
  const changed=await fakePrior();
  try{
    budget=await openFitBudget(options(changed));await budget.close();budget=null;
    await writeFile(join(changed,'server/live-expanded-profile-validation.mjs'),'changed guard');
    await assert.rejects(openFitBudget(options(changed)),expectCode('cumulative_budget_mismatch'));
  }finally{if(budget)await budget.close();await rm(changed,{recursive:true,force:true});}
});

test('native exact allowlist rejects foreign facts, changed JD/context and repaired geometry without provider calls',async()=>{
  const {request,allowlist}=await allowlistedRequest();validateFitAllowlist(allowlist);
  const wrongWidth=structuredClone(allowlist);wrongWidth.requestShape.blocks[0].layoutBudget.widthPt=385;
  assert.throws(()=>validateFitAllowlist(wrongWidth),expectCode('fictional_layout_mismatch'));
  const root=await fakePrior();let budget,calls=0;
  try{
    budget=await openFitBudget(options(root));
    const adapter=createGuardedFitAdapter({configuration:{apiKey:KEY,model:MODEL,requestsEnabled:false},budget,allowlist,fetchImpl:()=>{calls++;throw Error('must not fetch');}});
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
  const calls=[];
  try{
    budget=await openFitBudget(options(root));
    const adapter=createGuardedFitAdapter({configuration:{apiKey:KEY,model:MODEL,requestsEnabled:false},budget,allowlist,fetchImpl:async(url,fetchOptions)=>{
      calls.push({url,method:fetchOptions.method});
      if(fetchOptions.method==='GET')return json({id:MODEL,object:'model'});
      const persisted=JSON.parse(await readFile(join(root,'output/m3-live-ai-fit-native/cumulative-budget-ledger.json')));
      assert.equal(persisted.entries[0].result,'reserved');assert.equal(persisted.attempt.requestId,request.requestId);
      assert.equal(JSON.parse(fetchOptions.body).store,false);
      assert.equal(JSON.parse(fetchOptions.body).reasoning.effort,'medium');
      return json(completed([]));
    }});
    assert.equal(adapter.status().paidRequestsEnabled,true);assert.equal(calls.length,0);
    await adapter.verify();await adapter.verify();assert.equal(calls.length,1);
    const response=await adapter.tailor(request);assert.deepEqual(response.proposals,[]);
    assert.equal(adapter.status().paidRequestsEnabled,false);
    await assert.rejects(adapter.tailor(request),expectCode('requests_disabled'));
    await assert.rejects(adapter.verify(),expectCode('requests_disabled'));
    assert.deepEqual(calls,[{url:`https://api.openai.com/v1/models/${MODEL}`,method:'GET'},{url:'https://api.openai.com/v1/responses',method:'POST'}]);
    const artifact=JSON.parse(await readFile(join(root,'output/m3-live-ai-fit-native/native-provider-proposal.json')));
    assert.deepEqual(artifact.request,request);assert.deepEqual(artifact.response,response);
    assert.doesNotMatch(JSON.stringify(artifact),new RegExp(KEY));
    assert.equal(budget.summary().cumulativeEstimatedStandardCostUsd,0.005892);
  }finally{if(budget)await budget.close();await rm(root,{recursive:true,force:true});}
});

test('invalid real-style proposal remains sanitized diagnostic evidence and consumes scope without transport retry',async()=>{
  const {request,allowlist}=await allowlistedRequest(),root=await fakePrior();let budget,posts=0;
  try{
    budget=await openFitBudget(options(root));
    const invalid={blockId:request.blocks[0].id,beforeText:FIT_PROFILE,afterText:FIT_PROFILE+'X',factIds:[request.facts[0].id],reason:'Fictional cap failure'};
    const adapter=createGuardedFitAdapter({configuration:{apiKey:KEY,model:MODEL,requestsEnabled:false},budget,allowlist,fetchImpl:async(_url,fetchOptions)=>{
      if(fetchOptions.method==='GET')return json({id:MODEL,object:'model'});posts++;return json(completed([invalid]));
    }});
    await adapter.verify();await assert.rejects(adapter.tailor(request),expectCode('provider_invalid_response'));
    await assert.rejects(adapter.tailor(request),expectCode('requests_disabled'));assert.equal(posts,1);
    const diagnostic=JSON.parse(await readFile(join(root,'output/m3-live-ai-fit-native/native-provider-output-diagnostic.json')));
    assert.equal(JSON.parse(diagnostic.proposalJsonText).proposals[0].afterText,FIT_PROFILE+'X');
    const metadata=JSON.parse(await readFile(join(root,'output/m3-live-ai-fit-native/native-provider-result.json')));
    assert.equal(metadata.result,'failed');assert.equal(metadata.errorCode,'provider_invalid_response');assert.deepEqual(metadata.usage,{inputTokens:100,outputTokens:30,totalTokens:130});
    assert.equal(budget.summary().cumulativeEstimatedStandardCostUsd,0.005892);
  }finally{if(budget)await budget.close();await rm(root,{recursive:true,force:true});}
  const diagnostic=captureFictionalGenerationResult(completed([{afterText:`${KEY} sk-fakeSecretCredential123`}]),KEY);
  assert.equal(diagnostic.credentialEchoRedacted,true);assert.doesNotMatch(diagnostic.proposalJsonText,/synthetic-native-key|sk-fakeSecret/);
  const capped=captureFictionalGenerationResult(completed([{afterText:'X'.repeat(40*1024)}]),KEY);
  assert.equal(capped.textWasTruncated,true);assert.ok(Buffer.byteLength(capped.proposalJsonText)<=32*1024);
  const multibyte=captureFictionalGenerationResult(completed([{afterText:'😀'.repeat(20*1024)}]),KEY);
  assert.equal(multibyte.textWasTruncated,true);assert.ok(Buffer.byteLength(multibyte.proposalJsonText)<=32*1024);
});
