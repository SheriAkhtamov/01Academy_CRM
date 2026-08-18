import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, NotebookPen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { translations, type TranslationKey } from '@/lib/i18n';
import { telephonyApi, telephonyQueryKeys } from '@/features/telephony/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/**
 * The note belongs to one conversation, so it is written where the manager is
 * still looking at that conversation — on the call that just ended, or on its
 * row in the history — rather than sending them off to the lead card.
 */
export function CallNoteEditor({
  callId,
  note,
  autoFocus,
  className,
  onSaved,
}: {
  callId: number;
  note: string | null;
  autoFocus?: boolean;
  className?: string;
  onSaved?: (note: string | null) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(note ?? '');

  useEffect(() => {
    setDraft(note ?? '');
  }, [callId, note]);

  const saveNote = useMutation({
    mutationFn: () => telephonyApi.saveCallNote(callId, draft.trim() || null),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: telephonyQueryKeys.calls });
      toast({ title: t('telephonyNoteSaved') });
      onSaved?.(saved.note);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'telephonyNoteFailed';
      toast({
        title: t('telephonyNoteFailed'),
        description: message in translations ? t(message as TranslationKey) : undefined,
        variant: 'destructive',
      });
    },
  });

  const isUnchanged = draft.trim() === (note ?? '').trim();

  return (
    <div className={cn('space-y-2 text-left', className)} data-no-drag>
      <Textarea
        value={draft}
        autoFocus={autoFocus}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !isUnchanged) {
            event.preventDefault();
            saveNote.mutate();
          }
        }}
        rows={3}
        maxLength={2_000}
        placeholder={t('telephonyNotePlaceholder')}
        aria-label={t('telephonyNote')}
        className="min-h-[68px] resize-none text-sm"
      />
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          className="h-8"
          disabled={isUnchanged || saveNote.isPending}
          onClick={() => saveNote.mutate()}
        >
          {saveNote.isPending ? <Loader2 className="animate-spin" /> : <NotebookPen />}
          {t('telephonyNote')}
        </Button>
      </div>
    </div>
  );
}
