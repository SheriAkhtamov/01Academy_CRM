import { useState, type Ref } from 'react';
import { GraduationCap, Pencil, Plus, Users } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { getInitials } from '@/lib/auth';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LeadWorkspaceSection } from './LeadWorkspaceSection';
import {
  CreateLeadStudentDialog,
  EditLeadStudentDialog,
  type LeadStudentGroupOption,
} from '@/components/ux/CreateLeadStudentDialog';

type LeadStudent = {
  id: number;
  studentName?: string | null;
  studentAge?: number | null;
  phone?: string | null;
  expectedPaymentUzs?: number | null;
  updatedAt?: string | null;
  courseId?: number | null;
  courseName?: string | null;
  schoolId?: number | null;
  schoolName?: string | null;
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
  cardRef: Ref<HTMLDetailsElement>;
  expanded: boolean;
  disabled?: boolean;
  onExpandedChange: (open: boolean) => void;
  createStudentOpen: boolean;
  onCreateStudentOpenChange: (open: boolean) => void;
  lead: {
    id: number;
    contactName: string;
    students?: LeadStudent[];
  };
  groups: LeadStudentGroupOption[];
  onRefresh: () => Promise<void>;
};

export function LeadStudentsCard({
  cardRef,
  expanded,
  disabled,
  onExpandedChange,
  createStudentOpen,
  onCreateStudentOpenChange,
  lead,
  groups,
  onRefresh,
}: LeadStudentsCardProps) {
  const { t } = useTranslation();
  const [editingStudentId, setEditingStudentId] = useState<number | null>(null);
  const editingStudent = lead.students?.find((student) => student.id === editingStudentId) ?? null;

  return (
    <>
      <LeadWorkspaceSection
        section="students"
        cardRef={cardRef}
        title={t('students')}
        icon={GraduationCap}
        count={lead.students?.length ?? 0}
        open={expanded}
        disabled={disabled}
        onOpenChange={onExpandedChange}
        summary={lead.students?.length
          ? lead.students.map((student) => [student.studentName || t('student'), student.courseName].filter(Boolean).join(' — ')).join(', ')
          : t('noStudentsForLead')}
        contentClassName="!p-0"
      >
        <div className="flex justify-end border-b border-border/60 px-3 py-2">
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => onCreateStudentOpenChange(true)}>
            <Plus data-icon="inline-start" />
            {t('createStudent')}
          </Button>
        </div>
        {(lead.students ?? []).length === 0 ? (
          <div className="flex items-center gap-3 px-3 py-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-muted-foreground">
              <Users className="size-5" />
            </span>
            <p className="text-sm text-muted-foreground">{t('noStudentsForLead')}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {lead.students?.map((student) => {
              const studentGroups = student.groups ?? [];
              return (
                <div key={student.id} className="flex flex-wrap items-start gap-2.5 px-3 py-3 transition-colors hover:bg-muted/30">
                  <Avatar className="size-8 border border-border bg-primary/5">
                    <AvatarFallback className="text-primary">{getInitials(student.studentName || t('student'))}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 basis-32">
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
      </LeadWorkspaceSection>

      <CreateLeadStudentDialog
        open={createStudentOpen}
        onOpenChange={onCreateStudentOpenChange}
        leadId={lead.id}
        contactName={lead.contactName}
        groups={groups}
        onCreated={onRefresh}
      />

      {editingStudent ? (
        <EditLeadStudentDialog
          student={editingStudent}
          open={editingStudentId !== null}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setEditingStudentId(null);
          }}
          leadId={lead.id}
          contactName={lead.contactName}
          groups={groups}
          onUpdated={async () => {
            await onRefresh();
            setEditingStudentId(null);
          }}
        />
      ) : null}
    </>
  );
}
