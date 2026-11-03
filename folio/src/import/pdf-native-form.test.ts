import {it,expect} from 'vitest';
import {PDFDocument,PDFDict,PDFName,PDFRawStream} from 'pdf-lib';
import {captureNativeVectorForm,installNativeVectorForm} from './pdf-native-form';

async function fixture(raw='q 2 0 0 2 0 0 cm /Shared gs 0 0 40 40 re f Q') {
 const d=await PDFDocument.create(),child=d.context.obj({ca:1,BM:PDFName.of('Normal')}),parent=d.context.obj({ca:.3,BM:PDFName.of('Normal')}),stream=d.context.stream(raw,{Type:PDFName.of('XObject'),Subtype:PDFName.of('Form'),BBox:[0,0,30,30],Matrix:[1,0,0,1,5,7],Group:{Type:PDFName.of('Group'),S:PDFName.of('Transparency'),I:true},Resources:{ExtGState:{Shared:d.context.register(child)}}}),ref=d.context.register(stream),resources=d.context.obj({XObject:{Leaf:ref},ExtGState:{Shared:d.context.register(parent)}});
 return {d,stream,ref,resources,child,parent};
}
it('retains child resource shadowing, native group, exact bytes, BBox and Matrix',async()=>{
 const f=await fixture(),handle=captureNativeVectorForm(f.d,f.resources,'Leaf'),out=await PDFDocument.create(),ref=installNativeVectorForm(out,handle),s=out.context.lookup(ref) as PDFRawStream;
 expect(handle.pathPaints).toBe(1);expect(handle.isolated).toBe(true);expect(handle.bbox).toEqual([0,0,30,30]);expect(s.contents).toEqual(f.stream.contents);
 expect(s.dict.lookup(PDFName.of('Resources'),PDFDict).lookup(PDFName.of('ExtGState'),PDFDict).lookup(PDFName.of('Shared'),PDFDict).toString()).toContain('/ca 1');
 expect(s.dict.toString()).toContain('/BBox [ 0 0 30 30 ]');expect(s.dict.toString()).toContain('/Matrix [ 1 0 0 1 5 7 ]');
 // Public metadata and the original PDF are not mutable installation authority.
 (handle.bbox as number[])[0]=999;f.child.set(PDFName.of('ca'),f.d.context.obj(.2));f.stream.contents[0]=88;
 const second=out.context.lookup(installNativeVectorForm(out,handle)) as PDFRawStream;expect(second.contents).toEqual(s.contents);expect(second.dict.toString()).toContain('/BBox [ 0 0 30 30 ]');expect(second.dict.lookup(PDFName.of('Resources'),PDFDict).lookup(PDFName.of('ExtGState'),PDFDict).lookup(PDFName.of('Shared'),PDFDict).toString()).toContain('/ca 1');
 expect(()=>installNativeVectorForm(out,structuredClone(handle))).toThrow('unowned snapshot');
});
it.each(['wrong-ref','resource-shadow','matrix','bbox','group','cycle','stack','budget','state-font','mask','transform-budget'])('refuses unproved %s',async mode=>{
 const raw=mode==='cycle'?'/Leaf Do':mode==='stack'?'Q 0 0 5 5 re f':mode==='budget'?'q Q '.repeat(2050)+'0 0 5 5 re f':mode==='transform-budget'?'1000000 0 0 1000000 0 0 cm 1000000 0 0 1000000 0 0 cm 0 0 5 5 re f':undefined,f=await fixture(raw);
 if(mode==='wrong-ref')f.resources.lookup(PDFName.of('XObject'),PDFDict).set(PDFName.of('Leaf'),f.d.context.register(f.d.context.obj({})));
 if(mode==='resource-shadow')f.stream.dict.set(PDFName.of('Resources'),f.d.context.obj({}));
 if(mode==='matrix')f.stream.dict.set(PDFName.of('Matrix'),f.d.context.obj([0,0,0,0,0,0]));
 if(mode==='bbox')f.stream.dict.set(PDFName.of('BBox'),f.d.context.obj([30,0,0,30]));
 if(mode==='group')f.stream.dict.lookup(PDFName.of('Group'),PDFDict).set(PDFName.of('I'),f.d.context.obj(false));
 if(mode==='state-font')f.child.set(PDFName.of('Font'),f.d.context.obj([]));
 if(mode==='mask')f.child.set(PDFName.of('SMask'),f.d.context.obj({}));
 expect(()=>captureNativeVectorForm(f.d,f.resources,'Leaf')).toThrow();
});
it('fingerprints original changes to geometry and child resource values',async()=>{
 const f=await fixture(),a=captureNativeVectorForm(f.d,f.resources,'Leaf');f.stream.dict.set(PDFName.of('BBox'),f.d.context.obj([0,0,31,30]));const b=captureNativeVectorForm(f.d,f.resources,'Leaf');expect(a.fingerprint).not.toBe(b.fingerprint);f.child.set(PDFName.of('ca'),f.d.context.obj(.5));expect(captureNativeVectorForm(f.d,f.resources,'Leaf').fingerprint).not.toBe(b.fingerprint);
});
