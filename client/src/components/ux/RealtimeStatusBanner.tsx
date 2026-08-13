import { AnimatePresence, motion } from 'framer-motion';
import { WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { TRANSITION } from '@/lib/motion';
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

  return (
    // The banner pushes the page down as it grows in and lets it back up as it
    // leaves, instead of the whole layout jumping by 38px the moment the socket
    // drops or recovers.
    <AnimatePresence initial={false}>
      {status === 'disconnected' && (
        <motion.div
          role="status"
          className="overflow-hidden border-b border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-100"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={TRANSITION.base}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-sm md:px-6">
            <WifiOff className="size-4 shrink-0 animate-pulse" aria-hidden="true" />
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
        </motion.div>
      )}
    </AnimatePresence>
  );
}
