import { useEffect, useState } from 'react';
import { Phone } from 'lucide-react';
import type { VoiceReminderAttemptSummary, VoiceReminderRunSummary } from '@shared/contracts/voice-reminders';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAcademyDate } from '@/lib/localeFormat';
import { reminderOutcomeLabels, reminderProgressLabels, reminderReasonLabels } from '@/features/voice-reminders/results';
import type { DemoLessonParticipant } from '../api';

function ReminderAttempt({ call, number }: { call: VoiceReminderAttemptSummary; number: number }) {
  const { t, language } = useTranslation();
  const time = (value: string) => formatAcademyDate(value, language, {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const label = call.response === 'yes' ? 'telephonyReminderResponseYes'
    : call.response === 'no' ? 'telephonyReminderResponseNo'
      : call.reason ? reminderReasonLabels[call.reason]
        : call.outcome ? reminderOutcomeLabels[call.outcome]
          : !call.endedAt ? 'voiceRemindersCalling' : 'voiceRemindersResultUnknown';
  return <li className="space-y-2 rounded-md border bg-background p-3">
    <div className="flex flex-wrap items-start justify-between gap-2 text-xs">
      <span className="font-medium">{t(call.responseRetry ? 'voiceRemindersConfirmationRetry' : 'voiceRemindersAttemptNumber', { number })}</span>
      <time dateTime={call.startedAt}>{time(call.startedAt)}</time>
    </div>
    <Badge variant="secondary" className="max-w-full whitespace-normal">{t(label)}</Badge>
    {call.answeredAt ? <dl className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
      <dt>{t('voiceRemindersAnsweredAt')}</dt><dd>{time(call.answeredAt)}</dd>
      <dt>{t('voiceRemindersTalkSeconds')}</dt><dd>{call.talkSeconds}</dd>
    </dl> : null}
    {call.causeUnspecified ? <p className="text-xs">{t('voiceRemindersCauseUnspecified')}</p> : null}
    {call.endedAt && !call.terminationConfirmed ? <p className="text-xs">{t('voiceRemindersEndUnconfirmed')}</p> : null}
  </li>;
}

function ReminderRun({ run }: { run: VoiceReminderRunSummary }) {
  const { t, language } = useTranslation();
  const primaryAttempts = run.calls.filter(call => !call.responseRetry).length;
  return <CompactModalSection title={t(run.kind === 'day_before' ? 'voiceRemindersDayBeforeCalls' : 'voiceRemindersSameDayCalls')}
    icon={Phone} tone={run.kind === 'day_before' ? 'sky' : 'teal'} collapsible={false} contentClassName="space-y-3">
    <dl className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
      <dt>{t('voiceRemindersAttemptsUsed')}</dt><dd>{t('voiceRemindersAttemptCount', { count: primaryAttempts, limit: run.attemptLimit })}</dd>
      {run.nextAttemptAt ? <>
        <dt>{t(run.responseRetry ? 'voiceRemindersConfirmationRetry' : 'voiceRemindersNextCall')}</dt>
        <dd>{formatAcademyDate(run.nextAttemptAt, language, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</dd>
      </> : null}
    </dl>
    {run.calls.length ? <ol className="space-y-2">
      {run.calls.map((call, index) => <ReminderAttempt key={call.startedAt} call={call} number={index + 1} />)}
    </ol> : <p className="text-sm">{t('voiceRemindersNoCalls')}</p>}
  </CompactModalSection>;
}

export function DemoReminderStatus({ participant, parentOpen }: { participant: DemoLessonParticipant; parentOpen: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!parentOpen) setOpen(false); }, [parentOpen]);
  const label = participant.reminderResponse === 'yes' ? 'voiceRemindersResponseYes'
    : participant.reminderResponse === 'no' ? 'voiceRemindersResponseNo'
      : participant.reminderDeliveryStatus === 'delivered_no_response' ? 'voiceRemindersDeliveredNoResponse'
        : participant.reminderProgressStatus ? reminderProgressLabels[participant.reminderProgressStatus] : null;
  if (!label || participant.canManage === false) return null;
  const badge = <Badge variant={participant.reminderResponse === 'yes' ? 'success' : 'secondary'} className="max-w-full whitespace-normal text-left">{t(label)}</Badge>;
  const runs = participant.reminderRuns;
  if (!runs?.length) return badge;
  const name = participant.studentName || participant.contactName || t('restrictedLead');
  return <Dialog open={open && parentOpen} onOpenChange={setOpen}>
    <DialogTrigger asChild><button type="button"
      aria-label={t('voiceRemindersOpenCallDetails', { name, status: t(label) })}
      className="max-w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {badge}
    </button></DialogTrigger>
      <DialogContent className="compact-modal flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg flex-col overflow-hidden p-0" aria-describedby={undefined}>
        <DialogHeader className="compact-modal-header"><DialogTitle>{t('voiceRemindersCallDetails')}</DialogTitle></DialogHeader>
        <div className="compact-modal-body min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
          <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">{name}</p>
          {runs.map((run, index) => <ReminderRun key={`${run.kind}-${index}`} run={run} />)}
        </div>
        <DialogFooter className="compact-modal-footer"><Button type="button" variant="outline" onClick={() => setOpen(false)}>{t('close')}</Button></DialogFooter>
      </DialogContent>
  </Dialog>;
}
