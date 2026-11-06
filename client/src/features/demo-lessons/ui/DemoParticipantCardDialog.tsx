import { LoadingRegion } from '@/components/ui/loading-region';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, UserRound } from 'lucide-react';
import { demoLessonsApi } from '../api';
import { useTranslation } from '@/hooks/useTranslation';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

type Props = { demoId: number; participantId: number | null; open: boolean; onOpenChange: (open: boolean) => void };

function CardField({ label, value }: { label: string; value: string | number | null | undefined }) {
  const { t } = useTranslation();
  return <div className="min-w-0 space-y-1">
    <dt className="text-xs">{label}</dt>
    <dd className="whitespace-pre-wrap break-words text-sm">{value ?? t('demoReportNotSpecified')}</dd>
  </div>;
}

export function DemoParticipantCardDialog({ demoId, participantId, open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const query = useQuery({
    // Context data must never populate or reuse ordinary pipeline lead caches.
    queryKey: ['demo-participant-card', demoId, participantId],
    queryFn: () => demoLessonsApi.participantCard(demoId, participantId!),
    enabled: open && participantId !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const card = query.isSuccess ? query.data : null;
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent aria-describedby={undefined} className="compact-modal flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl flex-col overflow-hidden p-0">
      <DialogHeader className="compact-modal-header"><DialogTitle>{t('demoParticipantCard')}</DialogTitle></DialogHeader>
      <div className="compact-modal-body min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
        {query.isError ? <div className="space-y-3">
          <p role="status" className="text-sm text-destructive">{t('failedToLoadData')}</p>
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>{t('retry')}</Button>
        </div> : card ? <>
          {card.lead ? <CompactModalSection title={t('lead')} icon={UserRound} tone="sky" collapsible={false}>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <CardField label={t('contactPersonName')} value={card.lead.contactName} />
              <CardField label={t('phone')} value={card.lead.phone} />
              <CardField label={t('responsibleManager')} value={card.lead.managerName} />
              <CardField label={t('status')} value={card.lead.statusName} />
              <CardField label={t('source')} value={card.lead.sourceName} />
              <CardField label={t('course')} value={card.lead.courseName} />
              <CardField label={t('leadGoal')} value={card.lead.goal} />
              <CardField label={t('leadUrgency')} value={card.lead.urgency} />
              <CardField label={t('comment')} value={card.lead.comment} />
            </dl>
          </CompactModalSection> : null}
          <CompactModalSection title={t('student')} icon={BookOpen} tone="teal" collapsible={false}>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <CardField label={t('studentName')} value={card.student.studentName} />
              <CardField label={t('age')} value={card.student.studentAge} />
              <CardField label={t('contactPersonName')} value={card.student.contactName} />
              <CardField label={t('phone')} value={card.student.phone} />
              <CardField label={t('responsibleManager')} value={card.student.managerName} />
              <CardField label={t('course')} value={card.student.courseName} />
              <CardField label={t('school')} value={card.student.schoolName} />
              <CardField label={t('group')} value={card.student.groupName} />
            </dl>
          </CompactModalSection>
        </> : <LoadingRegion><Skeleton className="h-48 w-full" /></LoadingRegion>}
      </div>
      <DialogFooter className="compact-modal-footer"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('close')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
