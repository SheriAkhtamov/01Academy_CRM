import { useEffect, useRef, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Download, Eye, FileText, Paperclip, Trash2 } from "lucide-react";
import {
  PORTAL_MAX_FILE_BYTES,
  type PortalFileDto,
} from "@shared/contracts/portal-resources";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  PortalDialogContent as DialogContent,
  ConfirmAction,
  usePortalError,
} from "./ui";
import { portalResourcesApi } from "./resources-api";
import { portalSubjectKey, usePortal } from "./context";

function previewUrl(file: PortalFileDto, linkId?: number) {
  const url = new URL(
    file.downloadUrl ??
      `/api/portal/files/${file.id}/download?linkId=${linkId}`,
    window.location.origin,
  );
  url.searchParams.set("preview", "1");
  return url.href;
}
export function usePortalFiles(ids: number[]) {
  const { account, subject } = usePortal();
  return useQueries({
    queries: ids.map((id) => ({
      queryKey:
        account && subject
          ? portalSubjectKey(account, subject, "file", id)
          : ["portal-file", id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        portalResourcesApi.file(id, subject!.linkId, signal),
      enabled: Boolean(account && subject),
      staleTime: 60_000,
      refetchInterval: (query: { state: { data?: PortalFileDto } }) =>
        query.state.data?.state === "checking" ||
        query.state.data?.state === "uploading"
          ? 1500
          : (false as const),
    })),
  });
}
export function PortalFiles({
  ids,
  onRemove,
}: {
  ids: number[];
  onRemove?: (id: number) => void;
}) {
  const { t } = useTranslation();
  const { subject } = usePortal();
  const files = usePortalFiles(ids);
  const [preview, setPreview] = useState<PortalFileDto | null>(null);
  return (
    <>
      <div className="space-y-2">
        {files.map((query, index) => (
          <div
            key={ids[index]}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border/70 bg-muted/20 p-3"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground" aria-hidden="true">
              <FileText className="size-4" />
            </span>
            <span className="min-w-0 flex-1 break-words text-sm font-medium">
              {query.data?.name ?? t("portalFiles")}
              {query.data && (
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  {query.data.name.includes(".") &&
                    `${query.data.name.split(".").pop()?.toLocaleUpperCase()} · `}
                  {t("portalFileSize").replace(
                    "{size}",
                    (query.data.size / 1024 / 1024).toFixed(1),
                  )}
                </span>
              )}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-1">
              {query.error ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void query.refetch();
                  }}
                >
                  {t("portalRetry")}
                </Button>
              ) : query.data?.state !== "ready" ? (
                <span className="text-sm text-muted-foreground" role="status">
                  {t(
                    query.data?.state === "rejected"
                      ? "portalFileRejected"
                      : "portalFileChecking",
                  )}
                </span>
              ) : (
                <div className="flex items-center gap-1">
                  {[
                    "image/png",
                    "image/jpeg",
                    "image/webp",
                    "application/pdf",
                  ].includes(query.data.mime) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPreview(query.data ?? null)}
                    >
                      <Eye aria-hidden="true" />
                      {t("portalOpen")}
                    </Button>
                  )}
                  <Button asChild variant="ghost" size="sm">
                    <a
                      href={
                        query.data.downloadUrl ??
                        `/api/portal/files/${ids[index]}/download?linkId=${subject?.linkId}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                    >
                      <Download aria-hidden="true" />
                      {t("portalDownload")}
                    </a>
                  </Button>
                </div>
              )}
              {onRemove && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 text-muted-foreground hover:text-destructive"
                  aria-label={`${t("portalRemove")} ${query.data?.name ?? ""}`}
                  onClick={() => onRemove(ids[index])}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent className="portal-ui max-w-4xl">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle>{preview?.name}</DialogTitle>
            <DialogDescription>
              {preview &&
                t("portalFileSize").replace(
                  "{size}",
                  (preview.size / 1024 / 1024).toFixed(1),
                )}
            </DialogDescription>
          </DialogHeader>
          {preview?.mime.startsWith("image/") ? (
            <img
              src={previewUrl(preview, subject?.linkId)}
              alt={preview.name}
              className="max-h-[70dvh] w-full object-contain"
            />
          ) : (
            preview?.mime === "application/pdf" && (
              <iframe
                title={preview.name}
                src={previewUrl(preview, subject?.linkId)}
                className="h-[65dvh] w-full"
              />
            )
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
type UploadItem = {
  key: string;
  file: File;
  progress: number;
  controller: AbortController;
  error: unknown;
  id?: number;
};
export function PortalUploads({
  ids,
  onChange,
  onBusyChange,
  max = 5,
}: {
  ids: number[];
  onChange: (ids: number[]) => void;
  onBusyChange?: (busy: boolean) => void;
  max?: number;
}) {
  const { t } = useTranslation();
  const { subject, account } = usePortal();
  const policy = useQuery({
    queryKey: ["portal-account", account?.id, "file-policy"],
    queryFn: ({ signal }) => portalResourcesApi.filePolicy(signal),
    enabled: Boolean(account),
    staleTime: 30_000,
  });
  const maximumMiB =
    policy.data?.maxFileMiB ?? PORTAL_MAX_FILE_BYTES / 1024 / 1024;
  const message = usePortalError();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [validation, setValidation] = useState("");
  const [remove, setRemove] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const controllers = useRef<AbortController[]>([]);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const files = usePortalFiles(ids);
  const busy =
    uploads.some((item) => !item.error && item.progress < 100) ||
    files.some((query) => !query.data || query.data.state !== "ready");
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    mounted.current = true;
    const activeControllers = controllers.current;
    return () => {
      mounted.current = false;
      activeControllers.forEach((controller) => controller.abort());
    };
  }, []);
  async function upload(file: File) {
    if (!subject) return;
    const controller = new AbortController();
    controllers.current.push(controller);
    const item: UploadItem = {
      key: crypto.randomUUID(),
      file,
      progress: 0,
      controller,
      error: null,
    };
    setUploads((previous) => [...previous, item]);
    try {
      const result = await portalResourcesApi.upload(
        subject.linkId,
        file,
        (progress) => {
          if (mounted.current)
            setUploads((previous) =>
              previous.map((existing) =>
                existing.controller === controller
                  ? { ...existing, progress: Math.min(progress, 99) }
                  : existing,
              ),
            );
        },
        controller.signal,
      );
      if (mounted.current) {
        onChange([...idsRef.current, result.id]);
        setUploads((previous) =>
          previous.filter((existing) => existing.controller !== controller),
        );
      }
    } catch (error) {
      if (mounted.current) {
        if ((error as Error).name === "AbortError")
          setUploads((previous) =>
            previous.filter((existing) => existing.controller !== controller),
          );
        else
          setUploads((previous) =>
            previous.map((existing) =>
              existing.controller === controller
                ? { ...existing, error }
                : existing,
            ),
          );
      }
    }
  }
  function add(files: File[]) {
    setValidation("");
    if (
      ids.length + uploads.length + files.length > max ||
      files.some(
        (file) => file.size > maximumMiB * 1024 * 1024 || file.size === 0,
      )
    ) {
      setValidation(
        t("portalInvalidFilesLimit")
          .replace("{count}", String(max))
          .replace("{size}", String(maximumMiB)),
      );
      return;
    }
    files.forEach((file) => {
      void upload(file);
    });
  }
  return (
    <div
      className="space-y-3"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        add(Array.from(event.dataTransfer.files));
      }}
    >
      <Input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        aria-label={t("portalUpload")}
        onChange={(event) => {
          add(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => input.current?.click()}
        disabled={ids.length + uploads.length >= max}
      >
        <Paperclip aria-hidden="true" />
        {t("portalUpload")}
      </Button>
      {validation && (
        <p role="alert" className="text-sm text-destructive">
          {validation}
        </p>
      )}
      <PortalFiles ids={ids} onRemove={setRemove} />
      <div aria-live="polite" className="space-y-3">
        {uploads.map((item) => (
          <div key={item.key} className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
            <p className="break-words text-sm">{item.file.name}</p>
            {item.error ? (
              <>
                <p role="alert" className="text-sm text-destructive">
                  {message(item.error, "portalUploadError")}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setUploads((previous) =>
                      previous.filter(
                        (existing) => existing.controller !== item.controller,
                      ),
                    );
                    void upload(item.file);
                  }}
                >
                  {t("portalRetry")}
                </Button>
              </>
            ) : (
              <Progress
                value={item.progress}
                aria-label={t("portalUploading")}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                item.controller.abort();
                setUploads((previous) =>
                  previous.filter(
                    (existing) => existing.controller !== item.controller,
                  ),
                );
              }}
            >
              {t("portalCancel")}
            </Button>
          </div>
        ))}
      </div>
      <ConfirmAction
        open={remove !== null}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
        titleKey="portalRemoveFileTitle"
        objectName={
          remove === null ? undefined : files[ids.indexOf(remove)]?.data?.name
        }
        description="portalRemoveFileDescription"
        onConfirm={() => {
          onChange(ids.filter((id) => id !== remove));
          setRemove(null);
        }}
      />
    </div>
  );
}
