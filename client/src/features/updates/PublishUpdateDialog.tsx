import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Eye, ArrowUpRight } from 'lucide-react';
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
type TargetActionHref = '' | '/sales/groups' | '/admin/academy-settings?tab=groups';

const emptyDraft = (): Record<'ru' | 'en', Draft> => ({
  ru: { title: '', summary: '', body: '' },
  en: { title: '', summary: '', body: '' },
});

export function PublishUpdateDialog({ onClose, onPublished }: { onClose: () => void; onPublished: (id: number) => void }) {
  const { t, language: currentLanguage } = useTranslation();
  const client = useQueryClient();
  const [draft, setDraft] = useState(emptyDraft);
  const [targetAction, setTargetAction] = useState<TargetActionHref>('');
  const [previewLanguage, setPreviewLanguage] = useState<'ru' | 'en'>(currentLanguage === 'en' ? 'en' : 'ru');
  const [publicationKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');

  const publish = useMutation({
    mutationFn: updatesApi.publish,
    onSuccess: async (post) => {
      toast({ title: t('updatesPublished') });
      await Promise.all([
        client.invalidateQueries({ queryKey: updateQueryKeys.all }),
        client.invalidateQueries({ queryKey: ['/api/notifications'] }),
      ]);
      allowNavigation(() => onPublished(post.id));
    },
    onError: (failure: Error) => setError(failure.message),
  });

  const isDirty = Object.values(draft).some((value) => Object.values(value).some(Boolean)) || Boolean(targetAction);

  const guard = useUnsavedChangesGuard({
    open: true,
    isDirty,
    isPending: publish.isPending,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
  });

  const isRuValid = Boolean(draft.ru.title.trim() && draft.ru.summary.trim() && draft.ru.body.trim());
  const isEnValid = Boolean(draft.en.title.trim() && draft.en.summary.trim() && draft.en.body.trim());

  const submit = () => {
    if (Object.values(draft).some((value) => !value.title.trim() || !value.summary.trim() || !value.body.trim())) {
      setError(t('updatesInvalidContent'));
      return;
    }
    const command: PublishUpdateCommand = {
      publicationKey,
      content: {
        title: { ru: draft.ru.title.trim(), en: draft.en.title.trim() },
        summary: { ru: draft.ru.summary.trim(), en: draft.en.summary.trim() },
        action: targetAction ? { href: targetAction } : undefined,
        sections: [
          {
            paragraphs: [{ ru: draft.ru.body.trim(), en: draft.en.body.trim() }],
            items: [],
          },
        ],
      },
    };
    setError('');
    publish.mutate(command);
  };

  return (
    <>
      <Dialog open onOpenChange={guard.handleOpenChange}>
        <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t('updatesNewPost')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-1.5 pb-2">
            <Label htmlFor="update-action">{t('updatesTargetAction')}</Label>
            <select
              id="update-action"
              aria-label={t('updatesTargetAction')}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              value={targetAction}
              onChange={(event) => setTargetAction(event.target.value as TargetActionHref)}
              disabled={publish.isPending}
            >
              <option value="">{t('updatesActionNone')}</option>
              <option value="/sales/groups">{t('updatesActionSalesGroups')}</option>
              <option value="/admin/academy-settings?tab=groups">{t('updatesActionAcademySettings')}</option>
            </select>
          </div>

          <Tabs defaultValue="ru" className="min-h-0 overflow-y-auto">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="ru" className="flex items-center justify-center gap-1.5">
                <span>{t('updatesRussian')}</span>
                <span aria-hidden="true" className="inline-flex items-center">
                  {isRuValid ? (
                    <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <span className="size-1.5 rounded-full bg-amber-500" />
                  )}
                </span>
              </TabsTrigger>
              <TabsTrigger value="en" className="flex items-center justify-center gap-1.5">
                <span>{t('updatesEnglish')}</span>
                <span aria-hidden="true" className="inline-flex items-center">
                  {isEnValid ? (
                    <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <span className="size-1.5 rounded-full bg-amber-500" />
                  )}
                </span>
              </TabsTrigger>
              <TabsTrigger value="preview" className="flex items-center justify-center gap-1.5">
                <Eye className="size-3.5" aria-hidden="true" />
                <span>{t('updatesPreview')}</span>
              </TabsTrigger>
            </TabsList>

            {(['ru', 'en'] as const).map((language) => (
              <TabsContent key={language} value={language} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor={`update-title-${language}`}>{t('updatesTitle')}</Label>
                  <Input
                    id={`update-title-${language}`}
                    disabled={publish.isPending}
                    maxLength={200}
                    value={draft[language].title}
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        [language]: { ...value[language], title: event.target.value },
                      }))
                    }
                  />
                  <div className="flex justify-end text-xs text-muted-foreground">
                    <span>{draft[language].title.length} / 200</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`update-summary-${language}`}>{t('updatesSummary')}</Label>
                  <Textarea
                    id={`update-summary-${language}`}
                    disabled={publish.isPending}
                    maxLength={600}
                    value={draft[language].summary}
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        [language]: { ...value[language], summary: event.target.value },
                      }))
                    }
                  />
                  <div className="flex justify-end text-xs text-muted-foreground">
                    <span>{draft[language].summary.length} / 600</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`update-body-${language}`}>{t('updatesBody')}</Label>
                  <Textarea
                    id={`update-body-${language}`}
                    disabled={publish.isPending}
                    maxLength={5000}
                    rows={8}
                    value={draft[language].body}
                    onChange={(event) =>
                      setDraft((value) => ({
                        ...value,
                        [language]: { ...value[language], body: event.target.value },
                      }))
                    }
                  />
                </div>
              </TabsContent>
            ))}

            <TabsContent value="preview" className="space-y-4 pt-2">
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-2 text-xs">
                <span className="font-medium text-muted-foreground">{t('updatesPreview')}</span>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={previewLanguage === 'ru' ? 'secondary' : 'ghost'}
                    className="h-6 px-2 text-xs"
                    onClick={() => setPreviewLanguage('ru')}
                  >
                    {t('updatesRussian')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={previewLanguage === 'en' ? 'secondary' : 'ghost'}
                    className="h-6 px-2 text-xs"
                    onClick={() => setPreviewLanguage('en')}
                  >
                    {t('updatesEnglish')}
                  </Button>
                </div>
              </div>

              <div className="space-y-4 rounded-xl border p-5">
                <div className="space-y-2">
                  <h3 className="break-words text-xl font-semibold tracking-tight">
                    {draft[previewLanguage].title.trim() || <span className="text-muted-foreground italic">—</span>}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {draft[previewLanguage].summary.trim() || <span className="italic">—</span>}
                  </p>
                  {targetAction ? (
                    <div>
                      <Button asChild size="sm" variant="default" className="pointer-events-none">
                        <span>
                          {t('updatesOpenSection')}
                          <ArrowUpRight data-icon="inline-end" />
                        </span>
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div className="border-t pt-3">
                  <p className="whitespace-pre-line break-words text-sm leading-relaxed">
                    {draft[previewLanguage].body.trim() || <span className="text-muted-foreground italic">—</span>}
                  </p>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

          <div className="flex shrink-0 justify-end gap-2 border-t pt-4">
            <Button variant="outline" disabled={publish.isPending} onClick={() => guard.handleOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button disabled={publish.isPending} onClick={submit}>
              {publish.isPending ? t('saving') : t('updatesPublish')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
    </>
  );
}
