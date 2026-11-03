import { FolioError } from '../core/errors';
export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
export const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
export const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
export function parseXml(bytes: Uint8Array, label: string): Document {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new FolioError('UNSAFE_XML', 'This DOCX contains unsupported XML declarations. Export a fresh DOCX.');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement.localName === 'parsererror') throw new FolioError('DOCX_XML', `The ${label} XML is corrupt. Export a fresh DOCX.`);
  return doc;
}
export const children = (element: Element, localName?: string, ns = W): Element[] => Array.from(element.children).filter(child => child.namespaceURI === ns && (!localName || child.localName === localName));
export const child = (element: Element | undefined | null, localName: string, ns = W): Element | undefined => element ? children(element, localName, ns)[0] : undefined;
export const descendants = (element: Element | Document, localName: string, ns = W): Element[] => Array.from(element.getElementsByTagNameNS(ns, localName));
export const attr = (element: Element | undefined | null, name: string, ns = W): string | undefined => element?.getAttributeNS(ns, name) ?? undefined;
export const val = (element: Element | undefined | null): string | undefined => attr(element, 'val');
export function numeric(value: string | undefined, fallback: number): number { const number = value === undefined ? NaN : Number(value); return Number.isFinite(number) ? number : fallback; }
export function resolvePart(base: string, target: string): string | undefined {
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/') || target.includes('\\') || /[\u0000-\u001f\u007f]/.test(target)) return undefined;
  const parts = base.split('/'); parts.pop();
  for (const segment of target.split('/')) {
    if (segment === '..') { if (!parts.length) return undefined; parts.pop(); }
    else if (segment && segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}
export interface Relationship { id: string; type: string; target: string; external: boolean; part?: string }
export function readRelationships(parts: Map<string, Uint8Array>, base: string): Map<string, Relationship> {
  const slash = base.lastIndexOf('/'), relPath = `${base.slice(0, slash + 1)}_rels/${base.slice(slash + 1)}.rels`;
  const bytes = parts.get(relPath); const result = new Map<string, Relationship>();
  if (!bytes) return result;
  for (const element of descendants(parseXml(bytes, 'relationships'), 'Relationship', REL)) {
    const id = element.getAttribute('Id') ?? '', type = element.getAttribute('Type') ?? '', target = element.getAttribute('Target') ?? '';
    const external = element.getAttribute('TargetMode')?.toLowerCase() === 'external';
    if (!id || result.has(id)) throw new FolioError('DOCX_RELATIONSHIP', 'This DOCX contains invalid relationship identifiers. Export a fresh DOCX.');
    result.set(id, { id, type, target, external, ...(!external ? { part: resolvePart(base, target) } : {}) });
  }
  return result;
}
