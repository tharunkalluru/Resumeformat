import {beforeAll,afterAll,it,expect} from 'vitest';
import 'fake-indexeddb/auto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {GlobalWorkerOptions,getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {PDFArray,PDFDict,PDFDocument,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {fictionalImageBlankSource} from '../core/sourceImageTestFixture';
import {makeProject,canonicalJson,type TextRegion,type Project} from '../core/model';
import {sourceGlyphs} from '../core/source-graph';
import {validateProject} from '../core/schema';
import {approveTemplate,editBlock} from '../core/commands';
import {sourceScopedStateHash} from '../core/source-scoped-paint';
import {packRecordMetadata,unpackRecordMetadata} from '../core/project-record-codec';
import {sourceWordingTargets} from '../core/source-wording';
import {importResume} from './index';
import {validateSourceScopedPaint} from './pdf-scoped-source';
import {renderProjectDocument,renderDocument,setFontLoader} from '../render/pdf';
import {saveProject,loadProjects,backupProject,restoreProject} from '../storage/projects';
let program:Uint8Array,release:()=>void;
beforeAll(async()=>{
 program=new Uint8Array(await readFile('public/fonts/DejaVuSans.ttf'));
 Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});
 release=setFontLoader(async f=>new Uint8Array(await readFile(resolve('public/fonts',f))));
 await import('./pdf');GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
});
afterAll(()=>release?.());
async function fixture(single:boolean){
 const bytes=await fictionalImageBlankSource(program,{images:0}),d=await PDFDocument.load(bytes),p=d.getPages()[0],raw=p.node.Contents()!,refs=raw instanceof PDFArray?raw.asArray():[raw],old=refs.map(r=>new TextDecoder().decode(decodePDFRawStream(d.context.lookup(r) as PDFRawStream).decode())).join('\n'),resource=old.match(/(\/[^\s]+) 12 Tf/)![1],face=fontkit.create(program),hex=(c:string)=>face.glyphForCodePoint(c.codePointAt(0)!).id.toString(16).padStart(4,'0');
 p.node.Resources()!.delete(PDFName.of('XObject'));
 const fontRef=p.node.Resources()!.lookup(PDFName.of('Font'),PDFDict).entries()[0][1],fontDict=d.context.lookup(fontRef,PDFDict),desc=fontDict.lookup(PDFName.of('DescendantFonts'),PDFArray).lookup(0,PDFDict),used=Array.from(new Set('ab jgyA'));
 const cmap='/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Authored) /Ordering (Identity) /Supplement 0 >> def /CMapName /AuthoredShear def /CMapType 2 def 1 begincodespacerange <0000> <ffff> endcodespacerange '+used.length+' beginbfchar '+used.map(c=>'<'+hex(c)+'> <'+c.charCodeAt(0).toString(16).padStart(4,'0')+'>').join(' ')+' endbfchar endcmap CMapName currentdict /CMap defineresource pop end end';
 fontDict.set(PDFName.of('ToUnicode'),d.context.register(d.context.flateStream(cmap)));desc.set(PDFName.of('W'),d.context.obj(used.flatMap(c=>[face.glyphForCodePoint(c.charCodeAt(0)).id,[face.glyphForCodePoint(c.charCodeAt(0)).advanceWidth*1000/face.unitsPerEm]])));

 const text='jgyA',size=12,knownOrigins:number[]=[];let x=40;
 const shows=(value:string)=>{let r='',prior='';for(const c of value){if(prior)r+=(face.glyphForCodePoint(prior.codePointAt(0)!).advanceWidth*size/face.unitsPerEm).toFixed(8)+' 0 Td\n';r+='<'+hex(c)+'> Tj\n';prior=c;}return r;};
 for(const c of text){knownOrigins.push(x);x+=face.glyphForCodePoint(c.codePointAt(0)!).advanceWidth*size/face.unitsPerEm;}
 // Distinct raw factors: reflection in CTM and Tm; original x-shear is +.25.
 const source='q 1 1 1 rg 0 0 500 700 re f 0 0 0 rg\nBT '+resource+' 12 Tf 1 0 0 1 40 650 Tm\n'+shows('ab ab ab')+'ET\nq 1 0 0 -1 0 700 cm BT '+resource+' 12 Tf 1 0 .25 -1 40 100 Tm\n'+(single?'<'+Array.from(text,hex).join('')+'> Tj\n':shows(text))+'ET Q\n0 0 1 rg 400 595 20 12 re f Q';
 p.node.set(PDFName.of('Contents'),d.context.register(d.context.flateStream(source)));
 const original=new Uint8Array(await d.save()),project=validateProject(makeProject(await importResume(new File([original],'authored-shear.pdf',{type:'application/pdf'})),true));
 return {original,project,text,knownOrigins,source,hex};
}
const metadata=(p:Project):Project=>JSON.parse(JSON.stringify(p,(_k,v)=>v instanceof Uint8Array?'binary-metadata-reference':v));
const shearRegion=(p:Project)=>p.template.pages[0].regions.find((r):r is TextRegion=>r.kind==='text'&&r.sourceLayout?.version===4)!;
const approve=(p:Project)=>approveTemplate(p,p.template.warnings.map(w=>w.id));
const rehash=(p:Project)=>{for(const r of p.template.pages[0].regions)if('sourceScopedPaint'in r&&r.sourceScopedPaint)r.sourceScopedPaint.stateHash=sourceScopedStateHash(r,p.template.sourceFonts!);return p;};
it.each([false,true])('preserves exact sheared outlines, original factors and durable ownership (single show %s)',async single=>{
 const f=await fixture(single),r=shearRegion(f.project),g=r.sourceLayout!;expect(f.project.template.importerVersion).toBe('folio-import-v17');expect(g.version).toBe(4);if(g.version!==4)throw Error();expect(g.shearX).toBe(.25);expect(g.editPolicy).toBe('baselineOnly');expect(Array.from(sourceGlyphs(r)).map(g=>g.x)).toEqual(expect.arrayContaining([40]));for(const [i,glyph]of Array.from(sourceGlyphs(r)).entries())expect(glyph.x).toBeCloseTo(f.knownOrigins[i],7);
 const proof=await validateSourceScopedPaint(f.original,f.project.template,[],true,true);expect(proof?.groupedCaptures?.size).toBe(1);expect(proof?.get(r.id)?.decomposition.ctm).toEqual([1,0,0,-1,0,700]);expect(proof?.get(r.id)?.decomposition.linearTextMatrix).toEqual([1,0,.25,-1]);
 const baseline=await renderProjectDocument(f.project,'baselinePreview');expect(baseline.layout.overflows).toEqual([]);const approved=await approve(f.project);expect(sourceWordingTargets(approved).some(v=>v.id===r.id)).toBe(false);
 const ordinary=sourceWordingTargets(approved)[0];expect(ordinary).toBeDefined();const block=approved.draft.blocks.find(b=>b.id===ordinary.contentId)!,current=editBlock(approved,ordinary.contentId,[{...block.runs[0],text:'ba ab'}]),rendered=await renderProjectDocument(current,'current');expect(rendered.layout.overflows).toEqual([]);
 await saveProject(current);const stored=(await loadProjects()).find(p=>p.id===current.id)!;expect(stored.template).toEqual(current.template);const restored=await restoreProject(new File([await backupProject(current)],'authored-shear.zip'));expect(restored.approval).toBeNull();expect(restored.template).toEqual(current.template);const portable=await renderProjectDocument(await approve(restored),'current');expect(portable.bytes).toEqual(rendered.bytes);
 const meta=metadata(current);expect(unpackRecordMetadata(packRecordMetadata(meta))).toEqual(meta);await expect(renderDocument(current.template,current.draft,[])).rejects.toMatchObject({code:'SOURCE_FONT_REUSE_REQUIRED'});
 if(process.env.FOLIO_SHEAR_ORACLE_DIR){const out=process.env.FOLIO_SHEAR_ORACLE_DIR+'/'+(single?'single':'resets');await mkdir(out,{recursive:true});await writeFile(out+'/source.pdf',f.original);await writeFile(out+'/baseline.pdf',baseline.bytes);await writeFile(out+'/current.pdf',rendered.bytes);await writeFile(out+'/portable.pdf',portable.bytes);const d=await PDFDocument.load(f.original),start=f.source.indexOf('<'),end=f.source.indexOf('ET'),body=f.source.slice(start,end),reference=f.source.slice(0,start)+'<'+Array.from('ba ab',f.hex).join('')+'> Tj\n'+body.replace(/<[^>]+> Tj\n/g,'')+f.source.slice(end);d.getPages()[0].node.set(PDFName.of('Contents'),d.context.register(d.context.flateStream(reference)));await writeFile(out+'/independent-current.pdf',await d.save());}
});
it.each(['wording','delete','marks','links'] as const)('refuses changed sheared %s',async kind=>{const f=await fixture(false),p=await approve(f.project),r=shearRegion(p),b=p.draft.blocks.find(b=>b.id===r.contentId)!;let q=p;if(kind==='delete'){q=structuredClone(p);q.draft.blocks=q.draft.blocks.filter(b=>b.id!==r.contentId);}else q=editBlock(p,r.contentId,[{...b.runs[0],...(kind==='wording'?{text:'Agyj'}:kind==='marks'?{underline:true}:{href:'https://example.com'})}]);await expect(renderProjectDocument(q,'current')).rejects.toThrow();});
it.each(['shear','downgrade','geometry','primitive','operator','font'] as const)('refuses self-rehashed saved %s mutation',async kind=>{const{original,project}=await fixture(false),q=structuredClone(project),r=shearRegion(q),l=r.sourceLayout!;if(l.version!==4)throw Error();if(kind==='shear')l.shearX=.3;if(kind==='downgrade'){const{shearX:_,characterSpacing:__,editPolicy:___,...base}=l;r.sourceLayout={...base,version:1};q.template.importerVersion='folio-import-v16';}if(kind==='geometry')l.baseline+=1;if(kind==='primitive'){const primitive=q.template.pages[0].regions.find(r=>r.kind==='rectangle'&&r.fill==='#0000ff')!;primitive.bounds.x-=1;}if(kind==='operator')r.order+=1;if(kind==='font'){const f=q.template.sourceFonts![0];if(!('originalProgram'in f)||!f.originalProgram)throw Error();f.originalProgram.pdfFontRef='999 0 R';}rehash(q);await expect(renderProjectDocument(q,'baselinePreview')).rejects.toThrow();});
it('refuses forged/sparse/unknown V4 transport fields and out-of-bounds shear',async()=>{const {project}=await fixture(true);for(const change of [(l:any)=>l.shearX=0,(l:any)=>l.shearX=Infinity,(l:any)=>l.shearX=1.001,(l:any)=>delete l.shearX,(l:any)=>l.editPolicy='scalarCovered',(l:any)=>l.unknown=1,(l:any)=>delete l.glyphs[0]]){const q=metadata(project);change(shearRegion(q).sourceLayout);expect(()=>packRecordMetadata(q)).toThrow();}const q=metadata(project);shearRegion(q).sourceLayout!.version=3;expect(()=>packRecordMetadata(q)).toThrow();});

it('holds the original shear and source snapshot before its first await',async()=>{const {project}=await fixture(true),baseline=await renderProjectDocument(project,'baselinePreview'),pending=renderProjectDocument(project,'baselinePreview'),l=shearRegion(project).sourceLayout!;if(l.version!==4)throw Error();l.shearX=.5;project.source.bytes[0]^=1;project.baseline.blocks[0].runs[0].text='substitution';expect((await pending).bytes).toEqual(baseline.bytes);await expect(renderProjectDocument(project,'baselinePreview')).rejects.toThrow();});
