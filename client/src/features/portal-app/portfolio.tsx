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
import {
  Dialog,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import Logo from "@/components/Logo";
import { PageHeader } from "@/components/ux/PageHeader";
import { ModulePage } from "@/components/ux/ModulePage";
import { PortalSelect, PortalToolbar } from "./controls";
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
          <Button onClick={() => setEditing("new")}>
            {t("portalAddProject")}
          </Button>
        )}
      </PortalTitle>
      <PortalToolbar>
        <PortalSelect
          className="w-full sm:w-72"
          aria-label={t("portalCourses")}
          value={course}
          onValueChange={setCourse}
          options={[
            { value: "", label: t("portalAllCourses") },
            ...courses.map(([id, name]) => ({
              value: String(id),
              label: name,
            })),
          ]}
        />
      </PortalToolbar>
      {items.length === 0 && !query.hasNextPage && (
        <PortalEmpty labelKey="noProjects" />
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <Card key={item.id} className="flex h-full flex-col overflow-hidden">
            {item.coverFileId && (
              <img
                src={`/api/portal/files/${item.coverFileId}/download?linkId=${subject?.linkId}`}
                alt={item.title}
                className="aspect-video w-full object-cover"
                loading="lazy"
              />
            )}
            <CardHeader className="p-4 pb-0">
              <CardTitle className="text-base">{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3 p-4">
              <p className="line-clamp-3 text-sm text-muted-foreground">
                {item.description}
              </p>
              <p className="text-xs text-muted-foreground">{item.courseName}</p>
              <ProjectPublicationStatus project={item} />
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
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
                        size="sm"
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
          <DialogHeader>
            <DialogTitle>{selected?.title}</DialogTitle>
            <DialogDescription>{selected?.courseName}</DialogDescription>
          </DialogHeader>
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
                        onClick={() => setRevoke(value)}
                      >
                        {t("portalRevoke")}
                      </Button>
                    )}
                  </div>
                ))}
              {allowed("portfolio.edit", true) && (
                <DialogFooter className="flex-wrap border-t border-border/70 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelected(null);
                      setEditing(selected);
                    }}
                  >
                    {t("portalEditProject")}
                  </Button>
                  {subject?.studentClassification !== "unverified" && (
                    <Button
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
                    onClick={() => setArchive(selected)}
                  >
                    {t("portalArchiveProject")}
                  </Button>
                </DialogFooter>
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
          <DialogHeader>
            <DialogTitle>
              {t(editing === "new" ? "portalAddProject" : "portalEditProject")}
            </DialogTitle>
            <DialogDescription>{subject?.studentName}</DialogDescription>
          </DialogHeader>
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
          <DialogHeader>
            <DialogTitle>{t("portalShareTitle")}</DialogTitle>
            <DialogDescription>{share?.title}</DialogDescription>
          </DialogHeader>
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
          <DialogHeader>
            <DialogTitle>{t("portalApprove")}</DialogTitle>
            <DialogDescription>{approval?.share.displayName}</DialogDescription>
          </DialogHeader>
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
              <DialogFooter className="border-t border-border/70 pt-4">
                <Button
                  disabled={approveAction.isPending}
                  onClick={() => approveAction.mutate()}
                >
                  {t("portalApprove")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function ProjectPublicationStatus({ project }: { project: PortalProjectDto }) {
  const { t } = useTranslation();
  const published = project.shares.some(
    (share) => share.status === "published",
  );
  const pending = project.shares.some((share) =>
    ["awaiting_approval", "awaiting_moderation"].includes(share.status),
  );
  return (
    <Badge
      variant={published ? "success" : pending ? "warning" : "secondary"}
      className="self-start"
    >
      {t(
        published
          ? "portalPublished"
          : pending
            ? "portalPendingApproval"
            : "portalPrivate",
      )}
    </Badge>
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
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="project-course">{t("portalCourses")}</Label>
        <PortalSelect
          id="project-course"
          value={String(values.runId ?? "")}
          onValueChange={(value) =>
            setValues({
              ...values,
              runId: value ? Number(value) : null,
            })
          }
          options={[
            { value: "", label: t("portalSelectCourse") },
            ...(courses.data ?? []).map((item) => ({
              value: String(item.runId),
              label: `${item.courseName} · ${item.groupName}`,
            })),
          ]}
        />
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
          <PortalSelect
            id="project-cover"
            value={String(values.coverFileId ?? "")}
            onValueChange={(value) =>
              setValues({
                ...values,
                coverFileId: value ? Number(value) : null,
              })
            }
            options={[
              { value: "", label: t("portalCover") },
              ...values.fileIds.map((id, index) => ({
                value: String(id),
                label: `${t("portalFiles")} ${index + 1}`,
              })),
            ]}
          />
        </div>
      )}
      {(validation || action.error) && (
        <p role="alert" className="text-destructive">
          {validation || message(action.error, "portalSaveError")}
        </p>
      )}
      <DialogFooter className="border-t border-border/70 pt-4">
        <Button disabled={action.isPending || busy}>{t("portalSave")}</Button>
      </DialogFooter>
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
        <PortalSelect
          id="share-project"
          value={String(project.id)}
          disabled={action.isPending}
          onValueChange={(value) => {
            if (action.isPending) return;
            const selected = projects.find((item) => item.id === Number(value));
            if (selected && selected.id !== project.id)
              guarded(() => onProjectChange(selected));
          }}
          options={projects.map((item) => ({
            value: String(item.id),
            label: item.title,
          }))}
        />
        {loadMore && (
          <Button
            variant="outline"
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
            />
          </div>
          <label className="flex min-h-9 cursor-pointer items-center gap-3 py-1 text-sm [@media(pointer:coarse)]:min-h-11">
            <Checkbox
              checked={values.includeDescription}
              onCheckedChange={(checked) =>
                setValues({
                  ...values,
                  includeDescription: checked === true,
                })
              }
            />
            {t("portalDescription")}
          </label>
          {project.teacherReview && (
            <label className="flex min-h-9 cursor-pointer items-center gap-3 py-1 text-sm [@media(pointer:coarse)]:min-h-11">
              <Checkbox
                checked={values.includeReview}
                onCheckedChange={(checked) =>
                  setValues({ ...values, includeReview: checked === true })
                }
              />
              {t("portalFeedback")}
            </label>
          )}
          {project.files.map((file) => (
            <label
              key={file.id}
              className="flex min-h-9 cursor-pointer items-center gap-3 py-1 text-sm [@media(pointer:coarse)]:min-h-11"
            >
              <Checkbox
                checked={values.fileIds.includes(file.id)}
                onCheckedChange={(checked) =>
                  setValues({
                    ...values,
                    fileIds:
                      checked === true
                        ? [...values.fileIds, file.id]
                        : values.fileIds.filter((id) => id !== file.id),
                  })
                }
              />
              <span className="break-words">{file.name}</span>
            </label>
          ))}
          <DialogFooter className="border-t border-border/70 pt-4">
            <Button
              disabled={!values.displayName.trim()}
              onClick={() => setPreview(true)}
            >
              {t("portalSharePreview")}
            </Button>
          </DialogFooter>
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
            <label className="flex min-h-9 cursor-pointer items-start gap-3 text-sm leading-6 [@media(pointer:coarse)]:min-h-11">
              <Checkbox
                className="mt-1"
                checked={consent}
                onCheckedChange={(checked) => setConsent(checked === true)}
              />
              <span>{t("portalConsentDescription")}</span>
            </label>
          )}
          {action.error && (
            <p role="alert" className="text-destructive">
              {message(action.error, "portalSaveError")}
            </p>
          )}
          <DialogFooter className="flex-wrap border-t border-border/70 pt-4">
            <Button variant="outline" onClick={() => setPreview(false)}>
              {t("portalBack")}
            </Button>
            <Button
              disabled={
                action.isPending ||
                (subject?.studentClassification === "adult" && !consent)
              }
              onClick={() => action.mutate()}
            >
              {t("portalPublish")}
            </Button>
          </DialogFooter>
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
    <main className="portal-ui min-h-dvh text-sm">
      <ModulePage className="max-w-3xl space-y-6">
        <div className="flex items-center gap-2">
          <Logo size="sm" />
          <p className="font-semibold">{t("publicAttendanceBrand")}</p>
        </div>
        {query.isPending ? (
          <PortalLoading />
        ) : query.error ? (
          <PortalEmpty labelKey="portalPublicPortfolioUnavailable" />
        ) : (
          <article className="space-y-6">
            <PageHeader
              title={query.data.title}
              subtitle={query.data.displayName}
            />
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
                className="max-w-full"
              >
                <a href={file.downloadUrl} download className="truncate">
                  {file.name}
                </a>
              </Button>
            ))}
          </article>
        )}
      </ModulePage>
    </main>
  );
}
