import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { LmsThreadDto } from "@shared/contracts/lms";
import type { TranslationKey } from "@/lib/i18n";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable } from "@/components/ux/DataTable";
import {
  Dialog,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { portalLmsApi } from "../portal-app/api";
import {
  PortalFormScope,
  usePortalFormScope,
  usePortal,
  useSubjectQuery,
  useInvalidateSubject,
} from "../portal-app/context";
import {
  PortalDialogContent as DialogContent,
  PortalTitle,
  PortalLoading,
  PortalError,
  isPortalAccessError,
  PortalEmpty,
  PortalStatus,
  usePortalFormat,
  usePortalError,
  usePortalSuccess,
  safeHttps,
} from "../portal-app/ui";
import { PortalFiles, PortalUploads } from "../portal-app/files";
import { usePortalFormMounted } from "../portal-app/usePortalFormMounted";
import { PortalSelect } from "../portal-app/controls";

export function HelpDialog({
  open,
  onClose,
  runId,
  unitId,
  recipientId,
  quizAttemptId,
  defaultTopic,
}: {
  open: boolean;
  onClose: () => void;
  runId?: number;
  unitId?: number;
  recipientId?: number;
  quizAttemptId?: number;
  defaultTopic?: TranslationKey;
}) {
  const helpScope = usePortalFormScope();
  const { t } = useTranslation();
  const { subject } = usePortal();
  return (
    <PortalFormScope id={helpScope.id}>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) helpScope.guarded(onClose);
        }}
      >
        <DialogContent className="portal-ui">
          <DialogHeader>
            <DialogTitle>{t("portalNeedHelp")}</DialogTitle>
            <DialogDescription>{subject?.studentName}</DialogDescription>
          </DialogHeader>
          {open && (
            <HelpForm
              runId={runId}
              unitId={unitId}
              recipientId={recipientId}
              quizAttemptId={quizAttemptId}
              defaultTopic={defaultTopic}
              onClose={onClose}
            />
          )}
        </DialogContent>
      </Dialog>
    </PortalFormScope>
  );
}
function HelpForm({
  runId,
  unitId,
  recipientId,
  quizAttemptId,
  defaultTopic,
  onClose,
}: {
  runId?: number;
  unitId?: number;
  recipientId?: number;
  quizAttemptId?: number;
  defaultTopic?: TranslationKey;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const message = usePortalError();
  const { subject, allowed, setUnsaved } = usePortal();
  const notify = usePortalSuccess();
  const invalidate = useInvalidateSubject();
  const mounted = usePortalFormMounted();
  const courses = useSubjectQuery(
    "communication-courses",
    portalLmsApi.communicationCourses,
    [],
    "communication.create",
  );
  const [course, setCourse] = useState(String(runId ?? ""));
  const [topic, setTopic] = useState<TranslationKey>(
    defaultTopic ?? "portalHelpTopic",
  );
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [stepUrl, setStepUrl] = useState("");
  const [validation, setValidation] = useState("");
  const [fileIds, setFileIds] = useState<number[]>([]);
  const [uploading, setUploading] = useState(false);
  const [audience, setAudience] = useState<
    "student_teacher" | "representative_teacher"
  >(subject?.kind === "self" ? "student_teacher" : "representative_teacher");
  const action = useMutation({
    mutationFn: () =>
      portalLmsApi.createThread(subject!.linkId, {
        idempotencyKey,
        runId: Number(course),
        unitId,
        recipientId,
        quizAttemptId,
        stepUrl: stepUrl.trim() || undefined,
        title: title.trim() || t(topic as "portalHelpTopic"),
        body,
        fileIds,
        audience,
        shareWithFamily:
          subject?.kind === "representative" && audience === "student_teacher",
      }),
    onSuccess: () => {
      void invalidate();
      if (!mounted.current) return;
      notify("portalQuestionSent");
      setUnsaved(false);
      onClose();
    },
  });
  useEffect(() => {
    setUnsaved(
      Boolean(title || body || stepUrl || fileIds.length || uploading),
    );
    return () => setUnsaved(false);
  }, [title, body, stepUrl, fileIds, uploading, setUnsaved]);
  if (!allowed("communication.create"))
    return <PortalEmpty labelKey="portalUnavailable" />;
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setValidation("");
        if (stepUrl && !safeHttps(stepUrl)) {
          setValidation(t("portalInvalidUrl"));
          document.getElementById("help-step")?.focus();
          return;
        }
        if (body.trim() && course) action.mutate();
      }}
    >
      <fieldset disabled={action.isPending} className="min-w-0 space-y-4">
        {!runId && (
          <div className="space-y-2">
            <Label htmlFor="help-course">{t("portalCourses")}</Label>
            <PortalSelect
              id="help-course"
              required
              disabled={courses.isPending || Boolean(courses.error)}
              value={course}
              onValueChange={setCourse}
              options={[
                { value: "", label: t("portalSelectCourse") },
                ...(courses.data ?? []).map((item) => ({
                  value: String(item.runId),
                  label: `${item.courseName} · ${item.groupName}`,
                })),
              ]}
            />
            {courses.error && (
              <PortalError
                error={courses.error}
                retry={() => {
                  void courses.refetch();
                }}
              />
            )}
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="help-topic">{t("portalQuestionTitle")}</Label>
          <PortalSelect
            id="help-topic"
            value={topic}
            onValueChange={(value) => setTopic(value as TranslationKey)}
            options={(
              [
                "portalHelpTopic",
                "portalHelpAssignment",
                "portalHelpFeedback",
                "portalHelpOther",
              ] as const
            ).map((key) => ({ value: key, label: t(key) }))}
          />
          {topic === "portalHelpOther" && (
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-label={t("portalQuestionTitle")}
              required
            />
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="help-step">{t("portalStepLink")}</Label>
          <Input
            id="help-step"
            type="url"
            maxLength={2000}
            value={stepUrl}
            onChange={(event) => setStepUrl(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="help-body">{t("portalQuestionText")}</Label>
          <Textarea
            id="help-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={5}
            required
          />
        </div>
        {subject?.kind === "representative" && (
          <div className="space-y-2">
            <Label htmlFor="help-audience">{t("portalAudience")}</Label>
            <PortalSelect
              id="help-audience"
              value={audience}
              onValueChange={(value) => setAudience(value as typeof audience)}
              options={[
                {
                  value: "representative_teacher",
                  label: t("portalAudienceRepresentatives"),
                },
                {
                  value: "student_teacher",
                  label: t("portalAudienceLearning"),
                },
              ]}
            />
          </div>
        )}
        <PortalUploads
          ids={fileIds}
          onChange={setFileIds}
          onBusyChange={setUploading}
          max={3}
        />
        {(action.error || validation) && (
          <p role="alert" className="text-destructive">
            {validation || message(action.error, "portalSaveError")}
          </p>
        )}
        <DialogFooter className="border-t border-border/70 pt-4">
          <Button loading={action.isPending || uploading}
            disabled={action.isPending || uploading || !course || !body.trim()}
          >
            {t("portalSend")}
          </Button>
        </DialogFooter>
      </fieldset>
    </form>
  );
}
export function PortalHelp({
  initialId,
  embedded = false,
}: {
  initialId?: number;
  embedded?: boolean;
}) {
  const threadScope = usePortalFormScope();
  const { t } = useTranslation();
  const { subject } = usePortal();
  const query = useSubjectQuery(
    "threads",
    portalLmsApi.threads,
    [],
    "communication.create",
  );
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<LmsThreadDto | null>(null);
  const [openedRequest, setOpenedRequest] = useState<number | null>(null);
  const requested = useSubjectQuery(
    "thread",
    (link, signal) => portalLmsApi.thread(link, initialId!, signal),
    [initialId],
    "communication.create",
    Boolean(initialId),
  );
  useEffect(() => {
    if (initialId && requested.data && openedRequest !== initialId) {
      setSelected(requested.data);
      setOpenedRequest(initialId);
    }
  }, [initialId, requested.data, openedRequest]);
  const format = usePortalFormat();
  if (initialId && requested.error && (requested.data === undefined || isPortalAccessError(requested.error)))
    return (
      <PortalError
        error={requested.error}
        retry={() => {
          void requested.refetch();
        }}
      />
    );
  if (initialId && requested.isPending) return <PortalLoading />;
  if (query.isPending) return <PortalLoading />;
  if (query.data === undefined || isPortalAccessError(query.error))
    return (
      <PortalError
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  return (
    <>
      {embedded ? (
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)}>{t("portalAskQuestion")}</Button>
        </div>
      ) : (
        <PortalTitle labelKey="portalHelp">
          <Button onClick={() => setOpen(true)}>{t("portalAskQuestion")}</Button>
        </PortalTitle>
      )}
      {query.error && (
        <PortalError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      )}
      {initialId && requested.error && (
        <PortalError
          error={requested.error}
          retry={() => {
            void requested.refetch();
          }}
        />
      )}
      {query.data.length === 0 ? (
        <PortalEmpty labelKey="portalNoQuestions" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <DataTable
              focusOnRowClick
              data={query.data}
              keyExtractor={(item) => String(item.id)}
              onRowClick={setSelected}
              pageSize={0}
              showPagination={false}
              columns={[
                {
                  key: "title",
                  header: t("portalQuestionTitle"),
                  mobilePrimary: true,
                  cellClassName: "font-medium",
                },
                {
                  key: "status",
                  header: t("status"),
                  render: (item) => <PortalStatus status={item.status} />,
                },
                {
                  key: "createdAt",
                  header: t("portalDate"),
                  sortable: true,
                  render: (item) => format.date(item.createdAt),
                },
                {
                  key: "actions",
                  header: "",
                  className: "w-24",
                  render: (item) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelected(item)}
                    >
                      {t("portalOpen")}
                    </Button>
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
      )}
      <HelpDialog open={open} onClose={() => setOpen(false)} />
      <PortalFormScope id={threadScope.id}>
        <Dialog
          open={Boolean(selected)}
          onOpenChange={(value) => {
            if (!value) threadScope.guarded(() => setSelected(null));
          }}
        >
          <DialogContent className="portal-ui">
            <DialogHeader>
              <DialogTitle>{selected?.title}</DialogTitle>
              <DialogDescription>{subject?.studentName}</DialogDescription>
            </DialogHeader>
            {selected && (
              <ThreadConversation
                key={selected.id}
                initial={selected}
                onChange={setSelected}
              />
            )}
          </DialogContent>
        </Dialog>
      </PortalFormScope>
    </>
  );
}
function ThreadConversation({
  initial,
  onChange,
}: {
  initial: LmsThreadDto;
  onChange: (thread: LmsThreadDto) => void;
}) {
  const { t } = useTranslation();
  const message = usePortalError();
  const format = usePortalFormat();
  const { subject, setUnsaved } = usePortal();
  const notify = usePortalSuccess();
  const invalidate = useInvalidateSubject();
  const mounted = usePortalFormMounted();
  const detail = useSubjectQuery(
    "thread",
    (link, signal) => portalLmsApi.thread(link, initial.id, signal),
    [initial.id],
    "communication.create",
  );
  const thread = detail.data ?? initial;
  const [body, setBody] = useState("");
  const [commentKey, setCommentKey] = useState(() => crypto.randomUUID());
  const action = useMutation({
    mutationFn: () =>
      portalLmsApi.threadComment(subject!.linkId, thread.id, {
        idempotencyKey: commentKey,
        body,
        fileIds: [],
        audience:
          thread.audience === "representative_teacher"
            ? "family_teacher"
            : "student_teacher",
      }),
    onSuccess: () => {
      void invalidate();
      if (!mounted.current) return;
      notify("portalMessageSent");
      setBody("");
      setCommentKey(crypto.randomUUID());
      void detail.refetch().then((result) => {
        if (mounted.current && result.data) onChange(result.data);
      });
    },
  });
  const status = useMutation({
    mutationFn: () =>
      portalLmsApi.threadStatus(
        subject!.linkId,
        thread.id,
        thread.status === "resolved" ? "open" : "resolved",
      ),
    onSuccess: () => {
      void invalidate();
      if (!mounted.current) return;
      notify();
      void detail.refetch().then((result) => {
        if (mounted.current && result.data) onChange(result.data);
      });
    },
  });
  useEffect(() => {
    setUnsaved(Boolean(body));
    return () => setUnsaved(false);
  }, [body, setUnsaved]);
  if (detail.isPending) return <PortalLoading variant="section" />;
  if (detail.data === undefined || isPortalAccessError(detail.error))
    return (
      <PortalError
        error={detail.error}
        retry={() => {
          void detail.refetch();
        }}
      />
    );
  return (
    <div className="space-y-4">
      {detail.error && (
        <PortalError
          error={detail.error}
          retry={() => {
            void detail.refetch();
          }}
        />
      )}
      <div className="flex justify-between gap-3">
        <PortalStatus status={thread.status} />
        <Button loading={status.isPending}
          variant="outline"
          disabled={status.isPending}
          onClick={() => status.mutate()}
        >
          {t(thread.status === "resolved" ? "portalReopen" : "portalResolve")}
        </Button>
      </div>
      {thread.comments.map((item) => (
        <div
          key={item.id}
          className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-4"
        >
          <p className="text-sm font-medium">
            {item.authorName} · {format.date(item.createdAt)}
          </p>
          <p className="whitespace-pre-wrap">{item.body}</p>
          <PortalFiles ids={item.fileIds} />
        </div>
      ))}
      {thread.stepUrl && safeHttps(thread.stepUrl) && (
        <Button asChild variant="outline">
          <a href={thread.stepUrl} target="_blank" rel="noopener noreferrer">
            {t("portalStepLink")}
          </a>
        </Button>
      )}
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (body.trim()) action.mutate();
        }}
      >
        <fieldset disabled={action.isPending} className="min-w-0 space-y-3">
          <div className="space-y-2">
            <Label htmlFor="thread-comment">{t("portalComment")}</Label>
            <Textarea
              id="thread-comment"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              required
            />
          </div>
          {(action.error || status.error) && (
            <p role="alert" className="text-destructive">
              {message(action.error || status.error, "portalSaveError")}
            </p>
          )}
          <DialogFooter className="border-t border-border/70 pt-4">
            <Button loading={action.isPending} disabled={action.isPending || !body.trim()}>
              {t("portalSend")}
            </Button>
          </DialogFooter>
        </fieldset>
      </form>
    </div>
  );
}
