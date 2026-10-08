import { useEffect, useRef } from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';

export interface AttendanceNotice {
  id: number;
  translationKey: TranslationKey;
  tone: 'error' | 'info';
  retry?: boolean;
  /** Fills `{name}` in the message. */
  name?: string;
}

interface Props {
  notice: AttendanceNotice | null;
  onDismiss: () => void;
  onRetry: () => void;
}

const VISIBLE_MS = { error: 7_000, info: 4_000 };

/*
  Messages about saving appear at the bottom of the screen, over whatever row
  the visitor is looking at, rather than above the list where a phone would
  have scrolled them out of sight. One message at a time; a newer one replaces
  the older. The row that failed keeps its own "not saved" line after this
  disappears.

  Both live regions stay mounted and only their content changes, so a screen
  reader announces each message the moment it appears.
*/
export function AttendanceSnackbar({ notice, onDismiss, onRetry }: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(onDismiss, VISIBLE_MS[notice.tone]);
    // A passing note gets out of the way as soon as the visitor touches anything else.
    const dismissOutside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onDismiss(); };
    if (notice.tone === 'info') document.addEventListener('pointerdown', dismissOutside);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', dismissOutside);
    };
  }, [notice, onDismiss]);
  const Icon = notice?.tone === 'error' ? AlertTriangle : Info;
  const body = notice ? (
    <div ref={ref} className={`pa-snackbar is-${notice.tone}`}>
      <Icon className="pa-snackbar-icon" aria-hidden="true" />
      <p>{t(notice.translationKey).replace('{name}', notice.name ?? '')}</p>
      {notice.retry ? <button type="button" className="pa-snackbar-action" onClick={() => { onRetry(); onDismiss(); }}>{t('retry')}</button> : null}
      <button type="button" className="pa-snackbar-close" aria-label={t('close')} onClick={onDismiss}><X aria-hidden="true" /></button>
    </div>
  ) : null;
  return (
    <>
      <div role="status">{notice?.tone === 'info' ? body : null}</div>
      <div role="alert">{notice?.tone === 'error' ? body : null}</div>
    </>
  );
}
