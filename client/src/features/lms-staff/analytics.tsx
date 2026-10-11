import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LmsAnalyticsRatioDto } from "@shared/contracts/lms";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { lmsStaffApi } from "./api";
import { lmsStaffKey } from "./queries";
import { StaffField, StaffLoading, StaffError } from "./ui";

export function StaffAnalytics({
  runId,
  groupName,
}: {
  runId?: number;
  groupName?: string;
}) {
  const { t, language } = useTranslation();
  const [days, setDays] = useState<7 | 30>(7);
  const report = useQuery({
    queryKey: [...lmsStaffKey, "analytics", runId ?? null, days],
    queryFn: ({ signal }) => lmsStaffApi.analytics(days, runId, signal),
    staleTime: 15000,
  });
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 2 });
  const date = new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tashkent",
  });
  const ratio = (
    value: LmsAnalyticsRatioDto,
    label: TranslationKey,
    denominator: TranslationKey,
  ) => (
    <div className="min-w-0 rounded-lg border p-4">
      <dt className="text-sm text-muted-foreground">{t(label)}</dt>
      <dd className="mt-2 text-2xl font-semibold tabular-nums">
        {number.format(value.numerator)}
      </dd>
      <div className="mt-2 break-words text-sm text-muted-foreground">
        {t(denominator)}
        {": "}
        {number.format(value.denominator)}
      </div>
      {value.percent !== null && (
        <div className="mt-1 text-sm tabular-nums">
          {new Intl.NumberFormat(language, {
            style: "percent",
            maximumFractionDigits: 1,
          }).format(value.percent / 100)}
        </div>
      )}
    </div>
  );
  const latency = (
    value: { averageHours: number | null; samples: number },
    label: TranslationKey,
    denominator: TranslationKey,
  ) => (
    <div className="min-w-0 rounded-lg border p-4">
      <dt className="text-sm text-muted-foreground">{t(label)}</dt>
      <dd className="mt-2 text-2xl font-semibold tabular-nums">
        {value.averageHours === null
          ? t("noData")
          : number.format(value.averageHours)}
      </dd>
      <div className="mt-2 break-words text-sm text-muted-foreground">
        {t(denominator)}
        {": "}
        {number.format(value.samples)}
      </div>
    </div>
  );
  return (
    <Card>
      <CardContent className="space-y-5 p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">
              {t("lmsStaffAnalyticsTitle")}
            </h2>
            <p className="break-words text-sm text-muted-foreground">
              {groupName ?? t("lmsStaffAnalyticsAllGroups")}
            </p>
          </div>
          <StaffField
            id="learning-analytics-period"
            labelKey="lmsStaffAnalyticsPeriod"
          >
            <select
              id="learning-analytics-period"
              className="min-h-11 w-full rounded-md border bg-background px-3"
              value={days}
              onChange={(event) =>
                setDays(Number(event.target.value) as 7 | 30)
              }
            >
              <option value={7}>{t("lmsStaffAnalytics7Days")}</option>
              <option value={30}>{t("lmsStaffAnalytics30Days")}</option>
            </select>
          </StaffField>
        </div>
        {report.isPending ? (
          <StaffLoading />
        ) : report.error ? (
          <StaffError
            error={report.error}
            retry={() => {
              void report.refetch();
            }}
          />
        ) : (
          report.data && (
            <>
              <p className="text-sm text-muted-foreground">
                {date.format(new Date(report.data.periodFrom))}
                {" – "}
                {date.format(new Date(report.data.periodTo))}
              </p>
              <dl className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {ratio(
                  report.data.activatedAccounts,
                  "lmsStaffAnalyticsAccountActivated",
                  "lmsStaffAnalyticsLearners",
                )}
                {ratio(
                  report.data.learningActive,
                  "lmsStaffAnalyticsLearningActive",
                  "lmsStaffAnalyticsLearners",
                )}
                {ratio(
                  report.data.onTimeSubmissions,
                  "lmsStaffAnalyticsOnTime",
                  "lmsStaffAnalyticsDatedSubmissions",
                )}
                {ratio(
                  report.data.awaitingReview,
                  "lmsStaffAnalyticsAwaitingReview",
                  "lmsStaffAnalyticsSubmissions",
                )}
                {latency(
                  report.data.reviewLatency,
                  "lmsStaffAnalyticsReviewHours",
                  "lmsStaffAnalyticsReviewed",
                )}
                {ratio(
                  report.data.openHelp,
                  "lmsStaffAnalyticsOpenHelp",
                  "lmsStaffAnalyticsHelpCreated",
                )}
                {latency(
                  report.data.responseLatency,
                  "lmsStaffAnalyticsResponseHours",
                  "lmsStaffAnalyticsAnswered",
                )}
                {ratio(
                  report.data.absences,
                  "lmsStaffAnalyticsAbsences",
                  "lmsStaffAnalyticsMarkedLessons",
                )}
                {ratio(
                  report.data.completedMakeup,
                  "lmsStaffAnalyticsMakeupCompleted",
                  "lmsStaffAnalyticsAbsencesNeedingMakeup",
                )}
              </dl>
            </>
          )
        )}
      </CardContent>
    </Card>
  );
}
