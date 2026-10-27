import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, UserRound, Users, X } from 'lucide-react';
import type { LessonStaffTeacher } from '@shared/contracts/lesson-staff';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { EmployeeIdentity } from '@/components/ux/EmployeeIdentity';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { useTranslation } from '@/hooks/useTranslation';
import { lessonStaffApi, lessonStaffQueryKey } from './api';
import { OrbitSpinner } from '@/components/ui/orbit-spinner';

function LessonTeacherIdentity({ teacher }: { teacher: LessonStaffTeacher }) {
  return <EmployeeIdentity userId={teacher.userId} name={teacher.fullName} wrapName showAvatar />;
}

export function LessonStaffSection({ lessonId, editable, disabled, onPendingChange }: {
  lessonId: number;
  editable: boolean;
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
}) {
  const { t } = useTranslation();
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
  const canManage = editable && staff.data?.canManage === true;
  const change = (teacherId: number, remove: boolean) => {
    if (!busy && canManage) mutation.mutate({ teacherId, remove });
  };
  const selected = new Set(staff.data?.assistants.map(teacher => teacher.id));
  const error = mutation.error?.message || t('lessonStaffSaveFailed');

  return (
    <CompactModalSection title={t('teacher')} icon={UserRound} tone="sky" collapsible={false} contentClassName="space-y-2.5">
      <div>
        {staff.isPending ? <div role="status" aria-label={t('loading')}><OrbitSpinner className="size-4" /></div>
          : staff.data ? <p className="text-sm font-semibold">{staff.data.teacher
            ? <LessonTeacherIdentity teacher={staff.data.teacher} /> : t('lessonTeacherUnassigned')}</p> : null}
      </div>
      {staff.isError ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="alert" className="text-sm text-destructive">{t('lessonStaffLoadFailed')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void staff.refetch()}>{t('retry')}</Button>
        </div>
      ) : null}
      {staff.data ? (
        <div className="space-y-2 border-t border-border/60 pt-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-muted-foreground">{t('lessonAssistants')}</h4>
            {canManage ? (
              <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
                <DialogTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 rounded-md text-xs" disabled={busy}>
                    {pending ? <OrbitSpinner className="size-3.5" /> : <Plus className="size-3.5" aria-hidden="true" />}
                    {t('lessonAssistantAdd')}
                  </Button>
                </DialogTrigger>
                <DialogContent aria-describedby={undefined} className="compact-modal flex max-w-md flex-col overflow-hidden p-0">
                  <DialogHeader className="compact-modal-header">
                    <DialogTitle className="text-base leading-6">{t('lessonAssistants')}</DialogTitle>
                  </DialogHeader>
                  <div className="compact-modal-body space-y-2 overflow-y-auto">
                    <CompactModalSection title={t('lessonAssistantAdd')} icon={Users} tone="violet" collapsible={false} contentClassName="space-y-1.5">
                      {staff.data.teachers.length ? staff.data.teachers.map(teacher => (
                        <div key={teacher.id} className={selected.has(teacher.id)
                          ? 'flex items-center gap-2.5 rounded-md border border-violet-500/30 bg-violet-500/10 px-2.5 py-2'
                          : 'flex items-center gap-2.5 rounded-md border border-border-strong bg-background px-2.5 py-2'}>
                          <Checkbox checked={selected.has(teacher.id)} disabled={busy} aria-label={teacher.fullName} onCheckedChange={checked => {
                            if (checked) change(teacher.id, false);
                            else { setMenuOpen(false); mutation.reset(); setRemoving(teacher); }
                          }} />
                          <LessonTeacherIdentity teacher={teacher} />
                        </div>
                      )) : <p className="text-sm">{t('noTeachers')}</p>}
                    </CompactModalSection>
                    {mutation.isError && !removing ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                  </div>
                </DialogContent>
              </Dialog>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {staff.data.assistants.length ? staff.data.assistants.map(teacher => (
              <span key={teacher.id} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border-strong bg-background py-1 pl-2 pr-1 text-xs">
                <LessonTeacherIdentity teacher={teacher} />
                {canManage ? <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" disabled={busy}
                  aria-label={t('lessonAssistantRemoveName', { name: teacher.fullName })}
                  onClick={() => { mutation.reset(); setRemoving(teacher); }}><X className="size-4" /></Button> : null}
              </span>
            )) : <p className="text-sm">{t('lessonAssistantsEmpty')}</p>}
          </div>
        </div>
      ) : null}
      {mutation.isError && !removing && !menuOpen ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <ConfirmDialog open={Boolean(removing)} onOpenChange={open => { if (!open && !pending) setRemoving(null); }}
        title={t('lessonAssistantRemoveTitle')} description={removing?.fullName ?? ''}
        confirmLabel={t('lessonAssistantRemove')} variant="destructive" isPending={pending} keepOpenOnConfirm
        error={mutation.isError ? error : undefined} onConfirm={() => { if (removing) change(removing.id, true); }} />
    </CompactModalSection>
  );
}
