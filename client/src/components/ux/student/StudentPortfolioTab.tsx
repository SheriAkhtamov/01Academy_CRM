import { useEffect, useId, useRef, useState } from "react";
import {
  ExternalLink,
  File,
  FolderOpen,
  Link,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MAX_STUDENT_PROJECT_BYTES,
  studentProjectLinkSchema,
  type StudentProject,
} from "@shared/contracts/student-profile";
import { studentsApi } from "@/features/students/api";
import { useTranslation } from "@/hooks/useTranslation";
import { toast } from "@/hooks/use-toast";
import { localizeApiErrorMessage } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CompactModalSection } from "@/components/ux/CompactModalSection";
import { OrbitSpinner } from '@/components/ui/orbit-spinner';

export function StudentPortfolioTab({
  studentId,
  projects,
  open,
  loading,
  readOnly = false,
  requestAction,
  onDraftChange,
  dateTime,
}: {
  studentId: number;
  projects: StudentProject[];
  open: boolean;
  loading: boolean;
  readOnly?: boolean;
  requestAction: (action: () => void) => void;
  onDraftChange: (dirty: boolean, pending: boolean) => void;
  dateTime: (value: string | null | undefined) => string;
}) {
  const { t, language } = useTranslation();
  const queryClient = useQueryClient();
  const fieldId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState("link");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [percent, setPercent] = useState(0);
  const save = useMutation({
    mutationFn: (input: { title: string; url?: string; file?: File }) =>
      studentsApi.addProject(studentId, input, setPercent),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["student-profile", studentId],
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/academy/sales"] });
      setTitle("");
      setUrl("");
      setFile(undefined);
      setAdding(false);
      setPercent(0);
      setError(null);
      toast({ title: t("studentProjectSaved") });
    },
    onError: (error: Error & { status?: number }) =>
      setError(localizeApiErrorMessage(error.message, error.status ?? 0)),
  });
  const dirty = Boolean(title.trim() || url.trim() || file);
  useEffect(() => {
    onDraftChange(dirty, save.isPending);
  }, [dirty, onDraftChange, save.isPending]);
  useEffect(() => () => onDraftChange(false, false), [onDraftChange]);
  useEffect(() => {
    if (open) return;
    setAdding(false);
    setTitle("");
    setUrl("");
    setFile(undefined);
    setError(null);
    setPercent(0);
  }, [open, studentId]);
  const changeMode = (next: string) => {
    setMode(next);
    setError(null);
  };
  const submit = () => {
    if (!title.trim()) {
      setError(t("studentProjectTitleRequired"));
      return;
    }
    if (mode === "link" && !studentProjectLinkSchema.safeParse(url).success) {
      setError(t("studentProjectInvalidLink"));
      return;
    }
    if (mode === "file" && !file) {
      setError(t("studentProjectSourceRequired"));
      return;
    }
    setError(null);
    setPercent(0);
    save.mutate({
      title: title.trim(),
      ...(mode === "file" ? { file } : { url: url.trim() }),
    });
  };
  return (
    <CompactModalSection
      title={t("portfolio")}
      icon={FolderOpen}
      tone="violet"
      count={projects.length}
      collapsible={false}
      contentClassName="space-y-3"
      actions={!readOnly ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-xs"
          disabled={adding || loading}
          onClick={() => setAdding(true)}
        >
          <Plus className="size-3.5" data-icon="inline-start" />
          {t("studentProjectAdd")}
        </Button>
      ) : null}
    >
      {adding ? (
        <form
          className="space-y-2.5 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!save.isPending) submit();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor={`${fieldId}-title`} className="text-xs">
              {t("studentProjectTitle")}
            </Label>
            <Input
              id={`${fieldId}-title`}
              className="h-8 text-xs"
              value={title}
              maxLength={255}
              autoFocus
              disabled={save.isPending}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <Tabs value={mode} onValueChange={changeMode}>
            <TabsList className="grid h-8 w-full grid-cols-2 p-0.5">
              <TabsTrigger value="link" disabled={save.isPending} className="h-7 text-xs">
                <Link className="mr-1.5 size-3.5" />
                {t("studentProjectLink")}
              </TabsTrigger>
              <TabsTrigger value="file" disabled={save.isPending} className="h-7 text-xs">
                <File className="mr-1.5 size-3.5" />
                {t("mediaFile")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {mode === "link" ? (
            <div className="space-y-1">
              <Label htmlFor={`${fieldId}-link`} className="text-xs">
                {t("studentProjectLink")}
              </Label>
              <Input
                id={`${fieldId}-link`}
                type="url"
                className="h-8 text-xs"
                value={url}
                disabled={save.isPending}
                maxLength={2000}
                onChange={(event) => setUrl(event.target.value)}
              />
            </div>
          ) : (
            <div>
              <input
                ref={fileInput}
                type="file"
                className="sr-only"
                id={`${fieldId}-file`}
                aria-label={t("mediaFile")}
                disabled={save.isPending}
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  event.target.value = "";
                  if (!selected) return;
                  if (selected.size > MAX_STUDENT_PROJECT_BYTES) {
                    setFile(undefined);
                    setError(t("studentProjectFileTooLarge"));
                    return;
                  }
                  setFile(selected);
                  setError(null);
                  if (!title.trim())
                    setTitle(
                      selected.name.replace(/\.[^.]+$/, "").slice(0, 255),
                    );
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="h-auto min-h-9 w-full justify-start gap-2 border-dashed px-3 py-1.5 text-xs"
                disabled={save.isPending}
                onClick={() => fileInput.current?.click()}
              >
                <Upload className="size-3.5 shrink-0" />
                <span className="min-w-0 break-all text-left">
                  {file?.name ?? t("studentProjectChooseFile")}
                </span>
              </Button>
            </div>
          )}
          {save.isPending && mode === "file" ? (
            <div className="space-y-1">
              <p role="status" className="text-[11px] text-muted-foreground">
                {t("studentProjectUploading").replace(
                  "{percent}",
                  String(percent),
                )}
              </p>
              <Progress value={percent} aria-label={t("mediaFile")} className="h-1.5" />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-xs"
              disabled={save.isPending}
              onClick={() =>
                requestAction(() => {
                  setAdding(false);
                  setTitle("");
                  setUrl("");
                  setFile(undefined);
                  setError(null);
                })
              }
            >
              <X className="size-3.5" data-icon="inline-start" />
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm" className="h-7 px-2.5 text-xs" disabled={save.isPending}>
              {save.isPending ? (
                <OrbitSpinner data-icon="inline-start" className="size-3.5" />
              ) : (
                <Plus className="size-3.5" data-icon="inline-start" />
              )}
              {t("studentProjectAdd")}
            </Button>
          </div>
        </form>
      ) : null}
      {loading ? (
        <p
          role="status"
          className="py-5 text-center text-xs text-muted-foreground"
        >
          {t("loading")}
        </p>
      ) : projects.length === 0 && !adding ? (
        <div className="grid place-items-center gap-1.5 rounded-lg border border-dashed py-6 text-xs text-muted-foreground">
          <FolderOpen className="size-5 opacity-60" />
          {t("noProjects")}
        </div>
      ) : (
        <div className="divide-y rounded-lg border bg-card">
          {projects.map((project) => (
            <div
              key={project.id}
              className="flex flex-wrap items-center gap-2.5 px-3 py-2"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-violet-500/10 text-violet-700 dark:text-violet-300">
                {project.fileUrl ? (
                  <File className="size-3.5" />
                ) : (
                  <Link className="size-3.5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-xs font-medium leading-tight">
                  {project.title}
                </p>
                <p className="mt-0.5 break-all text-[11px] text-muted-foreground">
                  {project.fileName || dateTime(project.createdAt)}
                </p>
              </div>
              {project.url &&
              studentProjectLinkSchema.safeParse(project.url).success ? (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
                  <a
                    href={project.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="size-3.5" data-icon="inline-start" />
                    {t("studentProjectOpen")}
                  </a>
                </Button>
              ) : null}
              {project.fileUrl &&
              project.fileUrl.startsWith(
                `/api/academy/students/${studentId}/projects/files/`,
              ) ? (
                <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" asChild>
                  <a
                    href={
                      readOnly
                        ? `${project.fileUrl}&context=teacher`
                        : project.fileUrl
                    }
                  >
                    {t("download")}
                  </a>
                </Button>
              ) : null}
              {project.attachments
                ?.filter((attachment) =>
                  /^\/api\/lms-management\/files\/[1-9]\d*\/download$/.test(
                    attachment.downloadUrl,
                  ),
                )
                .map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <p className="break-words text-xs">{attachment.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Intl.NumberFormat(
                          language === "ru" ? "ru" : "en",
                          {
                            style: "unit",
                            unit: "megabyte",
                            unitDisplay: "short",
                            maximumFractionDigits: 1,
                          },
                        ).format(attachment.size / 1_000_000)}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" asChild>
                      <a href={attachment.downloadUrl} download>
                        {t("download")}
                      </a>
                    </Button>
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
    </CompactModalSection>
  );
}
