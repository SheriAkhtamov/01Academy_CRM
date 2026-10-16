import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { lmsAnnouncementSchema } from "@shared/contracts/lms";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { LearningText } from "../learning-content/text";
import { lmsStaffApi } from "./api";
import { useStaffQuery, useStaffInvalidate } from "./queries";
import {
  StaffDialog,
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
import { StaffEditor } from "./editor";
import { StaffFiles, StaffUploads } from "./files";
export function StaffAnnouncements({ runId }: { runId: number }) {
  const { t } = useTranslation();
  const date = useStaffFormat();
  const query = useStaffQuery("announcements", runId, (signal) =>
    lmsStaffApi.announcements(runId, signal),
  );
  const [create, setCreate] = useState(false);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-xl font-semibold">{t("lmsStaffAnnouncements")}</h2>
          <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold tabular-nums">
            {query.data.length}
          </span>
        </div>
        <Button onClick={() => setCreate(true)}>{t("lmsStaffPublish")}</Button>
      </div>
      {!query.data.length && <StaffEmpty />}
      <div className="space-y-3">
        {query.data.map((item) => (
          <Card key={item.id} className="border-border/70">
            <CardContent className="space-y-3 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-2.5">
                <h3 className="break-words font-semibold">{item.title}</h3>
                <span className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
                  {date(item.publishAt)}
                </span>
              </div>
              <LearningText text={item.body} />
              <StaffFiles runId={runId} ids={item.fileIds} />
            </CardContent>
          </Card>
        ))}
      </div>
      {create && (
        <AnnouncementEditor runId={runId} onClose={() => setCreate(false)} />
      )}
    </div>
  );
}
function AnnouncementEditor({
  runId,
  onClose,
}: {
  runId: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const message = useStaffError();
  const invalidate = useStaffInvalidate();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<
    "students" | "representatives" | "all"
  >("all");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [publish, setPublish] = useState(
    staffDateInput(new Date().toISOString()),
  );
  const [pinned, setPinned] = useState("");
  const [fileIds, setFileIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState("");
  const action = useMutation({
    mutationFn: lmsStaffApi.createAnnouncement,
    onSuccess: () => {
      void invalidate();
      onClose();
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    setValidation("");
    const parsed = lmsAnnouncementSchema.safeParse({
      idempotencyKey,
      runId,
      title,
      body,
      audience,
      publishAt: staffDateIso(publish),
      pinnedUntil: pinned ? staffDateIso(pinned) : null,
      fileIds,
    });
    if (!parsed.success) {
      setValidation(t("portalInvalidData"));
      return;
    }
    action.mutate(parsed.data);
  }
  return (
    <StaffDialog
      open
      onClose={onClose}
      titleKey="lmsStaffAnnouncements"
      dirty={Boolean(title || body || fileIds.length)}
      pending={action.isPending}
    >
      <form onSubmit={submit} className="space-y-5">
        <StaffField id="announcement-title" labelKey="lmsStaffTitleField">
          <Input
            id="announcement-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={255}
          />
        </StaffField>
        <StaffField id="announcement-body" labelKey="lmsStaffBody">
          <StaffEditor
            id="announcement-body"
            value={body}
            onChange={setBody}
            required
          />
        </StaffField>
        <StaffField id="announcement-audience" labelKey="lmsStaffAudience">
          <select
            id="announcement-audience"
            className="min-h-11 w-full rounded-md border bg-background px-3"
            value={audience}
            onChange={(event) =>
              setAudience(event.target.value as typeof audience)
            }
          >
            <option value="all">{t("lmsStaffEveryone")}</option>
            <option value="students">{t("lmsStaffStudents")}</option>
            <option value="representatives">
              {t("lmsStaffRepresentatives")}
            </option>
          </select>
        </StaffField>
        <div className="grid gap-4 sm:grid-cols-2">
          <StaffField id="announcement-publish" labelKey="lmsStaffOpensAt">
            <Input
              id="announcement-publish"
              type="datetime-local"
              value={publish}
              onChange={(event) => setPublish(event.target.value)}
              required
            />
          </StaffField>
          <StaffField id="announcement-pinned" labelKey="lmsStaffPinnedUntil">
            <Input
              id="announcement-pinned"
              type="datetime-local"
              value={pinned}
              onChange={(event) => setPinned(event.target.value)}
            />
          </StaffField>
        </div>
        <StaffUploads
          runId={runId}
          ids={fileIds}
          onChange={setFileIds}
          onBusyChange={setBusy}
        />
        {(validation || action.error) && (
          <p role="alert" className="text-sm text-destructive">
            {validation || message(action.error)}
          </p>
        )}
        <div className="flex justify-end">
          <Button disabled={action.isPending || busy}>
            {t("lmsStaffPublish")}
          </Button>
        </div>
      </form>
    </StaffDialog>
  );
}
export function StaffThreads({
  runId,
  onlyOpen = false,
}: {
  runId: number;
  onlyOpen?: boolean;
}) {
  const { t } = useTranslation();
  const date = useStaffFormat();
  const query = useStaffQuery("threads", runId, (signal) =>
    lmsStaffApi.threads(runId, signal),
  );
  const [selected, setSelected] = useState<number | null>(null);
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
  const threads = onlyOpen
    ? query.data.filter((thread) => thread.status === "open")
    : query.data;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <h2 className="text-xl font-semibold">{t("lmsStaffThreads")}</h2>
        <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold tabular-nums">
          {threads.length}
        </span>
      </div>
      {!threads.length && <StaffEmpty />}
      <div className="space-y-3">
        {threads.map((thread) => (
          <Card
            key={thread.id}
            className="border-border/70 transition-colors hover:border-primary/30"
          >
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
              <div className="min-w-0 space-y-2">
                <h3 className="break-words font-semibold">{thread.title}</h3>
                <p className="text-xs text-muted-foreground">
                  {thread.studentName} · {date(thread.createdAt)}
                </p>
                <StaffStatus state={thread.status} />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelected(thread.id)}
              >
                {t("lmsStaffAnswer")}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {selected !== null && (
        <ThreadDialog
          key={selected}
          id={selected}
          runId={runId}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
function ThreadDialog({
  id,
  runId,
  onClose,
}: {
  id: number;
  runId: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const date = useStaffFormat();
  const message = useStaffError();
  const invalidate = useStaffInvalidate();
  const query = useStaffQuery("thread", id, (signal) =>
    lmsStaffApi.thread(id, signal),
  );
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [commentKey, setCommentKey] = useState(() => crypto.randomUUID());
  const [fileIds, setFileIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const answer = useMutation({
    mutationFn: () =>
      lmsStaffApi.threadComment(id, {
        idempotencyKey: commentKey,
        body,
        audience: internal ? "staff" : "family_teacher",
        fileIds,
      }),
    onSuccess: () => {
      setBody("");
      setFileIds([]);
      setCommentKey(crypto.randomUUID());
      void invalidate();
    },
  });
  const status = useMutation({
    mutationFn: () =>
      lmsStaffApi.threadStatus(
        id,
        query.data?.status === "resolved" ? "open" : "resolved",
      ),
    onSuccess: () => {
      void invalidate();
    },
  });
  return (
    <StaffDialog
      open
      onClose={onClose}
      titleKey="lmsStaffThreads"
      description={query.data?.title}
      dirty={Boolean(body || fileIds.length)}
      pending={answer.isPending}
    >
      {query.isPending ? (
        <StaffLoading />
      ) : query.error ? (
        <StaffError
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
        />
      ) : (
        query.data && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <StaffStatus state={query.data.status} />
              <Button
                variant="outline"
                disabled={status.isPending}
                onClick={() => status.mutate()}
              >
                {t(
                  query.data.status === "resolved"
                    ? "portalReopen"
                    : "portalResolve",
                )}
              </Button>
            </div>
            <div className="space-y-3">
              {query.data.comments.map((comment) => (
                <div
                  key={comment.id}
                  className="space-y-2 rounded-md border p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {comment.authorName} · {date(comment.createdAt)}
                    </p>
                    {comment.audience === "staff" && (
                      <span className="text-xs text-muted-foreground">
                        {t("lmsStaffStaffOnly")}
                      </span>
                    )}
                  </div>
                  <LearningText text={comment.body} />
                  <StaffFiles runId={runId} ids={comment.fileIds} />
                </div>
              ))}
            </div>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (body.trim()) answer.mutate();
              }}
            >
              <StaffField id="thread-answer" labelKey="lmsStaffComment">
                <Textarea
                  id="thread-answer"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  required
                  rows={5}
                />
              </StaffField>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={internal}
                  onChange={(event) => setInternal(event.target.checked)}
                />
                {t("lmsStaffStaffOnly")}
              </label>
              <StaffUploads
                runId={runId}
                ids={fileIds}
                onChange={setFileIds}
                onBusyChange={setBusy}
                max={3}
              />
              {(answer.error || status.error) && (
                <p role="alert" className="text-sm text-destructive">
                  {message(answer.error ?? status.error)}
                </p>
              )}
              <Button disabled={answer.isPending || busy || !body.trim()}>
                {t("lmsStaffAnswer")}
              </Button>
            </form>
          </div>
        )
      )}
    </StaffDialog>
  );
}
