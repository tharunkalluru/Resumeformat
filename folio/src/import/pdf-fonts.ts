import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { FontFamily } from '../core/model';

export interface PdfFontIdentity { family: FontFamily; fontWeight: 400 | 700; italic: boolean }
const identities = new Map<string, PdfFontIdentity>();
for (const [name, family, italicName] of [
  ['DejaVuSans', 'sans', 'Oblique'], ['DejaVuSerif', 'serif', 'Italic'], ['DejaVuSansMono', 'mono', 'Oblique'],
] as const) {
  identities.set(name, { family, fontWeight: 400, italic: false });
  identities.set(`${name}-Bold`, { family, fontWeight: 700, italic: false });
  identities.set(`${name}-${italicName}`, { family, fontWeight: 400, italic: true });
  identities.set(`${name}-Bold${italicName}`, { family, fontWeight: 700, italic: true });
}
for (const [name, fontWeight, italic] of [
  ['Times-Roman', 400, false], ['Times-Bold', 700, false], ['Times-Italic', 400, true], ['Times-BoldItalic', 700, true],
] as const) identities.set(name, { family: 'times', fontWeight, italic });

/** Version-coupled adapter for pinned PDF.js 6.4.299. Call after getOperatorList.
 * Public TextStyle loses font identity/weight. fontExtraProperties exposes the
 * original name through the loaded resource. Missing/changed metadata returns
 * undefined, so the importer falls back visibly instead of assuming identity.
 * Only already licensed full bundled faces are reused; uploaded subset font
 * programs never enter the reusable font catalog or exported document. */
export function knownPdfFont(page: PDFPageProxy, resourceId: string): PdfFontIdentity | undefined {
  try {
    const resource: unknown = page.commonObjs.get(resourceId);
    if (!resource || typeof resource !== 'object' || !('name' in resource) || typeof resource.name !== 'string' || resource.name.length > 256) return;
    if ('isType3Font' in resource && resource.isType3Font) return;
    return identities.get(resource.name.replace(/^[A-Z]{6}\+/, ''));
  } catch { return; }
}

/** Reported names are inert provenance, never a basis for guessing font style. */
export function reportedPdfFontName(page: PDFPageProxy, resourceId: string): string | null {
  try {
    const resource: unknown = page.commonObjs.get(resourceId);
    if (!resource || typeof resource !== 'object' || !('name' in resource)) return null;
    const name: unknown = resource.name;
    return typeof name === 'string' && name.length > 0 && name.length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/.test(name) ? name : null;
  } catch { return null; }
}
