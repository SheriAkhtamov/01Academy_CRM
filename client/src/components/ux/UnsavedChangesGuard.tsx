import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useTranslation } from '@/hooks/useTranslation';

interface UseUnsavedChangesGuardOptions {
  open: boolean;
  isDirty: boolean;
  onOpenChange: (open: boolean) => void;
}

export function useUnsavedChangesGuard({
  open,
  isDirty,
  onOpenChange,
}: UseUnsavedChangesGuardOptions) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen && isDirty) {
      setConfirmationOpen(true);
      return;
    }

    onOpenChange(nextOpen);
  }, [isDirty, onOpenChange]);

  const discardChanges = useCallback(() => {
    setConfirmationOpen(false);
    onOpenChange(false);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open || !isDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty, open]);

  return {
    confirmationOpen,
    setConfirmationOpen,
    handleOpenChange,
    discardChanges,
  };
}

interface UnsavedChangesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
}

export function UnsavedChangesDialog({
  open,
  onOpenChange,
  onDiscard,
}: UnsavedChangesDialogProps) {
  const { t } = useTranslation();

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('unsavedChangesTitle')}
      description={t('unsavedChangesDescription')}
      confirmLabel={t('discardChanges')}
      cancelLabel={t('keepEditing')}
      onConfirm={onDiscard}
      variant="destructive"
    />
  );
}
