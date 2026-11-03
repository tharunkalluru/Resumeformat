// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { nativeInputRegion } from './canvasInput';

let root: HTMLElement, a: Node, b: Node, decoration: Node;
beforeEach(() => {
  document.body.innerHTML = '<div id="editor"><div class="folio-region" data-region-id="a"><div class="folio-region-content"><p>abc</p></div></div><span id="decoration">rule</span><div class="folio-region" data-region-id="b"><div class="folio-region-content"><p>def</p></div></div></div><p id="outside">outside</p>';
  root = document.getElementById('editor')!;
  a = root.querySelector('[data-region-id="a"] p')!.firstChild!;
  b = root.querySelector('[data-region-id="b"] p')!.firstChild!;
  decoration = document.getElementById('decoration')!.firstChild!;
});

describe('native canvas input ownership', () => {
  it('permits a caret or same-region selection and its owned native target range', () => {
    expect(nativeInputRegion(root, {anchorNode:a,focusNode:a}, [{startContainer:a,endContainer:a}])).toBe('a');
    const content = root.querySelector('[data-region-id="a"] .folio-region-content')!;
    expect(nativeInputRegion(root, {anchorNode:content,focusNode:a})).toBe('a');
  });
  it('refuses outer-editor, decoration, outside-document and cross-region input', () => {
    for (const node of [root, decoration, document.getElementById('outside')!.firstChild!]) {
      expect(nativeInputRegion(root, {anchorNode:node,focusNode:node})).toBeNull();
    }
    expect(nativeInputRegion(root, {anchorNode:a,focusNode:b})).toBeNull();
    expect(nativeInputRegion(root, null)).toBeNull();
  });
  it('refuses a native deletion or replacement range that escapes the selected region', () => {
    for (const node of [root, b, decoration]) {
      expect(nativeInputRegion(root, {anchorNode:a,focusNode:a}, [{startContainer:a,endContainer:node}])).toBeNull();
    }
  });
});
