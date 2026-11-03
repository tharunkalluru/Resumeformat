import {beforeAll,describe,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {PDFDocument,PDFName} from 'pdf-lib';
import type {PDFPageProxy} from 'pdfjs-dist/types/src/display/api';
import type {TextItem} from 'pdfjs-dist/types/src/display/api';
import {sha256Sync,type SourceFontAsset} from '../core/model';
import {parseSourceProgram} from '../layout/source-fonts';
import {fictionalScopedPdf} from './pdf-scoped.fixture';
import {associateSourceItems,captureSourceGlyphs,type SourcePaintGlyph} from './pdf-source';
import {localPdfDecoderOptions} from '../render/pdf-decoder-options';

let program:Uint8Array,pdfjs:typeof import('pdfjs-dist/legacy/build/pdf.mjs');
const size=12,origin=[100,400] as const;
type Linear=[number,number,number,number];
const rightAngles:[string,Linear][]=[
  ['counterclockwise',[0,1,-1,0]],
  ['clockwise',[0,-1,1,0]],
  ['retained tiny residue',[4.4e-8,1,-1,4.4e-8]],
];

beforeAll(async()=>{
  Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});
  pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  program=new Uint8Array(await readFile('public/fonts/DejaVuSans.ttf'));
});

async function fixture(linear:Linear){
  // Both shows use the same original simple WinAnsi font and signed TJ gap.
  const source=await fictionalScopedPdf(program,{text:'ab',second:true,gap:25});
  const document=await PDFDocument.load(source.bytes),page=document.getPages()[0];
  // PDF numbers do not admit JavaScript's exponent spelling for tiny residues.
  const matrix=[...linear,...origin].map(value=>value.toFixed(12)).join(' ');
  const raw=source.content.replace('1 0 0 1 40 625 Tm',matrix+' Tm');
  expect(raw).not.toBe(source.content);
  page.node.set(PDFName.of('Contents'),document.context.register(document.context.flateStream(raw)));
  return new Uint8Array(await document.save());
}

async function withPage<T>(bytes:Uint8Array,run:(page:PDFPageProxy,viewport:number[])=>Promise<T>):Promise<T>{
  const task=pdfjs.getDocument({data:new Uint8Array(bytes),...localPdfDecoderOptions(),fontExtraProperties:true,verbosity:0});
  try{
    const page=await(await task.promise).getPage(1);
    return await run(page,page.getViewport({scale:1}).transform);
  }finally{await task.destroy();}
}

function captured(page:PDFPageProxy,viewport:number[],bytes:Uint8Array,assets:SourceFontAsset[]){
  return captureSourceGlyphs(page,viewport,sha256Sync(bytes),assets,bytes,1,undefined,true);
}

function pdfAdvance(char:string):number{
  // Independently reproduce the authored PDF Widths, not the captured graph.
  const font=parseSourceProgram(program),glyph=font.glyphForCodePoint(char.codePointAt(0)!);
  return Math.round(glyph.advanceWidth*1000/font.unitsPerEm)*size/1000;
}

describe('opt-in original right-angle text capture',()=>{
  it.each(rightAngles)('captures and associates %s in source-local coordinates',async(_name,linear)=>{
    const bytes=await fixture(linear);
    await withPage(bytes,async(page,viewport)=>{
      const assets:SourceFontAsset[]=[],graph=await captured(page,viewport,bytes,assets);
      expect(graph).toBeDefined();
      const glyphs=graph!,horizontal=glyphs.filter(g=>!g.rotation),rotated=glyphs.filter(g=>g.rotation);
      expect(horizontal.map(g=>g.unicode).join('')).toBe('ab');
      expect(rotated.map(g=>g.unicode).join('')).toBe('cab');
      expect(rotated).toHaveLength(3);
      expect(assets).toHaveLength(1);
      expect(assets[0]).toMatchObject({format:'truetype',sourceVersion:6,originalProgram:{bytes:program}});
      expect(horizontal[0].x).toBe(40);
      expect(horizontal[0].baseline).toBe(52);
      expect(horizontal[1].x).toBeCloseTo(40+pdfAdvance('a')+.3,10);

      const raw=linear.map(Math.fround),scale=Math.hypot(raw[0],raw[1]);
      const cursors=[0,pdfAdvance('c')+.3,pdfAdvance('c')+.3+pdfAdvance('a')];
      for(const [index,glyph] of rotated.entries()){
        const basis=glyph.rotation!;
        expect(glyph.size).toBeCloseTo(size*scale,12);
        expect(glyph.advance).toBeCloseTo(pdfAdvance(glyph.unicode)*scale,12);
        expect(glyph.baseline).toBe(rotated[0].baseline);
        expect(glyph.x-rotated[0].x).toBeCloseTo(cursors[index]*scale,10);
        // Map the retained local coordinates back to the independent raw Tm.
        expect(basis[0]*glyph.x+basis[2]*glyph.baseline).toBeCloseTo(origin[0]+raw[0]*cursors[index],9);
        expect(basis[1]*glyph.x+basis[3]*glyph.baseline).toBeCloseTo(700-origin[1]-raw[1]*cursors[index],9);
        if(linear[0]!==0){
          expect(basis[0]).not.toBe(0);
          expect(basis[0]).toBe(raw[0]/scale);
        }
      }

      const text=await page.getTextContent({disableNormalization:true});
      const associated=associateSourceItems(text.items,glyphs,viewport,assets);
      expect(associated.flatMap(part=>part.glyphs)).toEqual(glyphs);
      expect(associated.map(part=>part.item.str).join('')).toBe('abcab');
      expect(associated.filter(part=>part.glyphs.some(g=>g.rotation)).flatMap(part=>part.glyphs).map(g=>g.baseline))
        .toEqual(rotated.map(g=>g.baseline));
    });
  });

  it('retains the old refusal unless rotation capture is explicitly enabled',async()=>{
    const bytes=await fixture(rightAngles[0][1]);
    await withPage(bytes,async(page,viewport)=>{
      await expect(captureSourceGlyphs(page,viewport,sha256Sync(bytes),[],bytes))
        .rejects.toMatchObject({code:'PDF_SOURCE_PROOF'});
      await expect(captureSourceGlyphs(page,viewport,sha256Sync(bytes),[],bytes,1,undefined,false))
        .rejects.toMatchObject({code:'PDF_SOURCE_PROOF'});
      expect((await captured(page,viewport,bytes,[]))?.filter(g=>g.rotation)).toHaveLength(3);
    });
  });

  it.each([
    ['sheared rotation',[.2,1,-1,0]],
    ['unequal scales',[0,1,-2,0]],
    ['reflected rotation',[0,1,1,0]],
  ] as [string,Linear][])('rejects %s even with the explicit opt-in',async(_name,linear)=>{
    const bytes=await fixture(linear);
    await withPage(bytes,async(page,viewport)=>{
      await expect(captured(page,viewport,bytes,[])).rejects.toMatchObject({code:'PDF_SOURCE_ROTATION'});
    });
  });

  it('requires the rotated extractor item to retain its owned physical baseline',async()=>{
    const bytes=await fixture(rightAngles[0][1]);
    await withPage(bytes,async(page,viewport)=>{
      const assets:SourceFontAsset[]=[],glyphs=(await captured(page,viewport,bytes,assets)) as SourcePaintGlyph[];
      const text=await page.getTextContent({disableNormalization:true});
      const items=text.items.map(item=>'str'in item?{...item,transform:[...item.transform]}:item);
      const rotated=items.find((item):item is TextItem=>'str'in item&&item.str==='cab')!;
      expect(rotated).toBeDefined();
      rotated.transform[4]+=.1;
      expect(()=>associateSourceItems(items,glyphs,viewport,assets)).toThrow();
    });
  });
});
