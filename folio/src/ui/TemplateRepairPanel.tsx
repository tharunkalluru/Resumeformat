import { useEffect, useState } from 'react';
import { RotateCcw, Settings2 } from 'lucide-react';
import type { Project, Rect, TextRegion } from '../core/model';

export function TemplateRepairPanel({ project, selectedId, busy, onSelect, onApply, onReset, onOpenChange }: { project: Project; selectedId: string | null; busy: boolean; onSelect: (id: string) => void; onApply: (bounds: Rect) => void; onReset: () => void; onOpenChange?: (open: boolean) => void }) {
  const regions = project.template.pages.flatMap(page => page.regions).filter((region): region is TextRegion => region.kind === 'text');
  const selected = regions.find(region => region.id === selectedId) ?? regions[0];
  const [bounds, setBounds] = useState<Rect>(selected?.bounds ?? { x: 0, y: 0, width: 1, height: 1 });
  useEffect(() => { if (selected) setBounds({ ...selected.bounds }); }, [selected?.id, project.template.revision]);
  if (!selected) return null;
  const adjusted = project.template.adjustments?.some(item => item.regionId === selected.id);
  return <details className="panel-section template-repair" onToggle={event => onOpenChange?.(event.currentTarget.open)}><summary><Settings2 size={16} />Adjust a text box</summary><p className="subtle">Move or resize one box in points. Its wording stays intact. Compare the page again and resolve any overlap before approval.</p>
    <label>Text box<select value={selected.id} onChange={event => onSelect(event.target.value)}>{regions.map(region => <option key={region.id} value={region.id}>{project.baseline.blocks.find(block => block.id === region.contentId)?.runs.map(run => run.text).join('').slice(0, 55) || region.sourceLocator}</option>)}</select></label>
    <p className="field-help">{selected.sourceLocator}</p><div className="repair-grid">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{({ x: 'Left', y: 'Top', width: 'Width', height: 'Height' })[key]}<input type="number" min={key === 'width' || key === 'height' ? 1 : 0} step="0.5" value={Number.isFinite(bounds[key]) ? bounds[key] : ''} onChange={event => setBounds(previous => ({ ...previous, [key]: event.target.value === '' ? Number.NaN : Number(event.target.value) }))} /></label>)}</div>
    <div className="repair-actions"><button className="button button-secondary" disabled={busy || !Object.values(bounds).every(Number.isFinite)} onClick={() => onApply(bounds)}>Apply box adjustment</button><button className="text-button" disabled={busy || !adjusted} onClick={onReset}><RotateCcw size={13} />Reset this box</button></div>
    {project.template.adjustments?.length ? <p className="field-help">{project.template.adjustments.length} adjusted {project.template.adjustments.length === 1 ? 'box' : 'boxes'} · Original bounds are retained. Undo is available in this workspace.</p> : null}
  </details>;
}
