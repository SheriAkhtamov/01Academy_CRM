import { useId, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Loader2 } from 'lucide-react';
import { LEAD_ARCHIVE_REASONS, validateLeadStatusTransition } from '@shared/academy';
import type { ArchiveLeadRequest, RestoreLeadRequest } from '@shared/contracts/academy-leads';
import { leadQueryKeys, leadsApi } from '@/features/leads/api';
import { invalidateSalesLeadData } from '@/features/sales/queries';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ArchiveActionLead {
  id: number;
  contactName: string;
  statusCode: string;
  isArchived?: boolean;
  managerId?: number | null;
}

interface LeadArchiveActionsProps {
  lead: ArchiveActionLead;
  statuses: Array<{ code: string; isActive?: boolean; isPipeline?: boolean }>;
  canClaimUnassignedLead: boolean;
  leadStatusName: (code: string) => string;
  onChanged: () => void;
}

type ArchiveAction =
  | { kind: 'archive'; input: ArchiveLeadRequest }
  | { kind: 'restore'; input: RestoreLeadRequest };

export function LeadArchiveActions({
  lead,
  statuses,
  canClaimUnassignedLead,
  leadStatusName,
  onChanged,
}: LeadArchiveActionsProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fieldId = useId();
  const submitting = useRef(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [restoreStatus, setRestoreStatus] = useState('');
  const [assignmentRequired, setAssignmentRequired] = useState(false);
  const isArchived = Boolean(lead.isArchived);
  const needsManager = !lead.managerId || assignmentRequired;
  const paidArchiveBlocked = !isArchived && lead.statusCode === 'paid';
  const restoreStatuses = statuses.filter((status) => (
    status.isActive !== false
    && status.isPipeline !== false
    && !validateLeadStatusTransition(lead.statusCode, status.code)
  ));

  const mutation = useMutation({
    mutationFn: (action: ArchiveAction) => action.kind === 'restore'
      ? leadsApi.restore<ArchiveActionLead>(lead.id, action.input)
      : leadsApi.archive<ArchiveActionLead>(lead.id, action.input),
    onSuccess: async (updatedLead, action) => {
      setOpen(false);
      // Publish the returned snapshot immediately, including in callers such as
      // Incoming that do not mount the archive list. Never close the lead sheet
      // here: other tabs can still contain unsaved drafts.
      await queryClient.cancelQueries({ queryKey: leadQueryKeys.detail(updatedLead.id) });
      queryClient.setQueryData(leadQueryKeys.detail(updatedLead.id), updatedLead);
      toast({ title: action.kind === 'restore'
        ? t('leadRestored')
        : action.input.assignToSelf ? t('leadAssignedAndArchived') : t('leadArchived') });
      onChanged();
      await Promise.all([
        invalidateSalesLeadData(queryClient, updatedLead.id),
        queryClient.invalidateQueries({ queryKey: leadQueryKeys.unviewedCount }),
      ]);
    },
    onError: (error: Error & { rawMessage?: string }, action) => {
      if (error.rawMessage === 'leadRequiresResponsibleManager') setAssignmentRequired(true);
      toast({
        title: action.kind === 'restore' ? t('leadRestoreFailed') : t('leadArchiveFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
    onSettled: () => { submitting.current = false; },
  });

  const valid = isArchived
    ? restoreStatuses.some((status) => status.code === restoreStatus)
    : !paidArchiveBlocked
      && LEAD_ARCHIVE_REASONS.some((option) => option.code === reason)
      && (reason !== 'other' || Boolean(customReason.trim()))
      && (!needsManager || canClaimUnassignedLead);

  const confirm = () => {
    if (!valid || submitting.current) return;
    submitting.current = true;
    mutation.mutate(isArchived
      ? { kind: 'restore', input: { statusCode: restoreStatus } }
      : { kind: 'archive', input: {
        reason,
        customReason: reason === 'other' ? customReason.trim() : undefined,
        assignToSelf: needsManager || undefined,
      } });
  };

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => {
      if (mutation.isPending) return;
      if (nextOpen) {
        setReason('');
        setCustomReason('');
        setRestoreStatus(restoreStatuses.find((status) => status.code === lead.statusCode)?.code
          ?? restoreStatuses.find((status) => status.code === 'new_request')?.code
          ?? restoreStatuses[0]?.code ?? '');
      }
      setOpen(nextOpen);
    }}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={mutation.isPending || paidArchiveBlocked}
          title={paidArchiveBlocked ? t('paidLeadCannotArchive') : undefined}
        >
          {mutation.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" />
            : isArchived ? <ArchiveRestore data-icon="inline-start" /> : <Archive data-icon="inline-start" />}
          {isArchived ? t('restoreLead') : t('archiveLeadShort')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{isArchived ? t('confirmRestoreLeadTitle') : t('archiveLead')}</AlertDialogTitle>
          <AlertDialogDescription>
            {isArchived
              ? restoreStatus
                ? t('confirmRestoreLeadDescription')
                  .replace('{lead}', lead.contactName)
                  .replace('{stage}', leadStatusName(restoreStatus))
                : t('restoreLeadNoStages')
              : <>{lead.contactName}. {t('archiveLeadDescription')}</>}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isArchived ? (
          <div className="space-y-2">
            <Label htmlFor={`${fieldId}-stage`}>{t('restoreToStage')}</Label>
            <Select value={restoreStatus} onValueChange={setRestoreStatus} disabled={mutation.isPending || !restoreStatuses.length}>
              <SelectTrigger id={`${fieldId}-stage`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {restoreStatuses.map((status) => (
                  <SelectItem key={status.code} value={status.code}>{leadStatusName(status.code)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="space-y-4">
            {needsManager ? (
              <p className="text-sm text-muted-foreground">{t('leadRequiresResponsibleManagerDescription')}</p>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-reason`}>{t('archiveReason')}</Label>
              <Select value={reason} onValueChange={setReason} disabled={mutation.isPending}>
                <SelectTrigger id={`${fieldId}-reason`}>
                  <SelectValue placeholder={t('chooseArchiveReason')} />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_ARCHIVE_REASONS.map((option) => (
                    <SelectItem key={option.code} value={option.code}>{t(option.translationKey)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {reason === 'other' ? (
              <div className="space-y-2">
                <Label htmlFor={`${fieldId}-custom-reason`}>{t('archiveCustomReason')}</Label>
                <Input
                  id={`${fieldId}-custom-reason`}
                  value={customReason}
                  onChange={(event) => setCustomReason(event.target.value)}
                  placeholder={t('archiveCustomReasonPlaceholder')}
                  maxLength={80}
                  disabled={mutation.isPending}
                />
              </div>
            ) : null}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>{t('cancel')}</AlertDialogCancel>
          <Button
            type="button"
            variant={isArchived ? 'default' : 'destructive'}
            disabled={!valid || mutation.isPending}
            onClick={confirm}
          >
            {mutation.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
            {mutation.isPending ? t('saving') : isArchived ? t('restoreLead')
              : needsManager && canClaimUnassignedLead ? t('assignToMeAndArchive') : t('sendToArchive')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
