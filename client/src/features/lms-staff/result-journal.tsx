import { useState } from "react";
import { Search } from "lucide-react";
import type {
  LmsStaffSummaryDto,
  LmsStaffAssignmentResultDto,
  LmsStaffQuizResultDto,
} from "@shared/contracts/lms";
import { useTranslation } from "@/hooks/useTranslation";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { TranslationKey } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { StaffField, StaffEmpty } from "./ui";

type Filter = "all" | "notSubmitted" | "revision" | "help" | "absences";
const filters: Array<[Filter, TranslationKey]> = [
  ["all", "lmsStaffJournalAll"],
  ["notSubmitted", "lmsStaffJournalNotSubmitted"],
  ["revision", "lmsStaffJournalRevision"],
  ["help", "lmsStaffJournalHelp"],
  ["absences", "lmsStaffJournalAbsences"],
];
const statusKeys: Record<
  LmsStaffAssignmentResultDto["status"],
  TranslationKey
> = {
  assigned: "portalAssigned",
  submitted: "portalSubmitted",
  revision_required: "portalRevisionRequired",
  accepted: "portalAccepted",
  excused: "portalExcused",
  cancelled: "portalCancelled",
};
const statusTones: Record<LmsStaffAssignmentResultDto["status"], string> = {
  accepted:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  submitted:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  revision_required:
    "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  assigned: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  excused: "border-border bg-muted/60 text-muted-foreground",
  cancelled:
    "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

export function StaffResultJournal({
  students,
  onSelect,
}: {
  students: LmsStaffSummaryDto[];
  onSelect: (student: LmsStaffSummaryDto) => void;
}) {
  const { t, language } = useTranslation();
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const visible = students.filter((student) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "notSubmitted" &&
        (student.assignmentResults?.some(
          (item) => item.status === "assigned",
        ) ??
          false)) ||
      (filter === "revision" &&
        (student.assignmentResults?.some(
          (item) => item.status === "revision_required",
        ) ??
          false)) ||
      (filter === "help" && (student.openHelp ?? 0) > 0) ||
      (filter === "absences" && (student.absences ?? 0) > 0);
    if (!matchesFilter) return false;
    if (search.trim()) {
      return student.studentName
        .toLowerCase()
        .includes(search.trim().toLowerCase());
    }
    return true;
  });
  const assignments = [
    ...new Map(
      students
        .flatMap((student) => student.assignmentResults ?? [])
        .map((item) => [
          item.assignmentId,
          { id: item.assignmentId, title: item.title },
        ]),
    ).values(),
  ];
  const quizzes = [
    ...new Map(
      students
        .flatMap((student) => student.quizResults ?? [])
        .map((item) => [item.quizId, { id: item.quizId, title: item.title }]),
    ).values(),
  ];
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const assignment = (item: LmsStaffAssignmentResultDto | undefined) =>
    !item ? (
      <span className="text-xs text-muted-foreground">
        {t("lmsStaffJournalNotAssigned")}
      </span>
    ) : (
      <div className="space-y-1.5">
        <div>
          <span
            className={cn(
              "inline-flex rounded-md border px-2 py-0.5 text-xs font-medium",
              statusTones[item.status],
            )}
          >
            {t(statusKeys[item.status])}
          </span>
        </div>
        {item.gradingMode === "points" && (
          <div className="text-xs font-semibold tabular-nums">
            {item.score === null
              ? t("lmsStaffJournalNoResult")
              : `${number.format(item.score)} / ${number.format(item.maxScore ?? 0)}`}
          </div>
        )}
      </div>
    );
  const quiz = (item: LmsStaffQuizResultDto | undefined) =>
    !item ? (
      <span className="text-xs text-muted-foreground">
        {t("lmsStaffJournalNotAssigned")}
      </span>
    ) : item.status === "excused" ? (
      <span className="text-xs text-muted-foreground">
        {t("portalExcused")}
      </span>
    ) : item.status === "cancelled" ? (
      <span className="text-xs text-rose-600 dark:text-rose-400">
        {t("portalCancelled")}
      </span>
    ) : (
      <div className="space-y-1">
        <div className="text-xs font-semibold tabular-nums">
          {item.bestPercent === null
            ? t("lmsStaffJournalNoResult")
            : `${number.format(item.bestPercent)}%`}
        </div>
        {item.bestPercent !== null && (
          <div>
            <span
              className={cn(
                "inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium",
                item.passed
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
              )}
            >
              {t(item.passed ? "portalPassed" : "portalNotPassed")}
            </span>
          </div>
        )}
      </div>
    );
  const chosen =
    visible.find((student) => student.studentId === selected) ?? visible[0];
  return (
    <section className="min-w-0 space-y-4" aria-label={t("lmsStaffJournal")}>
      <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/20 p-3.5 lg:flex-row lg:items-end lg:justify-between">
        <div className="w-full sm:max-w-xs">
          <StaffField
            id="results-journal-filter"
            labelKey="lmsStaffJournalFilter"
          >
            <select
              id="results-journal-filter"
              className="min-h-10 w-full rounded-lg border bg-background px-3 text-sm"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value as Filter);
                setSelected(null);
              }}
            >
              {filters.map(([value, label]) => (
                <option key={value} value={value}>
                  {t(label)}
                </option>
              ))}
            </select>
          </StaffField>
        </div>
        <div className="relative w-full lg:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("lmsStaffSearchPlaceholder")}
            className="h-10 bg-background pl-9 text-sm"
          />
        </div>
      </div>
      {!visible.length ? (
        <StaffEmpty />
      ) : desktop ? (
        <div className="max-w-full overflow-x-auto rounded-xl border border-border/70 bg-card shadow-xs">
          <table
            className="w-full border-collapse text-sm"
            aria-label={t("lmsStaffJournal")}
          >
            <thead>
              <tr className="border-b bg-muted/40">
                <th
                  scope="col"
                  className="sticky left-0 z-10 min-w-52 bg-muted/90 p-3.5 text-left font-semibold"
                >
                  {t("student")}
                </th>
                {assignments.map((item) => (
                  <th
                    scope="col"
                    key={`assignment:${item.id}`}
                    className="min-w-44 p-3.5 text-left font-semibold"
                  >
                    <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {t("portalAssignments")}
                    </span>
                    {item.title}
                  </th>
                ))}
                {quizzes.map((item) => (
                  <th
                    scope="col"
                    key={`quiz:${item.id}`}
                    className="min-w-44 p-3.5 text-left font-semibold"
                  >
                    <span className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {t("portalTests")}
                    </span>
                    {item.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((student) => (
                <tr
                  key={student.studentId}
                  className="border-b transition-colors hover:bg-muted/20 last:border-b-0"
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-background p-3.5 text-left"
                  >
                    <Button
                      variant="link"
                      className="h-auto min-h-10 max-w-60 whitespace-normal p-0 text-left font-semibold text-foreground hover:text-primary"
                      onClick={() => onSelect(student)}
                    >
                      {student.studentName}
                    </Button>
                  </th>
                  {assignments.map((column) => (
                    <td
                      key={`assignment:${column.id}`}
                      className="p-3.5 align-top"
                    >
                      {assignment(
                        student.assignmentResults?.find(
                          (item) => item.assignmentId === column.id,
                        ),
                      )}
                    </td>
                  ))}
                  {quizzes.map((column) => (
                    <td key={`quiz:${column.id}`} className="p-3.5 align-top">
                      {quiz(
                        student.quizResults?.find(
                          (item) => item.quizId === column.id,
                        ),
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <StaffField id="results-journal-student" labelKey="student">
            <select
              id="results-journal-student"
              className="min-h-11 w-full rounded-md border bg-background px-3"
              value={chosen?.studentId ?? ""}
              onChange={(event) => setSelected(Number(event.target.value))}
            >
              {visible.map((student) => (
                <option key={student.studentId} value={student.studentId}>
                  {student.studentName}
                </option>
              ))}
            </select>
          </StaffField>
          {chosen && (
            <>
              <Button
                variant="outline"
                className="min-h-11 w-full whitespace-normal font-semibold"
                onClick={() => onSelect(chosen)}
              >
                {chosen.studentName}
              </Button>
              <div className="space-y-3">
                {assignments.map((column) => (
                  <Card key={`assignment:${column.id}`}>
                    <CardContent className="space-y-2 p-4">
                      <p className="text-xs text-muted-foreground">
                        {t("portalAssignments")}
                      </p>
                      <h3 className="break-words font-semibold">
                        {column.title}
                      </h3>
                      <div className="text-sm">
                        {assignment(
                          chosen.assignmentResults?.find(
                            (item) => item.assignmentId === column.id,
                          ),
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
                {quizzes.map((column) => (
                  <Card key={`quiz:${column.id}`}>
                    <CardContent className="space-y-2 p-4">
                      <p className="text-xs text-muted-foreground">
                        {t("portalTests")}
                      </p>
                      <h3 className="break-words font-semibold">
                        {column.title}
                      </h3>
                      <div className="text-sm">
                        {quiz(
                          chosen.quizResults?.find(
                            (item) => item.quizId === column.id,
                          ),
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
