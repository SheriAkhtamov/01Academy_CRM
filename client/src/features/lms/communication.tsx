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
  PortalStatus,
  usePortalFormat,
  usePortalError,
  usePortalSuccess,
  safeHttps,
} from "../portal-app/ui";
import { PortalFiles, PortalUploads } from "../portal-app/files";

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
  const { t } = useTranslation();
  const { guarded, subject } = usePortal();
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) guarded(onClose);
      }}
    >
      <DialogContent className="portal-ui">
        <DialogTitle>{t("portalNeedHelp")}</DialogTitle>
        <DialogDescription>{subject?.studentName}</DialogDescription>
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
      notify("portalQuestionSent");
      setUnsaved(false);
      void invalidate();
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
      {!runId && (
        <div className="space-y-2">
          <Label htmlFor="help-course">{t("portalCourses")}</Label>
          <select
            id="help-course"
            required
            className="min-h-11 w-full rounded-md border bg-background px-3"
            value={course}
            onChange={(event) => setCourse(event.target.value)}
          >
            <option value="">{t("portalSelectCourse")}</option>
            {courses.data?.map((item) => (
              <option key={item.runId} value={item.runId}>
                {item.courseName} · {item.groupName}
              </option>
            ))}
          </select>
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
        <select
          id="help-topic"
          className="min-h-11 w-full rounded-md border bg-background px-3"
          value={topic}
          onChange={(event) => setTopic(event.target.value as TranslationKey)}
        >
          {(
            [
              "portalHelpTopic",
              "portalHelpAssignment",
              "portalHelpFeedback",
              "portalHelpOther",
            ] as const
          ).map((key) => (
            <option key={key} value={key}>
              {t(key)}
            </option>
          ))}
        </select>
        {topic === "portalHelpOther" && (
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-label={t("portalQuestionTitle")}
            required
            className="min-h-11"
          />
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="help-step">{t("portalStepLink")}</Label>
        <Input
          id="help-step"
          type="url"
          maxLength={2000}
          className="min-h-11"
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
          <select
            id="help-audience"
            className="min-h-11 w-full rounded-md border bg-background px-3"
            value={audience}
            onChange={(event) =>
              setAudience(event.target.value as typeof audience)
            }
          >
            <option value="representative_teacher">
              {t("portalAudienceRepresentatives")}
            </option>
            <option value="student_teacher">
              {t("portalAudienceLearning")}
            </option>
          </select>
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
      <Button
        className="min-h-11"
        disabled={action.isPending || uploading || !course || !body.trim()}
      >
        {t("portalSend")}
      </Button>
    </form>
  );
}
export function PortalHelp({ initialId }: { initialId?: number }) {
  const { t } = useTranslation();
  const { guarded, subject } = usePortal();
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
  if (initialId && requested.error)
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
  if (query.error)
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
      <PortalTitle labelKey="portalHelp">
        <Button className="min-h-11" onClick={() => setOpen(true)}>
          {t("portalAskQuestion")}
        </Button>
      </PortalTitle>
      {query.data.length === 0 && <PortalEmpty labelKey="portalNoQuestions" />}
      <div className="space-y-3">
        {query.data.map((item) => (
          <Card key={item.id}>
            <CardContent className="p-0">
              <Button
                variant="ghost"
                className="h-auto min-h-16 w-full justify-between gap-3 whitespace-normal p-4 text-left"
                onClick={() => setSelected(item)}
              >
                <span>
                  <span className="block font-medium">{item.title}</span>
                  <span className="block text-sm text-muted-foreground">
                    {format.date(item.createdAt)}
                  </span>
                </span>
                <PortalStatus status={item.status} />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <HelpDialog open={open} onClose={() => setOpen(false)} />
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(value) => {
          if (!value) guarded(() => setSelected(null));
        }}
      >
        <DialogContent className="portal-ui">
          <DialogTitle>{selected?.title}</DialogTitle>
          <DialogDescription>{subject?.studentName}</DialogDescription>
          {selected && (
            <ThreadConversation
              key={selected.id}
              initial={selected}
              onChange={setSelected}
            />
          )}
        </DialogContent>
      </Dialog>
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
      notify("portalMessageSent");
      setBody("");
      setCommentKey(crypto.randomUUID());
      void detail.refetch().then((result) => {
        if (result.data) onChange(result.data);
      });
      void invalidate();
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
      notify();
      void detail.refetch().then((result) => {
        if (result.data) onChange(result.data);
      });
      void invalidate();
    },
  });
  useEffect(() => {
    setUnsaved(Boolean(body));
    return () => setUnsaved(false);
  }, [body, setUnsaved]);
  if (detail.isPending) return <PortalLoading />;
  if (detail.error)
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
      <div className="flex justify-between gap-3">
        <PortalStatus status={thread.status} />
        <Button
          variant="outline"
          className="min-h-11"
          disabled={status.isPending}
          onClick={() => status.mutate()}
        >
          {t(thread.status === "resolved" ? "portalReopen" : "portalResolve")}
        </Button>
      </div>
      {thread.comments.map((item) => (
        <div key={item.id} className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">
            {item.authorName} · {format.date(item.createdAt)}
          </p>
          <p className="whitespace-pre-wrap">{item.body}</p>
          <PortalFiles ids={item.fileIds} />
        </div>
      ))}
      {thread.stepUrl && safeHttps(thread.stepUrl) && (
        <Button asChild variant="outline" className="min-h-11">
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
        <Label htmlFor="thread-comment">{t("portalComment")}</Label>
        <Textarea
          id="thread-comment"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          required
        />
        {(action.error || status.error) && (
          <p role="alert" className="text-destructive">
            {message(action.error || status.error, "portalSaveError")}
          </p>
        )}
        <Button
          className="min-h-11"
          disabled={action.isPending || !body.trim()}
        >
          {t("portalSend")}
        </Button>
      </form>
    </div>
  );
}
