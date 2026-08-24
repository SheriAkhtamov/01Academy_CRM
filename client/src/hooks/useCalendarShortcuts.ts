import { useEffect, type RefObject } from 'react';

interface CalendarShortcuts {
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  onView?: (index: number) => void;
  enabled?: boolean;
  /**
   * When the calendar shares a page with other content, shortcuts only fire
   * while focus is inside it — otherwise pressing an arrow anywhere on a
   * settings screen would silently reschedule the day being looked at.
   */
  scopeRef?: RefObject<HTMLElement | null>;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return EDITABLE_TAGS.has(target.tagName) || target.isContentEditable;
};

/**
 * Arrow keys move the calendar the way they move a spreadsheet, and the digits
 * pick a view. `event.code` rather than `event.key` so the shortcuts keep
 * working on a Cyrillic keyboard layout, where the same physical key reports
 * a different character.
 */
export function useCalendarShortcuts({
  onPrevious,
  onNext,
  onToday,
  onView,
  enabled = true,
  scopeRef,
}: CalendarShortcuts) {
  useEffect(() => {
    if (!enabled) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const scope = scopeRef?.current;
      if (scope && !scope.contains(document.activeElement)) return;
      // A dialog, sheet or dropdown owns the keyboard while it is open.
      if (document.querySelector('[role="dialog"][aria-modal="true"],[role="menu"],[role="listbox"]')) return;

      const viewIndex = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(event.code);
      if (viewIndex >= 0 && onView) {
        event.preventDefault();
        onView(viewIndex);
        return;
      }

      if (event.code === 'ArrowLeft') {
        event.preventDefault();
        onPrevious();
      } else if (event.code === 'ArrowRight') {
        event.preventDefault();
        onNext();
      } else if (event.code === 'KeyT') {
        event.preventDefault();
        onToday();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onNext, onPrevious, onToday, onView, scopeRef]);
}
