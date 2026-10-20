import { useId, useRef, useState } from 'react';
import { FileText, Loader2, Paperclip, RefreshCw, Save, X } from 'lucide-react';
import { STUDENT_CONTRACT_FILE_ACCEPT } from '@shared/contracts/student-contracts';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/hooks/useTranslation';
import type { StudentContractControls } from './useStudentContract';

type Confirmation = { kind: 'cancel' } | { kind: 'regenerate' } | { kind: 'replaceFile'; file: File };

export function StudentContractFields({
  controls,
  disabled = false,
}: {
  controls: StudentContractControls;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const busy = disabled || controls.isPending || Boolean(controls.loadError);
  const { contract } = controls;

  const confirm = async () => {
    if (!confirmation) return;
    const success = await (confirmation.kind === 'cancel'
      ? controls.cancel()
      : confirmation.kind === 'regenerate'
        ? controls.regenerate()
        : controls.uploadFile(confirmation.file));
    if (success) setConfirmation(null);
  };

  return (
    <section className="space-y-4 rounded-xl border p-4 md:col-span-2" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`${id}-title`} className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="size-4" />
          {t('studentContract')}
        </h3>
        {!contract && !controls.isLoading && !controls.loadError ? (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void controls.create()}>
            {controls.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
            {t('studentContractCreate')}
          </Button>
        ) : null}
      </div>

      {controls.isLoading ? <div role="status" aria-label={t('loading')}><Loader2 className="size-5 animate-spin" /></div> : null}
      {controls.loadError ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="alert" className="text-sm text-destructive">{controls.loadError}</p>
          <Button type="button" variant="outline" size="sm" onClick={controls.refetch}>{t('retry')}</Button>
        </div>
      ) : null}

      {contract ? (
        <>
          <div className="space-y-2">
            <Label htmlFor={`${id}-number`}>{t('studentContractNumber')}</Label>
            <div className="flex flex-wrap gap-2">
              <Input id={`${id}-number`} className="min-w-40 flex-1" value={controls.number}
                maxLength={100} disabled={busy} onChange={(event) => controls.changeNumber(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void controls.saveNumber();
                  }
                }} />
              {controls.numberChanged ? (
                <Button type="button" variant="outline" disabled={busy} onClick={() => void controls.saveNumber()}>
                  <Save data-icon="inline-start" />
                  {t('studentContractSaveNumber')}
                </Button>
              ) : null}
              <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmation({ kind: 'regenerate' })}>
                <RefreshCw data-icon="inline-start" />
                {t('studentContractRegenerate')}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-file`}>{t('studentContractFile')}</Label>
            <input ref={fileInput} id={`${id}-file`} type="file" className="sr-only"
              accept={STUDENT_CONTRACT_FILE_ACCEPT} disabled={busy} tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file || !controls.validateFile(file)) return;
                if (contract.file) setConfirmation({ kind: 'replaceFile', file });
                else void controls.uploadFile(file);
              }} />
            <div className="flex flex-wrap items-center gap-2">
              {contract.file ? (
                <a href={contract.file.downloadUrl} download={contract.file.name}
                  className="min-w-0 break-all text-sm text-primary underline underline-offset-4">
                  {contract.file.name}
                </a>
              ) : null}
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
                <Paperclip data-icon="inline-start" />
                {contract.file ? t('studentContractReplaceFile') : t('studentContractAttachFile')}
              </Button>
            </div>
          </div>

          <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive"
            disabled={busy} onClick={() => setConfirmation({ kind: 'cancel' })}>
            <X data-icon="inline-start" />
            {t('studentContractCancel')}
          </Button>
        </>
      ) : null}

      {controls.error && !confirmation ? <p role="alert" className="text-sm text-destructive">{controls.error}</p> : null}
      <ConfirmDialog
        open={Boolean(confirmation)}
        onOpenChange={(next) => { if (!next) setConfirmation(null); }}
        title={confirmation?.kind === 'cancel'
          ? t('studentContractCancelTitle')
          : confirmation?.kind === 'regenerate'
            ? t('studentContractRegenerateTitle')
            : t('studentContractReplaceFileTitle')}
        description={confirmation?.kind === 'cancel'
          ? t('studentContractCancelDescription')
          : confirmation?.kind === 'regenerate'
            ? t('studentContractRegenerateDescription', { number: contract?.number ?? '' })
            : contract?.file?.name ?? ''}
        confirmLabel={confirmation?.kind === 'cancel'
          ? t('studentContractCancel')
          : confirmation?.kind === 'regenerate'
            ? t('studentContractRegenerate')
            : t('studentContractReplaceFile')}
        cancelLabel={t('keepEditing')}
        onConfirm={() => void confirm()}
        variant={confirmation?.kind === 'cancel' ? 'destructive' : 'default'}
        isPending={controls.isPending}
        keepOpenOnConfirm
        error={controls.error ?? undefined}
      />
    </section>
  );
}
