import { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Eye, Plus, Trash2, FileText } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { DialogFooter, Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
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

function firstInvalidPostField(draft: UpdatePostDraft, language: 'ru' | 'en') {
  if (!draft.title[language].trim()) return { id: `update-title-${language}` };
  if (!draft.summary[language].trim()) return { id: `update-summary-${language}` };

  const missingTranslation = (value: { ru: string; en: string }) =>
    Boolean(value.ru.trim() || value.en.trim()) && !value[language].trim();

  for (const [sectionIndex, section] of draft.sections.entries()) {
    if (missingTranslation(section.heading)) {
      return { id: `sec-heading-${language}-${sectionIndex}`, sectionIndex };
    }
    const hasText = section.body[language].trim() || section.items.some((item) => item[language].trim());
    if (missingTranslation(section.body) || !hasText) {
      return { id: `update-body-${language}${sectionIndex > 0 ? `-${sectionIndex}` : ''}`, sectionIndex };
    }
    const itemIndex = section.items.findIndex(missingTranslation);
    if (itemIndex >= 0) return { id: `update-item-${language}-${sectionIndex}-${itemIndex}`, sectionIndex };
  }
  return null;
}

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
  const [activeTab, setActiveTab] = useState<'ru' | 'en' | 'preview'>(currentLanguage === 'en' ? 'en' : 'ru');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [focusTarget, setFocusTarget] = useState('');
  const [invalidField, setInvalidField] = useState('');
  const active = useRef(true);
  const submitLock = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    if (!focusTarget) return;
    setInvalidField(focusTarget);
    const timer = window.setTimeout(() => {
      const target = document.getElementById(focusTarget);
      target?.focus();
      target?.scrollIntoView({ block: 'nearest' });
      setFocusTarget('');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, openSections, focusTarget]);

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
    setError('');
    setOpenSections({});
  };

  const publish = useMutation({
    mutationFn: updatesApi.publish,
    onSuccess: async (post) => {
      if (!active.current) return;
      clearPublishDraft();
      toast({ title: t('updatesPublished') });
      await Promise.all([
        client.invalidateQueries({ queryKey: updateQueryKeys.all }),
        client.invalidateQueries({ queryKey: ['/api/notifications'] }),
      ]);
      if (active.current) allowNavigation(() => onPublished(post.id));
    },
    onError: () => { if (active.current) setError(t('updatesPublishFailed')); },
    onSettled: () => { submitLock.current = false; },
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
    onDiscard: clearPublishDraft,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
  });

  const isRuValid = !firstInvalidPostField(draft, 'ru');
  const isEnValid = !firstInvalidPostField(draft, 'en');

  const addSection = () => {
    setOpenSections((previous) => ({ ...previous, [`section-${draft.sections.length}`]: true }));
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
    setOpenSections((previous) => ({ ...previous, [`items-${sectionIndex}`]: true }));
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
    if (publish.isPending || submitLock.current) return;
    for (const language of ['ru', 'en'] as const) {
      const invalid = firstInvalidPostField(draft, language);
      if (!invalid) continue;
      setError(t('updatesInvalidContent'));
      setActiveTab(language);
      if (invalid.sectionIndex !== undefined) {
        const index = invalid.sectionIndex;
        setOpenSections((previous) => ({ ...previous, [`section-${index}`]: true, [`items-${index}`]: true }));
      }
      setFocusTarget(invalid.id);
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
    submitLock.current = true;
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
        <DialogContent aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); document.getElementById(`update-title-${activeTab}`)?.focus(); }} className="compact-modal flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-2xl flex-col overflow-hidden rounded-xl p-0 sm:max-h-[90dvh]">
          <DialogHeader data-topographic="card" className="compact-modal-header">
            <DialogTitle>{t('updatesNewPost')}</DialogTitle>
          </DialogHeader>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); submit(); }} onChange={() => { setError(''); setInvalidField(''); }}>
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)} className="compact-modal-body min-h-0 overflow-y-auto overscroll-contain">
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
                  <CompactModalSection title={t('updatesTitle')} icon={FileText} tone="sky" collapsible={false} disabled={publish.isPending} contentClassName="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`update-title-${language}`}>{t('updatesTitle')}</Label>
                      <Input
                        id={`update-title-${language}`}
                        aria-invalid={invalidField === `update-title-${language}`}
                        aria-describedby={invalidField === `update-title-${language}` ? 'update-publish-error' : undefined}
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
                        aria-invalid={invalidField === `update-summary-${language}`}
                        aria-describedby={invalidField === `update-summary-${language}` ? 'update-publish-error' : undefined}
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
                  </CompactModalSection>
                  {/* Multi-section builder (ADV-09) */}
                  <div className="space-y-4 pt-2">
                    {draft.sections.map((section, sIndex) => (
                      <CompactModalSection
                        key={section.id}
                        title={`${t('updatesSection')} ${sIndex + 1}`}
                        summary={section.heading[language] || section.body[language]}
                        tone={sIndex === 0 ? 'teal' : 'violet'}
                        collapsible={sIndex > 0}
                        open={Boolean(openSections[`section-${sIndex}`])}
                        onOpenChange={(open) => setOpenSections((previous) => ({ ...previous, [`section-${sIndex}`]: open }))}
                        disabled={publish.isPending}
                        contentClassName="space-y-3"
                        actions={sIndex > 0 ? <Button type="button" variant="ghost" size="icon" className="size-8 text-destructive" disabled={publish.isPending} onClick={() => setPendingRemoval({ kind: 'section', sectionIndex: sIndex })} aria-label={t('updatesRemoveSection')}><Trash2 className="size-3.5" /></Button> : undefined}
                      >

                        {sIndex > 0 || section.heading.ru || section.heading.en ? (
                          <div className="space-y-1.5">
                            <Label htmlFor={`sec-heading-${language}-${sIndex}`}>{t('updatesSectionHeading')}</Label>
                            <Input
                              id={`sec-heading-${language}-${sIndex}`}
                              aria-invalid={invalidField === `sec-heading-${language}-${sIndex}`}
                              aria-describedby={invalidField === `sec-heading-${language}-${sIndex}` ? 'update-publish-error' : undefined}
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
                            aria-invalid={invalidField === `update-body-${language}${sIndex > 0 ? `-${sIndex}` : ''}`}
                            aria-describedby={invalidField === `update-body-${language}${sIndex > 0 ? `-${sIndex}` : ''}` ? 'update-publish-error' : undefined}
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
                        <CompactModalSection title={t('updatesSectionItems')} count={section.items.length} tone="amber" open={Boolean(openSections[`items-${sIndex}`])} onOpenChange={(open) => setOpenSections((previous) => ({ ...previous, [`items-${sIndex}`]: open }))} disabled={publish.isPending} contentClassName="space-y-2" actions={
                          <div className="flex items-center justify-between">
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
                          </div>}>
                          {section.items.map((item, iIndex) => (
                            <div key={item.id} className="flex items-center gap-2">
                              <Input
                                id={`update-item-${language}-${sIndex}-${iIndex}`}
                                aria-invalid={invalidField === `update-item-${language}-${sIndex}-${iIndex}`}
                                aria-describedby={invalidField === `update-item-${language}-${sIndex}-${iIndex}` ? 'update-publish-error' : undefined}
                                disabled={publish.isPending}
                                value={item[language]}
                                aria-label={`${t('updatesSectionItems')} ${iIndex + 1}`}
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
                        </CompactModalSection>
                      </CompactModalSection>
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

            {error ? <p id="update-publish-error" role="alert" className="shrink-0 px-3 py-2 text-sm text-destructive sm:px-5">{error}</p> : null}

            <DialogFooter className="compact-modal-footer flex-wrap">
              {isDirty ? <Button type="button" variant="ghost" className="sm:mr-auto" disabled={publish.isPending} onClick={() => setPendingRemoval({ kind: 'draft' })}><Trash2 data-icon="inline-start" />{t('updatesClearDraft')}</Button> : null}
              <Button type="button" variant="outline" disabled={publish.isPending} onClick={() => guard.handleOpenChange(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={publish.isPending}>
                {publish.isPending ? t('saving') : t('updatesPublish')}
              </Button>
            </DialogFooter>
          </form>
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
      <UnsavedChangesDialog
        open={guard.confirmationOpen}
        onOpenChange={guard.setConfirmationOpen}
        onDiscard={guard.discardChanges}
        isPending={publish.isPending}
      />
    </>
  );
}
