import { useCallback, useRef, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { CourseValues } from '@/lib/academyResourceSchemas';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { CourseCurriculumEditor } from './CourseCurriculumEditor';

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
  const uploading = useRef(new Set<string>());
  const [uploadPending, setUploadPending] = useState(false);
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
      <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>{editing ? t('editCourse') : t('addCourse')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => {
            if (uploading.current.size > 0 || saving) { event.preventDefault(); return; }
            void form.handleSubmit((values) => {
              if (uploading.current.size === 0 && !saving) onSubmit(values);
            })(event);
          }}>
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
              <fieldset disabled={saving} className="space-y-6">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel required>{t('courseName')}</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="ageCategory" render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t('ageCategory')}</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="basePriceUzs" render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t('basePrice')}</FormLabel>
                      <FormControl><Input type="number" min="0" step="1000" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="description" render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>{t('description')}</FormLabel>
                      <FormControl><Textarea {...field} rows={3} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="isActive" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border border-border p-3">
                    <FormLabel>{t('activeCourse')}</FormLabel>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
                <CourseCurriculumEditor unavailable={curriculumUnavailable} onUploadBusyChange={uploadBusyChange} disabled={saving} />
              </fieldset>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t bg-background/95 px-6 py-4">
              <Button type="button" variant="outline" disabled={saving || uploadPending} onClick={() => changeOpen(false)}>{t('cancel')}</Button>
              <Button type="submit" disabled={saving || uploadPending}>{saving ? t('saving') : t('save')}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
