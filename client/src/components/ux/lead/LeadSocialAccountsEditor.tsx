import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import {
  LEAD_CHANNELS,
  dedupeLeadChannelsForDisplay,
  leadChannelDisplayKey,
  normalizeLeadSocialAccountValue,
  type LeadChannelKind,
  type LeadChannelView,
} from '@shared/lead-channels';
import { leadsApi } from '@/features/leads/api';
import { AssignLeadToSelfDialog } from '@/features/sales/ui/AssignLeadToSelfDialog';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { LeadChannelLinks } from '@/components/ux/LeadChannelLinks';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const SOCIAL_ACCOUNT_LIMIT = 20;

const channelTranslationKeys = {
  instagram: 'socialNetworkInstagram',
  telegram: 'socialNetworkTelegram',
  facebook: 'socialNetworkFacebook',
  whatsapp: 'socialNetworkWhatsApp',
} satisfies Record<LeadChannelKind, TranslationKey>;

const placeholderTranslationKeys = {
  instagram: 'socialAccountInstagramPlaceholder',
  telegram: 'socialAccountTelegramPlaceholder',
  facebook: 'socialAccountFacebookPlaceholder',
  whatsapp: 'socialAccountWhatsAppPlaceholder',
} satisfies Record<LeadChannelKind, TranslationKey>;

interface SocialAccountDraft {
  mode: 'create' | 'edit';
  accountId?: number;
  channel: LeadChannelKind | '';
  value: string;
  initialChannel?: LeadChannelKind;
  initialValue?: string;
}

type PendingClaimAction =
  | { type: 'save'; draft: SocialAccountDraft }
  | { type: 'delete'; account: LeadChannelView };

interface LeadSocialAccountsEditorProps {
  leadId: number;
  leadName?: string | null;
  managerId?: number | null;
  channels?: LeadChannelView[] | null;
  canClaimUnassignedLead?: boolean;
  onChanged: () => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
}

export function LeadSocialAccountsEditor({
  leadId,
  leadName,
  managerId,
  channels,
  canClaimUnassignedLead = false,
  onChanged,
  onDirtyChange,
}: LeadSocialAccountsEditorProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<SocialAccountDraft | null>(null);
  const [platformSelectOpen, setPlatformSelectOpen] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LeadChannelView | null>(null);
  const [pendingClaim, setPendingClaim] = useState<PendingClaimAction | null>(null);

  const accounts = useMemo(() => dedupeLeadChannelsForDisplay(channels)
    .filter((account): account is LeadChannelView & { channel: LeadChannelKind } => (
      LEAD_CHANNELS.includes(account.channel as LeadChannelKind)
    )), [channels]);

  const normalizedDraft = draft?.channel
    ? normalizeLeadSocialAccountValue(draft.channel, draft.value)
    : null;
  const duplicateAccount = normalizedDraft
    ? accounts.some((account) => (
      account.id !== draft?.accountId
      && leadChannelDisplayKey(account) === leadChannelDisplayKey({
        id: -1,
        channel: normalizedDraft.channel,
        handle: normalizedDraft.handle,
        profileUrl: normalizedDraft.profileUrl,
      })
    ))
    : false;
  const manualAccountCount = (channels ?? []).filter((account) => (
    account.isManual && LEAD_CHANNELS.includes(account.channel as LeadChannelKind)
  )).length;
  const draftChanged = Boolean(draft && (
    draft.mode === 'create'
      ? draft.channel || draft.value.trim()
      : draft.channel !== draft.initialChannel || draft.value.trim() !== draft.initialValue
  ));
  const canSave = Boolean(normalizedDraft && !duplicateAccount && draftChanged);

  useEffect(() => {
    onDirtyChange?.(draftChanged);
  }, [draftChanged, onDirtyChange]);

  useEffect(() => {
    setDraft(null);
    setDeleteTarget(null);
    setPendingClaim(null);
    setShowValidation(false);
    onDirtyChange?.(false);
  }, [leadId, onDirtyChange]);

  useEffect(() => {
    if (draft?.channel) inputRef.current?.focus();
  }, [draft?.channel]);

  const finishMutation = async (title: string) => {
    setDraft(null);
    setDeleteTarget(null);
    setPendingClaim(null);
    setShowValidation(false);
    onDirtyChange?.(false);
    await onChanged();
    toast({ title });
  };

  const saveAccount = useMutation({
    mutationFn: ({
      nextDraft,
      assignToSelf,
    }: {
      nextDraft: SocialAccountDraft;
      assignToSelf?: boolean;
    }) => {
      if (!nextDraft.channel) throw new Error(t('leadSocialAccountInvalid'));
      const input = {
        channel: nextDraft.channel,
        value: nextDraft.value.trim(),
        assignToSelf,
      };
      return nextDraft.mode === 'edit' && nextDraft.accountId
        ? leadsApi.updateSocialAccount(leadId, nextDraft.accountId, input)
        : leadsApi.addSocialAccount(leadId, input);
    },
    onSuccess: async (_, variables) => finishMutation(
      variables.nextDraft.mode === 'edit'
        ? t('leadSocialAccountUpdated')
        : t('leadSocialAccountAdded'),
    ),
    onError: (
      error: Error & { rawMessage?: string },
      variables,
    ) => {
      if (canClaimUnassignedLead
        && !variables.assignToSelf
        && error.rawMessage === 'leadAssignmentRequired') {
        setPendingClaim({ type: 'save', draft: variables.nextDraft });
        return;
      }
      toast({
        title: variables.nextDraft.mode === 'edit'
          ? t('leadSocialAccountUpdateFailed')
          : t('leadSocialAccountAddFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const deleteAccount = useMutation({
    mutationFn: ({ account, assignToSelf }: { account: LeadChannelView; assignToSelf?: boolean }) => (
      leadsApi.removeSocialAccount(leadId, account.id, { assignToSelf })
    ),
    onSuccess: async () => finishMutation(t('leadSocialAccountDeleted')),
    onError: (
      error: Error & { rawMessage?: string },
      variables,
    ) => {
      if (canClaimUnassignedLead
        && !variables.assignToSelf
        && error.rawMessage === 'leadAssignmentRequired') {
        setDeleteTarget(null);
        setPendingClaim({ type: 'delete', account: variables.account });
        return;
      }
      toast({
        title: t('leadSocialAccountDeleteFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const requestSave = () => {
    if (!draft || !canSave) {
      setShowValidation(true);
      return;
    }
    if (canClaimUnassignedLead && !managerId) {
      setPendingClaim({ type: 'save', draft });
      return;
    }
    saveAccount.mutate({ nextDraft: draft });
  };

  const requestDelete = (account: LeadChannelView) => {
    if (canClaimUnassignedLead && !managerId) {
      setDeleteTarget(null);
      setPendingClaim({ type: 'delete', account });
      return;
    }
    deleteAccount.mutate({ account });
  };

  const beginCreate = () => {
    setDraft({ mode: 'create', channel: '', value: '' });
    setShowValidation(false);
    setPlatformSelectOpen(true);
  };

  const beginEdit = (account: LeadChannelView & { channel: LeadChannelKind }) => {
    const value = account.profileUrl || account.handle || '';
    setDraft({
      mode: 'edit',
      accountId: account.id,
      channel: account.channel,
      value,
      initialChannel: account.channel,
      initialValue: value,
    });
    setShowValidation(false);
  };

  const validationMessage = duplicateAccount
    ? t('leadSocialAccountDuplicate')
    : showValidation && draft?.value.trim() && !normalizedDraft
      ? t('leadSocialAccountInvalid')
      : null;

  return (
    <div className="space-y-3 md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{t('leadSocialAccounts')}</p>
          <p className="text-xs text-muted-foreground">{t('leadSocialAccountsDescription')}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={Boolean(draft) || manualAccountCount >= SOCIAL_ACCOUNT_LIMIT}
          onClick={beginCreate}
        >
          <Plus data-icon="inline-start" />
          {t('addSocialAccount')}
        </Button>
      </div>

      {accounts.length > 0 ? (
        <div className="space-y-2">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <LeadChannelLinks channels={[account]} leadId={leadId} showLabels />
                {!account.isManual ? (
                  <Badge variant="secondary">{t('socialAccountSystemManaged')}</Badge>
                ) : null}
              </div>
              {account.isManual ? (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('editSocialAccount')}
                    disabled={Boolean(draft)}
                    onClick={() => beginEdit(account)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('deleteSocialAccount')}
                    disabled={deleteAccount.isPending}
                    onClick={() => setDeleteTarget(account)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
          {t('noSocialAccounts')}
        </p>
      )}

      {manualAccountCount >= SOCIAL_ACCOUNT_LIMIT ? (
        <p className="text-xs text-muted-foreground">{t('leadSocialAccountLimitReached')}</p>
      ) : null}

      {draft ? (
        <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
            <div className="space-y-2">
              <Label htmlFor="lead-social-platform">{t('socialNetwork')}</Label>
              <Select
                open={platformSelectOpen}
                onOpenChange={setPlatformSelectOpen}
                value={draft.channel}
                onValueChange={(channel) => {
                  setDraft((current) => current ? {
                    ...current,
                    channel: channel as LeadChannelKind,
                    value: current.channel === channel ? current.value : '',
                  } : current);
                  setShowValidation(false);
                }}
              >
                <SelectTrigger id="lead-social-platform">
                  <SelectValue placeholder={t('selectSocialNetwork')} />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_CHANNELS.map((channel) => (
                    <SelectItem key={channel} value={channel}>
                      {t(channelTranslationKeys[channel])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-social-account-value">{t('socialAccountLinkOrUsername')}</Label>
              <Input
                ref={inputRef}
                id="lead-social-account-value"
                value={draft.value}
                onChange={(event) => {
                  setDraft((current) => current ? { ...current, value: event.target.value } : current);
                  setShowValidation(false);
                }}
                onBlur={() => setShowValidation(true)}
                placeholder={draft.channel
                  ? t(placeholderTranslationKeys[draft.channel])
                  : t('selectSocialNetworkFirst')}
                autoComplete="off"
                maxLength={500}
                aria-invalid={Boolean(validationMessage)}
                disabled={!draft.channel}
              />
            </div>
          </div>
          {validationMessage ? (
            <p className="text-sm font-medium text-destructive">{validationMessage}</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDraft(null)}>
              {t('cancel')}
            </Button>
            <Button type="button" disabled={!canSave || saveAccount.isPending} onClick={requestSave}>
              {saveAccount.isPending ? t('saving') : t('saveSocialAccount')}
            </Button>
          </div>
        </div>
      ) : null}

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => {
        if (!open && !deleteAccount.isPending) setDeleteTarget(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteSocialAccountTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteSocialAccountDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteAccount.isPending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!deleteTarget || deleteAccount.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deleteTarget) requestDelete(deleteTarget);
              }}
            >
              {deleteAccount.isPending ? t('deleting') : t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AssignLeadToSelfDialog
        open={Boolean(pendingClaim)}
        leadName={leadName}
        description={t('leadSocialAccountAssignmentDescription')}
        confirmLabel={t('assignToMeAndContinue')}
        isPending={saveAccount.isPending || deleteAccount.isPending}
        onOpenChange={(open) => {
          if (!open) setPendingClaim(null);
        }}
        onConfirm={() => {
          if (pendingClaim?.type === 'save') {
            saveAccount.mutate({ nextDraft: pendingClaim.draft, assignToSelf: true });
          } else if (pendingClaim?.type === 'delete') {
            deleteAccount.mutate({ account: pendingClaim.account, assignToSelf: true });
          }
        }}
      />
    </div>
  );
}
