import {originalPageFrame,translatedPageFrame} from './pdf-page-frame';
import {originalHorizontalShear} from '../layout/source-shear';
import {MAX_SOURCE_PAGES} from '../core/model';
import { PDFBool, PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { FolioError } from '../core/errors';
import type { Rect,SourceScopedColor,SourceColorProfile,SourceRectanglePath,SourcePageFrame } from '../core/model';
import {originalIccSpaces} from './pdf-icc';
import {pageCoveringClipOperands} from '../core/source-clip-domain';
import { originalDirectImageResources, originalOperators, originalPageContent, type RawOperator } from './pdf-image-trace';

export type ScopedPaintColor = SourceScopedColor;
export interface ScopedPaintClip {
  pathOperatorIndex: number;
  clipOperatorIndex: number;
  endOperatorIndex: number;
  fillRule: 'nonzero' | 'evenodd';
  constructionCtm: number[];
  bounds: Rect;
  pageCover?:{version:'integer-page-cover-v1';operands:number[]};
}
/** Transient construction evidence; never an inventory or portable field. */
export interface RawClipTransform {readonly parent?:RawClipTransform;readonly operatorIndex:number;readonly operands:readonly number[];readonly length:number}
export interface RawClipConstruction {readonly sourceSha256:string;readonly pageNumber:number;readonly clipKey:string;readonly operands:readonly number[];readonly chain?:RawClipTransform;readonly viewport:readonly number[]}
export interface RawRectangleConstruction {readonly sourceSha256:string;readonly pageNumber:number;readonly paintKey:string;readonly pathOperatorIndex:number;readonly paintOperatorIndex:number;readonly fillOperator:'f'|'F'|'f*';readonly operands:readonly number[];readonly chain?:RawClipTransform;readonly viewport:readonly number[];readonly constructionCtm:readonly number[]}
export interface RawClipCollector {readonly sourceSha256:string;readonly pageNumber:number;readonly clips:Map<number,RawClipConstruction>;readonly rectangles?:Map<number,RawRectangleConstruction>}
export interface ScopedGraphicsState { lineWidth?: number; lineCap?: number; lineJoin?: number; strokeAdjustment?: boolean; appleAA?:boolean;fillAlpha?:0|1 }
interface PaintState {
  matrix: number[]; rawChain?:RawClipTransform; deviceRgbSelection?:true; deviceRgbStrokeSelection?:true; fill: ScopedPaintColor; stroke: ScopedPaintColor;
  lineWidth: number; lineCap: number; lineJoin: number; strokeAdjustment: boolean; appleAA?:boolean;
  fillAlpha:0|1; font?: string; fontSize?: number; clipStack: ScopedPaintClip[]; effectiveClip: Rect;
}
interface PaintBase { rawOperatorIndex: number; clipStack: ScopedPaintClip[]; effectiveClip: Rect; rectanglePath?:SourceRectanglePath; appleAA?:boolean;zeroFill?:true }
export type ScopedPaintOccurrence =
  | PaintBase & { kind: 'text'; fontResource: string; fontSize: number; color: ScopedPaintColor }
  | PaintBase & { kind: 'fillRect'; pathOperatorIndex: number; bounds: Rect; fillRule: 'nonzero' | 'evenodd'; color: ScopedPaintColor }
  | PaintBase & { kind: 'strokeRule'; pathOperatorIndex: number; bounds: Rect; thickness: number; color: ScopedPaintColor; lineCap: 0; lineJoin: 0; strokeAdjustment?: true }
  | PaintBase & { kind: 'image'; resourceName: string; ctm: number[] };
export interface ScopedPageGroup { version: 'rgb-page-transparency-v1'; colorSpace: 'DeviceRGB'; isolated: boolean; knockout: false }
export interface ScopedPaintInventory { occurrences: ScopedPaintOccurrence[]; clips: ScopedPaintClip[]; pageGroup?: ScopedPageGroup; colorProfile?:SourceColorProfile;pageFrame?:SourcePageFrame }
export interface ScopedMarkedProperties {
  kind: 'structured' | 'artifact' | 'empty'; mcid?: number; language?: string;
  artifactType?: 'Pagination' | 'Layout' | 'Page' | 'Background';
  artifactSubtype?: 'Header' | 'Footer' | 'Watermark'; attached?: string[]; artifactBounds?: number[];
}
export interface ScopedPaintOptions {
  viewport: number[]; pageBounds: Rect;
  allowHorizontalTextShear?:boolean;
  rawClipCollector?:RawClipCollector;
  graphicsStates?: ReadonlyMap<string, ScopedGraphicsState>;
  /** Pure seam only: actual-resource admission remains the caller's duty. */
  allowDirectImages?: boolean;
  colorSpaces?:ReadonlyMap<string,SourceColorProfile>;
}
type Path = { kind: 'rect'; bounds: Rect; ctm: number[]; operatorIndex: number;rawOperands?:readonly number[];rawChain?:RawClipTransform;pageCover?:ScopedPaintClip['pageCover'] }
  | { kind: 'line'; points: number[][]; ctm: number[]; operatorIndex: number;indices?:number[];rawPoints?:number[][];closed?:boolean;repeatedMove?:boolean };
const fail = (detail: string): never => { throw new FolioError('PDF_SCOPED_PAINT', `Original scoped paint is unsupported: ${detail}`); };
const MAX_COORDINATE = 1_000_000;
const finite = (value: number) => Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
const numbers = (args: RawOperator['args'], count: number): number[] => {
  if (args.length !== count || !args.every(value => typeof value === 'number' && finite(value))) return fail('invalid numeric operands');
  return args as number[];
};
const noArgs = (op: RawOperator) => { if (op.args.length) fail('unexpected operands'); };
const name = (args: RawOperator['args'], index = 0): string => {
  const value = args[index];
  if (!value || typeof value !== 'object' || !('name' in value) || !value.name || value.name.length > 128) return fail('invalid resource name');
  return value.name;
};
const matrix = (m: number[]): number[] => {
  if (m.length !== 6 || !m.every(finite) || m[1] !== 0 || m[2] !== 0 || m[0] === 0 || m[3] === 0) return fail('non-axis-aligned or degenerate transform');
  return m;
};
const multiply = (a: number[], b: number[]): number[] => matrix([a[0] * b[0], 0, 0, a[3] * b[3], a[0] * b[4] + a[4], a[3] * b[5] + a[5]]);
const point = (x: number, y: number, m: number[]) => {
  const p = [m[0] * x + m[4], m[3] * y + m[5]];
  if (!p.every(finite)) return fail('transformed path exceeds bounds');
  return p;
};
const bounds = (x: number, y: number, width: number, height: number, m: number[]): Rect => {
  const a = point(x, y, m), b = point(x + width, y + height, m);
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) };
};
const intersect = (a: Rect, b: Rect): Rect => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
};
const color = (args: RawOperator['args'], count: 1 | 3): ScopedPaintColor => {
  const components = numbers(args, count);
  if (components.some(value => value < 0 || value > 1)) return fail('color outside DeviceRGB/DeviceGray range');
  return { space: count === 1 ? 'DeviceGray' : 'DeviceRGB', components: [...components] };
};
const cloneState = (s: PaintState): PaintState => ({ ...s, matrix: [...s.matrix], fill: { ...s.fill, components: [...s.fill.components] }, stroke: { ...s.stroke, components: [...s.stroke.components] }, clipStack: [...s.clipStack], effectiveClip: { ...s.effectiveClip } });
const base = (s: PaintState, rawOperatorIndex: number): PaintBase => ({ rawOperatorIndex, clipStack: s.clipStack.map(c => ({ ...c, bounds: { ...c.bounds }, constructionCtm: [...c.constructionCtm] })), effectiveClip: { ...s.effectiveClip }, ...(s.appleAA!==undefined?{appleAA:s.appleAA}:{}) });

/** Entire flat harmless marked-property grammar; alternate text, aliases and references remain unsupported. */
export function classifyScopedMarkedDictionary(raw: string): ScopedMarkedProperties | undefined {
  if (!raw.startsWith('<<')) return;
  if (raw.length > 4096 || !raw.endsWith('>>')) return fail('marked property budget or delimiters');
  const body = raw.slice(2, -2), seen = new Set<string>(); let index = 0;
  const fields: Omit<ScopedMarkedProperties, 'kind'> = {};
  const whitespace = () => { while (index < body.length) { if (/[\x00\x09\x0a\x0c\x0d\x20]/.test(body[index])) index++; else if (body[index] === '%') { while (index < body.length && !/[\r\n]/.test(body[index])) index++; } else break; } };
  const readName = (): string => {
    whitespace(); const match = /^\/([A-Za-z0-9#]+)/.exec(body.slice(index)); if (!match || /#(?![\da-f]{2})/i.test(match[1])) return fail('invalid marked property name'); index += match[0].length;
    return match[1].replace(/#([\da-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  };
  const readNumber = (): number => {
    whitespace(); const match = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)/.exec(body.slice(index)); if (!match) return fail('invalid marked property number'); index += match[0].length; const value = Number(match[0]); if (!finite(value)) return fail('invalid marked property number'); return value;
  };
  while (index < body.length) {
    whitespace(); if (index === body.length) break; const key = readName();
    if (seen.has(key) || seen.size >= 6) return fail('duplicate or excessive marked properties'); seen.add(key); whitespace();
    if (key === 'MCID') { const value = readNumber(); if (!Number.isInteger(value) || value < 0 || value > 999999) return fail('invalid marked-content identifier'); fields.mcid = value; }
    else if (key === 'Lang') {
      const match = /^\(([A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*)\)/.exec(body.slice(index)); if (!match || match[1].length > 35) return fail('unsupported marked language string'); fields.language = match[1]; index += match[0].length;
    } else if (key === 'Type') {
      const value = readName(); if (!['Pagination', 'Layout', 'Page', 'Background'].includes(value)) return fail('unsupported artifact type'); fields.artifactType = value as ScopedMarkedProperties['artifactType'];
    } else if (key === 'Subtype') {
      const value = readName(); if (!['Header', 'Footer', 'Watermark'].includes(value)) return fail('unsupported artifact subtype'); fields.artifactSubtype = value as ScopedMarkedProperties['artifactSubtype'];
    } else if (key === 'Attached') {
      if (body[index++] !== '[') return fail('unsupported artifact attachment'); const attached: string[] = [];
      while (true) { whitespace(); if (body[index] === ']') { index++; break; } if (attached.length >= 4) return fail('artifact attachment budget'); const value = readName(); if (!['Top', 'Bottom', 'Left', 'Right'].includes(value) || attached.includes(value)) return fail('unsupported artifact attachment'); attached.push(value); }
      fields.attached = attached;
    } else if (key === 'BBox') {
      if (body[index++] !== '[') return fail('unsupported artifact bounds'); const rectangle = [readNumber(), readNumber(), readNumber(), readNumber()]; whitespace(); if (body[index++] !== ']') return fail('unsupported artifact bounds'); fields.artifactBounds = rectangle;
    } else return fail('unknown or alternate-text marked property');
  }
  if(seen.size===0)return {kind:'empty'};
  if (fields.mcid !== undefined && [...seen].every(key => key === 'MCID' || key === 'Lang')) return { kind: 'structured', ...fields };
  if (fields.artifactType && [...seen].every(key => ['Type', 'Subtype', 'Attached', 'BBox'].includes(key))) return { kind: 'artifact', ...fields };
  return fail('unsupported marked-property combination');
}

/** Exact raw path lifecycle. This inventory alone does not prove glyph ownership or ink containment. */
export function traceScopedPaint(operators: readonly RawOperator[], options: ScopedPaintOptions): ScopedPaintInventory {
  const viewport = matrix(options.viewport), page = options.pageBounds;
  if (![page.x, page.y, page.width, page.height].every(finite) || page.width <= 0 || page.height <= 0 || operators.length > 100_000) return fail('invalid page or operation budget');
  const occurrences: ScopedPaintOccurrence[] = [], clips: ScopedPaintClip[] = [], stack: PaintState[] = [];
  let state: PaintState = { matrix: [1, 0, 0, 1, 0, 0], fill: { space: 'DeviceGray', components: [0] }, stroke: { space: 'DeviceGray', components: [0] }, lineWidth: 1, lineCap: 0, lineJoin: 0, strokeAdjustment: false,fillAlpha:1, clipStack: [], effectiveClip: { ...page } };
  // Current path and pending W are not graphics-state members. Construction freezes page coordinates.
  let path: Path | undefined, pending: { operatorIndex: number; fillRule: 'nonzero' | 'evenodd' } | undefined;
  let inText = false, markedDepth = 0, clipReferences = 0;
  const composite = () => multiply(viewport, state.matrix);
  const paintBase = (rawOperatorIndex: number) => {
    clipReferences += state.clipStack.length;
    if (clipReferences > 100_000) return fail('paint clip-reference budget');
    return base(state, rawOperatorIndex);
  };
  const endPath = (op: RawOperator) => {
    if (pending) {
      if (!path || path.kind !== 'rect') return fail('clipping requires one complete rectangle');
      if (state.clipStack.length >= 64 || clips.length >= 4096) return fail('clip inventory budget');
      const clip: ScopedPaintClip = { pathOperatorIndex: path.operatorIndex, clipOperatorIndex: pending.operatorIndex, endOperatorIndex: op.index, fillRule: pending.fillRule, constructionCtm: [...path.ctm], bounds: { ...path.bounds },...(path.pageCover?{pageCover:path.pageCover}:{}) };
      if(options.rawClipCollector){const owner=options.rawClipCollector;if(owner.clips.has(clip.clipOperatorIndex)||!path.rawOperands)return fail('raw clip construction identity');owner.clips.set(clip.clipOperatorIndex,Object.freeze({sourceSha256:owner.sourceSha256,pageNumber:owner.pageNumber,clipKey:JSON.stringify(clip),operands:path.rawOperands,chain:path.rawChain,viewport:Object.freeze([...viewport])}));}
      state.effectiveClip = intersect(state.effectiveClip, clip.bounds); state.clipStack = [...state.clipStack, clip]; clips.push(clip); pending = undefined;
    }
    path = undefined;
  };
  for (let ordinal = 0; ordinal < operators.length; ordinal++) {
    const op = operators[ordinal], { word, args } = op;
    if (op.index !== ordinal) return fail('noncontiguous raw operator identity');
    if (pending && !['n', 'f', 'F', 'f*', 'S'].includes(word)) return fail('pending clip must terminate immediately');
    if (word === 'q') { noArgs(op); if (stack.length >= 64) return fail('graphics stack budget'); stack.push(cloneState(state)); }
    else if (word === 'Q') { noArgs(op); if (!stack.length) return fail('unbalanced graphics restore'); state = stack.pop()!; }
    else if (word === 'cm') {const operands=matrix(numbers(args,6));state.matrix=multiply(state.matrix,operands);if(options.rawClipCollector){const length=(state.rawChain?.length??0)+1;if(length>100000)return fail('raw clip transform budget');state.rawChain=Object.freeze({parent:state.rawChain,operatorIndex:op.index,operands:Object.freeze([...operands]),length});}}
    else if (word === 're') {
      if (path || inText) return fail('compound rectangle or path inside text');
      const ctm=composite(),large=args.length===4&&args.every(n=>typeof n==='number')&&args.some(n=>Math.abs(n as number)>MAX_COORDINATE);
      const raw=large?args as number[]:numbers(args,4),[x,y,w,h]=raw;
      if(large&&(!['W','W*'].includes(operators[ordinal+1]?.word)||operators[ordinal+1]?.args.length||operators[ordinal+2]?.word!=='n'||operators[ordinal+2]?.args.length||!pageCoveringClipOperands(raw,ctm,page)))return fail('oversized path lacks exact page-covering clip evidence');
      path = { kind: 'rect', bounds:large?{...page}:bounds(x, y, w, h, ctm), ctm, operatorIndex: op.index,...(large?{pageCover:{version:'integer-page-cover-v1',operands:[...raw]}}:{}),...(options.rawClipCollector?{rawOperands:Object.freeze([x,y,w,h]),rawChain:state.rawChain}:{}) };
    } else if (word === 'm') {
      if (inText) return fail('path inside text');
      const [x, y] = numbers(args, 2), ctm = composite(), start = point(x, y, ctm);
      // Some solid-rule writers repeat the same empty move. No prior segment,
      // coordinate or construction transform may be discarded by this seam.
      if (path) {
        if (path.kind !== 'line' || path.points.length !== 1 || path.points[0].some((value, index) => value !== start[index]) || path.ctm.some((value, index) => value !== ctm[index])) return fail('compound or changed move path');
        path.repeatedMove=true;
      } else path = { kind: 'line', points: [start], ctm, operatorIndex: op.index,indices:[op.index],rawPoints:[[x,y]] };
    } else if (word === 'l') {
      if (!path || path.kind !== 'line' || path.points.length >= 4 || path.closed || inText) return fail('unsupported line path');
      const [x, y] = numbers(args, 2),ctm=composite();if(path.ctm.some((v,i)=>v!==ctm[i]))return fail('changed rectangle construction transform');path.points.push(point(x,y,ctm));path.indices?.push(op.index);path.rawPoints?.push([x,y]);
    } else if (word === 'h') { noArgs(op); if(!path)return fail('unsupported closed path');if(path.kind==='line'){
      const p=path.points;if(path.closed||path.repeatedMove||p.length!==4||path.indices?.length!==4||new Set(p.map(v=>JSON.stringify(v))).size!==4||state.matrix.some((v,i)=>v!==[1,0,0,1,0,0][i])||path.ctm.some((v,i)=>v!==composite()[i])||new Set(p.map(v=>v[0])).size!==2||new Set(p.map(v=>v[1])).size!==2||!p.every((v,i)=>{const n=p[(i+1)%4];const after=p[(i+2)%4];return((v[0]===n[0])!==(v[1]===n[1]))&&((v[0]===n[0])!==(n[0]===after[0]));}))return fail('closed path is not one exact identity-axis rectangle');path.closed=true;path.indices?.push(op.index);
    }}
    else if (word === 'W' || word === 'W*') {
      noArgs(op); if (!path || path.kind !== 'rect' || pending) return fail('unsupported clipping path');
      pending = { operatorIndex: op.index, fillRule: word === 'W*' ? 'evenodd' : 'nonzero' };
    } else if (word === 'n') { noArgs(op); endPath(op); }
    else if (word === 'f' || word === 'F' || word === 'f*') {
      noArgs(op); if (!path || path.kind !== 'rect'&&!path.closed) return fail('fill requires one rectangle');
      const pathBounds=path.kind==='rect'?path.bounds:{x:Math.min(...path.points.map(p=>p[0])),y:Math.min(...path.points.map(p=>p[1])),width:Math.max(...path.points.map(p=>p[0]))-Math.min(...path.points.map(p=>p[0])),height:Math.max(...path.points.map(p=>p[1]))-Math.min(...path.points.map(p=>p[1]))};
      const rectanglePath:SourceRectanglePath|undefined=path.kind==='line'?{version:'closed-axis-rectangle-v1',operatorIndices:path.indices!,points:path.rawPoints!,constructionCtm:[1,0,0,1,0,0],fillRule:word==='f*'?'evenodd':'nonzero'}:undefined;
      // PDF.js paints first and applies pending clipping when consuming the path.
      const paint:Extract<ScopedPaintOccurrence,{kind:'fillRect'}>={ ...paintBase(op.index), kind: 'fillRect',...(state.fillAlpha===0?{zeroFill:true as const}:{}), pathOperatorIndex: path.operatorIndex, bounds: pathBounds,...(rectanglePath?{rectanglePath}:{}), fillRule: word === 'f*' ? 'evenodd' : 'nonzero', color: { ...state.fill, components: [...state.fill.components] } };
      const collector=options.rawClipCollector;if(path.kind==='rect'&&collector?.rectangles){if(!path.rawOperands||collector.rectangles.has(op.index))return fail('raw rectangle construction identity');if(path.ctm.some((v,i)=>v!==composite()[i]))return fail('plain rectangle paint transform differs from construction');collector.rectangles.set(op.index,Object.freeze({sourceSha256:collector.sourceSha256,pageNumber:collector.pageNumber,paintKey:JSON.stringify(paint),pathOperatorIndex:path.operatorIndex,paintOperatorIndex:op.index,fillOperator:word,operands:path.rawOperands,chain:path.rawChain,viewport:Object.freeze([...viewport]),constructionCtm:Object.freeze([...path.ctm])}));}
      occurrences.push(paint); endPath(op);
    } else if (word === 'S') {
      noArgs(op); const m = composite();
      // SA affects stroked paths, not fills, images or our admitted fill-only text.
      // Preserve active SA as source-owned paint, including its q/Q lifetime.
      if (!path || path.kind !== 'line' || path.points.length !== 2 || path.points[0][1] !== path.points[1][1] || path.points[0][0] === path.points[1][0] || Math.abs(m[0]) !== Math.abs(m[3]) || state.lineWidth <= 0 || state.lineCap !== 0 || state.lineJoin !== 0) return fail('stroke requires a positive uniform horizontal butt-cap rule');
      const [a, b] = path.points, thickness = state.lineWidth * Math.abs(m[3]);
      if (!finite(thickness) || thickness <= 0) return fail('invalid rule thickness');
      occurrences.push({ ...paintBase(op.index), kind: 'strokeRule', pathOperatorIndex: path.operatorIndex, bounds: { x: Math.min(a[0], b[0]), y: a[1], width: Math.abs(b[0] - a[0]), height: 0 }, thickness, lineCap: 0, lineJoin: 0, ...(state.strokeAdjustment ? { strokeAdjustment: true as const } : {}), color: { ...state.stroke, components: [...state.stroke.components] } }); endPath(op);
    } else if(word==='cs'||word==='CS'){
      if(args.length!==1)return fail('invalid color selection');const alias=name(args);if(alias==='DeviceRGB'){if(word==='cs'){state.fill={space:'DeviceRGB',components:[0,0,0]};state.deviceRgbSelection=true;}else{state.stroke={space:'DeviceRGB',components:[0,0,0]};state.deviceRgbStrokeSelection=true;}continue;}if(word==='CS')return fail('unproved stroke color selection');delete state.deviceRgbSelection;const profile=options.colorSpaces?.get(alias);if(!profile)return fail('unproved original ICC color resource');
      const selected:ScopedPaintColor={space:'ICCBased',components:[0,0,0],resourceName:alias,profileRef:profile.pdfProfileRef,profileSha256:profile.sha256,selectionOperatorIndex:op.index,componentsOperatorIndex:null,componentOperator:'default',renderingIntent:'RelativeColorimetric'};if(word==='cs')state.fill=selected;else state.stroke=selected;
    } else if(word==='SCN'){if(!state.deviceRgbStrokeSelection)return fail('stroke components require explicit DeviceRGB');state.stroke=color(args,3);
    } else if(['sc','scn'].includes(word)){
      if(state.deviceRgbSelection&&word==='scn'){state.fill=color(args,3);continue;}const stroke=word===word.toUpperCase(),previous=stroke?state.stroke:state.fill;if(previous.space!=='ICCBased')return fail('component color requires owned ICC selection');const components=numbers(args,3);if(components.some(v=>v<0||v>1))return fail('ICC component range');const selected:ScopedPaintColor={...previous,components:[...components],componentsOperatorIndex:op.index,componentOperator:word.toLowerCase() as 'sc'|'scn'};if(stroke)state.stroke=selected;else state.fill=selected;
    } else if (word === 'rg') {state.fill = color(args, 3);delete state.deviceRgbSelection;}
    else if (word === 'g') {state.fill = color(args, 1);delete state.deviceRgbSelection;}
    else if (word === 'RG') {state.stroke = color(args, 3);delete state.deviceRgbStrokeSelection;}
    else if (word === 'G') {state.stroke = color(args, 1);delete state.deviceRgbStrokeSelection;}
    else if (word === 'w') { const [width] = numbers(args, 1); if (width < 0) return fail('negative stroke width'); state.lineWidth = width; }
    else if (word === 'd') {
      const marker = args[0], keys = typeof marker === 'object' && marker !== null ? Object.keys(marker) : [];
      if (args.length !== 2 || typeof marker !== 'object' || marker === null || !('opaque' in marker) || marker.opaque !== true || !('emptyArray' in marker) || marker.emptyArray !== true || keys.length !== 2 || !keys.includes('opaque') || !keys.includes('emptyArray') || typeof args[1] !== 'number' || !finite(args[1]) || args[1] !== 0) return fail('only the original empty solid-dash reset is supported');
    }
    else if (word === 'J' || word === 'j') { const [value] = numbers(args, 1); if (!Number.isInteger(value) || value < 0 || value > 2) return fail('invalid cap/join'); if (word === 'J') state.lineCap = value; else state.lineJoin = value; }
    else if (word === 'M') { if (numbers(args, 1)[0] < 1) return fail('invalid miter limit'); }
    else if (word === 'gs') {
      if (args.length !== 1) return fail('invalid graphics resource'); const gs = options.graphicsStates?.get(name(args)); if (!gs) return fail('unproved graphics resource');
      if (Object.keys(gs).some(key => !['lineWidth', 'lineCap', 'lineJoin', 'strokeAdjustment','appleAA','fillAlpha'].includes(key)) || [gs.strokeAdjustment,gs.appleAA].some(value=>value!==undefined&&typeof value!=='boolean') || gs.lineWidth !== undefined && (!finite(gs.lineWidth) || gs.lineWidth < 0) || [gs.lineCap, gs.lineJoin].some(value => value !== undefined && (!Number.isInteger(value) || value < 0 || value > 2))) return fail('invalid proved graphics state');
      if(gs.fillAlpha!==undefined&&gs.fillAlpha!==0&&gs.fillAlpha!==1)return fail('invalid source fill alpha');if(gs.fillAlpha!==undefined)state.fillAlpha=gs.fillAlpha;
      if (gs.lineWidth !== undefined) state.lineWidth = gs.lineWidth; if (gs.lineCap !== undefined) state.lineCap = gs.lineCap; if (gs.lineJoin !== undefined) state.lineJoin = gs.lineJoin;
      if (gs.strokeAdjustment !== undefined) state.strokeAdjustment = gs.strokeAdjustment;
      if (gs.appleAA !== undefined) state.appleAA = gs.appleAA;
    } else if (word === 'BT') { noArgs(op); if (inText || path) return fail('invalid text object start'); inText = true; }
    else if (word === 'ET') { noArgs(op); if (!inText) return fail('invalid text object end'); inText = false; }
    else if (word === 'Tf') {
      if (args.length !== 2 || typeof args[1] !== 'number' || !finite(args[1]) || args[1] <= 0 || args[1] > 144) return fail('invalid font selection'); state.font = name(args); state.fontSize = args[1];
    } else if (word === 'Tj' || word === 'TJ') {
      if (!inText || !state.font || !state.fontSize || args.length !== 1 || typeof args[0] !== 'object' || !('opaque' in args[0])) return fail('unproved text painting');
      if(state.fillAlpha===0)return fail('zero-alpha text requires a separate contract');
      occurrences.push({ ...paintBase(op.index), kind: 'text', fontResource: state.font, fontSize: state.fontSize, color: { ...state.fill, components: [...state.fill.components] } });
    } else if (word === 'Tm') { if (!inText) return fail('text matrix outside text object'); const values=numbers(args,6);if(options.allowHorizontalTextShear)originalHorizontalShear(state.matrix,values.slice(0,4));else matrix(values); }
    else if (word === 'Td' || word === 'TD') { if (!inText) return fail('text position outside text object'); numbers(args, 2); }
    else if (word === 'TL' || word === 'Tc') numbers(args, 1);
    else if (word === 'T*') { noArgs(op); if (!inText) return fail('text line outside text object'); }
    else if (['Tw', 'Ts', 'Tr'].includes(word)) { if (numbers(args, 1)[0] !== 0) return fail('unsupported text paint/spacing mode'); }
    else if (word === 'Tz') { if (numbers(args, 1)[0] !== 100) return fail('unsupported text scale'); }
    else if (word === 'Do') {
      if(state.fillAlpha===0)return fail('zero-alpha images require a separate contract');if(state.appleAA!==undefined)return fail('Apple graphics state image replay is unproved');
      if (!options.allowDirectImages || args.length !== 1 || path || inText) return fail('unproved direct-image paint');
      occurrences.push({ ...paintBase(op.index), kind: 'image', resourceName: name(args), ctm: composite() });
    } else if (word === 'BDC') {
      if (args.length !== 2 || name(args) === 'OC' || typeof args[1] !== 'object' || !('opaque' in args[1])) return fail('unsupported marked-content semantics');
      const properties = args[1].markedProperties, tag = name(args);
      let admitted: boolean;
      if(properties?.kind==='empty') admitted=true;
      else if (properties?.kind === 'artifact') admitted = tag === 'Artifact';
      else if (properties?.kind === 'structured') admitted = tag !== 'Artifact' && Number.isInteger(properties.mcid) && properties.mcid! >= 0 && properties.mcid! <= 999999;
      else admitted = !properties && 'mcid' in args[1] && Number.isInteger(args[1].mcid);
      if (!admitted) return fail('unsupported marked-content semantics');
      if (++markedDepth > 64) return fail('marked-content depth budget');
    } else if (word === 'BMC') { if (args.length !== 1 || name(args) === 'OC' || ++markedDepth > 64) return fail('unsupported marked-content semantics'); }
    else if (word === 'EMC') { noArgs(op); if (markedDepth <= 0) return fail('unbalanced marked content'); markedDepth--; }
    else return fail(`operator ${word}`);
  }
  if (stack.length || pending || path || inText || markedDepth) return fail('unfinished path, text or graphics scope');
  return { occurrences, clips };
}

function opaqueGraphicsStates(resources: PDFDict): Map<string, ScopedGraphicsState> {
  const dictionary = resources.lookupMaybe(PDFName.of('ExtGState'), PDFDict), result = new Map<string, ScopedGraphicsState>();
  if (!dictionary) return result;
  if (dictionary.entries().length > 64) return fail('graphics resource budget');
  for (const [key] of dictionary.entries()) {
    const gs = dictionary.lookup(key, PDFDict), accepted: ScopedGraphicsState = {};
    for (const [entry, raw] of gs.entries()) {
      const name = entry.decodeText(), value = gs.context.lookup(raw);
      if (name === 'Type' && value instanceof PDFName && value.decodeText() === 'ExtGState') continue;
      if (name === 'ca' || name === 'CA') { if (!(value instanceof PDFNumber) || (value.asNumber()!==1&&(name!=='ca'||value.asNumber()!==0))) return fail('nonopaque graphics state');if(name==='ca')accepted.fillAlpha=value.asNumber() as 0|1; }
      else if (name === 'BM' || name === 'SMask') { if (!(value instanceof PDFName) || value.decodeText() !== (name === 'BM' ? 'Normal' : 'None')) return fail('blend or soft mask'); }
      else if (name === 'SA') { if (!(value instanceof PDFBool)) return fail('invalid stroke adjustment'); accepted.strokeAdjustment = value.asBoolean(); }
      // Retain the source-defined boolean; do not translate it or declare it inert.
      else if (name === 'AAPL:AA') { if (!(value instanceof PDFBool)) return fail('invalid Apple graphics state'); accepted.appleAA = value.asBoolean(); }
      else if (name === 'LW' || name === 'LC' || name === 'LJ' || name === 'ML') {
        if (!(value instanceof PDFNumber) || !finite(value.asNumber())) return fail('invalid graphics stroke state'); const n = value.asNumber();
        if (name === 'LW') { if (n < 0) return fail('negative stroke width'); accepted.lineWidth = n; }
        else if (name === 'ML') { if (n < 1) return fail('invalid miter limit'); }
        else { if (!Number.isInteger(n) || n < 0 || n > 2) return fail('invalid graphics cap/join'); if (name === 'LC') accepted.lineCap = n; else accepted.lineJoin = n; }
      } else return fail(`graphics state ${name}`);
    }
    result.set(key.decodeText(), accepted);
  }
  return result;
}

/** Record bounded page compositing for mandatory replay; never declare a group inert. */
function originalPageGroup(page: PDFDict): ScopedPageGroup | undefined {
  if (!page.has(PDFName.of('Group'))) return;
  const group = page.lookup(PDFName.of('Group'), PDFDict);
  if (group.entries().some(([key]) => !['Type', 'S', 'CS', 'I', 'K'].includes(key.decodeText())) || group.lookupMaybe(PDFName.of('S'), PDFName)?.decodeText() !== 'Transparency' || group.lookupMaybe(PDFName.of('CS'), PDFName)?.decodeText() !== 'DeviceRGB') return fail('unsupported page transparency group');
  if (group.has(PDFName.of('Type')) && group.lookupMaybe(PDFName.of('Type'), PDFName)?.decodeText() !== 'Group') return fail('invalid page group type');
  const flag = (key: string): boolean => { if (!group.has(PDFName.of(key))) return false; const value = group.lookup(PDFName.of(key)); if (!(value instanceof PDFBool)) return fail('invalid page group flag'); return value.asBoolean(); };
  const isolated = flag('I'); if (flag('K')) return fail('knockout page group');
  return { version: 'rgb-page-transparency-v1', colorSpace: 'DeviceRGB', isolated, knockout: false };
}

/** Actual page wrapper: raw aliases/default spaces/forms cannot be hidden by compiled RGB operators. */
export function originalScopedPaint(document: PDFDocument, pageNumber: number, text = originalPageContent(document, pageNumber),sourceSha256='',rawClipCollector?:RawClipCollector,allowHorizontalTextShear=false): ScopedPaintInventory {
  const page = document.getPages()[pageNumber - 1], resources = page?.node.Resources();
  if (!page || !resources || document.getPageCount() > MAX_SOURCE_PAGES || page.getRotation().angle !== 0 || document.catalog.has(PDFName.of('OCProperties'))) return fail('unsupported page geometry/content group');
  const pageGroup = originalPageGroup(page.node);
  if (page.node.has(PDFName.of('UserUnit'))) { const value = page.node.lookup(PDFName.of('UserUnit')); if (!(value instanceof PDFNumber) || value.asNumber() !== 1) return fail('unsupported page unit'); }
  const frame=originalPageFrame(document,pageNumber),media={width:frame.width,height:frame.height};
  const spaces = resources.lookupMaybe(PDFName.of('ColorSpace'), PDFDict);
  if (spaces && ['DefaultRGB', 'DefaultGray', 'DefaultCMYK'].some(key => spaces.has(PDFName.of(key)))) return fail('default color-space override');
  const operators=originalOperators(text, classifyScopedMarkedDictionary),colorSpaces=originalIccSpaces(document,resources,sourceSha256,operators);
  originalDirectImageResources(document, pageNumber, text);
  const inventory=traceScopedPaint(operators, { viewport: frame.viewport, pageBounds: { x: 0, y: 0, width: media.width, height: media.height }, graphicsStates: opaqueGraphicsStates(resources), allowDirectImages: true,colorSpaces,rawClipCollector,allowHorizontalTextShear });
  const usedIcc=inventory.occurrences.some(paint=>'color'in paint&&paint.color.space==='ICCBased');
  return {...inventory,...(translatedPageFrame(frame)?{pageFrame:frame}:{}),...(usedIcc?{colorProfile:[...colorSpaces.values()][0]}:{}), ...(pageGroup ? { pageGroup } : {}) };
}

/** No epsilon: an inactive baseline clip never authorizes changed ink outside it. */
export function scopedInkContained(clip: Rect, ink: Rect): boolean {
  return [clip.x, clip.y, clip.width, clip.height, ink.x, ink.y, ink.width, ink.height].every(finite) && clip.width > 0 && clip.height > 0 && ink.width >= 0 && ink.height >= 0 && ink.x >= clip.x && ink.y >= clip.y && ink.x + ink.width <= clip.x + clip.width && ink.y + ink.height <= clip.y + clip.height;
}
