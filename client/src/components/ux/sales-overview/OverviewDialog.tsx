import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

export const overviewButton = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40';
export const overviewPanel = 'min-w-0 rounded-xl border border-border/60 bg-card text-card-foreground';

const activeDialogs = new Set<HTMLDialogElement>();
let originalBodyOverflow = '';

/** Native modal: the browser provides focus trapping, inert background and Escape. */
export function OverviewDialog({ title, description, children, onClose, role = 'dialog' }: {
  title: string; description?: string; children: ReactNode; onClose: () => void; role?: 'dialog' | 'alertdialog';
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    if (!dialog) return;
    if (!activeDialogs.size) originalBodyOverflow = document.body.style.overflow;
    activeDialogs.add(dialog);
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      activeDialogs.delete(dialog);
      if (!activeDialogs.size) document.body.style.overflow = originalBodyOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return createPortal(
    <dialog ref={ref} role={role} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl overflow-auto rounded-2xl border border-border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-card p-5 sm:p-6">
        <div><h2 id={titleId} className="text-lg font-semibold tracking-tight">{title}</h2>
          {description ? <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p> : null}</div>
        <button type="button" className={`${overviewButton} shrink-0`} onClick={onClose} aria-label={t('close')}><X className="size-5" aria-hidden="true" /></button>
      </header>
      <div className="space-y-5 p-5 sm:p-6">{children}</div>
    </dialog>, document.body,
  );
}
