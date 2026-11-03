import { describe, expect, it } from 'vitest';
import { renderDocxReference } from './docxReference';
import { safeHref } from '../core/model';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
async function styledDocx(color: string) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Synthetic"/></w:pPr><w:r><w:t>Fictional security canary</w:t></w:r></w:p></w:body></w:document>');
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  const escaped = color.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  zip.file('word/styles.xml', `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Synthetic"><w:rPr><w:color w:val="${escaped}"/></w:rPr></w:style></w:styles>`);
  return zip.generateAsync({type:'uint8array'});
}
describe('independent synthetic security probes', () => {
  it('rejects untrusted executable hyperlink schemes and credentials', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,synthetic', 'file:///tmp/synthetic', '//invalid.example/synthetic', 'https://user:password@invalid.example/', 'https://invalid.example/\nsynthetic']) expect(safeHref(value)).toBeUndefined();
    expect(safeHref('mailto:fictional@example.com')).toBe('mailto:fictional@example.com');
    expect(safeHref('tel:+1-555-0102')).toBe('tel:+1-555-0102');
    expect(safeHref('tel:+15550102;ext=1')).toBe('tel:+15550102;ext=1');
    expect(safeHref('TEL:+15550102;EXT=12')).toBe('TEL:+15550102;EXT=12');
    for (const value of ['tel:..-', 'tel:+12', 'tel:+15550102;ext=', 'tel:+15550102;ext=1;ext=2', 'tel:+15550102;isub=1', 'tel:+15550102;ext=1?subject=x', 'tel:+15550102?subject=x', 'tel:%2B15550102', 'tel:+15550102%3Bext%3D1', 'tel:+15550102;ext=abc', 'tel:+15550102;ext=123456789012345678901']) expect(safeHref(value)).toBeUndefined();
  });
  it('does not attach escaped network CSS from an OOXML style color', async () => {
    const dom = new JSDOM('<div id="target"></div>');
    Object.assign(globalThis, {document: dom.window.document, window: dom.window, Node: dom.window.Node, HTMLElement: dom.window.HTMLElement, DOMParser: dom.window.DOMParser, XMLSerializer: dom.window.XMLSerializer});
    const target = document.querySelector('#target') as HTMLElement;
    await renderDocxReference(await styledDocx(String.raw`000000; background-image:u\72l(/synthetic-security-canary.png)`), target);
    expect(target.textContent).toContain('Fictional security canary');
    expect(target.innerHTML).not.toContain('synthetic-security-canary');
    dom.window.close();
  });
  it('does not attach a global UI-hiding selector from an OOXML style color', async () => {
    const dom = new JSDOM('<div id="target"></div>');
    Object.assign(globalThis, {document: dom.window.document, window: dom.window, Node: dom.window.Node, HTMLElement: dom.window.HTMLElement, DOMParser: dom.window.DOMParser, XMLSerializer: dom.window.XMLSerializer});
    const target = document.querySelector('#target') as HTMLElement;
    await renderDocxReference(await styledDocx('000000; } body { display:none; } /*'), target);
    expect(target.innerHTML).not.toContain('body { display:none; }');
    dom.window.close();
  });
});
