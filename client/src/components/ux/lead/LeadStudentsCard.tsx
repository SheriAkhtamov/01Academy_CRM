import { useState, type Ref } from 'react';
import { useMutation } from '@tanstack/react-query';
import { GraduationCap, Pencil, Plus, Users } from 'lucide-react';
import { studentsApi } from '@/features/students/api';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { getInitials } from '@/lib/auth';
import { localizeApiErrorMessage } from '@/lib/queryClient';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  CreateLeadStudentDialog,
  type LeadStudentGroupOption,
} from '@/components/ux/CreateLeadStudentDialog';
import { StudentDetailSheet } from '@/components/ux/StudentDetailSheet';

type LeadStudent = {
  id: number;
  managerId?: number | null;
  contactName?: string | null;
  studentName?: string | null;
  studentAge?: number | null;
  phone?: string | null;
  status: string;
  courseId?: number | null;
  courseName?: string | null;
  schoolId?: number | null;
  schoolName?: string | null;
  attendancePercent?: number;
  progressPercent?: number;
  nextPaymentAt?: string | null;
  createdAt?: string | null;
  groups?: Array<{
    groupId: number;
    groupName: string;
    courseId?: number | null;
    courseName?: string | null;
    schoolId?: number | null;
    isPrimary?: boolean;
    enrolledAt?: string | null;
  }>;
};

type LeadStudentsCardProps = {
  cardRef: Ref<HTMLDivElement>;
  createStudentOpen: boolean;
  onCreateStudentOpenChange: (open: boolean) => void;
  lead: {
    id: number;
    contactName: string;
    students?: LeadStudent[];
    payments?: unknown[];
  };
  groups: LeadStudentGroupOption[];
  dateTime: (value: string | null | undefined) => string;
  onRefresh: () => Promise<void>;
  onRecordPayment: () => void;
};

export function LeadStudentsCard({
  cardRef,
  createStudentOpen,
  onCreateStudentOpenChange,
  lead,
  groups,
  dateTime,
  onRefresh,
  onRecordPayment,
}: LeadStudentsCardProps) {
  const { t } = useTranslation();
  const [editingStudentId, setEditingStudentId] = useState<number | null>(null);
  const editingStudent = lead.students?.find((student) => student.id === editingStudentId) ?? null;

  const addStudentGroup = useMutation({
    mutationFn: ({ studentId, groupId, isPrimary }: { studentId: number; groupId: number; isPrimary?: boolean }) => (
      studentsApi.addGroup(studentId, groupId, isPrimary)
    ),
    onSuccess: async () => {
      toast({ title: t('studentGroupAdded') });
      await onRefresh();
    },
    onError: (error: Error & { status?: number }) => toast({
      title: t('studentGroupUpdateFailed'),
      description: localizeApiErrorMessage(error.message, error.status ?? 0),
      variant: 'destructive',
    }),
  });

  return (
    <>
      <Card ref={cardRef} tabIndex={-1} className="scroll-mt-4 overflow-hidden shadow-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <CardHeader className="flex flex-col items-start justify-between gap-3 space-y-0 sm:flex-row">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <GraduationCap className="size-4 text-muted-foreground" aria-hidden="true" />
              {t('students')}
              <Badge variant="secondary">{lead.students?.length ?? 0}</Badge>
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{t('leadStudentsHint')}</p>
          </div>
          <Button type="button" size="sm" onClick={() => onCreateStudentOpenChange(true)}>
            <Plus data-icon="inline-start" />
            {t('createStudent')}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {(lead.students ?? []).length === 0 ? (
            <div className="flex flex-col items-center px-6 py-8 text-center">
              <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Users className="size-5" />
              </span>
              <p className="font-medium">{t('noStudentsForLead')}</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('noStudentsForLeadHint')}</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {lead.students?.map((student) => {
                const studentGroups = student.groups ?? [];
                return (
                  <div key={student.id} className="flex items-start gap-3 px-5 py-4 transition-colors hover:bg-muted/30">
                    <Avatar className="size-10 border border-border bg-primary/5">
                      <AvatarFallback className="text-primary">{getInitials(student.studentName || t('student'))}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{student.studentName || t('student')}</p>
                        {student.studentAge ? <Badge variant="outline">{t('ageLabel')} {student.studentAge}</Badge> : null}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {[student.courseName, student.schoolName, student.phone].filter(Boolean).join(' · ') || t('noData')}
                      </p>
                      {studentGroups.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {studentGroups.map((group) => (
                            <Badge key={group.groupId} variant={group.isPrimary ? 'secondary' : 'outline'}>
                              {group.groupName}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <Badge className="mt-2" variant="outline">{t('noGroup')}</Badge>
                      )}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => setEditingStudentId(student.id)}
                    >
                      <Pencil data-icon="inline-start" />
                      {t('edit')}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateLeadStudentDialog
        open={createStudentOpen}
        onOpenChange={onCreateStudentOpenChange}
        leadId={lead.id}
        contactName={lead.contactName}
        groups={groups}
        onCreated={onRefresh}
      />

      {editingStudent ? (
        <StudentDetailSheet
          student={{
            ...editingStudent,
            leadId: lead.id,
            contactName: editingStudent.contactName ?? lead.contactName,
            attendancePercent: editingStudent.attendancePercent ?? 0,
            progressPercent: editingStudent.progressPercent ?? 0,
          }}
          open={editingStudentId !== null}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setEditingStudentId(null);
          }}
          initialTab="schedule"
          onRecordPayment={() => {
            setEditingStudentId(null);
            onRecordPayment();
          }}
          onAddGroup={(studentId, groupId, isPrimary) => (
            addStudentGroup.mutateAsync({ studentId, groupId, isPrimary })
          )}
          data={{ payments: lead.payments, groups }}
          dateTime={dateTime}
        />
      ) : null}
    </>
  );
}
