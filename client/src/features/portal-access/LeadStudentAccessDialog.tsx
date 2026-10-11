import { useCallback, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { StudentPortalAccessTab } from './StudentPortalAccessTab';

export function LeadStudentAccessDialog({ studentId, studentName, initialInvitationKind, staffAccountId, open, onOpenChange, emailEnabled }: {
  studentId: number; studentName: string; initialInvitationKind: 'self' | 'representative'; staffAccountId?: number;
  open: boolean; onOpenChange: (open: boolean) => void; emailEnabled: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({ dirty: false, pending: false });
  const onDraftChange = useCallback((dirty: boolean, pending: boolean) => setDraft(current => current.dirty === dirty && current.pending === pending ? current : { dirty, pending }), []);
  const guard = useUnsavedChangesGuard({ open, onOpenChange, isDirty: draft.dirty, isPending: draft.pending });
  return <>
    <Dialog open={open} onOpenChange={guard.handleOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader><DialogTitle>{t('lmsStaffAccess')}</DialogTitle><DialogDescription>{studentName}</DialogDescription></DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <StudentPortalAccessTab studentId={studentId} studentName={studentName} staffAccountId={staffAccountId}
            canManageAccess enabled={open} emailEnabled={emailEnabled} initialInvitationKind={initialInvitationKind} onDraftChange={onDraftChange} />
        </div>
        <DialogFooter><Button variant="outline" disabled={draft.pending} onClick={() => guard.handleOpenChange(false)}>{t('close')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
  </>;
}
