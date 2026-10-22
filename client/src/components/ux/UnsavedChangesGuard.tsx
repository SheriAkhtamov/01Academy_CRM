import { useCallback, useEffect, useRef, useState } from 'react';
import { allowNavigation, registerNavigationGuard } from '@/lib/navigationGuard';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useTranslation } from '@/hooks/useTranslation';

interface UseUnsavedChangesGuardOptions {
  open: boolean;
  isDirty: boolean;
  isPending?: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard?: () => void;
}

export function useUnsavedChangesGuard({
  open,
  isDirty,
  isPending = false,
  onOpenChange,
  onDiscard,
}: UseUnsavedChangesGuardOptions) {
  const [confirmationOpen, updateConfirmationOpen] = useState(false);
  const pendingAction = useRef<(() => void) | null>(null);
  const current = useRef({ open, isPending, onDiscard });
  current.current = { open, isPending, onDiscard };

  const setConfirmationOpen = useCallback((nextOpen: boolean) => {
    if (current.current.isPending) return;
    if (!nextOpen) pendingAction.current = null;
    updateConfirmationOpen(nextOpen && current.current.open);
  }, []);

  const requestAction = useCallback((action: () => void) => {
    if (open && isPending) return;
    if (open && isDirty) {
      pendingAction.current = action;
      updateConfirmationOpen(true);
    } else allowNavigation(action);
  }, [open, isDirty, isPending]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen && open && isPending) return;
    // Only a dialog the user is actually looking at can have changes worth
    // keeping; a dirty flag left behind by a previous session must not block it.
    if (!nextOpen && open && isDirty) {
      pendingAction.current = () => onOpenChange(false);
      updateConfirmationOpen(true);
      return;
    }

    allowNavigation(() => onOpenChange(nextOpen));
  }, [isDirty, isPending, onOpenChange, open]);

  const discardChanges = useCallback(() => {
    if (!current.current.open || current.current.isPending || !pendingAction.current) return;
    updateConfirmationOpen(false);
    const action = pendingAction.current;
    pendingAction.current = null;
    current.current.onDiscard?.();
    allowNavigation(action);
  }, []);

  // The confirmation must never outlive the dialog it guards.
  useEffect(() => {
    if (!open) {
      pendingAction.current = null;
      updateConfirmationOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || (!isDirty && !isPending)) return;
    return registerNavigationGuard(requestAction);
  }, [open, isDirty, isPending, requestAction]);

  useEffect(() => {
    if (!open || (!isDirty && !isPending)) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty, isPending, open]);

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
  isPending?: boolean;
}

export function UnsavedChangesDialog({
  open,
  onOpenChange,
  onDiscard,
  isPending = false,
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
      isPending={isPending}
      variant="destructive"
    />
  );
}
