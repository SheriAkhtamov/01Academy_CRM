import { useCallback, useEffect, useId, useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import type { StudentContract, StudentContractFile } from '@shared/contracts/student-contracts';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { studentContractsApi } from './api';
import { StudentContractDocxPreview } from './StudentContractDocxPreview';

const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const previewMimes = new Set(['application/pdf', 'image/png', 'image/jpeg', docxMime]);

function ContractFileContent({ contractId, file }: { contractId: string; file: StudentContractFile }) {
  const { t } = useTranslation();
  const [content, setContent] = useState<{ blob: Blob; url?: string }>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const fail = useCallback(() => setFailed(true), []);

  useEffect(() => {
    if (!previewMimes.has(file.mime)) {
      setFailed(true);
      return;
    }
    const controller = new AbortController();
    let url: string | undefined;
    setContent(undefined);
    setFailed(false);
    void studentContractsApi.fileBlob(contractId, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      // The download stays an attachment. Only allowlisted formats become
      // temporary inline URLs, and DOCX is rendered in an isolated frame.
      if (file.mime !== docxMime) url = URL.createObjectURL(blob.slice(0, blob.size, file.mime));
      setContent({ blob, url });
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [contractId, file.mime, attempt]);

  if (failed) return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
      <p role="alert" className="text-sm text-destructive">{t('studentContractPreviewFailed')}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>{t('retry')}</Button>
    </div>
  );
  if (!content) return (
    <div role="status" aria-label={t('loading')} className="flex min-h-32 items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
    </div>
  );
  if (file.mime === docxMime) return (
    <StudentContractDocxPreview blob={content.blob} name={file.name} onError={fail} />
  );
  if (file.mime === 'application/pdf') return (
    <iframe title={file.name} src={content.url} className="h-[60dvh] min-h-80 w-full rounded-lg border bg-white"
      onError={fail} />
  );
  return (
    <div className="overflow-auto rounded-lg border bg-muted/15 p-2">
      <img src={content.url} alt={file.name} className="mx-auto max-h-[65dvh] max-w-full object-contain"
        onError={fail} />
    </div>
  );
}

export function StudentContractPreview({ contract, file }: { contract: StudentContract; file: StudentContractFile }) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 space-y-2">
      <Button type="button" variant="outline" size="sm" aria-expanded={open} aria-controls={id}
        onClick={() => setOpen(value => !value)}>
        {open ? <EyeOff className="size-4" data-icon="inline-start" /> : <Eye className="size-4" data-icon="inline-start" />}
        {open ? t('studentContractHidePreview') : t('studentContractPreview')}
      </Button>
      {open ? (
        <div id={id} role="region" aria-label={t('studentContractPreviewTitle')}>
          <ContractFileContent key={`${contract.id}:${contract.version}`} contractId={contract.id} file={file} />
        </div>
      ) : null}
    </div>
  );
}
