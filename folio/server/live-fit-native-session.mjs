// Explicitly reviewed fictional native browser session only. No startup provider call.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createAiAdapter, SafeAiError } from './adapter.mjs';
import { BACKEND_HOST, BACKEND_PORT, createAiServer } from './http.mjs';
import { readServerConfiguration } from './config.mjs';
import { canonicalJson, consentHash, MODEL, tailorRequestSchema } from './contract.mjs';
import { FitGuardError, FIT_PURPOSE, openFitBudget, shaBytes } from './live-fit-budget.mjs';
import { safeUsage } from './live-budget.mjs';

export const FIT_PROFILE = 'Product designer focused on accessible interfaces and clear design systems.';
export const FIT_FIGMA = 'Built a reusable design system in Figma with engineering partners.';
export const FIT_FIXTURE_HASH = '6bf0da8b30d1e4be32d022a2293e24e9b80fe2196d3ab09d483a217bb07a7582';
// Independently observed fresh import width = source item advance + 0.5 pt.
export const FIT_PROFILE_WIDTH_PT = 385.30957044;
export const FIT_JOB = Object.freeze({
  title:'Product Designer',company:'Fictional Harbor Lab',
  description:'Fictional product designer role prioritizing Figma design systems built with engineering partners; accessible interface design remains relevant.',
});
const ROOT = fileURLToPath(new URL('../',import.meta.url));
const OUTPUT = join(ROOT,'output/m3-live-ai-fit-native');
const ALLOWLIST = join(OUTPUT,'native-allowlist.json');
const safeCode = error => error instanceof SafeAiError||error instanceof FitGuardError ? error.code : 'internal_error';
export function requestShape(request) {const {requestId,consent,...shape}=request;return shape;}

/** Only successful HTTP JSON assistant text, never error objects/headers/refusal prose. */
export function captureFictionalGenerationResult(value,apiKey) {
  const text=Array.isArray(value?.output)?value.output.flatMap(item=>item?.type==='message'&&item.role==='assistant'&&Array.isArray(item.content)
    ?item.content.filter(part=>part?.type==='output_text'&&typeof part.text==='string').map(part=>part.text):[]).join('\n'):'';
  let redacted=text;
  if(apiKey)redacted=redacted.split(apiKey).join('[redacted credential]');
  redacted=redacted.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g,'[redacted credential-like token]');
  const bytes=Buffer.from(redacted,'utf8'),cap=32*1024;
  let bounded=bytes.subarray(0,cap).toString('utf8');
  while(Buffer.byteLength(bounded,'utf8')>cap)bounded=bounded.slice(0,-1);
  const usage=safeUsage({inputTokens:value?.usage?.input_tokens,outputTokens:value?.usage?.output_tokens,totalTokens:value?.usage?.total_tokens});
  return {fictionalOnly:true,source:'actual successful HTTP generation output before proposal validation',modelMatched:value?.model===MODEL,
    completionStatus:['completed','incomplete','failed','cancelled','queued','in_progress'].includes(value?.status)?value.status:'unknown',
    providerErrorPresent:Boolean(value?.error),proposalJsonText:bounded,usage,
    textWasTruncated:bytes.length>cap,credentialEchoRedacted:redacted!==text};
}

/** Exact expected fictional context/selection/job, allowing only a fresh consent identity. */
export function validateFitAllowlist(value) {
  if(!value||Object.keys(value).sort().join(',')!=='fictionalOnly,purpose,requestShape,schemaVersion'||value.schemaVersion!==1||value.fictionalOnly!==true||value.purpose!==FIT_PURPOSE)throw new FitGuardError('invalid_native_allowlist');
  const shape=value.requestShape;
  const request={...shape,requestId:randomUUID()};request.consent={confirmed:true,contextHash:consentHash(request)};
  if(!tailorRequestSchema.safeParse(request).success||canonicalJson(requestShape(request))!==canonicalJson(shape))throw new FitGuardError('invalid_native_allowlist');
  if(canonicalJson(shape.job)!==canonicalJson(FIT_JOB)||shape.facts.length!==2||shape.blocks.length!==1)throw new FitGuardError('fictional_scope_mismatch');
  const profile=shape.facts.find(fact=>fact.text===FIT_PROFILE),figma=shape.facts.find(fact=>fact.text===FIT_FIGMA),block=shape.blocks[0];
  if(!profile||!figma||shape.facts.some(fact=>fact.kind!=='resume'||fact.source.kind!=='resume'||fact.source.hash!==FIT_FIXTURE_HASH||fact.source.quote!==fact.text)||
    block.text!==FIT_PROFILE||canonicalJson(block.requiredFactIds)!==canonicalJson([profile.id]))throw new FitGuardError('fictional_scope_mismatch');
  const b=block.layoutBudget;
  if(Math.abs(b.widthPt-FIT_PROFILE_WIDTH_PT)>0.001||Math.abs(b.heightPt-12.5)>0.001||b.fontFamily!=='sans'||b.fontSizePt!==10||b.fontWeight!==400||b.italic!==false||b.maxLines!==1||b.maxCharacters!==FIT_PROFILE.length)throw new FitGuardError('fictional_layout_mismatch');
  return structuredClone(value);
}

export function assertAllowedFitRequest(body,allowlist) {
  const parsed=tailorRequestSchema.safeParse(body);
  if(!parsed.success||consentHash(parsed.data)!==parsed.data.consent.contextHash||canonicalJson(requestShape(parsed.data))!==canonicalJson(allowlist.requestShape))throw new SafeAiError('invalid_request',400);
  return parsed.data;
}

export function createGuardedFitAdapter({configuration,budget,allowlist,fetchImpl=globalThis.fetch,log=()=>{}}) {
  validateFitAllowlist(allowlist);
  if(!configuration?.apiKey||configuration.model!==MODEL||configuration.requestsEnabled!==false)throw new FitGuardError('configuration_mismatch');
  let consumed=false,providerPosts=0,providerGets=0,activeRequest=null,diagnosticResult=null;
  const adapter=createAiAdapter({configuration:Object.freeze({...configuration,requestsEnabled:true}),observeGenerationResult:value=>{diagnosticResult=captureFictionalGenerationResult(value,configuration.apiKey);},fetchImpl:async(url,options)=>{
    if(url===`https://api.openai.com/v1/models/${MODEL}`&&options.method==='GET'&&providerGets===0){providerGets++;return await fetchImpl(url,options);}
    if(url!=='https://api.openai.com/v1/responses'||options.method!=='POST'||providerPosts!==0||!activeRequest)throw new FitGuardError('unexpected_provider_call');
    const reservation=await budget.reserve(activeRequest.requestId,options.body);providerPosts++;
    log({stage:'native-fit-reserved',requestId:activeRequest.requestId,reservationUsd:reservation.reservationUsd,...budget.summary()});
    return await fetchImpl(url,options);
  }});
  return Object.freeze({
    status(){let available=!consumed;try{budget.assertAvailable();}catch{available=false;}return {...adapter.status(),paidRequestsEnabled:available};},
    async verify(){
      if(consumed)throw new SafeAiError('requests_disabled',403);budget.assertAvailable();
      if(adapter.status().accountModelVerified)return this.status();
      const start=Date.now();
      try{await adapter.verify();await budget.account('verified',Date.now()-start);log({stage:'native-fit-account-verified',model:MODEL});}
      catch(error){await budget.account(safeCode(error),Date.now()-start);throw error instanceof SafeAiError?error:new SafeAiError('provider_error');}
      return this.status();
    },
    async tailor(body){
      if(consumed)throw new SafeAiError('requests_disabled',403);budget.assertAvailable();
      const request=assertAllowedFitRequest(body,allowlist);
      if(!adapter.status().accountModelVerified)throw new SafeAiError('provider_access',403);
      consumed=true;activeRequest=request;
      await budget.begin(request.requestId);
      const start=Date.now();let response=null,errorCode=null;
      try{response=await adapter.tailor(request);}catch(error){errorCode=safeCode(error);}
      const entry=await budget.settle(request.requestId,{result:response?'success':errorCode,durationMs:Date.now()-start,usage:response?.usage??diagnosticResult?.usage??null,proposalCount:response?.proposals.length??null});
      const metadata={stage:response?'native-fit-generation-verified':'native-fit-generation-failed',result:response?'success':'failed',errorCode,
        purpose:FIT_PURPOSE,model:MODEL,requestId:request.requestId,durationMs:entry?.durationMs??Date.now()-start,
        usage:entry?.usage??null,estimatedStandardCostUsd:entry?.estimatedStandardCostUsd??null,reservationUsd:entry?.reservationUsd??0,
        proposalCount:response?.proposals.length??null,afterTextCharacters:response?.proposals.map(proposal=>proposal.afterText.length)??[],
        persistentPaidRequestsEnabled:false,actualProviderPostCount:providerPosts,...budget.summary()};
      if(diagnosticResult)await budget.artifact('native-provider-output-diagnostic.json',diagnosticResult);
      if(response){
        if(JSON.stringify(response).includes(configuration.apiKey))throw new FitGuardError('credential_echo');
        await budget.artifact('native-provider-proposal.json',{provenance:{fictionalOnly:true,source:'actual-provider-response-through-native-browser-request',
          protocol:'expanded-envelope-v1-with-layout-budget',fixture:'m3-qa-resume.pdf',manualSourceGroundingReview:'pending',layoutFitVerified:false},request,response});
      }
      await budget.artifact('native-provider-result.json',metadata);await budget.preservePrior();log(metadata);activeRequest=null;
      if(!response)throw new SafeAiError(errorCode in {provider_auth:1,provider_access:1,provider_rate_limit:1,provider_error:1,provider_timeout:1,provider_invalid_response:1,provider_refusal:1,provider_incomplete:1}?errorCode:'provider_error');
      return response;
    },
  });
}

export async function startNativeFitSession() {
  const allowlistBytes=await readFile(ALLOWLIST),allowlist=validateFitAllowlist(JSON.parse(allowlistBytes));
  if(shaBytes(await readFile(join(ROOT,'public/fixtures/m3-qa-resume.pdf')))!==FIT_FIXTURE_HASH)throw new FitGuardError('fictional_scope_mismatch');
  const configuration=readServerConfiguration();
  if(!configuration.apiKey||configuration.model!==MODEL||configuration.requestsEnabled!==false)throw new FitGuardError('configuration_mismatch');
  const budget=await openFitBudget({root:ROOT,outputDirectory:OUTPUT,allowlistHash:shaBytes(allowlistBytes)});
  try{budget.assertAvailable();}catch(error){await budget.close();throw error;}
  const log=value=>console.log(JSON.stringify(value));
  const server=createAiServer(createGuardedFitAdapter({configuration,budget,allowlist,log}));
  let stopping=false;
  async function stop(){if(stopping)return;stopping=true;server.close();server.closeAllConnections();try{await budget.preservePrior();}finally{await budget.close();}}
  server.on('error',async()=>{log({stage:'native-fit-stopped',errorCode:'local_server_unavailable'});process.exitCode=1;await stop();});
  server.listen(BACKEND_PORT,BACKEND_HOST,()=>log({stage:'native-fit-session-ready',purpose:FIT_PURPOSE,persistentPaidRequestsEnabled:false,automaticProviderCalls:0,...budget.summary()}));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stop().catch(()=>{log({stage:'native-fit-stopped',errorCode:'internal_error'});process.exitCode=1;});});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==5||process.argv[2]!=='--authorized-budget-usd=5'||process.argv[3]!==`--purpose=${FIT_PURPOSE}`||process.argv[4]!=='--native-gate-reviewed'){
    console.log(JSON.stringify({stage:'native-fit-stopped',errorCode:'explicit_native_purpose_and_budget_required'}));process.exitCode=1;
  }else{try{await startNativeFitSession();}catch(error){console.log(JSON.stringify({stage:'native-fit-stopped',errorCode:safeCode(error)}));process.exitCode=1;}}
}
