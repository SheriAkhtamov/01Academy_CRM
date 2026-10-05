import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, BookOpen, CheckCircle2, CreditCard, FolderOpen, Phone, UserRound } from 'lucide-react';
import type { StudentProfileStudent } from '@shared/contracts/student-profile';
import { studentsApi } from '@/features/students/api';
import { useTranslation } from '@/hooks/useTranslation';
import { useOnlinePbxCall } from '@/hooks/useOnlinePbxCall';
import { getInitials } from '@/lib/auth';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { StudentPortfolioTab } from './student/StudentPortfolioTab';
import { StudentLearningSection, StudentAttendanceSection, StudentPaymentsSection } from './student/StudentProfileSections';
import { useStudentManagement, type StudentManagementProps } from './student/useStudentManagement';

type StudentDetailTab = 'learning' | 'attendance' | 'portfolio' | 'payments';
type StudentDetailDialogProps = Pick<StudentManagementProps, 'onUpdateStatus' | 'onAddGroup' | 'onRemoveGroup'> & {
  student: StudentProfileStudent | null;
  open: boolean; onOpenChange: (open: boolean) => void;
  initialTab?: StudentDetailTab;
  context?: 'sales' | 'teacher';
  onOpenLead?: (leadId: number) => void;
  onRecordPayment?: (leadId: number, studentId: number) => void;
  data?: { groups?: StudentManagementProps['availableGroups'] };
  dateTime: (value: string | null | undefined) => string;
};
export function StudentDetailDialog({ student, open, onOpenChange, initialTab = 'learning', context = 'sales', onOpenLead, onRecordPayment, onUpdateStatus, onAddGroup, onRemoveGroup, data, dateTime }: StudentDetailDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const onlinePbxCall = useOnlinePbxCall();
  const [heldStudent, setHeldStudent] = useState(student);
  const [activeTab, setActiveTab] = useState<StudentDetailTab>(initialTab);
  const [projectDraft, setProjectDraft] = useState({ dirty: false, pending: false });
  const selectedStudent = student ?? heldStudent;
  const studentId = selectedStudent?.id;
  const profileQuery = useQuery({ queryKey: ['student-profile', studentId, context], queryFn: () => studentsApi.profile(studentId!, context), enabled: open && Boolean(studentId), staleTime: 0 });
  const profile = profileQuery.data;
  const currentStudent = profile?.student && (!student?.updatedAt || (profile.student.updatedAt ?? '') >= student.updatedAt)
    ? profile.student : selectedStudent;
  const refresh = useCallback(() => { void queryClient.invalidateQueries({ queryKey: ['student-profile', studentId] }); }, [queryClient, studentId]);
  const management = useStudentManagement({ student: currentStudent, groups: profile?.groups ?? [], open,
    availableGroups: data?.groups, onUpdateStatus, onAddGroup, onRemoveGroup, onChanged: refresh });
  const guard = useUnsavedChangesGuard({ open, onOpenChange, isDirty: management.isDirty || projectDraft.dirty, isPending: management.isPending || projectDraft.pending });
  const onProjectDraftChange = useCallback((dirty: boolean, pending: boolean) => setProjectDraft((current) => current.dirty === dirty && current.pending === pending ? current : { dirty, pending }), []);
  useEffect(() => { if (student) setHeldStudent(student); }, [student]);
  useEffect(() => { if (open) setActiveTab(initialTab); setProjectDraft({ dirty: false, pending: false }); }, [open, initialTab, studentId]);
  if (!currentStudent) return null;
  const name = currentStudent.studentName || currentStudent.contactName;
  const leadId = profile?.lead?.id ?? currentStudent.leadId;
  const statusLabel = ({ trial: t('studentStatusTrial'), studying: t('studentStatusStudying'), paused: t('studentStatusPaused'), completed: t('studentStatusCompleted'), expelled: t('studentStatusExpelled') })[currentStudent.status] ?? t('noData');
  const openLinkedLead = (payment: boolean) => {
    if (!leadId) return;
    guard.requestAction(() => { onOpenChange(false); if (payment) onRecordPayment?.(leadId, currentStudent.id); else onOpenLead?.(leadId); });
  };
  const tabs = [{ value: 'learning', label: t('studentLearning'), icon: BookOpen }, { value: 'attendance', label: t('attendanceTab'), icon: CheckCircle2 }, { value: 'portfolio', label: t('portfolio'), icon: FolderOpen }, { value: 'payments', label: t('navPayments'), icon: CreditCard }] as const;
  const visibleTabs = context === 'teacher' ? tabs.filter((tab) => tab.value !== 'payments') : tabs;
  return <Sheet open={open} onOpenChange={guard.handleOpenChange}>
    <SheetContent side="right" className="flex h-[100dvh] w-full flex-col gap-0 overflow-hidden p-0 sm:w-full sm:max-w-4xl">
      <SheetHeader className="max-h-[45dvh] shrink-0 space-y-4 overflow-y-auto overscroll-contain border-b px-4 pb-4 pt-5 text-left sm:px-6">
        <div className="flex items-start gap-3 pr-8"><Avatar className="size-11 shrink-0"><AvatarFallback className="bg-primary/10 font-semibold text-primary">{getInitials(name)}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><SheetTitle className="break-words text-xl">{name}</SheetTitle><SheetDescription asChild><div className="mt-1.5 flex flex-wrap items-center gap-2"><Badge variant="secondary">{statusLabel}</Badge>{context !== 'teacher' && currentStudent.phone ? <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={onlinePbxCall.isPending} onClick={() => onlinePbxCall.startCall(currentStudent.phone!)}><Phone data-icon="inline-start" />{currentStudent.phone}</Button> : null}</div></SheetDescription></div></div>
        {context !== 'teacher' ? <div className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2.5"><UserRound className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="text-[11px] font-medium text-muted-foreground">{t('studentLinkedLead')}</p><p className="break-words text-sm font-medium">{leadId ? profile?.lead?.contactName || currentStudent.contactName : t('studentNoLinkedLead')}</p></div>{leadId && onOpenLead ? <Button size="sm" variant="outline" className="shrink-0" onClick={() => openLinkedLead(false)}>{t('openLead')}<ArrowUpRight data-icon="inline-end" /></Button> : null}</div> : null}
      </SheetHeader>
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as StudentDetailTab)} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b px-4 py-3 sm:px-6"><TabsList className={`grid h-auto w-full gap-1 bg-muted/60 p-1 ${context === 'teacher' ? 'grid-cols-3' : 'grid-cols-4'}`}>{visibleTabs.map(({ value, label, icon: Icon }) => <TabsTrigger key={value} value={value} className="min-h-10 gap-1.5 px-1 text-[11px] sm:px-3 sm:text-sm"><Icon className="hidden size-4 shrink-0 min-[420px]:block" />{label}</TabsTrigger>)}</TabsList></div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          {profileQuery.isError ? <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm"><p>{t('studentProfileLoadFailed')}</p><Button size="sm" variant="outline" onClick={() => void profileQuery.refetch()}>{t('retry')}</Button></div> : null}
          <TabsContent value="learning" className="mt-0">{profileQuery.isPending ? <LoadingSection /> : null}<StudentLearningSection profile={profile} student={currentStudent} management={management.controls} dateTime={dateTime} teaching={context === 'teacher'} /></TabsContent>
          <TabsContent value="attendance" className="mt-0">{profile ? <StudentAttendanceSection profile={profile} dateTime={dateTime} /> : <LoadingSection />}</TabsContent>
          <TabsContent value="portfolio" className="mt-0" forceMount hidden={activeTab !== 'portfolio'}><StudentPortfolioTab key={currentStudent.id} studentId={currentStudent.id} projects={profile?.projects ?? []} open={open} loading={!profile} readOnly={context === 'teacher'} requestAction={guard.requestAction} onDraftChange={onProjectDraftChange} dateTime={dateTime} /></TabsContent>
          {context !== 'teacher' ? <TabsContent value="payments" className="mt-0">{profile ? <StudentPaymentsSection profile={profile} dateTime={dateTime} /> : <LoadingSection />}</TabsContent> : null}
        </div>
      </Tabs>
      {context !== 'teacher' && leadId && onRecordPayment ? <div className="flex shrink-0 justify-end border-t bg-muted/20 px-4 py-3 sm:px-6"><Button size="sm" onClick={() => openLinkedLead(true)}><CreditCard data-icon="inline-start" />{t('recordAnotherPayment')}</Button></div> : null}
    </SheetContent>
    {management.confirmations}
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
  </Sheet>;
}
function LoadingSection() { const { t } = useTranslation(); return <div role="status" aria-label={t('loading')} className="space-y-3"><Skeleton className="h-20 w-full rounded-xl" /><Skeleton className="h-20 w-full rounded-xl" /><Skeleton className="h-20 w-full rounded-xl" /></div>; }
