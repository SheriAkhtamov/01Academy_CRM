import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Clock,
  GraduationCap,
  MapPin,
  Phone,
  Search,
  User,
  X,
  XCircle,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { getSalesDemoStudents } from '@/features/sales/api';
import { formatAcademyDate } from '@/lib/localeFormat';
import { reportingRangeQuery } from '@/lib/reportingDateRange';
import { salesQueryKeys } from '@/features/sales/queries';
import { OverviewDialog, overviewButton } from './OverviewDialog';
import type { SalesDemoStudent } from './types';

interface DemoStudentsDialogProps {
  reportingRange: { from: string; to: string };
  managerId: number | null;
  onClose: () => void;
  onOpenLead?: (leadId: number) => void;
}

type TabFilter = 'all' | 'attended' | 'no_show' | 'upcoming';

export function DemoStudentsDialog({
  reportingRange,
  managerId,
  onClose,
  onOpenLead,
}: DemoStudentsDialogProps) {
  const { t, language } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabFilter>('attended');
  const [searchQuery, setSearchQuery] = useState('');

  const reportingQuery = reportingRangeQuery(reportingRange);
  const queryString = managerId
    ? `${reportingQuery}&managerId=${managerId}`
    : reportingQuery;

  const {
    data: demoStudents = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<SalesDemoStudent[]>({
    queryKey: [...salesQueryKeys.demoStudents, reportingQuery, managerId],
    queryFn: () => getSalesDemoStudents(queryString),
  });

  const counts = useMemo(() => {
    let attended = 0;
    let noShow = 0;
    let upcoming = 0;

    for (const student of demoStudents) {
      if (student.participantStatus === 'attended') {
        attended += 1;
      } else if (student.participantStatus === 'no_show') {
        noShow += 1;
      } else if (student.participantStatus === 'invited' || student.participantStatus === 'confirmed') {
        upcoming += 1;
      }
    }

    return {
      all: demoStudents.length,
      attended,
      no_show: noShow,
      upcoming,
    };
  }, [demoStudents]);

  const filteredStudents = useMemo(() => {
    let list = demoStudents;

    if (activeTab === 'attended') {
      list = list.filter((item) => item.participantStatus === 'attended');
    } else if (activeTab === 'no_show') {
      list = list.filter((item) => item.participantStatus === 'no_show');
    } else if (activeTab === 'upcoming') {
      list = list.filter((item) => item.participantStatus === 'invited' || item.participantStatus === 'confirmed');
    }

    const query = searchQuery.trim().toLowerCase();
    if (!query) return list;

    return list.filter((item) => {
      const student = item.studentName?.toLowerCase() ?? '';
      const contact = item.contactName?.toLowerCase() ?? '';
      const phone = item.phone?.toLowerCase() ?? '';
      const course = item.courseName?.toLowerCase() ?? '';
      return student.includes(query) || contact.includes(query) || phone.includes(query) || course.includes(query);
    });
  }, [activeTab, demoStudents, searchQuery]);

  const tabs: Array<{ key: TabFilter; label: string; count: number }> = [
    { key: 'attended', label: t('demoStudentsTabAttended'), count: counts.attended },
    { key: 'all', label: t('demoStudentsTabAll'), count: counts.all },
    { key: 'no_show', label: t('demoStudentsTabNoShow'), count: counts.no_show },
    { key: 'upcoming', label: t('demoStudentsTabUpcoming'), count: counts.upcoming },
  ];

  const getStatusBadge = (status: SalesDemoStudent['participantStatus']) => {
    switch (status) {
      case 'attended':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
            {t('leadStatusDemoAttended')}
          </span>
        );
      case 'no_show':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/25 bg-rose-500/10 px-2.5 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">
            <XCircle className="size-3.5 shrink-0" aria-hidden="true" />
            {t('demoParticipantNoShow')}
          </span>
        );
      case 'confirmed':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/25 bg-sky-500/10 px-2.5 py-0.5 text-xs font-medium text-sky-600 dark:text-sky-400">
            <Clock className="size-3.5 shrink-0" aria-hidden="true" />
            {t('demoParticipantConfirmed')}
          </span>
        );
      case 'invited':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/25 bg-violet-500/10 px-2.5 py-0.5 text-xs font-medium text-violet-600 dark:text-violet-400">
            <Clock className="size-3.5 shrink-0" aria-hidden="true" />
            {t('leadStatusDemoInvited')}
          </span>
        );
      case 'cancelled':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {t('demoStatusCancelled')}
          </span>
        );
    }
  };

  return (
    <OverviewDialog
      title={t('demoStudentsModalTitle')}
      description={t('demoStudentsModalDescription')}
      onClose={onClose}
    >
      <div className="space-y-4">
        {isError ? (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 p-4 text-sm">
            <span className="flex items-center gap-2 text-destructive">
              <AlertCircle className="size-4" aria-hidden="true" />
              {t('failedToLoadData')}
            </span>
            <button type="button" className={overviewButton} onClick={() => refetch()}>
              {t('retry')}
            </button>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1 rounded-xl bg-muted/50 p-1" role="tablist" aria-label={t('demoStudentsModalTitle')}>
            {tabs.map((tab) => {
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] font-semibold tabular-nums text-muted-foreground">
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('demoStudentsSearchPlaceholder')}
              className="h-9 w-full rounded-lg border border-border/70 bg-background pl-9 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={t('clearSearch')}
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <Clock className="size-4 animate-spin" aria-hidden="true" />
              {t('loading')}
            </span>
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 py-12 text-center">
            <GraduationCap className="size-8 text-muted-foreground/60" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-foreground">{t('demoStudentsEmpty')}</p>
          </div>
        ) : (
          <div className="max-h-[60dvh] space-y-2.5 overflow-y-auto pr-1">
            {filteredStudents.map((item) => {
              const displayName = item.studentName || item.contactName || '—';
              const secondaryName = item.studentName && item.contactName && item.studentName !== item.contactName
                ? item.contactName
                : null;
              const formattedDate = item.scheduledAt
                ? formatAcademyDate(item.scheduledAt, language, {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                    weekday: 'short',
                  })
                : null;

              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card/60 p-3.5 transition-colors hover:border-border hover:bg-card sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-foreground text-sm">
                        {displayName}
                      </span>
                      {secondaryName ? (
                        <span className="text-xs text-muted-foreground">
                          ({secondaryName})
                        </span>
                      ) : null}
                      {getStatusBadge(item.participantStatus)}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {item.phone ? (
                        <a
                          href={`tel:${item.phone}`}
                          className="flex items-center gap-1 hover:text-primary transition-colors"
                        >
                          <Phone className="size-3 shrink-0" aria-hidden="true" />
                          <span className="tabular-nums">{item.phone}</span>
                        </a>
                      ) : null}

                      {item.courseName ? (
                        <span className="flex items-center gap-1 font-medium text-foreground/80">
                          <GraduationCap className="size-3 shrink-0" aria-hidden="true" />
                          {item.courseName}
                        </span>
                      ) : null}

                      {formattedDate ? (
                        <span className="flex items-center gap-1">
                          <Calendar className="size-3 shrink-0" aria-hidden="true" />
                          <span>{formattedDate}</span>
                        </span>
                      ) : null}

                      {item.schoolName || item.roomName ? (
                        <span className="flex items-center gap-1">
                          <MapPin className="size-3 shrink-0" aria-hidden="true" />
                          <span>{[item.schoolName, item.roomName].filter(Boolean).join(' · ')}</span>
                        </span>
                      ) : null}

                      {item.teacherName ? (
                        <span className="flex items-center gap-1">
                          <User className="size-3 shrink-0" aria-hidden="true" />
                          <span>{item.teacherName}</span>
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {item.leadId && onOpenLead ? (
                    <div className="flex shrink-0 items-center justify-end sm:pl-3">
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenLead(item.leadId!);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/40 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={t('openLeadCard')}
                      >
                        <span>{t('openLeadCard')}</span>
                        <ArrowUpRight className="size-3.5 opacity-70" aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </OverviewDialog>
  );
}
