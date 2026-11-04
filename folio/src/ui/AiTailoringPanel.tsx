import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, FilePlus2, LoaderCircle, ShieldCheck, Sparkles, X } from 'lucide-react';
import { eligibleEvidence } from '../core/careerMemory';
import { blockText, workspaceOf } from '../core/model';
import type { Project } from '../core/model';
import {
  AI_MODEL, AiClientError, aiErrorMessage, aiFormattingIssue, aiProjectFingerprint, aiProposalFindings, aiRequiredFactIds,
  aiStatusMessage, assertAiRequestCurrent, canSendAiRequest, createAiClient, guardAiAcceptance, prepareAiRequest, probeAiCandidate,
} from '../tailoring/ai';
import type { AiProposal, AiRequest, AiResult, AiStatus } from '../tailoring/ai';
import './ai-tailoring.css';

export interface AiTailoringPanelProps {
  project: Project;
  selectedBlockId?: string | null;
  disabled?: boolean;
  onAccept: (request: AiRequest, result: AiResult, proposal: AiProposal) => void | Promise<void>;
  onStartApplication?: () => void;
}
interface CitedSource { name: string; locator: string; originalQuote?: string }
interface Review { request: AiRequest; result: AiResult; fingerprint: string; sources: Record<string, CitedSource> }
interface ProposalReview { accuracy: boolean; flags: boolean; fitError?: string; decision?: 'accepted' | 'rejected' }

export function AiTailoringPanel({ project, selectedBlockId, disabled = false, onAccept, onStartApplication }: AiTailoringPanelProps) {
  const id = useId();
  const client = useMemo(() => createAiClient(), []);
  const application = workspaceOf(project).kind === 'application';
  const fingerprint = aiProjectFingerprint(project);
  const latest = useRef({ project, fingerprint });
  latest.current = { project, fingerprint };
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const activeProject = useRef(project.id);
  const inFlight = useRef(false);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [busy, setBusy] = useState<'status' | 'verify' | 'tailor' | 'accept' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [factIds, setFactIds] = useState<string[]>([]);
  const [blockIds, setBlockIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ request: AiRequest; fingerprint: string } | null>(null);
  const [consentHash, setConsentHash] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [proposalReviews, setProposalReviews] = useState<Record<string, ProposalReview>>({});
  // Separators, spaces and other fragments without letters or digits are not useful choices.
  const meaningful = (text: string) => /[\p{L}\p{N}]/u.test(text);
  const facts = eligibleEvidence(project).filter(fact => meaningful(fact.text));
  const [statusChecked, setStatusChecked] = useState(false);
  const selectedFacts = new Set(factIds);
  const selectedBlocks = new Set(blockIds);
  const currentPreview = preview?.fingerprint === fingerprint ? preview : null;
  const staleReview = !!review && review.fingerprint !== fingerprint;
  const locked = disabled || busy !== null;

  useEffect(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    inFlight.current = false;
    setBusy(null);
    setPreview(null);
    setConsentHash('');
    setError('');
    if (activeProject.current !== project.id) {
      activeProject.current = project.id;
      setFactIds([]);
      setBlockIds([]);
      setReview(null);
      setProposalReviews({});
      setNotice('');
    }
    return () => { generation.current += 1; controller.current?.abort(); };
  }, [fingerprint, project.id]);

  useEffect(() => {
    const stop = () => { generation.current += 1; controller.current?.abort(); inFlight.current = false; };
    const leavePage = () => {
      const pending = !!controller.current;
      stop(); setBusy(null); setPreview(null); setConsentHash('');
      if (pending) setNotice('Local AI operation stopped when leaving this page. OpenAI may already have processed it. No automatic retry was made.');
    };
    window.addEventListener('pagehide', leavePage);
    return () => { window.removeEventListener('pagehide', leavePage); stop(); };
  }, []);

  useEffect(() => {
    if (!disabled) return;
    generation.current += 1; controller.current?.abort(); controller.current = null; inFlight.current = false;
    setBusy(null); setPreview(null); setConsentHash('');
  }, [disabled]);

  useEffect(() => {
    if (!application) return;
    const abort = new AbortController();
    client.status(abort.signal).then(value => { if (!abort.signal.aborted) { setStatus(value); setStatusChecked(true); } })
      .catch(reason => { if (!abort.signal.aborted) { setStatus(null); setStatusChecked(true); setError(aiErrorMessage(reason)); } });
    return () => abort.abort();
  }, [application, client, project.id]);

  useEffect(() => {
    if (selectedBlockId && project.draft.blocks.some(block => block.id === selectedBlockId)) {
      setBlockIds(current => current.length ? current : [selectedBlockId]);
    }
  }, [project.id, selectedBlockId, project.draft.blocks]);

  function changeSelection(kind: 'fact' | 'block', itemId: string, checked: boolean) {
    setPreview(null); setConsentHash(''); setError('');
    const update = (current: string[]) => checked ? [...current, itemId] : current.filter(value => value !== itemId);
    if (kind === 'fact') setFactIds(update); else setBlockIds(update);
  }

  async function checkStatus(verify: boolean) {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    const abort = new AbortController(), operation = ++generation.current;
    controller.current?.abort(); controller.current = abort;
    setBusy(verify ? 'verify' : 'status'); setError(''); setNotice('');
    try {
      const value = await (verify ? client.verify(abort.signal) : client.status(abort.signal));
      if (operation === generation.current && !abort.signal.aborted) {
        setStatus(value);
        setNotice(verify ? 'Read-only account model verification completed. No content generation was requested.' : 'Local server status checked. No OpenAI call was made.');
      }
    } catch (reason) {
      if (operation === generation.current && !abort.signal.aborted) {
        if (!verify) setStatus(null);
        setError(aiErrorMessage(reason));
        if (verify && status) setStatus({ ...status, accountModelVerified: false, verification: 'failed' });
        else setStatus(null);
      }
    } finally {
      if (operation === generation.current) { inFlight.current = false; controller.current = null; setBusy(null); }
    }
  }

  function prepare() {
    if (locked) return;
    try {
      const request = prepareAiRequest(project, factIds, blockIds);
      setPreview({ request, fingerprint }); setConsentHash(''); setError(''); setNotice('');
    } catch (reason) { setError(aiErrorMessage(reason)); }
  }

  async function send() {
    if (disabled || inFlight.current || !currentPreview || !status || review && !review.result.proposals.every(proposal => proposalReviews[proposal.blockId]?.decision)) return;
    const pending = currentPreview;
    try {
      if (pending.fingerprint !== latest.current.fingerprint) throw new AiClientError('stale_context');
      assertAiRequestCurrent(latest.current.project, pending.request);
      if (consentHash !== pending.request.consent.contextHash) throw new AiClientError('consent_mismatch');
    } catch (reason) { setError(aiErrorMessage(reason)); return; }
    inFlight.current = true;
    const abort = new AbortController(), operation = ++generation.current;
    controller.current?.abort(); controller.current = abort;
    setBusy('tailor'); setError(''); setNotice(''); setConsentHash('');
    // This request ID is consumed; a later attempt requires a fresh reviewed payload.
    setPreview(null);
    try {
      const result = await client.tailor(pending.request, { status, consentHash: pending.request.consent.contextHash, signal: abort.signal });
      if (abort.signal.aborted || operation !== generation.current || pending.fingerprint !== latest.current.fingerprint) return;
      assertAiRequestCurrent(latest.current.project, pending.request);
      const sources = Object.fromEntries(pending.request.facts.map(fact => {
        const pinned = latest.current.project.memorySnapshot?.evidence.find(item => item.factId === fact.id)?.provenance;
        const currentFact = latest.current.project.facts.find(item => item.id === fact.id);
        return [fact.id, pinned ? { name: pinned.sourceName, locator: pinned.locator, originalQuote: pinned.originalQuote } : { name: fact.kind === 'resume' ? 'Imported resume' : 'Applicant-confirmed detail', locator: currentFact?.locator ?? '' }];
      }));
      setReview({ request: pending.request, result, fingerprint: pending.fingerprint, sources }); setProposalReviews({});
      setNotice(result.proposals.length ? 'Proposals are ready for your review. No wording has been applied.' : 'OpenAI returned no supported wording changes. Your draft is unchanged.');
    } catch (reason) {
      if (!abort.signal.aborted && operation === generation.current) setError(aiErrorMessage(reason));
    } finally {
      if (operation === generation.current) { inFlight.current = false; controller.current = null; setBusy(null); }
    }
  }

  async function accept(proposal: AiProposal) {
    if (!review || disabled || inFlight.current || staleReview || proposalReviews[proposal.blockId]?.decision) return;
    const checks = proposalReviews[proposal.blockId];
    if (!checks?.accuracy || aiProposalFindings(proposal, review.request).length && !checks.flags) return;
    let operation: number | undefined;
    try {
      if (review.fingerprint !== latest.current.fingerprint) throw new AiClientError('stale_context');
      operation = ++generation.current;
      inFlight.current = true; setBusy('accept'); setError('');
      const current = latest.current;
      try { await probeAiCandidate(current.project, review.request, review.result, proposal); }
      catch (reason) {
        if (operation === generation.current) setProposalReviews(existing => ({ ...existing, [proposal.blockId]: { ...(existing[proposal.blockId] ?? { accuracy: false, flags: false }), fitError: aiErrorMessage(reason) } }));
        throw reason;
      }
      if (operation !== generation.current || current.fingerprint !== aiProjectFingerprint(latest.current.project)) throw new AiClientError('stale_context');
      guardAiAcceptance(latest.current.project, review.request, review.result, proposal);
      await onAccept(review.request, review.result, proposal);
      if (latest.current.project.id !== review.request.context.projectId) return;
      setProposalReviews(current => ({ ...current, [proposal.blockId]: { ...current[proposal.blockId], accuracy: true, flags: !!checks.flags, decision: 'accepted' } }));
      if (operation === generation.current) setNotice('Accepted wording was handed to the draft editor. Review the resulting PDF, fit, and save state before export.');
    } catch (reason) { if (latest.current.project.id === review.request.context.projectId) setError(aiErrorMessage(reason)); }
    finally { if (operation === generation.current) { inFlight.current = false; setBusy(null); } }
  }

  function reject(proposal: AiProposal) {
    setProposalReviews(current => ({ ...current, [proposal.blockId]: { accuracy: false, flags: false, decision: 'rejected' } }));
    setNotice('Proposal rejected. Your draft is unchanged.');
  }
  function setCheck(blockId: string, key: 'accuracy' | 'flags', checked: boolean) {
    setProposalReviews(current => ({ ...current, [blockId]: { ...(current[blockId] ?? { accuracy: false, flags: false }), [key]: checked } }));
  }

  if (!application) return <section className="ai-tailoring panel-section" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}><Sparkles size={16} aria-hidden="true" />AI wording proposals</h3>
    <p>Start an application to review AI wording against its saved evidence and job description.</p>
    {onStartApplication && <button type="button" className="button button-secondary" onClick={onStartApplication} disabled={disabled}><FilePlus2 size={15} aria-hidden="true" />Start an application</button>}
  </section>;

  const unresolved = review?.result.proposals.some(proposal => !proposalReviews[proposal.blockId]?.decision) ?? false;
  // Without a configured AI service, show one quiet line instead of the full request builder.
  const serviceUsable = !!status && status.keyConfigured && status.modelConfigured && status.supportedModel;
  if (!serviceUsable && !review && busy !== 'tailor' && busy !== 'accept') return <section className="ai-tailoring ai-tailoring-offline panel-section" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}><Sparkles size={16} aria-hidden="true" />AI suggestions</h3>
    <p role="status">{!statusChecked || busy === 'status' ? 'Checking AI availability…' : status ? aiStatusMessage(status) : 'AI tailoring is offline right now. You can still edit and download your resume.'}</p>
    <button type="button" className="text-button" onClick={() => void checkStatus(false)} disabled={locked}>Check again</button>
  </section>;
  return <section className="ai-tailoring panel-section" aria-labelledby={`${id}-title`} aria-busy={busy !== null}>
    <h3 id={`${id}-title`}><Sparkles size={16} aria-hidden="true" />AI wording proposals</h3>
    <p>Choose the facts and paragraphs to send. Suggestions use <a href="https://developers.openai.com/api/docs/models/gpt-6.1-sol" target="_blank" rel="noreferrer">{AI_MODEL}</a> with medium reasoning and always need your review.</p>
    <div className="ai-server-status">
      <p role="status">{status ? aiStatusMessage(status) : 'Local AI server status is not available yet.'}</p>
      <div className="ai-actions">
        <button type="button" className="button button-secondary" onClick={() => void checkStatus(false)} disabled={locked}>Check server status</button>
        <button type="button" className="button button-secondary" onClick={() => void checkStatus(true)} disabled={locked || !status?.keyConfigured || !status.modelConfigured || !status.supportedModel || status.busy}><ShieldCheck size={14} aria-hidden="true" />Verify model access</button>
      </div>
      <p className="ai-help">Verification makes a read-only OpenAI account request, without your resume or job text. It is separate from paid generation.</p>
    </div>

    <fieldset className="ai-selection" disabled={locked}>
      <legend>Facts to supply ({factIds.length}/100)</legend>
      <p className="ai-help">Imported resume facts and applicant-confirmed eligible details. Select only what these paragraphs need.</p>
      <div className="ai-choice-list">{facts.map(fact => <label key={fact.id} className="ai-choice">
        <input type="checkbox" checked={selectedFacts.has(fact.id)} disabled={!selectedFacts.has(fact.id) && factIds.length >= 100} onChange={event => changeSelection('fact', fact.id, event.target.checked)} />
        <span><span className="ai-exact-text">{fact.text}</span><small>{fact.kind === 'resume' ? 'Imported resume' : 'Applicant-confirmed detail'} · {fact.locator}</small></span>
      </label>)}</div>
      {!facts.length && <p>No eligible facts are available for this application.</p>}
    </fieldset>
    <fieldset className="ai-selection" disabled={locked}>
      <legend>Current paragraphs ({blockIds.length}/100)</legend>
      <div className="ai-choice-list">{project.draft.blocks.filter(block => meaningful(blockText(block))).map(block => <label key={block.id} className="ai-choice">
        <input type="checkbox" checked={selectedBlocks.has(block.id)} disabled={!selectedBlocks.has(block.id) && blockIds.length >= 100} onChange={event => changeSelection('block', block.id, event.target.checked)} />
        <span><span className="ai-exact-text">{blockText(block) || '(Empty paragraph)'}</span><small className="ai-required-facts">Required current sources: {(() => { try { return aiRequiredFactIds(project, block.id).map(factId => facts.find(fact => fact.id === factId)?.text ?? `Unavailable source ${factId}`).join(' · ') || 'No reviewed source facts'; } catch { return 'Review this paragraph’s source references on the canvas.'; } })()}</small></span>
      </label>)}</div>
    </fieldset>
    {!project.job.description.trim() && <p className="ai-warning">Add a job description before preparing an AI request. It supplies role context, never qualification evidence.</p>}
    <button type="button" className="button button-secondary" disabled={locked || !factIds.length || !blockIds.length || !project.job.description.trim()} onClick={prepare}>Review selected request</button>

    {currentPreview && <div className="ai-request-review" aria-labelledby={`${id}-request`}>
      <h4 id={`${id}-request`}>Exact request to OpenAI</h4>
      <p>{currentPreview.request.facts.length} facts and their source quotations · {currentPreview.request.blocks.length} paragraphs · current job description</p>
      <p className="ai-help">The request permits paragraph text replacement only. Selected fact versions, source identities, and text hashes bind the reviewed evidence; source files are not transferred.</p>
      <details open><summary>Selected facts and source quotations</summary>{currentPreview.request.facts.map(fact => <div className="ai-quoted" key={fact.id}>
        <small>Fact {fact.id} · version {fact.version}{fact.assertionId ? ` · assertion ${fact.assertionId}` : ''}</small><p className="ai-exact-text">{fact.text}</p>
        <small>Source {fact.source.kind} · version {fact.source.version} · {fact.source.locator}</small><p className="ai-exact-text">{fact.source.quote}</p>
        <small>{fact.confirmation ? `Applicant confirmation: ${fact.confirmation.confirmedAt ?? 'timestamp unavailable in this record'}` : 'Imported resume source; no separate applicant confirmation timestamp.'}</small>
        <details><summary>Selected evidence hashes</summary><small>Text: {fact.textHash}<br />Source {fact.source.id}: {fact.source.hash}<br />Quotation: {fact.source.quoteHash}</small></details>
      </div>)}</details>
      <details open><summary>Selected paragraph text and constraints</summary>{currentPreview.request.blocks.map(block => <div className="ai-quoted" key={block.id}><small>Paragraph {block.id}</small><p className="ai-exact-text">{block.text}</p><p className="ai-budget">Keep the same {block.layoutBudget.widthPt.toFixed(2)} × {block.layoutBudget.heightPt.toFixed(2)} pt box and {block.layoutBudget.fontSizePt} pt {block.layoutBudget.fontFamily} font ({block.layoutBudget.fontWeight === 700 ? 'bold' : 'regular'}{block.layoutBudget.italic ? ', italic' : ''}). At most {block.layoutBudget.maxCharacters} characters and {block.layoutBudget.maxLines} {block.layoutBudget.maxLines === 1 ? 'line' : 'lines'}; line height {block.layoutBudget.lineHeightPt} pt.</p><small>Preserve the supported meaning of these required current facts:</small>{block.requiredFactIds.map(factId => <p className="ai-exact-text" key={factId}>{currentPreview.request.facts.find(fact => fact.id === factId)!.text}</p>)}</div>)}</details>
      <p className="ai-help">Character and line limits guide the request; equal-length words can still be wider. Before acceptance, the exact proposed document is checked with the bundled fonts. Extra selected facts are optional context; existing paragraph sources remain required.</p>
      <details open><summary>Job context</summary><p className="ai-exact-text">Role: {currentPreview.request.job.title || '(Not supplied)'}{'\n'}Company: {currentPreview.request.job.company || '(Not supplied)'}{'\n'}{currentPreview.request.job.description}</p></details>
      <p className="ai-transfer">Sending transfers the selected fact text, source quotations and locators, paragraph text, and job context outside your device to OpenAI and can incur API charges. Folio requests <code>store: false</code>; OpenAI may retain abuse-monitoring data for up to 30 days. This is not zero retention.</p>
      <label className="ai-choice ai-confirm"><input type="checkbox" checked={consentHash === currentPreview.request.consent.contextHash} disabled={locked} onChange={event => setConsentHash(event.target.checked ? currentPreview.request.consent.contextHash : '')} /><span>I reviewed this exact request and consent to its paid transfer to OpenAI.</span></label>
      {unresolved && <p className="ai-warning">Review or reject the returned proposals before sending another request.</p>}
      <button type="button" className="button button-primary" onClick={() => void send()} disabled={locked || !canSendAiRequest(status) || consentHash !== currentPreview.request.consent.contextHash || unresolved}>Send paid request to OpenAI</button>
    </div>}

    {busy && <div className="ai-pending" role="status"><LoaderCircle size={15} className="spin" aria-hidden="true" />{busy === 'tailor' ? 'Waiting for OpenAI proposals…' : busy === 'verify' ? 'Verifying account model access…' : busy === 'accept' ? 'Checking the exact proposal fit…' : 'Checking local server status…'}
      {busy !== 'accept' && <button type="button" className="text-button" onClick={() => { controller.current?.abort(); generation.current += 1; inFlight.current = false; setBusy(null); setNotice(busy === 'tailor' ? 'Request stopped locally. OpenAI may already have processed it. No automatic retry was made.' : 'Local operation stopped.'); }}>Stop</button>}
    </div>}
    {error && <p className="ai-error" role="alert">{error}</p>}
    {notice && <p className="ai-notice" role="status">{notice}</p>}

    {review && <div className="ai-proposals" aria-labelledby={`${id}-proposals`}>
      <h4 id={`${id}-proposals`}>Returned proposals ({review.result.proposals.length})</h4>
      <p className="ai-warning">This proposal review is session-only and is not saved. Reloading or leaving this panel loses pending proposals; accepted draft edits use the workspace save flow.</p>
      {staleReview && <p className="ai-warning" role="status">The application changed. These proposals remain readable, but acceptance is disabled. Prepare a new request for the current application.</p>}
      <p className="ai-help">Reference and lexical checks do not prove truth or detect every unsupported claim. Acceptance preserves the text box’s font and position and a uniform paragraph style and existing link. Mixed inline styles or links need manual application on the canvas. Review the PDF and fit before export.</p>
      <p className="ai-help">{review.result.usage ? `Reported usage: ${review.result.usage.inputTokens} input tokens · ${review.result.usage.outputTokens} output tokens · ${review.result.usage.totalTokens} total tokens.` : 'Token usage was not available in the response.'}</p>
      {!review.result.proposals.length && <p>No wording changes were proposed.</p>}
      {review.result.proposals.map((proposal, index) => {
        const findings = aiProposalFindings(proposal, review.request), checks = proposalReviews[proposal.blockId];
        const formattingIssue = aiFormattingIssue(project, proposal.blockId);
        return <article className="ai-proposal" key={proposal.blockId} aria-labelledby={`${id}-proposal-${index}`}>
          <h4 id={`${id}-proposal-${index}`}>Paragraph {index + 1}{checks?.decision ? ` · ${checks.decision}` : ''}</h4>
          <div className="ai-before-after"><div><h5>Before</h5><p className="ai-exact-text">{proposal.beforeText || '(Empty paragraph)'}</p></div><div><h5>Proposed wording</h5><p className="ai-exact-text">{proposal.afterText}</p></div></div>
          <p className="ai-reason"><strong>Model’s reason: </strong>{proposal.reason}</p>
          {formattingIssue && <p className="ai-warning">{formattingIssue} Acceptance is disabled for this paragraph.</p>}
          {checks?.fitError && <p className="ai-warning" role="status">{checks.fitError} Acceptance is disabled for this proposal; its wording remains available for review.</p>}
          <details open><summary>Exact cited facts ({proposal.factIds.length})</summary>{proposal.factIds.map(factId => <div className="ai-quoted" key={factId}><small>{review.sources[factId]?.name} · {review.sources[factId]?.locator}<br />Fact {factId}</small><p className="ai-exact-text">{review.request.facts.find(fact => fact.id === factId)!.text}</p>{review.sources[factId]?.originalQuote && review.sources[factId].originalQuote !== review.request.facts.find(fact => fact.id === factId)!.text && <><small>Retained source quotation</small><p className="ai-exact-text">{review.sources[factId].originalQuote}</p></>}</div>)}</details>
          {findings.length ? <div className="ai-findings"><h5>Source review required</h5>{findings.map(finding => <p key={finding.code}>{finding.message} <strong>{finding.terms.join(', ')}</strong></p>)}</div> : <p className="ai-help">No lexical warning was detected. You still need to check every claim against its cited facts.</p>}
          {!checks?.decision && <>
            <label className="ai-choice ai-confirm"><input type="checkbox" checked={!!checks?.accuracy} disabled={locked || staleReview} onChange={event => setCheck(proposal.blockId, 'accuracy', event.target.checked)} /><span>I checked the cited facts and confirm this wording accurately describes my experience.</span></label>
            {findings.length > 0 && <label className="ai-choice ai-confirm"><input type="checkbox" checked={!!checks?.flags} disabled={locked || staleReview} onChange={event => setCheck(proposal.blockId, 'flags', event.target.checked)} /><span>I reviewed each flagged word against the cited sources and confirmed its scope and support.</span></label>}
            <div className="ai-actions"><button type="button" className="button button-primary" onClick={() => void accept(proposal)} disabled={locked || staleReview || !!formattingIssue || !!checks?.fitError || !checks?.accuracy || findings.length > 0 && !checks.flags}><Check size={14} aria-hidden="true" />Accept wording</button><button type="button" className="button button-secondary" onClick={() => reject(proposal)} disabled={locked}><X size={14} aria-hidden="true" />Reject proposal</button></div>
          </>}
        </article>;
      })}
    </div>}
  </section>;
}
