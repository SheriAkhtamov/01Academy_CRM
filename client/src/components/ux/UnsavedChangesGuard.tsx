import { useCallback, useEffect, useRef, useState } from 'react';
import { allowNavigation, registerNavigationGuard } from '@/lib/navigationGuard';
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
  const pendingAction = useRef<(() => void) | null>(null);

  const requestAction = useCallback((action: () => void) => {
    if (open && isDirty) {
      pendingAction.current = action;
      setConfirmationOpen(true);
    } else allowNavigation(action);
  }, [open, isDirty]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    // Only a dialog the user is actually looking at can have changes worth
    // keeping; a dirty flag left behind by a previous session must not block it.
    if (!nextOpen && open && isDirty) {
      pendingAction.current = () => onOpenChange(false);
      setConfirmationOpen(true);
      return;
    }

    allowNavigation(() => onOpenChange(nextOpen));
  }, [isDirty, onOpenChange, open]);

  const discardChanges = useCallback(() => {
    setConfirmationOpen(false);
    const action = pendingAction.current;
    pendingAction.current = null;
    allowNavigation(() => action ? action() : onOpenChange(false));
  }, [onOpenChange]);

  // The confirmation must never outlive the dialog it guards.
  useEffect(() => {
    if (!open) setConfirmationOpen(false);
  }, [open]);

  useEffect(() => {
    if (!open || !isDirty) return;
    return registerNavigationGuard(requestAction);
  }, [open, isDirty, requestAction]);

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
    requestAction,
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
