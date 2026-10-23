import { useCallback, useEffect, useRef, useState } from 'react';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { FileText, GraduationCap, Loader2, SlidersHorizontal } from 'lucide-react';
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
import { CompactModalSection } from '@/components/ux/CompactModalSection';
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
  if (open) lastEditingRef.current = editing;
  const isEditing = open ? editing : lastEditingRef.current;
  const [uploadPending, setUploadPending] = useState(false);
  const [parametersOpen, setParametersOpen] = useState(true);
  const [descriptionOpen, setDescriptionOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setParametersOpen(true);
      setDescriptionOpen(false);
    }
  }, [open]);

  const { submitCount, isValid } = form.formState;
  useEffect(() => {
    const root = formRef.current;
    if (!open || !root || submitCount === 0 || isValid) return;
    let frame = 0;
    const focusInvalid = () => {
      const candidates = root.querySelectorAll<HTMLElement>('[aria-invalid="true"], [data-curriculum-error]');
      const visible = Array.from(candidates).filter(element => !element.closest('[hidden]'));
      const control = visible.find(element => element.matches('input, textarea, select, button'));
      const target = control ?? visible[0];
      if (!target) return;
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.focus();
      if (control) observer.disconnect();
    };
    const scheduleFocus = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(focusInvalid);
    };
    // Invalid curriculum fields may mount after their block and lesson open
    // in separate effects. Follow those mounts instead of guessing a frame count.
    const observer = new MutationObserver(scheduleFocus);
    observer.observe(root, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['hidden', 'aria-invalid'] });
    scheduleFocus();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [open, submitCount, isValid]);

  const program = useWatch({ control: form.control, name: 'program' });
  const isActive = useWatch({ control: form.control, name: 'isActive' });
  const name = useWatch({ control: form.control, name: 'name' });
  const ageCategory = useWatch({ control: form.control, name: 'ageCategory' });
  const description = useWatch({ control: form.control, name: 'description' });
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
        className="compact-modal flex max-h-[calc(100dvh-1rem)] max-w-4xl flex-col overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)]"
      >
        <DialogHeader className="compact-modal-header">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
              <GraduationCap className="size-4" aria-hidden="true" />
            </span>
            <DialogTitle className="text-base font-semibold">
              {isEditing ? t('editCourse') : t('addCourse')}
            </DialogTitle>
            <Badge
              variant="secondary"
              className={cn('gap-1.5 text-xs font-medium', isActive && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300')}
            >
              <span className={cn('size-1.5 rounded-full', isActive ? 'bg-emerald-500' : 'bg-muted-foreground/60')} aria-hidden="true" />
              {t(isActive ? 'active' : 'inactive')}
            </Badge>
          </div>
        </DialogHeader>
        <Form {...form}>
          <form
            ref={formRef}
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              if (uploading.current.size > 0 || saving) { event.preventDefault(); return; }
              void form.handleSubmit(
                (values) => {
                  if (uploading.current.size === 0 && !saving) onSubmit(values);
                },
                (errors) => {
                  if (errors.name || errors.ageCategory || errors.isActive) setParametersOpen(true);
                  if (errors.description) setDescriptionOpen(true);

                },
              )(event);
            }}
          >
            <div className="compact-modal-body flex-1 space-y-3 overflow-y-auto overscroll-contain">
              <CompactModalSection
                title={t('courseBasicParameters')}
                summary={[name, ageCategory].filter(Boolean).join(' · ')}
                icon={SlidersHorizontal}
                tone="sky"
                open={parametersOpen}
                onOpenChange={setParametersOpen}
                disabled={saving}
                contentClassName="grid gap-3 sm:grid-cols-2"
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel required>{t('courseName')}</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage role="alert" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="ageCategory"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel required>{t('ageCategory')}</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <div className="flex flex-wrap gap-1.5">
                        {AGE_CATEGORY_PRESETS.map((preset) => (
                          <Button
                            key={preset}
                            type="button"
                            size="sm"
                            variant={field.value === preset ? 'default' : 'outline'}
                            aria-pressed={field.value === preset}
                            className="h-7 rounded-md px-2 text-xs"
                            onClick={() => form.setValue('ageCategory', preset, { shouldDirty: true, shouldValidate: true })}
                          >
                            {preset}
                          </Button>
                        ))}
                      </div>
                      <FormMessage role="alert" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-3 space-y-0 border-t border-border/70 pt-2 sm:col-span-2">
                      <FormLabel className="cursor-pointer font-medium">{t('activeCourse')}</FormLabel>
                      <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    </FormItem>
                  )}
                />
              </CompactModalSection>
              <CompactModalSection
                title={t('description')}
                summary={description}
                icon={FileText}
                tone="amber"
                open={descriptionOpen}
                onOpenChange={setDescriptionOpen}
                disabled={saving}
              >
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className="sr-only">{t('description')}</FormLabel>
                      <FormControl><Textarea {...field} rows={3} /></FormControl>
                      <FormMessage role="alert" />
                    </FormItem>
                  )}
                />
              </CompactModalSection>
              <CourseCurriculumEditor
                unavailable={curriculumUnavailable}
                onUploadBusyChange={uploadBusyChange}
                disabled={saving}
              />
            </div>
            <div className="compact-modal-footer flex flex-wrap items-center justify-end">
              {!curriculumUnavailable ? (
                <div className="mr-auto flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{t('courseBlocksStat', { count: stats.blockCount })}</span>
                  <span>{t('courseLessonsStat', { count: stats.lessonCount })}</span>
                  <span>{t('courseMaterialsStat', { count: stats.materialCount })}</span>
                </div>
              ) : null}
              <Button type="button" variant="outline" disabled={saving || uploadPending} onClick={() => changeOpen(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={saving || uploadPending}>
                {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" /> : null}
                {saving ? t('saving') : t('save')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
