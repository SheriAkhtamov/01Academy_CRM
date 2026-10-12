import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  PortalProjectDto,
  PortalProjectInput,
  PortalShareDto,
  PortalShareInput,
} from "@shared/contracts/portal-resources";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  usePortal,
  useSubjectQuery,
  useSubjectInfiniteQuery,
  useInvalidateSubject,
} from "./context";
import { portalResourcesApi } from "./resources-api";
import { portalLmsApi } from "./api";
import {
  PortalDialogContent as DialogContent,
  PortalTitle,
  PortalLoading,
  PortalError,
  PortalEmpty,
  ConfirmAction,
  usePortalFormat,
  usePortalError,
  usePortalSuccess,
  safeHttps,
} from "./ui";
import { PortalFiles, PortalUploads } from "./files";

export function PortalPortfolio() {
  const { t } = useTranslation();
  const message = usePortalError();
  const notify = usePortalSuccess();
  const { allowed, subject, guarded } = usePortal();
  const invalidate = useInvalidateSubject();
  const query = useSubjectInfiniteQuery(
    "projects-list",
    portalResourcesApi.projectsPage,
    [],
    allowed("learning.read") ? "learning.read" : "portfolio.approve",
  );
  const [editing, setEditing] = useState<PortalProjectDto | "new" | null>(null);
  const [selected, setSelected] = useState<PortalProjectDto | null>(null);
  const [share, setShare] = useState<PortalProjectDto | null>(null);
  const [archive, setArchive] = useState<PortalProjectDto | null>(null);
  const [revoke, setRevoke] = useState<PortalShareDto | null>(null);
  const [approval, setApproval] = useState<{
    project: PortalProjectDto;
    share: PortalShareDto;
  } | null>(null);
  const [course, setCourse] = useState("");
  const consumedSource = useRef<string | null>(null);
  const source = new URLSearchParams(window.location.search).get("submission");
  useEffect(() => {
    if (
      source &&
      consumedSource.current !== source &&
      allowed("portfolio.edit", true)
    ) {
      consumedSource.current = source;
      setEditing("new");
    }
  }, [source, allowed]);
  const archiveAction = useMutation({
    mutationFn: () =>
      portalResourcesApi.archiveProject(
        subject!.linkId,
        archive!.id,
        archive!.version,
      ),
    onSuccess: () => {
      notify();
      setArchive(null);
      setSelected(null);
      void invalidate();
    },
  });
  const revokeAction = useMutation({
    mutationFn: () =>
      portalResourcesApi.revoke(subject!.linkId, revoke!.id, revoke!.version),
    onSuccess: () => {
      notify();
      setRevoke(null);
      setSelected(null);
      void invalidate();
    },
  });
  const approveAction = useMutation({
    mutationFn: () =>
      portalResourcesApi.approve(
        subject!.linkId,
        approval!.share.id,
        approval!.share.version,
      ),
    onSuccess: () => {
      notify();
      setApproval(null);
      void invalidate();
    },
  });
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
  const projects = query.data.pages
    .flatMap((page) => page.items)
    .filter((project) => project.studentId === subject?.studentId);
  const items = projects.filter(
    (item) => !item.archivedAt && (!course || item.runId === Number(course)),
  );
  const courses = [
    ...new Map(
      projects
        .filter((item) => item.runId)
        .map((item) => [item.runId!, item.courseName ?? ""]),
    ).entries(),
  ];
  return (
    <>
      <PortalTitle labelKey="portalPortfolio">
        {allowed("portfolio.edit", true) && (
          <Button className="min-h-11" onClick={() => setEditing("new")}>
            {t("portalAddProject")}
          </Button>
        )}
      </PortalTitle>
      <select
        className="min-h-11 rounded-md border bg-background px-3"
        aria-label={t("portalCourses")}
        value={course}
        onChange={(event) => setCourse(event.target.value)}
      >
        <option value="">{t("portalAllCourses")}</option>
        {courses.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
      {items.length === 0 && !query.hasNextPage && (
        <PortalEmpty labelKey="portalNoProjects" />
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <Card key={item.id} className="overflow-hidden">
            {item.coverFileId && (
              <img
                src={`/api/portal/files/${item.coverFileId}/download?linkId=${subject?.linkId}`}
                alt={item.title}
                className="aspect-video w-full object-cover"
                loading="lazy"
              />
            )}
            <CardHeader>
              <CardTitle className="text-lg">{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="line-clamp-3 text-sm text-muted-foreground">
                {item.description}
              </p>
              <p className="text-sm">{item.courseName}</p>
              <Badge variant="secondary">
                {t(
                  item.shares.some((value) => value.status === "published")
                    ? "portalPublished"
                    : item.shares.some((value) =>
                          ["awaiting_approval", "awaiting_moderation"].includes(
                            value.status,
                          ),
                        )
                      ? "portalPendingApproval"
                      : "portalPrivate",
                )}
              </Badge>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setSelected(item)}
                >
                  {t("portalOpen")}
                </Button>
                {allowed("portfolio.approve") &&
                  item.shares
                    .filter((value) => value.status === "awaiting_approval")
                    .map((value) => (
                      <Button
                        key={value.id}
                        className="min-h-11"
                        onClick={() =>
                          setApproval({ project: item, share: value })
                        }
                      >
                        {t("portalApprove")}
                      </Button>
                    ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {query.hasNextPage && (
        <Button
          variant="outline"
          className="min-h-11"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          {t("portalLoadMore")}
        </Button>
      )}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="portal-ui max-w-3xl">
          <DialogTitle>{selected?.title}</DialogTitle>
          <DialogDescription>{selected?.courseName}</DialogDescription>
          {selected && (
            <div className="space-y-4">
              <p className="whitespace-pre-wrap">{selected.description}</p>
              <PortalFiles ids={selected.files.map((file) => file.id)} />
              {selected.links.filter(safeHttps).map((link) => (
                <a
                  key={link}
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block break-all text-primary underline"
                >
                  {link}
                </a>
              ))}
              {selected.teacherReview && (
                <div className="rounded-md bg-muted p-4">
                  <h3 className="mb-2 font-medium">{t("portalFeedback")}</h3>
                  <p className="whitespace-pre-wrap">
                    {selected.teacherReview}
                  </p>
                </div>
              )}
              {selected.shares
                .filter((value) => value.status === "published")
                .map((value) => (
                  <div
                    key={value.id}
                    className="space-y-2 rounded-md border p-3"
                  >
                    {value.publicUrl && (
                      <a
                        href={value.publicUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block break-all text-primary underline"
                      >
                        {t("portalOpen")}
                      </a>
                    )}
                    {(allowed("portfolio.edit", true) ||
                      allowed("portfolio.approve")) && (
                      <Button
                        variant="outline"
                        className="min-h-11"
                        onClick={() => setRevoke(value)}
                      >
                        {t("portalRevoke")}
                      </Button>
                    )}
                  </div>
                ))}
              {allowed("portfolio.edit", true) && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => {
                      setSelected(null);
                      setEditing(selected);
                    }}
                  >
                    {t("portalEditProject")}
                  </Button>
                  {subject?.studentClassification !== "unverified" && (
                    <Button
                      className="min-h-11"
                      onClick={() => {
                        setSelected(null);
                        setShare(selected);
                      }}
                    >
                      {t("portalShare")}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => setArchive(selected)}
                  >
                    {t("portalArchiveProject")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) guarded(() => setEditing(null));
        }}
      >
        <DialogContent className="portal-ui max-w-2xl">
          <DialogTitle>
            {t(editing === "new" ? "portalAddProject" : "portalEditProject")}
          </DialogTitle>
          <DialogDescription>{subject?.studentName}</DialogDescription>
          {editing && (
            <ProjectEditor
              key={editing === "new" ? "new" : editing.id}
              project={editing === "new" ? null : editing}
              sourceSubmissionId={
                editing === "new" && source ? Number(source) : null
              }
              onClose={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(share)}
        onOpenChange={(open) => {
          if (!open) guarded(() => setShare(null));
        }}
      >
        <DialogContent className="portal-ui max-w-2xl">
          <DialogTitle>{t("portalShareTitle")}</DialogTitle>
          <DialogDescription>{share?.title}</DialogDescription>
          {share && (
            <ShareForm
              key={share.id}
              project={share}
              projects={projects.filter((item) => !item.archivedAt)}
              onProjectChange={setShare}
              loadingMore={query.isFetchingNextPage}
              loadMore={
                query.hasNextPage
                  ? () => {
                      void query.fetchNextPage();
                    }
                  : undefined
              }
              onClose={() => setShare(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmAction
        open={Boolean(archive)}
        onOpenChange={(open) => {
          if (!open) setArchive(null);
        }}
        titleKey="portalArchiveTitle"
        objectName={archive?.title}
        description="portalArchiveDescription"
        action="portalArchiveProject"
        pending={archiveAction.isPending}
        error={
          archiveAction.error
            ? message(archiveAction.error, "portalSaveError")
            : undefined
        }
        onConfirm={() => archiveAction.mutate()}
      />
      <ConfirmAction
        open={Boolean(revoke)}
        onOpenChange={(open) => {
          if (!open) setRevoke(null);
        }}
        titleKey="portalRevokeTitle"
        objectName={revoke?.preview.title}
        description="portalRevokeDescription"
        action="portalRevoke"
        pending={revokeAction.isPending}
        error={
          revokeAction.error
            ? message(revokeAction.error, "portalSaveError")
            : undefined
        }
        onConfirm={() => revokeAction.mutate()}
      />
      <Dialog
        open={Boolean(approval)}
        onOpenChange={(open) => {
          if (!open) setApproval(null);
        }}
      >
        <DialogContent className="portal-ui">
          <DialogTitle>{t("portalApprove")}</DialogTitle>
          <DialogDescription>{approval?.share.displayName}</DialogDescription>
          {approval && (
            <div className="space-y-4">
              <h2 className="font-semibold">{approval.share.preview.title}</h2>
              {approval.share.includeDescription && (
                <p className="whitespace-pre-wrap">
                  {approval.share.preview.description}
                </p>
              )}
              {approval.share.includeReview && (
                <p className="whitespace-pre-wrap">
                  {approval.share.preview.teacherReview}
                </p>
              )}
              <PortalFiles ids={approval.share.fileIds} />
              <p className="text-sm">{t("portalConsentDescription")}</p>
              {approveAction.error && (
                <p role="alert" className="text-destructive">
                  {message(approveAction.error, "portalSaveError")}
                </p>
              )}
              <Button
                className="min-h-11"
                disabled={approveAction.isPending}
                onClick={() => approveAction.mutate()}
              >
                {t("portalApprove")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function ProjectEditor({
  project,
  sourceSubmissionId,
  onClose,
}: {
  project: PortalProjectDto | null;
  sourceSubmissionId: number | null;
  onClose: () => void;
}) {
  return sourceSubmissionId && !project ? (
    <SourceProjectForm submissionId={sourceSubmissionId} onClose={onClose} />
  ) : (
    <ProjectForm
      project={project}
      sourceSubmissionId={sourceSubmissionId}
      onClose={onClose}
    />
  );
}
function SourceProjectForm({
  submissionId,
  onClose,
}: {
  submissionId: number;
  onClose: () => void;
}) {
  const query = useSubjectQuery(
    "project-source",
    (link, signal) =>
      portalResourcesApi.projectSource(link, submissionId, signal),
    [submissionId],
  );
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
    <ProjectForm
      project={null}
      sourceSubmissionId={submissionId}
      seed={query.data}
      onClose={onClose}
    />
  );
}
function ProjectForm({
  project,
  sourceSubmissionId,
  onClose,
  seed,
}: {
  project: PortalProjectDto | null;
  sourceSubmissionId: number | null;
  onClose: () => void;
  seed?: PortalProjectInput;
}) {
  const { t } = useTranslation();
  const message = usePortalError();
  const { subject, setUnsaved } = usePortal();
  const notify = usePortalSuccess();
  const invalidate = useInvalidateSubject();
  const courses = useSubjectQuery("courses", portalLmsApi.courses);
  const [values, setValues] = useState<PortalProjectInput>(
    seed ?? {
      title: project?.title ?? "",
      description: project?.description ?? "",
      runId: project?.runId ?? null,
      sourceSubmissionId: project?.sourceSubmissionId ?? sourceSubmissionId,
      links: project?.links ?? [],
      fileIds: project?.files.map((file) => file.id) ?? [],
      coverFileId: project?.coverFileId ?? null,
      version: project?.version ?? 0,
    },
  );
  const [links, setLinks] = useState(values.links.join("\n"));
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState("");
  const [initial] = useState(JSON.stringify(values));
  const [createKey] = useState(() => crypto.randomUUID());
  const action = useMutation({
    mutationFn: () =>
      portalResourcesApi.saveProject(
        subject!.linkId,
        project ? values : { ...values, idempotencyKey: createKey },
        project?.id,
      ),
    onSuccess: () => {
      notify();
      setUnsaved(false);
      void invalidate();
      onClose();
    },
  });
  useEffect(() => {
    setUnsaved(JSON.stringify(values) !== initial || busy);
    return () => setUnsaved(false);
  }, [values, initial, busy, setUnsaved]);
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        setValidation("");
        if (!values.links.every(safeHttps)) {
          setValidation(t("portalInvalidUrl"));
          return;
        }
        action.mutate();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="project-title">{t("portalProjectTitle")}</Label>
        <Input
          id="project-title"
          required
          value={values.title}
          onChange={(event) =>
            setValues({ ...values, title: event.target.value })
          }
          className="min-h-11"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="project-course">{t("portalCourses")}</Label>
        <select
          id="project-course"
          className="min-h-11 w-full rounded-md border bg-background px-3"
          value={values.runId ?? ""}
          onChange={(event) =>
            setValues({
              ...values,
              runId: event.target.value ? Number(event.target.value) : null,
            })
          }
        >
          <option value="">{t("portalSelectCourse")}</option>
          {courses.data?.map((item) => (
            <option key={item.runId} value={item.runId}>
              {item.courseName} · {item.groupName}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="project-description">{t("portalDescription")}</Label>
        <Textarea
          id="project-description"
          value={values.description}
          onChange={(event) =>
            setValues({ ...values, description: event.target.value })
          }
          rows={5}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="project-links">{t("portalLinks")}</Label>
        <Textarea
          id="project-links"
          placeholder={t("portalLinkPlaceholder")}
          value={links}
          onChange={(event) => {
            setLinks(event.target.value);
            setValues({
              ...values,
              links: event.target.value
                .split("\n")
                .map((link) => link.trim())
                .filter(Boolean),
            });
          }}
        />
      </div>
      <PortalUploads
        ids={values.fileIds}
        onChange={(fileIds) =>
          setValues({
            ...values,
            fileIds,
            coverFileId: fileIds.includes(values.coverFileId ?? -1)
              ? values.coverFileId
              : null,
          })
        }
        onBusyChange={setBusy}
      />
      {values.fileIds.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="project-cover">{t("portalCover")}</Label>
          <select
            id="project-cover"
            className="min-h-11 w-full rounded-md border bg-background px-3"
            value={values.coverFileId ?? ""}
            onChange={(event) =>
              setValues({
                ...values,
                coverFileId: event.target.value
                  ? Number(event.target.value)
                  : null,
              })
            }
          >
            <option value="">{t("portalCover")}</option>
            {values.fileIds.map((id, index) => (
              <option key={id} value={id}>
                {t("portalFiles")} {index + 1}
              </option>
            ))}
          </select>
        </div>
      )}
      {(validation || action.error) && (
        <p role="alert" className="text-destructive">
          {validation || message(action.error, "portalSaveError")}
        </p>
      )}
      <Button className="min-h-11" disabled={action.isPending || busy}>
        {t("portalSave")}
      </Button>
    </form>
  );
}
function ShareForm({
  project,
  projects,
  onProjectChange,
  loadingMore,
  loadMore,
  onClose,
}: {
  project: PortalProjectDto;
  projects: PortalProjectDto[];
  onProjectChange: (project: PortalProjectDto) => void;
  loadingMore: boolean;
  loadMore?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const message = usePortalError();
  const { account, subject, setUnsaved, guarded } = usePortal();
  const notify = usePortalSuccess();
  const invalidate = useInvalidateSubject();
  const [preview, setPreview] = useState(false);
  const [createKey] = useState(() => crypto.randomUUID());
  const [consent, setConsent] = useState(false);
  const [values, setValues] = useState<PortalShareInput>({
    projectVersion: project.version,
    displayName: account?.fullName ?? "",
    includeDescription: true,
    includeReview: false,
    fileIds: [],
    expiresAt: null,
    consent: true,
  });
  const action = useMutation({
    mutationFn: () =>
      portalResourcesApi.share(subject!.linkId, project.id, {
        ...values,
        idempotencyKey: createKey,
      }),
    onSuccess: () => {
      notify();
      setUnsaved(false);
      void invalidate();
      onClose();
    },
  });
  useEffect(() => {
    setUnsaved(true);
    return () => setUnsaved(false);
  }, [setUnsaved]);
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="share-project">{t("portalShareProject")}</Label>
        <select
          id="share-project"
          className="min-h-11 w-full rounded-md border bg-background px-3"
          value={project.id}
          disabled={action.isPending}
          onChange={(event) => {
            if (action.isPending) return;
            const selected = projects.find(
              (item) => item.id === Number(event.target.value),
            );
            if (selected && selected.id !== project.id)
              guarded(() => onProjectChange(selected));
          }}
        >
          {projects.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        {loadMore && (
          <Button
            variant="outline"
            className="min-h-11"
            disabled={loadingMore || action.isPending}
            onClick={loadMore}
          >
            {t("portalLoadMore")}
          </Button>
        )}
      </div>
      {!preview ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="share-name">{t("portalDisplayName")}</Label>
            <Input
              id="share-name"
              value={values.displayName}
              onChange={(event) =>
                setValues({ ...values, displayName: event.target.value })
              }
              className="min-h-11"
            />
          </div>
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={values.includeDescription}
              onChange={(event) =>
                setValues({
                  ...values,
                  includeDescription: event.target.checked,
                })
              }
            />
            {t("portalDescription")}
          </label>
          {project.teacherReview && (
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={values.includeReview}
                onChange={(event) =>
                  setValues({ ...values, includeReview: event.target.checked })
                }
              />
              {t("portalFeedback")}
            </label>
          )}
          {project.files.map((file) => (
            <label key={file.id} className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={values.fileIds.includes(file.id)}
                onChange={(event) =>
                  setValues({
                    ...values,
                    fileIds: event.target.checked
                      ? [...values.fileIds, file.id]
                      : values.fileIds.filter((id) => id !== file.id),
                  })
                }
              />
              <span className="break-words">{file.name}</span>
            </label>
          ))}
          <Button
            className="min-h-11"
            disabled={!values.displayName.trim()}
            onClick={() => setPreview(true)}
          >
            {t("portalSharePreview")}
          </Button>
        </>
      ) : (
        <>
          <div className="space-y-3 rounded-md border p-4">
            <p className="text-sm text-muted-foreground">
              {values.displayName}
            </p>
            <h2 className="text-xl font-semibold">{project.title}</h2>
            {values.includeDescription && (
              <p className="whitespace-pre-wrap">{project.description}</p>
            )}
            {values.includeReview && (
              <p className="whitespace-pre-wrap">{project.teacherReview}</p>
            )}
            <PortalFiles ids={values.fileIds} />
          </div>
          {subject?.studentClassification === "adult" && (
            <label className="flex min-h-11 items-start gap-3">
              <input
                className="mt-1"
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span>{t("portalConsentDescription")}</span>
            </label>
          )}
          {action.error && (
            <p role="alert" className="text-destructive">
              {message(action.error, "portalSaveError")}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => setPreview(false)}
            >
              {t("portalBack")}
            </Button>
            <Button
              className="min-h-11"
              disabled={
                action.isPending ||
                (subject?.studentClassification === "adult" && !consent)
              }
              onClick={() => action.mutate()}
            >
              {t("portalPublish")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
export function PublicPortfolio({ token }: { token: string }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["portal-public-project", token],
    queryFn: ({ signal }) => portalResourcesApi.publicProject(token, signal),
    staleTime: 0,
    retry: false,
  });
  useEffect(() => {
    const tag = document.createElement("meta");
    tag.name = "robots";
    tag.content = "noindex, nofollow";
    document.head.appendChild(tag);
    return () => tag.remove();
  }, []);
  return (
    <main className="portal-ui mx-auto min-h-dvh max-w-3xl space-y-6 px-4 py-10">
      <p className="text-xl font-semibold">{t("publicAttendanceBrand")}</p>
      {query.isPending ? (
        <PortalLoading />
      ) : query.error ? (
        <PortalEmpty labelKey="portalPublicPortfolioUnavailable" />
      ) : (
        <article className="space-y-6">
          <header className="space-y-2">
            <p className="text-muted-foreground">{query.data.displayName}</p>
            <h1 className="text-3xl font-semibold">{query.data.title}</h1>
          </header>
          {query.data.coverUrl && (
            <img
              src={query.data.coverUrl}
              alt={query.data.title}
              className="w-full rounded-xl"
            />
          )}
          {query.data.description && (
            <p className="whitespace-pre-wrap leading-relaxed">
              {query.data.description}
            </p>
          )}
          {query.data.teacherReview && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t("portalFeedback")}
                </CardTitle>
              </CardHeader>
              <CardContent className="whitespace-pre-wrap">
                {query.data.teacherReview}
              </CardContent>
            </Card>
          )}
          {query.data.links.filter(safeHttps).map((link) => (
            <a
              key={link}
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="block break-all text-primary underline"
            >
              {link}
            </a>
          ))}
          {query.data.files.map((file) => (
            <Button
              key={file.downloadUrl}
              asChild
              variant="outline"
              className="min-h-11 max-w-full"
            >
              <a href={file.downloadUrl} download className="truncate">
                {file.name}
              </a>
            </Button>
          ))}
        </article>
      )}
    </main>
  );
}
