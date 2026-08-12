import type { KeyboardEvent } from 'react';

/**
 * Enter inside a single-line field should trigger the surrounding dialog's
 * primary action. Several dialog bodies are plain `<div>`s rather than
 * `<form>` elements, so the browser gives them no implicit submission and the
 * key is simply inert — the user types a reason, presses Enter, and nothing
 * happens.
 *
 * Attach to the input rather than converting the dialog to a form: the footer
 * buttons carry no explicit `type`, so a `<form>` would silently promote every
 * one of them (including Cancel) to a submit button.
 *
 * Never attach this to a `<textarea>`, where Enter must insert a newline.
 */
export function submitOnEnter(
  submit: () => void,
  options: { disabled?: boolean } = {},
) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    // An IME candidate window uses Enter to accept a suggestion; committing the
    // dialog underneath it would discard what the user is still typing.
    if (event.nativeEvent.isComposing) return;
    if (options.disabled) return;
    event.preventDefault();
    submit();
  };
}
