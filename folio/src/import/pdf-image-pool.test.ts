import {describe,it,expect,vi} from 'vitest';
import type {PDFPageProxy} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {extractOwnedPdfImage} from './pdf-images';
const image={width:1,height:1,kind:3,data:new Uint8Array([17,31,47,255])};
describe('owned decoder image pools',()=>{
 it.each(['g_shared_image','img_local_image'])('resolves %s exclusively from its decoder-owned pool',async id=>{
  const local=vi.fn((_id:string,resolve:(value:unknown)=>void)=>resolve(image));
  const shared=vi.fn((_id:string,resolve:(value:unknown)=>void)=>resolve(image));
  const page={objs:{get:local},commonObjs:{get:shared}} as unknown as PDFPageProxy;
  const actual=await extractOwnedPdfImage(page,id);
  expect(actual?.rgba).toEqual(image.data);expect(actual?.width).toBe(1);expect(actual?.height).toBe(1);
  expect(id.startsWith('g_')?shared:local).toHaveBeenCalledWith(id,expect.any(Function));
  expect(id.startsWith('g_')?local:shared).not.toHaveBeenCalled();
 });
 it('retains pixel admission bounds for shared resources',async()=>{
  const page={objs:{get:vi.fn()},commonObjs:{get:(_id:string,resolve:(value:unknown)=>void)=>resolve({...image,width:20000001})}} as unknown as PDFPageProxy;
  expect(await extractOwnedPdfImage(page,'g_shared_image')).toBeUndefined();
 });
});
