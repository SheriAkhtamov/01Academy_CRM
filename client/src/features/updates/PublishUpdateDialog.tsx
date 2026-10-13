import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Eye, Plus, Trash2, RotateCcw } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { cn } from '@/lib/utils';
import { updatesApi, updateQueryKeys } from './api';
import {
  getPublishDraft,
  savePublishDraft,
  clearPublishDraft,
  type PublishDraftData,
} from './utils';
import type { PublishUpdateCommand } from '@shared/contracts/platform-updates';
import { allowNavigation } from '@/lib/navigationGuard';

type DraftRemoval =
  | { kind: 'draft' }
  | { kind: 'section'; sectionIndex: number }
  | { kind: 'item'; sectionIndex: number; itemIndex: number };

interface SectionDraft {
  id: string;
  heading: { ru: string; en: string };
  body: { ru: string; en: string };
  items: Array<{ id: string; ru: string; en: string }>;
}

interface UpdatePostDraft {
  title: { ru: string; en: string };
  summary: { ru: string; en: string };
  sections: SectionDraft[];
}

const createInitialSection = (): SectionDraft => ({
  id: 'section-primary',
  heading: { ru: '', en: '' },
  body: { ru: '', en: '' },
  items: [],
});

const emptyPostDraft = (): UpdatePostDraft => ({
  title: { ru: '', en: '' },
  summary: { ru: '', en: '' },
  sections: [createInitialSection()],
});

const serializeDraft = (draft: UpdatePostDraft): PublishDraftData => ({
  titleRu: draft.title.ru,
  titleEn: draft.title.en,
  summaryRu: draft.summary.ru,
  summaryEn: draft.summary.en,
  rawBodyRu: draft.sections[0]?.body.ru || '',
  rawBodyEn: draft.sections[0]?.body.en || '',
  sectionsRu: draft.sections.map((s) => ({
    heading: s.heading.ru,
    paragraphs: s.body.ru ? [s.body.ru] : [],
    items: s.items.map((i) => i.ru),
  })),
  sectionsEn: draft.sections.map((s) => ({
    heading: s.heading.en,
    paragraphs: s.body.en ? [s.body.en] : [],
    items: s.items.map((i) => i.en),
  })),
});

const deserializeDraft = (data: PublishDraftData): UpdatePostDraft => {
  const sections: SectionDraft[] = [];
  const maxSections = Math.max(
    data.sectionsRu?.length ?? 0,
    data.sectionsEn?.length ?? 0,
    1
  );

  for (let i = 0; i < maxSections; i++) {
    const secRu = data.sectionsRu?.[i];
    const secEn = data.sectionsEn?.[i];
    const bodyRu = secRu?.paragraphs?.join('\n\n') ?? (i === 0 ? data.rawBodyRu ?? '' : '');
    const bodyEn = secEn?.paragraphs?.join('\n\n') ?? (i === 0 ? data.rawBodyEn ?? '' : '');
    const itemsRu = secRu?.items ?? [];
    const itemsEn = secEn?.items ?? [];
    const maxItems = Math.max(itemsRu.length, itemsEn.length);
    const items: Array<{ id: string; ru: string; en: string }> = [];
    for (let j = 0; j < maxItems; j++) {
      items.push({
        id: `item-${i}-${j}-${Math.random()}`,
        ru: itemsRu[j] ?? '',
        en: itemsEn[j] ?? '',
      });
    }

    sections.push({
      id: i === 0 ? 'section-primary' : `section-${i}-${Math.random()}`,
      heading: {
        ru: secRu?.heading ?? '',
        en: secEn?.heading ?? '',
      },
      body: {
        ru: bodyRu,
        en: bodyEn,
      },
      items,
    });
  }

  return {
    title: { ru: data.titleRu ?? '', en: data.titleEn ?? '' },
    summary: { ru: data.summaryRu ?? '', en: data.summaryEn ?? '' },
    sections: sections.length > 0 ? sections : [createInitialSection()],
  };
};

export function PublishUpdateDialog({ onClose, onPublished }: { onClose: () => void; onPublished: (id: number) => void }) {
  const { t, language: currentLanguage } = useTranslation();
  const client = useQueryClient();

  const initialSaved = typeof window !== 'undefined' ? getPublishDraft() : null;
  const hasSavedContent = Boolean(
    initialSaved &&
      (initialSaved.titleRu?.trim() ||
        initialSaved.titleEn?.trim() ||
        initialSaved.summaryRu?.trim() ||
        initialSaved.summaryEn?.trim() ||
        initialSaved.rawBodyRu?.trim() ||
        initialSaved.rawBodyEn?.trim() ||
        initialSaved.sectionsRu?.some((s) => s.heading?.trim() || s.paragraphs?.some(Boolean) || s.items?.some(Boolean)) ||
        initialSaved.sectionsEn?.some((s) => s.heading?.trim() || s.paragraphs?.some(Boolean) || s.items?.some(Boolean)))
  );

  const [draftRestored, setDraftRestored] = useState(hasSavedContent);
  const [draft, setDraft] = useState<UpdatePostDraft>(() => {
    if (hasSavedContent && initialSaved) {
      return deserializeDraft(initialSaved);
    }
    return emptyPostDraft();
  });

  const [previewLanguage, setPreviewLanguage] = useState<'ru' | 'en'>(currentLanguage === 'en' ? 'en' : 'ru');
  const [publicationKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<DraftRemoval | null>(null);

  // Auto-save draft changes to localStorage (ADV-07)
  useEffect(() => {
    const hasContent =
      Boolean(draft.title.ru.trim()) ||
      Boolean(draft.title.en.trim()) ||
      Boolean(draft.summary.ru.trim()) ||
      Boolean(draft.summary.en.trim()) ||
      draft.sections.some(
        (s) =>
          s.heading.ru.trim() ||
          s.heading.en.trim() ||
          s.body.ru.trim() ||
          s.body.en.trim() ||
          s.items.some((i) => i.ru.trim() || i.en.trim())
      );

    if (hasContent) {
      savePublishDraft(serializeDraft(draft));
    } else {
      clearPublishDraft();
    }
  }, [draft]);

  const handleClearDraft = () => {
    clearPublishDraft();
    setDraft(emptyPostDraft());
    setDraftRestored(false);
  };

  const publish = useMutation({
    mutationFn: updatesApi.publish,
    onSuccess: async (post) => {
      clearPublishDraft();
      toast({ title: t('updatesPublished') });
      await Promise.all([
        client.invalidateQueries({ queryKey: updateQueryKeys.all }),
        client.invalidateQueries({ queryKey: ['/api/notifications'] }),
      ]);
      allowNavigation(() => onPublished(post.id));
    },
    onError: (failure: Error) => setError(failure.message),
  });

  const isDirty =
    Boolean(draft.title.ru) ||
    Boolean(draft.title.en) ||
    Boolean(draft.summary.ru) ||
    Boolean(draft.summary.en) ||
    draft.sections.some(
      (s) =>
        Boolean(s.heading.ru) ||
        Boolean(s.heading.en) ||
        Boolean(s.body.ru) ||
        Boolean(s.body.en) ||
        s.items.length > 0
    );

  const guard = useUnsavedChangesGuard({
    open: true,
    isDirty,
    isPending: publish.isPending,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
  });

  const isLanguageComplete = (language: 'ru' | 'en') => {
    const hasTranslation = (value: { ru: string; en: string }) =>
      (!value.ru.trim() && !value.en.trim()) || Boolean(value[language].trim());

    return Boolean(draft.title[language].trim()) &&
      Boolean(draft.summary[language].trim()) &&
      draft.sections.every((section) =>
        (section.body[language].trim() || section.items.some((item) => item[language].trim())) &&
        hasTranslation(section.heading) &&
        hasTranslation(section.body) &&
        section.items.every(hasTranslation)
      );
  };
  const isRuValid = isLanguageComplete('ru');
  const isEnValid = isLanguageComplete('en');

  const addSection = () => {
    setDraft((prev) => ({
      ...prev,
      sections: [
        ...prev.sections,
        {
          id: `section-${Date.now()}-${Math.random()}`,
          heading: { ru: '', en: '' },
          body: { ru: '', en: '' },
          items: [],
        },
      ],
    }));
  };

  const removeSection = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      sections: prev.sections.filter((_, i) => i !== index),
    }));
  };

  const addItem = (sectionIndex: number) => {
    setDraft((prev) => {
      const updated = [...prev.sections];
      const section = updated[sectionIndex];
      if (section) {
        updated[sectionIndex] = {
          ...section,
          items: [
            ...section.items,
            {
              id: `item-${Date.now()}-${Math.random()}`,
              ru: '',
              en: '',
            },
          ],
        };
      }
      return { ...prev, sections: updated };
    });
  };

  const removeItem = (sectionIndex: number, itemIndex: number) => {
    setDraft((prev) => {
      const updated = [...prev.sections];
      const section = updated[sectionIndex];
      if (section) {
        updated[sectionIndex] = {
          ...section,
          items: section.items.filter((_, i) => i !== itemIndex),
        };
      }
      return { ...prev, sections: updated };
    });
  };

  const confirmRemoval = () => {
    if (!pendingRemoval) return;
    if (pendingRemoval.kind === 'draft') {
      handleClearDraft();
    } else if (pendingRemoval.kind === 'section') {
      removeSection(pendingRemoval.sectionIndex);
    } else {
      removeItem(pendingRemoval.sectionIndex, pendingRemoval.itemIndex);
    }
    setPendingRemoval(null);
  };

  const submit = () => {
    const hasEmptyTitleOrSummary =
      !draft.title.ru.trim() ||
      !draft.title.en.trim() ||
      !draft.summary.ru.trim() ||
      !draft.summary.en.trim();

    const hasIncompleteSection = draft.sections.some(
      (s) =>
        (!s.body.ru.trim() && !s.items.some((i) => i.ru.trim())) ||
        (!s.body.en.trim() && !s.items.some((i) => i.en.trim()))
    );

    const hasIncompleteTranslation = (value: { ru: string; en: string }) =>
      Boolean(value.ru.trim()) !== Boolean(value.en.trim());
    const hasIncompleteContent = draft.sections.some((section) =>
      hasIncompleteTranslation(section.heading) ||
      hasIncompleteTranslation(section.body) ||
      section.items.some(hasIncompleteTranslation)
    );

    if (hasEmptyTitleOrSummary || hasIncompleteSection || hasIncompleteContent) {
      setError(t('updatesInvalidContent'));
      return;
    }

    const command: PublishUpdateCommand = {
      publicationKey,
      content: {
        title: { ru: draft.title.ru.trim(), en: draft.title.en.trim() },
        summary: { ru: draft.summary.ru.trim(), en: draft.summary.en.trim() },
        sections: draft.sections.map((sec) => {
          const headingRu = sec.heading.ru.trim();
          const headingEn = sec.heading.en.trim();
          const bodyRu = sec.body.ru.trim();
          const bodyEn = sec.body.en.trim();

          const paragraphs = bodyRu && bodyEn ? [{ ru: bodyRu, en: bodyEn }] : [];
          const items = sec.items
            .filter((it) => it.ru.trim() && it.en.trim())
            .map((it) => ({ ru: it.ru.trim(), en: it.en.trim() }));

          return {
            heading: headingRu && headingEn ? { ru: headingRu, en: headingEn } : undefined,
            paragraphs,
            items,
          };
        }),
      },
    };

    setError('');
    publish.mutate(command);
  };

  const removalCopy = {
    draft: { titleKey: 'updatesClearDraft', descriptionKey: 'updatesClearDraftConfirm' },
    section: { titleKey: 'updatesRemoveSection', descriptionKey: 'updatesRemoveSectionConfirm' },
    item: { titleKey: 'updatesRemoveItem', descriptionKey: 'updatesRemoveItemConfirm' },
  } as const;
  const removalText = removalCopy[pendingRemoval?.kind ?? 'draft'];

  return (
    <>
      <Dialog open onOpenChange={guard.handleOpenChange}>
        <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{t('updatesNewPost')}</DialogTitle>
          </DialogHeader>

          {/* Draft restored banner (ADV-07) */}
          {draftRestored ? (
            <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground">
              <div className="flex items-center gap-2">
                <RotateCcw className="size-3.5 text-primary" />
                <span>{t('updatesDraftRestored')}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                disabled={publish.isPending}
                onClick={() => setPendingRemoval({ kind: 'draft' })}
              >
                <Trash2 className="mr-1 size-3" />
                {t('updatesClearDraft')}
              </Button>
            </div>
          ) : null}

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
                    value={draft.title[language]}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        title: { ...prev.title, [language]: event.target.value },
                      }))
                    }
                  />
                  <div className="flex justify-end text-xs text-muted-foreground">
                    <span>{draft.title[language].length} / 200</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`update-summary-${language}`}>{t('updatesSummary')}</Label>
                  <Textarea
                    id={`update-summary-${language}`}
                    disabled={publish.isPending}
                    maxLength={600}
                    value={draft.summary[language]}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        summary: { ...prev.summary, [language]: event.target.value },
                      }))
                    }
                  />
                  <div className="flex justify-end text-xs text-muted-foreground">
                    <span>{draft.summary[language].length} / 600</span>
                  </div>
                </div>

                {/* Multi-section builder (ADV-09) */}
                <div className="space-y-4 pt-2">
                  {draft.sections.map((section, sIndex) => (
                    <div
                      key={section.id}
                      className={cn(
                        'space-y-3 rounded-lg border p-3.5 bg-card/40',
                        sIndex > 0 && 'border-primary/30'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {t('updatesSection')} {sIndex + 1}
                        </span>
                        {sIndex > 0 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                            disabled={publish.isPending}
                            onClick={() => setPendingRemoval({ kind: 'section', sectionIndex: sIndex })}
                          >
                            <Trash2 className="mr-1 size-3" />
                            {t('updatesRemoveSection')}
                          </Button>
                        ) : null}
                      </div>

                      {sIndex > 0 || section.heading.ru || section.heading.en ? (
                        <div className="space-y-1.5">
                          <Label htmlFor={`sec-heading-${language}-${sIndex}`}>{t('updatesSectionHeading')}</Label>
                          <Input
                            id={`sec-heading-${language}-${sIndex}`}
                            disabled={publish.isPending}
                            maxLength={200}
                            value={section.heading[language]}
                            onChange={(event) => {
                              const val = event.target.value;
                              setDraft((prev) => {
                                const updated = [...prev.sections];
                                updated[sIndex] = {
                                  ...updated[sIndex],
                                  heading: { ...updated[sIndex].heading, [language]: val },
                                };
                                return { ...prev, sections: updated };
                              });
                            }}
                          />
                        </div>
                      ) : null}

                      <div className="space-y-1.5">
                        <Label htmlFor={`update-body-${language}${sIndex > 0 ? `-${sIndex}` : ''}`}>
                          {sIndex === 0 ? t('updatesBody') : t('updatesSectionBody')}
                        </Label>
                        <Textarea
                          id={`update-body-${language}${sIndex > 0 ? `-${sIndex}` : ''}`}
                          disabled={publish.isPending}
                          maxLength={5000}
                          rows={sIndex === 0 ? 6 : 4}
                          value={section.body[language]}
                          onChange={(event) => {
                            const val = event.target.value;
                            setDraft((prev) => {
                              const updated = [...prev.sections];
                              updated[sIndex] = {
                                ...updated[sIndex],
                                body: { ...updated[sIndex].body, [language]: val },
                              };
                              return { ...prev, sections: updated };
                            });
                          }}
                        />
                      </div>

                      {/* Bullet list items */}
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">{t('updatesSectionItems')}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            disabled={publish.isPending}
                            onClick={() => addItem(sIndex)}
                          >
                            <Plus className="mr-1 size-3" />
                            {t('updatesAddItem')}
                          </Button>
                        </div>
                        {section.items.map((item, iIndex) => (
                          <div key={item.id} className="flex items-center gap-2">
                            <Input
                              disabled={publish.isPending}
                              value={item[language]}
                              placeholder={t('updatesAddItem')}
                              maxLength={2000}
                              className="h-8 text-sm"
                              onChange={(event) => {
                                const val = event.target.value;
                                setDraft((prev) => {
                                  const updated = [...prev.sections];
                                  const curSec = updated[sIndex];
                                  const updatedItems = [...curSec.items];
                                  updatedItems[iIndex] = {
                                    ...updatedItems[iIndex],
                                    [language]: val,
                                  };
                                  updated[sIndex] = { ...curSec, items: updatedItems };
                                  return { ...prev, sections: updated };
                                });
                              }}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                              disabled={publish.isPending}
                              onClick={() => setPendingRemoval({ kind: 'item', sectionIndex: sIndex, itemIndex: iIndex })}
                              aria-label={t('updatesRemoveItem')}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5 border-dashed"
                    disabled={publish.isPending}
                    onClick={addSection}
                  >
                    <Plus className="size-4" />
                    {t('updatesAddSection')}
                  </Button>
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
                    {draft.title[previewLanguage].trim() || <span className="text-muted-foreground italic">—</span>}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {draft.summary[previewLanguage].trim() || <span className="italic">—</span>}
                  </p>
                </div>

                {draft.sections.map((section, sIndex) => (
                  <div key={section.id} className="border-t pt-3 space-y-2">
                    {section.heading[previewLanguage].trim() ? (
                      <h4 className="font-semibold text-base">{section.heading[previewLanguage].trim()}</h4>
                    ) : null}
                    {section.body[previewLanguage].trim() ? (
                      <p className="whitespace-pre-line break-words text-sm leading-relaxed">
                        {section.body[previewLanguage].trim()}
                      </p>
                    ) : null}
                    {section.items.filter((it) => it[previewLanguage].trim()).length > 0 ? (
                      <ul className="list-disc pl-5 text-sm space-y-1">
                        {section.items
                          .filter((it) => it[previewLanguage].trim())
                          .map((it) => (
                            <li key={it.id}>{it[previewLanguage].trim()}</li>
                          ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
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
      <ConfirmDialog
        open={Boolean(pendingRemoval)}
        onOpenChange={(open) => { if (!open) setPendingRemoval(null); }}
        title={t(removalText.titleKey)}
        description={t(removalText.descriptionKey)}
        confirmLabel={t(removalText.titleKey)}
        onConfirm={confirmRemoval}
        variant="destructive"
        isPending={publish.isPending}
      />
      <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
    </>
  );
}
