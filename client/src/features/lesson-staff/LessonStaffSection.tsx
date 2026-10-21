import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Loader2, UserRound, X } from 'lucide-react';
import type { LessonStaffTeacher } from '@shared/contracts/lesson-staff';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/hooks/useTranslation';
import { lessonStaffApi, lessonStaffQueryKey } from './api';

export function LessonStaffSection({ lessonId, editable, disabled, onPendingChange }: {
  lessonId: number;
  editable: boolean;
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const client = useQueryClient();
  const [removing, setRemoving] = useState<LessonStaffTeacher | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const staff = useQuery({ queryKey: lessonStaffQueryKey(lessonId), queryFn: () => lessonStaffApi.get(lessonId), staleTime: 0 });
  const mutation = useMutation({
    mutationFn: ({ teacherId, remove }: { teacherId: number; remove: boolean }) => (
      remove ? lessonStaffApi.remove(lessonId, teacherId) : lessonStaffApi.add(lessonId, teacherId)
    ),
    onMutate: () => client.cancelQueries({ queryKey: lessonStaffQueryKey(lessonId) }),
    onSuccess: data => {
      client.setQueryData(lessonStaffQueryKey(lessonId), data);
      setRemoving(null);
    },
  });
  const pending = mutation.isPending;
  useEffect(() => { onPendingChange?.(pending); }, [pending, onPendingChange]);
  useEffect(() => () => onPendingChange?.(false), [onPendingChange]);
  const busy = disabled || pending;
  const change = (teacherId: number, remove: boolean) => {
    if (!busy && editable) mutation.mutate({ teacherId, remove });
  };
  const selected = new Set(staff.data?.assistants.map(teacher => teacher.id));
  const error = mutation.error?.message || t('lessonStaffSaveFailed');

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
      <div>
        <h3 id={`${id}-title`} className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <UserRound className="size-4" aria-hidden="true" />{t('teacher')}
        </h3>
        {staff.isPending ? <div role="status" aria-label={t('loading')}><Loader2 className="size-4 animate-spin" /></div>
          : staff.data ? <p className="break-words text-sm font-semibold">{staff.data.teacher?.fullName ?? t('lessonTeacherUnassigned')}</p> : null}
      </div>
      {staff.isError ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="alert" className="text-sm text-destructive">{t('lessonStaffLoadFailed')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void staff.refetch()}>{t('retry')}</Button>
        </div>
      ) : null}
      {staff.data ? (
        <div className="space-y-2 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-muted-foreground">{t('lessonAssistants')}</h4>
            {editable ? (
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="min-h-11 gap-2" disabled={busy}>
                    {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                    {t('lessonAssistantAdd')}<ChevronDown className="size-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-64 min-w-56 max-w-[calc(100vw-3rem)] overflow-y-auto">
                  {staff.data.teachers.length ? staff.data.teachers.map(teacher => (
                    <DropdownMenuCheckboxItem key={teacher.id} checked={selected.has(teacher.id)} disabled={busy}
                      onSelect={event => event.preventDefault()}
                      onCheckedChange={checked => {
                        if (checked) change(teacher.id, false);
                        else { setMenuOpen(false); mutation.reset(); setRemoving(teacher); }
                      }}>
                      <span className="break-words">{teacher.fullName}</span>
                    </DropdownMenuCheckboxItem>
                  )) : <p className="p-2 text-sm">{t('noTeachers')}</p>}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {staff.data.assistants.length ? staff.data.assistants.map(teacher => (
              <span key={teacher.id} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-background py-1 pl-3 pr-1 text-sm">
                <span className="min-w-0 break-words">{teacher.fullName}</span>
                {editable ? <Button type="button" variant="ghost" size="icon" className="size-9 shrink-0" disabled={busy}
                  aria-label={t('lessonAssistantRemoveName', { name: teacher.fullName })}
                  onClick={() => { mutation.reset(); setRemoving(teacher); }}><X className="size-4" /></Button> : null}
              </span>
            )) : <p className="text-sm">{t('lessonAssistantsEmpty')}</p>}
          </div>
        </div>
      ) : null}
      {mutation.isError && !removing ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <ConfirmDialog open={Boolean(removing)} onOpenChange={open => { if (!open && !pending) setRemoving(null); }}
        title={t('lessonAssistantRemoveTitle')} description={removing?.fullName ?? ''}
        confirmLabel={t('lessonAssistantRemove')} variant="destructive" isPending={pending} keepOpenOnConfirm
        error={mutation.isError ? error : undefined} onConfirm={() => { if (removing) change(removing.id, true); }} />
    </section>
  );
}
