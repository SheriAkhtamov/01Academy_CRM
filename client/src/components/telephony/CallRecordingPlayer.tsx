import { useEffect, useId, useRef, useState } from 'react';
import { Headphones, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { telephonyApi } from '@/features/telephony/api';
import { translations, type TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { OrbitSpinner } from '@/components/ui/orbit-spinner';

type CallRecordingPlayerProps = {
  hasRecording: boolean;
  className?: string;
} & (
  | { callId: number; voiceReminderCallId?: never }
  | { callId?: never; voiceReminderCallId: string }
);

export function CallRecordingPlayer({
  callId,
  voiceReminderCallId,
  hasRecording,
  className,
}: CallRecordingPlayerProps) {
  const { t } = useTranslation();
  const playerId = useId();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const requestSequenceRef = useRef(0);
  const [isLoading, setIsLoading] = useState(false);
  const [recording, setRecording] = useState<{ identity: string; url: string } | null>(null);
  const recordingIdentity = voiceReminderCallId !== undefined ? `reminder:${voiceReminderCallId}` : `call:${callId}`;
  const url = recording?.identity === recordingIdentity ? recording.url : null;

  useEffect(() => {
    requestSequenceRef.current += 1;
    setRecording(null);
    setIsLoading(false);
    return () => {
      requestSequenceRef.current += 1;
    };
  }, [recordingIdentity, hasRecording]);

  useEffect(() => {
    const pauseForForeignPlayback = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      if (!detail || detail.id === playerId) return;
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
      }
    };
    window.addEventListener('crm:recording-play', pauseForForeignPlayback);
    return () => window.removeEventListener('crm:recording-play', pauseForForeignPlayback);
  }, [playerId]);

  useEffect(() => {
    if (!url) return undefined;
    const audio = audioRef.current;
    window.dispatchEvent(new CustomEvent('crm:recording-play', { detail: { id: playerId } }));
    return () => audio?.pause();
  }, [url, playerId]);

  if (!hasRecording) return null;

  const loadRecording = async () => {
    const sequence = ++requestSequenceRef.current;
    setIsLoading(true);
    try {
      const result = voiceReminderCallId !== undefined
        ? await telephonyApi.getReminderRecordingUrl(voiceReminderCallId)
        : await telephonyApi.getRecordingUrl(callId);
      if (requestSequenceRef.current !== sequence) return;
      setRecording({ identity: recordingIdentity, url: result.url });
    } catch (error) {
      if (requestSequenceRef.current !== sequence) return;
      const message = error instanceof Error ? error.message : 'onlinePbxRecordingUnavailable';
      toast({
        title: t('telephonyRecordingUnavailable'),
        description: message in translations ? t(message as TranslationKey) : undefined,
        variant: 'destructive',
      });
    } finally {
      if (requestSequenceRef.current === sequence) setIsLoading(false);
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
        {isLoading ? <OrbitSpinner className="" /> : <Headphones />}
        {isLoading ? t('loading') : t('telephonyPlayRecording')}
      </Button>
    );
  }

  const handlePlaybackError = () => {
    setRecording(null);
    toast({ title: t('telephonyRecordingUnavailable'), variant: 'destructive' });
  };

  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <audio
        ref={audioRef}
        src={url}
        controls
        autoPlay
        className="h-9 min-w-0 max-w-72 flex-1"
        onError={handlePlaybackError}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        onClick={() => setRecording(null)}
        aria-label={t('close')}
      >
        <X />
      </Button>
    </div>
  );
}
