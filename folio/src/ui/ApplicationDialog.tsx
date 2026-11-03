import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ChevronDown, FilePlus2, LoaderCircle, X } from 'lucide-react';
import type { JobContext } from '../core/model';
import './application-dialog.css';

interface ApplicationDialogProps {
  resumeName: string;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onPrepare: (job: JobContext) => void;
}

export function ApplicationDialog({ resumeName, busy, error, onClose, onPrepare }: ApplicationDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const descriptionField = useRef<HTMLTextAreaElement>(null);
  const submissionPending = useRef(false);
  const id = useId();
  const [job, setJob] = useState<JobContext>({ title: '', company: '', description: '' });
  const hasDescription = job.description.trim().length > 0;

  useEffect(() => {
    const opener = document.activeElement;
    const target = dialog.current;
    target?.showModal();
    descriptionField.current?.focus();
    return () => {
      target?.close();
      if (opener instanceof HTMLElement && opener.isConnected && !opener.closest('[inert]')) opener.focus();
      else document.querySelector<HTMLButtonElement>('button[aria-controls="project-library"]')?.focus();
    };
  }, []);

  useEffect(() => {
    if (!busy) submissionPending.current = false;
  }, [busy, error]);

  function prepare(withDescription: boolean) {
    if (busy || submissionPending.current || withDescription && !hasDescription) return;
    submissionPending.current = true;
    try {
      onPrepare({
        title: job.title.trim(),
        company: job.company.trim(),
        description: withDescription ? job.description.trim() : '',
      });
    } catch (reason) {
      submissionPending.current = false;
      throw reason;
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    prepare(true);
  }

  return (
    <dialog
      ref={dialog}
      className="application-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-intro`}
      aria-busy={busy}
      onCancel={event => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={event => {
        if (busy || event.target !== dialog.current) return;
        const bounds = dialog.current.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
    >
      <div className="application-dialog-content">
        <header className="application-dialog-header">
          <div className="application-dialog-heading">
            <span className="application-dialog-mark" aria-hidden="true"><FilePlus2 size={22} strokeWidth={1.7} /></span>
            <div>
              <span className="application-dialog-eyebrow">Your next opportunity</span>
              <h2 id={`${id}-title`}>Start an application</h2>
            </div>
          </div>
          <button type="button" className="application-dialog-close" aria-label="Close new application" onClick={onClose} disabled={busy}>
            <X size={20} />
          </button>
        </header>

        <p className="application-dialog-intro" id={`${id}-intro`}>Start from <strong>{resumeName}</strong> and shape a fresh draft for this role.</p>

        <form onSubmit={submit}>
          <fieldset className="application-dialog-fields" disabled={busy}>
            <label className="application-dialog-label" htmlFor={`${id}-description`}>Job description</label>
            <p className="application-dialog-help" id={`${id}-description-help`}>Paste the role as posted. The description is context, never evidence of your qualifications.</p>
            <textarea
              ref={descriptionField}
              id={`${id}-description`}
              aria-describedby={`${id}-description-help ${id}-description-guidance`}
              value={job.description}
              onChange={event => setJob(current => ({ ...current, description: event.target.value }))}
              placeholder="Paste the responsibilities, requirements, and details of the role…"
              rows={8}
              maxLength={50000}
              autoFocus
            />
            <p className="application-dialog-guidance" id={`${id}-description-guidance`}>
              {hasDescription ? 'Local matching ranks exact facts you supplied. Review each match before using it.' : 'Paste a description or start without one.'}
            </p>

            <details className="application-dialog-metadata">
              <summary aria-disabled={busy} tabIndex={busy ? -1 : undefined} onClick={event => { if (busy) event.preventDefault(); }}>
                <span>Add title and company <span className="application-dialog-optional">(optional)</span></span>
                <ChevronDown size={17} aria-hidden="true" />
              </summary>
              <div className="application-dialog-field-row">
                <label htmlFor={`${id}-role`}>Role title
                  <input id={`${id}-role`} value={job.title} onChange={event => setJob(current => ({ ...current, title: event.target.value }))} placeholder="e.g. Product Designer" maxLength={300} autoComplete="off" />
                </label>
                <label htmlFor={`${id}-company`}>Company
                  <input id={`${id}-company`} value={job.company} onChange={event => setJob(current => ({ ...current, company: event.target.value }))} placeholder="e.g. Northstar" maxLength={300} autoComplete="off" />
                </label>
              </div>
              <p className="application-dialog-help">These help you find this application again. You can change them later.</p>
            </details>
          </fieldset>

          {error && <p className="application-dialog-error" role="alert">{error}</p>}

          <div className="application-dialog-actions">
            <button type="submit" className="application-dialog-prepare" disabled={busy || !hasDescription}>
              {busy ? <><LoaderCircle size={17} className="spin" aria-hidden="true" />Preparing…</> : <>Prepare application<ArrowRight size={17} aria-hidden="true" /></>}
            </button>
            <button type="button" className="application-dialog-manual" onClick={() => prepare(false)} disabled={busy} aria-describedby={`${id}-manual-help`}>Start without a description</button>
          </div>
          <p id={`${id}-manual-help`} className="application-dialog-manual-help">Start without matching and edit the approved wording directly. You can add a description later.</p>
          <p className="application-dialog-pending" role="status" aria-live="polite">{busy ? 'Saving your new application on this device…' : ''}</p>
        </form>
      </div>
    </dialog>
  );
}
