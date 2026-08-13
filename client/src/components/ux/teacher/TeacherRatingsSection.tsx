import { useCallback, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { MessageSquareQuote, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AnalyticsChartCard,
  AnalyticsChartEmpty,
  analyticsAxisTick,
  analyticsTooltipStyle,
} from '@/components/ux/analytics/AnalyticsChartCard';
import { DataTable, type DataTableColumn } from '@/components/ux/DataTable';
import { EmptyState } from '@/components/ux/EmptyState';
import { useTranslation } from '@/hooks/useTranslation';
import { formatAcademyDate, resolveLocale } from '@/lib/localeFormat';
import {
  RATINGS_COUNT_KEYS,
  TEACHER_CARD_PADDING,
  TEACHER_TONE_CLASS,
  TEACHER_TONE_ICON_CLASS,
  academyDayKey,
  pluralForm,
  type TeacherGroup,
  type TeacherLessonSurvey,
} from '@/lib/teacherModule';
import { TruncatedText } from '@/components/ux/teacher/TruncatedText';
import { cn } from '@/lib/utils';

const CHART_HEIGHT = 'h-[260px]';
const SCORE_FILTERS = ['all', '5', '4', '3', '2', '1'] as const;

type ScoreFilter = (typeof SCORE_FILTERS)[number];

export function StarScore({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {Array.from({ length: max }).map((_, index) => (
        <Star
          key={index}
          className={cn(
            'size-3.5',
            index < Math.round(value)
              ? 'fill-amber-400 text-amber-400 dark:fill-amber-300 dark:text-amber-300'
              : 'text-muted-foreground/30',
          )}
        />
      ))}
    </span>
  );
}

interface TeacherRatingsSectionProps {
  surveys: TeacherLessonSurvey[];
  groups: TeacherGroup[];
}

/**
 * This whole section was unreachable: the router redirected `/ratings` away and
 * the navigation had no entry for it, so student feedback was collected and
 * shown to nobody. Now that it renders, the free-text answers are readable in
 * full instead of being cut at 200px with no way to expand them.
 */
export function TeacherRatingsSection({ surveys, groups }: TeacherRatingsSectionProps) {
  const { t, language } = useTranslation();
  const locale = resolveLocale(language);
  const [groupFilter, setGroupFilter] = useState('all');
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>('all');
  const [openedSurvey, setOpenedSurvey] = useState<TeacherLessonSurvey | null>(null);

  const groupNameById = useMemo(
    () => new Map(groups.map((group) => [Number(group.id), group.name])),
    [groups],
  );

  const groupCards = useMemo(() => {
    const byGroup = new Map<number, TeacherLessonSurvey[]>();
    let unattributed = 0;
    for (const survey of surveys) {
      const groupId = Number(survey.groupId);
      if (!Number.isFinite(groupId) || groupId <= 0 || !groupNameById.has(groupId)) {
        unattributed += 1;
        continue;
      }
      const bucket = byGroup.get(groupId) ?? [];
      bucket.push(survey);
      byGroup.set(groupId, bucket);
    }
    const cards = [...byGroup.entries()].map(([groupId, groupSurveys]) => ({
      groupId,
      name: groupNameById.get(groupId) ?? '',
      count: groupSurveys.length,
      average: Math.round(
        (groupSurveys.reduce((sum, survey) => sum + Number(survey.score || 0), 0) / groupSurveys.length) * 10,
      ) / 10,
    })).sort((left, right) => right.average - left.average);
    return { cards, unattributed };
  }, [groupNameById, surveys]);

  const dynamics = useMemo(() => {
    const byDate = new Map<string, { total: number; count: number }>();
    for (const survey of surveys) {
      const timestamp = new Date(survey.createdAt).getTime();
      if (!Number.isFinite(timestamp)) continue;
      const sortKey = academyDayKey(timestamp);
      const current = byDate.get(sortKey) ?? { total: 0, count: 0 };
      current.total += Number(survey.score || 0);
      current.count += 1;
      byDate.set(sortKey, current);
    }
    return [...byDate.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-30)
      .map(([sortKey, { total, count }]) => ({
        label: formatAcademyDate(`${sortKey}T00:00:00Z`, language, { day: '2-digit', month: '2-digit' }),
        average: Math.round((total / count) * 10) / 10,
        count,
      }));
  }, [language, surveys]);

  const filteredSurveys = useMemo(() => {
    const rows = surveys.filter((survey) => {
      if (groupFilter !== 'all' && String(survey.groupId ?? '') !== groupFilter) return false;
      if (scoreFilter !== 'all' && String(survey.score) !== scoreFilter) return false;
      return true;
    });
    return rows.sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );
  }, [groupFilter, scoreFilter, surveys]);

  const feedbackButton = useCallback((survey: TeacherLessonSurvey, value?: string) => {
    if (!value?.trim()) return <span className="text-muted-foreground">{t('noData')}</span>;
    return (
      <button
        type="button"
        onClick={() => setOpenedSurvey(survey)}
        className="line-clamp-2 max-w-[16rem] rounded-md text-left text-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-haspopup="dialog"
      >
        {value}
      </button>
    );
  }, [t]);

  /* Declared inline, this array was rebuilt on every filter keystroke and on
     every 30-second clock tick in the parent — and `DataTable` animates each
     row on a staggered delay, so up to 25 rows re-ran their entrance. */
  const surveyColumns = useMemo<DataTableColumn<TeacherLessonSurvey>[]>(() => [
    {
      key: 'studentName',
      header: t('student'),
      accessor: (row) => row.studentName || String(row.studentId),
      sortable: true,
    },
    {
      key: 'lesson',
      header: t('lessonColumn'),
      accessor: (row) => row.lessonTopic || String(row.lessonId),
    },
    {
      key: 'group',
      header: t('group'),
      accessor: (row) => row.groupName || t('noGroup'),
    },
    {
      key: 'score',
      header: t('score'),
      accessor: (row) => row.score,
      sortable: true,
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <StarScore value={row.score} />
          <span className="font-medium tabular-nums text-foreground">{row.score}</span>
        </span>
      ),
    },
    {
      key: 'liked',
      header: t('whatLiked'),
      accessor: (row) => row.liked || '',
      render: (row) => feedbackButton(row, row.liked),
    },
    {
      key: 'improve',
      header: t('whatImprove'),
      accessor: (row) => row.improve || '',
      render: (row) => feedbackButton(row, row.improve),
    },
    {
      key: 'createdAt',
      header: t('dateColumn'),
      accessor: (row) => formatAcademyDate(row.createdAt, language),
      sortable: true,
    },
  ], [feedbackButton, language, t]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {groupCards.cards.map((card) => (
          <Card key={card.groupId} className="min-w-0 border-border/70">
            <CardContent className={cn('flex items-start justify-between gap-3', TEACHER_CARD_PADDING)}>
              <div className="min-w-0">
                <TruncatedText text={card.name} className="block text-sm text-muted-foreground" />
                <div className="mt-1.5 text-3xl font-bold leading-none tabular-nums text-foreground">
                  {card.average}
                  <span className="ml-1 text-sm font-medium text-muted-foreground">{t('outOfFive')}</span>
                </div>
                <div className="mt-1.5">
                  <StarScore value={card.average} />
                </div>
                <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">
                  {t(RATINGS_COUNT_KEYS[pluralForm(card.count, locale)]).replace('{count}', String(card.count))}
                </p>
              </div>
              <span className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-xl',
                TEACHER_TONE_ICON_CLASS.warning,
              )}>
                <Star className="size-5" />
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      {groupCards.unattributed > 0 ? (
        <p className={cn(
          'rounded-xl border px-3 py-2 text-xs',
          TEACHER_TONE_CLASS.neutral,
        )}>
          {t('unattributedSurveysNote').replace('{count}', String(groupCards.unattributed))}
        </p>
      ) : null}

      {groupCards.cards.length === 0 ? (
        <Card className="border-dashed border-border/70">
          <CardContent className="p-0">
            <EmptyState icon={Star} title={t('noGrades')} description={t('noLessonRatingsYet')} />
          </CardContent>
        </Card>
      ) : null}

      <AnalyticsChartCard
        title={t('ratingDynamics')}
        description={t('ratingDynamicsDescription')}
        summary={t('ratingDynamicsSummary').replace('{count}', String(dynamics.length))}
        chartClassName={CHART_HEIGHT}
      >
        {dynamics.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dynamics} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 4" stroke="var(--border)" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={20} tick={analyticsAxisTick} />
              <YAxis domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} axisLine={false} tickLine={false} tick={analyticsAxisTick} />
              <Tooltip
                formatter={(value: number) => [value, t('averageScore')]}
                contentStyle={analyticsTooltipStyle}
              />
              <Area
                type="monotone"
                dataKey="average"
                stroke="var(--chart-4)"
                fill="var(--chart-4)"
                fillOpacity={0.18}
                strokeWidth={2.5}
                dot={{ r: 3, fill: 'var(--chart-4)', strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <AnalyticsChartEmpty
            title={t('notEnoughRatingData')}
            description={t('notEnoughRatingDataHint')}
          />
        )}
      </AnalyticsChartCard>

      <Card className="border-border/70">
        <CardContent className={cn('space-y-3', TEACHER_CARD_PADDING)}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold">{t('lessonFeedbackTitle')}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={groupFilter} onValueChange={setGroupFilter}>
                <SelectTrigger className="h-11 w-[190px] rounded-lg" aria-label={t('filterByGroup')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('selectAllScheduleGroups')}</SelectItem>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={String(group.id)}>{group.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={scoreFilter} onValueChange={(value) => setScoreFilter(value as ScoreFilter)}>
                <SelectTrigger className="h-11 w-[150px] rounded-lg" aria-label={t('filterByScore')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCORE_FILTERS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === 'all'
                        ? t('allScoresOption')
                        : t('scoreValueOption').replace('{score}', option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DataTable
            columns={surveyColumns}
            data={filteredSurveys}
            keyExtractor={(row) => String(row.id)}
            emptyState={(
              <EmptyState
                icon={MessageSquareQuote}
                title={t('noGrades')}
                description={t('lessonRatingsWillAppear')}
              />
            )}
          />
        </CardContent>
      </Card>

      <Dialog open={openedSurvey !== null} onOpenChange={(open) => { if (!open) setOpenedSurvey(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('lessonFeedbackDetailTitle')}</DialogTitle>
            <DialogDescription>
              {t('lessonFeedbackDetailSubtitle')
                .replace('{student}', openedSurvey?.studentName || t('student'))
                .replace('{lesson}', openedSurvey?.lessonTopic || t('lessonColumn'))}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <StarScore value={openedSurvey?.score ?? 0} />
              <Badge variant="outline" className={cn('rounded-lg border', TEACHER_TONE_CLASS.warning)}>
                {t('scoreValueOption').replace('{score}', String(openedSurvey?.score ?? 0))}
              </Badge>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('whatLiked')}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                {openedSurvey?.liked?.trim() || t('noData')}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('whatImprove')}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                {openedSurvey?.improve?.trim() || t('noData')}
              </p>
            </div>
            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={() => setOpenedSurvey(null)}>
                {t('close')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
