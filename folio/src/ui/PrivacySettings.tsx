import { useEffect, useId, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowUpRight, ChevronRight, FileText, HardDriveDownload,
  Link, Mic, NotebookPen, Shield, Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import './privacy-settings-design.css';
import './folio-secondary.css';
import './memory-upgrade.css';

export interface PrivacySource {
  id: string;
  kind: 'resume' | 'linkedin' | 'file' | 'note' | 'transcript' | 'portfolio';
  name: string;
  /** A current source summary supplied by the workspace, including any known counts or dates. */
  detail: string;
  action: 'remove' | 'manage';
  disabledReason?: string;
}

export interface PrivacyScopeAction {
  title: string;
  description: string;
  disabledReason?: string;
}

export interface PrivacySettingsProps {
  onClose: () => void;
  sources: readonly PrivacySource[];
  /** Opens the workspace's existing source impact preview or Career Memory editor. */
  onSourceAction?: (source: PrivacySource) => void | Promise<void>;
  backup: PrivacyScopeAction;
  onBackup?: () => void | Promise<void>;
  /** Opens the existing validated archive picker; parent owns draft/save guards and restoration. */
  onRestoreBackup?: () => void | Promise<void>;
  restoreDisabledReason?: string;
  /** Describes the actual selected resume group or record, never a global deletion. */
  deletion: PrivacyScopeAction;
  onDeleteScope?: () => void | Promise<void>;
  modelConsent: {
    granted: boolean;
    available: boolean;
    detail: string;
    scopeLabel?: string;
  };
  onReviewConsent?: () => void;
  onRevokeConsent?: () => void;
  storage: {
    status: 'saved' | 'saving' | 'error' | 'loading' | 'unavailable';
    detail: string;
  };
  /** A stable opener can be supplied when a menu item is removed on navigation. */
  returnFocusTo?: HTMLElement | null;
}

const SOURCE_ICONS: Record<PrivacySource['kind'], LucideIcon> = {
  resume: FileText, linkedin: FileText, file: FileText,
  note: NotebookPen, transcript: Mic, portfolio: Link,
};

const STORAGE_LABELS: Record<PrivacySettingsProps['storage']['status'], string> = {
  saved: 'Saved in this browser', saving: 'Saving…', error: 'Storage needs attention',
  loading: 'Checking local storage…', unavailable: 'Local storage unavailable',
};

/** A screen shell. Mutations and their scope previews remain owned by the workspace. */
export function PrivacySettings({
  onClose, sources, onSourceAction, backup, onBackup, onRestoreBackup, restoreDisabledReason, deletion, onDeleteScope,
  modelConsent, onReviewConsent, onRevokeConsent, storage, returnFocusTo,
}: PrivacySettingsProps) {
  const prefix = useId();
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  const pending = useRef<string | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const closeRef = useRef(onClose);
  const restoreRef = useRef(returnFocusTo);
  closeRef.current = onClose;
  restoreRef.current = returnFocusTo;

  useEffect(() => {
    mounted.current = true;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading.current?.focus({ preventScroll: true });
    return () => {
      mounted.current = false;
      const target = restoreRef.current ?? opener;
      const focused = document.activeElement;
      // Do not take focus from a separate source/deletion dialog opened by the workspace.
      if (target?.isConnected && (focused === document.body || root.current?.contains(focused))) {
        target.focus({ preventScroll: true });
      }
    };
  }, []);

  async function runAction(key: string, action: (() => void | Promise<void>) | undefined) {
    if (!action || pending.current) return;
    pending.current = key;
    setActiveAction(key);
    setActionError('');
    try {
      await action();
    } catch (reason) {
      if (mounted.current) setActionError(reason instanceof Error ? reason.message : 'This action could not finish. Try again.');
    } finally {
      pending.current = null;
      if (mounted.current) setActiveAction(null);
    }
  }

  const backupUnavailable = backup.disabledReason || (!onBackup ? 'Choose a saved resume to download its backup.' : '');
  const deletionUnavailable = deletion.disabledReason || (!onDeleteScope ? 'Choose a saved resume to review its deletion scope.' : '');

  return <section
    ref={root}
    className="folio-privacy-screen"
    aria-labelledby={`${prefix}-title`}
    onKeyDown={event => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
    }}
  >
    <div className="folio-privacy-content">
      <h1 id={`${prefix}-title`} ref={heading} tabIndex={-1}>Settings</h1>

      <section className="folio-privacy-section" aria-labelledby={`${prefix}-sharing-title`}>
        <h2 id={`${prefix}-sharing-title`}>What’s sent when you tailor</h2>
        <div className="folio-privacy-row folio-privacy-row-first">
          <ArrowUpRight size={16} className="folio-privacy-row-icon" aria-hidden="true" />
          <div className="folio-privacy-text">
            <h3>Sent to the model</h3>
            <p>The job description, selected resume paragraphs and eligible confirmed evidence, including application-only facts, are included in the current request you allow. Selected text may contain contact details.</p>
            <div className="folio-privacy-consent" data-available={modelConsent.available}>
              <span className="folio-privacy-state">{modelConsent.granted ? 'Consent given for this request' : 'Consent not given'}</span>
              {modelConsent.scopeLabel && <span>{modelConsent.scopeLabel}</span>}
            </div>
            <p className="folio-privacy-caption">{modelConsent.detail}</p>
            {(onReviewConsent || (modelConsent.granted && onRevokeConsent)) && <div className="folio-privacy-inline-actions">
              {onReviewConsent && <button type="button" className="folio-privacy-link" onClick={onReviewConsent}>Review in composer<ArrowUpRight size={13} aria-hidden="true" /></button>}
              {modelConsent.granted && onRevokeConsent && <button type="button" className="folio-privacy-link" onClick={onRevokeConsent}>Withdraw this consent</button>}
            </div>}
          </div>
        </div>
        <div className="folio-privacy-row">
          <Shield size={16} className="folio-privacy-row-icon" aria-hidden="true" />
          <div className="folio-privacy-text">
            <h3>Not sent</h3>
            <p>Original files, audio, excluded or unused Career Memory details, unsaved context, reference-only links and workspace preferences.</p>
          </div>
        </div>
      </section>

      <section className="folio-privacy-section" aria-labelledby={`${prefix}-sources-title`}>
        <h2 id={`${prefix}-sources-title`}>Your sources</h2>
        {sources.length ? <ul className="folio-privacy-sources">
          {sources.map((source, index) => {
            const Icon = SOURCE_ICONS[source.kind];
            const reason = source.disabledReason || (!onSourceAction ? 'Source management is unavailable in this view.' : '');
            const descriptionId = `${prefix}-source-${index}-detail`;
            return <li key={source.id} className={`folio-privacy-row folio-privacy-source ${index === 0 ? 'folio-privacy-row-first' : ''}`}>
              <Icon size={16} className="folio-privacy-row-icon" aria-hidden="true" />
              <div className="folio-privacy-text">
                <h3>{source.name}</h3>
                <p id={descriptionId} className="folio-privacy-caption">{source.detail}{reason && <><br />{reason}</>}</p>
              </div>
              <button
                type="button"
                className="folio-privacy-action folio-privacy-action-ghost"
                disabled={!!reason || activeAction !== null}
                aria-label={`${source.action === 'remove' ? 'Remove' : 'Manage'} ${source.name}`}
                aria-describedby={descriptionId}
                aria-busy={activeAction === `source:${source.id}`}
                onClick={() => void runAction(`source:${source.id}`, onSourceAction ? () => onSourceAction(source) : undefined)}
              >{activeAction === `source:${source.id}` ? 'Opening…' : source.action === 'remove' ? 'Remove' : 'Manage'}</button>
            </li>;
          })}
        </ul> : <p className="folio-privacy-empty">No source is selected. Upload a resume to manage its sources here.</p>}
      </section>

      <section className="folio-privacy-section" aria-labelledby={`${prefix}-backup-title`}>
        <h2 id={`${prefix}-backup-title`}>Backup and recovery</h2>
        <div className="folio-privacy-row folio-privacy-row-first folio-privacy-operation" data-disabled={!!backupUnavailable}>
          <HardDriveDownload size={16} className="folio-privacy-row-icon" aria-hidden="true" />
          <div className="folio-privacy-text">
            <h3>{backup.title}{activeAction === 'backup' && <span className="folio-privacy-mobile-progress" aria-hidden="true"> · Preparing…</span>}</h3>
            <p id={`${prefix}-backup-detail`} className="folio-privacy-caption">{backup.description}{backupUnavailable && <><br />{backupUnavailable}</>}</p>
          </div>
          <button type="button" className="folio-privacy-action folio-privacy-action-secondary"
            disabled={!!backupUnavailable || activeAction !== null}
            aria-label={`Download backup: ${backup.title}`}
            aria-describedby={`${prefix}-backup-detail`} aria-busy={activeAction === 'backup'}
            onClick={() => void runAction('backup', onBackup)}>
            {activeAction === 'backup' ? 'Preparing…' : 'Download'}<ChevronRight size={16} className="folio-privacy-mobile-chevron" aria-hidden="true" />
          </button>
        </div>
        <div className="folio-privacy-recovery"><p>A resume-group backup contains its reusable resume, Career Memory and saved applications. A project backup contains only the selected project and its included evidence. Restore imports the archive as a separate copy; it does not overwrite your current group.</p>{onRestoreBackup ? <button type="button" className="folio-privacy-action folio-privacy-action-secondary" disabled={!!restoreDisabledReason || activeAction !== null} aria-describedby={`${prefix}-restore-detail`} aria-busy={activeAction === 'restore'} onClick={() => void runAction('restore', onRestoreBackup)}>{activeAction === 'restore' ? 'Opening backup picker…' : 'Restore a backup'}</button> : null}<p id={`${prefix}-restore-detail`}>{restoreDisabledReason || 'Choose a Folio ZIP backup you previously downloaded. Folio validates the archive locally; inspect the restored template and evidence before exporting.'}</p></div>
        <div className="folio-privacy-storage" data-state={storage.status}>
          <span role="status">{STORAGE_LABELS[storage.status]}</span>
          <p>{storage.detail}</p>
          <details>
            <summary>About local storage</summary>
            <p>Local records belong to this browser profile and this Folio address; another browser or port has separate storage. Browser storage is not encrypted by Folio. Other people using the same browser profile may access it. Clearing site data, private browsing or browser eviction can remove local records; there is no cloud recovery.</p>
            <p>Downloaded backups contain readable personal data. Keep them somewhere private. Cloud accounts, OAuth and Word export are unavailable in this workspace.</p>
          </details>
        </div>
      </section>

      <section className="folio-privacy-section" aria-labelledby={`${prefix}-deletion-title`}>
        <h2 id={`${prefix}-deletion-title`}>Deletion</h2>
        <div className="folio-privacy-row folio-privacy-row-first folio-privacy-operation folio-privacy-destructive" data-disabled={!!deletionUnavailable}>
          <Trash2 size={16} className="folio-privacy-row-icon" aria-hidden="true" />
          <div className="folio-privacy-text">
            <h3>{deletion.title}{activeAction === 'deletion' && <span className="folio-privacy-mobile-progress" aria-hidden="true"> · Opening…</span>}</h3>
            <p id={`${prefix}-deletion-detail`} className="folio-privacy-caption">{deletion.description}{deletionUnavailable && <><br />{deletionUnavailable}</>}</p>
          </div>
          <button type="button" className="folio-privacy-action folio-privacy-action-secondary"
            disabled={!!deletionUnavailable || activeAction !== null}
            aria-label={`Review deletion: ${deletion.title}`}
            aria-describedby={`${prefix}-deletion-detail`} aria-busy={activeAction === 'deletion'}
            onClick={() => void runAction('deletion', onDeleteScope)}>
            {activeAction === 'deletion' ? 'Opening…' : 'Delete…'}<ChevronRight size={16} className="folio-privacy-mobile-chevron" aria-hidden="true" />
          </button>
        </div>
        <div className="folio-privacy-row folio-privacy-operation folio-privacy-unavailable">
          <Trash2 size={16} className="folio-privacy-row-icon" aria-hidden="true" />
          <div className="folio-privacy-text">
            <h3>Delete everything</h3>
            <p id={`${prefix}-global-delete-detail`} className="folio-privacy-caption">Global deletion is unavailable. Review the selected scope above. Downloaded files and outside copies are not removed.</p>
          </div>
          <button type="button" className="folio-privacy-action folio-privacy-action-secondary" disabled aria-describedby={`${prefix}-global-delete-detail`}>Unavailable</button>
        </div>
      </section>
      <button type="button" className="folio-privacy-back" onClick={onClose}>
        <ArrowLeft size={14} aria-hidden="true" />Tailor a job
      </button>
      {actionError && <p className="folio-privacy-error" role="alert">{actionError}</p>}
    </div>
  </section>;
}
