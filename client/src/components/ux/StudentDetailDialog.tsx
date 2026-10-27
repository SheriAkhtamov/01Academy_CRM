import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, BookOpen, CheckCircle2, CreditCard, FileSignature, FolderOpen, Phone, UserRound, ShieldCheck } from 'lucide-react';
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
import { useAuth } from '@/hooks/useAuth';
import { getAssignedModules, hasLeadershipAccess } from '@shared/academy';
import { learningCapabilitiesQuery } from '@/features/learning-rollout/api';
import { StudentPortalAccessTab } from '@/features/portal-access/StudentPortalAccessTab';
import { StudentContractTab } from '@/features/student-contracts/StudentContractTab';
import './compact-modal.css';
import { LoadingRegion } from '@/components/ui/loading-region';

type StudentDetailTab = 'learning' | 'attendance' | 'portfolio' | 'payments' | 'contract' | 'access';
type StudentDetailDialogProps = Pick<StudentManagementProps, 'onUpdateStatus' | 'onAddGroup' | 'onRemoveGroup'> & {
  student: StudentProfileStudent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: StudentDetailTab;
  context?: 'sales' | 'teacher';
  onOpenLead?: (leadId: number) => void;
  onRecordPayment?: (leadId: number, studentId: number) => void;
  data?: { groups?: StudentManagementProps['availableGroups'] };
  dateTime: (value: string | null | undefined) => string;
};

export function StudentDetailDialog({
  student,
  open,
  onOpenChange,
  initialTab = 'learning',
  context = 'sales',
  onOpenLead,
  onRecordPayment,
  onUpdateStatus,
  onAddGroup,
  onRemoveGroup,
  data,
  dateTime,
}: StudentDetailDialogProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canManageContract = context !== 'teacher' && getAssignedModules(user).some(module =>
    ['administration', 'sales', 'marketing'].includes(module));
  const initialVisibleTab = initialTab === 'contract' && !canManageContract ? 'learning' : initialTab;
  const queryClient = useQueryClient();
  const onlinePbxCall = useOnlinePbxCall();
  const [heldStudent, setHeldStudent] = useState(student);
  const [activeTab, setActiveTab] = useState<StudentDetailTab>(initialVisibleTab);
  const [projectDraft, setProjectDraft] = useState({ dirty: false, pending: false });
  const [accessDraft, setAccessDraft] = useState({ dirty: false, pending: false });
  const [contractDraft, setContractDraft] = useState({ dirty: false, pending: false });
  const selectedStudent = student ?? heldStudent;
  const studentId = selectedStudent?.id;

  const profileQuery = useQuery({
    queryKey: ['student-profile', studentId, context],
    queryFn: () => studentsApi.profile(studentId!, context),
    enabled: open && Boolean(studentId),
    staleTime: 0,
  });
  const profile = profileQuery.data;
  const capabilities = useQuery({
    ...learningCapabilitiesQuery,
    enabled: open && context !== 'teacher' && Boolean(user),
  });
  const currentStudent =
    profile?.student && (!student?.updatedAt || (profile.student.updatedAt ?? '') >= student.updatedAt)
      ? profile.student
      : selectedStudent;
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['student-profile', studentId] });
  }, [queryClient, studentId]);
  const management = useStudentManagement({
    student: currentStudent,
    groups: profile?.groups ?? [],
    open,
    availableGroups: data?.groups,
    onUpdateStatus,
    onAddGroup,
    onRemoveGroup,
    onChanged: refresh,
  });
  const guard = useUnsavedChangesGuard({
    open,
    onOpenChange,
    isDirty: management.isDirty || projectDraft.dirty || accessDraft.dirty || contractDraft.dirty,
    isPending: management.isPending || projectDraft.pending || accessDraft.pending || contractDraft.pending,
  });
  const onProjectDraftChange = useCallback(
    (dirty: boolean, pending: boolean) =>
      setProjectDraft((current) =>
        current.dirty === dirty && current.pending === pending ? current : { dirty, pending },
      ),
    [],
  );
  const onAccessDraftChange = useCallback(
    (dirty: boolean, pending: boolean) =>
      setAccessDraft((current) =>
        current.dirty === dirty && current.pending === pending ? current : { dirty, pending },
      ),
    [],
  );
  const onContractDraftChange = useCallback(
    (dirty: boolean, pending: boolean) =>
      setContractDraft(current => current.dirty === dirty && current.pending === pending ? current : { dirty, pending }),
    [],
  );

  useEffect(() => {
    if (student) setHeldStudent(student);
  }, [student]);
  useEffect(() => {
    if (open) setActiveTab(initialVisibleTab);
    setProjectDraft({ dirty: false, pending: false });
  }, [open, initialVisibleTab, studentId]);

  if (!currentStudent) return null;

  const name = currentStudent.studentName || currentStudent.contactName;
  const leadId = profile?.lead?.id ?? currentStudent.leadId;
  const statusLabel =
    ({
      trial: t('studentStatusTrial'),
      studying: t('studentStatusStudying'),
      paused: t('studentStatusPaused'),
      completed: t('studentStatusCompleted'),
      expelled: t('studentStatusExpelled'),
    })[currentStudent.status] ?? t('noData');
  const statusBadgeVariant =
    currentStudent.status === 'studying'
      ? 'success'
      : currentStudent.status === 'paused'
        ? 'warning'
        : currentStudent.status === 'expelled'
          ? 'destructive'
          : 'secondary';

  const openLinkedLead = (payment: boolean) => {
    if (!leadId) return;
    guard.requestAction(() => {
      onOpenChange(false);
      if (payment) onRecordPayment?.(leadId, currentStudent.id);
      else onOpenLead?.(leadId);
    });
  };

  const tabs = [
    { value: 'learning', label: t('studentLearning'), icon: BookOpen },
    { value: 'attendance', label: t('attendanceTab'), icon: CheckCircle2 },
    { value: 'portfolio', label: t('portfolio'), icon: FolderOpen },
    { value: 'payments', label: t('navPayments'), icon: CreditCard },
    { value: 'contract', label: t('studentContract'), icon: FileSignature },
  ] as const;
  const visibleTabs = tabs.filter(tab => (context !== 'teacher' || tab.value !== 'payments')
    && (canManageContract || tab.value !== 'contract'));
  const canManageAccess = context !== 'teacher' && Boolean(user) && capabilities.data?.canManageAccess === true;
  const showAccess = canManageAccess && capabilities.data?.portalEnabled;

  return (
    <Sheet open={open} onOpenChange={guard.handleOpenChange}>
      <SheetContent
        side="right"
        className="compact-modal flex h-[100dvh] w-full flex-col gap-0 overflow-hidden p-0 sm:w-full sm:max-w-2xl"
      >
        <SheetHeader data-topographic="header" className="compact-modal-header shrink-0 space-y-2.5 border-b px-4 py-3 text-left sm:px-5">
          <div className="flex items-start gap-2.5 pr-8">
            <Avatar className="size-9 shrink-0 ring-1 ring-border">
              <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                {getInitials(name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <SheetTitle className="break-words text-base font-semibold leading-tight">{name}</SheetTitle>
                <Badge variant={statusBadgeVariant} className="h-5 px-1.5 text-[10px]">
                  {statusLabel}
                </Badge>
              </div>
              <SheetDescription asChild>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                  {context !== 'teacher' && currentStudent.phone ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 max-w-full gap-1 whitespace-normal px-2 py-0.5 text-[11px] font-medium"
                      disabled={onlinePbxCall.isPending || onlinePbxCall.isLineBusyWithReminder}
                      onClick={() => onlinePbxCall.startCall(currentStudent.phone!)}
                    >
                      <Phone className="size-3 shrink-0" data-icon="inline-start" />
                      {onlinePbxCall.isLineBusyWithReminder ? onlinePbxCall.callButtonLabel : currentStudent.phone}
                    </Button>
                  ) : null}
                  {context !== 'teacher' ? (
                    <span className="inline-flex min-w-0 items-center gap-1 rounded-md border bg-background/80 px-2 py-0.5 text-[11px]">
                      <UserRound className="size-3 shrink-0 text-muted-foreground" />
                      <span className="text-muted-foreground">{t('studentLinkedLead')}:</span>
                      <span className="truncate font-medium text-foreground">
                        {leadId ? profile?.lead?.contactName || currentStudent.contactName : t('studentNoLinkedLead')}
                      </span>
                    </span>
                  ) : null}
                  {context !== 'teacher' && leadId && onOpenLead ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1 px-2 text-[11px]"
                      onClick={() => openLinkedLead(false)}
                    >
                      {t('openLead')}
                      <ArrowUpRight className="size-3" data-icon="inline-end" />
                    </Button>
                  ) : null}
                  {context !== 'teacher' && leadId && onRecordPayment ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-6 gap-1 px-2 text-[11px]"
                      onClick={() => openLinkedLead(true)}
                    >
                      <CreditCard className="size-3" data-icon="inline-start" />
                      {t('recordAnotherPayment')}
                    </Button>
                  ) : null}
                </div>
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as StudentDetailTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="shrink-0 overflow-x-auto border-b bg-background px-4 sm:px-5">
            <TabsList
              className="compact-modal-tabs flex h-auto w-max min-w-full gap-1"
            >
              {visibleTabs.map(({ value, label, icon: Icon }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="compact-modal-tab flex-1 gap-1 px-1.5 text-xs font-medium sm:px-2.5"
                >
                  <Icon className="hidden size-3.5 shrink-0 min-[420px]:block" />
                  {label}
                </TabsTrigger>
              ))}
              {showAccess ? (
                <TabsTrigger
                  value="access"
                  className="compact-modal-tab flex-1 gap-1 px-1.5 text-xs font-medium sm:px-2.5"
                >
                  <ShieldCheck className="hidden size-3.5 shrink-0 min-[420px]:block" />
                  {t('lmsStaffAccess')}
                </TabsTrigger>
              ) : null}
            </TabsList>
          </div>

          <div className="compact-modal-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5">
            {profileQuery.isError ? (
              <div
                role="alert"
                className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs"
              >
                <p>{t('studentProfileLoadFailed')}</p>
                <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => void profileQuery.refetch()}>
                  {t('retry')}
                </Button>
              </div>
            ) : null}

            <TabsContent value="learning" className="mt-0">
              {profileQuery.isPending ? <LoadingSection /> : null}
              <StudentLearningSection
                profile={profile}
                student={currentStudent}
                management={management.controls}
                dateTime={dateTime}
                teaching={context === 'teacher'}
              />
            </TabsContent>

            <TabsContent value="attendance" className="mt-0">
              {profile ? <StudentAttendanceSection profile={profile} dateTime={dateTime} /> : <LoadingSection />}
            </TabsContent>

            <TabsContent value="portfolio" className="mt-0" forceMount hidden={activeTab !== 'portfolio'}>
              <StudentPortfolioTab
                key={currentStudent.id}
                studentId={currentStudent.id}
                projects={profile?.projects ?? []}
                open={open}
                loading={!profile}
                readOnly={context === 'teacher'}
                requestAction={guard.requestAction}
                onDraftChange={onProjectDraftChange}
                dateTime={dateTime}
              />
            </TabsContent>

            {context !== 'teacher' ? (
              <TabsContent value="payments" className="mt-0">
                {profile ? <StudentPaymentsSection profile={profile} dateTime={dateTime} /> : <LoadingSection />}
              </TabsContent>
            ) : null}

            {showAccess ? (
              <TabsContent value="access" className="mt-0" forceMount hidden={activeTab !== 'access'}>
                <StudentPortalAccessTab
                  key={currentStudent.id}
                  studentId={currentStudent.id}
                  studentName={name}
                  staffAccountId={user?.id}
                  canManageAccess={canManageAccess}
                  canSuspendAccounts={hasLeadershipAccess(user)}
                  enabled={open}
                  onDraftChange={onAccessDraftChange}
                />
              </TabsContent>
            ) : null}
            {canManageContract ? (
              <TabsContent value="contract" className="mt-0" forceMount hidden={activeTab !== 'contract'}>
                <StudentContractTab key={`${user?.id}:${currentStudent.id}`} studentId={currentStudent.id}
                  leadId={leadId} open={open} active={activeTab === 'contract'} compact onDraftChange={onContractDraftChange} />
              </TabsContent>
            ) : null}
          </div>
        </Tabs>
      </SheetContent>
      {management.confirmations}
      <UnsavedChangesDialog
        open={guard.confirmationOpen}
        onOpenChange={guard.setConfirmationOpen}
        onDiscard={guard.discardChanges}
      />
    </Sheet>
  );
}

function LoadingSection() {
  const { t } = useTranslation();
  return (
    <LoadingRegion role="status" aria-label={t('loading')} className="space-y-2">
      <Skeleton className="h-14 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
    </LoadingRegion>
  );
}
