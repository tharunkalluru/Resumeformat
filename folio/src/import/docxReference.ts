import JSZip from 'jszip';
import { renderAsync } from 'docx-preview';
import { FolioError } from '../core/errors';
import { readDocxArchive } from './zip';
import { imageMime } from './raster';
import { REL, W, descendants, parseXml } from './xml';

/** Inert approximate reference. This is not a Word pagination oracle or import model. */
export async function sanitizedDocxBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const parts = await readDocxArchive(bytes), output = new JSZip(), serializer = new XMLSerializer();
  for (const [name, data] of parts) {
    if (/vbaProject|activeX|embeddings\/|afchunk|altchunk|fontTable|\.odttf$|\.html?$|\.mhtml$/i.test(name)) continue;
    if (name.endsWith('.rels')) {
      const document = parseXml(data, 'relationships');
      for (const relation of descendants(document, 'Relationship', REL)) {
        const type = relation.getAttribute('Type') ?? '', target = relation.getAttribute('Target') ?? '';
        if (relation.getAttribute('TargetMode')?.toLowerCase() === 'external' || /vbaProject|oleObject|package|aFChunk|font|attachedTemplate|activeX/i.test(type) || /^[a-z][a-z0-9+.-]*:|^\//i.test(target)) relation.remove();
      }
      output.file(name, serializer.serializeToString(document));
    } else if (name.endsWith('.xml')) {
      const document = parseXml(data, 'reference');
      for (const local of ['altChunk', 'object', 'pict', 'subDoc', 'control', 'del', 'ins', 'moveFrom', 'moveTo', 'commentReference', 'commentRangeStart', 'commentRangeEnd']) for (const item of descendants(document, local, W)) item.remove();
      for (const hyperlink of descendants(document, 'hyperlink', W)) hyperlink.replaceWith(...Array.from(hyperlink.childNodes));
      for (const font of descendants(document, 'rFonts', W)) font.remove();
      // docx-preview interpolates several OOXML values into generated CSS.
      // Treat attribute values as untrusted before they reach that renderer.
      for (const element of Array.from(document.getElementsByTagName('*'))) for (const attribute of Array.from(element.attributes)) {
        if (/[\u0000-\u001f\u007f;{}<>\\]/.test(attribute.value) ||
          ['styleId', 'basedOn', 'next', 'link', 'pStyle', 'rStyle', 'tblStyle'].includes(attribute.localName === 'val' ? element.localName : attribute.localName) && !/^[a-zA-Z0-9_-]{1,150}$/.test(attribute.value) ||
          (element.localName === 'color' && attribute.localName === 'val' || ['color', 'fill'].includes(attribute.localName)) && !/^(?:[a-f\d]{6}|auto)$/i.test(attribute.value)) element.removeAttributeNode(attribute);
      }
      output.file(name, serializer.serializeToString(document));
    } else if (name.startsWith('word/media/')) {
      if (imageMime(data)) output.file(name, data);
    }
  }
  return output.generateAsync({ type: 'uint8array', compression: 'STORE' });
}

/** Caller must label: DOCX reference — browser rendering; Word pagination may differ. */
export async function renderDocxReference(bytes: Uint8Array, target: HTMLElement): Promise<void> {
  const sanitized = await sanitizedDocxBytes(new Uint8Array(bytes));
  const detached = document.createElement('div');
  try {
    await renderAsync(sanitized, detached, undefined, {
      renderAltChunks: false, renderChanges: false, renderComments: false,
      renderFootnotes: false, renderEndnotes: false, ignoreFonts: true,
      ignoreLastRenderedPageBreak: true, useBase64URL: true, experimental: false,
      breakPages: true, className: 'folio-docx', inWrapper: true,
    });
  } catch { throw new FolioError('DOCX_REFERENCE', 'The approximate DOCX reference could not be rendered. The original document remains available.'); }
  // The library creates markup from OOXML; apply a final inert allowlist before attachment.
  for (const node of Array.from(detached.querySelectorAll('script,iframe,object,embed,link,video,audio,form,input,button,svg,math'))) node.remove();
  for (const node of Array.from(detached.querySelectorAll('*'))) {
    for (const attribute of Array.from(node.attributes)) {
      if (/^on/i.test(attribute.name) || ['href', 'srcset', 'action', 'formaction'].includes(attribute.name)) node.removeAttribute(attribute.name);
      if (attribute.name === 'src' && !/^data:image\/(png|jpeg);base64,/i.test(attribute.value)) node.removeAttribute('src');
      if (attribute.name === 'style' && dangerousCss(attribute.value)) node.removeAttribute('style');
    }
  }
  for (const style of Array.from(detached.querySelectorAll('style'))) if (dangerousCss(style.textContent ?? '')) style.remove();
  target.replaceChildren(...Array.from(detached.childNodes));
}

function dangerousCss(value: string): boolean {
  const normalized = value.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\\([a-f\d]{1,6})\s?|\\([^\r\n])/gi, (_, hex: string | undefined, literal: string | undefined) => hex ? String.fromCodePoint(Math.min(0x10ffff, parseInt(hex, 16))) : literal ?? '').replace(/\\[\r\n]+/g, '');
  return /url\s*\(|expression\s*\(|@import|javascript\s*:/i.test(normalized);
}
