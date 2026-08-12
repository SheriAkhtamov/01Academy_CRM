import { WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import type { RealtimeStatus } from '@/hooks/useWebSocket';

interface RealtimeStatusBannerProps {
  status: RealtimeStatus;
  onReconnect: () => void;
}

/**
 * Shown only once the socket has exhausted its retry budget. Until then the
 * hook is still backing off and a banner would flap on every brief blip.
 */
export function RealtimeStatusBanner({ status, onReconnect }: RealtimeStatusBannerProps) {
  const { t } = useTranslation();

  if (status !== 'disconnected') return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-900 md:px-6 dark:text-amber-100"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden="true" />
      <span className="font-medium">{t('realtimeDisconnectedTitle')}</span>
      <span className="min-w-0 text-xs text-amber-900/80 dark:text-amber-100/80">
        {t('realtimeDisconnectedDescription')}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="ml-auto h-7 bg-background"
        onClick={onReconnect}
      >
        {t('realtimeReconnect')}
      </Button>
    </div>
  );
}
