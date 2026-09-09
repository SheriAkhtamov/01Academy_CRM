import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ArrowUpRight, Calendar, GraduationCap, MapPin, Phone, Search, User, X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { getSalesDemoStudents } from '@/features/sales/api';
import { formatAcademyDate } from '@/lib/localeFormat';
import { reportingRangeQuery } from '@/lib/reportingDateRange';
import { salesQueryKeys } from '@/features/sales/queries';
import { OverviewDialog, overviewButton } from './OverviewDialog';

export function DemoStudentsDialog({ reportingRange, managerId, onClose, onOpenLead }: {
  reportingRange: { from: string; to: string };
  managerId: number | null;
  onClose: () => void;
  onOpenLead?: (leadId: number) => void;
}) {
  const { t, language } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const reportingQuery = reportingRangeQuery(reportingRange);
  const queryString = managerId ? `${reportingQuery}&managerId=${managerId}` : reportingQuery;
  const { data: students = [], isPending, isError, refetch } = useQuery({
    queryKey: [...salesQueryKeys.demoStudents, reportingQuery, managerId],
    queryFn: () => getSalesDemoStudents(queryString),
  });
  const filtered = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();
    if (!search) return students;
    const phone = /^[\d\s()+-]+$/.test(search) ? search.replace(/\D/g, '') : '';
    return students.filter((student) => [student.studentName, student.contactName, student.phone,
      ...student.visits.map((visit) => visit.courseName)].some((value) => value?.toLowerCase().includes(search))
      || Boolean(phone && student.phone?.replace(/\D/g, '').includes(phone)));
  }, [students, searchQuery]);
  const number = new Intl.NumberFormat(language);
  const period = [reportingRange.from, reportingRange.to].map((date) => formatAcademyDate(`${date}T00:00:00+05:00`, language, {
    day: 'numeric', month: 'short', year: 'numeric',
  })).join(' — ');
  return <OverviewDialog title={t('demoStudentsModalTitle')} description={period} onClose={onClose}>
    {isError ? <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 p-4 text-sm">
      <span className="flex items-center gap-2 text-destructive"><AlertCircle className="size-4" aria-hidden="true" />{t('failedToLoadData')}</span>
      <button type="button" className={overviewButton} onClick={() => refetch()}>{t('retry')}</button>
    </div> : isPending ? <p role="status" className="py-12 text-center text-sm text-muted-foreground">{t('loading')}</p> : <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm tabular-nums" aria-live="polite">{t('students')}: {number.format(filtered.length)}{searchQuery.trim() ? ` / ${number.format(students.length)}` : ''}</p>
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)}
            aria-label={t('demoStudentsSearchPlaceholder')} placeholder={t('demoStudentsSearchPlaceholder')}
            className="h-10 w-full rounded-lg border border-border/70 bg-background pl-9 pr-10 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          {searchQuery ? <button type="button" onClick={() => setSearchQuery('')} className="absolute right-1 top-0 flex size-10 items-center justify-center text-muted-foreground"
            aria-label={t('clearSearch')}><X className="size-4" aria-hidden="true" /></button> : null}
        </div>
      </div>
      {!filtered.length ? <p className="py-10 text-center text-sm text-muted-foreground">{searchQuery.trim() ? t('demoStudentsNoResults') : t('demoStudentsEmpty')}</p> :
        <div className="space-y-3">{filtered.map((student) => {
          const name = student.studentName || student.contactName || t('student');
          const contact = student.studentName && student.contactName && student.studentName !== student.contactName ? student.contactName : null;
          return <article key={student.studentId} aria-label={name} className="rounded-xl border border-border/60 p-4">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><h3 className="break-words text-sm font-semibold">{name}</h3>
                {contact ? <p className="mt-1 text-xs text-muted-foreground">{contact}</p> : null}
                {student.phone ? <a href={`tel:${student.phone.replace(/[^\d+]/g, '')}`} className="mt-2 inline-flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground hover:text-primary"><Phone className="size-3" aria-hidden="true" />{student.phone}</a> : null}
              </div>
              {student.leadId && onOpenLead ? <button type="button" className={`${overviewButton} border text-xs`}
                onClick={() => { onClose(); onOpenLead(student.leadId!); }}><span>{t('openLeadCard')}</span><ArrowUpRight className="size-3.5" aria-hidden="true" /></button> : null}
            </header>
            <ul className="mt-3 divide-y divide-border/40">{student.visits.map((visit) => <li key={visit.participantId} className="flex flex-wrap gap-x-4 gap-y-2 py-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5 font-medium text-foreground"><GraduationCap className="size-3.5 shrink-0" aria-hidden="true" />{visit.courseName}</span>
              <span className="flex items-center gap-1.5"><Calendar className="size-3.5 shrink-0" aria-hidden="true" />{formatAcademyDate(visit.scheduledAt, language, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              <span className="flex items-center gap-1.5"><MapPin className="size-3.5 shrink-0" aria-hidden="true" />{visit.format === 'online' ? t('online') : [visit.schoolName, visit.roomName].filter(Boolean).join(' · ')}</span>
              {visit.teacherName ? <span className="flex items-center gap-1.5"><User className="size-3.5 shrink-0" aria-hidden="true" />{visit.teacherName}</span> : null}
            </li>)}</ul>
            {managerId === null && student.managerName ? <p className="border-t pt-2 text-xs text-muted-foreground">{student.managerName}</p> : null}
          </article>;
        })}</div>}
    </>}
  </OverviewDialog>;
}
