import { useEffect, useRef } from 'react';

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

const isTypingTarget = (target: EventTarget | null) => (
  target instanceof HTMLElement && (EDITABLE_TAGS.has(target.tagName) || target.isContentEditable)
);

/** Anything that owns the keyboard while it is open: dialogs, drawers, menus, open selects. */
const OVERLAY_SELECTOR = '[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"],[role="menu"],[role="listbox"]';

/**
 * "/" jumps to the search and "N" opens a new group, the two things a manager
 * does on this page dozens of times a day. `event.code` keeps both on the same
 * physical keys under a Cyrillic layout, where "/" types "." and "N" types "т".
 */
export function useGroupsShortcuts({ onFocusSearch, onCreate }: {
  onFocusSearch: () => void;
  onCreate: () => void;
}) {
  const handlers = useRef({ onFocusSearch, onCreate });
  handlers.current = { onFocusSearch, onCreate };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target) || document.querySelector(OVERLAY_SELECTOR)) return;
      if (event.code === 'Slash' || event.key === '/') {
        event.preventDefault();
        handlers.current.onFocusSearch();
      } else if (event.code === 'KeyN' && !event.shiftKey) {
        event.preventDefault();
        handlers.current.onCreate();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
