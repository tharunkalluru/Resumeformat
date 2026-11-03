// @vitest-environment jsdom
// Actual App with controlled boundaries. No browser scheduling/fidelity claim.
import 'fake-indexeddb/auto';
import { openDB, deleteDB } from 'idb';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../core/model';
import { defaultResumePreference } from '../storage/templatePreferences';
import { approvedControlProject, revisedControlProject, deferred } from './integrationControlFixture';

// Harmonize byte arrays before z.instanceof captures its constructor.
vi.hoisted(() => { vi.stubGlobal('Uint8Array', new TextEncoder().encode('').constructor); });

const h = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), legacy: vi.fn(), canonical: vi.fn(), commit: vi.fn(), migrate: vi.fn(),
  recover: vi.fn(), provider: vi.fn(), render: vi.fn(), remove: vi.fn(), account: null as any, composer: null as any,
  templates: null as any, choices: null as any, canvas: null as any, privacy: null as any, groupChanged: null as any,
  firstClick: null as 'profile' | 'privacy' | null, actualCanonical: null as any, memory: null as any, home: null as any, insights: null as any }));
vi.mock('../storage/projects', () => ({ loadLibrary: h.load, saveProject: h.save, removeProject: h.remove,
  subscribeGroupChanges: (callback: unknown) => { h.groupChanged = callback; return () => {}; }, adoptProjectCheckpoint: vi.fn(),
  backupProject: vi.fn(), backupResumeGroup: vi.fn(), backupUnavailableProject: vi.fn(), createSavedApplication: vi.fn(),
  restoreBackup: vi.fn(), previewGroupRemoval: vi.fn(), removeGroup: vi.fn() }));
vi.mock('../storage/composerPreferences', () => ({ loadComposerPreferences: h.legacy }));
vi.mock('../storage/templatePreferences', async importActual => { const actual = await importActual<any>(); h.actualCanonical = actual.loadDefaultResume; return { ...actual, loadDefaultResume: h.canonical, commitDefaultResume: h.commit }; });
vi.mock('../storage/composerBridge', async importActual => ({ ...(await importActual<object>()), migrateLegacyDefault: h.migrate }));
vi.mock('../storage/profile', () => ({ loadPrivateProfile: vi.fn(async () => null), savePrivateProfile: vi.fn() }));
vi.mock('../storage/draftJournal', () => ({ recoverJournal: h.recover, journalDraft: vi.fn(() => false), clearJournal: vi.fn() }));
vi.mock('../import/index', () => ({ importResume: vi.fn(() => { throw new Error('Import not released by this control'); }) }));
vi.mock('../import/context', () => ({ extractContextSource: vi.fn() }));
vi.mock('../import/recovery', () => ({ canRecoverApproximately: () => false, recoverApproximate: vi.fn() }));
vi.mock('../import/rebuild', () => ({ currentReconstruction: () => undefined, hasEarlierReconstruction: () => false, rebuildFromOriginal: vi.fn() }));
vi.mock('../render/pdf', () => ({ renderProjectDocument: h.render, renderDocument: vi.fn(), renderProjectHistory: vi.fn() }));
vi.mock('../tailoring/flow', () => ({ runTailoring: h.provider }));
vi.mock('./AiTailoringPanel', () => ({ AiTailoringPanel: () => null }));
vi.mock('./PdfPreview', () => ({ PdfPreview: () => null, DocxReference: () => null }));
vi.mock('./DocumentCanvas', async () => {
  const React = await import('react');
  return { runsSignature: (block: unknown) => JSON.stringify(block), DocumentCanvas: (props: any) => {
    h.canvas = props; return React.createElement('div', { 'data-control-project': props.project.id, 'data-control-revision': props.project.revision });
  } };
});
vi.mock('./DesignChrome', async importActual => {
  const actual = await importActual<any>(), React = await import('react');
  return { ...actual,
    AccountMenu: (props: any) => {
      h.account = props; const button = React.useRef<HTMLButtonElement>(null);
      React.useLayoutEffect(() => { if (h.firstClick) { h.firstClick = null; button.current!.click(); } }, []);
      return React.createElement(React.Fragment, null, React.createElement(actual.AccountMenu, props),
        React.createElement('button', { ref: button, hidden: true, 'data-control-first-click': true,
          onClick: h.firstClick === 'profile' ? props.onProfile : props.onSettings }));
    },
    JobComposer: (props: any) => { h.composer = props; return React.createElement(actual.JobComposer, props); },
    HomeWorkspace: (props: any) => { h.home = props; return React.createElement(actual.HomeWorkspace, props); },
    WorkspaceInsights: (props: any) => { h.insights = props; return React.createElement(actual.WorkspaceInsights, props); },
  };
});
vi.mock('./TemplatesManager', async importActual => {
  const actual = await importActual<any>(), React = await import('react');
  return { ...actual, TemplatesManager: (props: any) => { h.templates = props; return React.createElement(actual.TemplatesManager, props); } };
});
vi.mock('./ResumeChoices', async importActual => {
  const actual = await importActual<any>(), React = await import('react');
  return { ...actual, ResumeChoices: (props: any) => { h.choices = props; return React.createElement(actual.ResumeChoices, props); } };
});
vi.mock('./PrivacySettings', async importActual => {
  const actual = await importActual<any>(), React = await import('react');
  return { ...actual, PrivacySettings: (props: any) => { h.privacy = props; return React.createElement(actual.PrivacySettings, props); } };
});
vi.mock('./CareerMemoryEditor', async importActual => {
  const actual = await importActual<any>(), React = await import('react');
  return { ...actual, CareerMemoryEditor: (props: any) => { h.memory = props; return React.createElement(actual.CareerMemoryEditor, props); } };
});
import { initCareerMemory } from '../core/careerMemory';
import { createApplication } from '../core/applications';
import { setPresentation } from '../core/folio';
import { hashJson, rendererVersionFor, type SourceFontAsset,type SourceStandardFont } from '../core/model';
import App from '../App';

let root: Root, host: HTMLDivElement, a: Project, b: Project;
beforeEach(async () => {
  await deleteDB('folio-private-ui-v1');
  // Node's structuredClone/crypto return Node byte arrays. Use that same
  // constructor in this jsdom control so real project validation sees one realm.
  vi.stubGlobal('Uint8Array', new TextEncoder().encode('').constructor);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { queueMicrotask(() => callback(0)); return 1; });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No request is released by these controls'); }));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  for (const mock of [h.load, h.save, h.legacy, h.canonical, h.commit, h.migrate, h.recover, h.provider, h.render, h.remove]) mock.mockReset();
  h.account = h.composer = h.templates = h.choices = h.canvas = h.privacy = h.memory = h.home = null; h.firstClick = null;
  a = await approvedControlProject('Control A'); b = await approvedControlProject('Control B');
  h.load.mockResolvedValue({ projects: [a, b], unavailable: [] }); h.save.mockResolvedValue(undefined);
  h.legacy.mockResolvedValue({ selectedId: null, defaultId: null }); h.canonical.mockResolvedValue(await defaultResumePreference(a));
  h.migrate.mockImplementation(async (_projects: unknown, _legacy: unknown, value: unknown) => value);
  h.commit.mockImplementation(async (value: unknown) => value); h.recover.mockReturnValue(null);
  h.render.mockImplementation(() => new Promise(() => {}));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
});
async function flush(action?: () => void) {
  await act(async () => { action?.(); for (let i = 0; i < 6; i++) await new Promise<void>(resolve => setImmediate(resolve)); });
}
async function mount(enterComposer = true) {
  await flush(() => root.render(createElement(App)));
  // Existing controls start at the composer boundary through the real nav.
  if (enterComposer && host.querySelector('.kit-home')) await flush(() => button('Tailor a resume').click());
}
const selectedId = () => host.querySelector('.project-item.is-current')?.getAttribute('data-project-id') ?? null;
const surface = () => host.querySelector('#templates-title') ? 'templates' : host.querySelector('.folio-profile') ? 'profile' :
  host.querySelector('.folio-privacy-screen') ? 'privacy' : host.querySelector('.folio-help') ? 'help' : host.querySelector('.kit-home') ? 'home' : host.querySelector('.folio-compose') ? 'compose' : 'studio';
const chooserOpen = () => !!host.querySelector('.folio-resume-chooser[open]');
function button(text: string) {
  const matches = (item: HTMLButtonElement) => item.getAttribute('aria-label') === text || item.textContent?.trim() === text;
  const result = [...host.querySelectorAll<HTMLButtonElement>('button[role=menuitem]')].find(matches) ?? [...host.querySelectorAll<HTMLButtonElement>('button')].find(matches);
  expect(result).toBeTruthy(); return result!;
}
async function openTemplates() { await flush(() => button('Templates').click()); }
async function dirty() {
  const changed = { ...a, revision: a.revision + 1 };
  h.recover.mockImplementation((item: Project) => item.id === a.id ? changed : null);
  await mount(false);
  // Review-request navigation intentionally preserves the current unsaved
  // owner. Starting a new tailoring would correctly persist it first.
  await flush(() => h.account.onSettings());
  await flush(() => h.privacy.onReviewConsent());
}
function noTransfer() {
  expect(h.provider).not.toHaveBeenCalled(); expect(h.remove).not.toHaveBeenCalled();
  // The product now reads local readiness. This is the sole allowed request:
  // no model verification, inference, resume content or external URL is sent.
  for (const [url, options] of vi.mocked(fetch).mock.calls) {
    expect(url).toBe('/api/ai/status'); expect(options?.method).toBe('GET');
    expect(options?.body).toBeUndefined(); expect(options?.credentials).toBe('same-origin');
  }
}

describe('actual App preference and synchronous route ownership controls', () => {
  it('opens Home without tailoring, carries its job into the real composer, and preserves it through the Home tab', async () => {
    await mount(false); expect(surface()).toBe('home'); expect(h.composer).toBeNull();
    expect(button('Continue to tailoring').disabled).toBe(true); noTransfer();
    const text = 'Authored frontend role: build accessible React dashboards with TypeScript.';
    await flush(() => h.home.onChange(text));
    expect(surface()).toBe('home'); expect(h.save).not.toHaveBeenCalled();
    await flush(() => button('Continue to tailoring').click());
    expect(surface()).toBe('compose'); expect(h.composer.value).toBe(text); expect(h.composer.consent).toBe(false);
    await flush(() => host.querySelector<HTMLButtonElement>('.kit-tabs .kit-tab')!.click());
    expect(surface()).toBe('home'); expect(h.home.value).toBe(text);
    await flush(() => button('Continue to tailoring').click());
    expect(surface()).toBe('compose'); expect(h.composer.value).toBe(text); noTransfer();
  });
  it.each([[8,false],[8,true],[9,false],[9,true]] as const)('keeps source-font baseline preview available and current rendering approval-bound (version=%s, approved=%s)', async (version,approved) => {
    // Only the library classification boundary is controlled here. The real
    // two-page upload/browser/oracle checks establish font and PDF fidelity.
    a.template.sourceFonts = [{ sourceVersion: version } as SourceFontAsset];
    a.approval = approved ? { ...a.approval!, layoutHash: await hashJson(a.template), rendererVersion: rendererVersionFor(a.template) } : null;
    h.load.mockResolvedValue({ projects: [a], unavailable: [] }); h.canonical.mockResolvedValue(null);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await mount();
      expect(selectedId()).toBe(a.id);
      expect(h.render.mock.calls.filter(([, purpose]) => purpose === 'baselinePreview')).toHaveLength(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
      expect(h.render.mock.calls.filter(([, purpose]) => purpose === 'current')).toHaveLength(approved ? 1 : 0);
      expect(host.textContent).not.toContain('I have permission to reuse the fonts embedded in this resume');
      noTransfer();
    } finally { vi.useRealTimers(); }
  });
  it.each([false,true])('keeps Standard14 native current approval-bound while leaving baseline comparison available (approved=%s)',async approved=>{
    a.template.sourceStandardFonts=[{version:'standard14-winansi-v1'} as SourceStandardFont];a.approval=approved?{...a.approval!,layoutHash:await hashJson(a.template),rendererVersion:rendererVersionFor(a.template)}:null;
    h.load.mockResolvedValue({projects:[a],unavailable:[]});h.canonical.mockResolvedValue(null);vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    try{await mount();expect(h.render.mock.calls.filter(([,purpose])=>purpose==='baselinePreview')).toHaveLength(1);await act(async()=>{await vi.advanceTimersByTimeAsync(400);});expect(h.render.mock.calls.filter(([,purpose])=>purpose==='current')).toHaveLength(approved?1:0);expect(host.textContent).not.toContain('permission to reuse');noTransfer();}finally{vi.useRealTimers();}
  });
  it.each(['canonical', 'legacy'] as const)('publishes a valid library after rejected %s read and keeps default recovery approval-bound', async key => {
    h[key].mockRejectedValue(new Error('Controlled read refusal')); await mount();
    expect(selectedId()).toBe(a.id); expect(h.composer.resume).toBeUndefined(); expect(host.textContent).toContain('could not be read');
    await openTemplates(); expect(h.templates.projects).toHaveLength(2);
    await flush(() => [...host.querySelectorAll<HTMLElement>('.folio-template-card')]
      .find(item => item.textContent?.includes(b.source.name))!
      .querySelector<HTMLButtonElement>('.folio-template-info .text-button')!.click());
    if (key === 'canonical') {
      // An unread canonical value is not absent and cannot safely be replaced.
      expect(h.commit).not.toHaveBeenCalled(); expect(h.templates.preferenceError).toContain('could not be read');
      await flush(() => h.templates.onInspect(b)); expect(surface()).toBe('studio'); expect(selectedId()).toBe(b.id);
    } else {
      await flush(() => button('Tailor a job').click()); expect(h.composer.resume?.id).toBe(b.id); expect(h.commit).toHaveBeenCalledOnce();
    }
    expect(h.composer.consent).toBe(false); expect(h.migrate).not.toHaveBeenCalled(); noTransfer();
  });
  it('keeps a malformed canonical-read failure distinct from absence or migration', async () => {
    const db = await openDB('folio-private-ui-v1', 1, { upgrade(database) { database.createObjectStore('preferences'); } });
    await db.put('preferences', { version: 1, malformedControl: true }, 'defaultResume'); db.close();
    h.canonical.mockImplementation(h.actualCanonical); h.legacy.mockResolvedValue({ selectedId: b.id, defaultId: b.id }); await mount();
    expect(host.textContent).toContain('absence has not been established'); expect(h.migrate).not.toHaveBeenCalled(); expect(h.composer.resume).toBeUndefined(); noTransfer();
  });
  it('does not replace loaded entries or unavailable scopes after a preference error', async () => {
    h.load.mockResolvedValue({ projects: [a, b], unavailable: [{ key: 'unavailable-control', name: 'Control recovery', error: 'Controlled record refusal' }] });
    h.canonical.mockRejectedValue(new Error('Controlled read refusal')); await mount();
    expect(host.querySelectorAll('[data-project-id]')).toHaveLength(2); expect(host.textContent).toContain('Control recovery'); expect(h.save).not.toHaveBeenCalled(); noTransfer();
  });
  it('does not invent an automatic default for legacy selected-only state', async () => {
    h.canonical.mockResolvedValue(null); h.legacy.mockResolvedValue({ selectedId: b.id, defaultId: null }); await mount(); await openTemplates();
    expect(h.templates.eligibleDefaultId).toBeUndefined(); expect(host.textContent).toContain('Earlier selected resume');
    expect(host.querySelectorAll('.folio-template-default')).toHaveLength(0); expect([...host.querySelectorAll('button')].filter(item => item.textContent === 'Make default')).toHaveLength(2); noTransfer();
  });
  it('keeps Make default available for a newer approved same-ID fingerprint', async () => {
    const newer = await revisedControlProject(a); h.load.mockResolvedValue({ projects: [newer, b], unavailable: [] }); await mount();
    expect(h.composer.resume).toBeUndefined(); await openTemplates(); expect(h.templates.eligibleDefaultId).toBeUndefined();
    expect([...host.querySelectorAll<HTMLButtonElement>('button')].filter(item => item.textContent === 'Make default' && !item.disabled)).toHaveLength(2);
    expect(h.templates.projects.find((item: Project) => item.id === a.id)?.revision).toBe(newer.revision); noTransfer();
  });
  it('opens an unchanged requested owner only after its held persistence succeeds', async () => {
    const save = deferred<void>(); h.save.mockReturnValue(save.promise); await dirty(); await flush(() => h.account.onHelp());
    await flush(() => button('Resume and layout').click()); expect(h.save).toHaveBeenCalledOnce(); expect(surface()).toBe('help');
    await flush(() => save.resolve()); expect(surface()).toBe('studio'); expect(selectedId()).toBe(a.id);
    expect(host.querySelector('.stage-button[aria-current="step"]')?.textContent).toContain('Template'); noTransfer();
  });
  it('retains Templates and owner after persistence refuses inspection', async () => {
    await mount(); await flush(() => host.querySelector<HTMLButtonElement>(`[data-project-id="${a.id}"] .project-open`)!.click());
    const edit = h.canvas.onEdit; await openTemplates();
    h.save.mockRejectedValue(new Error('Controlled persistence refusal'));
    await flush(() => edit([{ ...a.draft.blocks[0], runs: [{ text: 'Authored pending control edit.' }] }], 'control'));
    await flush(() => h.templates.onInspect(a)); expect(surface()).toBe('templates'); expect(chooserOpen()).toBe(false);
    expect(selectedId()).toBe(a.id); expect(host.textContent).toContain('Controlled persistence refusal'); expect(h.composer.consent).toBe(false); noTransfer();
  });
  it('refuses Inspect during a held default write, including a direct stale callback', async () => {
    const commit = deferred<unknown>(); h.commit.mockReturnValue(commit.promise); await mount(); await openTemplates();
    await flush(() => { void h.templates.onDefault(b); }); expect(h.templates.busy).toBe(true);
    const before = selectedId(); await flush(() => h.templates.onInspect(b)); expect(surface()).toBe('templates'); expect(selectedId()).toBe(before);
    expect(host.querySelectorAll('.folio-template-inspect:not([disabled])')).toHaveLength(0);
    await flush(() => commit.resolve({ ...(h.commit.mock.calls[0][0] as object) })); noTransfer();
  });
  it.each(['revision', 'source'] as const)('rejects a requested same-ID %s change while persistence is held', async kind => {
    await mount(); await flush(() => host.querySelector<HTMLButtonElement>(`[data-project-id="${a.id}"] .project-open`)!.click());
    const edit = h.canvas.onEdit; await openTemplates();
    const save = deferred<void>(); h.save.mockReturnValue(save.promise);
    await flush(() => edit([{ ...a.draft.blocks[0], runs: [{ text: 'Authored pending control edit.' }] }], 'control'));
    await flush(() => h.templates.onInspect(b)); expect(h.save).toHaveBeenCalledOnce();
    const changed = kind === 'revision' ? await revisedControlProject(b) : { ...b, revision: b.revision + 1, source: (await approvedControlProject('Changed control source')).source };
    h.load.mockResolvedValue({ projects: [a, changed], unavailable: [] });
    await flush(() => h.groupChanged({ templateGroupId: 'other-control-group', state: 'deleted' }));
    await flush(() => save.resolve()); expect(surface()).toBe('templates'); expect(selectedId()).toBe(a.id);
    expect(host.textContent).toContain('requested resume or revision changed'); noTransfer();
  });
  it('rejects the old held Inspect after Help → Profile → Help across renders', async () => {
    const save = deferred<void>(); h.save.mockReturnValue(save.promise); await dirty(); await flush(() => h.account.onHelp());
    await flush(() => button('Resume and layout').click()); await flush(() => h.account.onProfile()); await flush(() => h.account.onHelp());
    await flush(() => save.resolve()); expect(surface()).toBe('help'); expect(selectedId()).toBe(a.id); expect(chooserOpen()).toBe(false); noTransfer();
  });
  it('rejects held Inspect after a same-event batched Help → Profile → Help', async () => {
    const save = deferred<void>(); h.save.mockReturnValue(save.promise); await dirty(); await flush(() => h.account.onHelp());
    await flush(() => button('Resume and layout').click()); const account = h.account;
    await flush(() => { account.onProfile(); account.onHelp(); }); await flush(() => save.resolve());
    expect(surface()).toBe('help'); expect(selectedId()).toBe(a.id); noTransfer();
  });
  it('refuses an old callback immediately after same-event ABA before React commits', async () => {
    await mount(); await flush(() => h.account.onHelp()); const account = h.account, inspect = button('Resume and layout');
    await flush(() => { account.onProfile(); account.onHelp(); inspect.click(); });
    expect(surface()).toBe('help'); expect(selectedId()).toBe(a.id); expect(h.save).not.toHaveBeenCalled(); noTransfer();
  });
  it('allows a fresh valid Inspect after a same-value route event has settled', async () => {
    await mount(); await flush(() => h.account.onHelp()); await flush(() => h.account.onHelp());
    await flush(() => button('Resume and layout').click()); expect(surface()).toBe('studio'); expect(selectedId()).toBe(a.id); noTransfer();
  });
  it.each(['profile', 'privacy'] as const)('preserves first %s DOM click scheduled in child layout before initial App effects', async route => {
    h.firstClick = route; await mount(); expect(surface()).toBe(route); expect(selectedId()).toBeNull();
    expect(h.load).toHaveBeenCalledOnce(); expect(host.querySelectorAll('[data-project-id]')).toHaveLength(2); noTransfer();
  });
  it.each(['profile', 'privacy'] as const)('preserves first %s while optional startup reads are held', async route => {
    const preferences = deferred<null>(); h.canonical.mockReturnValue(preferences.promise); await mount();
    await flush(() => route === 'profile' ? h.account.onProfile() : h.account.onSettings());
    await flush(() => preferences.resolve(null)); expect(surface()).toBe(route); expect(selectedId()).toBeNull(); noTransfer();
  });
  it('opens the initial saved record when no route or owner intervenes', async () => {
    const preferences = deferred<unknown>(); h.canonical.mockReturnValue(preferences.promise); await mount(); expect(selectedId()).toBeNull();
    await flush(() => preferences.resolve(null)); expect(surface()).toBe('home'); expect(selectedId()).toBe(a.id); expect(h.composer).toBeNull(); noTransfer();
  });
});


describe('immediate composer to history navigation', () => {
  it('awaits the actual typed draft before opening history and keeps a pending navigation authoritative', async () => {
    await mount();
    const held = deferred<void>(), text = 'Fictional accessibility role: maintain accessible interfaces and explain decisions.';
    h.save.mockImplementation((item: Project) => item.workspace?.kind === 'application' ? held.promise : Promise.resolve());
    await flush(() => h.composer.onChange(text));
    await flush(() => button('Applications').click());
    expect(host.querySelector('.folio-compose')).not.toBeNull(); expect(h.composer.busy).toBe('Saving your current draft'); expect(host.querySelector<HTMLTextAreaElement>('.folio-composer textarea')!.readOnly).toBe(true);
    const pending = h.save.mock.calls.map(call => call[0] as Project).filter(item => item.workspace?.kind === 'application');
    expect(pending).toHaveLength(1); expect(pending[0].job.description).toBe(text); expect(pending[0].source.sha256).toBe(a.source.sha256);
    await flush(() => h.composer.onTailor());
    await flush(() => button('New tailoring').click());
    expect(h.provider).not.toHaveBeenCalled(); expect(host.querySelector('.folio-compose')).not.toBeNull();
    await flush(() => held.resolve());
    expect(host.querySelector('.folio-history-surface')).not.toBeNull(); expect(host.querySelectorAll('.kit-history-card')).toHaveLength(1);
    expect(document.activeElement?.id).toBe('ws-h');
    expect(h.save.mock.calls.some(call => (call[0] as Project).id === pending[0].id && (call[0] as Project).job.description === text)).toBe(true);
    await flush(() => host.querySelector<HTMLButtonElement>('.folio-history-surface > header .button')!.click());
    expect(h.composer.value).toBe(''); expect(host.querySelectorAll('.folio-history-row')).toHaveLength(1); noTransfer();
  });
  it('keeps the entered text open with a visible error when saving before history fails', async () => {
    await mount(); const text = 'Fictional retained job input';
    h.save.mockImplementation((item: Project) => item.workspace?.kind === 'application' ? Promise.reject(new Error('Controlled new-draft save refusal')) : Promise.resolve());
    await flush(() => h.composer.onChange(text)); await flush(() => button('Applications').click());
    expect(host.querySelector('.folio-history-surface')).toBeNull(); expect(h.composer.value).toBe(text); expect(h.composer.busy).toBe(''); expect(host.querySelector<HTMLTextAreaElement>('.folio-composer textarea')!.readOnly).toBe(false);
    expect(host.textContent).toContain('Controlled new-draft save refusal'); noTransfer();
  });
});


describe('history route ownership while real App persistence is held', () => {
  async function pendingCreation() {
    await mount(); const held = deferred<void>(), text = 'Fictional retained role: document accessible interactions.';
    h.save.mockImplementation((item: Project) => item.workspace?.kind === 'application' ? held.promise : Promise.resolve());
    await flush(() => h.composer.onChange(text)); await flush(() => button('Applications').click());
    expect(h.composer.busy).toBe('Saving your current draft'); expect(host.querySelector<HTMLTextAreaElement>('.folio-composer textarea')!.readOnly).toBe(true);
    const record = h.save.mock.calls.map(call => call[0] as Project).find(item => item.workspace?.kind === 'application')!;
    expect(record.job.description).toBe(text); return { held, text, record };
  }
  it.each([['Help', 'help'], ['My profile', 'profile']] as const)('retains newer Account %s and saved typed record after held creation', async (label, destination) => {
    const { held, text, record } = await pendingCreation();
    await flush(() => host.querySelector<HTMLButtonElement>('.folio-account-trigger')!.click());
    await flush(() => button(label).click()); expect(surface()).toBe(destination);
    const focus = document.activeElement; await flush(() => held.resolve());
    expect(surface()).toBe(destination); expect(host.querySelector('.folio-history-surface')).toBeNull();
    expect(selectedId()).toBe(a.id); expect(host.querySelectorAll('.folio-history-row')).toHaveLength(1);
    expect(h.save.mock.calls.some(call => (call[0] as Project).id === record.id && (call[0] as Project).job.description === text)).toBe(true);
    expect(document.activeElement).toBe(focus); expect(document.activeElement?.id).not.toBe('ws-h'); noTransfer();
  });
  it.each([['Help', 'help'], ['My profile', 'profile']] as const)('does not publish stale History error on newer Account %s after held existing-draft save fails', async (label, destination) => {
    const held = deferred<void>(); h.save.mockReturnValue(held.promise); await dirty();
    await flush(() => button('Applications').click());
    await flush(() => host.querySelector<HTMLButtonElement>('.folio-account-trigger')!.click());
    await flush(() => button(label).click()); expect(surface()).toBe(destination);
    await flush(() => held.reject(new Error('Controlled stale-history save refusal')));
    expect(surface()).toBe(destination); expect(host.querySelector('.folio-history-surface')).toBeNull();
    // Actual persistence may retain its save-failure banner, but History may
    // not overwrite that owner-specific banner with its raw stale error.
    expect(host.textContent).toContain('Download a backup of the open edits');
    expect(selectedId()).toBe(a.id); noTransfer();
  });
  it('preserves existing Privacy refusal while History owns a pending creation', async () => {
    const { held, text } = await pendingCreation();
    await flush(() => host.querySelector<HTMLButtonElement>('.folio-account-trigger')!.click());
    await flush(() => button('Settings').click()); expect(surface()).toBe('compose');
    expect(host.querySelector('.folio-privacy-screen')).toBeNull();
    await flush(() => held.resolve()); expect(host.querySelector('.folio-history-surface')).not.toBeNull();
    expect(h.save.mock.calls.some(call => (call[0] as Project).job.description === text)).toBe(true); noTransfer();
  });
  it('retains Help after pending History sees Account Help → Profile → Help across renders', async () => {
    const { held } = await pendingCreation();
    for (const text of ['Help', 'My profile', 'Help']) {
      await flush(() => host.querySelector<HTMLButtonElement>('.folio-account-trigger')!.click());
      await flush(() => button(text).click());
    }
    await flush(() => held.resolve()); expect(surface()).toBe('help'); expect(selectedId()).toBe(a.id); noTransfer();
  });
  it('rejects pending History after a synchronous Account Help → Profile → Help ABA', async () => {
    const { held } = await pendingCreation();
    const account = h.account;
    await flush(() => { account.onHelp(); account.onProfile(); account.onHelp(); });
    await flush(() => held.resolve()); expect(surface()).toBe('help'); expect(selectedId()).toBe(a.id); noTransfer();
  });
  it('refuses an old History DOM callback after Account route dispatch before React commits', async () => {
    await mount(); const history = button('Applications');
    await flush(() => host.querySelector<HTMLButtonElement>('.folio-account-trigger')!.click());
    await flush(() => { button('Help').click(); history.click(); });
    expect(surface()).toBe('help'); expect(host.querySelector('.folio-history-surface')).toBeNull(); noTransfer();
  });
  it('does not steal focus after History destination is superseded before its animation frame', async () => {
    await mount(); const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    await flush(() => button('Applications').click()); expect(host.querySelector('.folio-history-surface')).not.toBeNull();
    await flush(() => host.querySelector<HTMLButtonElement>('.folio-account-trigger')!.click());
    await flush(() => button('Help').click()); const target = button('Resume and layout'); target.focus();
    await flush(() => frames.forEach(callback => callback(0)));
    expect(surface()).toBe('help'); expect(document.activeElement).toBe(target); noTransfer();
  });
});


describe('actual nested Account menu in the mobile history drawer', () => {
  it('closes and focuses the nested menu on first Escape, then the drawer on second Escape', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })));
    await mount(); const opener = host.querySelector<HTMLButtonElement>('[aria-label="Open navigation"]')!;
    await flush(() => opener.click()); const library = host.querySelector<HTMLElement>('#project-library')!;
    const trigger = library.querySelector<HTMLButtonElement>('.folio-account-trigger')!;
    await flush(() => trigger.click()); expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
    await flush(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(trigger.getAttribute('aria-expanded')).toBe('false'); expect(library.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(trigger);
    await flush(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(library.hasAttribute('inert')).toBe(true); expect(document.activeElement).toBe(opener); noTransfer();
  });
});


describe('open nested Account menu whose trigger owns keyboard focus', () => {
  it('keeps the drawer on first Escape after Tab to the open-menu trigger, then closes it on second Escape', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })));
    await mount(); const opener = host.querySelector<HTMLButtonElement>('[aria-label="Open navigation"]')!;
    await flush(() => opener.click()); const library = host.querySelector<HTMLElement>('#project-library')!;
    const trigger = library.querySelector<HTMLButtonElement>('.folio-account-trigger')!;
    await flush(() => trigger.click()); const menu = library.querySelector<HTMLElement>('[role="menu"]')!;
    const last = menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[3]; last.focus();
    expect(last.textContent).toContain('Help'); expect(menu.nextElementSibling).toBe(trigger);
    // jsdom has no browser Tab default action. Dispatch the actual key and
    // perform the native next-focus step; the separate Chrome receipt proves it.
    await flush(() => { last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); trigger.focus(); });
    expect(document.activeElement).toBe(trigger); expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await flush(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(trigger.getAttribute('aria-expanded')).toBe('false'); expect(library.hasAttribute('inert')).toBe(false); expect(document.activeElement).toBe(trigger);
    await flush(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(library.hasAttribute('inert')).toBe(true); expect(document.activeElement).toBe(opener); noTransfer();
  });
});


// These mounted App controls use actual Account/Memory/back/application buttons.
// Only project persistence is held/refused; no browser fidelity or AI claim.
describe('Memory close retains synchronous route ownership', () => {
  async function pendingClose() {
    a = initCareerMemory(a);
    b = await createApplication(a, { description: 'Fictional accessible-interface role.', title: 'Control application', company: '' });
    h.load.mockResolvedValue({ projects: [a, b], unavailable: [] });
    h.canonical.mockResolvedValue(await defaultResumePreference(a));
    await mount(); await flush(() => h.account.onMemory());
    expect(host.querySelector('.memory-design-body')).not.toBeNull();
    const held = deferred<void>(); h.save.mockReturnValue(held.promise);
    await flush(() => h.memory.onDraftChange('Fictional pending private context.'));
    await flush(() => button('Tailor a job').click());
    expect(h.save).toHaveBeenCalled();
    return held;
  }
  async function newerAccount(label: string) {
    await flush(() => host.querySelector<HTMLButtonElement>('.folio-account-trigger')!.click());
    await flush(() => button(label).click());
  }
  it.each([['Help', 'help'], ['My profile', 'profile']] as const)('keeps newer Account %s after held Memory close', async (label, destination) => {
    const held = await pendingClose(); await newerAccount(label);
    expect(surface()).toBe(destination); const focus = document.activeElement;
    await flush(() => held.resolve());
    expect(surface()).toBe(destination); expect(selectedId()).toBe(a.id);
    expect(document.activeElement).toBe(focus); noTransfer();
  });
  it('keeps the explicitly opened application after held Memory close', async () => {
    const held = await pendingClose();
    await flush(() => host.querySelector<HTMLButtonElement>(`[data-project-id="${b.id}"] .project-open`)!.click());
    await flush(() => held.resolve());
    expect(selectedId()).toBe(b.id); expect(surface()).toBe('studio');
    expect(host.querySelector('.folio-review-toolbar')).not.toBeNull(); noTransfer();
  });
  it.each([['Help', 'help'], ['My profile', 'profile']] as const)('keeps newer Account %s and actual save-failure recovery after Memory close rejects', async (label, destination) => {
    const held = await pendingClose(); await newerAccount(label);
    await flush(() => held.reject(new Error('Controlled stale-Memory save refusal')));
    expect(surface()).toBe(destination); expect(selectedId()).toBe(a.id);
    // Preserve persistence's owner-specific recovery warning, without adding
    // a stale Memory close error/destination to the newer view.
    expect(host.textContent).toContain('Download a backup of the open edits'); noTransfer();
  });
  it('finishes an unchanged owned Memory close, retaining the exact saved context', async () => {
    const held = await pendingClose(); await flush(() => held.resolve());
    expect(surface()).toBe('compose'); expect(selectedId()).toBe(a.id);
    expect(h.save.mock.calls.some(([record]) => (record as Project).careerMemory?.draftText === 'Fictional pending private context.')).toBe(true);
    expect(document.activeElement?.id).toBe('ws-h'); noTransfer();
  });
  it('does not reacquire ownership after same-event Help → Profile → Help', async () => {
    const held = await pendingClose(), account = h.account;
    await flush(() => { account.onHelp(); account.onProfile(); account.onHelp(); });
    await flush(() => held.resolve()); expect(surface()).toBe('help'); noTransfer();
  });
  it('refuses a stale Memory close callback immediately before a newer render commits', async () => {
    a = initCareerMemory(a); h.load.mockResolvedValue({ projects: [a, b], unavailable: [] });
    h.canonical.mockResolvedValue(await defaultResumePreference(a));
    await mount(); await flush(() => h.account.onMemory());
    const close = h.memory.onClose, account = h.account, count = h.save.mock.calls.length;
    await flush(() => { account.onHelp(); void close(); });
    expect(surface()).toBe('help'); expect(h.save.mock.calls).toHaveLength(count); noTransfer();
  });
  it('does not move focus with an old close RAF after a newer profile owns the route', async () => {
    const held = await pendingClose(), frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    await flush(() => held.resolve()); expect(surface()).toBe('compose');
    await newerAccount('My profile'); const focus = document.activeElement;
    await flush(() => { for (const callback of frames) callback(0); });
    expect(surface()).toBe('profile'); expect(document.activeElement).toBe(focus);
    expect(document.activeElement?.id).not.toBe('ws-h'); noTransfer();
  });
});


describe('product upgrade live-state integration', () => {
  it('keeps a native edit and private note dispatched in the same event', async () => {
    const application = setPresentation(await createApplication(a, { title: 'Engineer', company: 'Authored', description: 'Build React dashboards.' }), { state: 'ready' });
    h.load.mockResolvedValue({ projects: [a, application], unavailable: [] });
    await mount(false);
    await flush(() => h.home.onOpen(application));
    expect(surface()).toBe('studio'); expect(h.insights).toBeTruthy();
    const edit = h.canvas.onEdit, note = h.insights.onPrivateNotes;
    await flush(() => {
      edit([{ ...application.draft.blocks[0], runs: [{ text: 'Built accessible React dashboards.' }] }], 'native-edit');
      note('Remember to review this role.');
    });
    expect(h.canvas.project.draft.blocks[0].runs[0].text).toBe('Built accessible React dashboards.');
    expect(h.canvas.project.folio.privateNotes).toBe('Remember to review this role.');
    noTransfer();
  });
  it('saves role/company and opens the local draft before the debounce fires', async () => {
    await mount();
    await flush(() => {
      h.composer.onChange('Build accessible React dashboards with TypeScript.');
      h.composer.onJobDetailsChange({ title: 'Frontend Engineer', company: 'Authored Studio' });
      h.composer.onOpenDraft();
    });
    expect(surface()).toBe('studio');
    expect(h.canvas.project.job).toEqual({ description: 'Build accessible React dashboards with TypeScript.', title: 'Frontend Engineer', company: 'Authored Studio' });
    expect(h.save.mock.calls.some(([project]) => project.job.company === 'Authored Studio')).toBe(true);
    noTransfer();
  });
});
