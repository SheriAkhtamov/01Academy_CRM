import { useCallback, useEffect, useRef, useState } from 'react';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { BookOpen, FileText, GraduationCap, Layers, Loader2, SlidersHorizontal } from 'lucide-react';
import type { CourseValues } from '@/lib/academyResourceSchemas';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { CourseCurriculumEditor } from './CourseCurriculumEditor';
import { AGE_CATEGORY_PRESETS, summarizeCourseCurriculum } from './editor-model';

export function CourseEditorDialog({ open, onOpenChange, form, editing, saving, onSubmit, curriculumUnavailable = false }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<CourseValues>;
  editing: boolean;
  saving: boolean;
  onSubmit: (values: CourseValues) => void;
  curriculumUnavailable?: boolean;
}) {
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement | null>(null);
  const uploading = useRef(new Set<string>());
  const lastEditingRef = useRef(editing);
  if (open) {
    lastEditingRef.current = editing;
  }
  const isEditing = open ? editing : lastEditingRef.current;
  const [uploadPending, setUploadPending] = useState(false);
  const [focusBlockRequest, setFocusBlockRequest] = useState<{ blockId: string; seq: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setFocusBlockRequest(null);
    }
  }, [open]);

  const program = useWatch({ control: form.control, name: 'program' });
  const isActive = useWatch({ control: form.control, name: 'isActive' });
  const stats = summarizeCourseCurriculum(program);

  const uploadBusyChange = useCallback((id: string, busy: boolean) => {
    if (busy) uploading.current.add(id);
    else uploading.current.delete(id);
    setUploadPending(uploading.current.size > 0);
  }, []);

  const changeOpen = (next: boolean) => {
    if (!saving && uploading.current.size === 0) onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[min(860px,calc(100dvh-2rem))] max-h-[calc(100dvh-2rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="shrink-0 border-b bg-muted/20 px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3 pr-8">
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
                <GraduationCap className="size-5" aria-hidden="true" />
              </span>
              <div className="flex flex-wrap items-center gap-2.5">
                <DialogTitle className="text-lg font-semibold">
                  {isEditing ? t('editCourse') : t('addCourse')}
                </DialogTitle>
                <Badge
                  variant={isActive ? 'default' : 'secondary'}
                  className={cn(
                    'gap-1.5 text-xs font-medium',
                    isActive
                      ? 'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300'
                      : 'text-muted-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      isActive ? 'bg-emerald-500' : 'bg-muted-foreground/60',
                    )}
                    aria-hidden="true"
                  />
                  {t(isActive ? 'active' : 'inactive')}
                </Badge>
              </div>
            </div>
            {!curriculumUnavailable ? (
              <div className="hidden items-center gap-2 sm:flex">
                <Badge variant="outline" className="gap-1.5 bg-background/80 px-2.5 py-1 text-xs font-medium">
                  <Layers className="size-3.5 text-primary" aria-hidden="true" />
                  {t('courseBlocksStat', { count: stats.blockCount })}
                </Badge>
                <Badge variant="outline" className="gap-1.5 bg-background/80 px-2.5 py-1 text-xs font-medium">
                  <BookOpen className="size-3.5 text-primary" aria-hidden="true" />
                  {t('courseLessonsStat', { count: stats.lessonCount })}
                </Badge>
                <Badge variant="outline" className="gap-1.5 bg-background/80 px-2.5 py-1 text-xs font-medium">
                  <FileText className="size-3.5 text-primary" aria-hidden="true" />
                  {t('courseMaterialsStat', { count: stats.materialCount })}
                </Badge>
              </div>
            ) : null}
          </div>
        </DialogHeader>
        <Form {...form}>
          <form
            ref={formRef}
            noValidate
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            onSubmit={(event) => {
              if (uploading.current.size > 0 || saving) { event.preventDefault(); return; }
              void form.handleSubmit(
                (values) => {
                  if (uploading.current.size === 0 && !saving) onSubmit(values);
                },
                () => {
                  requestAnimationFrame(() => {
                    const firstInvalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
                    if (firstInvalid) {
                      firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      firstInvalid.focus();
                    }
                  });
                },
              )(event);
            }}
          >
            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto overscroll-contain lg:grid-cols-12 lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
              <div className="space-y-5 border-b bg-muted/10 p-4 sm:p-6 lg:col-span-5 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:border-b-0 lg:border-r xl:col-span-4">
                <fieldset disabled={saving} className="min-w-0 space-y-5 border-0 p-0 m-0">
                  <div className="space-y-4 rounded-2xl border bg-background p-4 shadow-sm">
                    <div className="flex items-center gap-2 border-b pb-3">
                      <SlidersHorizontal className="size-4 text-primary" aria-hidden="true" />
                      <h3 className="text-sm font-semibold">{t('courseBasicParameters')}</h3>
                    </div>

                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel required>{t('courseName')}</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage role="alert" />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="ageCategory"
                      render={({ field }) => (
                        <FormItem className="space-y-2">
                          <FormLabel required>{t('ageCategory')}</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <div className="flex flex-wrap gap-1.5">
                            {AGE_CATEGORY_PRESETS.map((preset) => {
                              const selected = field.value === preset;
                              return (
                                <Button
                                  key={preset}
                                  type="button"
                                  size="sm"
                                  variant={selected ? 'default' : 'outline'}
                                  aria-pressed={selected}
                                  className="h-7 rounded-full px-2.5 text-xs font-medium"
                                  onClick={() => form.setValue('ageCategory', preset, { shouldDirty: true, shouldValidate: true })}
                                >
                                  {preset}
                                </Button>
                              );
                            })}
                          </div>
                          <FormMessage role="alert" />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="basePriceUzs"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel required>{t('basePrice')}</FormLabel>
                          <div className="relative">
                            <FormControl>
                              <Input
                                {...field}
                                type="number"
                                min="0"
                                inputMode="numeric"
                                className="pr-14 font-mono"
                                onFocus={(event) => {
                                  if (String(field.value) === '0') {
                                    event.currentTarget.select();
                                  }
                                }}
                                onChange={(event) => {
                                  const normalized = event.target.value.replace(/^0+(?=\d)/, '');
                                  if (normalized !== event.target.value) {
                                    event.target.value = normalized;
                                  }
                                  field.onChange(normalized);
                                }}
                              />
                            </FormControl>
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs font-semibold uppercase text-muted-foreground"
                            >
                              {t('courseCurrencyShort')}
                            </span>
                          </div>
                          <FormMessage role="alert" />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('description')}</FormLabel>
                          <FormControl>
                            <Textarea {...field} rows={3} />
                          </FormControl>
                          <FormMessage role="alert" />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="isActive"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between space-y-0 rounded-xl border border-border bg-muted/20 p-3">
                          <FormLabel className="cursor-pointer font-medium">{t('activeCourse')}</FormLabel>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>

                  {!curriculumUnavailable && program.blocks.length > 0 ? (
                    <div className="space-y-3 rounded-2xl border bg-background p-4 shadow-sm">
                      <div className="flex items-center justify-between border-b pb-2.5">
                        <div className="flex items-center gap-2">
                          <Layers className="size-4 text-primary" aria-hidden="true" />
                          <h3 className="text-sm font-semibold">{t('courseStructureOutline')}</h3>
                        </div>
                        <Badge variant="secondary" className="font-mono text-xs">
                          {program.blocks.length}
                        </Badge>
                      </div>
                      <div className="space-y-1.5">
                        {program.blocks.map((block, index) => (
                          <button
                            key={block.id}
                            type="button"
                            onClick={() => setFocusBlockRequest({ blockId: block.id, seq: Date.now() })}
                            className="flex w-full items-center justify-between gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left text-sm transition-colors hover:border-border hover:bg-muted/40"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="inline-flex h-5 shrink-0 items-center justify-center rounded bg-primary/10 px-1.5 font-mono text-xs font-semibold text-primary">
                                {String(index + 1).padStart(2, '0')}
                              </span>
                              <span className="truncate font-medium">
                                {block.title || t('courseBlockNumber', { number: index + 1 })}
                              </span>
                            </span>
                            <Badge variant="outline" className="shrink-0 font-mono text-xs">
                              {block.lessons.length}
                            </Badge>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </fieldset>
              </div>

              <div className="px-4 pb-4 pt-0 sm:px-6 sm:pb-6 sm:pt-0 lg:col-span-7 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain xl:col-span-8">
                <fieldset disabled={saving} className="min-w-0 border-0 p-0 m-0">
                  <CourseCurriculumEditor
                    unavailable={curriculumUnavailable}
                    onUploadBusyChange={uploadBusyChange}
                    disabled={saving}
                    focusBlockRequest={focusBlockRequest}
                  />
                </fieldset>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-background/95 px-5 py-3.5 sm:px-6">
              {!curriculumUnavailable ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{t('courseBlocksStat', { count: stats.blockCount })}</span>
                  <span aria-hidden="true">·</span>
                  <span>{t('courseLessonsStat', { count: stats.lessonCount })}</span>
                  <span aria-hidden="true">·</span>
                  <span>{t('courseMaterialsStat', { count: stats.materialCount })}</span>
                </div>
              ) : null}
              <div className="ml-auto flex items-center gap-2">
                <Button type="button" variant="outline" disabled={saving || uploadPending} onClick={() => changeOpen(false)}>
                  {t('cancel')}
                </Button>
                <Button type="submit" disabled={saving || uploadPending}>
                  {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" /> : null}
                  {saving ? t('saving') : t('save')}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
