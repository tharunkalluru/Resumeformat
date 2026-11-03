import { W, attr, children, val } from './xml';

export type DocxProperty = 'rtl' | 'vertAlign' | 'shd' | 'bidi' | 'textDirection' | 'position' | 'fitText' | 'highlight';
export type DocxPropertyState = 'absent' | 'noOp' | 'active' | 'uncertain';
type Scope = 'paragraph' | 'run';
type StyleType = 'paragraph' | 'character' | 'table';
export interface DocxPropertyOrigin { locator: string; carrier: string }
export interface DocxPropertyIssue {
  state: 'active' | 'uncertain'; reason: string; origin: DocxPropertyOrigin; count: number; conditional?: boolean;
}
export interface DocxPropertyDecision {
  property: DocxProperty; scope: Scope; state: DocxPropertyState; issues: readonly DocxPropertyIssue[];
}
export interface DocxParagraphContext {
  paragraph: Element; locator: string; table?: Element; numbering?: { numId: string; levelId: string };
}
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const properties: readonly DocxProperty[] = ['rtl', 'vertAlign', 'shd', 'position', 'fitText', 'highlight'];
const patterns = new Set(['solid', 'horzStripe', 'vertStripe', 'reverseDiagStripe', 'diagStripe', 'horzCross', 'diagCross', 'thinHorzStripe', 'thinVertStripe', 'thinReverseDiagStripe', 'thinDiagStripe', 'thinHorzCross', 'thinDiagCross', ...[5, 10, 12, 15, 20, 25, 30, 35, 37, 40, 45, 50, 55, 60, 62, 65, 70, 75, 80, 85, 87, 90, 95].map(n => `pct${n}`)]);
const empty = (property: DocxProperty, scope: Scope): DocxPropertyDecision => ({ property, scope, state: 'absent', issues: [] });
function issue(property: DocxProperty, scope: Scope, reason: string, origin: DocxPropertyOrigin, state: 'active' | 'uncertain' = 'uncertain'): DocxPropertyDecision {
  return { property, scope, state, issues: [{ state, reason, origin, count: 1 }] };
}
/** Compact witnesses avoid copying a full ancestor list for each descendant. */
function combine(property: DocxProperty, scope: Scope, decisions: readonly DocxPropertyDecision[]): DocxPropertyDecision {
  const inventory = new Map<string, DocxPropertyIssue>();
  for (const decision of decisions) for (const item of decision.issues) {
    const key = `${item.state}:${item.reason}:${item.origin.carrier}:${!!item.conditional}`;
    const prior = inventory.get(key);
    inventory.set(key, prior ? { ...prior, count: prior.count + item.count } : { ...item });
  }
  const issues = [...inventory.values()];
  return { property, scope, state: issues.some(i => i.state === 'uncertain') ? 'uncertain' : issues.length ? 'active' : decisions.some(d => d.state === 'noOp') ? 'noOp' : 'absent', issues };
}
function relevantExtension(element: Element, property: DocxProperty, scope: Scope): boolean {
  const stack = [element];
  while (stack.length) {
    const next = stack.pop()!;
    if (next.localName === property) {
      // A nested run property is not paragraph shading.
      let parent = next.parentElement; let nearest: string | undefined;
      while (parent && parent !== element.parentElement) {
        if (parent.namespaceURI === W && ['pPr', 'rPr'].includes(parent.localName)) { nearest = parent.localName; break; }
        parent = parent.parentElement;
      }
      if (!nearest || (scope === 'paragraph' ? nearest === 'pPr' : nearest === 'rPr')) return true;
    }
    stack.push(...Array.from(next.children));
  }
  return false;
}

function extensionReference(element: Element, scope: Scope): boolean {
  const stack = [element];
  while (stack.length) {
    const next = stack.pop()!;
    if (next.localName === 'pStyle' || scope === 'run' && next.localName === 'rStyle') return true;
    stack.push(...Array.from(next.children));
  }
  return false;
}

/** Exact namespace/value semantics; does not mutate XML or infer general overrides. */
export function classifyDocxProperty(carrier: Element | undefined, property: DocxProperty, origin: DocxPropertyOrigin, scope: Scope = carrier?.localName === 'pPr' ? 'paragraph' : 'run'): DocxPropertyDecision {
  if (!carrier) return empty(property, scope);
  const found = children(carrier, property);
  const foreign = Array.from(carrier.children).filter(n => !found.includes(n));
  if (foreign.some(n => relevantExtension(n, property, scope))) return issue(property, scope, 'unresolved extension or alternate content', origin);
  if (found.length > 1) return issue(property, scope, 'duplicate property declarations', origin);
  if (!found.length) return empty(property, scope);
  const node = found[0];
  if (node.children.length || node.textContent?.trim()) return issue(property, scope, 'unexpected property content', origin);
  const allowed = property === 'shd' ? ['val', 'fill', 'color'] : ['val'];
  for (const attribute of Array.from(node.attributes)) {
    if (attribute.namespaceURI === XMLNS) continue;
    if (attribute.namespaceURI !== W || !allowed.includes(attribute.localName)) {
      return issue(property, scope, attribute.namespaceURI === W && /theme|tint|shade/i.test(attribute.localName) ? 'theme-dependent paint' : 'unrecognized property attribute', origin);
    }
  }
  const value = val(node);
  if (['position', 'fitText', 'highlight'].includes(property)) return issue(property, scope, `unsupported ${property} declaration`, origin, 'active');
  if (property === 'bidi' || property === 'textDirection') return issue(property, scope, `paragraph ${property} declaration`, origin, 'active');
  if (property === 'rtl') {
    if (['0', 'false', 'off'].includes(value ?? '')) return { property, scope, state: 'noOp', issues: [] };
    if (value === undefined || ['1', 'true', 'on'].includes(value)) return issue(property, scope, value === undefined ? 'enabled RTL with omitted value' : 'enabled RTL', origin, 'active');
  } else if (property === 'vertAlign') {
    if (value === 'baseline') return { property, scope, state: 'noOp', issues: [] };
    if (value === 'superscript' || value === 'subscript') return issue(property, scope, value, origin, 'active');
  } else {
    const fill = attr(node, 'fill'), color = attr(node, 'color');
    if (value === 'clear' && fill === 'auto' && (color === undefined || color === 'auto')) return { property, scope, state: 'noOp', issues: [] };
    if (fill && /^[a-fA-F0-9]{6}$/.test(fill) || color && /^[a-fA-F0-9]{6}$/.test(color)) return issue(property, scope, 'concrete shading color', origin, 'active');
    if (value && patterns.has(value)) return issue(property, scope, 'patterned shading', origin, 'active');
  }
  return issue(property, scope, value === undefined ? 'missing property value' : 'unknown or incomplete property value', origin);
}

export function createDocxPropertyResolver(options: { styles?: Document; numbering?: Document }) {
  const styleRoot = options.styles?.documentElement;
  const validRoot = !styleRoot || styleRoot.namespaceURI === W && styleRoot.localName === 'styles';
  const styleElements = validRoot && styleRoot ? children(styleRoot, 'style') : [];
  const styleIndex = new Map<string, Element[]>(), stylePositions = new Map<Element, number>();
  styleElements.forEach((s, i) => { const id = attr(s, 'styleId'); if (id !== undefined) styleIndex.set(id, [...(styleIndex.get(id) ?? []), s]); stylePositions.set(s, i + 1); });
  const cache = new Map<string, DocxPropertyDecision>();
  const origin = (locator: string, carrier: string): DocxPropertyOrigin => ({ locator, carrier });
  const scoped = (parent: Element | undefined, scope: Scope, property: DocxProperty, location: string, carrier: string): DocxPropertyDecision => {
    if (!parent) return empty(property, scope);
    const nodes = children(parent, scope === 'paragraph' ? 'pPr' : 'rPr');
    const decisions = nodes.map((n, i) => classifyDocxProperty(n, property, origin(`${location}/${scope === 'paragraph' ? 'pPr' : 'rPr'}[${i + 1}]`, carrier), scope));
    if (nodes.length > 1) decisions.push(issue(property, scope, 'duplicate property containers', origin(location, carrier)));
    const paragraphCarriers = children(parent, 'pPr');
    if (scope === 'run') for (const ppr of paragraphCarriers) {
      const nested = children(ppr, 'rPr');
      decisions.push(...nested.map((n, i) => classifyDocxProperty(n, property, origin(`${location}/pPr/rPr[${i + 1}]`, carrier), scope)));
      if (nested.length > 1) decisions.push(issue(property, scope, 'duplicate paragraph-mark properties', origin(location, carrier)));
    }
    if (Array.from(parent.children).some(n => (n.namespaceURI !== W || ['rPrChange', 'pPrChange'].includes(n.localName)) && (relevantExtension(n, property, scope) || extensionReference(n, scope)))) decisions.push(issue(property, scope, 'unresolved extension or alternate content', origin(location, carrier)));
    for (const node of [...nodes, ...paragraphCarriers]) if (Array.from(node.children).some(n => (n.namespaceURI !== W || ['rPrChange', 'pPrChange'].includes(n.localName)) && extensionReference(n, scope))) decisions.push(issue(property, scope, 'unresolved extension style reference', origin(location, carrier)));
    for (const ppr of paragraphCarriers) for (const numPr of children(ppr, 'numPr')) {
      if (!reference(numPr, 'numId').id && !reference(numPr, 'numId').invalid) decisions.push(issue(property, scope, 'partial paragraph numbering reference', origin(location, 'numberingLevel')));
    }
    if (scope === 'run' && carrier !== 'runDirect') {
      const runCarriers = [...nodes, ...children(parent, 'pPr').flatMap(ppr => children(ppr, 'rPr'))];
      if (runCarriers.some(n => reference(n, 'rStyle').id || reference(n, 'rStyle').invalid || Array.from(n.children).some(e => (e.namespaceURI !== W || ['rPrChange', 'pPrChange'].includes(e.localName)) && extensionReference(e, scope)))) decisions.push(issue(property, scope, 'unresolved internal character style reference', origin(location, carrier)));
    }
    return combine(property, scope, decisions);
  };
  const reference = (parent: Element | undefined, name: string): { id?: string; invalid?: boolean } => {
    if (!parent) return {};
    const refs = children(parent, name);
    if (!refs.length) return {};
    const id = val(refs[0]);
    const badAttributes = Array.from(refs[0].attributes).some(a => a.namespaceURI !== XMLNS && (a.namespaceURI !== W || a.localName !== 'val'));
    return refs.length !== 1 || !id || refs[0].children.length || badAttributes ? { invalid: true } : { id };
  };
  const defaultSelections = new Map<StyleType, { id?: string; invalid?: boolean }>();
  const defaultStyle = (type: StyleType): { id?: string; invalid?: boolean } => {
    const known = defaultSelections.get(type); if (known) return known;
    const candidates = styleElements.filter(s => attr(s, 'default') !== undefined && !['0', 'false', 'off'].includes(attr(s, 'default')!) && (attr(s, 'type') === type || !['paragraph', 'character', 'table', 'numbering'].includes(attr(s, 'type') ?? '')));
    const wrappedDefault = styleRoot && Array.from(styleRoot.children).filter(n => n.namespaceURI !== W).some(wrapper => {
      const stack = [wrapper];
      while (stack.length) {
        const n = stack.pop()!;
        if (n.localName === 'style' && attr(n, 'default') !== undefined && !['0', 'false', 'off'].includes(attr(n, 'default')!) && (attr(n, 'type') === type || !['paragraph', 'character', 'table', 'numbering'].includes(attr(n, 'type') ?? ''))) return true;
        stack.push(...Array.from(n.children));
      }
      return false;
    });
    const s = candidates[0], id = s ? attr(s, 'styleId') : undefined;
    const selected = wrappedDefault ? { invalid: true } : !s ? {} : candidates.length !== 1 || attr(s, 'type') !== type || !['1', 'true', 'on'].includes(attr(s, 'default') ?? '') || !id ? { invalid: true } : { id };
    defaultSelections.set(type, selected); return selected;
  };
  function style(id: string, type: StyleType, scope: Scope, property: DocxProperty): DocxPropertyDecision {
    const key = (name: string) => JSON.stringify([name, type, scope, property]);
    const initialKey = key(id); const cached = cache.get(initialKey); if (cached) return cached;
    const path: { id: string; own: DocxPropertyDecision }[] = [], seen = new Set<string>();
    let current: string | undefined = id, suffix = empty(property, scope);
    while (current !== undefined) {
      const prior = cache.get(key(current)); if (prior) { suffix = prior; break; }
      if (seen.has(current) || path.length > styleElements.length) { suffix = issue(property, scope, 'cyclic style ancestry', origin('word/styles.xml', `${type}Style`)); break; }
      seen.add(current);
      const entries = styleIndex.get(current);
      if (!entries || entries.length !== 1) { suffix = issue(property, scope, entries ? 'duplicate style identifier' : 'missing referenced style or parent', origin('word/styles.xml', `${type}Style`)); break; }
      const item = entries[0], location = `word/styles.xml/style[${stylePositions.get(item)}]`;
      let own = scoped(item, scope, property, location, `${type}Style`);
      if (attr(item, 'type') !== type) own = combine(property, scope, [own, issue(property, scope, 'missing or incompatible style type', origin(location, `${type}Style`))]);
      const link = reference(item, 'link');
      if (link.id || link.invalid) {
        const target = link.id ? styleIndex.get(link.id) : undefined;
        const opposite = type === 'paragraph' ? 'character' : type === 'character' ? 'paragraph' : undefined;
        if (link.invalid || !opposite || !target || target.length !== 1 || attr(target[0], 'type') !== opposite) own = combine(property, scope, [own, issue(property, scope, 'unresolved linked style', origin(location, `${type}Style`))]);
        // A valid reciprocal paragraph/character link is metadata, not an ancestry edge.
      }
      for (const ppr of children(item, 'pPr')) if (reference(ppr, 'pStyle').id || reference(ppr, 'pStyle').invalid) own = combine(property, scope, [own, issue(property, scope, 'unresolved style-internal paragraph reference', origin(location, `${type}Style`))]);
      if (type === 'table') for (const [i, conditional] of children(item, 'tblStylePr').entries()) {
        const conditionalDecision = scoped(conditional, scope, property, `${location}/tblStylePr[${i + 1}]`, 'tableConditionalStyle');
        own = combine(property, scope, [own, { ...conditionalDecision, state: conditionalDecision.issues.length ? 'uncertain' : conditionalDecision.state, issues: conditionalDecision.issues.map(item => ({ ...item, state: 'uncertain' as const, conditional: true })) }]);
      }
      const parent = reference(item, 'basedOn');
      if (parent.invalid) own = combine(property, scope, [own, issue(property, scope, 'ambiguous style parent', origin(location, `${type}Style`))]);
      path.push({ id: current, own }); current = parent.invalid ? undefined : parent.id;
    }
    for (let i = path.length - 1; i >= 0; i--) { suffix = combine(property, scope, [suffix, path[i].own]); cache.set(key(path[i].id), suffix); }
    cache.set(initialKey, suffix); return suffix;
  }
  const selectedStyle = (ref: { id?: string; invalid?: boolean }, type: StyleType, scope: Scope, property: DocxProperty, location: string): DocxPropertyDecision => {
    if (!validRoot) return issue(property, scope, 'unresolved styles document', origin('word/styles.xml', `${type}Style`));
    const selected = ref.id || ref.invalid ? ref : defaultStyle(type);
    if (selected.invalid) return issue(property, scope, ref.invalid ? 'ambiguous style reference' : 'ambiguous default style', origin(location, `${type}Style`));
    return selected.id ? style(selected.id, type, scope, property) : empty(property, scope);
  };
  function documentDefaults(scope: Scope, property: DocxProperty): DocxPropertyDecision {
    if (!styleRoot) return empty(property, scope);
    if (!validRoot) return issue(property, scope, 'unresolved styles document', origin('word/styles.xml', 'documentDefault'));
    const defaults = children(styleRoot, 'docDefaults'), decisions: DocxPropertyDecision[] = [];
    if (defaults.length > 1) decisions.push(issue(property, scope, 'ambiguous document defaults', origin('word/styles.xml/docDefaults', 'documentDefault')));
    for (const dd of defaults) if (Array.from(dd.children).some(n => n.namespaceURI !== W && (relevantExtension(n, property, scope) || extensionReference(n, scope)))) decisions.push(issue(property, scope, 'unresolved document-default extension', origin('word/styles.xml/docDefaults', 'documentDefault')));
    for (const dd of defaults) for (const kind of scope === 'paragraph' ? ['pPrDefault'] : ['pPrDefault', 'rPrDefault']) {
      const containers = children(dd, kind);
      if (containers.length > 1) decisions.push(issue(property, scope, 'ambiguous document-default carrier', origin(`word/styles.xml/docDefaults/${kind}`, 'documentDefault')));
      for (const container of containers) decisions.push(scoped(container, scope, property, `word/styles.xml/docDefaults/${kind}`, 'documentDefault'));
      if (scope === 'run' && kind === 'pPrDefault') for (const container of containers) if (children(container, 'pPr').length > 1) decisions.push(issue(property, scope, 'duplicate paragraph-default properties', origin('word/styles.xml/docDefaults/pPrDefault', 'documentDefault')));
    }
    if (Array.from(styleRoot.children).some(n => n.namespaceURI !== W && (n.localName === 'docDefaults' || Array.from(n.getElementsByTagNameNS(W, 'docDefaults')).length))) decisions.push(issue(property, scope, 'unresolved default extension', origin('word/styles.xml', 'documentDefault')));
    return combine(property, scope, decisions);
  }
  const defaultCache = new Map<string, DocxPropertyDecision>();
  const defaults = (scope: Scope, property: DocxProperty) => { const key = `${scope}:${property}`; if (!defaultCache.has(key)) defaultCache.set(key, documentDefaults(scope, property)); return defaultCache.get(key)!; };
  function table(context: DocxParagraphContext, scope: Scope, property: DocxProperty): DocxPropertyDecision {
    if (!context.table) return empty(property, scope);
    const containers = children(context.table, 'tblPr');
    if (containers.length > 1) return issue(property, scope, 'ambiguous table properties', origin(context.locator, 'tableStyle'));
    return selectedStyle(reference(containers[0], 'tblStyle'), 'table', scope, property, context.locator);
  }
  const numberingRoot = options.numbering?.documentElement;
  const nums = new Map<string, Element[]>(), abstracts = new Map<string, Element[]>();
  if (numberingRoot?.namespaceURI === W && numberingRoot.localName === 'numbering') {
    for (const n of children(numberingRoot, 'num')) { const id = attr(n, 'numId'); if (id !== undefined) nums.set(id, [...(nums.get(id) ?? []), n]); }
    for (const n of children(numberingRoot, 'abstractNum')) { const id = attr(n, 'abstractNumId'); if (id !== undefined) abstracts.set(id, [...(abstracts.get(id) ?? []), n]); }
  }
  function numbering(context: DocxParagraphContext, scope: Scope, property: DocxProperty): DocxPropertyDecision {
    if (!context.numbering || context.numbering.numId === '0') return empty(property, scope);
    const location = 'word/numbering.xml', unresolved = (reason: string) => issue(property, scope, reason, origin(location, 'numberingLevel'));
    const selected = nums.get(context.numbering.numId);
    if (!selected || selected.length !== 1) return unresolved('missing or ambiguous numbering identifier');
    const abstractRef = reference(selected[0], 'abstractNumId'), abstract = abstractRef.id ? abstracts.get(abstractRef.id) : undefined;
    if (abstractRef.invalid || !abstract || abstract.length !== 1) return unresolved('missing or ambiguous abstract numbering');
    const levels = children(abstract[0], 'lvl').filter(l => attr(l, 'ilvl') === context.numbering!.levelId);
    if (levels.length !== 1) return unresolved('missing or ambiguous numbering level');
    let decision = scoped(levels[0], scope, property, `${location}/abstractNum/lvl[${children(abstract[0], 'lvl').indexOf(levels[0]) + 1}]`, 'numberingLevel');
    const overrides = children(selected[0], 'lvlOverride').filter(l => attr(l, 'ilvl') === context.numbering!.levelId);
    for (const override of overrides) decision = combine(property, scope, [decision, scoped(override, scope, property, `${location}/lvlOverride`, 'numberingLevel'), ...children(override, 'lvl').map(l => scoped(l, scope, property, `${location}/lvlOverride/lvl`, 'numberingLevel'))]);
    if (overrides.length) decision = combine(property, scope, [decision, unresolved('unresolved numbering override')]);
    for (const name of ['numStyleLink', 'styleLink']) if (children(abstract[0], name).length) decision = combine(property, scope, [decision, unresolved('unresolved numbering style link')]);
    const styleRef = reference(levels[0], 'pStyle');
    if (styleRef.id || styleRef.invalid) decision = combine(property, scope, [decision, selectedStyle(styleRef, 'paragraph', scope, property, location)]);
    for (const ppr of children(levels[0], 'pPr')) {
      const ref = reference(ppr, 'pStyle'); if (ref.id || ref.invalid) decision = combine(property, scope, [decision, selectedStyle(ref, 'paragraph', scope, property, location)]);
    }
    return decision;
  }
  const paragraphCache = new WeakMap<DocxParagraphContext, Map<string, DocxPropertyDecision>>();
  function paragraph(context: DocxParagraphContext, scope: Scope, property: DocxProperty): DocxPropertyDecision {
    const key = `${scope}:${property}`, known = paragraphCache.get(context);
    const cached = known?.get(key); if (cached) return cached;
    const pprs = children(context.paragraph, 'pPr');
    const decisions = [defaults(scope, property), selectedStyle(reference(pprs[0], 'pStyle'), 'paragraph', scope, property, context.locator), table(context, scope, property), numbering(context, scope, property), scoped(context.paragraph, scope, property, context.locator, 'paragraphDirect')];
    if (pprs.length > 1) decisions.push(issue(property, scope, 'duplicate paragraph properties', origin(context.locator, 'paragraphDirect')));
    for (const ppr of pprs) {
      const lists = children(ppr, 'numPr');
      if (lists.length > 1 || lists.some(n => reference(n, 'numId').invalid || reference(n, 'ilvl').invalid)) decisions.push(issue(property, scope, 'ambiguous paragraph numbering reference', origin(context.locator, 'numberingLevel')));
    }
    const decision = combine(property, scope, decisions), record = known ?? new Map<string, DocxPropertyDecision>();
    record.set(key, decision); paragraphCache.set(context, record); return decision;
  }
  return {
    paragraph: (context: DocxParagraphContext) => paragraph(context, 'paragraph', 'shd'),
    directions: (context: DocxParagraphContext) => (['bidi', 'textDirection'] as const).map(property => paragraph(context, 'paragraph', property)),
    run(context: DocxParagraphContext, run: Element, runIndex: number): readonly DocxPropertyDecision[] {
      const rprs = children(run, 'rPr'), location = `${context.locator}/r[${runIndex}]`;
      return [
        ...properties.map(property => combine(property, 'run', [paragraph(context, 'run', property), selectedStyle(reference(rprs[0], 'rStyle'), 'character', 'run', property, location), scoped(run, 'run', property, location, 'runDirect')])),
        ...(['bidi', 'textDirection'] as const).map(property => ({ ...selectedStyle(reference(rprs[0], 'rStyle'), 'character', 'paragraph', property, location), scope: 'run' as const })),
      ];
    },
  };
}
