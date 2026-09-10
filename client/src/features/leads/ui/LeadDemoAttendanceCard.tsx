import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, CheckCircle2 } from 'lucide-react';
import { demoLessonQueryKeys, demoLessonsApi } from '@/features/demo-lessons/api';
import { invalidateSalesLeadData } from '@/features/sales/queries';
import { useTranslation } from '@/hooks/useTranslation';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function LeadDemoAttendanceCard({ leadId, dateTime, beforeMark, onTransferred }: {
  leadId: number; dateTime: (value: string) => string;
  beforeMark: (action: () => void) => void; onTransferred: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const client = useQueryClient();
  const participants = useQuery({
    queryKey: ['/api/academy/leads', leadId, 'demo-participants'],
    queryFn: () => demoLessonsApi.leadParticipants(leadId),
  });
  const mark = useMutation({
    mutationFn: ({ demoLessonId, participantId }: { demoLessonId: number; participantId: number }) => (
      demoLessonsApi.saveAttendance(demoLessonId, { participants: [{ participantId, status: 'attended' }] })
    ),
    onSuccess: async (demo) => {
      const transferred = demo.participants.some((participant) => participant.leadId === leadId
        && participant.funnelRole === 'closer' && !participant.managerId);
      // Close before refreshing queries: the previous owner no longer owns the lead.
      if (transferred) onTransferred();
      toast({ title: transferred ? t('leadSentToCloserQueue') : t('demoAttendanceSaved') });
      await Promise.all([
        invalidateSalesLeadData(client),
        client.invalidateQueries({ queryKey: demoLessonQueryKeys.all }),
      ]);
    },
  });
  if (participants.isError) return <Alert variant="destructive"><AlertDescription>
    {t('failedToLoadDemoLessons')} <Button type="button" variant="ghost" size="sm" onClick={() => participants.refetch()}>{t('retry')}</Button>
  </AlertDescription></Alert>;
  if (!participants.data?.length) return null;
  return <Card className="shadow-none">
    <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarCheck className="size-4 text-muted-foreground" />{t('demoLesson')}</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      {participants.data.map((participant) => <div key={participant.participantId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <div className="min-w-0"><p className="font-medium">{participant.studentName ?? t('student')}</p>
          <p className="text-sm text-muted-foreground">{participant.courseName} · {dateTime(participant.scheduledAt)}</p></div>
        {participant.status === 'attended'
          ? <Badge variant="secondary" className="gap-1"><CheckCircle2 className="size-3.5" />{t('demoParticipantAttended')}</Badge>
          : participant.canManage ? <Button type="button" size="sm" disabled={mark.isPending}
            onClick={() => beforeMark(() => mark.mutate(participant))}>
            {mark.isPending && mark.variables?.participantId === participant.participantId ? t('saving') : t('markLeadDemoAttended')}
          </Button> : null}
      </div>)}
      {mark.isError ? <Alert variant="destructive"><AlertDescription>{mark.error.message}</AlertDescription></Alert> : null}
    </CardContent>
  </Card>;
}
