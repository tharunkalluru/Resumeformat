import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { openDB } from 'idb';
import { importResume } from '../import';
import { IMPORTER_VERSION } from '../import/common';
import { makeProject } from '../core/model';
import { setFontLoader } from '../layout/fonts';
import { backupProject, loadProjects, restoreProject, saveProject } from './projects';

let restoreFonts: () => void;
let window: JSDOM['window'];
beforeAll(() => {
  window = new JSDOM('').window;
  Object.assign(globalThis, { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer });
  restoreFonts = setFontLoader(async file => new Uint8Array(await readFile(resolve('public/fonts', file))));
});
afterAll(() => { restoreFonts(); window.close(); });
beforeEach(async () => {
  const database = await openDB('folio-local-v1', 2, { upgrade(db) {
    if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('groupState')) db.createObjectStore('groupState', { keyPath: 'templateGroupId' });
  } });
  await database.clear('projects');
  await database.clear('groupState');
  database.close();
});

describe('current Word importer persistence', () => {
  it('saves and restores a real fictional DOCX without requiring a PDF image contract', async () => {
    const bytes = new Uint8Array(await readFile(resolve('public/fixtures/fictional-resume.docx')));
    const result = await importResume(new File([new Uint8Array(bytes).buffer], 'fictional-resume.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }));
    expect(result.source.format).toBe('docx');
    expect(result.template.importerVersion).toBe(IMPORTER_VERSION);
    expect(result.template.sourceImageContract).toBeUndefined();
    const project = makeProject(result);
    await saveProject(project);
    expect((await loadProjects())[0]).toEqual(project);
    const restored = await restoreProject(new File([await backupProject(project)], 'fictional-word.folio.zip'));
    expect(restored.id).not.toBe(project.id);
    expect(restored.source.bytes).toEqual(bytes);
    expect(restored.template).toEqual(project.template);
    expect(restored.baseline).toEqual(project.baseline);
    expect(restored.assets).toEqual(project.assets);
    await saveProject(restored);
    expect((await loadProjects()).find(item => item.id === restored.id)).toEqual(restored);
  });
});
