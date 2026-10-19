import type { DOMAttributes, SyntheticEvent } from 'react';

const processingControl = 'button, a, input, textarea, select, label, [role="combobox"], [role="checkbox"], [role="radio"]';

/** Stop processing before a control changes state or opens a portalled editor. */
export function leadProcessingGuard(required: boolean, requestClaim: () => void): DOMAttributes<HTMLElement> {
  const intercept = (event: SyntheticEvent<HTMLElement>) => {
    if (!required || event.defaultPrevented || !(event.target instanceof Element)) return;
    if (event.target.closest('[role="dialog"], [role="alertdialog"]') !== event.currentTarget) return;
    const control = event.type === 'submit' ? event.target : event.target.closest(processingControl);
    if (!control?.closest('[data-lead-processing]')) return;
    // Radix synchronizes its hidden native selects when form values hydrate.
    // These are not user attempts to edit the visible combobox.
    if (control instanceof HTMLSelectElement && control.getAttribute('aria-hidden') === 'true') return;
    event.preventDefault();
    event.stopPropagation();
    requestClaim();
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
