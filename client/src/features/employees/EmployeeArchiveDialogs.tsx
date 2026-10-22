import ConfirmDialog from '@/components/ConfirmDialog';
import { useTranslation } from '@/hooks/useTranslation';

type EmployeeTarget = {
  id: number;
  fullName: string;
};

export function EmployeeArchiveDialogs({
  archiveTarget,
  restoreTarget,
  onArchiveOpenChange,
  onRestoreOpenChange,
  onArchive,
  onRestore,
  archivePending = false,
  restorePending = false,
}: {
  archiveTarget: EmployeeTarget | null;
  restoreTarget: EmployeeTarget | null;
  onArchiveOpenChange: (open: boolean) => void;
  onRestoreOpenChange: (open: boolean) => void;
  onArchive: (employee: EmployeeTarget) => void;
  onRestore: (employee: EmployeeTarget) => void;
  archivePending?: boolean;
  restorePending?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <>
      <ConfirmDialog
        compact
        isPending={archivePending}
        keepOpenOnConfirm
        open={archiveTarget !== null}
        onOpenChange={onArchiveOpenChange}
        title={t('archiveEmployeeTitle')}
        description={t('archiveEmployeeConfirm').replace('{name}', archiveTarget?.fullName || '')}
        confirmLabel={t('archiveEmployee')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          if (archiveTarget) onArchive(archiveTarget);
        }}
      />
      <ConfirmDialog
        compact
        isPending={restorePending}
        keepOpenOnConfirm
        open={restoreTarget !== null}
        onOpenChange={onRestoreOpenChange}
        title={t('restoreEmployeeTitle')}
        description={t('restoreEmployeeConfirm').replace('{name}', restoreTarget?.fullName || '')}
        confirmLabel={t('restoreEmployee')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          if (restoreTarget) onRestore(restoreTarget);
        }}
      />
    </>
  );
}
