import { MAX_SOURCE_PAGES, newId, safeHref, type ContentBlock, type Fact, type FontFamily, type ImageAsset, type ImportResult, type ImportWarning, type TemplatePage, type TextRun, type TextStyle } from '../core/model';
import { FolioError } from '../core/errors';
import { FONT_FILES, loadFont, type FontKey } from '../layout/fonts';
import { layoutDocument, type FontRegistry } from '../layout/engine';
import { IMPORTER_VERSION, MAX_TEXT, sourceAsset, warning } from './common';
import { readDocxArchive } from './zip';
import { imageMime } from './raster';
import { normalizeDocxInkEnvelope } from './docx-geometry';
import { createDocxPropertyResolver, type DocxPropertyDecision, type DocxPropertyIssue } from './docx-properties';
import { A, CT, R, W, WP, attr, child, children, descendants, numeric, parseXml, readRelationships, val } from './xml';
/** Word bullet glyphs in Symbol/Wingdings private-use positions, and the plain character to show. */
const WORD_SYMBOL_BULLETS: Record<string, { text: string; exact: boolean }> = {
  '\uf0b7': { text: '•', exact: true },  // Symbol: default Word bullet
  '\uf0a7': { text: '▪', exact: true },  // Wingdings: small square
  '§': { text: '▪', exact: true },        // Wingdings square typed as §
  'o': { text: '◦', exact: true },        // Courier New "o": Word's second-level bullet
  '\uf06f': { text: '◦', exact: true },
  '\uf0d8': { text: '•', exact: false }, // Wingdings arrowhead
  '\uf076': { text: '•', exact: false }, // Wingdings diamond cluster
  '\uf0fc': { text: '•', exact: false }, // Wingdings check mark
  '\uf0e8': { text: '•', exact: false }, // Wingdings arrow
  '\uf0a8': { text: '•', exact: false },
};

interface Format { family?: string; size?: number; bold?: boolean; italic?: boolean; underline?: boolean; color?: string; alignment?: TextStyle['alignment']; before?: number; after?: number; line?: number; lineRule?: string; hidden?: boolean; left?: number; right?: number; first?: number; pageBefore?: boolean; numId?: string; levelId?: string }
interface Style { id: string; basedOn?: string; properties: Format }
const on = (element: Element | undefined) => element ? !['0', 'false', 'off'].includes(val(element) ?? '1') : undefined;
function format(properties: Element | undefined): Format {
  if (!properties) return {};
  const run = properties.localName === 'pPr' ? child(properties, 'rPr') : properties;
  const fonts = child(run, 'rFonts'), spacing = child(properties, 'spacing'), indent = child(properties, 'ind');
  const color = val(child(run, 'color'));
  const align = val(child(properties, 'jc'));
  return {
    ...(fonts ? { family: attr(fonts, 'ascii') ?? attr(fonts, 'hAnsi') ?? attr(fonts, 'asciiTheme') } : {}),
    ...(child(run, 'sz') ? { size: numeric(val(child(run, 'sz')), 22) / 2 } : {}),
    ...(child(run, 'b') ? { bold: on(child(run, 'b')) } : {}), ...(child(run, 'i') ? { italic: on(child(run, 'i')) } : {}),
    ...(child(run, 'vanish') || child(run, 'webHidden') ? { hidden: on(child(run, 'vanish')) ?? on(child(run, 'webHidden')) } : {}),
    ...(child(run, 'u') ? { underline: !['none', '0'].includes(val(child(run, 'u')) ?? 'single') } : {}),
    ...(color && /^[0-9a-f]{6}$/i.test(color) ? { color: `#${color}` } : {}),
    ...(align && ['left', 'center', 'right'].includes(align) ? { alignment: align as TextStyle['alignment'] } : {}),
    ...(spacing && attr(spacing, 'before') !== undefined ? { before: numeric(attr(spacing, 'before'), 0) / 20 } : {}),
    ...(spacing && attr(spacing, 'after') !== undefined ? { after: numeric(attr(spacing, 'after'), 0) / 20 } : {}),
    ...(spacing && attr(spacing, 'line') !== undefined ? { lineRule: attr(spacing, 'lineRule') ?? 'auto', line: attr(spacing, 'lineRule') === 'auto' || !attr(spacing, 'lineRule') ? numeric(attr(spacing, 'line'), 240) / 240 : numeric(attr(spacing, 'line'), 240) / 20 } : {}),
    ...(indent ? { left: numeric(attr(indent, 'left'), 0) / 20, right: numeric(attr(indent, 'right'), 0) / 20, first: (numeric(attr(indent, 'firstLine'), 0) - numeric(attr(indent, 'hanging'), 0)) / 20 } : {}),
    ...(child(properties, 'pageBreakBefore') ? { pageBefore: on(child(properties, 'pageBreakBefore')) } : {}),
    ...(child(properties, 'numPr') ? { numId: val(child(child(properties, 'numPr'), 'numId')), levelId: val(child(child(properties, 'numPr'), 'ilvl')) ?? '0' } : {}),
  };
}
function mapFont(name = 'DejaVu Sans'): FontFamily {
  if (/mono|courier|consolas/i.test(name)) return 'mono';
  if (/serif|times|georgia|cambria|garamond/i.test(name) && !/sans/i.test(name)) return 'serif';
  return 'sans';
}
/** Use the same fonts, wrapping and bullet indent as preview/export. This
 * determines Folio pagination; it does not claim native Word pagination. */
function lineCount(runs: TextRun[], width: number, style: TextStyle, bullet: boolean, fonts: FontRegistry): number {
  const template = { id: 'measure', revision: 1, importerVersion: IMPORTER_VERSION, warnings: [], pages: [{ id: 'page', width: 14400, height: 14400, regions: [{ kind: 'text' as const, id: 'text', pageId: 'page', order: 0, bounds: { x: 0, y: 0, width, height: 14400 }, contentId: 'content', role: bullet ? 'bullet' as const : 'body' as const, style, sourceLocator: 'measurement' }] }] };
  return Math.max(1, layoutDocument(template, { revision: 1, blocks: [{ id: 'content', runs, sourceFactIds: [] }] }, fonts).regions[0].lines.length);
}

/** Preserve run/container properties while splitting an explicit inline page break. */
function splitParagraphAtPageBreaks(paragraph: Element): (Element | null)[] {
  function split(node: Node): (Node | null)[] {
    if (node.nodeType !== 1) return [node.cloneNode(true)];
    const element = node as Element;
    if (element.namespaceURI === W && element.localName === 'br' && attr(element, 'type') === 'page') return [null];
    if (element.namespaceURI === W && ['del', 'ins', 'moveFrom', 'moveTo'].includes(element.localName)) return [element.cloneNode(true)];
    const properties = Array.from(element.children).filter(child => child.namespaceURI === W && ['pPr', 'rPr'].includes(child.localName));
    const fresh = () => { const copy = element.cloneNode(false); for (const property of properties) copy.appendChild(property.cloneNode(true)); return copy; };
    const output: (Node | null)[] = []; let current = fresh();
    for (const childNode of Array.from(element.childNodes)) {
      if (properties.includes(childNode as Element)) continue;
      for (const part of split(childNode)) {
        if (part === null) { output.push(current, null); current = fresh(); } else current.appendChild(part);
      }
    }
    output.push(current); return output;
  }
  if (!descendants(paragraph, 'br').some(item => attr(item, 'type') === 'page')) return [paragraph];
  return split(paragraph) as (Element | null)[];
}

export async function importDocx(file: File, bytes: Uint8Array): Promise<ImportResult> {
  const source = await sourceAsset(file, bytes, 'docx');
  const parts = await readDocxArchive(bytes);
  const types = parseXml(parts.get('[Content_Types].xml')!, 'content types');
  const mainType = descendants(types, 'Override', CT).find(item => item.getAttribute('PartName') === '/word/document.xml')?.getAttribute('ContentType');
  if (mainType !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')
    throw new FolioError('DOCX_CONTENT_TYPE', 'This is not a standard DOCX document. Macro-enabled Word documents are not supported.');
  if ([...parts.keys()].some(name => /vbaProject|activeX|embeddings\//i.test(name))) throw new FolioError('ACTIVE_CONTENT', 'This DOCX contains macros or embedded active objects. Remove those objects or import a PDF exported from Word.');
  const rootRelations = readRelationships(parts, '');
  if (![...rootRelations.values()].some(relation => relation.type.endsWith('/officeDocument') && !relation.external && relation.part === 'word/document.xml')) throw new FolioError('DOCX_ROOT_RELATIONSHIP', 'This DOCX has no valid Word document relationship. Export a fresh DOCX.');
  const doc = parseXml(parts.get('word/document.xml')!, 'document'), body = child(doc.documentElement, 'body');
  if (!body || doc.documentElement.namespaceURI !== W) throw new FolioError('DOCX_STRUCTURE', 'This DOCX has no supported Word document body.');
  const warnings: ImportWarning[] = [
    warning('DOCX_PAGINATION', 'DOCX reference uses browser rendering. Original Word pagination is unknown; automatic line wrapping and page breaks may differ.'),
    warning('DOCX_LAYOUT_MEASURED', 'Reconstruction uses measured bundled-font wrapping and paragraph heights. Native Word layout can still differ; compare the reference and generated PDF.'),
  ];
  const add = (code: string, message: string, severity: ImportWarning['severity'] = 'review') => {
    if (warnings.some(w => w.code === code && w.message === message)) return;
    if (warnings.length >= 1000 || message.length > 2000) throw new FolioError('DOCX_WARNING_LIMIT', 'This DOCX has too many distinct formatting issues to report completely. Simplify it in Word or import a matching PDF.');
    warnings.push(warning(code, message, severity));
  };
  const styles = parts.has('word/styles.xml') ? parseXml(parts.get('word/styles.xml')!, 'styles') : undefined;
  if (descendants(doc, 'color').some(item => attr(item, 'themeColor')) || (styles && descendants(styles, 'color').some(item => attr(item, 'themeColor')))) add('DOCX_THEME_COLOR', 'Theme-dependent colors use their explicit fallback color or black. Review the reconstructed colors against the reference.');
  let relations = readRelationships(parts, 'word/document.xml');
  for (const relation of relations.values()) {
    if (relation.external && !relation.type.endsWith('/hyperlink')) add('DOCX_EXTERNAL_RESOURCE', 'External document resources were excluded. Attach a local image or import a matching PDF to preserve the missing content.', 'blocking');
    if (!relation.external && (!relation.part || !parts.has(relation.part))) add('DOCX_MISSING_PART', 'A referenced document part is missing. Export a fresh DOCX or import a matching PDF.', 'blocking');
  }
  const styleMap = new Map<string, Style>(); let defaults: Format = { family: 'DejaVu Sans', size: 11, color: '#000000', before: 0, after: 0, line: 1.2, lineRule: 'auto' };
  let defaultParagraph: string | undefined;
  if (styles) {
    const dd = descendants(styles, 'docDefaults')[0];
    defaults = { ...defaults, ...format(child(child(dd, 'pPrDefault'), 'pPr')), ...format(child(child(dd, 'rPrDefault'), 'rPr')) };
    for (const item of descendants(styles, 'style')) {
      const id = attr(item, 'styleId'); if (!id) continue;
      styleMap.set(id, { id, basedOn: val(child(item, 'basedOn')), properties: { ...format(child(item, 'pPr')), ...format(child(item, 'rPr')) } });
      if (attr(item, 'type') === 'paragraph' && attr(item, 'default') === '1') defaultParagraph = id;
    }
  }
  const resolveStyle = (id: string | undefined, seen = new Set<string>()): Format => {
    if (!id) return {}; if (seen.has(id)) { add('DOCX_STYLE_CYCLE', 'A cyclic Word style cannot be resolved. Review the reconstructed formatting.'); return {}; }
    const style = styleMap.get(id); if (!style) return {}; seen.add(id);
    return { ...resolveStyle(style.basedOn, seen), ...style.properties };
  };
  const numbering = parts.has('word/numbering.xml') ? parseXml(parts.get('word/numbering.xml')!, 'numbering') : undefined;
  const nums = new Map<string, string>(), levels = new Map<string, Element>(), counters = new Map<string, number>();
  if (numbering) {
    for (const item of descendants(numbering, 'num')) { const id = attr(item, 'numId'), abstract = val(child(item, 'abstractNumId')); if (id && abstract) nums.set(id, abstract); }
    for (const item of descendants(numbering, 'abstractNum')) { const id = attr(item, 'abstractNumId'); for (const level of children(item, 'lvl')) levels.set(`${id}:${attr(level, 'ilvl') ?? '0'}`, level); }
  }
  const propertyResolver = createDocxPropertyResolver({ styles, numbering });
  const propertyInventory = new Map<string, { decision: DocxPropertyDecision; issue: DocxPropertyIssue; locator: string; affected: number }>();
  const collectProperties = (decision: DocxPropertyDecision, locator: string) => {
    for (const item of decision.issues) {
      const key = JSON.stringify([decision.property, decision.scope, item.state, item.reason, item.origin.carrier, !!item.conditional]);
      const prior = propertyInventory.get(key);
      if (prior) prior.affected++;
      else {
        if (propertyInventory.size >= 1000) throw new FolioError('DOCX_WARNING_LIMIT', 'This DOCX has too many distinct formatting issues to report completely. Simplify it in Word or import a matching PDF.');
        propertyInventory.set(key, { decision, issue: item, locator, affected: 1 });
      }
    }
  };
  const sections = descendants(body, 'sectPr');
  const section = child(body, 'sectPr') ?? sections.at(-1), size = child(section, 'pgSz'), margin = child(section, 'pgMar');
  const geometry = { width: numeric(attr(size, 'w'), 12240) / 20, height: numeric(attr(size, 'h'), 15840) / 20 };
  if (!size || !margin) add('DOCX_GEOMETRY_DEFAULT', 'Word page size or margins are not explicit. Reconstruction uses letter-sized pages and 72-point margins for the missing values; review the reference.');
  const margins = { left: numeric(attr(margin, 'left'), 1440) / 20, right: numeric(attr(margin, 'right'), 1440) / 20, top: numeric(attr(margin, 'top'), 1440) / 20, bottom: numeric(attr(margin, 'bottom'), 1440) / 20 };
  if (![geometry.width, geometry.height, ...Object.values(margins)].every(n => Number.isFinite(n) && n >= 0) || geometry.width > 2000 || geometry.height > 2000 || geometry.width <= margins.left + margins.right || geometry.height <= margins.top + margins.bottom) throw new FolioError('PAGE_GEOMETRY', 'This DOCX has unsupported page geometry or margins.');
  if (sections.length > 1) add('DOCX_SECTIONS', 'Multiple Word sections are reconstructed with the final section geometry. Import a matching PDF to preserve section-specific layout.', 'blocking');
  if (child(section, 'cols') && numeric(attr(child(section, 'cols'), 'num'), 1) > 1) add('DOCX_COLUMNS', 'Word multi-column flow is unsupported. Import a matching PDF to preserve the columns.', 'blocking');
  const fontRegistry: FontRegistry = new Map(await Promise.all((Object.keys(FONT_FILES) as FontKey[]).map(async key => [key, await loadFont(key)] as const)));
  const pages: TemplatePage[] = []; const blocks: ContentBlock[] = []; const facts: Fact[] = []; const assets: ImageAsset[] = [];
  let page: TemplatePage; let y = margins.top; let textSize = 0;
  const createPage = () => { if (pages.length >= MAX_SOURCE_PAGES) throw new FolioError('PAGE_LIMIT', `This DOCX reconstructs to more than ${MAX_SOURCE_PAGES} pages. Choose a shorter document.`); page = { id: newId(), ...geometry, regions: [] }; pages.push(page); y = margins.top; };
  createPage();
  const fontWarnings = (name: string | undefined) => { if (name && !/^DejaVu (Sans|Serif|Sans Mono)$/i.test(name)) add('FONT_SUBSTITUTION', `“${name}” is mapped to the bundled DejaVu ${mapFont(name) === 'serif' ? 'Serif' : mapFont(name) === 'mono' ? 'Sans Mono' : 'Sans'} font. Review the changed spacing.`); };
  function paragraph(element: Element, locator: string, x = margins.left, width = geometry.width - margins.left - margins.right, table = false, tableElement?: Element): number {
    const pPr = child(element, 'pPr'), pf = { ...defaults, ...resolveStyle(val(child(pPr, 'pStyle')) ?? defaultParagraph), ...format(pPr) };
    const propertyContext = { paragraph: element, locator, ...(tableElement ? { table: tableElement } : {}), ...(pf.numId ? { numbering: { numId: pf.numId, levelId: pf.levelId ?? '0' } } : {}) };
    collectProperties(propertyResolver.paragraph(propertyContext), locator);
    for (const decision of propertyResolver.directions(propertyContext)) collectProperties({ ...decision, issues: decision.issues.filter(item => !(item.origin.carrier === 'paragraphDirect' && item.state === 'active' && item.reason === `paragraph ${decision.property} declaration`)) }, locator);
    const runIndexes = new Map(descendants(element, 'r').map((run, i) => [run, i + 1]));
    if (pf.pageBefore && !table && page.regions.length) createPage();
    let runs: TextRun[] = [], pageBreakAfter = false;
    const images: { asset: ImageAsset; width: number; height: number; alt: string }[] = [];
    // Word commonly formats an entire paragraph directly on its first run.
    for (const run of descendants(element, 'r')) {
      let ancestor: Element | null = run.parentElement; let revision = false;
      while (ancestor && ancestor !== element) { if (ancestor.namespaceURI === W && ['del', 'ins', 'moveFrom', 'moveTo'].includes(ancestor.localName)) revision = true; ancestor = ancestor.parentElement; }
      const properties = child(run, 'rPr'), initial = { ...pf, ...resolveStyle(val(child(properties, 'rStyle'))), ...format(properties) };
      if (revision || initial.hidden || !descendants(run, 't').some(item => item.textContent)) continue;
      pf.family = initial.family; pf.size = initial.size; pf.color = initial.color; break;
    }
    const baseSize = pf.size ?? 11;
    if (!Number.isFinite(baseSize) || baseSize < 4 || baseSize > 144) throw new FolioError('DOCX_FONT_SIZE', 'A DOCX font size is outside the supported 4–144 point range. Correct the font size in Word and reimport.');
    fontWarnings(pf.family);
    const visit = (container: Element, href?: string) => {
      for (const node of Array.from(container.children)) {
        if (node.namespaceURI !== W) continue;
        if (['del', 'ins', 'moveFrom', 'moveTo'].includes(node.localName)) { add('DOCX_REVISIONS', 'Tracked changes were excluded from editable content. Accept or reject revisions in Word and reimport before export.', 'blocking'); continue; }
        if (node.localName === 'hyperlink') {
          const relation = relations.get(attr(node, 'id', R) ?? ''); const safe = relation?.external && relation.type.endsWith('/hyperlink') ? safeHref(relation.target) : undefined;
          if (!safe) add('UNSAFE_LINK', 'An unsafe or internal hyperlink was removed. Its visible text remains editable.');
          visit(node, safe); continue;
        }
        if (node.localName === 'sdt') { add('DOCX_CONTENT_CONTROL', 'Word content controls are imported as plain text. Review their visible content.'); const content = child(node, 'sdtContent'); if (content) visit(content, href); continue; }
        if (node.localName !== 'r') { if (node.localName === 'fldSimple') { add('DOCX_FIELDS', 'Word fields cannot be recalculated. Their cached text is imported for review.'); visit(node, href); } continue; }
        const rPr = child(node, 'rPr');
        if (on(child(rPr, 'vanish')) || on(child(rPr, 'webHidden'))) { add('DOCX_HIDDEN_TEXT', 'Hidden Word text was excluded. Review the source before approving the visible content.'); continue; }
        const rf = { ...pf, ...resolveStyle(val(child(rPr, 'rStyle'))), ...format(rPr) };
        if (rf.hidden) { add('DOCX_HIDDEN_TEXT', 'Hidden Word text was excluded. Review the source before approving the visible content.'); continue; }
        const runIndex = runIndexes.get(node)!;
        for (const decision of propertyResolver.run(propertyContext, node, runIndex)) {
          const issues = decision.issues.filter(item => !(['position', 'fitText', 'highlight'].includes(decision.property) && item.origin.carrier === 'runDirect' && item.state === 'active' && item.reason === `unsupported ${decision.property} declaration`));
          collectProperties({ ...decision, issues }, `${locator}/r[${runIndex}]`);
        }
        const otherDecorations = ['position', 'fitText', 'highlight'].filter(name => child(rPr, name));
        if (otherDecorations.length) add('DOCX_RUN_DECORATION', `Run formatting (${otherDecorations.join(', ')}) is unsupported. Import a matching PDF to preserve it.`, 'blocking');
        fontWarnings(rf.family);
        if ((rf.size ?? baseSize) !== baseSize || rf.color !== pf.color || rf.family !== pf.family) add('DOCX_MIXED_RUN_STYLE', 'A paragraph contains different run sizes, colors, or fonts. The paragraph style is used for reconstruction; import a PDF to preserve this formatting.', 'blocking');
        let text = '';
        for (const part of Array.from(node.children)) {
          if (part.namespaceURI !== W) continue;
          if (part.localName === 't') { if (pageBreakAfter) add('DOCX_TABLE_PAGE_BREAK', 'A page break inside table paragraph text is unsupported. Import a matching PDF.', 'blocking'); text += part.textContent ?? ''; }
          else if (part.localName === 'tab') { text += '\t'; add('DOCX_TABS', 'Tab stops are approximated in the reconstruction. Review alignment or import a matching PDF.'); }
          else if (part.localName === 'br') { if (attr(part, 'type') === 'page') pageBreakAfter = true; else text += '\n'; }
          else if (part.localName === 'cr') text += '\n';
          else if (part.localName === 'noBreakHyphen') text += '\u2011';
          else if (part.localName === 'softHyphen') text += '\u00ad';
          else if (part.localName === 'instrText' || part.localName === 'fldChar') add('DOCX_FIELDS', 'Word fields cannot be recalculated. Their cached text is imported for review.');
          else if (part.localName === 'drawing') {
            const inline = descendants(part, 'inline', WP)[0], anchor = descendants(part, 'anchor', WP)[0];
            if (!inline || anchor) { add('DOCX_FLOATING_IMAGE', 'A floating drawing or text box was excluded. Use an inline PNG/JPEG or import a matching PDF.', 'blocking'); continue; }
            if (descendants(part, 'srcRect', A).length) { add('DOCX_IMAGE_CROP', 'A cropped image needs review. The original uncropped image is reconstructed.', 'blocking'); }
            const blip = descendants(inline, 'blip', A)[0], extent = child(inline, 'extent', WP), relation = relations.get(attr(blip, 'embed', R) ?? '');
            const imageBytes = relation?.part && !relation.external ? parts.get(relation.part) : undefined;
            const mime = imageBytes ? imageMime(imageBytes) : undefined;
            const imageWidth = numeric(extent?.getAttribute('cx') ?? undefined, 0) / 12700, imageHeight = numeric(extent?.getAttribute('cy') ?? undefined, 0) / 12700;
            if (!imageBytes || !mime || imageWidth <= 0 || imageHeight <= 0 || imageWidth > geometry.width || imageHeight > geometry.height) { add('DOCX_UNSUPPORTED_IMAGE', 'An image could not be safely reconstructed. Use an inline PNG/JPEG with valid dimensions or import a matching PDF.', 'blocking'); continue; }
            let asset = assets.find(item => item.name === relation!.part);
            if (!asset) { asset = { id: newId(), name: relation!.part!, mime, bytes: new Uint8Array(imageBytes) }; assets.push(asset); }
            images.push({ asset, width: imageWidth, height: imageHeight, alt: child(inline, 'docPr', WP)?.getAttribute('descr') ?? 'Imported inline image' });
            if (text || runs.length) add('DOCX_INLINE_IMAGE_FLOW', 'An image mixed with paragraph text is placed after the text. Review the changed inline flow.');
          } else if (['object', 'pict'].includes(part.localName)) add('DOCX_UNSUPPORTED_OBJECT', 'A legacy drawing or embedded object was excluded. Import a matching PDF to preserve it.', 'blocking');
          else if (part.localName === 'sym') add('DOCX_SYMBOL', 'A font-specific symbol was excluded. Replace it with ordinary text or import a matching PDF.', 'blocking');
        }
        if (text) runs.push({ text, ...(rf.bold !== undefined ? { bold: rf.bold } : {}), ...(rf.italic !== undefined ? { italic: rf.italic } : {}), ...(rf.underline !== undefined ? { underline: rf.underline } : {}), ...(href ? { href } : {}) });
      }
    };
    visit(element);
    const numPr = child(pPr, 'numPr'); let bullet = false;
    if (pf.numId && pf.numId !== '0') {
      const numId = pf.numId, levelId = pf.levelId ?? '0', level = levels.get(`${nums.get(numId)}:${levelId}`);
      const kind = val(child(level, 'numFmt')), marker = val(child(level, 'lvlText'));
      if (child(level, 'lvlRestart') || numbering && descendants(numbering, 'num').some(num => attr(num, 'numId') === numId && children(num, 'lvlOverride').length)) add('DOCX_NUMBERING', 'Explicit numbering restart rules or level overrides need a matching PDF to preserve their markers.', 'blocking');
      for (const key of counters.keys()) if (key.startsWith(`${numId}:`) && Number(key.split(':')[1]) > Number(levelId)) counters.delete(key);
      // Word's built-in bullets use private-use glyphs from the Symbol/Wingdings fonts
      // (U+F0B7 is the default "•"). Map them to the ordinary characters they draw.
      const wordBullet = kind === 'bullet' && marker ? WORD_SYMBOL_BULLETS[marker] : undefined;
      if (kind === 'bullet' && marker && /^[•◦▪\-–◆]$/.test(marker)) { runs.unshift({ text: `${marker} ` }); bullet = true; }
      else if (wordBullet) { runs.unshift({ text: `${wordBullet.text} ` }); bullet = true; if (!wordBullet.exact) add('DOCX_NUMBERING', 'A decorative list marker is shown as a plain bullet.', 'info'); }
      else if (kind === 'decimal' && marker && new RegExp(`^%${Number(levelId) + 1}[.)]$`).test(marker) && /^[0-8]$/.test(levelId)) {
        const key = `${numId}:${levelId}`, count = (counters.get(key) ?? numeric(val(child(level, 'start')), 1) - 1) + 1;
        counters.set(key, count);
        runs.unshift({ text: `${count}${marker.slice(2)} ` });
      }
      else { add('DOCX_NUMBERING', 'This list marker or nesting is unsupported. A visible bullet is substituted; review the list or import a matching PDF.', 'blocking'); runs.unshift({ text: '• ' }); bullet = true; }
      if (!child(pPr, 'ind')) { const indent = child(child(level, 'pPr'), 'ind'); pf.left = numeric(attr(indent, 'left'), 360) / 20; pf.first = -numeric(attr(indent, 'hanging'), 180) / 20; }
    }
    if (child(pPr, 'bidi') || child(pPr, 'textDirection')) add('DOCX_TEXT_DIRECTION', 'A paragraph uses right-to-left or vertical text. Import horizontal left-to-right text before export.', 'blocking');
    if (val(child(pPr, 'jc')) === 'both' || child(pPr, 'tabs')) add('DOCX_ALIGNMENT', 'Justification or custom tab alignment is approximated. Review the paragraph alignment.');
    if (Math.abs(pf.first ?? 0) > .01) add('DOCX_FIRST_LINE_INDENT', 'First-line or hanging indentation uses a fixed text region. Review wrapped paragraph alignment.');
    const before = Math.max(0, pf.before ?? 0), after = Math.max(0, pf.after ?? 0);
    const requestedLine = pf.lineRule === 'exact' || pf.lineRule === 'atLeast' ? pf.line ?? baseSize * 1.2 : baseSize * (pf.line ?? 1.2);
    const lineHeight = pf.lineRule === 'atLeast' ? Math.max(baseSize, requestedLine) : requestedLine;
    if (!Number.isFinite(lineHeight) || lineHeight < 4 || lineHeight > 500) throw new FolioError('DOCX_LINE_HEIGHT', 'A paragraph line height is outside the supported range. Correct paragraph spacing in Word and reimport.');
    if (lineHeight < baseSize) add('DOCX_TIGHT_LINE_HEIGHT', 'A paragraph has an exact line height smaller than its text. Resolve overlap against the source before export.', 'blocking');
    const left = pf.left ?? 0, right = pf.right ?? 0;
    const regionWidth = width - left - right;
    if (regionWidth <= 0) throw new FolioError('DOCX_INDENT', 'A paragraph has unsupported indentation. Correct it in Word and reimport.');
    const textStyle: TextStyle = { fontFamily: mapFont(pf.family), fontSize: baseSize, fontWeight: pf.bold ? 700 : 400, italic: !!pf.italic, color: pf.color ?? '#000000', alignment: pf.alignment ?? 'left', lineHeight };
    const textHeight = runs.length ? lineCount(runs, regionWidth, textStyle, bullet, fontRegistry) * lineHeight : lineHeight;
    const imageHeight = images.reduce((n, image) => n + image.height, 0);
    if (!table && y + before + textHeight + imageHeight + after > geometry.height - margins.bottom && page.regions.length) createPage();
    y += before;
    const startY = y;
    if (runs.length) {
      const text = runs.map(run => run.text).join(''); textSize += text.length;
      if (textSize > MAX_TEXT) throw new FolioError('TEXT_LIMIT', 'This DOCX contains too much text. Use a one- or two-page resume.');
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(text)) add('DOCX_TEXT_ENCODING', 'Some text contains unsupported or unreadable characters. Correct it against the source before export.', 'blocking');
      const factId = newId(), contentId = newId(), regionId = newId();
      runs = runs.map(run => ({ ...run, sourceFactIds: [factId] }));
      facts.push({ id: factId, text, kind: 'resume', locator, confirmed: false });
      blocks.push({ id: contentId, runs, sourceFactIds: [factId] });
      page.regions.push({ kind: 'text', id: regionId, pageId: page.id, order: page.regions.length, bounds: { x: x + left, y, width: regionWidth, height: textHeight }, contentId, role: bullet ? 'bullet' : baseSize >= 15 ? 'heading' : runs.some(run => run.href) ? 'contact' : 'body', style: textStyle, sourceLocator: locator });
    }
    y += textHeight;
    for (const image of images) { page.regions.push({ kind: 'image', id: newId(), pageId: page.id, order: page.regions.length, bounds: { x: x + left, y, width: image.width, height: image.height }, assetId: image.asset.id, alt: image.alt }); y += image.height; }
    const borders = child(pPr, 'pBdr');
    if (borders) for (const edge of ['top', 'bottom'] as const) {
      const border = child(borders, edge); if (!border || val(border) === 'nil' || val(border) === 'none') continue;
      const color = attr(border, 'color');
      page.regions.push({ kind: 'rule', id: newId(), pageId: page.id, order: page.regions.length, bounds: { x, y: edge === 'top' ? startY : y, width, height: 0 }, color: color && /^[a-f0-9]{6}$/i.test(color) ? `#${color}` : '#000000', thickness: Math.max(.25, numeric(attr(border, 'sz'), 8) / 8) });
      if (!['single', undefined].includes(val(border))) add('DOCX_BORDER_STYLE', 'A decorative border is reconstructed as a simple solid rule. Review its appearance.');
    }
    y += after;
    if (pageBreakAfter) { if (table) add('DOCX_TABLE_PAGE_BREAK', 'A page break inside a table is unsupported. Import a matching PDF.', 'blocking'); else createPage(); }
    return y - startY + before;
  }
  function table(element: Element, locator: string) {
    const rows = children(element, 'tr'), grid = children(child(element, 'tblGrid') ?? element, 'gridCol').map(item => numeric(attr(item, 'w'), 0) / 20);
    const tblPr = child(element, 'tblPr');
    if (!rows.length || !grid.length || rows.some(row => children(row, 'tc').reduce((n, cell) => n + numeric(val(child(child(cell, 'tcPr'), 'gridSpan')), 1), 0) !== grid.length) || grid.some(width => width <= 0) || grid.reduce((a, b) => a + b, 0) > geometry.width - margins.left - margins.right + 1 || descendants(element, 'gridSpan').some(span => !Number.isInteger(numeric(val(span), 1)) || numeric(val(span), 1) < 1) || descendants(element, 'vMerge').length || descendants(element, 'tbl').length || child(tblPr, 'tblpPr')) {
      add('DOCX_COMPLEX_TABLE', 'A vertically merged, nested, floating, or inconsistent table cannot preserve its layout. Its text is retained in sequential regions; import a matching PDF before export.', 'blocking');
      rows.forEach((row, i) => children(row, 'tc').forEach((cell, j) => children(cell, 'p').forEach((p, k) => paragraph(p, `${locator}/row[${i + 1}]/cell[${j + 1}]/p[${k + 1}]`, undefined, undefined, false, element)))); return;
    }
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const cells = children(rows[rowIndex], 'tc');
      if (cells.reduce((n, cell) => n + numeric(val(child(child(cell, 'tcPr'), 'gridSpan')), 1), 0) !== grid.length) { add('DOCX_TABLE_GRID', 'The table cell grid is inconsistent. Review the reconstruction or import a matching PDF.', 'blocking'); }
      const rowStart = y; let rowEnd = y; let cellX = margins.left, columnIndex = 0;
      const widths = cells.map(cell => { const span = numeric(val(child(child(cell, 'tcPr'), 'gridSpan')), 1), width = grid.slice(columnIndex, columnIndex + span).reduce((a, b) => a + b, 0); columnIndex += span; return width; });
      cells.forEach((cell, cellIndex) => {
        const cellWidth = widths[cellIndex]; y = rowStart + 4;
        for (const [pIndex, p] of children(cell, 'p').entries()) paragraph(p, `${locator}/row[${rowIndex + 1}]/cell[${cellIndex + 1}]/p[${pIndex + 1}]`, cellX + 4, cellWidth - 8, true, element);
        rowEnd = Math.max(rowEnd, y + 4); cellX += cellWidth;
      });
      cellX = margins.left;
      cells.forEach((cell, index) => {
        const tcPr = child(cell, 'tcPr'), shade = attr(child(tcPr, 'shd'), 'fill'), border = child(tcPr, 'tcBorders') ?? child(tblPr, 'tblBorders');
        const color = attr(child(border, 'top') ?? child(border, 'bottom'), 'color');
        if (shade && /^[a-f0-9]{6}$/i.test(shade) || border) page.regions.unshift({ kind: 'rectangle', id: newId(), pageId: page.id, order: -1, bounds: { x: cellX, y: rowStart, width: widths[index], height: rowEnd - rowStart }, ...(shade && /^[a-f0-9]{6}$/i.test(shade) ? { fill: `#${shade}` } : {}), ...(border ? { stroke: color && /^[a-f0-9]{6}$/i.test(color) ? `#${color}` : '#000000' } : {}), thickness: .5 });
        cellX += widths[index];
      });
      y = rowEnd;
      if (y > geometry.height - margins.bottom) add('DOCX_TABLE_OVERFLOW', 'A table extends past the page margin. Correct its layout in Word or import a matching PDF.', 'blocking');
    }
    add('DOCX_TABLE_REVIEW', 'Simple and horizontally merged table cells are fixed editable regions. Cell padding and border details may differ; compare the reference.');
  }
  let paragraphIndex = 0, tableIndex = 0, pendingPageBreak = false;
  for (const element of Array.from(body.children)) {
    if (element.namespaceURI !== W) { add('DOCX_UNSUPPORTED_CONTENT', 'A non-Word drawing or equation is unsupported. Import a matching PDF to preserve it.', 'blocking'); continue; }
    if (element.localName === 'p') {
      const locator = `word/document.xml/p[${++paragraphIndex}]`;
      const segments = splitParagraphAtPageBreaks(element); let segmentIndex = 0;
      for (const segment of segments) {
        if (!segment) { if (pendingPageBreak) createPage(); pendingPageBreak = true; continue; }
        // Empty trailing fragment after a break creates no extra content page.
        if (pendingPageBreak && !descendants(segment, 't').some(item => item.textContent) && !descendants(segment, 'drawing').length) continue;
        if (pendingPageBreak) { createPage(); pendingPageBreak = false; }
        paragraph(segment, segments.length === 1 ? locator : `${locator}/segment[${++segmentIndex}]`);
      }
    } else if (element.localName === 'tbl') { if (pendingPageBreak) { createPage(); pendingPageBreak = false; } table(element, `word/document.xml/tbl[${++tableIndex}]`); }
    else if (element.localName !== 'sectPr') add('DOCX_UNSUPPORTED_CONTENT', 'An embedded content block or alternate HTML chunk was excluded. Import a matching PDF to preserve it.', 'blocking');
  }
  // A trailing explicit page break does not imply an extra content page.
  if (pages.length > 1 && !pages.at(-1)!.regions.length) pages.pop();
  if (descendants(body, 'txbxContent').length || descendants(body, 'altChunk').length || descendants(body, 'oMath', 'http://schemas.openxmlformats.org/officeDocument/2006/math').length) add('DOCX_UNSUPPORTED_OBJECT', 'Text boxes, alternate HTML content, or equations need a matching PDF import to preserve their appearance.', 'blocking');
  const bodyRelations = relations, bodyPage = page!, bodyY = y;
  for (const kind of ['header', 'footer'] as const) for (const reference of descendants(section ?? body, `${kind}Reference`)) {
    const relation = bodyRelations.get(attr(reference, 'id', R) ?? ''), part = relation?.part;
    if (attr(reference, 'type') !== 'default' || !part || relation.external || !relation.type.endsWith(`/${kind}`) || !parts.has(part) || child(section, 'titlePg')) {
      add('DOCX_HEADER_FOOTER', 'First/even-page variants or invalid header/footer parts cannot be reconstructed. Import a matching PDF.', 'blocking'); continue;
    }
    const root = parseXml(parts.get(part)!, kind).documentElement;
    if (root.namespaceURI !== W || root.localName !== (kind === 'header' ? 'hdr' : 'ftr') || Array.from(root.children).some(item => item.namespaceURI !== W || item.localName !== 'p') || ['fldSimple', 'fldChar', 'instrText', 'drawing', 'numPr', 'br'].some(tag => descendants(root, tag).length)) {
      add('DOCX_HEADER_FOOTER', 'Only simple default header/footer paragraphs are supported. Fields, images, tables and dynamic or paginated variants need a matching PDF.', 'blocking'); continue;
    }
    relations = readRelationships(parts, part);
    const distance = numeric(attr(margin, kind), 720) / 20;
    if (!Number.isFinite(distance) || distance < 0 || distance > geometry.height) { add('DOCX_HEADER_FOOTER', 'A header/footer has invalid margin geometry. Import a matching PDF.', 'blocking'); continue; }
    for (const [pageIndex, target] of pages.entries()) {
      page = target; y = kind === 'header' ? distance : 0;
      const start = target.regions.length;
      for (const [index, element] of Array.from(root.children).entries()) paragraph(element, `${part}/page[${pageIndex + 1}]/p[${index + 1}]`, margins.left, geometry.width - margins.left - margins.right, true);
      if (kind === 'footer') for (const region of target.regions.slice(start)) region.bounds.y += geometry.height - distance - y;
    }
    add('DOCX_HEADER_FOOTER_REVIEW', 'Simple default header/footer paragraphs are repeated on each reconstructed page. Placement uses explicit margins and measured fonts; compare native Word output for exact pagination.');
  }
  relations = bodyRelations; page = bodyPage; y = bodyY;
  for (const { decision, issue, locator, affected } of propertyInventory.values()) {
    const unresolvedStyle = issue.state === 'uncertain' && /style|ancestry|default|numbering|table properties/.test(issue.reason);
    const direction = decision.property === 'bidi' || decision.property === 'textDirection';
    const code = direction ? 'DOCX_TEXT_DIRECTION' : unresolvedStyle ? 'DOCX_STYLE_UNCERTAIN' : decision.scope === 'paragraph' ? 'DOCX_PARAGRAPH_SHADING' : 'DOCX_RUN_DECORATION';
    const property = decision.property === 'rtl' ? 'RTL' : decision.property === 'vertAlign' ? 'vertical alignment' : decision.property === 'bidi' ? 'bidirectional text' : decision.property === 'textDirection' ? 'text direction' : decision.property === 'shd' ? 'shading' : decision.property;
    add(code, `${decision.scope} ${property}: ${issue.state}${issue.conditional ? ' conditional context' : ''} (${issue.reason}; ${issue.origin.carrier}). Affected ${decision.scope} contexts: ${affected}. Representative ${locator.slice(0, 400)}; declaration ${issue.origin.locator.slice(0, 400)}. Import a matching PDF to preserve unsupported formatting.`, 'blocking');
  }
  for (const p of pages) p.regions.forEach((region, order) => { region.order = order; });
  const baseline = { revision: 1, blocks }, template = { id: newId(), revision: 1, pages, warnings, importerVersion: IMPORTER_VERSION };
  const normalized = normalizeDocxInkEnvelope(template, baseline, fontRegistry);
  if (normalized.expandedRegions) add('DOCX_INK_ENVELOPE', `Initial vertical bounds for ${normalized.expandedRegions} text regions were normalized to contain measured bundled-font ink. Wording, font size, line spacing, normalized text placement and paragraph flow are unchanged. Approved bounds stay fixed for future edits. Compare the original Word reference for font and placement differences.`);
  return { source, assets, template: normalized.template, baseline, facts };
}
