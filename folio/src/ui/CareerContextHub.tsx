import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileText, Files, Globe, Link2, Mic, Pencil } from 'lucide-react';
import { ContextCapture, type ContextCaptureProps, type ContextEntryMethod } from './OnboardingContext';

type Method = ContextEntryMethod | 'portfolio';
const choices = [
  { method: 'linkedin', title: 'LinkedIn', description: 'PDF export or pasted text. Profile links can’t be read.', icon: Link2 },
  { method: 'portfolio', title: 'Portfolio site', description: 'Paste page text. Website reading is not available yet.', icon: Globe },
  { method: 'files', title: 'Files', description: 'Reviews and project docs. PDF, DOCX or TXT.', icon: Files },
  { method: 'voice', title: 'Talk it through', description: 'Speak or type a career detail, then review it.', icon: Mic },
] as const;

/** Source entry uses existing commands; choosing a card never imports or confirms facts. */
export function CareerContextHub({ resumeName, factCount, ...capture }: ContextCaptureProps & { resumeName: string; factCount: number }) {
  const [method, setMethod] = useState<Method | null>(null);
  const methodHeading = useRef<HTMLHeadingElement>(null);
  const surface = useRef<HTMLElement>(null);
  const trigger = useRef<Method | null>(null);
  useEffect(() => {
    if (method) methodHeading.current?.focus();
    else if (trigger.current) surface.current?.querySelector<HTMLButtonElement>(`[data-context-method="${trigger.current}"]`)?.focus();
  }, [method]);
  function choose(value: Method) {
    trigger.current = value;
    setMethod(value);
  }
  return <section className="memory-context-screen" ref={surface}>
    {method ? <>
      <button className="memory-text-button memory-context-back" onClick={() => setMethod(null)}><ArrowLeft size={14} aria-hidden="true" />All context options</button>
      <h3 ref={methodHeading} tabIndex={-1}>{choices.find(choice => choice.method === method)?.title ?? 'Write a career detail'}</h3>
      {method === 'portfolio' && <p className="memory-context-limit">Website reading and page selection are not available yet. Paste selected page text below to save a source you can review. Folio will not visit the website.</p>}
      {method === 'voice' && <p className="memory-help">Dictation depends on browser support and microphone permission. You can type instead; automated follow-up questions are not available yet.</p>}
      <ContextCapture key={method} {...capture} method={method === 'portfolio' ? 'typed' : method} />
    </> : <>
      <div className="memory-context-hub">{choices.map(choice => { const Icon = choice.icon; return <button className="memory-context-choice" data-context-method={choice.method} key={choice.method} onClick={() => choose(choice.method)}><Icon size={20} aria-hidden="true" /><span><strong>{choice.title}</strong><small>{choice.description}</small></span></button>; })}</div>
      <button className="memory-text-button memory-context-write" data-context-method="typed" onClick={() => choose('typed')}><Pencil size={16} aria-hidden="true" />Or write a career detail</button>
      <section className="memory-context-existing"><h3>Added before</h3><div className="memory-design-card"><div className="memory-context-source"><FileText size={20} aria-hidden="true" /><span><strong>{resumeName}</strong><small>Original resume · {factCount} source facts</small></span></div>{capture.memory.sources.map(source => <button className="memory-context-source" key={source.id} onClick={() => capture.onReviewSource(source.id)}><FileText size={20} aria-hidden="true" /><span><strong>{source.name}</strong><small>{source.state === 'ready' ? 'Source ready' : source.state === 'needsReview' ? 'Needs review' : source.state === 'reading' ? 'Reading' : 'Could not read'} · {source.segments.length} source passages</small></span></button>)}</div></section>
    </>}
  </section>;
}
