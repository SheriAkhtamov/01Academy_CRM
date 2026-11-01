import type { DOMAttributes, KeyboardEvent, SyntheticEvent } from 'react';

const processingControl = 'button, a, input, textarea, select, label, [role="combobox"], [role="checkbox"], [role="radio"]';

/** Stop processing before a control changes state or opens a portalled editor. */
export function leadProcessingGuard(required: boolean, requestClaim: () => void, language?: {
  required: boolean;
  hasDraft: boolean;
  requestSelection: () => void;
}): DOMAttributes<HTMLElement> {
  const intercept = (event: SyntheticEvent<HTMLElement>) => {
    if ((!required && !language?.required) || event.defaultPrevented || !(event.target instanceof Element)) return;
    if (event.target.closest('[role="dialog"], [role="alertdialog"]') !== event.currentTarget) return;
    const control = event.type === 'submit' ? event.target : event.target.closest(processingControl);
    if (!control?.closest('[data-lead-processing]')) return;
    // Radix synchronizes its hidden native selects when form values hydrate.
    // These are not user attempts to edit the visible combobox.
    if (control instanceof HTMLSelectElement && control.getAttribute('aria-hidden') === 'true') return;
    if (!required) {
      if (control.closest('[data-lead-language-field], [data-lead-language-optional]') || control.tagName === 'A') return;
      // Reading and moving focus are not processing. Keep a first call available
      // so the manager can learn which language the client speaks.
      if (event.type === 'focus' || (control.hasAttribute('aria-expanded') && !control.hasAttribute('aria-haspopup'))) return;
      const mainForm = control.closest('#lead-details-form') || control.getAttribute('form') === 'lead-details-form';
      if (mainForm && language?.hasDraft && !control.closest('[data-lead-language-immediate]')) return;
      const textEntry = control instanceof HTMLTextAreaElement
        || (control instanceof HTMLInputElement && !['checkbox', 'radio'].includes(control.type));
      if (textEntry && ['click', 'pointerdown'].includes(event.type)) return;
      if (event.type === 'keydown' && textEntry) {
        const { key, ctrlKey, metaKey } = event as KeyboardEvent<HTMLElement>;
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(key)) return;
        if ((ctrlKey || metaKey) && ['a', 'c'].includes(key.toLowerCase())) return;
      }
    }
    event.preventDefault();
    event.stopPropagation();
    if (required) requestClaim();
    else language?.requestSelection();
  };

  return {
    onClickCapture: intercept,
    onFocusCapture: intercept,
    onChangeCapture: intercept,
    onBeforeInputCapture: intercept,
    onPasteCapture: intercept,
    onSubmitCapture: intercept,
    onPointerDownCapture: event => { if (event.button === 0) intercept(event); },
    onKeyDownCapture: event => {
      if (!['Tab', 'Escape', 'Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) intercept(event);
    },
  };
}
