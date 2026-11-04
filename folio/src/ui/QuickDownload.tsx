import { useId } from 'react';
import { ArrowDownToLine, CircleAlert, LoaderCircle } from 'lucide-react';
import './quick-download.css';

export interface QuickDownloadProps {
  /** The current draft's claims are already confirmed for this revision. */
  claimsConfirmed: boolean;
  /** The applicant ticked the truth confirmation in this session. */
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  onDownload: () => void;
  /** A guided download is running (layout check, PDF pages, save). */
  pending: boolean;
  /** Something only the applicant can fix (overflowing text, unsaved changes, source review). */
  blocking: string | null;
  busy?: boolean;
  /** Label of the step the guided download is currently waiting on. */
  progress?: string;
}

/**
 * One confirmation and one button. The app runs the layout check, shows every
 * PDF page and saves the draft automatically before handing over the file.
 */
export function QuickDownload({ claimsConfirmed, checked, onCheckedChange, onDownload, pending, blocking, busy = false, progress }: QuickDownloadProps) {
  const headingId = useId();
  const confirmed = claimsConfirmed || checked;
  return <section className="quick-download final-review" aria-labelledby={headingId}>
    <h3 id={headingId}>Ready to download</h3>
    <label className="checkbox-label">
      <input type="checkbox" checked={confirmed} disabled={claimsConfirmed || pending} onChange={event => onCheckedChange(event.target.checked)} />
      <span>Everything in this resume is true.</span>
    </label>
    {blocking && <p className="quick-download-blocking" role="alert"><CircleAlert size={15} aria-hidden="true" />{blocking}</p>}
    <button className="button button-primary button-wide" disabled={!confirmed || pending || busy || !!blocking} onClick={onDownload}>
      {pending ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <ArrowDownToLine size={16} aria-hidden="true" />}
      {pending ? progress || 'Preparing your PDF…' : 'Download PDF'}
    </button>
    <p className="quick-download-note">We check the layout and show you every page before the file downloads.</p>
  </section>;
}
