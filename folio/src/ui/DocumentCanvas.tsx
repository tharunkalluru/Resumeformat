import {SourceReadOnlyNotice} from './SourceReadOnlyNotice';
import {browserStandardFontFamily,registerBrowserStandardFonts,standardNativeAvailability} from './standardFonts';
import {sourceParagraphGroups,activeSourceParagraphs} from '../core/source-paragraphs';
import {sourceParagraphCurrentPreviewAllows} from '../render/pdf';
import {SourceParagraphEditor} from './SourceParagraphEditor';
import {SourceWordingEditor} from './SourceWordingEditor';
import {sourceWordingPreviewTargets} from '../core/source-wording';
import {standardCurrentPreviewAllows} from '../render/pdf';
import {NativeInputPermit,type NativeInputOwner} from './nativeInputPermit';
import {loadStandardFont} from '../layout/standard-fonts';
import {sourceNativeStyles,sourceNativeDomMatches,sourceNativeClip,sourceNativeBaselineAdjustment} from './sourceNativeGeometry';
import {licensedCurrentPreviewAllows,licensedCurrentPreviewRewriteAllows} from '../render/pdf';
import {documentScopedMarksAllowed,licensedSubsetInputAllowed,sourceBlockParagraphs} from './documentScopedInput';
import {hasValidApproval} from '../core/model';
import { sourceReviewIssues } from '../tailoring/sourceSupport';
import { blockText } from '../core/model';
import {sourceGlyphText} from '../core/source-graph';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Extension, Mark, Node as TiptapNode, type Editor, type JSONContent } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Plugin, TextSelection } from '@tiptap/pm/state';
import type { Node as PMNode, Slice } from '@tiptap/pm/model';
import { ArrowLeft, Bold, ChevronDown, Italic, Link2, Redo2, Underline, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { safeHref, sourceDocumentFingerprint, type ContentBlock, type Project, type RenderedDocument, type TextRegion, type TextRun } from '../core/model';
import { FONT_FAMILIES, getFontMetrics } from '../layout/fonts';
import { loadSourceFont, sourceGlyphPath } from '../layout/source-fonts';
import { browserSourceFontFamily, registerBrowserSourceFontSet, type BrowserSourceRegistration } from './sourceFonts';
import { cffRegionEditAvailability } from './sourceCffFonts';
import {sourceSpacingAvailability,clearSourceSpacingProofs} from './sourceSpacing';
import {layoutSourceRegion} from '../layout/source-layout';
import { nativeInputRegion } from './canvasInput';
import {sourceImageCssClip} from '../core/source-images';
import {currentSourceScopedPaint,sourceScopedCssClip,sourceScopedCssColor} from '../core/source-scoped-paint';
import {OriginalType1Review} from './OriginalType1Review';

type CanvasProps = {
  project: Project; render: RenderedDocument | null; selectedRegion: string | null;
  onSelect: (id: string | null) => void; onEdit: (blocks: ContentBlock[], group: string) => void;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean;
  onLayoutReview: (issues: string[], revision: number, measuredRender: RenderedDocument | null) => void; onComposition: (active: boolean) => void;
  onError: (message: string) => void;
  visible: boolean;
  onParagraphEdit: (groupId:string,text:string)=>void; onParagraphReset: (groupId:string)=>void;
};
const PT = 4 / 3;
const cleanText = (value: string) => value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

/** A stale or refused generated graph must never hide current applicant text. */
function revealSourceText(editor: Editor): void {
  editor.view.dom.querySelectorAll<HTMLElement>('.folio-region[data-source-font]').forEach(region => {
    region.querySelector('.folio-source-ink')?.remove();
    const content = region.querySelector<HTMLElement>('.folio-region-content');
    if (content) { content.style.color = region.dataset.sourceColor ?? '#000000'; content.style.webkitTextFillColor = '';if(region.dataset.sourceScoped)content.style.clipPath=''; }
    delete region.dataset.sourceGraphCurrent;
  });
}
export function runsSignature(block: ContentBlock, style?: TextRegion['style']): string {
  const merged: { text: string; bold: boolean; italic: boolean; underline: boolean; href: string; sources: string[] }[] = [];
  for (const run of block.runs) {
    if (!run.text) continue;
    const normalized = { text: run.text, bold: run.bold ?? style?.fontWeight === 700, italic: run.italic ?? style?.italic ?? false, underline: !!run.underline,
      href: run.href ? safeHref(run.href) ?? '' : '', sources: [...(run.sourceFactIds ?? block.sourceFactIds)].sort() };
    const previous = merged.at(-1);
    if (previous && JSON.stringify({ ...previous, text: '' }) === JSON.stringify({ ...normalized, text: '' })) previous.text += normalized.text;
    else merged.push(normalized);
  }
  return JSON.stringify(merged);
}

export function sourceRunsUnchanged(project: Pick<Project, 'baseline' | 'draft'>, region: TextRegion): boolean {
  const current = project.draft.blocks.find(block => block.id === region.contentId);
  const original = project.baseline.blocks.find(block => block.id === region.contentId);
  return !!current && !!original &&
    current.runs.map(run => run.text).join('') === (region.sourceLayout?sourceGlyphText(region):undefined) &&
    runsSignature(current, region.style) === runsSignature(original, region.style);
}

/** Native carets follow advance endpoints; outer bounds retain glyph ink overhang. */
export function sourceAdvanceBox(boundsX: number, startX: number, endX: number): { left: number; width: number } {
  if (![boundsX, startX, endX].every(Number.isFinite) || endX < startX) throw new Error('Invalid source advance interval.');
  return { left: startX - boundsX, width: endX - startX };
}
export function sourceRegistrationReady(identity: string, settledIdentity: string, registrationIdentity: string, report?: BrowserSourceRegistration): boolean {
  return !!identity && identity === settledIdentity && identity === registrationIdentity && report?.status === 'editable';
}


function serializeRegion(node: PMNode, previous: ContentBlock): ContentBlock {
  const runs: TextRun[] = [];
  node.forEach((paragraph, _offset, index) => {
    if (index) runs.push({ text: '\n', sourceFactIds: [...previous.sourceFactIds] });
    paragraph.descendants(child => {
      if (child.type.name === 'hardBreak') { runs.push({ text: '\n', sourceFactIds: [...previous.sourceFactIds] }); return; }
      if (!child.isText || !child.text) return;
      const run: TextRun = { text: child.text, bold: false, italic: false };
      for (const mark of child.marks) {
        if (mark.type.name === 'bold') run.bold = true;
        if (mark.type.name === 'italic') run.italic = true;
        if (mark.type.name === 'underline') run.underline = true;
        if (mark.type.name === 'link' && safeHref(String(mark.attrs.href))) run.href = safeHref(String(mark.attrs.href));
        if (mark.type.name === 'folioEvidence') run.sourceFactIds = mark.attrs.ids as string[];
      }
      if (!run.sourceFactIds) run.sourceFactIds = [...previous.sourceFactIds];
      const last = runs.at(-1);
      if (last && JSON.stringify({ ...last, text: '' }) === JSON.stringify({ ...run, text: '' })) last.text += run.text;
      else runs.push(run);
    });
  });
  return { ...previous, runs: runs.length ? runs : [{ text: '', sourceFactIds: [...previous.sourceFactIds] }] };
}

function regionAt(editor: Editor): string | null {
  const position = editor.state.selection.$from;
  for (let depth = position.depth; depth > 0; depth--) {
    if (position.node(depth).type.name === 'folioRegion') return String(position.node(depth).attrs.id);
  }
  return null;
}

export function DocumentCanvas(props: CanvasProps) {
  return props.project.template.sourceType1Baseline ? <OriginalType1Review {...props} /> : <EditableDocumentCanvas {...props} />;
}
function EditableDocumentCanvas(props: CanvasProps) {
  const latest = useRef(props); latest.current = props;
  const synchronizing = useRef(false);
  const host = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.85);
  const [fit, setFit] = useState(true);
  const [activeMarks, setActiveMarks] = useState<string[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [linkError, setLinkError] = useState('');
  const [mobileFocused, setMobileFocused] = useState(false);
  const [assetUrls, setAssetUrls] = useState<Map<string, string>>(() => new Map());
  const [sourceFontsReady, setSourceFontsReady] = useState('');
  const assetUrlsRef = useRef<Map<string, string>>(new Map());
  const sourceRegistrations = useRef<{ identity: string; registrations: Map<string, BrowserSourceRegistration> }>({ identity: '', registrations: new Map() });
  const nativeInputPermit=useRef(new NativeInputPermit());
  const inputGeometry=()=>Array.from(host.current?.querySelectorAll<HTMLElement>('.folio-region-content[data-native-resolution="16"]')??[]).map(element=>{const css=getComputedStyle(element),page=element.closest('.folio-page')?.getBoundingClientRect();return [element.closest<HTMLElement>('.folio-region')?.dataset.regionId,element.isConnected,css.fontFamily,css.fontSize,css.fontWeight,css.fontStyle,css.lineHeight,css.letterSpacing,css.transform,element.style.left,element.style.top,page?.width,page?.height].join('|');}).join(';');
  const inputOwner=(document:PMNode):NativeInputOwner=>({document,project:latest.current.project,render:latest.current.render,fontIdentity:sourceFontIdentity,registrationIdentity:sourceRegistrations.current.identity,geometry:inputGeometry()});
  const inputOwnerRef=useRef(inputOwner);inputOwnerRef.current=inputOwner;
  const sourceFontIdentity = useMemo(() => [...(props.project.template.sourceFonts ?? []).map(asset => browserSourceFontFamily(asset)),...(props.project.template.sourceStandardFonts??[]).map(browserStandardFontFamily)].join('|'), [props.project.template.sourceFonts,props.project.template.sourceStandardFonts]);
  const paragraphGroups = useMemo(() => sourceParagraphGroups(props.project), [props.project.template,props.project.baseline,props.project.source]);
  const activeParagraphs = useMemo(() => activeSourceParagraphs(props.project), [props.project.template,props.project.baseline,props.project.source,props.project.draft]);
  const groupedMembers = new Set(activeParagraphs.flatMap(g => g.memberIds));
  const paragraphPreviewReady = !!activeParagraphs.length && sourceParagraphCurrentPreviewAllows(props.render,props.project,activeParagraphs[0].leaderId);
  const wordingPreviewIds=useMemo(()=>new Set(sourceWordingPreviewTargets(props.project,props.render).map(r=>r.id)),[props.project,props.render]);
  const sourceEditable = (region: TextRegion): { editable: boolean; reason?: string } => {
    if(region.sourceLayout?.version===4)return {editable:false,reason:'Read-only: this line retains its original slanted text geometry and cannot be edited.'};
    if(props.project.template.sourceCompositePages)return {editable:false,reason:'Edit supported spans in Resume wording and review the canonical PDF.'};
    if(region.sourceScopedPaint?.showGroup)return {editable:false,reason:'Edit this source span in Resume wording and review the canonical PDF.'};
    if (groupedMembers.has(region.id)) return {editable:false,reason:'Edit the complete bullet in Bullet wording. Its original font and frame stay fixed.'};
    const asset = props.project.template.sourceFonts?.find(face => face.id === region.style.sourceFontId);
    if(region.style.sourceStandardFontId){const element=host.current?.querySelector<HTMLElement>(`[data-region-id="${CSS.escape(region.id)}"] .folio-region-content`);return standardNativeAvailability(props.project,props.render,region,element??undefined,sourceFontsReady===sourceFontIdentity&&sourceRegistrations.current.registrations.get(region.style.sourceStandardFontId)?.status==='editable');}
    if (!region.style.sourceFontId) return { editable: true };
    if(asset?.sourceVersion===7&&!hasValidApproval(props.project))return {editable:false,reason:'Approve permission to reuse this document’s embedded fonts before editing.'};
    if(asset?.sourceVersion===8){if(!hasValidApproval(props.project))return {editable:false,reason:'Approve the reconstructed licensed template before editing.'};const owners=props.project.template.pages.find(p=>p.id===region.pageId)?.regions.filter(r=>r.kind==='text'&&r.order===region.order);if(owners?.length!==1||props.project.template.sourceLinks?.some(l=>l.bindings.some(b=>b.regionId===region.id)))return {editable:false,reason:'This licensed source show has shared ownership or a hyperlink and is read-only.'};}
    if (!asset) return { editable: false, reason: 'The original source font is unavailable.' };
    if(asset.sourceVersion===10)return {editable:false,reason:'Read-only: this exact numerical source font has no qualified native editing path.'};
    if((asset.sourceVersion===8||asset.sourceVersion===9)&&!licensedCurrentPreviewAllows(props.render,props.project,region.id))return {editable:false,reason:'Wait for the current source-bound PDF review. This paragraph must have one complete covered unlinked show.'};
    if (sourceRegistrations.current.identity !== sourceFontIdentity || sourceFontsReady !== sourceFontIdentity) {
      return { editable: false, reason: 'The source font is still being checked on this device.' };
    }
    const report = sourceRegistrations.current.registrations.get(asset.id);
    if (!sourceRegistrationReady(sourceFontIdentity, sourceFontsReady, sourceRegistrations.current.identity, report)) return { editable: false, reason: report?.reason ?? 'The original source font could not be verified on this device.' };
    if(asset.format==='opentype-cff'){
      const current=props.render?.layout.regions.find(r=>r.regionId===region.id)?.lines[0],glyphs=current?.runs.flatMap(r=>r.sourceGlyphs??[]);
      const available=cffRegionEditAvailability(region,asset,report?.derivation,report?.nativeProof,glyphs);
      if(asset.sourceVersion===9&&available.editable){
        const source=region.sourceLayout,block=props.project.draft.blocks.find(b=>b.id===region.contentId),text=block?.runs.map(r=>r.text).join('')??'';
        const content=host.current?.querySelector<HTMLElement>(`[data-region-id="${CSS.escape(region.id)}"] .folio-region-content`),page=content?.closest<HTMLElement>('.folio-page'),templatePage=props.project.template.pages.find(p=>p.id===region.pageId);
        if(!source||!current||!glyphs||current.runs.length!==1||!content||!page||!templatePage||Math.abs((current.runs[0].x-source.startX)*PT)>.06||!sourceNativeDomMatches(content,page,glyphs,text,0,source.startX,page.getBoundingClientRect().width/(templatePage.width*PT),{baseline:current.baseline,ascent:loadSourceFont(asset).ascent(region.style.fontSize)}))return {editable:false,reason:'The actual CFF editing surface has not verified all current ranges, baseline and terminal caret.'};
      }
      return available;
    }
    if(region.sourceLayout?.version===3||asset.format==='truetype'&&(asset.sourceVersion===4||asset.sourceVersion===5||asset.sourceVersion===6||asset.sourceVersion===7||asset.sourceVersion===8)){const block=props.project.draft.blocks.find(b=>b.id===region.contentId),current=layoutSourceRegion(region,block,loadSourceFont(asset)),canonical=asset.sourceVersion===8?props.render?.layout.regions.find(r=>r.regionId===region.id)?.lines[0]:undefined;
      if(asset.sourceVersion===8&&(!canonical||Math.abs((canonical.runs[0]?.x??region.sourceLayout!.startX)-region.sourceLayout!.startX)*PT>.06||Math.abs(canonical.baseline-region.sourceLayout!.baseline)*PT>.06))return {editable:false,reason:'The current native origin does not match its original source anchor.'};
      const glyphs=(canonical??current.line).runs.flatMap(r=>r.sourceGlyphs??[]),text=block?.runs.map(r=>r.text).join('')??'',available=sourceSpacingAvailability(region,asset,glyphs,text,asset.sourceVersion===8);
      if(asset.sourceVersion===8&&available.editable){if(!region.sourceLayout)return {editable:false};const content=host.current?.querySelector<HTMLElement>(`[data-region-id="${CSS.escape(region.id)}"] .folio-region-content`),page=content?.closest<HTMLElement>('.folio-page');if(!content||!page||!sourceNativeDomMatches(content,page,glyphs,text,region.sourceLayout.version===3?region.sourceLayout.characterSpacing:0,region.sourceLayout.startX,page.getBoundingClientRect().width/(props.project.template.pages.find(p=>p.id===region.pageId)!.width*PT),{baseline:canonical!.baseline,ascent:loadSourceFont(asset).ascent(region.style.fontSize)}))return {editable:false,reason:'The actual current editing surface has not verified its complete native caret positions.'};}return available;}
    return {editable:true};
  };
  const sourceEditableRef = useRef(sourceEditable); sourceEditableRef.current = sourceEditable;
  useEffect(() => {
    let active = true, release: (() => void) | undefined;
    setSourceFontsReady('');
    sourceRegistrations.current = { identity: '', registrations: new Map() };
    void Promise.all([registerBrowserSourceFontSet(props.project.template.sourceFonts ?? []),registerBrowserStandardFonts(props.project.template.sourceStandardFonts??[])]).then(([source,standard])=>({registrations:new Map([...source.registrations,...standard.registrations]),dispose:()=>{source.dispose();standard.dispose();}})).then(result => {
      if (!active) { result.dispose(); return; }
      release = result.dispose;
      sourceRegistrations.current = { identity: sourceFontIdentity, registrations: result.registrations };
      setSourceFontsReady(sourceFontIdentity);
    }).catch(reason => {
      if (!active) return;
      latest.current.onError(`The source editing font could not be loaded: ${reason instanceof Error ? reason.message : 'Invalid font.'}`);
      latest.current.onLayoutReview(['source-font-review'], latest.current.project.draft.revision, latest.current.render);
    });
    return () => { active = false; release?.(); clearSourceSpacingProofs(); sourceRegistrations.current = { identity: '', registrations: new Map() }; };
  }, [props.project.id, sourceFontIdentity]);
  useEffect(() => {
    const urls = new Map(props.project.assets.map(asset => [asset.id, URL.createObjectURL(new Blob([new Uint8Array(asset.bytes)], { type: asset.mime }))]));
    assetUrlsRef.current = urls;
    setAssetUrls(urls);
    return () => { urls.forEach(url => URL.revokeObjectURL(url)); if (assetUrlsRef.current === urls) assetUrlsRef.current = new Map(); };
  }, [props.project.id]);

  const extensions = useMemo(() => {
    const Document = TiptapNode.create({ name: 'doc', topNode: true, content: 'folioPage+' });
    const Evidence = Mark.create({
      name: 'folioEvidence', inclusive: true,
      addAttributes: () => ({ ids: { default: [] } }),
      parseHTML: () => [{ tag: 'span[data-folio-evidence]' }],
      renderHTML: ({ HTMLAttributes }) => ['span', { 'data-folio-evidence': JSON.stringify(HTMLAttributes.ids) }, 0],
    });
    const Page = TiptapNode.create({
      name: 'folioPage', group: 'block', content: 'folioRegion+', isolating: true, defining: true,
      addAttributes: () => ({ id: { default: '' }, width: { default: 612 }, height: { default: 792 }, decorations: { default: [] }, pageNumber: { default: 1 } }),
      parseHTML: () => [{ tag: 'section[data-folio-page]' }],
      renderHTML: ({ HTMLAttributes }) => ['section', { ...HTMLAttributes, 'data-folio-page': '' }, 0],
      addNodeView: () => ({ node }) => {
        const dom = document.createElement('section'); dom.className = 'folio-page-holder'; dom.dataset.pageId = String(node.attrs.id);
        dom.dataset.width = String(node.attrs.width); dom.dataset.height = String(node.attrs.height);
        dom.setAttribute('aria-label', `Resume page ${node.attrs.pageNumber}`);
        const paper = document.createElement('div'); paper.className = 'folio-page';
        paper.style.width = `${node.attrs.width}pt`; paper.style.height = `${node.attrs.height}pt`;
        if(latest.current.project.template.sourceScopedPages?.pages[Number(node.attrs.pageNumber)-1]?.pageGroup?.isolated)paper.style.isolation='isolate';
        const contentDOM = document.createElement('div'); contentDOM.className = 'folio-page-regions';
        // An auto z-index lets each ordered paint child share the paper's stack.
        contentDOM.style.zIndex = 'auto';
        for (const region of node.attrs.decorations as Project['template']['pages'][number]['regions']) {
          const asset = document.createElement(region.kind === 'image' ? 'img' : 'div');
          asset.className = `folio-locked-asset folio-${region.kind}`; asset.contentEditable = 'false';
          Object.assign(asset.style, { left: `${region.bounds.x}pt`, top: `${region.bounds.y}pt`, width: `${region.bounds.width}pt`, height: `${region.bounds.height}pt` });
          if (region.kind === 'image') { const image = asset as HTMLImageElement; image.dataset.assetId = region.assetId; image.alt = region.alt; image.draggable = false; const url = assetUrlsRef.current.get(region.assetId); if (url) image.src = url; if(region.sourcePaint){image.style.clipPath=sourceImageCssClip(region)??'';image.style.imageRendering='pixelated';} }
          if (region.kind === 'rule') { asset.style.background = region.color; asset.style.height = `${region.thickness}pt`; asset.setAttribute('aria-hidden', 'true'); }
          if (region.kind === 'rectangle') { asset.style.background = region.fill ?? 'transparent'; asset.style.border = region.stroke ? `${region.thickness}pt solid ${region.stroke}` : 'none'; asset.setAttribute('aria-hidden', 'true'); }
          const scoped=currentSourceScopedPaint(region,latest.current.project.template);
          if(scoped){const origin={x:region.bounds.x,y:region.kind==='rule'?region.bounds.y-region.thickness/2:region.bounds.y};asset.style.zIndex=String(region.order+1);asset.style.top=`${origin.y}pt`;asset.style.background=sourceScopedCssColor(scoped,region.kind==='text'?region.style.color:region.kind==='rule'?region.color:region.kind==='rectangle'?region.fill??'#000000':'#000000');asset.style.clipPath=sourceScopedCssClip(scoped,origin);}
          if (region.kind === 'sourceShape') {
            asset.setAttribute('aria-hidden', 'true');
            const owned = latest.current.project.template.sourceFonts?.find(font => font.id === region.sourceFontId);
            try {
              if (!owned || owned.sha256 !== region.sourceProgramSha256 || owned.sourceSha256 !== region.sourceSha256) throw new Error('The original decorative glyph has no verified font.');
              const face = loadSourceFont(owned);
              const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
              svg.setAttribute('viewBox', `${region.bounds.x} ${region.bounds.y} ${region.bounds.width} ${region.bounds.height}`);
              svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');
              svg.style.overflow = 'visible'; svg.style.display = 'block';
              const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
              const scale = region.fontSize / face.font.unitsPerEm;
              path.setAttribute('d', sourceGlyphPath(face, region.glyphId));
              path.setAttribute('fill', region.color);
              path.setAttribute('transform', `translate(${region.sourceX} ${region.sourceBaseline}) scale(${scale} ${-scale})`);
              svg.append(path); asset.append(svg);
            } catch {
              asset.dataset.sourceShapeError = 'true';
              asset.textContent = 'Source decoration unavailable';
            }
          }
          paper.append(asset);
        }
        paper.append(contentDOM); dom.append(paper);
        return { dom, contentDOM, ignoreMutation: mutation => mutation.type === 'attributes' };
      },
    });
    const Region = TiptapNode.create({
      name: 'folioRegion', group: 'block', content: 'paragraph+', isolating: true, defining: true,
      addAttributes: () => ({ id: { default: '' }, contentId: { default: '' }, bounds: { default: null }, style: { default: null }, role: { default: 'body' }, order: { default: 0 }, fixedSource: { default: false }, sourceStartX: { default: null }, sourceEndX: { default: null }, sourceSpacing: { default: 0 } }),
      parseHTML: () => [{ tag: 'div[data-folio-region]' }],
      renderHTML: ({ HTMLAttributes }) => ['div', { ...HTMLAttributes, 'data-folio-region': '' }, 0],
      addNodeView: () => ({ node }) => {
        const region = node.attrs as { id: string; contentId: string; bounds: TextRegion['bounds']; style: TextRegion['style']; role: TextRegion['role']; order: number; fixedSource: boolean; sourceStartX: number | null; sourceEndX: number | null; sourceSpacing: number };
        const dom = document.createElement('div'); dom.className = 'folio-region'; dom.dataset.regionId = region.id;
        dom.setAttribute('aria-label', `${region.role === 'heading' ? 'Heading' : region.role === 'contact' ? 'Contact details' : 'Resume text'} region ${region.order + 1}`);
        // Fixed source text may use an inverse-scaled native layout. Its unscaled
        // line box must not expand this selectable owner over neighboring lines.
        Object.assign(dom.style, { left: `${region.bounds.x}pt`, top: `${region.bounds.y}pt`, width: `${region.bounds.width}pt`, height: region.fixedSource ? `${region.bounds.height}pt` : 'auto', minHeight: `${region.bounds.height}pt`, '--region-height': `${region.bounds.height}pt` });
        const boundary = document.createElement('span'); boundary.className = 'folio-region-boundary'; boundary.contentEditable = 'false'; boundary.setAttribute('aria-hidden', 'true');
        const contentDOM = document.createElement('div'); contentDOM.className = 'folio-region-content';
        const sourceAsset = latest.current.project.template.sourceFonts?.find(asset => asset.id === region.style.sourceFontId);
        const standardAsset=latest.current.project.template.sourceStandardFonts?.find(f=>f.id===region.style.sourceStandardFontId);
        const originalRegion=latest.current.project.template.pages.flatMap(page=>page.regions).find(item=>item.id===region.id),scoped=originalRegion?currentSourceScopedPaint(originalRegion,latest.current.project.template):undefined;
        if(scoped){dom.dataset.sourceScoped='true';dom.style.zIndex='auto';boundary.style.zIndex='100002';contentDOM.style.zIndex=String(region.order+1);}
        Object.assign(contentDOM.style, { fontFamily: standardAsset?browserStandardFontFamily(standardAsset):sourceAsset ? browserSourceFontFamily(sourceAsset) : FONT_FAMILIES[region.style.fontFamily], fontKerning: !standardAsset&&!sourceAsset && region.style.fontFamily === 'times' ? 'normal' : 'none', fontSize: `${region.style.fontSize}pt`, fontWeight: sourceAsset?.format === 'opentype-cff' ? String(sourceAsset.declaredStyle.weightClass ?? 500) : sourceAsset?String(sourceAsset.sourceVersion===7?400:sourceAsset.fontWeight):'400', fontStyle: sourceAsset?.format === 'opentype-cff' ? (sourceAsset.declaredStyle.italic?'italic':'normal') : sourceAsset?.italic?'italic':'normal', color: region.style.color, lineHeight: `${region.style.lineHeight}pt`, textAlign: region.style.alignment });
        if(standardAsset){dom.dataset.sourceStandardFont=standardAsset.id;dom.dataset.sourceColor=region.style.color;contentDOM.contentEditable='false';dom.setAttribute('aria-readonly','true');contentDOM.style.fontWeight=String(region.style.fontWeight);contentDOM.style.fontStyle=region.style.italic?'italic':'normal';Object.assign(contentDOM.style,{fontKerning:'none',fontVariantLigatures:'none',fontSynthesis:'none',fontFeatureSettings:'"kern" 0, "liga" 0, "clig" 0',whiteSpace:'pre',overflowWrap:'normal',wordBreak:'normal'});if(region.fixedSource&&region.sourceStartX!==null&&region.sourceEndX!==null){contentDOM.style.left=`${region.sourceStartX-region.bounds.x}pt`;Object.assign(contentDOM.style,sourceNativeStyles(region.style.fontSize,region.style.lineHeight,region.sourceSpacing,Math.max(0,region.sourceEndX-region.sourceStartX+region.sourceSpacing),true));contentDOM.dataset.nativeResolution='16';}}
        if (sourceAsset) {
          dom.dataset.sourceFont = sourceAsset.id; dom.dataset.sourceColor = region.style.color;
          if (sourceAsset.format === 'opentype-cff') dom.dataset.sourceCff = 'true';
          contentDOM.contentEditable = 'false'; dom.setAttribute('aria-readonly', 'true');
          contentDOM.style.caretColor = region.style.color;
          contentDOM.style.fontVariantLigatures = 'none'; contentDOM.style.fontSynthesis = 'none';
          contentDOM.style.fontFeatureSettings = '"kern" 0, "liga" 0, "clig" 0';
          if (region.fixedSource) { contentDOM.style.whiteSpace = 'pre'; contentDOM.style.overflowWrap = 'normal'; contentDOM.style.wordBreak = 'normal'; }
          if (region.fixedSource && region.sourceStartX !== null && region.sourceEndX !== null) {
            const advance = sourceAdvanceBox(region.bounds.x, region.sourceStartX, region.sourceEndX);
            contentDOM.style.left = `${advance.left}pt`; contentDOM.style.width = `${Math.max(0,advance.width+region.sourceSpacing)}pt`;
            contentDOM.style.letterSpacing = `${region.sourceSpacing}pt`;dom.dataset.sourceSpacing=String(region.sourceSpacing);
          }
        }
        void (standardAsset?Promise.resolve(loadStandardFont(standardAsset)):sourceAsset ? Promise.resolve(loadSourceFont(sourceAsset)) : getFontMetrics(region.style)).then(face => {
          const firstBaseline = (region.style.lineHeight + face.ascent(region.style.fontSize) - face.descent(region.style.fontSize)) / 2;
          const top=(region.style.baselineOffset ?? firstBaseline)-firstBaseline;contentDOM.style.top = `${top}pt`;
          if(scoped){contentDOM.style.color=sourceScopedCssColor(scoped,region.style.color);contentDOM.style.caretColor=sourceScopedCssColor(scoped,region.style.color);contentDOM.style.clipPath=sourceNativeClip(sourceScopedCssClip(scoped,{x:region.fixedSource&&region.sourceStartX!==null?region.sourceStartX:region.bounds.x,y:region.bounds.y+top}),contentDOM.dataset.nativeResolution==='16');dom.dataset.sourceColor=sourceScopedCssColor(scoped,region.style.color);}
        });
        dom.append(boundary, contentDOM);
        return { dom, contentDOM, ignoreMutation: mutation => mutation.type === 'attributes' || !contentDOM.contains(mutation.target) };
      },
    });
    const Guard = Extension.create({
      name: 'folioGuard',
      addKeyboardShortcuts: () => ({
        'Mod-z': () => { latest.current.onUndo(); return true; },
        'Mod-Shift-z': () => { latest.current.onRedo(); return true; },
        'Mod-y': () => { latest.current.onRedo(); return true; },
      }),
      addProseMirrorPlugins: () => [new Plugin({
        filterTransaction(transaction, state) {
          if (!transaction.docChanged) return true;
          const permittedRegion=nativeInputPermit.current.consume(inputOwnerRef.current(state.doc),performance.now());
          let tooLong = false;
          transaction.doc.descendants(node => {
            if (node.type.name === 'folioRegion' && node.textBetween(0, node.content.size, '\n', '\n').length > 10000) tooLong = true;
          });
          if (tooLong) {
            window.setTimeout(() => latest.current.onError('Keep each editable region below 10,000 characters. The attempted edit was not applied.'), 0);
            return false;
          }
          const shape = (documentNode: PMNode) => { const nodes: string[] = []; documentNode.descendants(node => { if (node.type.name === 'folioPage' || node.type.name === 'folioRegion') nodes.push(`${node.type.name}:${JSON.stringify(node.attrs)}`); }); return nodes.join('|'); };
          if (shape(transaction.doc) !== shape(state.doc)) return false;
          if (!synchronizing.current) {
            if(!licensedSubsetInputAllowed(latest.current.project,transaction.doc,state.doc,id=>licensedCurrentPreviewRewriteAllows(latest.current.render,latest.current.project,id))){window.setTimeout(()=>latest.current.onError('This source paragraph does not support that wording or formatting change. Complete removal or exact restoration may remain available.'),0);return false;}
            if(!documentScopedMarksAllowed(latest.current.project,transaction.doc)){window.setTimeout(()=>latest.current.onError('This original document font cannot switch bold or italic faces, including pasted formatting.'),0);return false;}
            const previous = new Map<string, PMNode>();
            state.doc.descendants(node => { if (node.type.name === 'folioRegion') previous.set(String(node.attrs.id), node); });
            let lockedEdit = false;
            transaction.doc.descendants(node => {
              if (node.type.name !== 'folioRegion' || node.eq(previous.get(String(node.attrs.id)) ?? node)) return;
              const region = latest.current.project.template.pages.flatMap(page => page.regions).find(item => item.id === node.attrs.id);
              if(region?.kind==='text'&&region.style.sourceStandardFontId){const asset=latest.current.project.template.sourceStandardFonts?.find(f=>f.id===region.style.sourceStandardFontId);if(!asset)lockedEdit=true;else{const face=loadStandardFont(asset);node.descendants(child=>{if(child.isText&&(face.unsupportedCharacters(child.text??'').length||child.marks.some(m=>m.type.name==='bold')!==(region.style.fontWeight===700)||child.marks.some(m=>m.type.name==='italic')!==region.style.italic))lockedEdit=true;});}}
              if(region?.kind==='text'){
                const asset=latest.current.project.template.sourceFonts?.find(f=>f.id===region.style.sourceFontId);
                const currentOwner=region.style.sourceStandardFontId?standardCurrentPreviewAllows(latest.current.render,latest.current.project):asset?.sourceVersion===8||asset?.sourceVersion===9?licensedCurrentPreviewAllows(latest.current.render,latest.current.project,region.id):false;
                if(!(permittedRegion===region.id&&currentOwner)&&!sourceEditableRef.current(region).editable)lockedEdit=true;
              }
            });
            if (lockedEdit) {
              window.setTimeout(() => latest.current.onError('This original font span is read-only until its exact editing font and caret mapping can be verified. Other spans remain editable.'), 0);
              return false;
            }
          }
          return true;
        },
      })],
    });
    return [Document, Page, Region, Evidence, Guard, StarterKit.configure({ document: false, undoRedo: false, heading: false, bulletList: false, orderedList: false, listItem: false, blockquote: false, horizontalRule: false, codeBlock: false, code: false, strike: false, link: { openOnClick: false, autolink: false, linkOnPaste: false, protocols: ['http', 'https', 'mailto'] } })];
  }, [props.project.id]);

  const initialDocument = useMemo<JSONContent>(() => ({ type: 'doc', content: props.project.template.pages.map((page, index) => ({
    type: 'folioPage', attrs: { id: page.id, width: page.width, height: page.height, decorations: page.regions.filter(region => region.kind !== 'text'), pageNumber: index + 1 },
    content: page.regions.filter((region): region is TextRegion => region.kind === 'text').sort((a, b) => a.order - b.order).map(region => ({ type: 'folioRegion', attrs: { id: region.id, contentId: region.contentId, bounds: region.bounds, style: region.style, role: region.role, order: region.order, fixedSource: !!region.sourceLayout||!!region.sourceStandardLayout, sourceStartX: region.sourceStandardLayout?.startX??region.sourceLayout?.startX ?? null, sourceEndX: region.sourceStandardLayout?.endX??region.sourceLayout?.endX ?? null, sourceSpacing: region.sourceStandardLayout?.characterSpacing??(region.sourceLayout?.version===3?region.sourceLayout.characterSpacing:0) }, content: sourceBlockParagraphs(props.project.draft.blocks.find(block => block.id === region.contentId) ?? { id: region.contentId, runs: [{ text: '' }], sourceFactIds: [] }, region.style) })),
  })) }), [props.project.id]);

  const editor = useEditor({
    extensions, content: initialDocument, immediatelyRender: false,
    editorProps: {
      attributes: { 'aria-label': 'Editable resume document', 'data-testid': 'resume-editor', role: 'textbox', 'aria-multiline': 'true', tabindex: '0', spellcheck: 'true' },
      handlePaste(view, event) {
        const text = cleanText(event.clipboardData?.getData('text/plain') ?? '');
        event.preventDefault();
        const selection = view.state.selection;
        const sameRegion = (position: typeof selection.$from) => { for (let i = position.depth; i > 0; i--) if (position.node(i).type.name === 'folioRegion') return position.node(i).attrs.id; return null; };
        const id = sameRegion(selection.$from);
        const region = latest.current.project.template.pages.flatMap(page => page.regions).find(item => item.id === id);
        if (!id || id !== sameRegion(selection.$to) || nativeInputRegion(view.dom, document.getSelection()) !== id || region?.kind !== 'text' || !sourceEditableRef.current(region).editable) return true;
        view.dispatch(view.state.tr.insertText(text, selection.from, selection.to).setMeta('folioOrigin', 'paste'));
        return true;
      },
      handleDOMEvents: {
        beforeinput: (view, event) => {
          nativeInputPermit.current.clear();
          const input = event as InputEvent;
          if (input.inputType === 'historyUndo' || input.inputType === 'historyRedo') {
            event.preventDefault();
            if (input.inputType === 'historyUndo') latest.current.onUndo(); else latest.current.onRedo();
            return true;
          }
          const id = nativeInputRegion(view.dom, document.getSelection(), input.getTargetRanges?.() ?? []);
          const region = latest.current.project.template.pages.flatMap(page => page.regions).find(item => item.id === id);
          if (region?.kind === 'text' && sourceEditableRef.current(region).editable) {
            if(input.isTrusted)nativeInputPermit.current.capture(inputOwnerRef.current(view.state.doc),region.id,performance.now());
            return false;
          }
          event.preventDefault();
          latest.current.onError('Select an editable resume region before typing. Locked source text stays unchanged.');
          return true;
        },
        compositionstart: (view, event) => {
          const id = nativeInputRegion(view.dom, document.getSelection());
          const region = latest.current.project.template.pages.flatMap(page => page.regions).find(item => item.id === id);
          if (region?.kind !== 'text' || !sourceEditableRef.current(region).editable) {
            event.preventDefault();
            if (document.activeElement instanceof HTMLElement && view.dom.contains(document.activeElement)) document.activeElement.blur();
            latest.current.onComposition(false);
            latest.current.onError('Select an editable resume region before typing. Locked source text stays unchanged.');
            return true;
          }
          latest.current.onComposition(true); return false;
        },
        compositionend: () => { latest.current.onComposition(false); return false; },
      },
    },
    onUpdate({ editor: currentEditor, transaction }) {
      if (synchronizing.current) return;
      revealSourceText(currentEditor);
      const blocks: ContentBlock[] = [];
      currentEditor.state.doc.descendants(node => {
        if (node.type.name !== 'folioRegion') return;
        const block = latest.current.project.draft.blocks.find(item => item.id === node.attrs.contentId);
        if (block) blocks.push(serializeRegion(node, block));
      });
      const selected = regionAt(currentEditor);
      setActiveMarks(['bold', 'italic', 'underline', 'link'].filter(mark => currentEditor.isActive(mark)));
      latest.current.onSelect(selected);
      latest.current.onEdit(blocks, ['paste', 'format'].includes(String(transaction.getMeta('folioOrigin'))) ? '' : `typing:${selected ?? ''}`);
    },
    onSelectionUpdate({ editor: currentEditor }) {
      latest.current.onSelect(regionAt(currentEditor));
      setActiveMarks(['bold', 'italic', 'underline', 'link'].filter(mark => currentEditor.isActive(mark)));
    },
    onFocus({ editor: currentEditor }) { latest.current.onSelect(regionAt(currentEditor)); },
  }, [props.project.id]);



  // External history/evidence edits settle before paint; normal typing never replaces DOM.
  useLayoutEffect(() => {
    if (!editor) return;
    const patches: { from: number; to: number; slice: Slice }[] = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name !== 'folioRegion') return;
      const block = props.project.draft.blocks.find(item => item.id === node.attrs.contentId);
      if (!block) return;
      if (runsSignature(serializeRegion(node, block), node.attrs.style) === runsSignature(block, node.attrs.style)) return;
      const replacement = editor.schema.nodeFromJSON({ type: 'folioRegion', attrs: node.attrs, content: sourceBlockParagraphs(block, node.attrs.style) });
      const start = node.content.findDiffStart(replacement.content);
      const end = node.content.findDiffEnd(replacement.content);
      if (start === null || !end) return;
      let endBefore = end.a, endAfter = end.b;
      const overlap = start - Math.min(endBefore, endAfter);
      if (overlap > 0) { endBefore += overlap; endAfter += overlap; }
      patches.push({ from: position + 1 + start, to: position + 1 + endBefore, slice: replacement.slice(start, endAfter) });
    });
    if (!patches.length) return;
    revealSourceText(editor);
    synchronizing.current = true;
    let transaction = editor.state.tr;
    const bookmark = editor.state.selection.getBookmark();
    patches.sort((a, b) => b.from - a.from).forEach(patch => {
      transaction = transaction.replace(patch.from, patch.to, patch.slice);
    });
    try { transaction.setSelection(bookmark.map(transaction.mapping).resolve(transaction.doc)); } catch { /* ProseMirror selects the closest surviving text position. */ }
    editor.view.dispatch(transaction);
    synchronizing.current = false;
  }, [editor, props.project.draft]);

  useLayoutEffect(() => {
    if (!editor) return;
    let anyEditable = false;
    for (const region of props.project.template.pages.flatMap(page => page.regions)) {
      if (region.kind !== 'text') continue;
      if(region.sourceStandardLayout){const asset=props.project.template.sourceStandardFonts?.find(f=>f.id===region.style.sourceStandardFontId),element=editor.view.dom.querySelector<HTMLElement>(`[data-region-id="${CSS.escape(region.id)}"]`),content=element?.querySelector<HTMLElement>('.folio-region-content'),page=content?.closest<HTMLElement>('.folio-page');if(!asset||!element||!content||!page)continue;const source=region.sourceStandardLayout;Object.assign(content.style,sourceNativeStyles(region.style.fontSize,region.style.lineHeight,source.characterSpacing,Math.max(0,source.endX-source.startX+source.characterSpacing),true));const delta=sourceNativeBaselineAdjustment(content,page,page.getBoundingClientRect().width/(props.project.template.pages.find(p=>p.id===region.pageId)!.width*PT),source.baseline,loadStandardFont(asset).ascent(region.style.fontSize));if(delta!==undefined)content.style.top=`${parseFloat(content.style.top||'0')+delta}pt`;const availability=sourceEditable(region);anyEditable ||= availability.editable;content.contentEditable=String(availability.editable);content.style.caretColor=availability.editable?region.style.color:'transparent';element.dataset.sourceReadOnly=String(!availability.editable);element.setAttribute('aria-readonly',String(!availability.editable));element.title=availability.reason??'Original standard font and complete native caret geometry verified.';continue;}
      if (!region.sourceLayout) { anyEditable = true; continue; }
      const asset = props.project.template.sourceFonts?.find(font => font.id === region.style.sourceFontId);
      if (!asset) continue;
      const element = editor.view.dom.querySelector<HTMLElement>(`[data-region-id="${CSS.escape(region.id)}"]`);
      const content = element?.querySelector<HTMLElement>('.folio-region-content');
      if (!element || !content) continue;
      const highResolution=(asset.sourceVersion===8||asset.sourceVersion===9)&&licensedCurrentPreviewAllows(props.render,props.project,region.id);
      if(asset.sourceVersion===8||asset.sourceVersion===9){const source=region.sourceLayout,spacing=source.version===3?source.characterSpacing:0;Object.assign(content.style,sourceNativeStyles(region.style.fontSize,region.style.lineHeight,spacing,Math.max(0,source.endX-source.startX+spacing),highResolution));content.dataset.nativeResolution=highResolution?'16':'1';if(highResolution){const page=content.closest<HTMLElement>('.folio-page'),line=props.render?.layout.regions.find(r=>r.regionId===region.id)?.lines[0];if(page&&line){const adjustment=sourceNativeBaselineAdjustment(content,page,page.getBoundingClientRect().width/(props.project.template.pages.find(p=>p.id===region.pageId)!.width*PT),line.baseline,loadSourceFont(asset).ascent(region.style.fontSize));if(adjustment!==undefined)content.style.top=`${parseFloat(content.style.top||'0')+adjustment}pt`;}}const scoped=currentSourceScopedPaint(region,props.project.template);if(scoped)content.style.clipPath=sourceNativeClip(sourceScopedCssClip(scoped,{x:source.startX,y:region.bounds.y+parseFloat(content.style.top||'0')}),highResolution);}
      const availability = sourceEditable(region);
      anyEditable ||= availability.editable;
      content.contentEditable = String(availability.editable);
      content.style.caretColor = availability.editable ? region.style.color : 'transparent';
      element.dataset.sourceReadOnly = String(!availability.editable);
      element.setAttribute('aria-readonly', String(!availability.editable));
      element.title = availability.editable ? 'Original font verified for editing within this fixed line.' : availability.reason ?? 'This original font span is read-only.';
    }
    if (editor.isEditable !== anyEditable) editor.setEditable(anyEditable, false);
    editor.view.dom.setAttribute('aria-readonly', String(!anyEditable));
  }, [editor, props.project.template, props.project.draft, props.render, sourceFontIdentity, sourceFontsReady, scale, props.visible]);


  useLayoutEffect(() => {
    if (!editor) return;
    revealSourceText(editor);
    // A selected semantic bullet has its complete current frame; source owners stay immutable.
    for(const region of props.project.template.pages.flatMap(page=>page.regions)){if(region.kind!=='text')continue;const element=editor.view.dom.querySelector<HTMLElement>(`[data-region-id="${CSS.escape(region.id)}"]`);if(element)Object.assign(element.style,{left:`${region.bounds.x}pt`,top:`${region.bounds.y}pt`,width:`${region.bounds.width}pt`,height:region.sourceLayout||region.sourceStandardLayout?`${region.bounds.height}pt`:'auto',minHeight:`${region.bounds.height}pt`,'--region-height':`${region.bounds.height}pt`});}
    const rendered = props.render;
    if (!props.visible || !rendered ||
        rendered.contentRevision !== props.project.draft.revision ||
        rendered.sourceFingerprint !== sourceDocumentFingerprint(props.project.template, props.project.draft)) return;
    const assets = new Map((props.project.template.sourceFonts ?? []).map(asset => [asset.id, asset]));
    const faces = new Map([...assets].map(([id, asset]) => [id, loadSourceFont(asset)]));
    const svgNamespace = 'http://www.w3.org/2000/svg';
    for (const region of props.project.template.pages.flatMap(page => page.regions)) {
      if (region.kind !== 'text' || !region.sourceLayout || !region.style.sourceFontId) continue;
      const sourceAsset = assets.get(region.style.sourceFontId);
      if (sourceAsset && !sourceEditable(region).editable) {
        if (!sourceRunsUnchanged(props.project, region) && !(groupedMembers.has(region.id) && paragraphPreviewReady) && !wordingPreviewIds.has(region.id)) continue;
      }
      const element = editor.view.dom.querySelector<HTMLElement>(`[data-region-id="${CSS.escape(region.id)}"]`);
      const content = element?.querySelector<HTMLElement>('.folio-region-content');
      const canonical = rendered.layout.regions.find(item => item.regionId === region.id);
      if (!element || !content || !canonical || rendered.layout.overflows.some(issue => issue.regionId === region.id && ['glyph', 'asset'].includes(issue.code))) continue;
      const scoped=currentSourceScopedPaint(region,props.project.template),paintColor=scoped?sourceScopedCssColor(scoped,region.style.color):region.style.color;
      if(scoped)content.style.clipPath=sourceNativeClip(sourceScopedCssClip(scoped,{x:region.bounds.x+parseFloat(content.style.left||'0'),y:region.bounds.y+parseFloat(content.style.top||'0')}),content.dataset.nativeResolution==='16');
      const runs = canonical.lines.flatMap(line => line.runs);
      if (!runs.every(run => run.sourceGlyphs && run.sourceGlyphs.map(glyph => glyph.unicode).join('') === run.text)) continue;
      const svg = document.createElementNS(svgNamespace, 'svg'); svg.classList.add('folio-source-ink');
      svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
      const grouped = groupedMembers.has(region.id) && paragraphPreviewReady;
      const bounds = grouped ? canonical.bounds : region.bounds;
      if(grouped)Object.assign(element.style,{left:`${bounds.x}pt`,top:`${bounds.y}pt`,width:`${bounds.width}pt`,height:`${bounds.height}pt`,minHeight:`${bounds.height}pt`,'--region-height':`${bounds.height}pt`});
      svg.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
      Object.assign(svg.style, { position: 'absolute', left: `${grouped?0:bounds.x-region.bounds.x}pt`, top: `${grouped?0:bounds.y-region.bounds.y}pt`, width: `${bounds.width}pt`, height: `${bounds.height}pt`, overflow: 'visible', pointerEvents: 'none' });
      if(scoped){svg.style.zIndex=String(region.order+1);svg.style.clipPath=sourceScopedCssClip(scoped,bounds);}
      let valid = true;
      try {
        for (const line of canonical.lines) for (const run of line.runs) {
          for (const glyph of run.sourceGlyphs ?? []) {
            const asset = assets.get(glyph.fontId), mapping = asset?.glyphMap.find(map => map.cid === glyph.cid);
            if (!asset || !mapping) { valid = false; break; }
            if (mapping.nonPainting) continue;
            const face = faces.get(asset.id)!, path = document.createElementNS(svgNamespace, 'path');
            const scale = region.style.fontSize / face.font.unitsPerEm;
            path.setAttribute('d', sourceGlyphPath(face, mapping.glyphId)); path.setAttribute('fill', paintColor);
            path.setAttribute('transform', region.sourceLayout.version===4?`matrix(${scale} 0 ${scale*region.sourceLayout.shearX} ${-scale} ${glyph.x} ${line.baseline})`:`translate(${glyph.x} ${line.baseline}) scale(${scale} ${-scale})`);
            svg.append(path);
          }
          if (run.underline && run.width > 0) {
            const asset = assets.get(run.sourceFontId ?? region.style.sourceFontId);
            if (!asset) { valid = false; break; }
            const face = faces.get(asset.id)!, underline = document.createElementNS(svgNamespace, 'line');
            const y = line.baseline + face.underlineOffset(region.style.fontSize);
            underline.setAttribute('x1', String(run.x)); underline.setAttribute('x2', String(run.x + run.width));
            underline.setAttribute('y1', String(y)); underline.setAttribute('y2', String(y));
            underline.setAttribute('stroke', paintColor); underline.setAttribute('stroke-width', String(face.underlineThickness(region.style.fontSize)));
            svg.append(underline);
          }
        }
      } catch { valid = false; }
      if (!valid) continue;
      element.insertBefore(svg, content); element.dataset.sourceGraphCurrent = 'true';
      content.style.color = 'transparent'; content.style.webkitTextFillColor = 'transparent';
    }
  }, [editor, props.project.template, props.project.draft, props.project.assets, props.render, props.visible, sourceFontIdentity, sourceFontsReady,wordingPreviewIds]);

  useEffect(() => {
    if (!editor) return;
    editor.view.dom.querySelectorAll<HTMLImageElement>('img[data-asset-id]').forEach(image => {
      const url = assetUrls.get(image.dataset.assetId ?? '');
      if (url && image.src !== url) image.src = url;
    });
  }, [editor, assetUrls]);


  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(entries => {
      if (!fit) return;
      const width = entries[0]?.contentRect.width ?? 0;
      const pageWidth = Math.max(...props.project.template.pages.map(page => page.width));
      setScale(Math.min(1, Math.max(0.25, (width - (width < 600 ? 24 : 72)) / (pageWidth * PT))));
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [fit, props.project.id]);

  useEffect(() => {
    if (!editor) return;
    editor.view.dom.querySelectorAll<HTMLElement>('.folio-page-holder').forEach(holder => {
      holder.style.width = `${Number(holder.dataset.width) * PT * scale}px`;
      holder.style.height = `${Number(holder.dataset.height) * PT * scale}px`;
      const page = holder.querySelector<HTMLElement>('.folio-page');
      if (page) page.style.transform = `scale(${scale})`;
    });
    editor.view.dom.querySelectorAll<HTMLElement>('.folio-region').forEach(region => {
      region.dataset.selected = String(region.dataset.regionId === props.selectedRegion);
      region.dataset.overflow = String(props.render?.layout.overflows.some(issue => issue.regionId === region.dataset.regionId) ?? false);
      const target=props.project.template.pages.flatMap(page=>page.regions).find(item=>item.kind==='text'&&item.id===region.dataset.regionId);
      if(target?.kind==='text'){const before=props.project.baseline.blocks.find(block=>block.id===target.contentId),after=props.project.draft.blocks.find(block=>block.id===target.contentId);region.dataset.designChanged=String(!!before&&!!after&&blockText(before)!==blockText(after));region.dataset.designUnproved=String(sourceReviewIssues(props.project).includes(target.contentId));}
    });
  }, [editor, scale, props.selectedRegion, props.render, props.project.draft]);

  useEffect(() => {
    if (!editor || !props.visible || !props.render || props.render.contentRevision !== props.project.draft.revision) return;
    if (sourceFontIdentity && sourceFontsReady !== sourceFontIdentity) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        await document.fonts.ready;
        const issues: string[] = [];
        if (editor.view.dom.querySelector('[data-source-shape-error="true"]')) issues.push('source-decoration-review');
        let measuredRegions = 0;
        const regions = props.project.template.pages.flatMap(page => page.regions).filter((region): region is TextRegion => region.kind === 'text');
        for (const region of regions) {
          const element = editor.view.dom.querySelector<HTMLElement>(`[data-region-id="${CSS.escape(region.id)}"] .folio-region-content`);
          const canonical = props.render!.layout.regions.find(item => item.regionId === region.id);
          if (!element || !canonical || !element.getClientRects().length) continue;
          measuredRegions++;
          const sourceAsset = props.project.template.sourceFonts?.find(asset => asset.id === region.style.sourceFontId);
          if(region.sourceStandardLayout){if(!sourceEditableRef.current(region).editable)issues.push(region.id);continue;}
          if (sourceAsset && !sourceEditableRef.current(region).editable) {
            if ((!sourceRunsUnchanged(props.project, region) && !(groupedMembers.has(region.id) && paragraphPreviewReady) && !wordingPreviewIds.has(region.id)) || element.closest<HTMLElement>('.folio-region')?.dataset.sourceGraphCurrent !== 'true') issues.push(region.id);
            continue;
          }
          const pageElement = element.closest('.folio-page')!.getBoundingClientRect();
          const lines: { baseline: number; text: string }[] = [];
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          let textNode: globalThis.Node | null;
          while ((textNode = walker.nextNode())) {
            const value = textNode.textContent ?? '';
            const actual = getComputedStyle(textNode.parentElement!);
            const face = sourceAsset ? loadSourceFont(sourceAsset) : await getFontMetrics({ ...region.style, fontWeight: Number(actual.fontWeight) >= 600 ? 700 : 400, italic: actual.fontStyle !== 'normal' });
            for (let offset = 0; offset < value.length; offset++) {
              if (!active) return;
              if (offset > 0 && offset % 500 === 0) await new Promise<void>(resolve => window.setTimeout(resolve, 0));
              if (value[offset] === '\n') continue;
              const range = document.createRange(); range.setStart(textNode, offset); range.setEnd(textNode, offset + 1);
              const rect = range.getBoundingClientRect();
              if (!rect.height) continue;
              const baseline = (rect.top - pageElement.top) / (scale * PT) + face.ascent(region.style.fontSize);
              const line = lines.find(item => Math.abs(item.baseline - baseline) < 1);
              if (line) line.text += value[offset]; else lines.push({ baseline, text: value[offset] });
            }
          }
          const normalize = (text: string) => text.trim().replace(/\s+/g, ' ');
          const visibleLines = lines.filter(line => normalize(line.text));
          const pdfLines = canonical.lines.filter(line => normalize(line.runs.map(run => run.text).join('')));
          const sameWrap = visibleLines.length === pdfLines.length && visibleLines.every((line, index) => normalize(line.text) === normalize(pdfLines[index]?.runs.map(run => run.text).join('') ?? ''));
          // Different font variants have different browser line-box metrics.
          // Align the first visible native baseline with the approved canonical
          // baseline, without replacing the editing DOM or changing geometry.
          const adjustment = (pdfLines[0]?.baseline ?? 0) - (visibleLines[0]?.baseline ?? 0);
          if (visibleLines.length && pdfLines.length && Math.abs(adjustment) > .01) {
            element.style.top = `${(Number.parseFloat(element.style.top) || 0) + adjustment}pt`;
            for (const line of visibleLines) line.baseline += adjustment;
          }
          const baselineMatches = visibleLines.every((line, index) => Math.abs(line.baseline - (pdfLines[index]?.baseline ?? Infinity)) <= 1);
          if (!sameWrap || !baselineMatches) issues.push(region.id);
        }
        if (active && measuredRegions === regions.length) latest.current.onLayoutReview(issues, props.project.draft.revision, props.render);
      })().catch(() => { if (active) latest.current.onLayoutReview(['font-review'], props.project.draft.revision, props.render); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [editor, props.render, props.project.template, props.project.draft.revision, scale, props.visible, sourceFontIdentity, sourceFontsReady,wordingPreviewIds]);

  const selected = props.project.template.pages.flatMap(page => page.regions).find((region): region is TextRegion => region.kind === 'text' && region.id === props.selectedRegion);
  const licensedDeletionOnly=!!selected&&props.project.template.sourceFonts?.some(f=>f.id===selected.style.sourceFontId&&f.sourceVersion===8);
  const fixedDocumentFace=!!selected&&props.project.template.sourceFonts?.some(f=>f.id===selected.style.sourceFontId&&(f.sourceVersion===7||f.sourceVersion===8));
  const selectedPage = props.project.template.pages.findIndex(page => page.id === selected?.pageId) + 1;
  function focusRegion(id: string) {
    if (!editor) return;
    let target = -1;
    editor.state.doc.descendants((node, position) => { if (node.type.name === 'folioRegion' && node.attrs.id === id) target = position + 2; });
    if (target > -1) { editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target))); editor.view.focus(); props.onSelect(id); }
  }
  useEffect(() => {
    if (mobileFocused && selected && editor) {
      const regionElement = editor.view.dom.querySelector<HTMLElement>(`[data-region-id="${CSS.escape(selected.id)}"]`);
      if (regionElement && host.current) {
        const rect = regionElement.getBoundingClientRect(); const viewport = host.current.getBoundingClientRect();
        host.current.scrollLeft += rect.left - viewport.left - 20;
        host.current.scrollTop += rect.top - viewport.top - 25;
      }
    }
  }, [mobileFocused, selected?.id, editor]);

  return <div className={`document-editor ${mobileFocused ? 'mobile-region-focused' : ''}`}>
    <div className="editor-toolbar" aria-label="Document editing controls">
      <div className="toolbar-group"><button className="icon-button" aria-label="Undo last edit" title="Undo · ⌘/Ctrl Z" onClick={props.onUndo} disabled={!props.canUndo}><Undo2 size={17} /></button><button className="icon-button" aria-label="Redo last edit" title="Redo · ⌘/Ctrl Shift Z" onClick={props.onRedo} disabled={!props.canRedo}><Redo2 size={17} /></button></div>
      <div className="toolbar-group formatting-tools">{(['bold', 'italic', 'underline'] as const).map(mark => { const Icon = mark === 'bold' ? Bold : mark === 'italic' ? Italic : Underline; return <button key={mark} disabled={!!licensedDeletionOnly||!!fixedDocumentFace&&mark!=='underline'} title={licensedDeletionOnly?'This licensed paragraph retains its original formatting during covered wording edits.':fixedDocumentFace&&mark!=='underline'?'This original document face cannot switch bold or italic styles.':undefined} className={`icon-button ${activeMarks.includes(mark) ? 'is-active' : ''}`} aria-label={mark[0].toUpperCase() + mark.slice(1)} aria-pressed={activeMarks.includes(mark)} onMouseDown={event => event.preventDefault()} onClick={() => { if (!editor) return; const chain = editor.chain().focus().command(({ tr }) => { tr.setMeta('folioOrigin', 'format'); return true; }); if (mark === 'bold') chain.toggleBold().run(); if (mark === 'italic') chain.toggleItalic().run(); if (mark === 'underline') chain.toggleUnderline().run(); }}><Icon size={17} /></button>; })}<button disabled={!!licensedDeletionOnly} title={licensedDeletionOnly?'This licensed paragraph does not support hyperlink changes.':undefined} className={`icon-button ${activeMarks.includes('link') ? 'is-active' : ''}`} aria-label="Edit selected text link" onMouseDown={event => event.preventDefault()} onClick={() => { setLinkValue(editor?.getAttributes('link').href ?? ''); setLinkError(''); setLinkOpen(!linkOpen); }}><Link2 size={17} /></button></div>
      <span className="toolbar-label">{wordingPreviewIds.size?'Select a span to edit its wording':'Click the resume to edit'}</span>
      <div className="toolbar-group zoom-tools"><button className="icon-button" aria-label="Zoom out" onClick={() => { setFit(false); setScale(value => Math.max(0.3, value - 0.1)); }}><ZoomOut size={17} /></button><button className="zoom-value" aria-label="Fit document to workspace" onClick={() => { setFit(true); setScale(0.8); }}>{Math.round(scale * 100)}%<ChevronDown size={12} /></button><button className="icon-button" aria-label="Zoom in" onClick={() => { setFit(false); setScale(value => Math.min(1.6, value + 0.1)); }}><ZoomIn size={17} /></button></div>
    </div>
    <SourceReadOnlyNotice project={props.project}/>
    {linkOpen && <form className="link-editor" onSubmit={event => { event.preventDefault(); const href = safeHref(linkValue); if (linkValue && !href) { setLinkError('Use an https, http, or mailto link.'); return; } if (href) editor?.chain().focus().command(({ tr }) => { tr.setMeta('folioOrigin', 'format'); return true; }).extendMarkRange('link').setLink({ href }).run(); else editor?.chain().focus().command(({ tr }) => { tr.setMeta('folioOrigin', 'format'); return true; }).extendMarkRange('link').unsetLink().run(); setLinkOpen(false); }}><label htmlFor="link-url">Link for selected text</label><input id="link-url" value={linkValue} onChange={event => setLinkValue(event.target.value)} placeholder="https://example.com" /><button className="button button-small" type="submit">Apply</button><button className="text-button" type="button" onClick={() => setLinkOpen(false)}>Cancel</button>{linkError && <span role="alert">{linkError}</span>}</form>}
    <div className="mobile-edit-context"><span>{selected ? `Page ${selectedPage} · ${selected.role === 'heading' ? 'Heading' : 'Text region'}` : 'Select a text region on the page'}</span>{mobileFocused ? <button className="text-button" onClick={() => { setMobileFocused(false); setFit(true); }}><ArrowLeft size={14} />Page overview</button> : <button className="text-button" disabled={!selected} onClick={() => { setMobileFocused(true); setFit(false); setScale(1); if (selected) focusRegion(selected.id); }}>Focus region</button>}</div>
    {!!paragraphGroups.length && <SourceParagraphEditor project={props.project} groups={paragraphGroups} selectedRegion={props.selectedRegion} onSelect={props.onSelect} onEdit={props.onParagraphEdit} onReset={props.onParagraphReset} />}
    <SourceWordingEditor project={props.project} render={props.render} selectedRegion={props.selectedRegion} onSelect={props.onSelect} onEdit={props.onEdit} onError={props.onError}/>
    <div ref={host} className="canvas-scroll" tabIndex={-1}><EditorContent editor={editor} /></div>
    <div className="canvas-caption"><span>{props.project.template.pages.length} {props.project.template.pages.length === 1 ? 'page' : 'pages'} · Approved geometry stays fixed</span><span>Photos & rules are locked</span></div>
  </div>;
}
