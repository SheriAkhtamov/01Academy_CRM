import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { LmsMakeupDto } from "@shared/contracts/lms";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { portalLmsApi } from "../portal-app/api";
import {
  usePortal,
  useSubjectQuery,
  useInvalidateSubject,
} from "../portal-app/context";
import {
  PortalDialogContent as DialogContent,
  PortalTitle,
  PortalLoading,
  PortalError,
  PortalEmpty,
  usePortalError,
  usePortalFormat,
} from "../portal-app/ui";
import { AssignmentDialog } from "./assignments";
import { PortalQuizzes } from "./quizzes";
import { HelpDialog } from "./communication";

export function MakeupStatus({ status }: { status: LmsMakeupDto["status"] }) {
  const { t } = useTranslation();
  return (
    <Badge variant="secondary">
      {t(
        status === "needed"
          ? "portalMakeupNeeded"
          : status === "in_progress"
            ? "portalMakeupInProgress"
            : status === "not_required"
              ? "portalMakeupNotRequired"
              : "portalMakeupComplete",
      )}
    </Badge>
  );
}
export function PortalMakeup({
  courseId,
  embedded = false,
}: {
  courseId?: number;
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const format = usePortalFormat();
  const { allowed } = usePortal();
  const query = useSubjectQuery(
    "makeup",
    portalLmsApi.makeup,
    [],
    allowed("learning.read") ? "learning.read" : "attendance.read",
  );
  const [section, setSection] = useState("current");
  const [selected, setSelected] = useState<LmsMakeupDto | null>(null);
  if (query.isPending) return <PortalLoading />;
  if (query.error)
    return (
      <PortalError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const items = query.data.filter(
    (item) =>
      (!courseId || item.runId === courseId) &&
      (section === "completed"
        ? item.status === "completed"
        : ["needed", "in_progress"].includes(item.status)),
  );
  if (embedded && !items.length) return null;
  return (
    <>
      <PortalTitle labelKey="portalMakeup" />
      {!embedded && (
        <Tabs value={section} onValueChange={setSection}>
          <TabsList>
            <TabsTrigger value="current" className="min-h-11">
              {t("portalCurrent")}
            </TabsTrigger>
            <TabsTrigger value="completed" className="min-h-11">
              {t("portalCompleted")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      {!items.length && <PortalEmpty labelKey="portalNoLessons" />}
      <div className="space-y-3">
        {items.map((item) => (
          <Card key={item.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <h2 className="font-semibold">{item.topic}</h2>
                <p className="text-sm text-muted-foreground">
                  {format.date(item.scheduledAt)}
                </p>
                {item.dueAt && (
                  <p className="text-sm">
                    {t("portalDue")}: {format.date(item.dueAt)}
                  </p>
                )}
              </div>
              <MakeupStatus status={item.status} />
              <Button
                className="min-h-11"
                variant="outline"
                onClick={() => setSelected(item)}
              >
                {t("portalOpen")}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <MakeupDialog plan={selected} onClose={() => setSelected(null)} />
    </>
  );
}
export function MakeupDialog({
  plan,
  onClose,
}: {
  plan: LmsMakeupDto | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { guarded, subject } = usePortal();
  return (
    <Dialog
      open={Boolean(plan)}
      onOpenChange={(open) => {
        if (!open) guarded(onClose);
      }}
    >
      <DialogContent className="portal-ui max-w-2xl">
        <DialogTitle>{t("portalMakeup")}</DialogTitle>
        <DialogDescription>{subject?.studentName}</DialogDescription>
        {plan && (
          <MakeupDetail key={plan.id} initial={plan} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}
function MakeupDetail({
  initial,
  onClose,
}: {
  initial: LmsMakeupDto;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const message = usePortalError();
  const format = usePortalFormat();
  const { subject, allowed, guarded } = usePortal();
  const invalidate = useInvalidateSubject();
  const [, navigate] = useLocation();
  const canonical = useSubjectQuery(
    "makeup",
    portalLmsApi.makeup,
    [],
    allowed("learning.read") ? "learning.read" : "attendance.read",
  );
  const plan =
    canonical.data?.find((item) => item.id === initial.id) ?? initial;
  const [assignment, setAssignment] = useState<number | null>(null);
  const [test, setTest] = useState(false);
  const [help, setHelp] = useState(false);
  const begin = useMutation({
    mutationFn: () => portalLmsApi.beginMakeup(subject!.linkId, plan.id),
    onSuccess: async () => {
      await canonical.refetch();
      void invalidate();
    },
  });
  const canRead = allowed("learning.read");
  const available =
    canRead &&
    (plan.materials.length > 0 ||
      plan.recipientId !== null ||
      plan.quizRecipientId !== null);
  if (canonical.isPending) return <PortalLoading />;
  if (canonical.error)
    return (
      <PortalError
        error={canonical.error}
        retry={() => {
          void canonical.refetch();
        }}
      />
    );
  if (!canonical.data.some((item) => item.id === initial.id))
    return <PortalEmpty labelKey="portalMakeupNotRequired" />;
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{plan.topic}</h2>
      <p className="text-sm text-muted-foreground">
        {format.date(plan.scheduledAt)}
      </p>
      <MakeupStatus status={plan.status} />
      {canRead && (
        <section className="space-y-3">
          <h3 className="font-semibold">{t("portalMaterial")}</h3>
          {plan.materials.length === 0 ? (
            <p className="text-muted-foreground">{t("portalMaterialLater")}</p>
          ) : (
            plan.materials.map((material) => (
              <Button
                key={material.publicationId}
                variant="outline"
                className="h-auto min-h-11 w-full justify-start whitespace-normal text-left"
                onClick={() =>
                  guarded(() => {
                    onClose();
                    navigate(
                      `/learn/courses/${plan.runId}/materials/${material.publicationId}`,
                    );
                  })
                }
              >
                {material.title}
              </Button>
            ))
          )}
        </section>
      )}
      {begin.error && (
        <p role="alert" className="text-destructive">
          {message(begin.error, "portalSaveError")}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {plan.status === "needed" && subject?.kind === "self" && available && (
          <Button
            className="min-h-11"
            disabled={begin.isPending}
            onClick={() => begin.mutate()}
          >
            {t("portalMakeupStart")}
          </Button>
        )}
        {canRead && plan.recipientId !== null && (
          <Button
            className="min-h-11"
            variant="outline"
            onClick={() => setAssignment(plan.recipientId)}
          >
            {t("portalPractice")}
          </Button>
        )}
        {canRead && plan.quizRecipientId !== null && (
          <Button
            className="min-h-11"
            variant="outline"
            onClick={() => setTest(true)}
          >
            {t("portalTests")}
          </Button>
        )}
        {allowed("communication.create") && (
          <Button
            className="min-h-11"
            variant="outline"
            onClick={() => setHelp(true)}
          >
            {t("portalNeedHelp")}
          </Button>
        )}
      </div>
      <AssignmentDialog id={assignment} onClose={() => setAssignment(null)} />
      <Dialog open={test} onOpenChange={setTest}>
        <DialogContent className="portal-ui max-w-2xl">
          <DialogTitle>{t("portalTests")}</DialogTitle>
          <DialogDescription>{plan.topic}</DialogDescription>
          {test && <PortalQuizzes quizId={plan.quizRecipientId ?? undefined} />}
        </DialogContent>
      </Dialog>
      <HelpDialog
        open={help}
        onClose={() => setHelp(false)}
        runId={plan.runId}
        recipientId={plan.recipientId ?? undefined}
      />
    </div>
  );
}
