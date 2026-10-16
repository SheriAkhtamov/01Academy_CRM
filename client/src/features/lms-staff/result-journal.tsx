import { useState } from "react";
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
  const [selected, setSelected] = useState<number | null>(null);
  const visible = students.filter(
    (student) =>
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
      (filter === "absences" && (student.absences ?? 0) > 0),
  );
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
      t("lmsStaffJournalNotAssigned")
    ) : (
      <div className="space-y-1">
        <div>{t(statusKeys[item.status])}</div>
        {item.gradingMode === "points" && (
          <div className="font-medium tabular-nums">
            {item.score === null
              ? t("lmsStaffJournalNoResult")
              : `${number.format(item.score)} / ${number.format(item.maxScore ?? 0)}`}
          </div>
        )}
      </div>
    );
  const quiz = (item: LmsStaffQuizResultDto | undefined) =>
    !item ? (
      t("lmsStaffJournalNotAssigned")
    ) : item.status === "excused" ? (
      t("portalExcused")
    ) : item.status === "cancelled" ? (
      t("portalCancelled")
    ) : (
      <div className="space-y-1">
        <div className="font-medium tabular-nums">
          {item.bestPercent === null
            ? t("lmsStaffJournalNoResult")
            : `${number.format(item.bestPercent)}%`}
        </div>
        {item.bestPercent !== null && (
          <div>{t(item.passed ? "portalPassed" : "portalNotPassed")}</div>
        )}
      </div>
    );
  const chosen =
    visible.find((student) => student.studentId === selected) ?? visible[0];
  return (
    <section className="min-w-0 space-y-4" aria-label={t("lmsStaffJournal")}>
      <StaffField id="results-journal-filter" labelKey="lmsStaffJournalFilter">
        <select
          id="results-journal-filter"
          className="min-h-11 w-full rounded-md border bg-background px-3 sm:max-w-sm"
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
      {!visible.length ? (
        <StaffEmpty />
      ) : desktop ? (
        <div className="max-w-full overflow-x-auto rounded-xl border">
          <table
            className="w-full border-collapse text-sm"
            aria-label={t("lmsStaffJournal")}
          >
            <thead>
              <tr className="border-b bg-muted/50">
                <th
                  scope="col"
                  className="sticky left-0 z-10 min-w-52 bg-muted p-3 text-left"
                >
                  {t("student")}
                </th>
                {assignments.map((item) => (
                  <th
                    scope="col"
                    key={`assignment:${item.id}`}
                    className="min-w-44 p-3 text-left"
                  >
                    <span className="block text-xs font-normal text-muted-foreground">
                      {t("portalAssignments")}
                    </span>
                    {item.title}
                  </th>
                ))}
                {quizzes.map((item) => (
                  <th
                    scope="col"
                    key={`quiz:${item.id}`}
                    className="min-w-44 p-3 text-left"
                  >
                    <span className="block text-xs font-normal text-muted-foreground">
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
                  className="border-b last:border-b-0"
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-background p-3 text-left"
                  >
                    <Button
                      variant="link"
                      className="h-auto min-h-11 max-w-60 whitespace-normal p-0 text-left"
                      onClick={() => onSelect(student)}
                    >
                      {student.studentName}
                    </Button>
                  </th>
                  {assignments.map((column) => (
                    <td
                      key={`assignment:${column.id}`}
                      className="p-3 align-top"
                    >
                      {assignment(
                        student.assignmentResults?.find(
                          (item) => item.assignmentId === column.id,
                        ),
                      )}
                    </td>
                  ))}
                  {quizzes.map((column) => (
                    <td key={`quiz:${column.id}`} className="p-3 align-top">
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
                className="min-h-11 w-full whitespace-normal"
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
