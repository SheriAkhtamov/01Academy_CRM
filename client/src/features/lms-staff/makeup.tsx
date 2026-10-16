import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { LmsStaffMakeupDto } from "@shared/contracts/lms";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { lmsStaffApi } from "./api";
import { useStaffQuery, useStaffInvalidate } from "./queries";
import {
  StaffDialog,
  StaffConfirm,
  StaffField,
  StaffLoading,
  StaffError,
  StaffEmpty,
  StaffStatus,
  staffDateInput,
  staffDateIso,
  useStaffError,
  useStaffFormat,
} from "./ui";
export function StaffMakeup({ runId }: { runId: number }) {
  const { t } = useTranslation();
  const date = useStaffFormat();
  const [selected, setSelected] = useState<LmsStaffMakeupDto | null>(null);
  const query = useStaffQuery("makeup", runId, (signal) =>
    lmsStaffApi.makeup(runId, signal),
  );
  if (query.isPending) return <StaffLoading />;
  if (query.error)
    return (
      <StaffError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <h2 className="text-xl font-semibold">{t("portalMakeup")}</h2>
        <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold tabular-nums">
          {query.data.length}
        </span>
      </div>
      {!query.data.length && <StaffEmpty />}
      <div className="grid gap-3 md:grid-cols-2">
        {query.data.map((plan) => (
          <Card
            key={plan.id}
            className="border-border/70 transition-colors hover:border-primary/30"
          >
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
              <div className="min-w-0 space-y-2">
                <h3 className="break-words font-semibold">
                  {plan.studentName}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {plan.topic} · {date(plan.scheduledAt)}
                </p>
                <StaffStatus state={plan.status} />
              </div>
              {["needed", "in_progress"].includes(plan.status) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelected(plan)}
                >
                  {t("lmsStaffMakeupPractice")}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {selected && (
        <MakeupEditor
          key={selected.id}
          plan={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
function MakeupEditor({
  plan,
  onClose,
}: {
  plan: LmsStaffMakeupDto;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const message = useStaffError();
  const invalidate = useStaffInvalidate();
  const options = useStaffQuery("makeup-options", plan.id, (signal) =>
    lmsStaffApi.makeupOptions(plan.id, signal),
  );
  const [assignment, setAssignment] = useState(String(plan.recipientId ?? ""));
  const [quiz, setQuiz] = useState(String(plan.quizRecipientId ?? ""));
  const [due, setDue] = useState(staffDateInput(plan.dueAt));
  const [confirmation, setConfirmation] = useState(false);
  const action = useMutation({
    mutationFn: (complete: boolean) =>
      lmsStaffApi.updateMakeup(plan.id, {
        recipientId: assignment ? Number(assignment) : null,
        quizRecipientId: quiz ? Number(quiz) : null,
        dueAt: due ? staffDateIso(due) : null,
        complete,
      }),
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  return (
    <StaffDialog
      open
      onClose={onClose}
      titleKey="lmsStaffMakeupPractice"
      description={`${plan.studentName} · ${plan.topic}`}
      dirty={
        assignment !== String(plan.recipientId ?? "") ||
        quiz !== String(plan.quizRecipientId ?? "") ||
        due !== staffDateInput(plan.dueAt)
      }
      pending={action.isPending}
    >
      {options.isPending ? (
        <StaffLoading />
      ) : options.error ? (
        <StaffError
          error={options.error}
          retry={() => {
            void options.refetch();
          }}
        />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              (plan.recipientId && !assignment) ||
              (plan.quizRecipientId && !quiz)
            )
              setConfirmation(true);
            else action.mutate(false);
          }}
        >
          <StaffField id="makeup-assignment" labelKey="lmsStaffAssignments">
            <select
              id="makeup-assignment"
              className="min-h-11 w-full rounded-md border bg-background px-3"
              value={assignment}
              onChange={(event) => {
                setAssignment(event.target.value);
                setQuiz("");
              }}
            >
              <option value="">{t("lmsStaffNoPractice")}</option>
              {options.data?.assignments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </StaffField>
          <StaffField id="makeup-quiz" labelKey="lmsStaffQuizzes">
            <select
              id="makeup-quiz"
              className="min-h-11 w-full rounded-md border bg-background px-3"
              value={quiz}
              onChange={(event) => {
                setQuiz(event.target.value);
                setAssignment("");
              }}
            >
              <option value="">{t("lmsStaffNoPractice")}</option>
              {options.data?.quizzes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </StaffField>
          <StaffField id="makeup-due" labelKey="lmsStaffDueAt">
            <Input
              id="makeup-due"
              type="datetime-local"
              value={due}
              onChange={(event) => setDue(event.target.value)}
            />
          </StaffField>
          {action.error && (
            <p role="alert" className="text-sm text-destructive">
              {message(action.error)}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button disabled={action.isPending}>{t("lmsStaffSave")}</Button>
            {!assignment &&
              !quiz &&
              !plan.recipientId &&
              !plan.quizRecipientId && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={action.isPending}
                  onClick={() => action.mutate(true)}
                >
                  {t("lmsStaffConfirmMakeup")}
                </Button>
              )}
          </div>
        </form>
      )}
      <StaffConfirm
        open={confirmation}
        onOpenChange={setConfirmation}
        titleKey="lmsStaffRecipientChangeTitle"
        description="lmsStaffRecipientChangeBody"
        action="lmsStaffSave"
        pending={action.isPending}
        error={action.error}
        onConfirm={() => action.mutate(false)}
      >
        <p className="font-medium">
          {plan.studentName} · {plan.topic}
        </p>
      </StaffConfirm>
    </StaffDialog>
  );
}
