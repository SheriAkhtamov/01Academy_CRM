import { useState } from 'react';
import { CheckCircle2, Loader2, Save, Undo2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function LeadSaveBar({ dirty, pending, onDiscard, saveDisabled = false }: {
  dirty: boolean; pending: boolean; saveDisabled?: boolean; onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:gap-3 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2" role="status">
          {dirty ? <span className="size-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" /> : <CheckCircle2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground sm:text-sm">{dirty ? t('leadWorkspaceDraft') : t('leadWorkspaceSaved')}</p>
            <p className="hidden text-xs text-muted-foreground sm:block">{t('leadWorkspaceSaveShortcut')}</p>
          </div>
        </div>
        {dirty ? (
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setConfirmOpen(true)}>
            <Undo2 data-icon="inline-start" />
            <span className="sr-only sm:not-sr-only">{t('undoChanges')}</span>
          </Button>
        ) : null}
        <Button type="submit" form="lead-details-form" size="sm" disabled={!dirty || pending || saveDisabled} title={t('leadWorkspaceSaveShortcut')}>
          {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Save data-icon="inline-start" />}
          {pending ? t('saving') : t('saveChanges')}
        </Button>
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('leadWorkspaceDiscardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('leadWorkspaceDiscardHint')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('keepEditing')}</AlertDialogCancel>
            <AlertDialogAction onClick={onDiscard}>
              {t('discardChanges')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
