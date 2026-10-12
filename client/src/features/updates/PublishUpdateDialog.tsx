import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { updatesApi, updateQueryKeys } from './api';
import type { PublishUpdateCommand } from '@shared/contracts/platform-updates';
import { allowNavigation } from '@/lib/navigationGuard';

type Draft = { title: string; summary: string; body: string };
const emptyDraft = (): Record<'ru' | 'en', Draft> => ({ ru: { title: '', summary: '', body: '' }, en: { title: '', summary: '', body: '' } });
export function PublishUpdateDialog({ onClose, onPublished }: { onClose: () => void; onPublished: (id: number) => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [draft, setDraft] = useState(emptyDraft);
  const [publicationKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const publish = useMutation({
    mutationFn: updatesApi.publish,
    onSuccess: async (post) => {
      toast({ title: t('updatesPublished') });
      await Promise.all([client.invalidateQueries({ queryKey: updateQueryKeys.all }), client.invalidateQueries({ queryKey: ['/api/notifications'] })]);
      allowNavigation(() => onPublished(post.id));
    },
    onError: (failure: Error) => setError(failure.message),
  });
  const guard = useUnsavedChangesGuard({ open: true,
    isDirty: Object.values(draft).some((value) => Object.values(value).some(Boolean)),
    isPending: publish.isPending, onOpenChange: (open) => { if (!open) onClose(); } });
  const submit = () => {
    if (Object.values(draft).some((value) => !value.title.trim() || !value.summary.trim() || !value.body.trim())) {
      setError(t('updatesInvalidContent')); return;
    }
    const command: PublishUpdateCommand = { publicationKey, content: {
      title: { ru: draft.ru.title, en: draft.en.title }, summary: { ru: draft.ru.summary, en: draft.en.summary },
      sections: [{ paragraphs: [{ ru: draft.ru.body, en: draft.en.body }], items: [] }],
    } };
    setError(''); publish.mutate(command);
  };
  return <>
    <Dialog open onOpenChange={guard.handleOpenChange}>
      <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col overflow-hidden">
        <DialogHeader><DialogTitle>{t('updatesNewPost')}</DialogTitle></DialogHeader>
        <Tabs defaultValue="ru" className="min-h-0 overflow-y-auto">
          <TabsList><TabsTrigger value="ru">{t('updatesRussian')}</TabsTrigger><TabsTrigger value="en">{t('updatesEnglish')}</TabsTrigger></TabsList>
          {(['ru', 'en'] as const).map((language) => <TabsContent key={language} value={language} className="space-y-4">
            <div className="space-y-2"><Label htmlFor={`update-title-${language}`}>{t('updatesTitle')}</Label>
              <Input id={`update-title-${language}`} disabled={publish.isPending} maxLength={200} value={draft[language].title}
                onChange={(event) => setDraft((value) => ({ ...value, [language]: { ...value[language], title: event.target.value } }))} /></div>
            <div className="space-y-2"><Label htmlFor={`update-summary-${language}`}>{t('updatesSummary')}</Label>
              <Textarea id={`update-summary-${language}`} disabled={publish.isPending} maxLength={600} value={draft[language].summary}
                onChange={(event) => setDraft((value) => ({ ...value, [language]: { ...value[language], summary: event.target.value } }))} /></div>
            <div className="space-y-2"><Label htmlFor={`update-body-${language}`}>{t('updatesBody')}</Label>
              <Textarea id={`update-body-${language}`} disabled={publish.isPending} maxLength={5000} rows={9} value={draft[language].body}
                onChange={(event) => setDraft((value) => ({ ...value, [language]: { ...value[language], body: event.target.value } }))} /></div>
          </TabsContent>)}
        </Tabs>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex shrink-0 justify-end gap-2 border-t pt-4">
          <Button variant="outline" disabled={publish.isPending} onClick={() => guard.handleOpenChange(false)}>{t('cancel')}</Button>
          <Button disabled={publish.isPending} onClick={submit}>{publish.isPending ? t('saving') : t('updatesPublish')}</Button>
        </div>
      </DialogContent>
    </Dialog>
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
  </>;
}
