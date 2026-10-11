import { PortalDialogContent as DialogContent } from "../learning-content/modal-content";
import { useEffect, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import type { PortalFileDto } from "@shared/contracts/portal-resources";
import { PORTAL_MAX_FILE_BYTES } from "@shared/contracts/portal-resources";
import { useTranslation } from "@/hooks/useTranslation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { lmsStaffApi } from "./api";
import { lmsStaffKey } from "./queries";
import { StaffConfirm, useStaffError } from "./ui";
export function useStaffFiles(
  runId: number,
  ids: number[],
  fileRunIds: Record<number, number> = {},
) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: [...lmsStaffKey, "file", fileRunIds[id] ?? runId, id],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        lmsStaffApi.file(id, fileRunIds[id] ?? runId, signal),
      refetchInterval: (query: {
        state: { data: PortalFileDto | undefined };
      }) => (query.state.data?.state === "checking" ? 2000 : (false as const)),
    })),
  });
}
export function StaffFiles({
  runId,
  ids,
  fileRunIds,
}: {
  runId: number;
  ids: number[];
  fileRunIds?: Record<number, number>;
}) {
  const { t } = useTranslation();
  const results = useStaffFiles(runId, ids, fileRunIds);
  const [preview, setPreview] = useState<PortalFileDto | null>(null);
  const safeDownload = (file: PortalFileDto) =>
    file.downloadUrl?.startsWith("/api/lms-management/files/");
  return (
    <>
      <div className="space-y-2">
        {results.map((query, index) => {
          const file = query.data;
          return (
            <div
              key={ids[index]}
              className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-md border p-3"
            >
              <span className="min-w-0 break-words text-sm">
                {file?.name ?? t("portalFiles")}
              </span>
              {file?.state === "ready" && safeDownload(file) ? (
                <div className="flex flex-wrap gap-2">
                  {(file.mime.startsWith("image/") ||
                    file.mime === "application/pdf") && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setPreview(file)}
                    >
                      {t("lmsStaffPreview")}
                    </Button>
                  )}
                  <a
                    href={file.downloadUrl!}
                    className="inline-flex min-h-11 items-center text-sm text-primary underline"
                    download
                  >
                    {t("portalDownload")}
                  </a>
                </div>
              ) : (
                <span role="status" className="text-sm text-muted-foreground">
                  {t(
                    file?.state === "rejected"
                      ? "portalUploadError"
                      : "portalUploading",
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogTitle>{preview?.name ?? t("portalFiles")}</DialogTitle>
          <DialogDescription>{t("lmsStaffPreview")}</DialogDescription>
          {preview &&
            safeDownload(preview) &&
            (preview.mime === "application/pdf" ? (
              <iframe
                className="h-[65dvh] w-full rounded-md border"
                title={preview.name}
                src={`${preview.downloadUrl}${preview.downloadUrl?.includes("?") ? "&" : "?"}preview=1`}
              />
            ) : (
              <img
                className="max-h-[65dvh] w-full object-contain"
                src={`${preview.downloadUrl}${preview.downloadUrl?.includes("?") ? "&" : "?"}preview=1`}
                alt={preview.name}
              />
            ))}
        </DialogContent>
      </Dialog>
    </>
  );
}
export function StaffUploads({
  runId,
  ids,
  onChange,
  onBusyChange,
  max = 5,
  fileRunIds,
}: {
  runId: number;
  ids: number[];
  onChange: (ids: number[]) => void;
  onBusyChange?: (busy: boolean) => void;
  max?: number;
  fileRunIds?: Record<number, number>;
}) {
  const { t } = useTranslation();
  const errorText = useStaffError();
  const input = useRef<HTMLInputElement>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const uploadControllers = useRef<AbortController[]>([]);
  const [uploads, setUploads] = useState<
    Array<{
      key: string;
      file: File;
      controller: AbortController;
      progress: number;
      error: unknown | null;
    }>
  >([]);
  const [validation, setValidation] = useState("");
  const [remove, setRemove] = useState<number | null>(null);
  const ready = useStaffFiles(runId, ids, fileRunIds);
  const busy =
    uploads.some((item) => !item.error) ||
    ready.some((query) => query.isPending || query.data?.state === "checking");
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(
    () => () => {
      uploadControllers.current.forEach((controller) => controller.abort());
    },
    [],
  );
  async function upload(file: File) {
    const key = crypto.randomUUID();
    const controller = new AbortController();
    uploadControllers.current.push(controller);
    setUploads((items) => [
      ...items,
      { key, file, controller, progress: 0, error: null },
    ]);
    try {
      const result = await lmsStaffApi.upload(
        runId,
        file,
        controller.signal,
        (progress) =>
          setUploads((items) =>
            items.map((item) =>
              item.key === key ? { ...item, progress } : item,
            ),
          ),
      );
      onChange([...idsRef.current, result.id]);
      setUploads((items) => items.filter((item) => item.key !== key));
    } catch (error) {
      if (!controller.signal.aborted)
        setUploads((items) =>
          items.map((item) => (item.key === key ? { ...item, error } : item)),
        );
    }
  }
  function add(files: File[]) {
    setValidation("");
    if (
      ids.length + uploads.length + files.length > max ||
      files.some((file) => file.size > PORTAL_MAX_FILE_BYTES)
    ) {
      setValidation(t("portalInvalidFile"));
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
        onClick={() => input.current?.click()}
        disabled={ids.length + uploads.length >= max}
      >
        {t("portalUpload")}
      </Button>
      {validation && (
        <p role="alert" className="text-sm text-destructive">
          {validation}
        </p>
      )}
      <StaffFiles runId={runId} ids={ids} fileRunIds={fileRunIds} />
      {ids.map((id) => (
        <div key={id} className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            aria-label={t("portalRemove")}
            onClick={() => setRemove(id)}
          >
            {t("portalRemove")}
          </Button>
        </div>
      ))}
      <div aria-live="polite" className="space-y-3">
        {uploads.map((item) => (
          <div key={item.key} className="space-y-2 rounded-md border p-3">
            <p className="break-words text-sm">{item.file.name}</p>
            {item.error ? (
              <>
                <p role="alert" className="text-sm text-destructive">
                  {errorText(item.error, "portalUploadError")}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setUploads((items) =>
                      items.filter((existing) => existing.key !== item.key),
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
                setUploads((items) =>
                  items.filter((existing) => existing.key !== item.key),
                );
              }}
            >
              {t("portalCancel")}
            </Button>
          </div>
        ))}
      </div>
      <StaffConfirm
        open={remove !== null}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
        titleKey="portalRemoveFileTitle"
        description="portalRemoveFileDescription"
        action="portalRemove"
        onConfirm={() => {
          onChange(ids.filter((id) => id !== remove));
          setRemove(null);
        }}
      />
    </div>
  );
}
