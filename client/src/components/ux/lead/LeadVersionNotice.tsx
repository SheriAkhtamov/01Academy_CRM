import { useEffect, useRef } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';

export function LeadVersionNotice({ pending, onKeepDraft, onUseServer, values }: {
  pending: boolean;
  onKeepDraft: () => void;
  onUseServer: () => void;
  values: Array<{ label: string; value: string }>;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: 'nearest' }); }, []);
  return (
    <Alert ref={ref} className="mb-4" role="alert">
      <AlertTitle>{t('leadVersionReviewTitle')}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{t('leadVersionReviewDescription')}</p>
        <details>
          <summary className="cursor-pointer font-medium">{t('leadVersionServerValues')}</summary>
          <dl className="mt-2 space-y-1">
            {values.map(({ label, value }) => <div key={label} className="break-words"><dt className="inline font-medium">{label}: </dt><dd className="inline">{value || '—'}</dd></div>)}
          </dl>
        </details>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={onKeepDraft}>{t('leadRefreshKeepingDraft')}</Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={onUseServer}>{t('leadUseServerVersion')}</Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
