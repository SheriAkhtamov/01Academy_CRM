const REQUEST_EVENT = 'academy:error-shake';
const CONTROL = 'input:not([type="hidden"]), textarea, select, [role="combobox"], [role="checkbox"], [role="radiogroup"], [role="switch"]';
const INVALID = '[aria-invalid="true"], input:invalid, textarea:invalid, select:invalid';

/** Custom validation can request feedback for its visible control, including a proxy select. */
export function requestErrorShake(control: HTMLElement | null) {
  control?.dispatchEvent(new Event(REQUEST_EVENT, { bubbles: true }));
}

function available(control: HTMLElement) {
  if (!control.isConnected || !control.matches(CONTROL) || control.matches(':disabled, [readonly], [aria-disabled="true"]')) return false;
  if (control.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  for (let node: HTMLElement | null = control; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  }
  return true;
}

function invalid(control: HTMLElement) {
  return control.getAttribute('aria-invalid') === 'true'
    || (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) && !control.validity.valid;
}

/** One controller per document; portals keep their native DOM and form ownership. */
export function installErrorShake(doc: Document, canAnimate: () => boolean) {
  const active = new Map<HTMLElement, { timer: ReturnType<typeof setTimeout>; target: HTMLElement }>();
  const phases = new WeakMap<HTMLElement, boolean>();
  const pending = new Map<HTMLElement, boolean>();
  let editing = new WeakSet<HTMLElement>();
  let frame = 0;
  const regionFor = (control: HTMLElement) => (control as HTMLInputElement).form
    ?? control.closest('form, [role="dialog"], [role="alertdialog"]') ?? control.parentElement ?? control;
  const clear = (control: HTMLElement) => {
    const animation = active.get(control);
    clearTimeout(animation?.timer);
    active.delete(control);
    animation?.target.removeAttribute('data-error-shake');
  };
  const flush = () => {
    frame = 0;
    editing = new WeakSet();
    const regions = new Map<Element, HTMLElement>();
    const candidates = [...pending.entries()];
    pending.clear();
    if (!canAnimate()) return;
    for (const [control, forced] of candidates) {
      if (!available(control) || (!forced && !invalid(control))) continue;
      const region = regionFor(control);
      const first = regions.get(region);
      if (!first || control.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING) regions.set(region, control);
    }
    regions.forEach((control, region) => {
      for (const previous of active.keys()) if (previous !== control && regionFor(previous) === region) clear(previous);
      clear(control);
      const target = control.closest<HTMLElement>('[data-error-shake-control]') ?? control;
      const phase = !phases.get(target);
      phases.set(target, phase);
      // Alternating names restarts CSS animation without a forced layout or a remount.
      target.setAttribute('data-error-shake', phase ? 'a' : 'b');
      active.set(control, { target, timer: setTimeout(() => clear(control), 550) });
    });
  };
  const enqueue = (target: EventTarget | null, forced = false) => {
    if (!(target instanceof HTMLElement)) return;
    const control = target.matches(CONTROL) ? target : target.querySelector<HTMLElement>(CONTROL);
    if (!control) return;
    pending.set(control, forced || pending.get(control) || false);
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const onInvalid = (event: Event) => enqueue(event.target);
  const onRequest = (event: Event) => enqueue(event.target, true);
  const onSubmit = (event: Event) => {
    if (!(event.target instanceof HTMLFormElement)) return;
    // form.elements also includes controls associated through the form attribute.
    Array.from(event.target.elements).forEach((element) => {
      if (element.matches(INVALID)) enqueue(element);
    });
    event.target.querySelectorAll('[aria-invalid="true"]').forEach((element) => enqueue(element));
  };
  const onInput = (event: Event) => {
    if (!(event.target instanceof HTMLElement)) return;
    editing.add(event.target);
    if (!frame) frame = requestAnimationFrame(flush);
    if (active.has(event.target) && !invalid(event.target)) clear(event.target);
  };
  const onBlur = (event: Event) => {
    if (event.target instanceof HTMLElement && event.target.getAttribute('aria-invalid') === 'true') enqueue(event.target);
  };
  const observer = new MutationObserver((records) => {
    for (const control of active.keys()) if (!control.isConnected || !available(control)) clear(control);
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof HTMLElement) {
        const target = record.target;
        if (record.attributeName === 'aria-invalid') {
          if (target.getAttribute('aria-invalid') !== 'true') clear(target);
          else if (record.oldValue !== 'true' && !editing.has(target)) enqueue(target);
        } else if (!target.closest('[hidden], [inert], [aria-hidden="true"]')) {
          if (target.getAttribute('aria-invalid') === 'true') enqueue(target);
          target.querySelectorAll('[aria-invalid="true"]').forEach((element) => enqueue(element));
        }
      }
      if (record.type === 'childList') for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches('[aria-invalid="true"]')) enqueue(node);
        node.querySelectorAll('[aria-invalid="true"]').forEach((element) => enqueue(element));
      }
    }
  });
  observer.observe(doc.body, { subtree: true, childList: true, attributes: true,
    attributeOldValue: true, attributeFilter: ['aria-invalid', 'hidden'] });
  doc.addEventListener('invalid', onInvalid, true);
  doc.addEventListener('submit', onSubmit, true);
  doc.addEventListener('input', onInput, true);
  doc.addEventListener('focusout', onBlur, true);
  doc.addEventListener(REQUEST_EVENT, onRequest);
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    pending.clear();
    for (const control of active.keys()) clear(control);
    doc.removeEventListener('invalid', onInvalid, true);
    doc.removeEventListener('submit', onSubmit, true);
    doc.removeEventListener('input', onInput, true);
    doc.removeEventListener('focusout', onBlur, true);
    doc.removeEventListener(REQUEST_EVENT, onRequest);
  };
}
