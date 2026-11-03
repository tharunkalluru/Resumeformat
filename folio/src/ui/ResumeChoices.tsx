import { Check, FileText } from 'lucide-react';
import type { Project } from '../core/model';
import { sameComposerTemplate } from '../core/composerSources';

const addedAt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });

export function ResumeChoices({ sources, current, defaultId, onSelect, onDefault, disabled }: { disabled: boolean; sources: Project[]; current?: Project; defaultId: string | null; onSelect: (source: Project) => void; onDefault: (source: Project) => void }) {
  return <div className="folio-resume-choices">{sources.map(source => {
    const selected = sameComposerTemplate(current, source), isDefault = defaultId === source.id;
    const name = source.name === source.source.name ? source.source.name : `${source.name} · ${source.source.name}`;
    return <div className={`folio-resume-choice ${selected ? 'is-selected' : ''}`} key={source.id}>
      <button className="folio-resume-select" aria-pressed={selected} disabled={disabled} onClick={() => onSelect(source)}>
        <FileText size={20}/><span><strong>{name}</strong><small>{source.template.pages.length} {source.template.pages.length === 1 ? 'page' : 'pages'} · Layout v{source.template.revision}{selected ? ' · Selected' : ''}{isDefault ? ' · Default' : ''}</small><small>Added {addedAt.format(new Date(source.createdAt))}</small></span>{selected && <Check size={17}/>}</button>
      <button className="text-button" disabled={isDefault || disabled} onClick={() => onDefault(source)}>{isDefault ? 'Default' : 'Make default'}</button>
    </div>;
  })}</div>;
}
