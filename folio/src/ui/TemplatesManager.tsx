import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, FileText, Upload } from 'lucide-react';
import { hasValidApproval, workspaceOf, type Project } from '../core/model';
import { renderProjectDocument } from '../render/pdf';
import { defaultResumeStatus, preferenceMatches, type DefaultResumePreference } from '../storage/templatePreferences';
import { PdfPreview } from './PdfPreview';
import './templates-design.css';
import './folio-secondary.css';

function TemplateThumbnail({ project }: { project: Project }) {
  const [preview, setPreview] = useState<Uint8Array | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true; setPreview(null); setError('');
    void renderProjectDocument(project, 'baselinePreview').then(result => { if (active) setPreview(result.bytes); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'This reconstruction cannot be previewed.'); });
    return () => { active = false; };
  }, [project.id, project.source.sha256, project.template.revision, project.baseline.revision]);
  return <div className="folio-template-preview">{preview ? <PdfPreview bytes={preview} page={1} scale={0.7} label={`Reconstructed first page of ${project.source.name}`} /> : <div className="folio-template-placeholder" role="status"><FileText size={22} /><span>{error || 'Preparing reconstructed preview…'}</span></div>}</div>;
}
export interface TemplatesManagerProps {
  projects: Project[]; preference: DefaultResumePreference | null; preferenceError?: string; retainedChoiceNotice?: string; eligibleDefaultId?: string; busy?: boolean;
  onDefault: (project: Project) => Promise<void>; onInspect: (project: Project) => void; onUpload: () => void; onClose: () => void;
}
export function TemplatesManager({ projects, preference, preferenceError, retainedChoiceNotice, eligibleDefaultId, busy, onDefault, onInspect, onUpload, onClose }: TemplatesManagerProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const resumes = projects.filter(item => workspaceOf(item).kind === 'resume');
  const status = defaultResumeStatus(projects, preference);
  useEffect(() => { heading.current?.focus(); }, []);
  async function choose(project: Project) { if (pending) return; setPending(project.id); setError(''); try { await onDefault(project); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Your default could not be saved.'); } finally { setPending(null); } }
  return <section className="folio-templates" aria-labelledby="templates-title">
    <header><div><h1 ref={heading} id="templates-title" tabIndex={-1}>Templates</h1><p>New tailorings use the default.</p></div><button className="button button-secondary button-small" disabled={busy || !!pending} onClick={onUpload}><Upload size={14} />Upload a resume layout</button></header>
    {(preferenceError || status === 'missing' || status === 'changed') && <p className="folio-template-error" role="alert">{preferenceError || (status === 'missing' ? 'Your default resume was removed. Choose another approved layout before creating a new tailoring.' : 'Your default layout changed or needs approval. Inspect it and choose the approved version again.')}</p>}
    {retainedChoiceNotice && <p className="folio-template-scope">{retainedChoiceNotice}</p>}
    {error && <p className="folio-template-error" role="alert">{error}</p>}
    <div className="folio-template-grid">{resumes.map(source => {
      const isDefault = source.id === eligibleDefaultId && (!preference || preferenceMatches(source, preference));
      const count = projects.filter(item => workspaceOf(item).kind === 'application' && workspaceOf(item).templateGroupId === workspaceOf(source).templateGroupId && item.template.id === source.template.id && item.template.revision === source.template.revision).length;
      return <article className={`folio-template-card ${isDefault ? 'is-default' : ''}`} key={source.id}>
        <button className="folio-template-inspect" disabled={busy || !!pending} onClick={() => onInspect(source)} aria-label={`Inspect layout for ${source.source.name}`}><TemplateThumbnail project={source} /></button>
        <div className="folio-template-info"><div><h2>Your layout · v{source.template.revision}</h2>{isDefault ? <span className="folio-template-default"><Check size={12} />Default{!preference ? ' · automatic' : ''}</span> : <button className="text-button" disabled={busy || !!pending || !hasValidApproval(source)} onClick={() => void choose(source)}>{pending === source.id ? 'Saving…' : 'Make default'}</button>}</div>
          <p>From {source.source.name} · {source.template.pages.length} {source.template.pages.length === 1 ? 'page' : 'pages'}</p><p>{count ? `Used by ${count} ${count === 1 ? 'tailoring' : 'tailorings'} · kept for them` : 'No tailorings use this layout yet'}</p>
          <button className="text-button" disabled={busy || !!pending} onClick={() => onInspect(source)}>{hasValidApproval(source) ? 'Inspect approved layout' : 'Compare and approve layout'}</button>
        </div>
      </article>;
    })}</div>
    {!resumes.length && <div className="folio-template-empty"><FileText size={24} /><h2>Add your first layout</h2><p>Upload a supported PDF or Word resume, compare every page, then approve its reconstruction.</p><button className="button button-primary" disabled={busy} onClick={onUpload}>Choose a resume</button></div>}
    <p className="folio-template-scope">Each upload keeps its own Career Memory. Saved tailorings keep their original layout and evidence snapshot.</p>
    <p className="folio-template-limits">Thumbnails show the reconstructed first page. Compare every page with your original before approval. A pasted-text layout is not available.</p>
    <button className="text-button folio-templates-back" disabled={busy || !!pending} onClick={onClose}><ArrowLeft size={14} />Tailor a job</button>
  </section>;
}
