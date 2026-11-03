type NativeSelection = Pick<Selection, 'anchorNode' | 'focusNode'>;
type NativeInputRange = Pick<StaticRange, 'startContainer' | 'endContainer'>;

/** Native input must belong to one controlled text region, including its target range. */
export function nativeInputRegion(root: HTMLElement, selection: NativeSelection | null, ranges: readonly NativeInputRange[] = []): string | null {
  const owner = (node: Node | null): string | null => {
    if (!node || !root.contains(node)) return null;
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    const content = element?.closest<HTMLElement>('.folio-region-content');
    if (!content || !root.contains(content)) return null;
    return content.closest<HTMLElement>('.folio-region[data-region-id]')?.dataset.regionId || null;
  };
  const id = owner(selection?.anchorNode ?? null);
  if (!id || owner(selection?.focusNode ?? null) !== id) return null;
  if (ranges.some(range => owner(range.startContainer) !== id || owner(range.endContainer) !== id)) return null;
  return id;
}
