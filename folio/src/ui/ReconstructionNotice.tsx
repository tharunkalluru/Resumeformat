import { RotateCcw } from 'lucide-react';
import type { Project } from '../core/model';

/** An older saved layout must not appear to be a fresh import of its original. */
export function ReconstructionNotice({ project, current, busy, onRebuild, onOpenCurrent }: {
  project: Project; current?: Project; busy: boolean; onRebuild: () => void; onOpenCurrent: () => void;
}) {
  return <section className="reconstruction-notice" aria-labelledby="reconstruction-notice-title">
    <div>
      <h2 id="reconstruction-notice-title">This saved template uses an earlier reconstruction</h2>
      <p>Opening a saved resume keeps its original imported layout. It does not rerun the current importer. Rebuild from the retained original to check the latest font and positioning support.</p>
      <p>Your existing drafts, applications and Career Memory stay in this resume group. {current ? 'A current reconstruction of the same original is already saved.' : 'The rebuild creates a separate, unapproved copy for comparison.'}</p>
      <span className="reconstruction-version">Saved with {project.template.importerVersion}</span>
    </div>
    <div className="reconstruction-notice-actions">
      {current && <button className="button button-primary" disabled={busy} onClick={onOpenCurrent}>Open current reconstruction</button>}
      <button className={`button ${current ? 'button-secondary' : 'button-primary'}`} disabled={busy} onClick={onRebuild}><RotateCcw size={16} />Rebuild from original</button>
    </div>
  </section>;
}
