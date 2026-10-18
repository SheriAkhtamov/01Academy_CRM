import { useEffect, useRef, useState } from 'react';
import { FileCheck2, FileUp, RotateCcw, X } from 'lucide-react';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MIB } from '@shared/upload-policy';
import type { CourseCurriculumMaterial } from '@shared/contracts/course-curriculum';
import type { PortalFileDto } from '@shared/contracts/portal-resources';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import ConfirmDialog from '@/components/ConfirmDialog';
import { courseMaterialFilesApi } from './files-api';

type MaterialFile = NonNullable<CourseCurriculumMaterial['file']>;

function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

function resolveUploadErrorKey(code: string): TranslationKey {
  if (code === 'portalFileTooLarge') return 'courseFileSizeExceeded';
  if (code === 'portalFileTypeUnsupported' || code === 'portalFileNameInvalid') return 'courseFileUnsupported';
  if (code === 'portalFileQuotaExceeded') return 'courseFileQuotaExceeded';
  return 'courseFileUploadFailed';
}

function formatFileSize(
  bytes: number,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (bytes >= 1024 * 1024) {
    return t('courseFileSizeMb', { size: (bytes / (1024 * 1024)).toFixed(1) });
  }
  if (bytes >= 1024) {
    return t('courseFileSizeKb', { size: Math.max(1, Math.round(bytes / 1024)) });
  }
  return t('courseFileSizeBytes', { size: Math.max(0, bytes) });
}

export function CourseMaterialFileUpload({ materialId, file, onUploaded, onBusyChange, disabled = false }: {
  materialId: string;
  file?: MaterialFile;
  onUploaded: (file: MaterialFile) => void;
  onBusyChange: (id: string, busy: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<AbortController | null>(null);
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;
  const onBusyChangeRef = useRef(onBusyChange);
  onBusyChangeRef.current = onBusyChange;
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [retryFile, setRetryFile] = useState<File | null>(null);
  const [replacement, setReplacement] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => () => {
    active.current?.abort();
    active.current = null;
    onBusyChangeRef.current(materialId, false);
  }, [materialId]);

  const upload = async (selected: File) => {
    if (active.current || disabled) return;
    const controller = new AbortController();
    active.current = controller;
    setError(''); setRetryFile(null); setProgress(0); setChecking(false); setPending(true);
    onBusyChangeRef.current(materialId, true);
    try {
      let uploaded: PortalFileDto = await courseMaterialFilesApi.upload(selected, controller.signal, (percent) => {
        if (!controller.signal.aborted) setProgress(percent);
      });
      for (let attempt = 0; uploaded.state === 'checking' || uploaded.state === 'uploading'; attempt++) {
        if (attempt >= 60) throw new Error('courseFileUploadFailed');
        setChecking(true);
        await pause(controller.signal);
        uploaded = await courseMaterialFilesApi.status(uploaded.id, controller.signal);
      }
      if (controller.signal.aborted) return;
      if (uploaded.state !== 'ready') throw new Error(uploaded.rejectionCode ?? 'courseFileUploadFailed');
      onUploadedRef.current({ id: uploaded.id, name: uploaded.name, mime: uploaded.mime, size: uploaded.size });
    } catch (cause) {
      if (!controller.signal.aborted) {
        const code = cause instanceof Error ? cause.message : '';
        setError(t(resolveUploadErrorKey(code)));
        setRetryFile(selected);
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setPending(false); setChecking(false);
        onBusyChangeRef.current(materialId, false);
      }
    }
  };

  const select = (selected: File | undefined) => {
    if (!selected || active.current || disabled) return;
    setError(''); setRetryFile(null);
    if (!selected.size || selected.size > MAX_UPLOAD_BYTES) {
      setError(selected.size ? t('courseFileTooLarge', { size: MAX_UPLOAD_MIB }) : t('courseFileUnsupported'));
      return;
    }
    if (file) setReplacement(selected);
    else void upload(selected);
  };

  const cancel = () => {
    active.current?.abort(); active.current = null;
    setPending(false); setChecking(false);
    onBusyChangeRef.current(materialId, false);
  };

  return (
    <div
      className={cn(
        'space-y-3 rounded-xl border-2 border-dashed p-3.5 transition-all',
        dragging
          ? 'border-primary bg-primary/5 ring-2 ring-primary/15'
          : file
            ? 'border-emerald-500/30 bg-emerald-500/[0.03]'
            : 'border-border/80 bg-muted/20 hover:border-primary/40 hover:bg-muted/35',
      )}
      onDragOver={(event) => { event.preventDefault(); if (!disabled && !pending) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        select(event.dataTransfer.files[0]);
      }}
    >
      <Input
        ref={input}
        type="file"
        className="sr-only"
        aria-label={t('courseUploadMaterialFile')}
        disabled={pending || disabled}
        onChange={(event) => { select(event.target.files?.[0]); event.target.value = ''; }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {file ? (
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <FileCheck2 className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <a
                className="block min-w-0 break-words text-sm font-medium text-primary underline underline-offset-4 hover:text-primary/80"
                href={`/api/academy/course-material-files/${file.id}/download`}
                download={file.name}
              >
                {file.name}
              </a>
            </div>
            <Badge variant="secondary" className="shrink-0 font-mono text-xs">
              {formatFileSize(file.size, t)}
            </Badge>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={file ? 'outline' : 'secondary'}
            size="sm"
            disabled={pending || disabled}
            onClick={() => input.current?.click()}
          >
            <FileUp className="mr-1.5 size-4" aria-hidden="true" />
            {t(file ? 'courseReplaceMaterialFile' : 'courseUploadMaterialFile')}
          </Button>
          {pending ? (
            <Button type="button" variant="ghost" size="sm" onClick={cancel}>
              <X className="mr-1 size-3.5" aria-hidden="true" />
              {t('cancel')}
            </Button>
          ) : null}
          {retryFile && !pending ? (
            <Button type="button" variant="outline" size="sm" onClick={() => { void upload(retryFile); }}>
              <RotateCcw className="mr-1.5 size-3.5" aria-hidden="true" />
              {t('retry')}
            </Button>
          ) : null}
        </div>
      </div>
      {pending ? (
        <div className="space-y-1.5 rounded-lg bg-background/80 p-2.5" role="status">
          <div className="flex items-center justify-between text-xs font-medium">
            <span>{t(checking ? 'portalFileChecking' : 'portalUploading')}</span>
            <span className="font-mono text-muted-foreground">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} aria-label={t('portalUploading')} className="h-1.5" />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={replacement !== null}
        onOpenChange={(open) => { if (!open) setReplacement(null); }}
        title={t('courseReplaceMaterialFile')}
        description={t('courseReplaceMaterialFileConfirm')}
        confirmLabel={t('courseReplaceMaterialFile')}
        onConfirm={() => {
          const selected = replacement;
          setReplacement(null);
          if (selected) void upload(selected);
        }}
      />
    </div>
  );
}
