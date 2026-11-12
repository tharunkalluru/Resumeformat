import { useEffect, type RefObject } from 'react';

/** Closes an open <details> menu on Escape or a press outside it. */
export function useMenuDismiss(menu: RefObject<HTMLDetailsElement | null>, onClose?: () => void) {
  useEffect(() => {
    const close = () => { if (menu.current?.open) { menu.current.removeAttribute('open'); onClose?.(); } };
    const onPress = (event: PointerEvent) => { if (menu.current?.open && !menu.current.contains(event.target as Node)) close(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && menu.current?.open) { close(); menu.current.querySelector('summary')?.focus(); } };
    document.addEventListener('pointerdown', onPress); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPress); document.removeEventListener('keydown', onKey); };
  }, [menu, onClose]);
}
