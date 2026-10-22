import { useId, useRef, useState } from 'react';
import { FileText, Loader2, Paperclip, RefreshCw, Save, X } from 'lucide-react';
import { STUDENT_CONTRACT_FILE_ACCEPT } from '@shared/contracts/student-contracts';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { useTranslation } from '@/hooks/useTranslation';
import type { StudentContractControls } from './useStudentContract';

type Confirmation = { kind: 'cancel' } | { kind: 'regenerate' } | { kind: 'replaceFile'; file: File };

export function StudentContractFields({
  controls,
  disabled = false,
  compact = false,
}: {
  controls: StudentContractControls;
  disabled?: boolean;
  compact?: boolean;
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

  const actions = (
    <div className="flex items-center gap-1.5">
      {controls.isLoading ? (
        <div role="status" aria-label={t('loading')}>
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        </div>
      ) : null}
      {!contract && !controls.isLoading && !controls.loadError ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs"
          disabled={busy}
          onClick={() => void controls.create()}
        >
          {controls.isPending ? <Loader2 className="size-3.5 animate-spin" data-icon="inline-start" /> : null}
          {t('studentContractCreate')}
        </Button>
      ) : null}
      {contract ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px] text-destructive hover:text-destructive"
          disabled={busy}
          onClick={() => setConfirmation({ kind: 'cancel' })}
        >
          <X className="size-3" data-icon="inline-start" />
          {t('studentContractCancel')}
        </Button>
      ) : null}
    </div>
  );
  const fields = (
    <>
      {controls.loadError ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="alert" className="text-xs text-destructive">
            {controls.loadError}
          </p>
          <Button type="button" variant="outline" size="sm" className="h-7 px-2.5 text-xs" onClick={controls.refetch}>
            {t('retry')}
          </Button>
        </div>
      ) : null}

      {contract ? (
        <div className={`grid grid-cols-1 gap-2.5 sm:grid-cols-12 ${compact ? '' : 'border-t pt-2.5'}`}>
          <div className="space-y-1 sm:col-span-7">
            <Label htmlFor={`${id}-number`} className="text-[11px] text-muted-foreground">
              {t('studentContractNumber')}
            </Label>
            <div className="flex flex-wrap gap-1.5">
              <Input
                id={`${id}-number`}
                className="h-8 min-w-32 flex-1 text-xs"
                value={controls.number}
                maxLength={100}
                disabled={busy}
                onChange={(event) => controls.changeNumber(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void controls.saveNumber();
                  }
                }}
              />
              {controls.numberChanged ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 px-2.5 text-xs"
                  disabled={busy}
                  onClick={() => void controls.saveNumber()}
                >
                  <Save className="size-3.5" data-icon="inline-start" />
                  {t('studentContractSaveNumber')}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-2.5 text-xs"
                disabled={busy}
                onClick={() => setConfirmation({ kind: 'regenerate' })}
              >
                <RefreshCw className="size-3.5" data-icon="inline-start" />
                {t('studentContractRegenerate')}
              </Button>
            </div>
          </div>

          <div className="space-y-1 sm:col-span-5">
            <Label htmlFor={`${id}-file`} className="text-[11px] text-muted-foreground">
              {t('studentContractFile')}
            </Label>
            <input
              ref={fileInput}
              id={`${id}-file`}
              type="file"
              className="sr-only"
              accept={STUDENT_CONTRACT_FILE_ACCEPT}
              disabled={busy}
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file || !controls.validateFile(file)) return;
                if (contract.file) setConfirmation({ kind: 'replaceFile', file });
                else void controls.uploadFile(file);
              }}
            />
            <div className="flex min-h-8 flex-wrap items-center gap-1.5">
              {contract.file ? (
                <a
                  href={contract.file.downloadUrl}
                  download={contract.file.name}
                  className="min-w-0 max-w-36 truncate text-xs font-medium text-primary underline underline-offset-4"
                >
                  {contract.file.name}
                </a>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip className="size-3.5" data-icon="inline-start" />
                {contract.file ? t('studentContractReplaceFile') : t('studentContractAttachFile')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {controls.error && !confirmation ? (
        <p role="alert" className="text-xs text-destructive">
          {controls.error}
        </p>
      ) : null}
    </>
  );

  return (
    <>
      {compact ? (
        <CompactModalSection
          title={t('studentContract')}
          icon={FileText}
          tone="violet"
          collapsible={false}
          actions={actions}
          contentClassName={!contract && !controls.loadError && !controls.error ? 'hidden' : 'space-y-2.5'}
        >
          {fields}
        </CompactModalSection>
      ) : (
        <section
          className="col-span-full space-y-2.5 rounded-lg border bg-muted/15 px-3 py-2.5"
          aria-labelledby={`${id}-title`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id={`${id}-title`} className="flex items-center gap-1.5 text-xs font-semibold">
              <FileText className="size-3.5 text-primary" />
              {t('studentContract')}
            </h3>
            {actions}
          </div>
          {fields}
        </section>
      )}
      <ConfirmDialog
        open={Boolean(confirmation)}
        target={contract?.number}
        onOpenChange={(next) => {
          if (!next) setConfirmation(null);
        }}
        title={
          confirmation?.kind === 'cancel'
            ? t('studentContractCancelTitle')
            : confirmation?.kind === 'regenerate'
              ? t('studentContractRegenerateTitle')
              : t('studentContractReplaceFileTitle')
        }
        description={
          confirmation?.kind === 'cancel'
            ? t('studentContractCancelDescription')
            : confirmation?.kind === 'regenerate'
              ? t('studentContractRegenerateDescription', { number: contract?.number ?? '' })
              : contract?.file?.name ?? ''
        }
        confirmLabel={
          confirmation?.kind === 'cancel'
            ? t('studentContractCancel')
            : confirmation?.kind === 'regenerate'
              ? t('studentContractRegenerate')
              : t('studentContractReplaceFile')
        }
        cancelLabel={t('keepEditing')}
        onConfirm={confirm}
        variant={confirmation?.kind === 'cancel' ? 'destructive' : 'default'}
        isPending={controls.isPending}
        keepOpenOnConfirm
        error={controls.error ?? undefined}
      />
    </>
  );
}
