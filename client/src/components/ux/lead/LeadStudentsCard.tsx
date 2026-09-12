import { useState, type Ref } from 'react';
import { GraduationCap, Pencil, Plus, Users } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { getInitials } from '@/lib/auth';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  cardRef: Ref<HTMLDivElement>;
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
