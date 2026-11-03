// Manual fictional native test only; production server never imports this file.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { MODEL, MAX_OUTPUT_TOKENS } from './contract.mjs';
import { generationReservation, safeUsage, estimatedStandardCost } from './live-budget.mjs';

export const FIT_PURPOSE = 'fit-profile-native-after-diagnosis';
export const FIT_BUDGET_USD = 5;
export const PRIOR_FIT_RESERVATION_USD = 0.079149;
export const PRIOR_FIT_ESTIMATE_USD = 0.005392;
export const FIT_PRIOR_FILES = [
  ...['budget-ledger.json', 'live-result.json', 'positive-proposal.json', 'protocol-envelope-label.json', 'source-grounding-review.json'].map(name => `output/m3-live-ai/${name}`),
  ...['cumulative-budget-ledger.json', 'expanded-profile-result.json', 'expanded-profile-proposal.json', 'prior-artifact-preservation.json', 'source-grounding-review.json'].map(name => `output/m3-live-ai-expanded-profile/${name}`),
  'server/live-budget.mjs', 'server/live-validation.mjs', 'server/live-expanded-profile-validation.mjs',
];
const RESULT_CODES = ['reserved', 'success', 'provider_auth', 'provider_access', 'provider_rate_limit', 'provider_error', 'provider_timeout', 'provider_invalid_response', 'provider_refusal', 'provider_incomplete', 'internal_error'];
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usd = z.number().finite().nonnegative().max(FIT_BUDGET_USD);
const entrySchema = z.object({
  requestId: z.string().uuid(), reservedAt: z.string().datetime(), providerBodyBytes: count,
  inputTokenBound: count, maxOutputTokens: z.literal(MAX_OUTPUT_TOKENS), reservationUsd: usd,
  result: z.enum(RESULT_CODES), durationMs: count.nullable(),
  usage: z.object({inputTokens:count,outputTokens:count,totalTokens:count}).strict().nullable(),
  estimatedStandardCostUsd: usd.nullable(), proposalCount: count.nullable(),
}).strict();
const ledgerSchema = z.object({
  schemaVersion:z.literal(1), purpose:z.literal(FIT_PURPOSE), model:z.literal(MODEL), budgetUsd:z.literal(FIT_BUDGET_USD),
  maxAdditionalGenerationCalls:z.literal(1), maxCumulativeGenerationCalls:z.literal(3),
  reservationPolicy:z.literal('retain-full-prior-and-new-reservations'),
  anchor:z.object({
    priorGenerationCalls:z.literal(2), priorCommittedReservationUsd:z.literal(PRIOR_FIT_RESERVATION_USD),
    priorEstimatedStandardCostUsd:z.literal(PRIOR_FIT_ESTIMATE_USD),
    immutableFileHashes:z.object(Object.fromEntries(FIT_PRIOR_FILES.map(path => [path,digest]))).strict(),
    allowlistHash:digest,
  }).strict(),
  account:z.object({verified:z.boolean(),result:z.enum(['verified',...RESULT_CODES]),durationMs:count,checkedAt:z.string().datetime()}).strict().nullable(),
  attempt:z.object({requestId:z.string().uuid(),acceptedAt:z.string().datetime(),result:z.enum(['started',...RESULT_CODES])}).strict().nullable(),
  entries:z.array(entrySchema).max(1),
}).strict().superRefine((ledger,ctx) => {
  const invalid=()=>ctx.addIssue({code:'custom',message:'Invalid bounded ledger.'});
  if (ledger.entries.length && (!ledger.attempt || ledger.entries[0].requestId !== ledger.attempt.requestId)) invalid();
  if (PRIOR_FIT_RESERVATION_USD + ledger.entries.reduce((sum,entry)=>sum+entry.reservationUsd,0)>FIT_BUDGET_USD) invalid();
});
const consumedSchema=z.object({purpose:z.literal(FIT_PURPOSE),requestId:z.string().uuid(),acceptedAt:z.string().datetime(),allowlistHash:digest}).strict();

export class FitGuardError extends Error {
  constructor(code) {super('The purpose-scoped native test guard stopped the operation.');this.code=code;}
}
export const shaBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const rounded = value => Number(value.toFixed(6));

async function atomicJson(path,value) {
  const temporary=join(dirname(path),`.fit-budget-write-${randomUUID()}.json`);
  const file=await open(temporary,'wx',0o600);
  try {await file.writeFile(JSON.stringify(value,null,2)+'\n');await file.sync();} finally {await file.close();}
  await rename(temporary,path);
  const directory=await open(dirname(path),'r');try {await directory.sync();}finally{await directory.close();}
}
async function immutableHashes(root) {
  return Object.fromEntries(await Promise.all(FIT_PRIOR_FILES.map(async path=>[path,shaBytes(await readFile(join(root,path)))])));
}

export async function openFitBudget({root,outputDirectory=join(root,'output/m3-live-ai-fit-native'),allowlistHash}) {
  if(!digest.safeParse(allowlistHash).success)throw new FitGuardError('invalid_allowlist_hash');
  const lockPath=join(root,'output/m3-live-ai/.live-validation.lock');
  let lock;try{lock=await open(lockPath,'wx',0o600);}catch{throw new FitGuardError('live_validation_locked');}
  let ledger,anchor,consumedMarker=null;
  const ledgerPath=join(outputDirectory,'cumulative-budget-ledger.json');
  const consumedPath=join(outputDirectory,'.native-fit-purpose-consumed.json');
  try {
    const hashes=await immutableHashes(root);
    const original=JSON.parse(await readFile(join(root,'output/m3-live-ai/budget-ledger.json'),'utf8'));
    const expanded=JSON.parse(await readFile(join(root,'output/m3-live-ai-expanded-profile/cumulative-budget-ledger.json'),'utf8'));
    if(original.schemaVersion!==1||original.model!==MODEL||original.budgetUsd!==FIT_BUDGET_USD||original.maxGenerationCalls!==3||original.reservationPolicy!=='retain-full-reservation-for-every-call'||
       original.entries?.length!==1||original.entries[0].result!=='success'||original.entries[0].reservationUsd!==0.038106||original.entries[0].estimatedStandardCostUsd!==0.003156||
       expanded.schemaVersion!==1||expanded.purpose!=='expanded-profile-after-overflow'||expanded.model!==MODEL||expanded.budgetUsd!==FIT_BUDGET_USD||expanded.maxAdditionalGenerationCalls!==1||expanded.maxCumulativeGenerationCalls!==3||expanded.reservationPolicy!=='retain-full-prior-and-new-reservations'||
       expanded.entries?.length!==1||expanded.entries[0].result!=='success'||expanded.entries[0].reservationUsd!==0.041043||expanded.entries[0].estimatedStandardCostUsd!==0.002236||
       expanded.anchor?.priorLedgerHash!==hashes['output/m3-live-ai/budget-ledger.json']||expanded.anchor?.priorCommittedReservationUsd!==0.038106||
       expanded.anchor?.priorEstimatedStandardCostUsd!==0.003156||
       Object.entries(expanded.anchor?.priorArtifactHashes??{}).some(([name,hash])=>hash!==hashes[`output/m3-live-ai/${name}`]))throw new FitGuardError('prior_budget_mismatch');
    anchor={priorGenerationCalls:2,priorCommittedReservationUsd:PRIOR_FIT_RESERVATION_USD,priorEstimatedStandardCostUsd:PRIOR_FIT_ESTIMATE_USD,immutableFileHashes:hashes,allowlistHash};
    await mkdir(outputDirectory,{recursive:true});
    try{consumedMarker=consumedSchema.parse(JSON.parse(await readFile(consumedPath,'utf8')));}catch(error){if(error.code!=='ENOENT')throw error;}
    try {
      const parsed=ledgerSchema.safeParse(JSON.parse(await readFile(ledgerPath,'utf8')));
      if(!parsed.success||JSON.stringify(parsed.data.anchor)!==JSON.stringify(anchor))throw new FitGuardError('cumulative_budget_mismatch');
      ledger=parsed.data;
    }catch(error){
      if(error.code!=='ENOENT')throw error;
      if(consumedMarker)throw new FitGuardError('purpose_call_already_consumed');
      ledger={schemaVersion:1,purpose:FIT_PURPOSE,model:MODEL,budgetUsd:FIT_BUDGET_USD,maxAdditionalGenerationCalls:1,maxCumulativeGenerationCalls:3,
        reservationPolicy:'retain-full-prior-and-new-reservations',anchor,account:null,attempt:null,entries:[]};
      await atomicJson(ledgerPath,ledger);
    }
    if(consumedMarker&&(!ledger.attempt||consumedMarker.requestId!==ledger.attempt.requestId||consumedMarker.allowlistHash!==allowlistHash))throw new FitGuardError('purpose_call_already_consumed');
    if(ledger.attempt&&!consumedMarker)throw new FitGuardError('cumulative_budget_mismatch');
  }catch(error){await lock.close();await unlink(lockPath);throw error instanceof FitGuardError?error:new FitGuardError('cumulative_budget_mismatch');}
  const committed=()=>rounded(PRIOR_FIT_RESERVATION_USD+ledger.entries.reduce((sum,entry)=>sum+entry.reservationUsd,0));
  return {
    assertAvailable(){if(ledger.attempt!==null)throw new FitGuardError('purpose_call_already_consumed');},
    summary(){return{budgetUsd:FIT_BUDGET_USD,priorGenerationCalls:2,additionalGenerationCalls:ledger.entries.length,cumulativeGenerationCalls:2+ledger.entries.length,
      committedReservationUsd:committed(),remainingBudgetUsd:rounded(FIT_BUDGET_USD-committed()),cumulativeEstimatedStandardCostUsd:ledger.entries.some(entry=>entry.estimatedStandardCostUsd===null)?null:rounded(PRIOR_FIT_ESTIMATE_USD+ledger.entries.reduce((sum,entry)=>sum+entry.estimatedStandardCostUsd,0))};},
    async account(result,durationMs){ledger.account={verified:result==='verified',result:result==='verified'||RESULT_CODES.includes(result)?result:'internal_error',durationMs,checkedAt:new Date().toISOString()};await atomicJson(ledgerPath,ledger);},
    async begin(requestId){this.assertAvailable();if(!z.string().uuid().safeParse(requestId).success)throw new FitGuardError('invalid_request_id');
      const acceptedAt=new Date().toISOString(),marker={purpose:FIT_PURPOSE,requestId,acceptedAt,allowlistHash};
      let file;try{file=await open(consumedPath,'wx',0o600);}catch{throw new FitGuardError('purpose_call_already_consumed');}
      try{await file.writeFile(JSON.stringify(marker)+'\n');await file.sync();}finally{await file.close();}
      const directory=await open(outputDirectory,'r');try{await directory.sync();}finally{await directory.close();}
      consumedMarker=marker;ledger.attempt={requestId,acceptedAt,result:'started'};await atomicJson(ledgerPath,ledger);},
    async reserve(requestId,body){
      if(ledger.attempt?.requestId!==requestId||ledger.attempt.result!=='started'||ledger.entries.length)throw new FitGuardError('purpose_call_already_consumed');
      const reservation=generationReservation(body);
      if(committed()+reservation.reservationUsd>FIT_BUDGET_USD)throw new FitGuardError('budget_exhausted');
      ledger.entries.push({requestId,reservedAt:new Date().toISOString(),...reservation,result:'reserved',durationMs:null,usage:null,estimatedStandardCostUsd:null,proposalCount:null});
      await atomicJson(ledgerPath,ledger);return reservation;
    },
    async settle(requestId,{result,durationMs,usage=null,proposalCount=null}){
      if(ledger.attempt?.requestId!==requestId||ledger.attempt.result!=='started')throw new FitGuardError('invalid_settlement');
      const safeResult=RESULT_CODES.includes(result)&&result!=='reserved'?result:'internal_error';
      const entry=ledger.entries[0];
      if(entry){
        if(entry.requestId!==requestId||entry.result!=='reserved')throw new FitGuardError('invalid_settlement');
        const parsed=safeUsage(usage),measured=parsed&&parsed.inputTokens<=entry.inputTokenBound&&parsed.outputTokens<=MAX_OUTPUT_TOKENS?parsed:null;
        Object.assign(entry,{result:safeResult,durationMs,usage:measured,estimatedStandardCostUsd:measured?estimatedStandardCost(measured):null,proposalCount});
      }
      ledger.attempt.result=safeResult;
      if(!ledgerSchema.safeParse(ledger).success)throw new FitGuardError('invalid_settlement');
      await atomicJson(ledgerPath,ledger);return entry?structuredClone(entry):null;
    },
    async artifact(name,value){if(!/^[a-z][a-z0-9-]*\.json$/.test(name)||name==='cumulative-budget-ledger.json')throw new FitGuardError('invalid_artifact_name');await atomicJson(join(outputDirectory,name),value);},
    async preservePrior(){const hashes=await immutableHashes(root);if(JSON.stringify(hashes)!==JSON.stringify(anchor.immutableFileHashes))throw new FitGuardError('prior_artifacts_changed');
      const proof={allTenPriorArtifactsBytePreserved:true,allThreePriorGuardFilesBytePreserved:true,bothPriorLedgersBytePreserved:true,immutableFileHashes:hashes};await atomicJson(join(outputDirectory,'prior-artifact-preservation.json'),proof);return proof;},
    async close(){await lock.close();await unlink(lockPath);},
  };
}
