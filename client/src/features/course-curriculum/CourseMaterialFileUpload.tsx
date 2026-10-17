import { useEffect, useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MIB } from '@shared/upload-policy';
import type { CourseCurriculumMaterial } from '@shared/contracts/course-curriculum';
import type { PortalFileDto } from '@shared/contracts/portal-resources';
import { useTranslation } from '@/hooks/useTranslation';
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
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [retryFile, setRetryFile] = useState<File | null>(null);
  const [replacement, setReplacement] = useState<File | null>(null);

  useEffect(() => () => {
    active.current?.abort();
    active.current = null;
    onBusyChange(materialId, false);
  }, [materialId, onBusyChange]);

  const upload = async (selected: File) => {
    if (active.current || disabled) return;
    const controller = new AbortController();
    active.current = controller;
    setError(''); setRetryFile(null); setProgress(0); setChecking(false); setPending(true);
    onBusyChange(materialId, true);
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
        setError(code === 'portalFileTooLarge'
          ? t('courseFileSizeExceeded')
          : code === 'portalFileTypeUnsupported' || code === 'portalFileNameInvalid'
            ? t('courseFileUnsupported') : code === 'portalFileQuotaExceeded'
              ? t('courseFileQuotaExceeded') : t('courseFileUploadFailed'));
        setRetryFile(selected);
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        setPending(false); setChecking(false);
        onBusyChange(materialId, false);
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
    onBusyChange(materialId, false);
  };

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-3"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); select(event.dataTransfer.files[0]); }}>
      <Input ref={input} type="file" className="sr-only" aria-label={t('courseUploadMaterialFile')}
        disabled={pending || disabled} onChange={(event) => { select(event.target.files?.[0]); event.target.value = ''; }} />
      {file ? (
        <a className="block min-w-0 break-words text-sm text-primary underline"
          href={`/api/academy/course-material-files/${file.id}/download`} download={file.name}>{file.name}</a>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={pending || disabled} onClick={() => input.current?.click()}>
          <FileUp className="mr-1.5 size-4" aria-hidden="true" />
          {t(file ? 'courseReplaceMaterialFile' : 'courseUploadMaterialFile')}
        </Button>
        {pending ? <Button type="button" variant="ghost" onClick={cancel}>{t('cancel')}</Button> : null}
        {retryFile && !pending ? <Button type="button" variant="outline" onClick={() => { void upload(retryFile); }}>{t('retry')}</Button> : null}
      </div>
      {pending ? <div className="space-y-2" role="status">
        <span className="text-sm">{t(checking ? 'portalFileChecking' : 'portalUploading')}</span>
        <Progress value={progress} aria-label={t('portalUploading')} />
      </div> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <ConfirmDialog open={replacement !== null} onOpenChange={(open) => { if (!open) setReplacement(null); }}
        title={t('courseReplaceMaterialFile')} description={t('courseReplaceMaterialFileConfirm')}
        confirmLabel={t('courseReplaceMaterialFile')} onConfirm={() => {
          const selected = replacement; setReplacement(null); if (selected) void upload(selected);
        }} />
    </div>
  );
}
