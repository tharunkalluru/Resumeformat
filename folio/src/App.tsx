import {editSourceParagraph,resetSourceParagraph} from './core/source-paragraph-commands';
import {canvasReviewCurrent, type CanvasReview} from './ui/canvasReview';
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction, type DragEvent, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, CloudOff, FileCheck2, FilePlus2, FileText, FolderClosed, HardDrive, Info, Leaf, LoaderCircle, LockKeyhole, PanelLeftClose, Pencil, Plus, Search, Home, Brain, Clock3, Mic, Menu, RotateCcw, Settings2, ShieldCheck, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { importResume } from './import/index';
import { currentReconstruction, hasEarlierReconstruction, rebuildFromOriginal } from './import/rebuild';
import {loadLegacyArchives,downloadLegacyArchive,legacyArchiveOriginal,type LegacyArchiveSummary,type VerifiedOriginal} from './storage/legacyArchives';
import {unavailableOriginal} from './storage/projects';
import {LegacyArchiveList} from './ui/LegacyArchiveList';
import { ReconstructionNotice } from './ui/ReconstructionNotice';
import { renderProjectDocument } from './render/pdf';
import { makeProject, rendererVersionFor, hasValidApproval, hasPermittedOriginalTrueType, hasOriginalCff, hasLicensedSubset, hasSourceStandardFonts, documentScopedProgramHashes, SOURCE_FONT_REUSE_TEXT, sourceFontReuseChoiceOwner, blockText, exportProblems, workspaceOf, sha256, newId, type CareerMemory, type MemorySnapshot, type ContentBlock, type JobContext, type MatchingEvidence, type MatchingResult, type Project, type RenderedDocument, type TextRegion } from './core/model';
import { errorMessage } from './core/errors';
import { addCareerNote, approveTemplate, confirmDraft, dismissEvidence, editBlock, evidenceInsertionCurrent, insertEvidence, removeCareerNote, revertDraft, setJob, validateExport, withdrawApproval } from './core/commands';
import { backupProject, backupResumeGroup, backupUnavailableProject, createSavedApplication, loadLibrary, removeProject, restoreBackup, saveProject, previewGroupRemoval, removeGroup, subscribeGroupChanges, adoptProjectCheckpoint, type GroupRemovalPlan, type UnavailableProject } from './storage/projects';
import { changedParagraphs, matchProject } from './tailoring/local';
import { DocumentCanvas, runsSignature } from './ui/DocumentCanvas';
import { PdfPreview } from './ui/PdfPreview';
import { previewOwnerCurrent, previewOwnerKey, previewReviewComplete, recordPreviewPage, type PreviewOwner, type PreviewReceipt, type PreviewReview, type PreviewStamp } from './ui/previewReview';
import { DocumentHistory } from './ui/history';
import { renameApplication } from './core/applications';
import { adjustTextRegion, resetTextRegion } from './core/templateRepair';
import { canRecoverApproximately, recoverApproximate } from './import/recovery';
import { ApplicationDialog } from './ui/ApplicationDialog';
import { TemplateRepairPanel } from './ui/TemplateRepairPanel';
import { initCareerMemory, memoryView, addMemorySource, addTextSource, createMemoryAssertion, setMemoryDraft, saveLinkedInReference, finishOnboarding, editAssertion, confirmAssertion, setAssertionFuture, excludeResumeFact, removeMemorySource, correctResumeFact, promoteCareerNote, setMemoryAssertionDraft, cancelMemoryAssertionDraft, unresolvedBaselineBlocks, failedMemorySource } from './core/careerMemory';
import { extractContextSource } from './import/context';
import { validateProject } from './core/schema';
import { OnboardingContext, type ContextCaptureProps } from './ui/OnboardingContext';
import { CareerMemoryEditor, type AssertionActions } from './ui/CareerMemoryEditor';
import { ContextSourceReview } from './ui/ContextSourceReview';
import { AiTailoringPanel } from './ui/AiTailoringPanel';
import { AiClientError, aiProjectFingerprint, probeAiCandidate, reviewedAiRuns, type AiRequest, type AiResult, type AiProposal } from './tailoring/ai';
import './render/fonts.css';
import './styles.css';
import './ui/design.css';
import { AccountMenu, AllTailorings, HomeWorkspace, JobComposer, PrivateProfileView, TailoringHistory, WorkspaceInsights } from './ui/DesignChrome';
import { presentation, setPresentation, completedTailoring, saveVersion } from './core/folio';
import { createApplication } from './core/applications';
import { mergeActivity, type PrivateProfile } from './core/activity';
import { loadPrivateProfile, savePrivateProfile } from './storage/profile';
import { runTailoring } from './tailoring/flow';
import { journalDraft, recoverJournal, clearJournal } from './storage/draftJournal';
import { sourceReviewIssues } from './tailoring/sourceSupport';
import { VersionComparison } from './ui/VersionComparison';
import { ConfirmedEvidence } from './ui/ConfirmedEvidence';
import { reusableSources, sameComposerTemplate, emptyComposerPreferences, type ComposerPreferences } from './core/composerSources';
import { ResumeChoices } from './ui/ResumeChoices';
import { loadComposerPreferences } from './storage/composerPreferences';
import { commitDefaultResume, defaultResumePreference, defaultResumeStatus, loadDefaultResume, preferenceMatches, type DefaultResumePreference } from './storage/templatePreferences';
import { composerBridgeSource, freshComposerDefault, legacyChoiceNotice, migrateLegacyDefault } from './storage/composerBridge';
import { TemplatesManager } from './ui/TemplatesManager';
import { PrivacySettings, type PrivacySource } from './ui/PrivacySettings';
import { careerMemoryGroups } from './ui/careerMemoryPresentation';
import './ui/global-rail.css';
import './ui/intake-composer-design.css';
import './ui/folio-kit-tokens.css';
import './ui/folio-kit.css';
import './ui/workspace-upgrade.css';
import './ui/product-upgrade.css';
import { TemplateInspection } from './ui/TemplateInspection';
import { QuickDownload } from './ui/QuickDownload';
import { useOptionalAuth } from './auth/AuthProvider';
import { defaultResumeFileName, safeName } from './ui/fileNames';
import { DocumentReadability } from './ui/ExportReadiness';
import type { ReadinessAction } from './ui/readinessModel';
import { useAiReadiness } from './ui/useAiReadiness';
import { decideChanges, reconcileChangeDecisions } from './ui/reviewDecisions';

type Stage = 'template' | 'job' | 'review';
type SaveStatus = 'loading' | 'dirty' | 'saving' | 'saved' | 'error';
type ComposerPublication = { from: number; to: number };
type ComposerCreation = { project: Project; publication: ComposerPublication | null };
/** Every route/overlay dispatch takes ownership synchronously, even if its
 * value is unchanged or React batches a leave-and-return into one render. */
function useRouteState<Value>(initial: Value | (() => Value), epoch: { current: number }): [Value, Dispatch<SetStateAction<Value>>] {
  const [value, commit] = useState<Value>(initial);
  const [, publishRouteOwner] = useState(0);
  const dispatch = useCallback<Dispatch<SetStateAction<Value>>>(next => {
    epoch.current += 1;
    publishRouteOwner(revision => revision + 1);
    commit(next);
  }, [epoch]);
  return [value, dispatch];
}
type PendingContextFile = { id: string; name: string; format: string; state: 'reading' | 'error'; error?: string };
const stages: { id: Stage; label: string; short: string }[] = [{ id: 'template', label: 'Your template', short: 'Template' }, { id: 'job', label: 'Job context', short: 'Job context' }, { id: 'review', label: 'Review & export', short: 'Review' }];
const firstRegion = (project: Project) => project.template.pages.flatMap(page => page.regions).find(region => region.kind === 'text' && (region.role === 'body' || region.role === 'bullet'))?.id ?? project.template.pages[0]?.regions.find(region => region.kind === 'text')?.id ?? null;
function previewOwnerFor(project: Project | null, kind: 'source' | 'baseline' | 'draft'): PreviewOwner | null {
  return project ? { purpose: kind, projectId: project.id, sourceSha256: project.source.sha256,
    templateRevision: kind === 'source' ? 0 : project.template.revision,
    contentRevision: kind === 'source' ? 0 : project[kind].revision } : null;
}
function download(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30000); }

function Modal({ title, children, onClose, className = '', backLabel, headerAction }: { title: string; children: ReactNode; onClose: () => void; className?: string; backLabel?: string; headerAction?: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement, target = dialog.current; target?.showModal(); return () => { target?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
  return <dialog ref={dialog} className={`modal ${className}`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === dialog.current) onClose(); }} aria-labelledby="dialog-title"><div className="modal-heading">{backLabel && <button className="text-button folio-modal-back" onClick={onClose}><ArrowLeft size={14} />{backLabel}</button>}<h2 id="dialog-title">{title}</h2>{headerAction && <div className="folio-modal-header-action">{headerAction}</div>}{!backLabel && <button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={19} /></button>}</div>{children}</dialog>;
}

export default function App() {
  const routeEpoch = useRef(0);
  // Initial-render ownership also catches navigation before startup's effect
  // begins; startup does not acquire the destination after a newer event.
  const startupRouteOwner = useRef(routeEpoch.current);
  const [surface, setSurface] = useRouteState<'studio' | 'home' | 'compose' | 'profile' | 'history' | 'help' | 'templates'>('studio', routeEpoch);
  const [homeText, setHomeText] = useState('');
  const [openItemIds, setOpenItemIds] = useState<string[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [cleanHighlights, setCleanHighlights] = useState(false);
  const [insightsOpen, setInsightsOpen] = useRouteState<boolean>(false, routeEpoch);
  const [composerText, setComposerText] = useState('');
  const composerTextRef = useRef('');
  const [composerDetails, setComposerDetails] = useState({ title: '', company: '' });
  const composerDetailsRef = useRef(composerDetails);
  const composerDraftId = useRef<string | null>(null);
  const composerGeneration = useRef(0);
  const composerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerCreating = useRef<Promise<ComposerCreation | null> | null>(null);
  const [composerPreferences, setComposerPreferences] = useState<ComposerPreferences>(emptyComposerPreferences);
  const composerPreferencesRef = useRef(composerPreferences); composerPreferencesRef.current = composerPreferences;
  const [resumeChooserOpen, setResumeChooserOpen] = useRouteState<boolean>(false, routeEpoch);
  const composerNavigation = useRef(0);
  const [composerNavigating, setComposerNavigating] = useState(false);
  const composerNavigationPending = useRef(false);
  const [composerConsent, setComposerConsent] = useState(false);
  const [tailorError, setTailorError] = useState('');
  const { service: aiService, check: checkAiService } = useAiReadiness(surface === 'compose');
  const tailoringOperation = useRef<AbortController | null>(null);
  const [profile, setProfile] = useState<PrivateProfile | null>(null);
  const profileRef = useRef(profile); profileRef.current = profile;
  const [profileError, setProfileError] = useState('');
  const ingestGeneration = useRef(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const projectsRef = useRef(projects); projectsRef.current = projects;
  const [failedSaves,setFailedSaves]=useState<string[]>([]);
  const [unavailableProjects, setUnavailableProjects] = useState<UnavailableProject[]>([]);
  const [legacyArchives,setLegacyArchives]=useState<LegacyArchiveSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const projectRef = useRef(project); projectRef.current = project;
  const [stage, setStage] = useRouteState<Stage>('template', routeEpoch);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading');
  const [savedRevision, setSavedRevision] = useState<number | null>(null);
  const savedRef = useRef<{ id: string; revision: number } | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  const deletingIds = useRef(new Set<string>());
  const [error, setError] = useState('');
  const persistenceFailure = useRef<{ projectId: string; message: string; causeMessage: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const exportInFlight = useRef(false);
  const pendingWrites = useRef(new Set<Promise<void>>());
  const [dragging, setDragging] = useState(false);
  const [settings, setSettings] = useRouteState<boolean>(false, routeEpoch);
  const privacyOpener = useRef<HTMLElement | null>(null);
  const privacyStartedAtIntake = useRef(false);
  const intakePrivacyButton = useRef<HTMLButtonElement | null>(null);
  const [defaultResume, setDefaultResume] = useState<DefaultResumePreference | null>(null);
  const defaultResumeRef = useRef(defaultResume); defaultResumeRef.current = defaultResume;
  const [defaultResumeReady, setDefaultResumeReady] = useState(false);
  const defaultResumeReadyRef = useRef(false); defaultResumeReadyRef.current = defaultResumeReady;
  const [defaultResumeError, setDefaultResumeError] = useState('');
  const defaultResumeErrorRef = useRef(''); defaultResumeErrorRef.current = defaultResumeError;
  const [explicitSelection, setExplicitSelection] = useState<DefaultResumePreference | null>(null);
  const explicitSelectionRef = useRef(explicitSelection); explicitSelectionRef.current = explicitSelection;
  const [downloadSettings,setDownloadSettings]=useRouteState<boolean>(false, routeEpoch);
  const [downloadName,setDownloadName]=useState('');
  const [downloadedName,setDownloadedName]=useState('');
  const [sidebarOpen, setSidebarOpen] = useRouteState<boolean>(false, routeEpoch);
  const [deleteTarget, setDeleteTarget] = useRouteState<Project | null>(null, routeEpoch);
  const [applicationSource, setApplicationSource] = useRouteState<Project | null>(null, routeEpoch);
  const [applicationError, setApplicationError] = useState('');
  const [renameTarget, setRenameTarget] = useRouteState<Project | null>(null, routeEpoch);
  const [renameText, setRenameText] = useState('');
  const createInFlight = useRef(false);
  const recoveryInFlight = useRef(false);
  const switchSequence = useRef(0);
  const [mobileViewport, setMobileViewport] = useState(() => window.matchMedia('(max-width: 699px)').matches);
  const [memoryContextOpen, setMemoryContextOpen] = useRouteState<boolean>(false, routeEpoch);
  const [requestedMemoryView, setRequestedMemoryView] = useRouteState<{ view: 'roles' | 'context'; request: number }>({ view: 'roles', request: 0 }, routeEpoch);
  const [navigationViewport, setNavigationViewport] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const [narrowViewport, setNarrowViewport] = useState(() => window.matchMedia('(max-width: 1280px)').matches);
  const [selectedRegion, setSelectedRegion] = useRouteState<string | null>(null, routeEpoch);
  const [repairOpen, setRepairOpen] = useRouteState<boolean>(false, routeEpoch);
  const [compareVersionId, setCompareVersionId] = useRouteState<string | null>(null, routeEpoch);
  const [evidenceTarget, setEvidenceTarget] = useRouteState<{projectId:string;blockId?:string;text?:string} | null>(null, routeEpoch);
  const [insightTab, setInsightTab] = useRouteState<'changes' | 'job' | 'versions' | 'notes'>('changes', routeEpoch);
  const [page, setPage] = useRouteState<number>(1, routeEpoch);
  const [view, setView] = useRouteState<'canvas' | 'pdf'>('canvas', routeEpoch);
  const [mobilePane, setMobilePane] = useRouteState<'document' | 'details'>('document', routeEpoch);
  const [fontReuseChoice,setFontReuseChoice]=useState<string|null>(null);
  const fontReuseChoiceRef=useRef<string|null>(null);
  const fontReuseOwner=sourceFontReuseChoiceOwner;
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [draftRender, setDraftRender] = useState<RenderedDocument | null>(null);
  const [baselineRender, setBaselineRender] = useState<RenderedDocument | null>(null);
  const [baselinePreviewStamp, setBaselinePreviewStamp] = useState<PreviewStamp | null>(null);
  const [draftPreviewStamp, setDraftPreviewStamp] = useState<PreviewStamp | null>(null);
  const [, setBaselinePreviewReview] = useState<PreviewReview | null>(null);
  const [, setOriginalPreviewReview] = useState<PreviewReview | null>(null);
  const previewRuntime = useRef<{ baselineStamp: PreviewStamp | null; draftStamp: PreviewStamp | null;
    source: PreviewReview | null; baseline: PreviewReview | null; draft: PreviewReview | null }>(
    { baselineStamp: null, draftStamp: null, source: null, baseline: null, draft: null });
  const [renderStatus, setRenderStatus] = useState<'idle' | 'rendering' | 'ready' | 'error'>('idle');
  const [layoutIssues, setLayoutIssues] = useState<string[]>([]);
  const [canvasCheck, setCanvasCheck] = useState<CanvasReview | null>(null);
  const [composition, setComposition] = useState(false);
  const [notesText, setNotesText] = useState('');
  const [noteConfirmed, setNoteConfirmed] = useState(false);
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [matching, setMatching] = useState<MatchingResult | null>(null);
  const [visibleEvidenceCount, setVisibleEvidenceCount] = useState(12);
  const decisions = project?.evidenceDecisions ?? {};
  const [pendingEvidence, setPendingEvidence] = useRouteState<MatchingEvidence | null>(null, routeEpoch);
  const [finalConfirmed, setFinalConfirmed] = useState(false);
  const [pendingDownload, setPendingDownload] = useState<{ filename?: string } | null>(null);
  const workspaceScroller = useRef<HTMLElement>(null);
  const auth = useOptionalAuth();
  const [downloadProgress, setDownloadProgress] = useState('');
  const [, setPdfReview] = useState<PreviewReview | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const history = useRef(new DocumentHistory());
  const fileInput = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const resumeLibrary = useRef<HTMLDetailsElement>(null);
  const libraryElement = useRef<HTMLElement>(null);
  const libraryOpener = useRef<HTMLButtonElement>(null);
  const memoryRailOpener = useRef<HTMLButtonElement>(null);
  const [memoryDestination, setMemoryDestination] = useRouteState<'onboarding' | 'editor' | null>(null, routeEpoch);
  const memoryDrawerMode = surface === 'studio' && memoryDestination === 'editor' && !settings;
  const reviewWorkspace = surface === 'studio' && stage === 'review' && !memoryDestination && !settings;
  const sidebarAutomaticallyCollapsed = reviewWorkspace ? narrowViewport : navigationViewport;
  const collapsedHistory = sidebarAutomaticallyCollapsed || sidebarCollapsed;
  const [memoryError, setMemoryError] = useState('');
  const [memoryFromSnapshot, setMemoryFromSnapshot] = useState<MemorySnapshot | undefined>();
  const [sourceReviewId, setSourceReviewId] = useRouteState<string | null>(null, routeEpoch);
  const [pendingContextFiles, setPendingContextFiles] = useState<PendingContextFile[]>([]);
  const contextOperations = useRef(new Map<string, { file: File; controller: AbortController }>());
  const operationGeneration = useRef(0);
  const memoryPast = useRef<CareerMemory[]>([]);
  const memoryFuture = useRef<CareerMemory[]>([]);
  const [memoryHistoryTick, setMemoryHistoryTick] = useState(0);
  const [groupRemoval, setGroupRemoval] = useRouteState<GroupRemovalPlan | null>(null, routeEpoch);
  const [reloadTarget, setReloadTarget] = useRouteState<Project | null>(null, routeEpoch);
  // Event closures own the render that supplied them. A synchronous route
  // dispatch can invalidate an old callback before React commits any render.
  const renderedRouteOwner = routeEpoch.current;

  useEffect(() => {
    if (!sidebarOpen || !collapsedHistory) return;
    const element = libraryElement.current;
    const focusable = () => Array.from(element?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex="0"]') ?? []).filter(item => item.getClientRects().length);
    focusable()[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') {
        // Nested menus close themselves and return focus before the containing
        // drawer owns a subsequent Escape. This capture listener runs first.
        const activeMenu = document.activeElement?.closest('[role="menu"]') ??
          document.activeElement?.closest('.folio-account')?.querySelector('[role="menu"]');
        if (activeMenu && element?.contains(activeMenu)) return;
        event.preventDefault(); setSidebarOpen(false); return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable(), first = items[0], last = items.at(-1);
      if (!first || !last) return;
      if (!element?.contains(document.activeElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    };
    document.addEventListener('keydown', keyboard, true);
    return () => { document.removeEventListener('keydown', keyboard, true); const openers=[libraryOpener.current,memoryRailOpener.current]; (openers.find(item=>item?.getClientRects().length) ?? libraryOpener.current)?.focus(); };
  }, [sidebarOpen, collapsedHistory]);

  function openProject(next: Project, alreadySaved = false) {
    persistenceFailure.current = null;
    composerGeneration.current++;if(composerTimer.current)clearTimeout(composerTimer.current);
    adoptProjectCheckpoint(next);
    operationGeneration.current++;
    for (const entry of contextOperations.current.values()) entry.controller.abort();
    contextOperations.current.clear(); setPendingContextFiles([]); setSourceReviewId(null);
    memoryPast.current = []; memoryFuture.current = []; setMemoryHistoryTick(value => value + 1);
    setMemoryError(''); setMemoryFromSnapshot(undefined); setMemoryContextOpen(false); setRequestedMemoryView({ view: 'roles', request: 0 });
    explicitSelectionRef.current = null; setExplicitSelection(null);
    setComposerConsent(false); setSettings(false); setMemoryDestination(null); setSurface('studio'); setInsightsOpen(workspaceOf(next).kind === 'application');
    switchSequence.current++;
    history.current.clear(); setHistoryTick(value => value + 1); setVisibleEvidenceCount(12);
    setProject(next); projectRef.current = next;
    previewRuntime.current = { baselineStamp: null, draftStamp: null, source: null, baseline: null, draft: null };
    setStage(hasValidApproval(next) ? (next.job.description ? 'review' : 'job') : 'template');
    setSelectedRegion(firstRegion(next)); setRepairOpen(false); setCompareVersionId(null); setEvidenceTarget(null); setInsightTab('changes'); setPage(1); setView('canvas');
    setNotesText(''); setNoteConfirmed(false); setNoteEditingId(null);
    fontReuseChoiceRef.current=null;setFontReuseChoice(null);
    setAcknowledged(next.approval?.acknowledgedWarnings ?? []); setMatching(next.job.description ? matchProject(next) : null);
    setDraftRender(null); setBaselineRender(null); setBaselinePreviewStamp(null); setDraftPreviewStamp(null); setBaselinePreviewReview(null); setOriginalPreviewReview(null); setLayoutIssues([]); setCanvasCheck(null); setFinalConfirmed(false); setPdfReview(null); setPendingEvidence(null); setSidebarOpen(false); setError(''); setNotice('');setDownloadedName('');setDownloadSettings(false);
    savedRef.current = alreadySaved ? { id: next.id, revision: next.revision } : null;
    setSavedRevision(alreadySaved ? next.revision : null); setSaveStatus(alreadySaved ? 'saved' : 'dirty');
  }

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1280px)'), mobile = window.matchMedia('(max-width: 699px)'), navigation = window.matchMedia('(max-width: 900px)');
    const change = () => { setNarrowViewport(media.matches); setMobileViewport(mobile.matches); setNavigationViewport(navigation.matches); };
    media.addEventListener('change', change); mobile.addEventListener('change', change); navigation.addEventListener('change', change); return () => { media.removeEventListener('change', change); mobile.removeEventListener('change', change); navigation.removeEventListener('change', change); };
  }, []);

  useEffect(() => {
    let active = true;
    void loadLegacyArchives().then(rows=>{if(active){setLegacyArchives(rows);if(rows.length&&resumeLibrary.current)resumeLibrary.current.open=true;}}).catch(reason=>{if(active)setError(errorMessage(reason));});
    const initialNavigation = composerNavigation.current, initialGeneration = operationGeneration.current;
    const initialRoute = startupRouteOwner.current;
    // Publish the actual library independently. Optional preference failures
    // must not hide approved records from deliberate chooser recovery.
    const libraryRead = loadLibrary().then(({ projects: saved, unavailable }) => {
      const restored = saved.map(item => recoverJournal(item) ?? item);
      if (active) {
        projectsRef.current = restored;
        setFailedSaves(restored.filter((item, index) => item !== saved[index]).map(item => item.id));
        setProjects(restored); setUnavailableProjects(unavailable);
        if(unavailable.length&&resumeLibrary.current)resumeLibrary.current.open=true;
        if (!projectRef.current) setSaveStatus('saved');
      }
      return { saved, restored };
    }).catch(reason => {
      if (active) { setError(`The saved resume library could not be opened. ${errorMessage(reason)}`); setSaveStatus('error'); }
      throw reason;
    });
    void Promise.allSettled([libraryRead, loadComposerPreferences(), loadDefaultResume()]).then(async ([libraryResult, legacyResult, canonicalResult]) => {
      if (!active) return;
      const failures: string[] = [];
      const preferences = legacyResult.status === 'fulfilled' ? legacyResult.value : null;
      if (preferences) { setComposerPreferences(preferences); composerPreferencesRef.current = preferences; }
      else failures.push(`Earlier resume choices could not be read; their saved records remain unchanged. ${errorMessage(legacyResult.status === 'rejected' ? legacyResult.reason : undefined)}`);
      let selectedDefault = canonicalResult.status === 'fulfilled' ? canonicalResult.value : null;
      if (canonicalResult.status === 'rejected') failures.push(`The saved default could not be read; its absence has not been established. ${errorMessage(canonicalResult.reason)}`);
      // A failed read is not an absent record. Migration requires all reads to
      // succeed; explicit chooser verification is independent of these reads.
      if (libraryResult.status === 'fulfilled' && preferences && canonicalResult.status === 'fulfilled') {
        try {
          selectedDefault = await migrateLegacyDefault(libraryResult.value.restored, preferences, selectedDefault,
            id => projectRef.current?.id === id ? projectRef.current : projectsRef.current.find(item => item.id === id),
            () => active && !defaultResumeReadyRef.current);
        } catch (reason) { failures.push(`Earlier choices remain saved. ${errorMessage(reason)}`); }
      }
      if (!active) return;
      // A deliberate default committed while startup reads were pending owns
      // the current choice; an older read must not replace that success.
      if (!defaultResumeReadyRef.current) {
        const message = failures.join(' ');
        defaultResumeRef.current = selectedDefault; setDefaultResume(selectedDefault);
        defaultResumeErrorRef.current = message; setDefaultResumeError(message);
        defaultResumeReadyRef.current = true; setDefaultResumeReady(true);
      }
      if (libraryResult.status === 'fulfilled' && libraryResult.value.saved.length && !projectRef.current &&
        composerNavigation.current === initialNavigation && operationGeneration.current === initialGeneration &&
        routeEpoch.current === initialRoute &&
        !explicitSelectionRef.current && !composerNavigationPending.current && !composerTextRef.current.trim()) {
        const { restored } = libraryResult.value;
        const source = freshComposerDefault(restored, null, defaultResumeRef.current, defaultResumeReadyRef.current,
          defaultResumeErrorRef.current, composerPreferencesRef.current) ?? restored[0];
        // Opening a saved record for review is not a new-job source fallback.
        openProject(source, !libraryResult.value.restored.some((item, index) => item.id === source.id && item !== libraryResult.value.saved[index]));
        if (hasValidApproval(source)) setSurface('home');
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void loadPrivateProfile().then(value => { if (active) setProfile(value); }).catch(reason => { if (active) setProfileError(errorMessage(reason)); });
    const keyboard = (event: KeyboardEvent) => { if (!event.metaKey && !event.ctrlKey && !event.altKey) document.documentElement.dataset.inputModality = 'keyboard'; };
    const pointer = () => { document.documentElement.dataset.inputModality = 'pointer'; };
    document.addEventListener('keydown', keyboard); document.addEventListener('pointerdown', pointer);
    return () => { active = false; document.removeEventListener('keydown', keyboard); document.removeEventListener('pointerdown', pointer); };
  }, []);
  useEffect(() => {
    const current = profileRef.current; if (!current) return;
    const events = mergeActivity(projects, current.events);
    const historyUnavailable = !!current.historyUnavailable || projects.some(item => workspaceOf(item).kind === 'application' && !item.folio?.historyKnown);
    if (JSON.stringify(events) === JSON.stringify(current.events) && historyUnavailable === !!current.historyUnavailable) return;
    const next = { ...current, events, historyUnavailable }; setProfile(next); profileRef.current = next;
    void savePrivateProfile(next, 'activity').then(saved => { setProfile(saved); profileRef.current = saved; }).catch(reason => setProfileError(errorMessage(reason)));
  }, [projects, !!profile]);
  useEffect(() => () => { tailoringOperation.current?.abort(); if (composerTimer.current) clearTimeout(composerTimer.current); ingestGeneration.current++; composerGeneration.current++; }, []);

  async function persist(snapshot: Project, options?: { optionalHistory: true }) {
    const pending = persistSnapshot(snapshot, options);
    pendingWrites.current.add(pending);
    try { await pending; } finally { pendingWrites.current.delete(pending); }
  }
  async function persistSnapshot(snapshot: Project, options?: { optionalHistory: true }) {
    if (deletingIds.current.has(snapshot.id)) return;
    // A download is already delivered before its optional history write. Keep
    // the saved, active draft intact if this extra record cannot be stored.
    if (options?.optionalHistory) {
      await saveProject(snapshot);
      if (deletingIds.current.has(snapshot.id)) return;
      setProjects(previous => [snapshot, ...previous.filter(item => item.id !== snapshot.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      return;
    }
    if (projectRef.current?.id === snapshot.id) setSaveStatus('saving');
    try {
      await saveProject(snapshot);clearJournal(snapshot.id,snapshot.revision);setFailedSaves(previous=>previous.filter(id=>id!==snapshot.id));
      if (deletingIds.current.has(snapshot.id)) return;
      setProjects(previous => [snapshot, ...previous.filter(item => item.id !== snapshot.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      if (projectRef.current?.id === snapshot.id) {
        savedRef.current = { id: snapshot.id, revision: snapshot.revision }; setSavedRevision(snapshot.revision);
        setSaveStatus(projectRef.current.revision === snapshot.revision ? 'saved' : 'dirty');
        if (projectRef.current.revision === snapshot.revision) {
          const failure = persistenceFailure.current;
          setError(previous => {
            const resolved = failure?.projectId === snapshot.id && previous === failure.message;
            return resolved || previous.startsWith('Not saved. Recovered job content is open;') ? '' : previous;
          });
          if (failure?.projectId === snapshot.id) setTailorError(previous => previous === failure.causeMessage ? '' : previous);
          if (failure?.projectId === snapshot.id) persistenceFailure.current = null;
        }
      }
    } catch (reason) {
      const existing=projects.some(item=>item.id===snapshot.id),recoverable=existing&&journalDraft(snapshot);
      if(existing){setFailedSaves(previous=>[...new Set([...previous,snapshot.id])]);setProjects(previous=>previous.map(item=>item.id===snapshot.id?snapshot:item));}
      if (projectRef.current?.id === snapshot.id) {
        const causeMessage = errorMessage(reason);
        const message = `${causeMessage}${recoverable?' Your job edits are kept in a separate local recovery journal.':' Download a backup of the open edits before closing; recovery storage is unavailable for this write.'}`;
        persistenceFailure.current = { projectId: snapshot.id, message, causeMessage };
        setSaveStatus('error'); setError(message);
      }
      throw reason;
    }
  }
  async function persistBeforeSwitch(flushComposer = true, onComposerPublication?: (publication: ComposerPublication) => void) {
    if (flushComposer && surface === 'compose' && composerTextRef.current.trim()) {
      if (composerTimer.current) { clearTimeout(composerTimer.current); composerTimer.current = null; }
      await saveComposer(onComposerPublication);
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const current = projectRef.current;
      if (!current || savedRef.current?.id === current.id && savedRef.current.revision === current.revision) return;
      await persist(structuredClone(current));
    }
    throw new Error('Finish editing the current resume before switching projects. Your current work remains open.');
  }
  async function switchProject(next: Project) {
    if (!beginComposerNavigation()) return;
    const request = ++composerNavigation.current;
    try {
      await persistBeforeSwitch();
      if (request !== composerNavigation.current) return;
      if (projectRef.current?.id === next.id) { setSurface('studio'); setMemoryDestination(null); setSidebarOpen(false); return; }
      openProject(next, true);
    }
    catch (reason) { setError(errorMessage(reason)); }
    finally { endComposerNavigation(); }
  }

  useEffect(() => {
    if (!project || deletingIds.current.has(project.id) || savedRef.current?.id === project.id && savedRef.current.revision === project.revision) return;
    setSaveStatus('dirty');
    autosaveTimer.current = window.setTimeout(() => { autosaveTimer.current = null; if (!exportInFlight.current) void persist(structuredClone(project)).catch(() => {}); }, 650);
    return () => { if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current); autosaveTimer.current = null; };
  }, [project?.id, project?.revision]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { const current = projectRef.current; if (current && (savedRef.current?.id !== current.id || savedRef.current.revision !== current.revision)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect);
  }, []);

  useEffect(() => subscribeGroupChanges(change => {
    const current = projectRef.current;
    if (current && workspaceOf(current).templateGroupId === change.templateGroupId && (change.state === 'deleted' || change.state === 'resumeRemoved' && workspaceOf(current).kind === 'resume')) {
      operationGeneration.current++;
      for (const entry of contextOperations.current.values()) entry.controller.abort();
      contextOperations.current.clear();
      if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
      history.current.clear(); memoryPast.current = []; memoryFuture.current = [];
      setProject(null); projectRef.current = null; savedRef.current = null; setSavedRevision(null);
      setMemoryDestination(null); setSourceReviewId(null); setPendingContextFiles([]); setGroupRemoval(null);
      setSaveStatus('saved'); setNotice('This resume was removed in another Folio window. The deleted record will not be recreated.');
    }
    void loadLibrary().then(result => { setProjects(result.projects); setUnavailableProjects(result.unavailable); }).catch(reason => setError(errorMessage(reason)));
  }), []);
  useEffect(() => () => {
    operationGeneration.current++;
    for (const entry of contextOperations.current.values()) entry.controller.abort();
    contextOperations.current.clear();
  }, []);

  useEffect(() => {
    if (!project) return;
    let active = true;
    const owner = previewOwnerFor(project, 'baseline')!;
    previewRuntime.current.baselineStamp = null; previewRuntime.current.baseline = null;
    setBaselineRender(null); setBaselinePreviewStamp(null); setBaselinePreviewReview(null);
    void renderProjectDocument(project, 'baselinePreview').then(result => {
      const stamp = { ...owner, bytes: result.bytes, scale: 1.5 };
      if (active && previewOwnerCurrent(stamp, previewOwnerFor(projectRef.current, 'baseline'))) {
        previewRuntime.current.baselineStamp = stamp;
        setBaselineRender(result); setBaselinePreviewStamp(stamp);
      }
    }).catch(reason => { if (active && projectRef.current?.id === owner.projectId) setError(errorMessage(reason)); });
    return () => { active = false; };
  }, [project?.id, project?.source.sha256, project?.template.revision, project?.baseline.revision]);
  useEffect(() => {
    if (!project) return;
    let active = true;
    const expectedId = project.id, expectedRevision = project.draft.revision, expectedTemplateRevision = project.template.revision;
    const owner = previewOwnerFor(project, 'draft')!;
    previewRuntime.current.draftStamp = null; previewRuntime.current.draft = null;
    setRenderStatus('rendering'); setDraftPreviewStamp(null); setFinalConfirmed(false); setPdfReview(null);
    if((hasSourceStandardFonts(project.template)||hasPermittedOriginalTrueType(project.template)||hasOriginalCff(project.template)||hasLicensedSubset(project.template)||documentScopedProgramHashes(project.template).length>0)&&!hasValidApproval(project)){setDraftRender(null);setRenderStatus('idle');return;}
    const timer = window.setTimeout(() => {
      void renderProjectDocument(project, 'current').then(result => {
        if (!active || projectRef.current?.id !== expectedId || projectRef.current.draft.revision !== expectedRevision || projectRef.current.template.revision !== expectedTemplateRevision) return;
        const stamp = { ...owner, bytes: result.bytes, scale: 1.5 };
        if (!previewOwnerCurrent(stamp, previewOwnerFor(projectRef.current, 'draft'))) return;
        previewRuntime.current.draftStamp = stamp;
        setDraftRender(result); setDraftPreviewStamp(stamp); setRenderStatus('ready');
      }).catch(reason => { if (active) { setRenderStatus('error'); setError(errorMessage(reason)); } });
    }, 320);
    return () => { active = false; window.clearTimeout(timer); };
  }, [project?.id, project?.source.sha256, project?.draft.revision, project?.template.revision, (project?.template.sourceType1Baseline||project?.template.sourceStandardFonts?.length||(project&&hasPermittedOriginalTrueType(project.template))||project?.template.sourceFonts?.some(f=>f.sourceVersion===7||f.sourceVersion===8||f.sourceVersion===9))?project?.approval:null, (project?.template.sourceType1Baseline||project?.template.sourceStandardFonts?.length||(project&&hasPermittedOriginalTrueType(project.template))||project?.template.sourceFonts?.some(f=>f.sourceVersion===7||f.sourceVersion===8||f.sourceVersion===9))?project?.draft:null]);

  function mutate(next: Project, group = '') {
    if (exportInFlight.current) return;
    const current = projectRef.current;
    if (!current || current.id !== next.id || next === current) return;
    next = reconcileChangeDecisions(current, next);
    history.current.push({ project: current, decisions: current.evidenceDecisions }, group);
    setProject(next); projectRef.current = next;
    setHistoryTick(value => value + 1); setFinalConfirmed(false); setError('');
  }
  function undo() { const current = projectRef.current; if (!current || exportInFlight.current) return; const frame = history.current.undo({ project: current, decisions: current.evidenceDecisions }); if (frame) { setProject(frame.project); projectRef.current = frame.project; setFinalConfirmed(false); setHistoryTick(value => value + 1); } }
  function redo() { const current = projectRef.current; if (!current || exportInFlight.current) return; const frame = history.current.redo({ project: current, decisions: current.evidenceDecisions }); if (frame) { setProject(frame.project); projectRef.current = frame.project; setFinalConfirmed(false); setHistoryTick(value => value + 1); } }
  function handleEdits(blocks: ContentBlock[], group: string) {
    if (exportInFlight.current) return;
    const current = projectRef.current; if (!current) return;
    try {
      let next = current;
      for (const block of blocks) { const previous = next.draft.blocks.find(item => item.id === block.id); const region = next.template.pages.flatMap(page => page.regions).find(region => region.kind === 'text' && region.contentId === block.id); const style = region?.kind === 'text' ? region.style : undefined; if (previous && runsSignature(previous, style) !== runsSignature(block, style)) next = editBlock(next, block.id, block.runs); }
      if (next !== current) mutate(next, group);
    } catch (reason) { setError(errorMessage(reason)); }
  }

  function commitMemory(next: Project, remember = true) {
    if (exportInFlight.current) return;
    const current = projectRef.current;
    if (!current || current.id !== next.id || next === current) return;
    if (remember && current.careerMemory) {
      memoryPast.current.push(current.careerMemory);
      if (memoryPast.current.length > 120) memoryPast.current.shift();
      memoryFuture.current = [];
    }
    history.current.clear(); setHistoryTick(value => value + 1);
    setProject(next); projectRef.current = next; setMemoryHistoryTick(value => value + 1);
    setMatching(next.job.description ? matchProject(next) : null); setMemoryError('');
  }
  function memoryAction(action: (current: Project, revision: number) => Project, remember = true) {
    try {
      const current = projectRef.current;
      if (!current?.careerMemory || workspaceOf(current).kind !== 'resume') throw new Error('Open the reusable resume to edit Career Memory.');
      commitMemory(action(current, current.careerMemory.revision), remember);
    } catch (reason) { setMemoryError(errorMessage(reason)); }
  }
  async function asyncMemoryAction(action: (current: Project, revision: number) => Promise<Project>, remember = true) {
    const generation = operationGeneration.current;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const current = projectRef.current;
        if (!current?.careerMemory || workspaceOf(current).kind !== 'resume') throw new Error('Open the reusable resume to edit Career Memory.');
        const next = await action(current, current.careerMemory.revision);
        if (generation !== operationGeneration.current || projectRef.current?.id !== current.id) throw new Error('This source belongs to the previous resume. Return to that resume to continue.');
        if (projectRef.current.revision !== current.revision) continue;
        commitMemory(next, remember); return next;
      }
      throw new Error('Career Memory changed while processing this detail. Review the current wording and try again.');
    } catch (reason) { setMemoryError(errorMessage(reason)); throw reason; }
  }
  async function openMemory(resume: Project) {
    setSurface('studio');
    if (busy) return;
    const active = projectRef.current;
    const snapshot = active && workspaceOf(active).templateGroupId === workspaceOf(resume).templateGroupId ? active.memorySnapshot : undefined;
    try {
      await persistBeforeSwitch();
      const current = projectRef.current?.id === resume.id ? projectRef.current : projects.find(item => item.id === resume.id) ?? resume;
      const next = initCareerMemory(current);
      if (next !== current) await persist(next);
      if (projectRef.current?.id !== next.id || projectRef.current !== next) openProject(next, true);
      setMemoryFromSnapshot(snapshot); setMemoryDestination('editor'); setSidebarOpen(false);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  async function addContextFiles(files: File[], retrySourceId?: string) {
    const current = projectRef.current;
    if (!current?.careerMemory) throw new Error('Open Career Memory before adding supporting files.');
    const existingIds = new Set(current.careerMemory.sources.filter(source => source.kind === 'supportingFile' && source.id !== retrySourceId).map(source => source.id));
    const pendingIds = [...contextOperations.current.keys()].filter(id => id !== retrySourceId && !existingIds.has(id));
    if (existingIds.size + pendingIds.length + files.length > 5) throw new Error('Keep at most 5 supporting files. Remove an unused source before adding another.');
    const storedBytes = current.careerMemory.sources.reduce((total, source) => total + (source.bytes?.byteLength ?? 0), 0);
    const pendingBytes = [...contextOperations.current.values()].reduce((total, entry) => total + entry.file.size, 0);
    if (storedBytes + pendingBytes + files.reduce((total, file) => total + file.size, 0) > 25 * 1024 * 1024) throw new Error('Supporting originals can total up to 25 MiB. Remove an unused file before adding more.');
    const generation = operationGeneration.current;
    const errors: string[] = [];
    for (const file of files) {
      const id = retrySourceId ?? newId(), controller = new AbortController();
      contextOperations.current.set(id, { file, controller });
      setPendingContextFiles(previous => [...previous, { id, name: file.name, format: file.name.split('.').at(-1)?.toUpperCase() ?? 'FILE', state: 'reading' }]);
      try {
        const source = await extractContextSource(file, { groupId: workspaceOf(current).templateGroupId, sourceId: id, signal: controller.signal });
        if (generation !== operationGeneration.current || controller.signal.aborted) return;
        const next = await asyncMemoryAction((resume, revision) => addMemorySource(resume, source, revision));
        contextOperations.current.delete(id); setPendingContextFiles(previous => previous.filter(item => item.id !== id));
        const retained = next.careerMemory!.sources.find(item => item.sha256 === source.sha256 && item.kind === source.kind);
        if (retained?.id !== id) setNotice('This exact supporting source is already in Career Memory. Its existing review is preserved.');
      } catch (reason) {
        if (controller.signal.aborted || generation !== operationGeneration.current) return;
        const message = errorMessage(reason); errors.push(`${file.name}: ${message}`);
        const format = file.name.split('.').at(-1)?.toLowerCase();
        if (format === 'pdf' || format === 'docx' || format === 'txt') {
          try {
            const code = reason && typeof reason === 'object' && 'code' in reason && typeof reason.code === 'string' ? reason.code : 'MEMORY_IMPORT_FAILED';
            const failed = failedMemorySource({ id, name: file.name, format, errorCode: code });
            await asyncMemoryAction((resume, revision) => addMemorySource(resume, failed, revision));
            setPendingContextFiles(previous => previous.filter(item => item.id !== id));
          } catch { setPendingContextFiles(previous => previous.map(item => item.id === id ? { ...item, state: 'error', error: message } : item)); }
        } else setPendingContextFiles(previous => previous.map(item => item.id === id ? { ...item, state: 'error', error: message } : item));
      }
    }
    if (errors.length) throw new Error(errors.join('\n'));
  }
  async function retryContextFile(id: string) {
    const entry = contextOperations.current.get(id); if (!entry) throw new Error('The failed file was not retained after reload. Remove its failed entry and choose the original file again, or paste its readable text.');
    entry.controller.abort(); contextOperations.current.delete(id);
    setPendingContextFiles(previous => previous.filter(item => item.id !== id));
    await addContextFiles([entry.file], id);
  }
  function removePendingContext(id: string) {
    contextOperations.current.get(id)?.controller.abort(); contextOperations.current.delete(id);
    setPendingContextFiles(previous => previous.filter(item => item.id !== id));
  }
  async function addContextText(text: string, kind: 'typed' | 'linkedinPaste' | 'localDictation') {
    let reviewId: string | null = null;
    await asyncMemoryAction(async (current, revision) => {
      const added = await addTextSource(current, text, kind, revision);
      reviewId = added.source.id;
      let next = await createMemoryAssertion(added.project, { sourceId: added.source.id, segmentId: added.source.segments[0].id, text }, added.project.careerMemory!.revision);
      if (kind === 'typed' && next.careerMemory!.draftText === text) next = setMemoryDraft(next, '', next.careerMemory!.revision);
      return next;
    });
    setSourceReviewId(reviewId);
  }
  async function finishContext(defer: boolean) {
    const next = await asyncMemoryAction(async (current, revision) => finishOnboarding(current, defer, revision), false);
    await persist(next); setMemoryDestination(null); setSourceReviewId(null); setStage('template');
    setNotice(defer && (next.careerMemory!.draftText || next.careerMemory!.assertions.some(item => !item.versions.find(version => version.version === item.currentVersion)?.confirmation)) ? 'Your unconfirmed context is saved for later review in Career Memory.' : 'Your original is preserved. Compare the reconstruction before approving it.');
  }
  function memoryUndo(direction: 'undo' | 'redo') {
    const current = projectRef.current; if (!current?.careerMemory) return;
    const from = direction === 'undo' ? memoryPast : memoryFuture, to = direction === 'undo' ? memoryFuture : memoryPast;
    const prior = from.current.pop(); if (!prior) return;
    try {
      const timestamp = new Date().toISOString();
      const next = validateProject({ ...current, revision: current.revision + 1, updatedAt: timestamp, careerMemory: { ...prior, revision: current.careerMemory.revision + 1, updatedAt: timestamp } });
      to.current.push(current.careerMemory); commitMemory(next, false);
    } catch (reason) { from.current.push(prior); setMemoryError(errorMessage(reason)); }
  }
  async function requestGroupRemoval() {
    const current = projectRef.current; if (!current) return;
    try { await persistBeforeSwitch(); setGroupRemoval(await previewGroupRemoval(workspaceOf(current).templateGroupId)); }
    catch (reason) { setMemoryError(errorMessage(reason)); }
  }
  async function purgeGroup() {
    if (!groupRemoval || busy) return;
    setBusy('Removing this resume group'); setError('');
    const ids = groupRemoval.projects.map(item => item.id);
    for (const id of ids) deletingIds.current.add(id);
    operationGeneration.current++; for (const entry of contextOperations.current.values()) entry.controller.abort(); contextOperations.current.clear();
    if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = null; setPendingContextFiles([]);
    try {
      await removeGroup(groupRemoval.templateGroupId, groupRemoval);for(const id of ids)clearJournal(id);setFailedSaves(previous=>previous.filter(id=>!ids.includes(id)));
      const groupId = groupRemoval.templateGroupId;
      operationGeneration.current++; for (const entry of contextOperations.current.values()) entry.controller.abort(); contextOperations.current.clear();
      if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
      history.current.clear(); memoryPast.current = []; memoryFuture.current = [];
      setMemoryDestination(null); setSourceReviewId(null); setPendingContextFiles([]); setGroupRemoval(null);
      const remaining = projects.filter(item => workspaceOf(item).templateGroupId !== groupId);
      setProjects(remaining); setProject(null); projectRef.current = null; savedRef.current = null; setSavedRevision(null);
      if (remaining[0]) openProject(remaining[0], true); else setSaveStatus('saved');
      setNotice('The resume group, Career Memory, supporting originals, and its applications were removed from this device. Downloaded copies are unaffected.');
    } catch (reason) { for (const id of ids) deletingIds.current.delete(id); setError(errorMessage(reason)); } finally { setBusy(''); }
  }
  async function acceptAi(request: AiRequest, result: AiResult, proposal: AiProposal) {
    const current = projectRef.current; if (!current) throw new Error('Open this application before accepting a suggestion.');
    const fingerprint = aiProjectFingerprint(current);
    await probeAiCandidate(current, request, result, proposal);
    const latest = projectRef.current;
    if (!latest || aiProjectFingerprint(latest) !== fingerprint) throw new AiClientError('stale_context');
    let accepted = editBlock(latest, proposal.blockId, reviewedAiRuns(latest, request, result, proposal));
    if (workspaceOf(accepted).kind === 'application') accepted = completedTailoring(accepted, request.requestId);
    mutate(accepted);
    setNotice('Reviewed wording accepted for this application. Inspect page fit and confirm the current PDF before export.');
  }

  async function ingest(file: File, fictional = false) {
    if (busy) return;
    const mine = ++ingestGeneration.current; setBusy('Importing your resume'); setError('');
    try {
      const result = await importResume(file);
      if (mine !== ingestGeneration.current) return;
      let next = initCareerMemory(makeProject(result, fictional));
      if (fictional) next = finishOnboarding(next, true, next.careerMemory!.revision);
      await persistBeforeSwitch(); if (mine !== ingestGeneration.current) return;
      await persist(next);
      if (mine !== ingestGeneration.current) { await removeProject(next.id); setProjects(previous => previous.filter(item => item.id !== next.id)); return; }
      openProject(next, true);
      setNotice(fictional ? 'Fictional sample loaded. All people, employers, and accomplishments in this sample are invented.' : 'Your original file is preserved. Compare the reconstruction before approving it.');
    } catch (reason) { if (mine === ingestGeneration.current) setError(errorMessage(reason)); }
    finally { if (mine === ingestGeneration.current) { setBusy(''); if (fileInput.current) fileInput.current.value = ''; } }
  }
  async function rebuildOriginal() {
    const current = projectRef.current;
    if (!current || busy || recoveryInFlight.current) return;
    const generation = operationGeneration.current;
    recoveryInFlight.current = true;
    setBusy('Rebuilding from the retained original'); setError('');
    try {
      await persistBeforeSwitch();
      const next = await rebuildFromOriginal(current);
      if (projectRef.current?.id !== current.id || projectRef.current.revision !== current.revision) {
        throw new Error('The open resume changed while rebuilding. Rebuild again from its current saved version.');
      }
      await persist(next);
      if (generation !== operationGeneration.current || projectRef.current?.id !== current.id || projectRef.current.revision !== current.revision) {
        setNotice('Your rebuilt copy is saved in the library. Open it there when you are ready.');
        return;
      }
      openProject(next, true);
      setNotice('A separate reconstruction is ready for review. Your previous draft, applications and Career Memory remain in the original resume group.');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { recoveryInFlight.current = false; setBusy(''); }
  }
  // The landing page's "Try a sample" link opens /app?sample=1.
  const [sampleRequested, setSampleRequested] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('sample') === '1'; } catch { return false; }
  });
  useEffect(() => {
    if (!sampleRequested) return;
    const url = new URL(window.location.href); url.searchParams.delete('sample');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    const timer = window.setTimeout(() => { setSampleRequested(false); void loadSample(); }, 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleRequested]);
  async function loadSample() {
    if (busy) return;
    setBusy('Loading fictional sample'); setError('');
    try { const response = await fetch(`${import.meta.env.BASE_URL}fixtures/fictional-resume.pdf`); if (!response.ok) throw new Error('The fictional sample is unavailable. Upload a PDF or DOCX to get started.'); const blob = await response.blob(); setBusy(''); await ingest(new File([blob], 'Casey-Rowan-fictional-sample.pdf', { type: 'application/pdf' }), true); }
    catch (reason) { setError(errorMessage(reason)); setBusy(''); }
  }
  async function restore(file: File) {
    setBusy('Restoring project'); setError('');
    try {
      await persistBeforeSwitch();
      const restored = await restoreBackup(file);
      if(restored.kind==='archive'){
        setLegacyArchives(await loadLegacyArchives());setSidebarOpen(true);setSurface('studio');if(resumeLibrary.current)resumeLibrary.current.open=true;
        setNotice('Earlier backup preserved unchanged. Review its saved text in the library, then rebuild a separate layout from the retained original. Its earlier fonts do not have the proof required for current rendering.');
      } else if (restored.kind === 'group') {
        const next = restored.projects.find(item => workspaceOf(item).kind === 'resume') ?? restored.projects[0];
        const saved = await loadLibrary(); setProjects(saved.projects); setUnavailableProjects(saved.unavailable);
        openProject(next, true); setMemoryDestination(null);
        setNotice('Resume group restored as a separate copy with new identities. Inspect its template and evidence before export.');
      } else {
        await persist(restored.project); openProject(restored.project, true); setMemoryDestination(null);
        setNotice('Project restored as a separate copy. Existing application-only notes remain outside Career Memory.');
      }
    }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(''); if (restoreInput.current) restoreInput.current.value = ''; }
  }
  async function recoverSavedRecord(item: UnavailableProject) {
    setBusy('Preparing recovery data'); setError('');
    try { download(await backupUnavailableProject(item.key), `${safeName(item.name)}.recovery.zip`); setNotice('Recovery data downloaded. The saved record remains unchanged; this file needs repair before it can be restored.'); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(''); }
  }
  async function rebuildVerifiedOriginal(load:()=>Promise<VerifiedOriginal>){
    if(busy||recoveryInFlight.current)return;recoveryInFlight.current=true;setBusy('Rebuilding the retained original');setError('');
    const generation=operationGeneration.current;
    try{await persistBeforeSwitch();const original=await load(),imported=await importResume(original.file);if(imported.source.sha256!==original.sha256)throw new Error('The rebuilt original failed its checksum. The earlier data remains unchanged.');const fresh={...initCareerMemory(makeProject(imported)),name:`${original.name.slice(0,488)} · Rebuilt`};await persist(fresh);if(generation===operationGeneration.current)openProject(fresh,true);setNotice('A separate unapproved layout is ready. Earlier drafts, history and context remain unchanged; review the new layout before editing.');}
    catch(reason){setError(errorMessage(reason));}finally{recoveryInFlight.current=false;setBusy('');}
  }
  async function downloadArchived(archive:LegacyArchiveSummary){try{download(await downloadLegacyArchive(archive.id),archive.name);setNotice('The exact original backup was downloaded.');}catch(reason){setError(errorMessage(reason));}}
  async function backup(target?: Project) {
    const current = target ?? projectRef.current; if (!current) return;
    try {
      if (workspaceOf(current).kind === 'resume') {
        const groupId = workspaceOf(current).templateGroupId;
        const saved = await loadLibrary();
        const live = projectRef.current;
        const group = [current, ...saved.projects.filter(item => item.id !== current.id && workspaceOf(item).templateGroupId === groupId)].map(item => live?.id === item.id ? live : item);
        download(await backupResumeGroup(group), `${safeName(current.name)}.folio-group.zip`);
        setNotice('Resume group backup downloaded with Career Memory, supporting originals, and all saved applications.');
      } else {
        download(await backupProject(current), `${safeName(current.name)}.folio.zip`);
        setNotice(workspaceOf(current).kind === 'application' ? 'Application backup downloaded with its pinned evidence snapshot. Supporting originals stay in the reusable resume group.' : 'Project backup downloaded with its original, current draft and job-only notes.');
      }
    } catch (reason) { setError(errorMessage(reason)); }
  }
  async function promoteNote(factId: string) {
    const application = projectRef.current;
    if (!application || workspaceOf(application).kind !== 'application') return;
    const resume = projects.find(item => workspaceOf(item).kind === 'resume' && workspaceOf(item).templateGroupId === workspaceOf(application).templateGroupId);
    if (!resume) { setError('The reusable resume was removed. Restore its group backup to save reusable context.'); return; }
    try {
      await persistBeforeSwitch();
      const initialized = initCareerMemory(resume);
      if (initialized !== resume) await persist(initialized);
      const next = await promoteCareerNote(initialized, application, factId, initialized.careerMemory!.revision);
      await persist(next); openProject(next, true); setMemoryDestination('editor'); setMemoryFromSnapshot(application.memorySnapshot);
      setNotice('Application note copied into an unconfirmed Career Memory candidate. Review and confirm its exact wording for future applications.');
    } catch (reason) { setError(errorMessage(reason)); }
  }
  async function prepareApplication(job: JobContext) {
    if (!applicationSource || createInFlight.current) return;
    createInFlight.current = true; setBusy('Saving new application'); setApplicationError('');
    try {
      await persistBeforeSwitch();
      const source = projectRef.current?.id === applicationSource.id ? projectRef.current : applicationSource;
      const initialized = initCareerMemory(source);
      if (initialized !== source) { await persist(initialized); if (projectRef.current?.id === source.id) { setProject(initialized); projectRef.current = initialized; } }
      let next = await createSavedApplication(initialized, job);
      const committedRevision = next.revision;
      const names = projects.filter(item => workspaceOf(item).templateGroupId === workspaceOf(source).templateGroupId).map(item => item.name);
      if (next.name === 'Untitled application') next = renameApplication(next, `Application ${names.length}`);
      const baseName = next.name; let suffix = 2;
      while (names.includes(next.name)) { const ending = ` (${suffix++})`; next = renameApplication(next, `${baseName.slice(0, 500 - ending.length)}${ending}`); }
      if (next.revision !== committedRevision) await persist(next);
      else setProjects(previous => [next, ...previous.filter(item => item.id !== next.id)]);
      openProject(next, true); setStage('review'); setMobilePane('document');
      setApplicationSource(null); setNotice('New application saved from the approved source wording. Local matching uses only this application’s supplied facts.');
    } catch (reason) { setApplicationError(errorMessage(reason)); }
    finally { createInFlight.current = false; setBusy(''); }
  }
  async function recoverTemplate() {
    const current = projectRef.current; if (!current || busy || recoveryInFlight.current) return;
    recoveryInFlight.current = true;
    setBusy('Recovering readable content'); setError('');
    try {
      const next = await recoverApproximate(current);
      if (projectRef.current?.id !== current.id || projectRef.current.revision !== current.revision) throw new Error('The resume changed during recovery. Inspect the current template and try again.');
      mutate(next); setAcknowledged([]); setPage(1); setSelectedRegion(firstRegion(next));
      setNotice('APPROXIMATE recovery created. Compare every section with your preserved original and review all observations before approval.');
    } catch (reason) { setError(errorMessage(reason)); } finally { recoveryInFlight.current = false; setBusy(''); }
  }
  async function deleteResume(target: Project) {
    const current = projectRef.current;
    const removingCurrent = current?.id === target.id;
    deletingIds.current.add(target.id);
    if (removingCurrent) {
      operationGeneration.current++; for (const entry of contextOperations.current.values()) entry.controller.abort(); contextOperations.current.clear();
      setPendingContextFiles([]); setMemoryDestination(null); setSourceReviewId(null);
      memoryPast.current = []; memoryFuture.current = []; history.current.clear();
      if (autosaveTimer.current !== null) window.clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null; projectRef.current = null; setProject(null);
    }
    setBusy('Removing local resume');
    try {
      await removeProject(target.id);clearJournal(target.id);setFailedSaves(previous=>previous.filter(id=>id!==target.id));
      const remaining = projects.filter(item => item.id !== target.id);
      setProjects(previous => previous.filter(item => item.id !== target.id));
      if (removingCurrent && !projectRef.current) {
        if (remaining.length) openProject(remaining[0], true);
        else { savedRef.current = null; setSavedRevision(null); setSaveStatus('saved'); setStage('template'); history.current.clear(); }
      }
      setDeleteTarget(null); setNotice(workspaceOf(target).kind === 'application' ? 'Application removed. Other saved drafts remain on this device.' : 'Reusable resume removed. Any separate saved applications remain on this device.');
    } catch (reason) {
      deletingIds.current.delete(target.id);
      if (removingCurrent && current && !projectRef.current) openProject(current, false);
      setError(errorMessage(reason));
    } finally { setBusy(''); }
  }
  async function approve() {
    if (!project) return;
    if (!templatePreviewsComplete()) { setStage('template');  setError('Wait for both previews and inspect every page before approving this template.'); return; }
    setBusy('Approving template');
    try { const expected = project.revision; const reuseHashes=documentScopedProgramHashes(project.template),reuseOwner=fontReuseOwner(project);if(reuseHashes.length&&fontReuseChoiceRef.current!==reuseOwner)throw new Error('Confirm permission to reuse the fonts for this source.');const approved = await approveTemplate(project, project.template.warnings.filter(warning => warning.severity === 'review').map(warning => warning.id),reuseHashes.length?{accepted:true,sourceSha256:project.source.sha256,originalProgramSha256s:reuseHashes}:undefined);if(reuseHashes.length&&(fontReuseChoiceRef.current!==reuseOwner||!projectRef.current||fontReuseOwner(projectRef.current)!==reuseOwner))throw new Error('The font reuse choice changed during approval. Review the current source again.'); if (projectRef.current?.revision !== expected || projectRef.current.id !== project.id) throw new Error('The project changed during approval. Compare it again.'); if (!templatePreviewsComplete()) throw new Error('A comparison preview changed during approval. Inspect every page again.'); mutate(approved); setStage('job'); setSurface('compose'); setNotice('Template approved. Add the role you’re applying for.'); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(''); }
  }
  function match() { if (!project) return; if (!project.job.description.trim()) { setError('Paste a job description to find relevant evidence.'); return; } setMatching(matchProject(project)); setVisibleEvidenceCount(12); setStage('review'); setMobilePane('details'); setNotice('Local matching ranked the facts you supplied. Review exact evidence before inserting it.'); }
  function acceptEvidence() {
    const current = projectRef.current;
    if (!current || !pendingEvidence || !selectedRegion) return;
    const region = current.template.pages.flatMap(item => item.regions).find((item): item is TextRegion => item.kind === 'text' && item.id === selectedRegion);
    if (!region) return;
    try { const next = insertEvidence(current, pendingEvidence.factId, region.contentId); mutate(next); setPendingEvidence(null); setNotice('Exact source evidence inserted into the selected paragraph. Review the page fit.'); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  async function exportPdf(filename?:string) {
    if (exportInFlight.current) return;
    const current = projectRef.current; if (!current || !draftRender) return;
    if (composition) { setError('Finish entering text before downloading.'); return; }
    if (!canvasReviewCurrent(canvasCheck, current, draftRender)) { setError('Open the editable canvas and wait for the current line layout check.'); return; }
    if (layoutIssues.length) { setError('Canvas and PDF line layout need review before export. Shorten the affected paragraph or use supported formatting.'); return; }
    if (!currentPdfPreviewComplete()) { setView('pdf'); setStage('review'); setError('Review every page of the current PDF before downloading.'); return; }
    exportInFlight.current = true;
    if (autosaveTimer.current !== null) { window.clearTimeout(autosaveTimer.current); autosaveTimer.current = null; }
    setBusy('Preparing PDF download'); setError('');
    try {
      await Promise.allSettled([...pendingWrites.current]);
      await validateExport(current, draftRender); const checkpoint=workspaceOf(current).kind==='application'?saveVersion(current,'download'):current; await persist(structuredClone(current));
      const live = projectRef.current;
      if (!live || live.id !== current.id || live.revision !== current.revision || live.draft.revision !== draftRender.contentRevision) throw new Error('The draft changed while preparing the download. Review the current revision.');
      if (!currentPdfPreviewComplete()) throw new Error('The PDF preview changed while preparing the download. Review every current page again.');
      const name=`${filename?safeName(filename.replace(/\.pdf$/i,'')):defaultResumeFileName(current)}.pdf`;
      download(new Blob([new Uint8Array(draftRender.bytes)], { type: 'application/pdf' }), name);setDownloadedName(name);setDownloadSettings(false);
      if (checkpoint !== current) {
        try {
          await persist(checkpoint, { optionalHistory: true });
          if (projectRef.current?.id === current.id && projectRef.current.revision === current.revision) {
            projectRef.current = checkpoint; setProject(checkpoint);
            savedRef.current = { id: checkpoint.id, revision: checkpoint.revision };
            setSavedRevision(checkpoint.revision); setSaveStatus('saved');
          }
        } catch (reason) {
          setError(`PDF download started, but its history entry was not saved. Your current draft and earlier versions remain saved on this device. ${errorMessage(reason)}`);
        }
      }
      setNotice('PDF downloaded from the exact current preview. Start a new tailoring when you are ready.');
    } catch (reason) { setError(errorMessage(reason)); } finally { exportInFlight.current = false; setBusy(''); }
  }
  function cancelImport() { ingestGeneration.current++; setBusy(''); setNotice('Reading cancelled. No late import will replace your open resume.'); }
  async function newTailoring(text = '') {
    if (!beginComposerNavigation()) return;
    const request = ++composerNavigation.current;
    try {
      await persistBeforeSwitch();
      if (request !== composerNavigation.current) return;
      explicitSelectionRef.current = null; setExplicitSelection(null);
      if (request !== composerNavigation.current) return;
      composerGeneration.current++; if (composerTimer.current) clearTimeout(composerTimer.current);
      composerDraftId.current = null; composerTextRef.current = text; setComposerText(text); setComposerConsent(false); setTailorError('');
      composerDetailsRef.current = { title: '', company: '' }; setComposerDetails(composerDetailsRef.current);
      setSettings(false); setMemoryDestination(null); setSurface('compose'); setSidebarOpen(false);
      if (text) composerTimer.current = setTimeout(() => void saveComposer().catch(reason => setTailorError(errorMessage(reason))), 350);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { endComposerNavigation(); }
  }
  function beginComposerNavigation() {
    if (busy || exportInFlight.current || composerNavigationPending.current) return false;
    composerNavigationPending.current = true; setComposerNavigating(true); return true;
  }
  function endComposerNavigation() { composerNavigationPending.current = false; setComposerNavigating(false); }
  function sourceForMemory() {
    const current = projectRef.current;
    if (current && workspaceOf(current).kind === 'resume') return current;
    return projects.find(item => workspaceOf(item).kind === 'resume' && (!current || workspaceOf(item).templateGroupId === workspaceOf(current).templateGroupId)) ?? projects.find(item => workspaceOf(item).kind === 'resume');
  }
  function openPrivacy() {
    if (exportInFlight.current || composerNavigationPending.current) return;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    privacyOpener.current = active?.closest('.folio-account')?.querySelector<HTMLElement>('.folio-account-trigger') ?? active;
    privacyStartedAtIntake.current = !projectRef.current && surface === 'studio';
    setSidebarOpen(false); setSettings(true);
  }
  function closePrivacy() {
    const returnToIntake = privacyStartedAtIntake.current && !projectRef.current;
    setSettings(false); setMemoryDestination(null); setSurface(returnToIntake ? 'studio' : 'compose');
    if (returnToIntake) window.requestAnimationFrame(() => intakePrivacyButton.current?.focus());
    else if (mobileViewport) window.requestAnimationFrame(() => libraryOpener.current?.focus());
  }
  async function closeCareerMemory() {
    const current = projectRef.current;
    const owner = renderedRouteOwner;
    if (!current || owner !== routeEpoch.current) return;
    const ownsRoute = () => owner === routeEpoch.current && projectRef.current?.id === current.id;
    try {
      if (current.careerMemory?.onboarding === 'contextPending') {
        await asyncMemoryAction(async (resume, revision) => finishOnboarding(resume, true, revision), false);
        if (!ownsRoute()) return;
      }
      await persistBeforeSwitch();
      if (!ownsRoute()) return;
      setMemoryDestination(null); setSourceReviewId(null); setSurface('compose');
      const destination = routeEpoch.current;
      window.requestAnimationFrame(() => {
        if (destination !== routeEpoch.current || projectRef.current?.id !== current.id) return;
        if (mobileViewport) libraryOpener.current?.focus(); else document.getElementById('ws-h')?.focus();
      });
    } catch (reason) { if (ownsRoute()) throw reason; }
  }
  async function openHome() {
    let owner = renderedRouteOwner;
    if (owner !== routeEpoch.current || !beginComposerNavigation()) return;
    const request = ++composerNavigation.current;
    const ownsRoute = () => request === composerNavigation.current && owner === routeEpoch.current;
    try {
      await persistBeforeSwitch(true, publication => {
        if (publication.from === owner && publication.to === routeEpoch.current) owner = publication.to;
      });
      if (!ownsRoute()) return;
      setSettings(false); setMemoryDestination(null); setSurface('home'); setSidebarOpen(false);
    } catch (reason) { if (ownsRoute()) setError(errorMessage(reason)); }
    finally { if (request === composerNavigation.current) endComposerNavigation(); }
  }
  function openCareerContext(view: 'roles' | 'context' = 'roles') {
    const source = sourceForMemory();
    if (!source) { fileInput.current?.click(); return; }
    setRequestedMemoryView(value => ({ view, request: value.request + 1 }));
    void openMemory(source);
    setSidebarOpen(false);
  }
  async function openHistory() {
    let owner = renderedRouteOwner;
    if (owner !== routeEpoch.current || !beginComposerNavigation()) return;
    const request = ++composerNavigation.current;
    const ownsRoute = () => request === composerNavigation.current && owner === routeEpoch.current;
    try {
      await persistBeforeSwitch(true, publication => {
        // Only the creation begun by this route may carry ownership across
        // its own synchronous project/compose publication. Never reacquire
        // the current route after another user navigation, including ABA.
        if (publication.from === owner && publication.to === routeEpoch.current) owner = publication.to;
      });
      if (!ownsRoute()) return;
      setSettings(false); setMemoryDestination(null); setSurface('history'); setSidebarOpen(false);
      const destination = routeEpoch.current;
      window.requestAnimationFrame(() => {
        if (request === composerNavigation.current && destination === routeEpoch.current) document.getElementById('ws-h')?.focus();
      });
    } catch (reason) { if (ownsRoute()) setError(errorMessage(reason)); }
    finally { if (request === composerNavigation.current) endComposerNavigation(); }
  }
  async function openTemplates() {
    if (!beginComposerNavigation()) return;
    try { await persistBeforeSwitch(); setSettings(false); setMemoryDestination(null); setSurface('templates'); setSidebarOpen(false); setResumeChooserOpen(false); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { endComposerNavigation(); }
  }
  async function chooseDefaultResume(target: Project) {
    if (!beginComposerNavigation()) throw new Error('Wait for the current save or navigation to finish.');
    const request = ++composerNavigation.current;
    try {
      await persistBeforeSwitch();
      if (composerCreating.current) await composerCreating.current;
      if (request !== composerNavigation.current) throw new Error('Navigation changed before the default could be saved.');
      const current = projectRef.current?.id === target.id ? projectRef.current : projectsRef.current.find(item => item.id === target.id);
      if (!current || !hasValidApproval(current)) throw new Error('This reusable resume is unavailable or needs current approval.');
      const revision = current.revision;
      const preference = await defaultResumePreference(current);
      const expected = await loadDefaultResume();
      const stillOwned = () => {
        const live = projectRef.current?.id === current.id ? projectRef.current : projectsRef.current.find(item => item.id === current.id);
        return request === composerNavigation.current && !exportInFlight.current && !!live && live.revision === revision && hasValidApproval(live) && preferenceMatches(live, preference);
      };
      if (!stillOwned()) throw new Error('The chosen layout changed before saving. Review its current version.');
      const saved = await commitDefaultResume(preference, expected, stillOwned);
      defaultResumeRef.current = saved; setDefaultResume(saved);
      defaultResumeErrorRef.current = ''; setDefaultResumeError('');
      defaultResumeReadyRef.current = true; setDefaultResumeReady(true);
      explicitSelectionRef.current = null; setExplicitSelection(null); setComposerConsent(false);
      setNotice('Default saved for fresh tailorings. Existing drafts keep their layout and evidence snapshot. Earlier source choices remain saved.');
    } catch (reason) { setError(errorMessage(reason)); throw reason; }
    finally { endComposerNavigation(); }
  }
  function inspectionOwnerKey(value: Project | null) {
    if (!value) return null;
    const workspace = workspaceOf(value);
    return JSON.stringify([value.id, value.revision, value.source.sha256, value.template.id,
      value.template.revision, value.baseline.revision, value.draft.revision,
      workspace.kind, workspace.templateGroupId]);
  }
  async function inspectLayout(target: Project, closeChooser = false): Promise<boolean> {
    // Inspect never changes destination based on switchProject's fulfilled
    // promise: that frozen function also resolves on refusal/save failure.
    const route = renderedRouteOwner;
    if (route !== routeEpoch.current) return false;
    const origin = projectRef.current;
    if (surface === 'compose' && composerTextRef.current.trim() &&
      (!origin || origin.id !== composerDraftId.current || origin.job.description !== composerTextRef.current || origin.job.title !== composerDetailsRef.current.title || origin.job.company !== composerDetailsRef.current.company || composerCreating.current)) {
      setError('Wait for the current job draft to finish saving before inspecting a layout. Your job remains open.');
      return false;
    }
    if (!beginComposerNavigation()) return false;
    const request = ++composerNavigation.current;
    const targetOwner = inspectionOwnerKey(target), originOwner = inspectionOwnerKey(origin);
    const generation = operationGeneration.current, sequence = switchSequence.current;
    try {
      // The pending job text was checked above; do not create/open a new
      // application as a side effect of an inspection that may be refused.
      await persistBeforeSwitch(false);
      if (request !== composerNavigation.current || exportInFlight.current || generation !== operationGeneration.current ||
        sequence !== switchSequence.current || inspectionOwnerKey(projectRef.current) !== originOwner ||
        route !== routeEpoch.current) return false;
      const live = projectRef.current?.id === target.id ? projectRef.current : projectsRef.current.find(item => item.id === target.id);
      if (!live || deletingIds.current.has(live.id) || inspectionOwnerKey(live) !== targetOwner) {
        setError('The requested resume or revision changed before inspection. The current workspace remains open.');
        return false;
      }
      if (projectRef.current?.id !== live.id) openProject(live, !failedSaves.includes(live.id));
      // No destination/chooser transition occurs until the requested complete
      // source/template/content owner is actually the current owned record.
      if (request !== composerNavigation.current || exportInFlight.current || inspectionOwnerKey(projectRef.current) !== targetOwner) return false;
      setSettings(false); setSurface('studio'); setStage('template'); setMemoryDestination(null); setSidebarOpen(false);
      if (closeChooser) setResumeChooserOpen(false);
      return true;
    } catch (reason) { setError(errorMessage(reason)); return false; }
    finally { if (request === composerNavigation.current) endComposerNavigation(); }
  }
  function sourceForComposer() {
    return composerBridgeSource(projectsRef.current, projectRef.current, composerDraftId.current,
      defaultResumeRef.current, explicitSelectionRef.current, defaultResumeReadyRef.current,
      defaultResumeErrorRef.current, composerPreferencesRef.current);
  }
  async function rememberComposerSource(id: string) {
    const generation = operationGeneration.current, currentProjectId = projectRef.current?.id ?? null;
    const target = projectRef.current?.id === id ? projectRef.current : projectsRef.current.find(item => item.id === id);
    if (!target || !hasValidApproval(target)) throw new Error('Choose a currently approved reusable resume.');
    const revision = target.revision;
    const preference = await defaultResumePreference(target);
    const live = projectRef.current?.id === id ? projectRef.current : projectsRef.current.find(item => item.id === id);
    if (generation !== operationGeneration.current || (projectRef.current?.id ?? null) !== currentProjectId || !live || live.revision !== revision || !hasValidApproval(live) || !preferenceMatches(live, preference)) throw new Error('This resume or workspace changed during selection. Review its current layout.');
    explicitSelectionRef.current = preference; setExplicitSelection(preference);
    // Attempt-local choice; historical legacy preferences remain untouched.
  }
  async function makeComposerDefault(source: Project) {
    try { await chooseDefaultResume(source); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  async function selectComposerSource(source: Project) {
    if (!hasValidApproval(source) || !beginComposerNavigation()) return;
    const request = ++composerNavigation.current;
    let prior: { draftId: string | null; selection: DefaultResumePreference | null; consent: boolean; projectId: string | null; projectRevision: number | null; text: string } | null = null;
    try {
      const text = composerTextRef.current;
      const currentSource = sourceForComposer();
      if (sameComposerTemplate(currentSource, source)) { setResumeChooserOpen(false); return; }
      await persistBeforeSwitch();
      if (request !== composerNavigation.current) return;
      prior = { draftId: composerDraftId.current, selection: explicitSelectionRef.current, consent: composerConsent, projectId: projectRef.current?.id ?? null, projectRevision: projectRef.current?.revision ?? null, text };
      await rememberComposerSource(source.id);
      if (request !== composerNavigation.current) return;
      composerGeneration.current++; if (composerTimer.current) clearTimeout(composerTimer.current);
      composerDraftId.current = null; composerTextRef.current = text; setComposerText(text); setComposerConsent(false); setTailorError('');
      if (text.trim()) {
        const created = await saveComposer();
        if (!created) throw new Error('The chosen resume changed before a new draft could be saved. Review the current source; your earlier record remains.');
      }
      if (request !== composerNavigation.current) return;
      setResumeChooserOpen(false); setSettings(false); setSurface('compose'); setSidebarOpen(false);
    } catch (reason) {
      // Failed creation leaves the previous draft/binding intact. Never delete
      // another record or restore over a newer navigation.
      if (prior && request === composerNavigation.current && (projectRef.current?.id ?? null) === prior.projectId && (projectRef.current?.revision ?? null) === prior.projectRevision) {
        composerGeneration.current++; if (composerTimer.current) clearTimeout(composerTimer.current);
        composerDraftId.current = prior.draftId; explicitSelectionRef.current = prior.selection; setExplicitSelection(prior.selection);
        composerTextRef.current = prior.text; setComposerText(prior.text); setComposerConsent(prior.consent);
      }
      setError(errorMessage(reason));
    } finally { endComposerNavigation(); }
  }
  async function saveComposer(onPublication?: (publication: ComposerPublication) => void): Promise<Project | null> {
    if (composerCreating.current) {
      const completed = await composerCreating.current;
      if (completed?.publication) onPublication?.(completed.publication);
      // A saved creation that lost its UI route still belongs in the library.
      // Do not create another draft or reopen it over the newer destination.
      if (completed && !completed.publication) return completed.project;
      return saveComposer(onPublication);
    }
    const mine = composerGeneration.current, text = composerTextRef.current;
    if (!text.trim()) return null;
    const current = projectRef.current;
    if (current && current.id === composerDraftId.current) {
      const details = composerDetailsRef.current;
      const next = current.job.description === text && current.job.title === details.title && current.job.company === details.company ? current : setJob(current, { ...details, description: text });
      if (next !== current) mutate(next);
      await persist(structuredClone(next)); return projectRef.current?.id === next.id ? projectRef.current : null;
    }
    const source = sourceForComposer(); if (!source) return null;
    const owner = routeEpoch.current;
    const creating = (async (): Promise<ComposerCreation | null> => {
      await persistBeforeSwitch(false); const initialized = initCareerMemory(source);
      if (initialized !== source) await persist(initialized);
      let next = await createApplication(initialized, { ...composerDetailsRef.current, description: composerTextRef.current });
      if (mine !== composerGeneration.current || !composerTextRef.current.trim()) return null;
      next = setPresentation(next, { state: 'draft', historyKnown: true });
      await persist(next);
      if (mine !== composerGeneration.current || !composerTextRef.current.trim()) { deletingIds.current.add(next.id); await removeProject(next.id); setProjects(previous => previous.filter(item => item.id !== next.id)); return null; }
      composerDraftId.current = next.id;
      let publication: ComposerPublication | null = null;
      if (owner === routeEpoch.current) {
        openProject(next, true); setSurface('compose'); setInsightsOpen(false);
        publication = { from: owner, to: routeEpoch.current };
      }
      return { project: next, publication };
    })();
    composerCreating.current = creating;
    try { const completed = await creating; if (completed?.publication) onPublication?.(completed.publication); return completed?.project ?? null; } finally { if (composerCreating.current === creating) composerCreating.current = null; }
  }
  function composerDetailsChange(details: { title: string; company: string }) {
    composerDetailsRef.current = details; setComposerDetails(details);
    composerChange(composerTextRef.current);
  }
  function composerChange(text: string) {
    composerTextRef.current = text; setComposerText(text); setComposerConsent(false); setTailorError('');
    if (composerTimer.current) clearTimeout(composerTimer.current);
    if (!text.trim()) {
      composerGeneration.current++;
      const current = projectRef.current;
      if (current?.id === composerDraftId.current && !current.folio?.completions.length && current.draft.revision === current.baseline.revision) {
        composerDraftId.current = null; deletingIds.current.add(current.id);
        if (autosaveTimer.current !== null) {clearTimeout(autosaveTimer.current);autosaveTimer.current=null;}
        projectRef.current=null;setProject(null);savedRef.current=null;
        void removeProject(current.id).then(() => { setProjects(previous => previous.filter(item => item.id !== current.id)); if (projectRef.current?.id === current.id) { projectRef.current = null; setProject(null); } }).catch(reason => { deletingIds.current.delete(current.id); openProject(current); composerDraftId.current=current.id; setSurface('compose'); setTailorError(errorMessage(reason)); });
      }
      return;
    }
    composerTimer.current = setTimeout(() => { void saveComposer().catch(reason => setTailorError(errorMessage(reason))); }, 350);
  }
  async function startTailoring() {
    if (tailoringOperation.current || composerNavigationPending.current) return;
    if(sourceForComposer()?.template.sourceType1Baseline){setTailorError('Full job tailoring is unavailable for this Type 1 source. Use its marked manual editing capability where available, or upload a DOCX or a PDF using supported editable fonts.');return;}
    const consent=composerConsent,description=composerTextRef.current,details={...composerDetailsRef.current};setTailorError(''); const controller = new AbortController(); tailoringOperation.current = controller;setBusy('Reading the job');
    try {
      const current = await saveComposer(); if (!current || controller.signal.aborted) return;
      if(current.job.description!==description||composerTextRef.current!==description||current.job.title!==details.title||current.job.company!==details.company||composerDetailsRef.current.title!==details.title||composerDetailsRef.current.company!==details.company)throw new Error('The job changed before transfer. Review it and allow the exact request again.');
      const generation = operationGeneration.current, revision = current.revision;
      setBusy('Reading the job');
      const result = await runTailoring(structuredClone(current), consent, controller.signal, setBusy);
      if (controller.signal.aborted || generation !== operationGeneration.current || projectRef.current?.id !== current.id || projectRef.current.revision !== revision) return;
      await persist(result.project);
      if (controller.signal.aborted || generation !== operationGeneration.current || projectRef.current?.id!==current.id) { setNotice('The completed tailoring is saved in history.'); return; }
      openProject(result.project, true); setStage('review'); setInsightsOpen(false); setSurface('studio');
      setNotice(`${result.applied} supported changes applied${result.held ? ` · ${result.held} suggestions kept out for source review` : ''}. Review your wording and original page fit.`);
    } catch (reason) { if (!controller.signal.aborted) setTailorError(errorMessage(reason)); }
    finally { if (tailoringOperation.current === controller) { tailoringOperation.current = null; setBusy(''); } }
  }
  function cancelTailoring() { tailoringOperation.current?.abort(); tailoringOperation.current = null; setBusy(''); setTailorError('Tailoring cancelled. Your job and saved draft remain.'); }
  async function openTailoring(next: Project) {
    await switchProject(next);
    const current = projectRef.current;
    if (!current || current.id !== next.id) return;
    setMemoryDestination(null);if(failedSaves.includes(current.id)){savedRef.current=null;setSaveStatus('error');setError('Not saved. Recovered job content is open; retry saving or download its backup.');}
    if (current.folio?.state === 'draft' && !current.folio.completions.length || !current.folio && current.reviewedDraftRevision !== current.draft.revision) {
      composerDraftId.current = current.id; composerTextRef.current = current.job.description; setComposerText(current.job.description); composerDetailsRef.current = { title: current.job.title, company: current.job.company }; setComposerDetails(composerDetailsRef.current); setComposerConsent(false); setTailorError(''); setSurface('compose');
    } else { setSurface('studio'); setStage('review'); setInsightsOpen(true); }
  }
  async function openDraftEditor() {
    if (!beginComposerNavigation()) return;
    let owner = routeEpoch.current;
    try {
      const current = await saveComposer(publication => { if (owner === publication.from) owner = publication.to; });
      if (owner !== routeEpoch.current || !current || projectRef.current?.id !== current.id || workspaceOf(current).kind !== 'application') return;
      setSurface('studio'); setStage('review'); setInsightsOpen(true); setMemoryDestination(null);
      setMatching(matchProject(current)); setNotice('Your draft is ready. Check it against the job, then download.');
    } catch (reason) { setTailorError(errorMessage(reason)); }
    finally { endComposerNavigation(); }
  }
  function decideMany(ids: string[], decision: 'accepted' | 'rejected') {
    const current = projectRef.current; if (!current) return;
    try { mutate(decideChanges(current, ids, decision)); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  function decideChange(id: string, decision: 'accepted' | 'rejected') { decideMany([id], decision); }
  function updateCurrent(change: (current: Project) => Project, group = '') {
    const current = projectRef.current; if (!current) return;
    try { mutate(change(current), group); } catch (reason) { setError(errorMessage(reason)); }
  }
  function selectReviewBlock(id: string) {
    const current = projectRef.current;
    const index = current?.template.pages.findIndex(item => item.regions.some(region => region.kind === 'text' && region.contentId === id)) ?? -1;
    const region = current?.template.pages[index]?.regions.find(region => region.kind === 'text' && region.contentId === id);
    if (region) { setSelectedRegion(region.id); setPage(index + 1); }
  }
  function showClaimConfirmation() {
    setInsightTab('changes'); setInsightsOpen(true); setMobilePane('details');
    requestAnimationFrame(() => {
      const section = document.querySelector<HTMLElement>('.final-review');
      const disclosure = section?.closest('details'); if (disclosure) disclosure.open = true;
      section?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      section?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
    });
  }
  function resolveReadiness(action: ReadinessAction) {
    const current = projectRef.current; if (!current) return;
    if (action.kind === 'save') { void persist(structuredClone(current)).catch(() => {}); return; }
    if (action.kind === 'download') { guidedDownload(); return; }
    if (action.kind === 'template') { setStage('template'); setMobilePane('document'); return; }
    if (action.kind === 'claims') { showClaimConfirmation(); return; }
    if (action.kind === 'sources') { selectReviewBlock(action.blockId); setInsightTab('changes'); setInsightsOpen(true); setMobilePane('details'); return; }
    setStage('review'); setMobilePane('document');
    if (action.kind === 'pdf') {
      if (!canvasReviewCurrent(canvasCheck, current, draftRender) || renderStatus !== 'ready' || composition) {
        setView('canvas'); setNotice('Wait for the current canvas check, then choose Review PDF.');
      } else { setView('pdf'); if (mobileViewport) setInsightsOpen(false); }
      return;
    }
    setView('canvas'); if (mobileViewport) setInsightsOpen(false);
    if (action.kind === 'region') {
      setSelectedRegion(action.regionId);
      const index = current.template.pages.findIndex(item => item.id === action.pageId);
      if (index >= 0) setPage(index + 1);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-region-id="${CSS.escape(action.regionId)}"]`)?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }));
    }
  }
  function restoreContentVersion(id: string) {
    const current = projectRef.current; if (!current?.folio) return;
    const version = current.folio.versions.find(item => item.id === id); if (!version) return;
    try { let next = current; for (const block of version.content.blocks) next = editBlock(next, block.id, structuredClone(block.runs));
    mutate(saveVersion(next, 'restored')); setNotice('Version restored as a new editable version. Inspect its claims and fit.'); } catch (reason) {setError(errorMessage(reason));}
  }

  function drop(event: DragEvent) { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) void ingest(file); }
  const approved = project ? hasValidApproval(project) : false;
  const allRegions = project?.template.pages.flatMap(item => item.regions).filter((item): item is TextRegion => item.kind === 'text') ?? [];
  const selected = allRegions.find(region => region.id === selectedRegion);
  const selectedBlock = project?.draft.blocks.find(block => block.id === selected?.contentId);
  const changes = project ? changedParagraphs(project) : [];
  const unprovedEdits = project ? sourceReviewIssues(project) : [];
  const issues = project ? exportProblems(project, draftRender) : [];
  const overflow = draftRender && draftRender.contentRevision === project?.draft.revision ? draftRender.layout.overflows : [];
  const canvasCheckCurrent = canvasReviewCurrent(canvasCheck, project, draftRender);
  const fitReady = !!draftRender && draftRender.contentRevision === project?.draft.revision && draftPreviewStamp?.bytes === draftRender.bytes && previewOwnerCurrent(draftPreviewStamp, previewOwnerFor(project, 'draft')) && canvasCheckCurrent && !overflow.length && !layoutIssues.length && renderStatus === 'ready';
  const currentSaved = saveStatus === 'saved' && savedRevision === project?.revision;
  const memorySaveState: SaveStatus = saveStatus === 'saved' && !currentSaved && project ? 'dirty' : saveStatus;
  function currentPdfPreviewComplete() {
    const current = projectRef.current;
    const runtime = previewRuntime.current;
    return !!current && !!draftRender && runtime.draftStamp?.bytes === draftRender.bytes &&
      previewReviewComplete(runtime.draft, runtime.draftStamp, previewOwnerFor(current, 'draft'), current.template.pages.length);
  }
  function templatePreviewsComplete() {
    const current = projectRef.current;
    const runtime = previewRuntime.current;
    const sourceStamp = current ? { ...previewOwnerFor(current, 'source')!, bytes: current.source.bytes, scale: 1.5 } : null;
    return !!current && !!baselineRender && runtime.baselineStamp?.bytes === baselineRender.bytes &&
      previewReviewComplete(runtime.baseline, runtime.baselineStamp, previewOwnerFor(current, 'baseline'), current.template.pages.length) &&
      (current.source.format !== 'pdf' || previewReviewComplete(runtime.source, sourceStamp, previewOwnerFor(current, 'source'), current.source.sourcePageCount ?? current.template.pages.length));
  }
  function recordObservedPreview(kind: 'source' | 'baseline' | 'draft', receipt: PreviewReceipt) {
    const current = projectRef.current; if (!current) return;
    const runtime = previewRuntime.current;
    const stamp = kind === 'source' ? { ...previewOwnerFor(current, kind)!, bytes: current.source.bytes, scale: 1.5 } : runtime[kind === 'baseline' ? 'baselineStamp' : 'draftStamp'];
    const count = kind === 'source' ? current.source.sourcePageCount ?? current.template.pages.length : current.template.pages.length;
    const next = recordPreviewPage(runtime[kind], stamp, previewOwnerFor(current, kind), receipt, count);
    // Update synchronously as well as rendering status: an in-flight save's
    // continuation must see a preview failure before delivering any download.
    runtime[kind] = next;
    if (kind === 'source') setOriginalPreviewReview(next);
    else if (kind === 'baseline') setBaselinePreviewReview(next);
    else setPdfReview(next);
  }
  useEffect(() => {
    if (!project || surface !== 'studio' || stage !== 'review' || workspaceOf(project).kind !== 'application' || memoryDestination) return;
    setOpenItemIds(previous => previous.includes(project.id) ? previous : [...previous, project.id].slice(-4));
  }, [project?.id, surface, stage, memoryDestination]);
  const pdfInspected = currentPdfPreviewComplete();
  const templatePreviewReady = templatePreviewsComplete();
  const ready = !!project && issues.length === 0 && fitReady && !composition && currentSaved && pdfInspected;
  const downloadBlocking = !project ? null
    : saveStatus === 'error' ? 'Saving failed. Download a backup, then try again.'
    : unprovedEdits.length ? `${unprovedEdits.length} edited ${unprovedEdits.length === 1 ? 'paragraph needs' : 'paragraphs need'} a source check in Changes.`
    : overflow.length || layoutIssues.length ? 'Some text no longer fits its line. Shorten the highlighted text, then download.'
    : renderStatus === 'error' ? 'The PDF could not be prepared. Undo the last change and try again.'
    : null;
  // Each screen opens at its top, not at the scroll position the previous screen was left at.
  useEffect(() => { const scroller = workspaceScroller.current; if (scroller) scroller.scrollTop = 0; }, [surface, stage, project?.id]);
  /** One click: confirm claims, then let the effect below run every check the export requires. */
  function guidedDownload(filename?: string) {
    const current = projectRef.current; if (!current || exportInFlight.current) return;
    if (sourceReviewIssues(current).length) { setInsightTab('changes'); setInsightsOpen(true); setNotice('Check the sources for your edited paragraphs, then download.'); return; }
    if (current.reviewedDraftRevision !== current.draft.revision) {
      if (!finalConfirmed) { showClaimConfirmation(); setNotice('Tick “Everything in this resume is true”, then download.'); return; }
      try { mutate(confirmDraft(current)); } catch (reason) { setError(errorMessage(reason)); return; }
    }
    setDownloadSettings(false); setError(''); setStage('review');
    setPendingDownload({ filename });
  }
  useEffect(() => {
    if (!pendingDownload || !project || exportInFlight.current) return;
    const stop = (message: string) => { setPendingDownload(null); setDownloadProgress(''); setError(message); };
    if (downloadBlocking) { stop(downloadBlocking); return; }
    if (renderStatus === 'idle') { stop('The PDF is not available for this template yet. Approve the template first.'); return; }
    if (composition || renderStatus !== 'ready' || !draftRender || draftRender.contentRevision !== project.draft.revision) { setDownloadProgress('Updating your resume…'); return; }
    if (!canvasCheckCurrent) { setDownloadProgress('Checking the layout…'); if (view !== 'canvas') setView('canvas'); setMobilePane('document'); return; }
    if (!pdfInspected) { setDownloadProgress('Showing every page…'); if (view !== 'pdf') setView('pdf'); setMobilePane('document'); return; }
    if (!currentSaved) { setDownloadProgress('Saving…'); return; }
    if (issues.length) { stop(issues[0]); return; }
    const filename = pendingDownload.filename;
    setPendingDownload(null); setDownloadProgress('');
    void exportPdf(filename);
  });
  const library = project ? [project, ...projects.filter(item => item.id !== project.id)] : projects;
  const earlierReconstruction = !!project && hasEarlierReconstruction(project);
  const currentSourceReconstruction = project && earlierReconstruction ? currentReconstruction(project, library) : undefined;
  const groupIds = [...new Set(library.map(item => workspaceOf(item).templateGroupId))];
  const groups = groupIds.map(id => ({ id, resume: library.find(item => workspaceOf(item).templateGroupId === id && workspaceOf(item).kind === 'resume'), applications: library.filter(item => workspaceOf(item).templateGroupId === id && workspaceOf(item).kind === 'application') }));
  const defaultStatus = defaultResumeStatus(library, defaultResume);
  const privacyResume = project ? library.find(item => workspaceOf(item).kind === 'resume' && workspaceOf(item).templateGroupId === workspaceOf(project).templateGroupId) : undefined;
  const privacySources: PrivacySource[] = privacyResume ? [{ id: privacyResume.id, kind: 'resume', name: privacyResume.source.name, detail: `${privacyResume.facts.filter(fact => fact.kind === 'resume').length} original facts · Other saved applications keep their pinned copies`, action: 'remove' }, ...(privacyResume.careerMemory?.sources ?? []).map(source => ({ id: source.id, kind: source.kind === 'localDictation' ? 'transcript' as const : source.kind === 'linkedinPaste' ? 'linkedin' as const : source.kind === 'supportingFile' ? 'file' as const : 'note' as const, name: source.name, detail: `${source.segments.length} retained source passages · Review exact wording and future eligibility`, action: 'manage' as const }))] : [];
  const retainedChoiceNotice = legacyChoiceNotice(library, composerPreferences, defaultResume);
  // Badges and Make default use the same fresh-attempt authority as the
  // bridge, excluding pinned applications and attempt-local overrides.
  const freshDefault = freshComposerDefault(library, project, defaultResume, defaultResumeReady,
    defaultResumeError, composerPreferences);
  const freshDefaultWarning = !defaultResumeReady ? 'Saved layout choices are still opening. Automatic source selection is unavailable until they finish.' :
    defaultResumeError || (!defaultResume && (composerPreferences.defaultId || composerPreferences.selectedId) ?
      'Earlier resume choices are retained. Choose an approved resume explicitly or save its current layout as default.' : '');
  const selectedFingerprintInvalid = !!explicitSelection && !library.some(item => preferenceMatches(item, explicitSelection));
  const composerPreferenceWarning = defaultResumeError || (selectedFingerprintInvalid ? 'The selected resume changed or was removed. Choose its approved current version.' : !defaultResume && (composerPreferences.defaultId || composerPreferences.selectedId) ? 'Earlier resume choices are retained. Choose an approved resume explicitly before starting this attempt.' : '');
  const reusable = project ? groups.find(group => group.id === workspaceOf(project).templateGroupId)?.resume : undefined;
  const isApplication = project ? workspaceOf(project).kind === 'application' : false;
  const approximate = project?.template.fidelity?.mode === 'approximate' || project?.source.format === 'docx';
  const saveLabel = saveStatus === 'saved' && savedRevision === project?.revision ? 'Saved on this device' : saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Not saved · download a backup' : saveStatus === 'loading' ? 'Opening device storage…' : project ? 'Unsaved changes' : 'Local workspace';
  const memory = project?.careerMemory;
  const memoryProjection = memory && project ? memoryView(project) : null;
  const reviewedSource = memory?.sources.find(source => source.id === sourceReviewId);
  const baselineNeedsReview = project ? unresolvedBaselineBlocks(project) : [];
  const capture: ContextCaptureProps | null = memory ? {
    memory,
    onDraftChange: text => memoryAction((current, revision) => setMemoryDraft(current, text, revision)),
    onAddFiles: addContextFiles,
    onAddTextSource: addContextText,
    onLinkedInReferenceChange: async url => { await asyncMemoryAction(async (current, revision) => saveLinkedInReference(current, url, revision)); },
    onReviewSource: setSourceReviewId,
    onRemoveSource: async id => { contextOperations.current.get(id)?.controller.abort(); contextOperations.current.delete(id); await asyncMemoryAction(async (current, revision) => removeMemorySource(current, id, revision)); },
    onRetrySource: retryContextFile,
    pendingFiles: pendingContextFiles,
    onRemovePendingFile: removePendingContext,
    onRetryPendingFile: retryContextFile,
    language: 'en-US',
  } : null;
  const assertionActions: AssertionActions = {
    onAssertionDraftChange: (id, version, text) => memoryAction((current, revision) => setMemoryAssertionDraft(current, id, version, text, revision)),
    onDiscardAssertionDraft: async (id, version) => { await asyncMemoryAction(async (current, revision) => (current.careerMemory!.assertions.find(item => item.id === id)?.currentVersion === version ? cancelMemoryAssertionDraft(current, id, revision) : (() => { throw new Error('This detail changed. Review its current version before discarding an edit.'); })())); },
    onEditAssertion: async (id, version, text) => { await asyncMemoryAction(async (current, revision) => editAssertion(current, id, version, text, revision)); },
    onConfirmAssertion: async (id, version, text) => { const hash = await sha256(new TextEncoder().encode(text)); await asyncMemoryAction((current, revision) => confirmAssertion(current, id, version, hash, revision)); },
    onSetAssertionFuture: async (id, eligible) => { await asyncMemoryAction(async (current, revision) => setAssertionFuture(current, id, eligible, revision)); },
  };
  const retryMemorySave = () => persistBeforeSwitch();
  void historyTick; void memoryHistoryTick;
  const memoryNavigationSource = sourceForMemory();
  const memoryNavigationCount = (memoryNavigationSource?.facts.filter(fact => fact.kind === 'resume').length ?? 0) + (memoryNavigationSource?.careerMemory?.assertions.length ?? 0);

  return <div className={`app-shell folio-kit ${reviewWorkspace ? 'kit-review-open' : ''} ${surface === 'home' ? 'kit-home-open' : ''} ${cleanHighlights ? 'kit-clean-highlights' : ''} ${sidebarOpen ? 'sidebar-open' : ''} ${memoryDrawerMode ? 'memory-design-open' : ''} ${collapsedHistory ? 'global-rail-mode' : ''} ${settings ? 'privacy-design-open' : ''} ${surface === 'templates' ? 'templates-design-open' : ''} ${!project && !settings && !legacyArchives.length && !unavailableProjects.length && surface === 'studio' ? 'intake-design-open' : ''} ${surface === 'compose' ? 'composer-design-open' : ''}`}>
    <input ref={fileInput} className="visually-hidden" type="file" tabIndex={-1} accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" aria-label="Upload a PDF or DOCX resume" onChange={event => { const file = event.target.files?.[0]; if (file) void ingest(file); }} />
    <input ref={restoreInput} className="visually-hidden" type="file" tabIndex={-1} accept=".zip" aria-label="Restore a Folio project backup" onChange={event => { const file = event.target.files?.[0]; if (file) void restore(file); }} />
    {collapsedHistory && <aside className="memory-history-rail" aria-label="Tailoring history, collapsed"><button className="icon-button" ref={memoryRailOpener} aria-controls="project-library" aria-label="Expand history sidebar" aria-expanded={sidebarOpen} onClick={() => { if (sidebarAutomaticallyCollapsed) { setSidebarOpen(value => !value); } else { setSidebarCollapsed(false); setSidebarOpen(false); window.requestAnimationFrame(() => libraryElement.current?.querySelector<HTMLElement>('.brand')?.focus()); } }}><PanelLeftClose size={18} /></button><button className="icon-button" aria-label="New tailored resume" disabled={!!busy} onClick={() => void newTailoring()}><Pencil size={18} /></button><div className="memory-rail-account"><AccountMenu profile={profile} onProfile={() => { setSettings(false); setSurface('profile'); setMemoryDestination(null); }} onMemory={() => { setSettings(false); const source = sourceForMemory(); if (source) void openMemory(source); else setNotice('Upload a resume to create Career Memory.'); }} onSettings={openPrivacy} onHelp={() => { setSettings(false); setSurface('help'); setMemoryDestination(null); }} /></div></aside>}
    <aside ref={libraryElement} id="project-library" className="sidebar" aria-label="Project library" inert={collapsedHistory && !sidebarOpen}>
      <div className="kit-sidebar-heading"><a className="brand" href="#" onClick={event => { event.preventDefault(); void openHome(); }} aria-label="Folio workspace"><span className="kit-logo" aria-hidden="true">F</span><span>Folio</span></a><button className="kit-sidebar-square" aria-label="Collapse sidebar" onClick={() => { setSidebarOpen(false); if (!sidebarAutomaticallyCollapsed) { setSidebarCollapsed(true); window.requestAnimationFrame(() => memoryRailOpener.current?.focus()); } }}><PanelLeftClose size={15} /></button><button className="kit-sidebar-square kit-new-square" aria-label="New tailoring" onClick={() => void newTailoring()} disabled={!!busy}><Plus size={15} /></button></div>
      <nav className="kit-primary-nav" aria-label="App"><button className="sidebar-link" disabled={composerNavigating || !!busy} onClick={() => void openHistory()}><Search size={16} />Search</button><button className={`sidebar-link ${surface === 'home' && !settings ? 'is-active' : ''}`} aria-current={surface === 'home' && !settings ? 'page' : undefined} onClick={() => void openHome()}><Home size={16} />Home</button><button className={`sidebar-link ${surface === 'compose' && !settings ? 'is-active' : ''}`} aria-current={surface === 'compose' && !settings ? 'page' : undefined} onClick={() => void newTailoring()} disabled={!!busy}><Plus size={16} />Tailor a resume</button><button className={`sidebar-link ${surface === 'history' && !settings ? 'is-active' : ''}`} aria-label="Applications" aria-current={surface === 'history' && !settings ? 'page' : undefined} disabled={composerNavigating || !!busy} onClick={() => void openHistory()}><Clock3 size={16} />Applications<span className="kit-nav-count">{projects.filter(item => workspaceOf(item).kind === 'application').length}</span></button><button className={`sidebar-link ${memoryDrawerMode ? 'is-active' : ''}`} onClick={() => openCareerContext()}><Brain size={16} />Career Memory<span className="kit-nav-count">{memoryNavigationCount}</span></button></nav>
      <div className="kit-sidebar-divider" /><p className="kit-sidebar-group">Recent tailorings<ChevronDown size={12} /></p>
      <TailoringHistory projects={projects} selectedId={project?.id} onOpen={item => void openTailoring(item)} onDelete={setDeleteTarget} failedIds={failedSaves} />
      <button className="sidebar-link kit-layout-link" onClick={() => void openTemplates()}><FileText size={15} />Templates</button>
      <details ref={resumeLibrary} className="folio-resume-library"><summary><FileText size={15} />Resume and layout</summary><button className="sidebar-link" onClick={() => fileInput.current?.click()} disabled={!!busy}><Upload size={15} />Upload another resume</button>
      <div className="sidebar-section-label"><span>Your workspace</span><span>{projects.length}</span></div>
      <nav className="project-list" aria-label="Saved resumes">{groups.length ? groups.map(group => <section className="resume-group" key={group.id} aria-label={group.resume?.name ?? 'Saved applications'}>
        {group.resume && <div data-project-id={group.resume.id} className={`project-item ${project?.id === group.resume.id ? 'is-current' : ''}`}><button className="project-open" onClick={() => void switchProject(group.resume!)}><FileText size={17} /><span><strong>{group.resume.name}</strong><small>{hasValidApproval(group.resume) ? 'Reusable template · Current draft' : 'Template needs review'}</small></span></button><button className="project-delete icon-button" aria-label={`Delete ${group.resume.name}`} onClick={() => setDeleteTarget(group.resume!)}><Trash2 size={14} /></button></div>}
        {!group.resume && <p className="template-version">Saved applications · Reusable resume removed</p>}
        {group.applications.map(item => <div key={item.id} data-project-id={item.id} className={`project-item application-row ${project?.id === item.id ? 'is-current' : ''}`}><button className="project-open" onClick={() => void switchProject(item)}><FileCheck2 size={15} /><span><strong>{item.name}</strong><small>{item.reviewedDraftRevision === item.draft.revision ? 'Draft reviewed' : 'Needs review'} · Template v{item.template.revision}</small></span></button><button className="project-delete icon-button" aria-label={`Delete ${item.name}`} onClick={() => setDeleteTarget(item)}><Trash2 size={14} /></button></div>)}
        {group.resume && <button className="text-button group-create" disabled={!!busy} aria-label={`Career Memory for ${group.resume.name}`} onClick={() => void openMemory(group.resume!)}><BookOpen size={14} />Career Memory</button>}
        {group.resume && <button className="text-button group-create" disabled={!!busy || !hasValidApproval(group.resume)} aria-label={`New application from ${group.resume.name}`} onClick={() => { setApplicationSource(group.resume!); setApplicationError(''); }}><Plus size={14} />New application</button>}
      </section>) : <div className="library-empty"><FolderClosed size={20} /><span>Your resumes will live here.</span></div>}</nav>
      {unavailableProjects.length > 0 && <section className="unavailable-library" tabIndex={0} aria-label="Unavailable saved resumes"><p role="status">{unavailableProjects.length} saved {unavailableProjects.length === 1 ? 'resume could' : 'resumes could'} not be opened. They remain unchanged on this device.</p>{unavailableProjects.map((item, index) => <div key={index}><strong>{item.name}</strong><p>{item.reason}</p><button className="text-button" disabled={!!busy} onClick={()=>void rebuildVerifiedOriginal(()=>unavailableOriginal(item.key))}>Rebuild from saved original</button><button className="text-button" disabled={!!busy} aria-label={`Download recovery data for ${item.name}`} onClick={() => void recoverSavedRecord(item)}>Download recovery data</button></div>)}<p>Version-incompatible drafts stay preserved. Use a compatible Folio build or download recovery data; no downgrade is performed. Rebuilding creates a separate copy.</p></section>}
      <LegacyArchiveList archives={legacyArchives} busy={!!busy} onDownload={archive=>void downloadArchived(archive)} onRebuild={archive=>void rebuildVerifiedOriginal(()=>legacyArchiveOriginal(archive.id))}/>
      <button className="sidebar-link" onClick={() => restoreInput.current?.click()} disabled={!!busy}><Upload size={16} />Restore a backup</button>
      </details><div className="sidebar-bottom"><button className="sidebar-link" onClick={() => openCareerContext('context')}><Mic size={16} />Voice notes</button><button className={`sidebar-link ${settings ? 'is-active' : ''}`} onClick={openPrivacy}><Settings2 size={16} />Settings</button><button className="sidebar-link" onClick={() => { setSettings(false); setSurface('help'); setMemoryDestination(null); setSidebarOpen(false); }}><Info size={16} />Help</button><AccountMenu profile={profile} onProfile={() => { setSettings(false); setSurface('profile'); setMemoryDestination(null); setSidebarOpen(false); }} onMemory={() => { setSettings(false); const source = sourceForMemory(); if (source) { setSurface('studio'); void openMemory(source); } else setNotice('Upload a resume to create Career Memory.'); }} onSettings={openPrivacy} onHelp={() => { setSettings(false); setSurface('help'); setMemoryDestination(null); setSidebarOpen(false); }} /></div>
    </aside>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="Close project library" onClick={() => setSidebarOpen(false)} />}
    <main ref={workspaceScroller} className="main-workspace" inert={exportInFlight.current || collapsedHistory && sidebarOpen} aria-busy={exportInFlight.current} onBeforeInputCapture={event => { if (exportInFlight.current) event.preventDefault(); }} onPasteCapture={event => { if (exportInFlight.current) event.preventDefault(); }} onDropCapture={event => { if (exportInFlight.current) event.preventDefault(); }}>
      <div className="kit-tabs" role="navigation" aria-label="Open items"><button ref={libraryOpener} className="kit-mobile-sidebar icon-button" aria-label="Open navigation" aria-controls="project-library" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(value => !value)}><Menu size={18} /></button><button id={surface === 'home' && !settings ? 'ws-h' : undefined} className={`kit-tab ${surface === 'home' && !settings ? 'on' : ''}`} aria-current={surface === 'home' && !settings ? 'page' : undefined} onClick={() => void openHome()}><Home size={14} />Home</button>{openItemIds.map(id => { const item = projects.find(entry => entry.id === id); if (!item) return null; const active = reviewWorkspace && item.id === project?.id; return <div className={`kit-document-tab ${active ? 'on' : ''}`} key={id}><button id={active ? 'ws-h' : undefined} className="kit-tab" aria-current={active ? 'page' : undefined} onClick={() => void openTailoring(item)} title={`${item.job.title || item.name} · ${item.job.company || item.name}`}><FileText size={14} /><span>{item.job.company || item.name}</span></button>{active && <button className="kit-tab-close" aria-label={`Close ${item.job.company || item.name}`} onClick={() => { setOpenItemIds(previous => previous.filter(value => value !== id)); void openHome(); }}><X size={12} /></button>}</div>; })}{reviewWorkspace && <button className="kit-tab kit-tabs-review" aria-expanded={insightsOpen} onClick={() => { setInsightTab('changes'); setInsightsOpen(value => !value); }}><BookOpen size={14}/>{insightsOpen ? 'Hide review' : 'Review sources'}</button>}{(surface !== 'home' || settings || memoryDrawerMode) && !reviewWorkspace && <span id={!project && surface === 'studio' && !settings ? undefined : 'ws-h'} tabIndex={-1} className="kit-tab on" aria-current="page">{memoryDrawerMode ? <Brain size={14} /> : settings ? <Settings2 size={14} /> : surface === 'compose' ? <Plus size={14} /> : surface === 'history' ? <Clock3 size={14} /> : <FileText size={14} />}{settings ? 'Settings' : memoryDrawerMode ? 'Career Memory' : surface === 'compose' ? (tailoringOperation.current ? 'Tailoring…' : 'New tailoring') : surface === 'history' ? 'Applications' : surface === 'templates' ? 'Templates' : surface === 'profile' ? 'My profile' : surface === 'help' ? 'Help' : project ? 'Resume layout' : 'Add your resume'}</span>}</div>
      {mobileViewport && (settings || memoryDrawerMode) ? <header className="workspace-header folio-secondary-mobile-header"><button className="icon-button" aria-label={settings ? 'Back to tailoring' : memoryContextOpen ? 'Back to Career Memory' : 'Back to tailoring'} onClick={() => { if (settings) closePrivacy(); else if (memoryContextOpen) setRequestedMemoryView(value => ({ view: 'roles', request: value.request + 1 })); else void closeCareerMemory().catch(reason => setMemoryError(errorMessage(reason))); }}><ArrowLeft size={20} /></button><div><strong>{settings ? 'Settings' : memoryContextOpen ? 'Add context' : 'Career Memory'}</strong>{!settings && !memoryContextOpen && memoryProjection && memory && <span>{memoryProjection.resumeFacts.length + memoryProjection.assertions.length} facts · {memory.sources.length + 1} {memory.sources.length ? 'sources' : 'source'}</span>}</div>{!settings && !memoryContextOpen && <button className="icon-button" aria-label="Add context" onClick={() => setRequestedMemoryView(value => ({ view: 'context', request: value.request + 1 }))}><Plus size={20} /></button>}</header>
      : <header className="workspace-header"><div className="header-project"><button className="text-button mobile-menu" aria-controls="project-library" aria-expanded={sidebarOpen} aria-label="Open history" onClick={() => setSidebarOpen(!sidebarOpen)}><PanelLeftClose size={18} />History</button><button className="icon-button mobile-menu" aria-label="New tailored resume" disabled={!!busy} onClick={() => void newTailoring()}><Plus size={18} /></button>{!project && surface === 'studio' && !settings && <span className="kit-logo" aria-hidden="true">F</span>}<strong tabIndex={-1} id={!project && surface === 'studio' && !settings ? 'ws-h' : undefined}>{settings || memoryDrawerMode ? 'Folio' : surface === 'home' ? 'Home' : surface === 'compose' ? 'New tailoring' : surface === 'profile' ? 'My profile' : surface === 'history' ? 'Applications' : surface === 'help' ? 'Help' : surface === 'templates' ? 'Folio' : project?.job.title || project?.name || 'Folio'}</strong>{project?.fictional && surface === 'studio' && !memoryDestination && <span className="sample-badge">Fictional sample</span>}</div><div className="header-actions">{!project && !settings && surface === 'studio' && <><button className="text-button intake-privacy-link" onClick={() => restoreInput.current?.click()} disabled={!!busy}>Restore a backup</button><button ref={intakePrivacyButton} className="text-button intake-privacy-link" onClick={openPrivacy}>Privacy</button>{auth && auth.status !== 'signedIn' && <button className="button button-secondary button-small auth-account-button" onClick={() => auth.openAuth('signin')}>Sign in</button>}</>}{memoryDrawerMode && <div className="memory-top-actions"><button className="icon-button" aria-label="Undo memory change" disabled={!memoryPast.current.length || !!busy} onClick={() => memoryUndo('undo')}><RotateCcw size={16} /></button><button className="icon-button" aria-label="Redo memory change" disabled={!memoryFuture.current.length || !!busy} onClick={() => memoryUndo('redo')}><RotateCcw size={16} className="memory-redo-icon" /></button></div>}<span className={`save-status ${saveStatus === 'error' ? 'save-error' : ''}`} role="status">{saveStatus === 'saving' ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{saveLabel}</span>{project && surface === 'studio' && !memoryDestination && <button className="icon-button header-backup" title="Download project backup" aria-label="Download project backup" onClick={() => void backup()}><ArrowDownToLine size={16} /></button>}{project && surface === 'studio' && stage === 'review' && !memoryDestination && <button className="button button-primary header-download" disabled={!!busy || composition || !!pendingDownload} onClick={() => guidedDownload()}><ArrowDownToLine size={15} />Download PDF</button>}{project&&surface==='studio'&&stage==='review'&&!memoryDestination&&<button className="icon-button folio-download-options" aria-label="Download settings" disabled={!!busy} onClick={()=>{setDownloadName(defaultResumeFileName(project));setDownloadSettings(true);}}><ChevronDown size={15}/></button>}</div></header>}
      {(error || notice) && <div className={`message-banner ${error ? 'message-error' : ''}`} role={error ? 'alert' : 'status'}><Info size={16} /><span>{error || (downloadedName&&notice.startsWith('PDF downloaded')?`${downloadedName} downloaded`:notice)}</span>{!error&&downloadedName&&notice.startsWith('PDF downloaded')&&<button className="text-button" onClick={()=>void newTailoring()}>New tailored resume<Plus size={14}/></button>}<button className="icon-button" aria-label="Dismiss message" onClick={() => { setError(''); setNotice(''); }}><X size={15} /></button></div>}
      {saveStatus === 'error' && project && <div className="current-record-actions"><button className="text-button" disabled={!!busy} onClick={() => void persist(structuredClone(project)).catch(() => {})}>Retry saving</button><button className="text-button" disabled={!!busy} onClick={() => { void loadLibrary().then(result => { const saved = result.projects.find(item => item.id === project.id); if (!saved) throw new Error('This record has been removed. Download your unsaved backup before leaving it.'); setReloadTarget(saved); }).catch(reason => setError(errorMessage(reason))); }}>Reload saved version…</button><button className="text-button" onClick={() => void backup()}>Download backup of unsaved edits</button></div>}
      {busy && <div className="busy-status" role="status"><LoaderCircle size={16} className="spin" />{busy}…{busy === 'Importing your resume' && <button className="text-button" onClick={cancelImport}>Cancel</button>}</div>}
      {project?.approval && project.approval.rendererVersion !== rendererVersionFor(project.template) && surface === 'studio' && <section className="reconstruction-notice" role="status" aria-label="Fresh layout approval required"><div><h2>Review this layout again before editing or exporting</h2><p>Rendering checks have changed since your previous approval. Compare the original and current layout, then choose Approve template. Your original, saved wording, history and career context stay intact.</p></div><button className="button button-secondary" onClick={()=>{setStage('template');}}>Compare layout</button></section>}
      {project && earlierReconstruction && surface === 'studio' && <ReconstructionNotice project={project} current={currentSourceReconstruction} busy={!!busy} onRebuild={() => void rebuildOriginal()} onOpenCurrent={() => {
        if (!currentSourceReconstruction) return;
        void switchProject(currentSourceReconstruction).then(() => { if(projectRef.current?.id===currentSourceReconstruction.id) {setMemoryDestination(null);setStage('template');setSurface('studio');} });
      }} />}
      {settings ? <PrivacySettings onClose={closePrivacy} sources={privacySources} onSourceAction={async source => {
        if (!privacyResume) throw new Error('The reusable source is unavailable. Restore its group backup to manage its context.');
        if (source.kind === 'resume') { setDeleteTarget(privacyResume); return; }
        await openMemory(privacyResume); setSettings(false); setSourceReviewId(source.id);
      }} backup={{ title: privacyResume ? 'Download this resume group' : project ? 'Download this application' : 'Download a private backup', description: privacyResume ? 'Original resume, Career Memory, supporting sources and saved applications as a ZIP file. Profile and default-layout preferences are stored separately.' : 'This saved record and its pinned evidence snapshot as a ZIP file.', disabledReason: !project ? 'Choose a saved resume or application first.' : undefined }} onBackup={project ? () => backup(privacyResume ?? project) : undefined} onRestoreBackup={async () => { await persistBeforeSwitch(); restoreInput.current?.click(); }} restoreDisabledReason={busy || undefined}
      deletion={{ title: 'Delete this resume group', description: 'Review the exact records, Career Memory and retained sources before deleting. Other groups and downloaded files remain.', disabledReason: !project ? 'Choose a saved resume group first.' : undefined }} onDeleteScope={project ? requestGroupRemoval : undefined}
      modelConsent={{ granted: composerConsent, available: aiService.state === 'ready', detail: aiService.message, scopeLabel: 'Current composer request' }} onReviewConsent={() => { setSettings(false); setMemoryDestination(null); setSurface('compose'); }} onRevokeConsent={() => setComposerConsent(false)}
      storage={{ status: memorySaveState === 'dirty' ? 'error' : memorySaveState, detail: 'Uploads and projects stay in this browser. Group backups preserve source files and saved application snapshots. Profile, activity and default-layout preferences are separate and are not included in group backups.' }} returnFocusTo={privacyOpener.current} />
      : surface === 'templates' ? <TemplatesManager projects={library} preference={defaultResume} preferenceError={freshDefaultWarning} retainedChoiceNotice={retainedChoiceNotice} eligibleDefaultId={freshDefault?.id} busy={!!busy || composerNavigating} onDefault={chooseDefaultResume} onInspect={source => { void inspectLayout(source); }} onUpload={() => fileInput.current?.click()} onClose={() => { if (!composerNavigationPending.current && !exportInFlight.current) setSurface('compose'); }} />
      : surface === 'home' ? <HomeWorkspace profile={profile} projects={projects} resume={sourceForComposer() ?? undefined} value={homeText} busy={!!busy || composerNavigating} onChange={setHomeText} onContinue={() => void newTailoring(homeText)} onOpen={item => void openTailoring(item)} onHistory={() => void openHistory()} onLayout={() => void openTemplates()} onContext={() => openCareerContext('context')} onMemory={() => openCareerContext()} onUpload={() => fileInput.current?.click()} />
      : surface === 'compose' ? <>{(composerPreferenceWarning || defaultStatus === 'missing' || defaultStatus === 'changed') && <div className="folio-default-warning" role="alert"><span>{composerPreferenceWarning || 'Your default layout needs review. Choose an approved layout before starting a new tailoring.'}</span><button className="text-button" onClick={() => void openTemplates()}>Choose a layout</button></div>}<JobComposer resume={sourceForComposer() ?? undefined} value={composerText} consent={composerConsent} busy={tailoringOperation.current ? busy : composerNavigating ? 'Saving your current draft' : ''} error={tailorError} onChange={composerChange} onConsent={setComposerConsent} onTailor={() => void startTailoring()} onLayout={() => void openTemplates()} onUpload={() => fileInput.current?.click()} onOpenDraft={() => void openDraftEditor()} jobDetails={composerDetails} onJobDetailsChange={composerDetailsChange} service={aiService} onCheckService={() => void checkAiService()} />{tailoringOperation.current && <div className="folio-processing-actions"><button className="button button-secondary" onClick={cancelTailoring}>Cancel</button><button className="text-button" onClick={cancelTailoring}>Edit job</button></div>}</> : surface === 'profile' ? <PrivateProfileView profile={profile} projects={projects} error={profileError} onSave={async next => { const merged = { ...next, events: mergeActivity(projects, profileRef.current?.events ?? next.events) }; const saved = await savePrivateProfile(merged); setProfile(saved); profileRef.current = saved; setProfileError(''); }} onOpen={item => void openTailoring(item)} /> : surface === 'history' ? <section className="folio-history-surface"><header className="kit-page-heading"><div><h1>Applications</h1><p>Each tailoring keeps its own job description, edits and resume. Reopening never re-runs it.</p></div><button className="button button-primary" onClick={() => void newTailoring()}><Plus size={16} />New tailoring</button></header><AllTailorings projects={projects} onOpen={item => void openTailoring(item)} onDelete={setDeleteTarget} failedIds={failedSaves} onRetry={item=>void persist(structuredClone(projectRef.current?.id===item.id?projectRef.current:item)).catch(()=>{})} onRename={item=>{setRenameTarget(item);setRenameText(item.name);}} onNew={item=>void newTailoring(item.job.description)} /></section> : surface === 'help' ? <section className="folio-help"><h1>A quieter way to tailor</h1><section><h2>Your original stays yours</h2><p>Upload a supported text PDF or DOCX, compare every page, and keep the source layout. Rebuild from original makes a separate copy of an older template.</p><button className="text-button" onClick={() => { const source = sourceForComposer(); if (source) { void inspectLayout(source); } else fileInput.current?.click(); }}>Resume and layout<ArrowRight size={14} /></button></section><section><h2>Context is optional</h2><p>Career Memory accepts files, LinkedIn PDF or pasted details, typed notes and browser dictation where available. Imported details need exact review before future jobs use them. A LinkedIn link is a reference, not account access.</p></section><section><h2>Tailoring setup</h2><p>The local service must be configured, verified and enabled before tailoring. No account is connected and requests are paid-disabled by default. The editor and PDF export work locally.</p></section><section><h2>Keep a private backup</h2><p>Browser data clearing removes local projects. Group backups retain originals, context and saved tailorings. Private profile preferences and activity recording are stored in a separate local database.</p><button className="text-button" onClick={openPrivacy}>Privacy and data<ArrowRight size={14} /></button></section></section> : !project ? <section className="welcome-workspace">
        <div className="welcome-copy"><h1>Start with your resume</h1><p>Folio reads your experience and keeps supported layouts.</p></div>
        <div className={`upload-card ${dragging ? 'is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}><Upload size={22} aria-hidden="true" /><h2>Drop a PDF or Word file</h2><button className="button button-primary" onClick={() => fileInput.current?.click()} disabled={!!busy}>Choose file</button><span className="file-support">Selectable-text PDF or DOCX · Up to 10 MiB</span></div><p className="intake-storage-note"><ShieldCheck size={14} aria-hidden="true" />Uploads are processed and saved on this device.</p>
        <button className="sample-link" onClick={() => void loadSample()} disabled={!!busy}>Just looking around? <span>Explore a fictional sample <ArrowRight size={15} /></span></button>
        <div className="journey-cards"><div><span className="journey-number">01</span><h3>Keep your character</h3><p>Compare and approve a reconstruction of your original layout.</p></div><div><span className="journey-number">02</span><h3>Find your relevance</h3><p>Connect the role to evidence from your resume and career notes.</p></div><div><span className="journey-number">03</span><h3>Make it yours</h3><p>Edit directly on the page. Review every word, then download a PDF.</p></div></div>
      </section> : memoryDestination && memory && memoryProjection && capture ? <>
        <div className="memory-workspace-toolbar"><span>Career Memory · Reusable resume context</span><div><button className="text-button" disabled={!memoryPast.current.length || !!busy} onClick={() => memoryUndo('undo')}>Undo memory change</button><button className="text-button" disabled={!memoryFuture.current.length || !!busy} onClick={() => memoryUndo('redo')}>Redo memory change</button></div></div>
        {memoryError && saveStatus !== 'error' && <p className="memory-root-error" role="alert">{memoryError}</p>}
        {memoryDestination === 'onboarding' ? <OnboardingContext key={project.id} {...capture} resume={{ groupId: workspaceOf(project).templateGroupId, name: project.name, format: project.source.format }} saveState={memorySaveState} saveError={memoryError || error} busy={!!busy} onContinue={finishContext} onDiscardDraft={async () => { const next = await asyncMemoryAction(async (current, revision) => setMemoryDraft(current, '', revision)); await persist(next); }} onRetrySave={retryMemorySave} /> : <CareerMemoryEditor key={project.id} requestedView={requestedMemoryView} onContextChange={setMemoryContextOpen} onUndo={() => memoryUndo('undo')} onRedo={() => memoryUndo('redo')} canUndo={!!memoryPast.current.length && !busy} canRedo={!!memoryFuture.current.length && !busy} onManageTemplates={() => void openTemplates()} templateCount={library.filter(item => workspaceOf(item).kind === 'resume').length} {...capture} {...assertionActions} view={memoryProjection} groups={careerMemoryGroups(project)} resumeName={project.name} resumeSourceName={project.source.name} saveState={memorySaveState} saveError={memoryError || error} onRetrySave={retryMemorySave} applicationSnapshot={memoryFromSnapshot} onCorrectResumeFact={async (id, text) => { await asyncMemoryAction((current, revision) => correctResumeFact(current, id, text, revision)); }} onSetResumeFactFuture={async (id, eligible) => { await asyncMemoryAction(async (current, revision) => excludeResumeFact(current, id, !eligible, revision)); }} onRequestDeleteGroup={() => void requestGroupRemoval()} onClose={closeCareerMemory} />}
      </> : <>
        {stage === 'review' && <div className="folio-review-toolbar"><button className="button button-secondary" aria-expanded={insightsOpen} onClick={() => setInsightsOpen(value => !value)}>{changes.length} changes · Insights</button><button className="button button-secondary" onClick={() => { setInsightTab('job'); setInsightsOpen(true); }}>View job</button><button className="text-button" onClick={() => void newTailoring()}>New tailored resume<Plus size={14} /></button><span className="folio-toolbar-note">{overflow.length ? `${overflow.length} layout issues` : `Layout v${project.template.revision} · ${project.template.pages.length} ${project.template.pages.length === 1 ? 'page' : 'pages'}`}</span></div>}
        <div className="workflow-bar"><nav className="stage-navigation" aria-label="Resume workflow">{stages.map((item, index) => <button key={item.id} className={`stage-button ${stage === item.id ? 'is-current' : ''} ${item.id === 'template' && approved || item.id === 'job' && matching ? 'is-complete' : ''}`} onClick={() => { if (item.id !== 'template' && !approved) { setError('Compare and approve your reconstructed template first.'); return; } setStage(item.id); setMobilePane('document'); }} aria-current={stage === item.id ? 'step' : undefined}><span className="stage-number">{item.id === 'template' && approved || item.id === 'job' && matching ? <Check size={13} /> : index + 1}</span><span className="stage-full-label">{item.label}</span><span className="stage-short-label">{item.short}</span>{index < 2 && <ChevronRight className="stage-chevron" size={13} />}</button>)}</nav><span className="workflow-caption"><LockKeyhole size={13} />Local workspace</span></div>
        <div className="mobile-pane-tabs" role="tablist" aria-label="Workspace view"><button role="tab" aria-selected={mobilePane === 'document'} onClick={() => setMobilePane('document')}>Document</button><button role="tab" aria-selected={mobilePane === 'details'} onClick={() => setMobilePane('details')}>{stage === 'template' ? 'Template review' : stage === 'job' ? 'Job & notes' : 'Evidence & export'}</button></div>
        <div className={`working-area mobile-pane-${mobilePane} ${stage === 'template' ? 'template-stage' : ''} ${stage === 'review' && !insightsOpen ? 'insights-closed' : ''}`}>
          <section className="document-workspace" aria-label="Resume document">
            {approximate && <div className="fidelity-banner" role="status"><strong>APPROXIMATE</strong><span>{project.template.fidelity ? 'Recovered layout differs from the source. Inspect every section and the final PDF.' : 'Word rendering and pagination are unverified. Compare the source and the final PDF.'}</span></div>}
            {stage === 'review' && <><header className="kit-review-title"><div><h1>{project.job.title || project.name}</h1><p>{project.job.company ? `${project.job.company} · ` : ''}{currentSaved ? 'Saved on this device' : saveLabel}</p></div><div><span>Last edited</span><time dateTime={project.updatedAt}>{new Date(project.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></div></header><section className="kit-fit-check" aria-label="Fit check"><h2>Fit check<Info size={13} /></h2><div className="kit-kpis"><div><span>Posting terms sourced</span><strong>{matching?.terms.length ? `${matching.terms.length - matching.gaps.length} of ${matching.terms.length}` : '—'}</strong><small>{matching?.gaps.length ? `${matching.gaps.length} not in saved sources` : 'Exact local term matches'}</small></div><div><span>Changes reviewed</span><strong>{changes.filter(change => isApplication && !unprovedEdits.includes(change.id) && presentation(project).changes[change.id] === 'accepted').length} of {changes.length}</strong><small>{changes.length ? 'Review each saved source' : 'Original wording preserved'}</small></div><div><span>Download</span><strong>{ready ? 'Ready' : 'Review needed'}</strong><small>{overflow.length ? `${overflow.length} layout issues` : unprovedEdits.length ? `${unprovedEdits.length} source reviews` : !pdfInspected ? 'Inspect the current PDF' : issues[0] || 'Current page fit checked'}</small></div></div></section><div className="kit-resume-heading"><h2>Tailored resume</h2><div className="kit-resume-actions"><div className="segmented-control kit-highlight-toggle" aria-label="Change highlights"><button className={!cleanHighlights ? 'is-active' : ''} aria-pressed={!cleanHighlights} onClick={() => setCleanHighlights(false)}>Highlights</button><button className={cleanHighlights ? 'is-active' : ''} aria-pressed={cleanHighlights} onClick={() => setCleanHighlights(true)}>Clean</button></div><button className="button button-primary button-small" disabled={!!busy} onClick={() => { setDownloadName(defaultResumeFileName(project)); setDownloadSettings(true); }}><ArrowDownToLine size={14} />Download</button></div></div></>}
            <div className="document-titlebar"><div><span className="eyebrow">{stage === 'template' ? 'A layout that feels like you' : stage === 'job' ? 'Your approved starting point' : 'The words are yours'}</span><h1>{stage === 'template' ? 'Check your resume.' : stage === 'job' ? 'Give your next move context.' : 'Make every word count.'}</h1></div>{stage === 'review' && <span className={`fit-status ${fitReady ? 'fit-ready' : renderStatus === 'error' || overflow.length || layoutIssues.length ? 'fit-warning' : ''}`} role="status">{renderStatus === 'rendering' ? <LoaderCircle size={14} className="spin" /> : fitReady ? <CircleCheck size={14} /> : <Info size={14} />}{renderStatus === 'rendering' ? 'Checking page fit' : renderStatus === 'error' ? 'Document needs review' : overflow.length ? `${overflow.length} layout ${overflow.length === 1 ? 'issue' : 'issues'}` : layoutIssues.length ? 'Layout needs review' : !canvasCheckCurrent ? 'Checking canvas layout' : 'Within page bounds'}</span>}</div>
            {stage === 'template' ? <>
              <TemplateInspection project={project} baselineRender={baselineRender} baselineStamp={baselinePreviewStamp} page={page} onPageChange={setPage} onSourcePreviewState={receipt => recordObservedPreview('source', receipt)} onBaselinePreviewState={receipt => recordObservedPreview('baseline', receipt)} selectedRegionId={!approved && !isApplication && repairOpen ? selectedRegion : null} onSelectRegion={(id, targetPage) => { setSelectedRegion(id); setPage(targetPage); }} />
            </> : <>
              <div className="preview-controls"><div className="segmented-control" aria-label="Document display"><button className={view === 'canvas' ? 'is-active' : ''} aria-pressed={view === 'canvas'} onClick={() => setView('canvas')}>Editable canvas</button><button className={`${view === 'pdf' ? 'is-active' : ''} review-pdf-button`} aria-pressed={view === 'pdf'} disabled={!canvasCheckCurrent || renderStatus !== 'ready' || composition} title={!canvasCheckCurrent ? 'Wait for the current canvas layout check' : 'Inspect the current PDF'} onClick={() => { setView('pdf'); setMobilePane('document'); }}>Review PDF</button></div><span className="draft-revision">Draft revision {project.draft.revision}</span></div>
              {layoutIssues.length > 0 && <div className="layout-review-banner" role="status"><Info size={15} /><span>Canvas line layout differs from the PDF. Review affected text before export.</span><button className="text-button" onClick={() => setView('pdf')}>View PDF</button></div>}
              <div style={{ display: view === 'canvas' ? undefined : 'none' }}><DocumentCanvas key={project.id} project={project} render={draftRender} selectedRegion={selectedRegion} onSelect={id => { setSelectedRegion(id); const region=project.template.pages.flatMap(page=>page.regions).find(region=>region.id===id); if(region?.kind==='text'&&changedParagraphs(project).some(change=>change.id===region.contentId)) {setInsightTab('changes');setInsightsOpen(true);} }} onEdit={handleEdits} onParagraphEdit={(id,text)=>{try{const current=projectRef.current;if(current){mutate(editSourceParagraph(current,id,text));setNotice('Bullet updated. Review its wording and fit before downloading.');}}catch(reason){setError(errorMessage(reason));}}} onParagraphReset={id=>{try{const current=projectRef.current;if(current){mutate(resetSourceParagraph(current,id));setNotice('Original bullet restored. Undo is available.');}}catch(reason){setError(errorMessage(reason));}}} onUndo={undo} onRedo={redo} canUndo={history.current.canUndo} canRedo={history.current.canRedo} onLayoutReview={(issues, revision, measuredRender) => { if (!measuredRender || measuredRender !== draftRender) return; const current = projectRef.current; if (current?.id !== project.id || current.draft.revision !== revision || current.template.revision !== project.template.revision) return; setLayoutIssues(issues); setCanvasCheck({ projectId: project.id, draftRevision: revision, templateRevision: project.template.revision, render: measuredRender }); }} onComposition={setComposition} onError={setError} visible={view === 'canvas'} /></div>
              {view === 'pdf' && <div className="canonical-preview"><div className="page-controls"><span>{project.template.pages.length} {project.template.pages.length === 1 ? 'page' : 'pages'} · This is exactly what downloads</span></div>{draftRender && draftRender.contentRevision === project.draft.revision && draftPreviewStamp?.bytes === draftRender.bytes && previewOwnerCurrent(draftPreviewStamp, previewOwnerFor(project, 'draft')) ? <div className="canonical-pages">{project.template.pages.map((_, index) => <PdfPreview key={index} bytes={draftRender.bytes} page={index + 1} label={`Current PDF page ${index + 1} of ${project.template.pages.length}`} ownerKey={previewOwnerKey(draftPreviewStamp)} onStateChange={receipt => recordObservedPreview('draft', receipt)} />)}</div> : <div className="preview-placeholder"><LoaderCircle className="spin" size={20} />Preparing current revision</div>}</div>}
            </>}
          </section>
          <aside className="context-panel" aria-label={stage === 'template' ? 'Template approval' : stage === 'job' ? 'Job context and career notes' : 'Evidence and final review'}>
            {approximate && <p className="fidelity-banner"><strong>APPROXIMATE</strong><span>Check the preserved source and every page of this PDF. Layout or Word pagination may differ.</span></p>}
            {approved && reusable && hasValidApproval(reusable) && <section className="application-start"><strong>Apply with this template.</strong><p>Paste another job description into a separate draft. Your saved applications stay intact.</p><button className="button button-secondary button-wide" disabled={!!busy} onClick={() => { setApplicationSource(reusable); setApplicationError(''); }}><Plus size={15} />New application</button></section>}
            {isApplication && project.memorySnapshot && <p className="memory-snapshot-note">Career Memory v{project.memorySnapshot.memoryRevision} · Pinned when this application was created. {reusable && reusable.careerMemory?.revision !== project.memorySnapshot.memoryRevision ? `Reusable memory is now v${reusable.careerMemory?.revision ?? 0}; this draft keeps its original evidence.` : 'New applications get the current confirmed context.'}</p>}
            {isApplication && <div className="application-name-control"><span className={`template-version ${reusable && reusable.template.revision !== project.template.revision ? 'is-older' : ''}`}>Template v{project.template.revision}{reusable && reusable.template.revision !== project.template.revision ? ` · Earlier snapshot; reusable template is v${reusable.template.revision}` : ' · Approved snapshot'}</span><button className="text-button" onClick={() => { setRenameTarget(project); setRenameText(project.name); }}>Rename application</button></div>}
            {stage === 'template' ? <>
              <div className="panel-heading"><span className="panel-icon"><FileCheck2 size={20} /></span><h2>Does this look right?</h2><p>This is your resume as Folio will edit it. Compare it with your original.</p></div>
              <div className="source-summary"><FileText size={20} /><div><strong>{project.source.name}</strong><span>{project.source.format.toUpperCase()} · {project.template.pages.length} reconstructed {project.template.pages.length === 1 ? 'page' : 'pages'}</span></div><button className="icon-button" aria-label="Download preserved original" title="Download preserved original" onClick={() => download(new Blob([new Uint8Array(project.source.bytes)], { type: project.source.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), project.source.name)}><ArrowDownToLine size={16} /></button></div>
              {project.template.warnings.some(warning => warning.severity === 'blocking') ? <section className="panel-section"><div className="section-heading"><h3>Needs attention</h3></div><div className="warnings-list">{project.template.warnings.filter(warning => warning.severity === 'blocking').map(warning => <div key={warning.id} className="warning-item warning-blocking"><Info size={14} /><span>{warning.message}</span></div>)}</div></section> : null}{project.template.warnings.some(warning => warning.severity !== 'blocking') && <details className="panel-section import-notes"><summary>{project.template.warnings.filter(warning => warning.severity !== 'blocking').length} technical notes about this import</summary><div className="warnings-list">{project.template.warnings.filter(warning => warning.severity !== 'blocking').map(warning => <div key={warning.id} className="warning-item"><Info size={14} /><span>{warning.message}</span></div>)}</div></details>}
              {!!baselineRender?.layout.overflows.length && <section className="panel-section" aria-label="Reconstruction layout issues"><div className="section-heading"><h3>Reconstruction needs attention</h3><span>{baselineRender.layout.overflows.length}</span></div><div className="warnings-list">{baselineRender.layout.overflows.slice(0, 5).map((issue, index) => <div className="warning-item warning-blocking" key={`${issue.regionId}-${issue.code}-${index}`}><Info size={14} /><span>{issue.code === 'collision' ? 'Reconstructed text overlaps neighboring content. Repair the source layout or import a matching text PDF.' : issue.message}</span></div>)}</div>{baselineRender.layout.overflows.length > 5 && <p className="subtle">More regions have layout issues. Review the reconstruction against your original before reimporting.</p>}</section>}
              {!approved && !isApplication && documentScopedProgramHashes(project.template).length>0 && <p className="subtle">This document-scoped font template keeps its original text boxes. Box adjustment is unavailable; review the unchanged source layout.</p>}
              {!approved && !isApplication && !documentScopedProgramHashes(project.template).length && <TemplateRepairPanel project={project} selectedId={selectedRegion} busy={!!busy} onOpenChange={setRepairOpen} onSelect={id => { setSelectedRegion(id); const index = project.template.pages.findIndex(item => item.regions.some(region => region.id === id)); if (index >= 0) setPage(index + 1); }} onApply={bounds => { try { if (selectedRegion) { updateCurrent(current => adjustTextRegion(current, selectedRegion, bounds)); setAcknowledged([]); } } catch (reason) { setError(errorMessage(reason)); } }} onReset={() => { try { if (selectedRegion) { updateCurrent(current => resetTextRegion(current, selectedRegion)); setAcknowledged([]); } } catch (reason) { setError(errorMessage(reason)); } }} />}
              {!approved && !isApplication && !project.template.fidelity && (baselineRender?.layout.overflows.length || project.template.warnings.some(item => item.severity === 'blocking')) && canRecoverApproximately(project) && <section className="panel-section recovery-action"><h3>Use a readable approximate layout</h3><p className="subtle">If the reconstructed layout cannot be used, recover the same readable wording in a simple one- or two-page flow. Positioning and styling can differ. Your original remains available.</p><button className="button button-secondary button-wide" disabled={!!busy} onClick={() => void recoverTemplate()}>Create approximate template</button></section>}
              {project.template.fidelity && <section className="panel-section"><div className="section-heading"><h3>Recovered content to inspect</h3><span>{project.baseline.blocks.length} blocks</span></div><div className="recovered-content">{project.baseline.blocks.map(block => <div key={block.id}><small>{allRegions.find(region => region.contentId === block.id)?.sourceLocator ?? 'Source location unknown'}</small><p>{blockText(block)}</p></div>)}</div><p className="field-help">Compare all recovered wording and objects with the preserved original. Warning checks confirm inspection; they do not recover missing content.</p></section>}
              {!earlierReconstruction && <section className="panel-section rebuild-original" aria-label="Rebuild from the retained original">
                <h3>{hasEarlierReconstruction(project) ? 'This is an earlier reconstruction' : 'Rebuild from your original'}</h3>
                <p className="subtle">{hasEarlierReconstruction(project) ? 'This saved template keeps the layout created by an earlier importer. Rebuild it to compare a fresh reconstruction using the current importer. ' : 'Create a fresh reconstruction using the retained PDF or DOCX. '}The new copy starts from your original file. Your existing drafts, applications and Career Memory stay in their current group.</p>
                <button className="button button-secondary button-wide" disabled={!!busy} onClick={() => void rebuildOriginal()}><RotateCcw size={15} />Rebuild from original</button>
              </section>}
              <section className="panel-section preservation-note"><ShieldCheck size={18} /><div><strong>Your original stays intact.</strong><p>Approving creates a reusable layout. Draft edits won’t replace the original file.</p></div></section>
              {documentScopedProgramHashes(project.template).length>0&&!approved&&<section className="panel-section"><label><input type="checkbox" checked={fontReuseChoice===fontReuseOwner(project)} onChange={event=>{const choice=event.target.checked?fontReuseOwner(project):null;fontReuseChoiceRef.current=choice;setFontReuseChoice(choice);}}/>{project.template.sourceType1Baseline?(project.template.sourceType1Baseline.editableSlot?'I have permission to reuse the fonts embedded in this resume for this edited PDF.':'I have permission to reuse the fonts embedded in this resume for this original-layout PDF.'):SOURCE_FONT_REUSE_TEXT}</label><p className="subtle">These original font programs contain no embedding-permission metadata. Folio cannot verify permission; this records your choice for this resume.</p></section>}
              <div className="panel-action">{approved ? <><div className="approved-line"><CircleCheck size={17} />Template approved</div><button className="button button-primary button-wide" disabled={!!project.template.sourceType1Baseline} onClick={() => void newTailoring()}>Continue to job<ArrowRight size={16} /></button><button className="button button-secondary button-wide" onClick={()=>{setStage('review');setInsightsOpen(false);}}>{project.template.sourceType1Baseline?'Open layout review':'Open document editor'}</button>{!isApplication&&<button className="text-button" onClick={()=>void openMemory(project)}>Add context · Optional<BookOpen size={14}/></button>}<button className="text-button muted-button" onClick={() => { fontReuseChoiceRef.current=null;setFontReuseChoice(null);updateCurrent(withdrawApproval); setAcknowledged([]); }}>Withdraw approval</button></> : <><p className="action-note">Check that your resume looks right on the left, then continue.</p><button className="button button-primary button-wide" disabled={!!busy || documentScopedProgramHashes(project.template).length>0&&fontReuseChoice!==fontReuseOwner(project) || !templatePreviewReady || !baselineRender || !!baselineRender.layout.overflows.length || project.template.warnings.some(warning => warning.severity === 'blocking')} onClick={() => void approve()}><Check size={16} />{approximate ? 'Use this approximate layout' : 'Looks right — continue'}</button>{baselineRender?.layout.overflows.length ? <p className="inline-error">The reconstructed text exceeds its regions. Repair the source and upload again before approval.</p> : null}{project.template.warnings.some(warning => warning.severity === 'blocking') && <p className="inline-error">An unsupported feature blocks approval. Repair the original or upload a simpler document.</p>}</>}</div>
            </> : stage === 'job' ? <>
              <div className="panel-heading"><span className="panel-icon"><FolderClosed size={20} /></span><h2>What’s your next move?</h2><p>A little context helps you find the right parts of your story.</p></div>
              <section className="panel-section job-form"><label>Job description<textarea value={project.job.description} placeholder="Paste the responsibilities, requirements, and anything else that matters for this role…" rows={10} maxLength={50000} onChange={event => { updateCurrent(current => setJob(current, { ...current.job, description: event.target.value }), 'job:description'); setMatching(null); }} /></label><p className="field-help">The description is context, never a source of qualifications.</p><details className="job-optional-fields"><summary>Add title and company (optional)</summary><div className="field-row"><label>Role title<input value={project.job.title} placeholder="e.g. Product Designer" maxLength={300} onChange={event => updateCurrent(current => setJob(current, { ...current.job, title: event.target.value }), 'job:title')} /></label><label>Company<input value={project.job.company} placeholder="e.g. Northstar" maxLength={300} onChange={event => updateCurrent(current => setJob(current, { ...current.job, company: event.target.value }), 'job:company')} /></label></div></details></section>
              <section className="panel-section"><div className="section-heading"><h3>More to your story?</h3><span>Optional</span></div><p className="subtle">Add a real accomplishment or skill missing from your resume. {isApplication ? 'Notes here belong only to this application.' : 'Notes here belong only to this current draft. Use Career Memory for reusable details.'}</p><label className="visually-hidden" htmlFor="career-note">Career note</label><textarea id="career-note" value={notesText} onChange={event => setNotesText(event.target.value)} placeholder="A project, result, skill, or career detail you can stand behind…" rows={4} maxLength={10000} /><label className="checkbox-label"><input type="checkbox" checked={noteConfirmed} onChange={event => setNoteConfirmed(event.target.checked)} /><span>I confirm this note is accurate.</span></label><button className="button button-small button-secondary" disabled={!notesText.trim() || !noteConfirmed} onClick={() => { try { const live = projectRef.current; if (!live) return; const current = noteEditingId ? removeCareerNote(live, noteEditingId) : live; mutate(addCareerNote(current, notesText)); setNotesText(''); setNoteConfirmed(false); setNoteEditingId(null); } catch (reason) { setError(errorMessage(reason)); } }}>{noteEditingId ? <Check size={14} /> : <Plus size={14} />}{noteEditingId ? 'Save note changes' : 'Save career note'}</button>{noteEditingId && <button className="text-button note-edit-cancel" onClick={() => { setNoteEditingId(null); setNotesText(''); setNoteConfirmed(false); }}>Cancel edit</button>}{project.notes.length > 0 && <div className="career-notes">{project.notes.map(note => <div key={note.id}><span>{note.text}</span>{isApplication && <button className="text-button" disabled={!!busy} onClick={() => void promoteNote(note.id)}>Save to Career Memory</button>}<button className="icon-button" aria-label="Edit career note" onClick={() => { if (project.draft.blocks.some(block => block.sourceFactIds.includes(note.id))) { setError('This note supports the current draft. Revert the supported paragraph before changing the note.'); return; } setNoteEditingId(note.id); setNotesText(note.text); setNoteConfirmed(false); document.getElementById('career-note')?.focus(); }}><Pencil size={13} /></button><button className="icon-button" aria-label="Delete career note" onClick={() => { try { updateCurrent(current => removeCareerNote(current, note.id)); setMatching(null); } catch (reason) { setError(errorMessage(reason)); } }}><Trash2 size={14} /></button></div>)}</div>}</section>
              <div className="local-matching-note"><HardDrive size={17} /><div><strong>Local matching</strong><p>Ranks exact evidence from your resume and confirmed notes. Ranks supplied facts without rewriting or external upload.</p></div></div><div className="panel-action"><button className="button button-primary button-wide" disabled={!project.job.description.trim()} onClick={match}>Find relevant evidence<ArrowRight size={16} /></button></div>
            </> : <>
              <div className="panel-heading review-heading"><span className="eyebrow">Local matching</span><h2>A story backed by you.</h2><p>{project.job.title ? <>For <strong>{project.job.title}</strong>{project.job.company ? ` at ${project.job.company}` : ''}</> : 'Evidence from your resume and confirmed career notes.'}</p><button className="text-button" onClick={() => setStage('job')}>Edit job context<ArrowRight size={13} /></button></div>
              <section className="panel-section selected-region-section"><label htmlFor="selected-region">Selected paragraph</label><select id="selected-region" value={selectedRegion ?? ''} onChange={event => setSelectedRegion(event.target.value)}>{allRegions.map(region => { const text = project.draft.blocks.find(block => block.id === region.contentId); return <option key={region.id} value={region.id}>{blockText(text ?? { id: '', runs: [], sourceFactIds: [] }).slice(0, 55) || 'Empty paragraph'}</option>; })}</select><p className="field-help">Click a paragraph on the page to choose where reviewed evidence goes.</p></section>
              <WorkspaceInsights project={project} busy={!!busy} tab={insightTab} onTabChange={setInsightTab} onClose={() => setInsightsOpen(false)} onNewFromJob={() => void newTailoring(project.job.description)} onPrivateNotes={text => updateCurrent(current => setPresentation(current, { privateNotes: text }), 'private-notes')} onDecideMany={decideMany} onSelectBlock={selectReviewBlock} readiness={<><QuickDownload claimsConfirmed={project.reviewedDraftRevision === project.draft.revision} checked={finalConfirmed} onCheckedChange={setFinalConfirmed} onDownload={() => guidedDownload()} pending={!!pendingDownload} progress={downloadProgress} blocking={downloadBlocking} busy={!!busy} /><DocumentReadability project={project} onLocate={resolveReadiness} /></>} onRevert={id => decideChange(id, 'rejected')} onAccept={id => decideChange(id, 'accepted')} onRestoreVersion={restoreContentVersion} onCompareVersion={setCompareVersionId} selectedBlockId={selectedBlock?.id} onAddEvidence={(blockId,text) => setEvidenceTarget({projectId:project.id,blockId,text})}>
              <section className="panel-section evidence-section"><div className="section-heading"><h3>Relevant evidence</h3><span>{matching?.evidence.length ?? 0}</span></div>{matching?.evidence.length ? <div className="evidence-list">{matching.evidence.slice(0, visibleEvidenceCount).map(evidence => <article key={evidence.factId} className={`evidence-card ${decisions[evidence.factId]?.status === 'rejected' ? 'is-rejected' : ''}`}><div className="evidence-origin"><span>{evidence.source === 'resume' ? 'Uploaded resume' : evidence.source === 'careerNote' ? 'Confirmed career note' : 'Confirmed manual edit'}</span>{decisions[evidence.factId]?.status === 'accepted' && <span className="accepted-tag"><Check size={11} />{evidenceInsertionCurrent(project, decisions[evidence.factId]) ? 'Inserted' : 'Changed since insertion'}</span>}</div><p>{evidence.text}</p><div className="term-tags">{evidence.matchedTerms.slice(0, 5).map(term => <span key={term}>{term}</span>)}</div><div className="evidence-actions"><button className="text-button" disabled={!selectedRegion} onClick={() => setPendingEvidence(evidence)}>Review insertion<ArrowRight size={13} /></button><button className="text-button muted-button" onClick={() => { try { const inserted = project.evidenceDecisions[evidence.factId]?.status === 'accepted'; updateCurrent(current => dismissEvidence(current, evidence.factId)); setNotice(inserted ? 'Evidence dismissed. Previous paragraph wording restored. Undo is available.' : 'Evidence dismissed. Undo is available.'); } catch (reason) { setError(errorMessage(reason)); } }}>Dismiss</button></div></article>)}</div> : <div className="empty-evidence"><FileText size={19} /><p>{matching ? 'No direct term matches found. You can edit your document using facts you can confirm.' : 'Add a job description to find relevant evidence.'}</p>{!matching && <button className="text-button" onClick={() => setStage('job')}>Add context<ArrowRight size={13} /></button>}</div>}{matching && matching.evidence.length > visibleEvidenceCount && <div className="evidence-pagination"><p className="field-help">Showing {visibleEvidenceCount} of {matching.evidence.length} matching facts.</p><button className="text-button" onClick={() => setVisibleEvidenceCount(count => count + 12)}>Show more evidence<ChevronDown size={14} /></button></div>}{matching?.gaps.length ? <details className="gaps-details"><summary><Info size={14} />{matching.gaps.length} terms without matching evidence<ChevronDown size={14} /></summary><div className="term-tags gap-tags">{matching.gaps.map(term => <span key={term}>{term}</span>)}</div><p>Term gaps are a prompt for review, not an assessment of qualification. Add only experience you actually have.</p></details> : null}</section>
              <AiTailoringPanel key={project.id} project={project} selectedBlockId={selectedBlock?.id} disabled={!!busy || !currentSaved} onAccept={acceptAi} onStartApplication={reusable ? () => { setApplicationSource(reusable); setApplicationError(''); } : undefined} />
              {baselineNeedsReview.length > 0 && <section className="panel-section memory-baseline-warning" role="alert"><h3>Original wording needs review</h3><p>{baselineNeedsReview.length} original {baselineNeedsReview.length === 1 ? 'paragraph contains' : 'paragraphs contain'} excluded or corrected resume evidence. Change or remove that exact original wording on the canvas before export. Confirming the draft alone does not resolve it.</p></section>}
              {overflow.length > 0 && <section className="panel-section overflow-section"><h3>Text needs more room</h3>{overflow.map((issue, index) => <button key={`${issue.regionId}-${index}`} onClick={() => { setSelectedRegion(issue.regionId); setView('canvas'); setMobilePane('document'); }}><Info size={14} /><span>{issue.message}</span></button>)}<p>Shorten or remove text in the affected paragraph. Page size, fonts, and margins stay fixed.</p></section>}
              <section className="panel-section draft-changes"><div className="section-heading"><h3>Your draft changes</h3><span>{changes.length}</span></div>{changes.length ? <>{changes.map(change => <details key={change.id}><summary>{change.after.slice(0, 65) || 'Paragraph removed'}<ChevronDown size={13} /></summary><div className="before-after"><span>Original</span><p>{change.before || 'Empty paragraph'}</p><span>Current draft</span><p>{change.after || 'Removed'}</p></div></details>)}<button className="text-button muted-button" onClick={() => { updateCurrent(revertDraft); setNotice('Draft restored to the approved original wording. Undo is available.'); }}><RotateCcw size={13} />Revert all draft edits</button></> : <p className="subtle">No wording changed yet. Your original text is preserved.</p>}</section>
              <QuickDownload claimsConfirmed={project.reviewedDraftRevision === project.draft.revision} checked={finalConfirmed} onCheckedChange={setFinalConfirmed} onDownload={() => guidedDownload()} pending={!!pendingDownload} progress={downloadProgress} blocking={downloadBlocking} busy={!!busy} />
              </WorkspaceInsights>
            </>}
          </aside>
        </div>
      </>}
      <footer className="workspace-footer"><span>Made for your next chapter.</span><button onClick={openPrivacy}>Private by default<LockKeyhole size={11} /></button></footer>
    </main>
    {reviewedSource && memory && memoryProjection && <Modal title="Review supporting context" className="memory-source-modal" onClose={() => setSourceReviewId(null)}><ContextSourceReview key={reviewedSource.id} source={reviewedSource} memory={memory} view={memoryProjection} {...assertionActions} saveState={memorySaveState} saveError={memoryError || error} onRetrySave={retryMemorySave} onAddAssertion={async (sourceId, segmentId, text) => { await asyncMemoryAction((current, revision) => createMemoryAssertion(current, { sourceId, segmentId, text }, revision)); }} onReviewSource={setSourceReviewId} onClose={() => setSourceReviewId(null)} /></Modal>}
    {groupRemoval && <Modal title="Delete this entire resume group?" onClose={() => { if (!busy) setGroupRemoval(null); }}><p className="modal-copy">This permanently removes the following {groupRemoval.projects.length} local records, their Career Memory, supporting originals, and evidence snapshots from this device.</p><ul className="group-delete-scope">{groupRemoval.projects.map(item => <li key={item.id}><strong>{item.name}</strong><span>{item.kind === 'resume' ? 'Reusable resume and Career Memory' : 'Application and pinned snapshot'}</span></li>)}</ul>{memory && <details className="group-delete-sources" open><summary>Career Memory and {memory.sources.length} retained context sources</summary><p>{memory.assertions.length} career details, their versions, confirmations and unfinished drafts.</p><ul><li>Primary original: {project?.source.name}</li>{memory.sources.map(source => <li key={source.id}>{source.name}{source.kind === 'supportingFile' ? ' · Supporting original and extracted text' : ' · Supplied text'}</li>)}</ul></details>}<p className="modal-copy">Downloaded backups, exported PDFs, and outside copies remain. Download a group backup first if you want to keep a copy.</p>{error && <p className="inline-error" role="alert">{error} Close this preview and review the current deletion scope before trying again.</p>}<div className="modal-actions"><button className="button button-secondary" disabled={!!busy} onClick={() => setGroupRemoval(null)}>Keep resume group</button><button className="button button-danger" disabled={!!busy} onClick={() => void purgeGroup()}><Trash2 size={15} />Delete entire resume group</button></div></Modal>}
    {resumeChooserOpen && <Modal title="Choose your resume" onClose={() => { if (!composerNavigating) setResumeChooserOpen(false); }} className="folio-resume-chooser"><p className="modal-copy">Each saved tailoring keeps its own resume and layout. Choosing another resume starts a separate draft with the job you entered.</p>{retainedChoiceNotice && <p className="modal-copy">{retainedChoiceNotice}</p>}<ResumeChoices disabled={composerNavigating || !!busy} sources={reusableSources(library)} current={sourceForComposer()} defaultId={freshDefault?.id ?? null} onSelect={source => void selectComposerSource(source)} onDefault={source => void makeComposerDefault(source)} />{sourceForComposer() && <button className="button button-secondary" disabled={composerNavigating || !!busy} onClick={() => { const source = sourceForComposer(); if (source) void inspectLayout(source, true); }}>View selected layout</button>}<button className="button button-secondary" disabled={composerNavigating || !!busy} onClick={() => void openTemplates()}>Manage layouts</button><button className="button button-primary" disabled={composerNavigating || !!busy} onClick={() => { setResumeChooserOpen(false); fileInput.current?.click(); }}><Upload size={16} />Upload another resume</button></Modal>}
    {applicationSource && <ApplicationDialog resumeName={applicationSource.name} busy={createInFlight.current} error={applicationError} onClose={() => { if (!createInFlight.current) { setApplicationSource(null); setApplicationError(''); } }} onPrepare={job => void prepareApplication(job)} />}
    {reloadTarget && <Modal title="Reload the saved version?" onClose={() => setReloadTarget(null)}><p className="modal-copy">This replaces the open unsaved edits for <strong>{reloadTarget.name}</strong> with the successfully stored version. Download a backup of your unsaved edits before reloading if you want to keep them.</p><div className="modal-actions"><button className="button button-secondary" onClick={() => setReloadTarget(null)}>Keep open edits</button><button className="button button-primary" onClick={() => { openProject(reloadTarget, true); setReloadTarget(null); setNotice('Saved version reloaded. Review the current wording before export.'); }}>Reload saved version</button></div></Modal>}
    {renameTarget && <Modal title="Rename application" onClose={() => setRenameTarget(null)}><label>Application name<input autoFocus value={renameText} maxLength={500} onChange={event => setRenameText(event.target.value)} /></label><div className="modal-actions"><button className="button button-secondary" onClick={() => setRenameTarget(null)}>Cancel</button><button className="button button-primary" disabled={!renameText.trim()} onClick={() => { void (async()=>{try{const current=projectRef.current?.id===renameTarget.id?projectRef.current:projects.find(item=>item.id===renameTarget.id)??renameTarget;const next=renameApplication(current,renameText);if(projectRef.current?.id===next.id)mutate(next);await persist(next);setRenameTarget(null);}catch(reason){setError(errorMessage(reason));}})(); }}>Save name</button></div></Modal>}
    {downloadSettings && project && <Modal title="Download resume" className="kit-download-modal" onClose={()=>setDownloadSettings(false)}><div className="kit-download-options"><div className="kit-download-option selected"><span className="kit-option-radio" aria-hidden="true" /><div><strong>PDF</strong><p>Best for most applications. Looks the same everywhere.</p></div></div><div className="kit-download-option unavailable" aria-disabled="true"><span className="kit-option-radio" aria-hidden="true" /><div><strong>Word (.docx)</strong><p>Editable Word export is not available for this layout.</p></div></div></div><div className="folio-download-form"><label>File name<div><input aria-label="File name" autoFocus value={downloadName} maxLength={100} onChange={event=>setDownloadName(event.target.value)}/><span aria-hidden="true">.pdf</span></div></label><p>Highlights are only for you. The file is clean.</p><small>{project.template.pages.length} {project.template.pages.length === 1 ? 'page' : 'pages'} · Original page size</small>{project.reviewedDraftRevision !== project.draft.revision && <label className="checkbox-label kit-download-confirm"><input type="checkbox" checked={finalConfirmed} onChange={event => setFinalConfirmed(event.target.checked)} /><span>Everything in this resume is true.</span></label>}{downloadBlocking && <p className="kit-download-review" role="alert">{downloadBlocking}</p>}</div><div className="modal-actions"><button className="button button-secondary" onClick={()=>setDownloadSettings(false)}>Cancel</button><button className="button button-primary" disabled={!downloadName.trim()||!!busy||composition||!!downloadBlocking||!!pendingDownload||(project.reviewedDraftRevision !== project.draft.revision && !finalConfirmed)} onClick={()=>guidedDownload(downloadName)}><ArrowDownToLine size={15} />Download PDF</button></div></Modal>}
    {compareVersionId && project?.folio?.versions.find(version=>version.id===compareVersionId) && <Modal title={`Compare versions · ${project.job.company || project.name}`} className="folio-compare-modal folio-compare-fullscreen" backLabel="Back to resume" headerAction={<button className="button button-secondary" onClick={()=>{restoreContentVersion(compareVersionId);setCompareVersionId(null);}}>Restore saved version</button>} onClose={()=>setCompareVersionId(null)}><VersionComparison key={`${project.id}:${compareVersionId}`} project={project} version={project.folio.versions.find(version=>version.id===compareVersionId)!} restoreInHeader onRestore={()=>{restoreContentVersion(compareVersionId);setCompareVersionId(null);}} /></Modal>}
    {evidenceTarget && project?.id===evidenceTarget.projectId && <Modal title="Confirm your actual experience" onClose={()=>setEvidenceTarget(null)}><ConfirmedEvidence initial={evidenceTarget.text ?? (evidenceTarget.blockId ? blockText(project.draft.blocks.find(block=>block.id===evidenceTarget.blockId)!) : '')} targeted={!!evidenceTarget.blockId} onMemory={()=>{setEvidenceTarget(null);const source=projects.find(item=>workspaceOf(item).kind==='resume'&&workspaceOf(item).templateGroupId===workspaceOf(project).templateGroupId);if(source)void openMemory(source);else setError('The reusable resume is unavailable. Restore its group backup to edit Career Memory.');}} onSave={text=>{const current=projectRef.current;if(!current||current.id!==evidenceTarget.projectId)return;try{let next=addCareerNote(current,text);if(evidenceTarget.blockId)next=insertEvidence(next,next.notes.at(-1)!.id,evidenceTarget.blockId);mutate(next);setEvidenceTarget(null);setNotice('Your exact confirmed fact is saved for this tailoring. Inspect the page fit.');}catch(reason){setError(errorMessage(reason));}}}/></Modal>}

    {deleteTarget && <Modal title={workspaceOf(deleteTarget).kind === 'application' ? 'Delete this application?' : 'Delete this reusable resume?'} onClose={() => setDeleteTarget(null)}><p className="modal-copy">This removes <strong>{deleteTarget.name}</strong>, this record’s draft, job context, career notes and original copy from this device. {workspaceOf(deleteTarget).kind === 'resume' && <>Its Career Memory and supporting originals are also removed. </>}Other saved applications retain their own original copies and pinned evidence. If you delete the reusable resume, restore a backup to start more applications from it. Download a backup first if you want to keep this record.</p><div className="modal-actions"><button className="button button-secondary" onClick={() => setDeleteTarget(null)}>Keep record</button><button className="button button-danger" disabled={!!busy} onClick={() => void deleteResume(deleteTarget)}><Trash2 size={15} />{workspaceOf(deleteTarget).kind === 'application' ? 'Delete application' : 'Delete resume'}</button></div></Modal>}
    {pendingEvidence && <Modal title="Review this exact evidence" onClose={() => setPendingEvidence(null)} className="evidence-modal"><p className="modal-copy">This replaces only the selected paragraph. Its approved style and position stay fixed.</p><div className="insertion-context"><span>Selected paragraph</span><p>{selectedBlock ? blockText(selectedBlock) : 'Choose a paragraph on the canvas first.'}</p><span>Proposed exact source text</span><p>{pendingEvidence.text}</p></div><div className="evidence-source-note"><ShieldCheck size={16} /><span>{pendingEvidence.source === 'resume' ? 'Source: uploaded resume' : pendingEvidence.source === 'careerNote' ? 'Source: your confirmed career note' : 'Source: applicant-confirmed manual edit'}. No wording was generated.</span></div><div className="modal-actions"><button className="button button-secondary" onClick={() => setPendingEvidence(null)}>Keep current wording</button><button className="button button-primary" disabled={!selectedBlock} onClick={acceptEvidence}><Check size={15} />Replace selected paragraph</button></div></Modal>}
  </div>;
}
