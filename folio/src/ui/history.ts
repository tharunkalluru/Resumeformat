import type { EvidenceDecisions, Project } from '../core/model';

export type Decisions = EvidenceDecisions;
export interface HistoryFrame { project: Project; decisions: Decisions }
function snapshot(project: Project): Project {
  // Original bytes, images, and approved layout are immutable in this editor.
  // Sharing them avoids retaining another full 10 MiB upload for every keystroke.
  return { ...project, draft: structuredClone(project.draft), facts: structuredClone(project.facts),
    notes: structuredClone(project.notes), job: structuredClone(project.job), approval: structuredClone(project.approval), evidenceDecisions: structuredClone(project.evidenceDecisions) };
}
const copyFrame = (frame: HistoryFrame): HistoryFrame => ({ project: snapshot(frame.project), decisions: structuredClone(frame.decisions) });

/** One in-session history for native typing and review decisions. Saves/renders never enter it. */
export class DocumentHistory {
  private past: HistoryFrame[] = [];
  private future: HistoryFrame[] = [];
  private lastGroup = '';
  private lastAt = 0;

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  clear() { this.past = []; this.future = []; this.lastGroup = ''; }
  push(frame: HistoryFrame, group = '') {
    const now = Date.now();
    if (!group || group !== this.lastGroup || now - this.lastAt > 700) {
      this.past.push(copyFrame(frame));
      if (this.past.length > 120) this.past.shift();
    }
    this.lastGroup = group;
    this.lastAt = now;
    this.future = [];
  }
  undo(current: HistoryFrame): HistoryFrame | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(copyFrame(current));
    this.lastGroup = '';
    return this.restore(previous, current.project);
  }
  redo(current: HistoryFrame): HistoryFrame | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(copyFrame(current));
    this.lastGroup = '';
    return this.restore(next, current.project);
  }
  private restore(frame: HistoryFrame, current: Project): HistoryFrame {
    const project = snapshot(frame.project);
    // Document undo must never restore an obsolete canonical memory checkpoint.
    if(current.template.sourceFonts?.some(f=>f.sourceVersion===7))project.approval=current.approval;
    project.careerMemory = current.careerMemory;
    project.memorySnapshot = current.memorySnapshot;
    if(current.folio){const previous=project.folio??current.folio;project.folio={...previous,completions:current.folio.completions,versions:current.folio.versions,jobIdentity:current.folio.jobIdentity,historyKnown:current.folio.historyKnown};}
    project.revision = current.revision + 1;
    project.draft.revision = current.draft.revision + 1;
    project.updatedAt = new Date().toISOString();
    project.reviewedDraftRevision = null;
    project.evidenceDecisions = structuredClone(frame.decisions);
    return { project, decisions: structuredClone(frame.decisions) };
  }
}
