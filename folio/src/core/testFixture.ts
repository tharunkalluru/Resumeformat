import { PDFDocument, StandardFonts } from 'pdf-lib';
import { makeProject, newId, sha256 } from './model';
import type { Project } from './model';

export async function fixtureProject(): Promise<Project> {
  const pageId = newId(), contentId = newId(), factId = newId();
  // A real wholly authored source: storage must never exempt malformed PDFs.
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText('Built React dashboards using TypeScript.', { x: 50, y: 732, size: 10, font });
  const bytes = new Uint8Array(await pdf.save());
  return makeProject({
    source: { id: newId(), name: 'fictional.pdf', format: 'pdf', bytes, sha256: await sha256(bytes), sourcePageCount: 1 },
    assets: [],
    template: { id: newId(), revision: 1, importerVersion: 'fixture-v1', warnings: [], pages: [{ id: pageId, width: 612, height: 792, regions: [{ kind: 'text', id: newId(), pageId, bounds: { x: 50, y: 50, width: 500, height: 30 }, order: 0, contentId, role: 'body', sourceLocator: 'fictional test', style: { fontFamily: 'sans', fontSize: 10, fontWeight: 400, italic: false, color: '#000000', lineHeight: 14, alignment: 'left' } }] }] },
    baseline: { revision: 1, blocks: [{ id: contentId, runs: [{ text: 'Built React dashboards using TypeScript.', sourceFactIds: [factId] }], sourceFactIds: [factId] }] },
    facts: [{ id: factId, text: 'Built React dashboards using TypeScript.', kind: 'resume', locator: 'fictional test', confirmed: true }],
  }, true);
}
