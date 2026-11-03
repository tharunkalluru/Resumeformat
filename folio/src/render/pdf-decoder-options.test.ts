import {describe,it,expect} from 'vitest';
import {resolvePdfAssetBase,localPdfDecoderOptions} from './pdf-decoder-options';
describe('decoder asset authority across the worker boundary',()=>{
 it.each([
  ['./','http://127.0.0.1:4387/','http://127.0.0.1:4387/'],
  ['./','https://example.test/folio/','https://example.test/folio/'],
  ['/folio/','https://example.test/folio/resume','https://example.test/folio/'],
 ])('keeps %s assets rooted in the document %s',(base,page,expected)=>{
  const url=resolvePdfAssetBase(base,page)+'pdfjs/wasm/qcms_bg.wasm';
  expect(new URL(url,new URL('assets/pdf.worker.mjs',page)).href).toBe(expected+'pdfjs/wasm/qcms_bg.wasm');
 });
 it('retains filesystem decoder resources for the Node validation harness',()=>{
  expect(localPdfDecoderOptions().wasmUrl).toBe(`${process.cwd()}/public/pdfjs/wasm/`);
 });
});
