import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { originalOperators } from './pdf-image-trace';
import { classifyScopedMarkedDictionary, originalScopedPaint, scopedInkContained, traceScopedPaint, type ScopedPaintOptions } from './pdf-scoped-paint';

const options: ScopedPaintOptions = { viewport: [1, 0, 0, -1, 0, 200], pageBounds: { x: 0, y: 0, width: 300, height: 200 } };
const text = 'BT /F 12 Tf 1 0 0 1 10 20 Tm (fictional) Tj ET';
const trace = (source: string, extra: Partial<ScopedPaintOptions> = {}) => traceScopedPaint(originalOperators(source), { ...options, ...extra });
async function authored(source: string) {
  const pdf = await PDFDocument.create(), page = pdf.addPage([300, 200]);
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(new TextEncoder().encode(source))));
  return { pdf, page };
}

describe('raw scoped paint lifecycle independent of source font admission', () => {
  it('keeps text, rectangle and next text in actual paint order with owned clip lifecycle indices', () => {
    const result = trace(`q 0 0 100 100 re W* n ${text} 10 10 20 2 re f* ${text} Q`);
    expect(result.occurrences.map(o => o.kind)).toEqual(['text', 'fillRect', 'text']);
    expect(result.clips).toEqual([{ pathOperatorIndex: 1, clipOperatorIndex: 2, endOperatorIndex: 3, fillRule: 'evenodd', constructionCtm: options.viewport, bounds: { x: 0, y: 100, width: 100, height: 100 } }]);
    expect(result.occurrences.map(o => o.rawOperatorIndex)).toEqual([...result.occurrences.map(o => o.rawOperatorIndex)].sort((a, b) => a - b));
    expect(result.occurrences.every(o => o.clipStack.length === 1 && o.effectiveClip.height === 100)).toBe(true);
  });

  it('intersects looser nested clips and retains disjoint suppression as an empty clip', () => {
    const result = trace(`q 10 10 20 20 re W n q 0 0 100 100 re W* n ${text} Q 200 150 10 10 re W n ${text} Q`);
    expect(result.occurrences[0].effectiveClip).toEqual({ x: 10, y: 170, width: 20, height: 20 });
    expect(result.occurrences[0].clipStack).toHaveLength(2);
    expect(result.occurrences[1].effectiveClip.width).toBe(0);
    expect(result.occurrences[1].effectiveClip.height).toBe(0);
    expect(scopedInkContained(result.occurrences[1].effectiveClip, { x: 200, y: 45, width: 1, height: 1 })).toBe(false);
  });

  it('retains W and W* as distinct source rules while their one-rectangle intersection is identical', () => {
    const a = trace(`0 0 100 100 re W n ${text}`), b = trace(`0 0 100 100 re W* n ${text}`);
    expect(a.occurrences[0].effectiveClip).toEqual(b.occurrences[0].effectiveClip);
    expect(a.clips[0].fillRule).toBe('nonzero'); expect(b.clips[0].fillRule).toBe('evenodd');
  });

  it('freezes path coordinates at construction and excludes current path from q/Q snapshots', () => {
    const before = trace(`10 20 30 40 re q 2 0 0 2 50 60 cm W* n ${text} Q ${text}`);
    expect(before.clips[0].bounds).toEqual({ x: 10, y: 140, width: 30, height: 40 });
    expect(before.occurrences[1].clipStack).toHaveLength(0);
    const inside = trace(`q 2 0 0 2 50 60 cm 10 20 30 40 re Q W n ${text}`);
    expect(inside.clips[0].bounds).toEqual({ x: 70, y: 20, width: 60, height: 80 });
  });

  it('restores clip and exact fill color before the following text paint', () => {
    const result = trace(`.9 .1 .2 rg q .4 g 0 0 100 100 re W n ${text} Q ${text}`);
    expect(result.occurrences[0]).toMatchObject({ kind: 'text', color: { space: 'DeviceGray', components: [.4] } });
    expect(result.occurrences[1]).toMatchObject({ kind: 'text', color: { space: 'DeviceRGB', components: [.9, .1, .2] }, clipStack: [], effectiveClip: options.pageBounds });
  });

  it('paints before pending clipping is applied at a fill termination', () => {
    const result = trace(`10 20 30 40 re W* f ${text}`);
    expect(result.occurrences[0].effectiveClip).toEqual(options.pageBounds);
    expect(result.occurrences[0].clipStack).toEqual([]);
    expect(result.occurrences[1].effectiveClip).toEqual({ x: 10, y: 140, width: 30, height: 40 });
    expect(result.clips[0].endOperatorIndex).toBe(2);
  });

  it('transforms both endpoints for signed rectangle dimensions and reflected CTMs', () => {
    const result = trace(`q -2 0 0 3 100 20 cm 20 30 -10 -5 re W* n ${text} Q`);
    expect(result.clips[0].bounds).toEqual({ x: 60, y: 90, width: 20, height: 15 });
  });

  it('preserves an opaque horizontal butt-cap rule with source color and uniform width', () => {
    const result = trace('q 2 0 0 2 0 0 cm .1 .2 .3 RG 2 w 5 5 m 15 5 l S Q');
    expect(result.occurrences).toEqual([{ kind: 'strokeRule', rawOperatorIndex: 6, pathOperatorIndex: 4, bounds: { x: 10, y: 190, width: 20, height: 0 }, thickness: 4, lineCap: 0, lineJoin: 0, color: { space: 'DeviceRGB', components: [.1, .2, .3] }, clipStack: [], effectiveClip: options.pageBounds }]);
  });

  it('preserves the solid source rule with an empty dash reset and repeated identical empty move', () => {
    const result = trace('q .1 .2 .3 RG 2 w [] 0 d 5 5 m 5 5 m 15 5 l S Q');
    expect(result.occurrences).toEqual([{ kind: 'strokeRule', rawOperatorIndex: 7, pathOperatorIndex: 4, bounds: { x: 5, y: 195, width: 10, height: 0 }, thickness: 2, lineCap: 0, lineJoin: 0, color: { space: 'DeviceRGB', components: [.1, .2, .3] }, clipStack: [], effectiveClip: options.pageBounds }]);
    expect(trace('[ \n% empty solid reset\n\t] -0 d 0 0 m q 0 0 m Q 10 0 l S').occurrences[0]).toMatchObject({ kind: 'strokeRule', pathOperatorIndex: 1, bounds: { x: 0, y: 200, width: 10, height: 0 } });
  });

  it.each([
    '[3] 0 d', '[0] 0 d', '[[]] 0 d', '[( )] 0 d', '[<<>>] 0 d',
    '[] 1 d', '[] -.1 d', '[] 0 0 d', '0 d',
    '0 0 m 1 0 m 10 0 l S', '0 0 m 10 0 l 10 0 m S',
    '0 0 10 10 re 0 0 m n', '0 0 m q 2 0 0 2 0 0 cm 0 0 m Q 10 0 l S',
    '0 0 10 10 re W 0 0 m n', 'BT /F 12 Tf 0 0 m ET',
  ])('retains active dash and compound/changed path refusals: %s', source => {
    expect(() => trace(source)).toThrow(/Original scoped paint is unsupported/);
  });

  it('requires an actual tokenizer-owned empty array and finite zero phase', () => {
    for (const marker of [{ opaque: true }, { opaque: true, emptyArray: false }, { opaque: true, emptyArray: true, mcid: 1 }]) {
      expect(() => traceScopedPaint([{ word: 'd', args: [marker as never, 0], index: 0 }], options)).toThrow();
    }
    for (const phase of [Infinity, NaN, 1e-12]) {
      expect(() => traceScopedPaint([{ word: 'd', args: [{ opaque: true, emptyArray: true } as never, phase], index: 0 }], options)).toThrow();
    }
  });

  it('does not waive minimal ascender, italic overhang, decoration or edited ink outside a clip', () => {
    const clip = { x: 10, y: 10, width: 20, height: 20 };
    expect(scopedInkContained(clip, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    for (const ink of [{ x: 10 - 1e-10, y: 10, width: 20, height: 20 }, { x: 10, y: 10 - 1e-10, width: 20, height: 20 }, { x: 10, y: 10, width: 20 + 1e-10, height: 20 }, { x: 10, y: 10, width: 20, height: 20 + 1e-10 }]) expect(scopedInkContained(clip, ink)).toBe(false);
    expect(scopedInkContained(clip, { x: 10, y: 10, width: -1, height: 1 })).toBe(false);
  });

  it.each([
    'Q', 'q', '0 0 10 10 re', '0 0 10 10 re W',
    '0 0 10 10 re W .5 g n', '0 0 10 10 re 2 2 2 2 re W n',
    '0 0 m 10 0 l W n', '0 0 m 10 10 l S', '0 w 0 0 m 10 0 l S',
    '1 J 0 0 m 10 0 l S', '2 0 0 3 0 0 cm 0 0 m 10 0 l S',
    '1 .1 0 1 0 0 cm', '0 0 10 10 re B', '/Pattern cs', '[2] 0 d',
    'BT /F 12 Tf 1 Tr (fictional) Tj ET', 'BT /F 12 Tf 1 Tw (fictional) Tj ET',
    '/OC << /MCID 1 >> BDC EMC', '/Span << /ActualText (hidden) >> BDC EMC',
    'BX EX', '/Form Do', '1 0 0 1 0 0 Tm', '(fictional) Tj',
  ])('refuses unsupported or unfinished raw state: %s', source => {
    expect(() => trace(source)).toThrow(/Original scoped paint is unsupported/);
  });

  it('accepts bounded MCID marks without treating arbitrary dictionaries as paint proof', () => {
    expect(trace(`/Span << /MCID 1 >> BDC ${text} EMC`).occurrences).toHaveLength(1);
    expect(() => trace(`/Span << /MCID 1 /ActualText (hidden) >> BDC ${text} EMC`)).toThrow();
  });

  it('requires contiguous raw operator identities and a bounded graphics stack', () => {
    const ops = originalOperators(text); ops[0].index = 10;
    expect(() => traceScopedPaint(ops, options)).toThrow(/operator identity/);
    expect(() => trace('q '.repeat(65) + 'Q '.repeat(65))).toThrow(/stack budget/);
    expect(() => trace('/Bad gs', { graphicsStates: new Map([['Bad', { lineWidth: Infinity }]]) })).toThrow();
  });

  it('bounds sequential active clipping even when q/Q depth is zero', () => {
    expect(() => trace('0 0 100 100 re W n '.repeat(65))).toThrow(/clip inventory budget/);
  });

  it('bounds cumulative clip inventories after independent scopes restore', () => {
    expect(() => trace('q 0 0 100 100 re W n Q '.repeat(4097))).toThrow(/clip inventory budget/);
  });

  it('bounds copied clip references across many text paints', () => {
    expect(() => trace('0 0 100 100 re W n '.repeat(64) + `${text} `.repeat(1563))).toThrow(/clip-reference budget/);
  });
});

describe('original page resource containment before compiled operator traces', () => {
  it('traces actual authored page bytes and rejects a hidden default RGB override', async () => {
    const { pdf, page } = await authored(text);
    expect(originalScopedPaint(pdf, 1).occurrences).toHaveLength(1);
    page.node.Resources()!.set(PDFName.of('ColorSpace'), pdf.context.obj({ DefaultRGB: PDFName.of('DeviceRGB') }));
    expect(() => originalScopedPaint(pdf, 1)).toThrow(/default color-space override/);
  });

  it.each([{ ca: .5 }, { CA: .5 }, { BM: PDFName.of('Multiply') }, { SMask: PDFName.of('Alpha') }, { Font: [PDFName.of('F'), 12] }, { TR: PDFName.of('Identity') }, { OP: true }, { SA: PDFName.of('true') }, { SA: 1 }])('rejects unsupported original graphics state %j', async values => {
    const { pdf, page } = await authored(`/G gs ${text}`);
    page.node.Resources()!.set(PDFName.of('ExtGState'), pdf.context.obj({ G: pdf.context.register(pdf.context.obj(values)) }));
    expect(() => originalScopedPaint(pdf, 1)).toThrow(/Original scoped paint is unsupported/);
  });

  it('admits a boolean stroke-adjustment resource for fill-only paint, including an unused resource', async () => {
    for (const prefix of ['', '/Adjusted gs ']) {
      const { pdf, page } = await authored(`${prefix}${text} 10 10 20 2 re f`);
      page.node.Resources()!.set(PDFName.of('ExtGState'), pdf.context.obj({ Adjusted: { SA: true } }));
      expect(originalScopedPaint(pdf, 1).occurrences.map(paint => paint.kind)).toEqual(['text', 'fillRect']);
    }
  });

  it('preserves Apple booleans through inheritance and nested graphics scopes',async()=>{
    const {pdf,page}=await authored(`/Off gs ${text} q /On gs 10 10 20 2 re f Q /Width gs 10 20 m 30 20 l S`);
    page.node.Resources()!.set(PDFName.of('ExtGState'),pdf.context.obj({Off:{'AAPL:AA':false},On:{'AAPL:AA':true},Width:{LW:1}}));
    expect(originalScopedPaint(pdf,1).occurrences.map(p=>p.appleAA)).toEqual([false,true,false]);
    const plain=await authored(text);expect(originalScopedPaint(plain.pdf,1).occurrences[0]).not.toHaveProperty('appleAA');
  });
  it.each([1,PDFName.of('true')])('refuses malformed Apple resource value %s',async value=>{
    const {pdf,page}=await authored(`/Bad gs ${text}`);page.node.Resources()!.set(PDFName.of('ExtGState'),pdf.context.obj({Bad:{'AAPL:AA':value}}));expect(()=>originalScopedPaint(pdf,1)).toThrow(/invalid Apple graphics state/);
  });
  it('does not silently replay an Apple state on an unproved image or accept unknown resource fields',()=>{
    expect(()=>trace('/Apple gs /Image Do',{allowDirectImages:true,graphicsStates:new Map([['Apple',{appleAA:false}]])})).toThrow(/image replay is unproved/);
    expect(()=>trace('/Bad gs',{graphicsStates:new Map([['Bad',{appleAA:1 as never}]])})).toThrow(/invalid proved graphics state/);
  });

  it('retains effective adjusted strokes and inherits SA through resources that omit it', async () => {
    for (const prefix of ['/Adjusted gs ', '/Adjusted gs /Width gs ', '/Adjusted gs q /Plain gs Q ']) {
      const { pdf, page } = await authored(`${prefix}10 10 m 30 10 l S`);
      page.node.Resources()!.set(PDFName.of('ExtGState'), pdf.context.obj({ Adjusted: { SA: true }, Plain: { SA: false }, Width: { LW: 2 } }));
      expect(originalScopedPaint(pdf, 1).occurrences[0]).toMatchObject({ kind: 'strokeRule', strokeAdjustment: true });
    }
  });

  it('restores and explicitly resets SA before an unadjusted stroke', async () => {
    for (const prefix of ['q /Adjusted gs 10 10 20 2 re f Q ', '/Adjusted gs /Plain gs ']) {
      const { pdf, page } = await authored(`${prefix}10 10 m 30 10 l S`);
      page.node.Resources()!.set(PDFName.of('ExtGState'), pdf.context.obj({ Adjusted: { SA: true }, Plain: { SA: false } }));
      const rule = originalScopedPaint(pdf, 1).occurrences.at(-1)!;
      expect(rule.kind).toBe('strokeRule'); expect('strokeAdjustment' in rule).toBe(false);
    }
    expect(() => trace('/Bad gs', { graphicsStates: new Map([['Bad', { strokeAdjustment: 1 as never }]]) })).toThrow(/invalid proved graphics state/);
  });

  it('resolves an actual opaque normal graphics-state resource and rejects page groups and units', async () => {
    const { pdf, page } = await authored(`/G gs ${text}`);
    page.node.Resources()!.set(PDFName.of('ExtGState'), pdf.context.obj({ G: pdf.context.register(pdf.context.obj({ Type: PDFName.of('ExtGState'), ca: 1, CA: 1, BM: PDFName.of('Normal'), SMask: PDFName.of('None'), LW: 2 })) }));
    expect(originalScopedPaint(pdf, 1).occurrences).toHaveLength(1);
    page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2)); expect(() => originalScopedPaint(pdf, 1)).toThrow(/page unit/);
    page.node.delete(PDFName.of('UserUnit')); page.node.set(PDFName.of('Group'), pdf.context.obj({ S: PDFName.of('Transparency') }));
    expect(() => originalScopedPaint(pdf, 1)).toThrow(/transparency group/);
  });

  it.each([false, true])('records bounded RGB page group isolation=%s for mandatory replay', async isolated => {
    const { pdf, page } = await authored(text);
    page.node.set(PDFName.of('Group'), pdf.context.obj({ Type: PDFName.of('Group'), S: PDFName.of('Transparency'), CS: PDFName.of('DeviceRGB'), I: isolated, K: false }));
    expect(originalScopedPaint(pdf, 1).pageGroup).toEqual({ version: 'rgb-page-transparency-v1', colorSpace: 'DeviceRGB', isolated, knockout: false });
  });

  it('retains specified/default page group flags instead of classifying the group as inert', async () => {
    const { pdf, page } = await authored(text);
    page.node.set(PDFName.of('Group'), pdf.context.obj({ Type: PDFName.of('Group'), S: PDFName.of('Transparency'), CS: PDFName.of('DeviceRGB') }));
    expect(originalScopedPaint(pdf, 1).pageGroup).toEqual({ version: 'rgb-page-transparency-v1', colorSpace: 'DeviceRGB', isolated: false, knockout: false });
  });

  it.each([{ K: true }, { I: PDFName.of('true') }, { CS: PDFName.of('DeviceGray') }, { CS: PDFName.of('CustomRGB') }, { Type: PDFName.of('Other') }, { ca: 1 }])('refuses unproved page group fields %j', async change => {
    const { pdf, page } = await authored(text);
    page.node.set(PDFName.of('Group'), pdf.context.obj({ Type: PDFName.of('Group'), S: PDFName.of('Transparency'), CS: PDFName.of('DeviceRGB'), ...change }));
    expect(() => originalScopedPaint(pdf, 1)).toThrow();
  });

  it('refuses a form XObject despite identical Do syntax and exposes no fake image ownership', async () => {
    const { pdf, page } = await authored('/Fake Do');
    const form = pdf.context.register(pdf.context.flateStream(new Uint8Array(), { Subtype: PDFName.of('Form') }));
    page.node.Resources()!.set(PDFName.of('XObject'), pdf.context.obj({ Fake: form }));
    expect(page.node.Resources()!.lookup(PDFName.of('XObject'), PDFDict)).toBeInstanceOf(PDFDict);
    expect(() => originalScopedPaint(pdf, 1)).toThrow();
  });
});

describe('bounded harmless marked metadata classifier', () => {
  it('preserves empty tag scopes without assigning text, artifact or layer semantics',async()=>{
    for(const tag of ['Figure','P','Span','Artifact']){const source=`/${tag} << % only whitespace and comments\n >> BDC ${text} EMC`;const result=traceScopedPaint(originalOperators(source,classifyScopedMarkedDictionary),options);expect(result.occurrences).toHaveLength(1);const {pdf}=await authored(source);expect(originalScopedPaint(pdf,1).occurrences).toHaveLength(1);}
    expect(classifyScopedMarkedDictionary('<<>>')).toEqual({kind:'empty'});expect(()=>traceScopedPaint(originalOperators(`/OC <<>> BDC ${text} EMC`,classifyScopedMarkedDictionary),options)).toThrow();expect(()=>traceScopedPaint(originalOperators(`/Figure <<>> BDC ${text}`,classifyScopedMarkedDictionary),options)).toThrow();
  });
  it('consumes complete MCID/language properties in either order, including comments and escaped names', () => {
    expect(classifyScopedMarkedDictionary('<< /MCID 0 /Lang (en-US) >>')).toEqual({ kind: 'structured', mcid: 0, language: 'en-US' });
    expect(classifyScopedMarkedDictionary('<< /Lang (en-IN) % comment\n /MC#49D 2 >>')).toEqual({ kind: 'structured', mcid: 2, language: 'en-IN' });
  });
  it('records bounded artifact properties without interpreting BBox as clipping', () => {
    expect(classifyScopedMarkedDictionary('<< /Type /Pagination /Subtype /Header /Attached [/Top /Left] /BBox [0 0 300 20] >>')).toEqual({ kind: 'artifact', artifactType: 'Pagination', artifactSubtype: 'Header', attached: ['Top', 'Left'], artifactBounds: [0, 0, 300, 20] });
  });
  it.each([
    '<< /MCID 0 /ActualText (hidden) >>', '<< /MCID 0 /Alt (hidden) >>', '<< /OC /Layer >>',
    '<< /MCID 0 /MCID 1 >>', '<< /MCID 0 /MC#49D 1 >>', '<< /MCID -1 >>', '<< /MCID 1.5 >>',
    '<< /MCID 0 /Lang (english words) >>', '<< /MCID 0 /Lang <656e> >>', '<< /Lang (en-US) >>',
    '<< /MCID 0 /Type /Pagination >>', '<< /Type /Pagination /Attached [/Top /Top] >>',
    '<< /Type /Pagination /Attached [/Secret] >>', '<< /Type /Pagination /BBox [0 0 1 1 2] >>',
    '<< /MCID 2 0 R >>', '<< /MCID << /MCID 0 >> >>', '<< /Unknown 0 >>',
  ])('refuses alternate, duplicated, nested or incomplete properties: %s', raw => {
    expect(() => classifyScopedMarkedDictionary(raw)).toThrow(/Original scoped paint is unsupported/);
  });
  it('does not reinterpret opaque text/arrays and bounds property allocation', () => {
    expect(classifyScopedMarkedDictionary('(fictional)')).toBeUndefined();
    expect(classifyScopedMarkedDictionary('[(fictional)]')).toBeUndefined();
    expect(() => classifyScopedMarkedDictionary(`<< ${' '.repeat(4096)} >>`)).toThrow(/budget/);
  });

  it('joins actual raw MCID/language and Artifact properties to bounded marking scopes', async () => {
    const { pdf } = await authored(`/Artifact <</Type/Pagination/Subtype/Header/Attached[/Top]>> BDC ${text} EMC /P <</MCID 0/Lang(en-US)>> BDC ${text} EMC`);
    expect(originalScopedPaint(pdf, 1).occurrences.map(o => o.kind)).toEqual(['text', 'text']);
  });

  it.each([
    `/Span <</Type/Pagination/Subtype/Header>> BDC ${text} EMC`,
    `/Artifact <</MCID 0/Lang(en-US)>> BDC ${text} EMC`,
    `/Span <</MCID 0/ActualText(hidden)>> BDC ${text} EMC`,
  ])('refuses a misleading tag/property coupling: %s', async source => {
    const { pdf } = await authored(source); expect(() => originalScopedPaint(pdf, 1)).toThrow();
  });
});

describe('explicit built-in DeviceRGB fill selection',()=>{
 it('preserves exact rgb components through cs/scn and q/Q with equivalent rg paint',()=>{const a=trace('0.2 0.3 0.4 rg 1 2 3 4 re f'),b=trace('/DeviceRGB cs 0.2 0.3 0.4 scn 1 2 3 4 re f');expect(b.occurrences[0].kind).toBe('fillRect');expect((b.occurrences[0] as any).color).toEqual((a.occurrences[0] as any).color);expect((b.occurrences[0] as any).bounds).toEqual((a.occurrences[0] as any).bounds);const c=trace('/DeviceRGB cs 0.2 0.3 0.4 scn q 0 g 1 2 3 4 re f Q 0.5 0.6 0.7 scn 1 2 3 4 re f');expect(c.occurrences.map(p=>(p as any).color)).toEqual([{space:'DeviceGray',components:[0]},{space:'DeviceRGB',components:[.5,.6,.7]}]);});
 it.each(['/DeviceRGB cs 0 0 scn','/DeviceRGB cs 0 0 0 0 scn','/DeviceRGB cs -0.1 0 0 scn','/DeviceRGB cs 1.1 0 0 scn','/DeviceRGB cs NaN 0 0 scn','/Alias cs 0 0 0 scn','/Pattern cs 0 0 0 scn','/Unknown cs 0 0 0 scn','/DeviceRGB cs 0 g 0 0 0 scn'])('refuses unsupported explicit selection/components %s',source=>{expect(()=>trace(source+' 1 2 3 4 re f')).toThrow();});
 it('keeps DefaultRGB, aliases, and opacity refusal in actual resource context',async()=>{for(const mode of ['default','alias','opacity']){const {pdf,page}=await authored((mode==='opacity'?'/Fade gs ':mode==='alias'?'/Alias cs ':'/DeviceRGB cs ')+'0 0 0 scn 1 2 3 4 re f');const resources=page.node.Resources()!;if(mode==='opacity')resources.set(PDFName.of('ExtGState'),pdf.context.obj({Fade:{ca:.5}}));else resources.set(PDFName.of('ColorSpace'),pdf.context.obj(mode==='default'?{DefaultRGB:'DeviceRGB'}:{Alias:'DeviceRGB'}));expect(()=>originalScopedPaint(pdf,1)).toThrow();}});
});

describe('explicit built-in DeviceRGB stroke selection',()=>{
 it('preserves exact stroke components and q/Q against RG without changing horizontal rule grammar',()=>{const path='1 w 10 20 m 40 20 l S';const a=trace('0.2 0.3 0.4 RG '+path),b=trace('/DeviceRGB CS 0.2 0.3 0.4 SCN '+path);expect((b.occurrences[0] as any).color).toEqual((a.occurrences[0] as any).color);expect((b.occurrences[0] as any).bounds).toEqual((a.occurrences[0] as any).bounds);const c=trace('/DeviceRGB CS 0.2 0.3 0.4 SCN q 0 G '+path+' Q 0.5 0.6 0.7 SCN '+path);expect(c.occurrences.map(p=>(p as any).color)).toEqual([{space:'DeviceGray',components:[0]},{space:'DeviceRGB',components:[.5,.6,.7]}]);});
 it.each(['/DeviceRGB CS 0 0 SCN','/DeviceRGB CS 0 0 0 0 SCN','/DeviceRGB CS -0.1 0 0 SCN','/DeviceRGB CS 1.1 0 0 SCN','/DeviceRGB CS NaN 0 0 SCN','/Alias CS 0 0 0 SCN','/Pattern CS 0 0 0 SCN','/OwnedICC CS 0 0 0 SCN','/DeviceRGB CS 0 G 0 0 0 SCN'])('refuses invalid or unproved stroke state %s',source=>expect(()=>trace(source+' 1 w 10 20 m 40 20 l S')).toThrow());
 it('refuses actual DefaultRGB, alias, opacity and unsupported diagonal stroke',async()=>{for(const mode of ['default','alias','opacity','diagonal']){const {pdf,page}=await authored((mode==='opacity'?'/Fade gs ':mode==='alias'?'/Alias CS ':'/DeviceRGB CS ')+'0 0 0 SCN 1 w 10 20 m 40 '+(mode==='diagonal'?'30':'20')+' l S');const resources=page.node.Resources()!;if(mode==='opacity')resources.set(PDFName.of('ExtGState'),pdf.context.obj({Fade:{CA:.5}}));else if(mode!=='diagonal')resources.set(PDFName.of('ColorSpace'),pdf.context.obj(mode==='default'?{DefaultRGB:'DeviceRGB'}:{Alias:'DeviceRGB'}));expect(()=>originalScopedPaint(pdf,1)).toThrow();}});
});

it('retains only exact original zero-alpha rectangle fills, restores q/Q and refuses zero-alpha text/images',async()=>{const {pdf,page}=await authored('q /Zero gs 10 20 30 40 re f Q 10 20 30 40 re f');page.node.Resources()!.set(PDFName.of('ExtGState'),pdf.context.obj({Zero:{ca:0}}));const inv=originalScopedPaint(pdf,1);expect(inv.occurrences.map(o=>o.zeroFill??false)).toEqual([true,false]);for(const content of ['/Zero gs '+text,'/Zero gs /Photo Do']){page.node.set(PDFName.of('Contents'),pdf.context.register(pdf.context.flateStream(content)));expect(()=>originalScopedPaint(pdf,1)).toThrow();}});
