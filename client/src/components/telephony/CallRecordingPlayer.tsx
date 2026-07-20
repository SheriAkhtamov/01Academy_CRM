import { useState } from 'react';
import { Headphones, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { apiRequest } from '@/lib/queryClient';
import { translations, type TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function CallRecordingPlayer({
  callId,
  hasRecording,
  className,
}: {
  callId: number;
  hasRecording: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  if (!hasRecording) return null;

  const loadRecording = async () => {
    setIsLoading(true);
    try {
      const result = await apiRequest('GET', `/api/telephony/calls/${callId}/recording`) as { url: string };
      setUrl(result.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'onlinePbxRecordingUnavailable';
      toast({
        title: t('telephonyRecordingUnavailable'),
        description: message in translations
          ? t(message as TranslationKey)
          : t('telephonyRecordingUnavailable'),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!url) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn('h-8 gap-1.5 px-2 text-xs', className)}
        disabled={isLoading}
        onClick={() => void loadRecording()}
      >
        {isLoading ? <Loader2 className="animate-spin" /> : <Headphones />}
        {isLoading ? t('loading') : t('telephonyPlayRecording')}
      </Button>
    );
  }

  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <audio src={url} controls autoPlay className="h-9 min-w-0 max-w-72 flex-1" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        onClick={() => setUrl(null)}
        aria-label={t('close')}
      >
        <X />
      </Button>
    </div>
  );
}
