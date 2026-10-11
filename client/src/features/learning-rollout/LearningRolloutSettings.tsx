import { PortalDialogContent as DialogContent, PortalAlertDialogContent as AlertDialogContent } from '@/features/learning-content/modal-content';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LearningFlagDto, LearningFlagKey, LearningFlagUpdateInput } from '@shared/contracts/learning-rollout';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog,  DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ModulePage } from '@/components/ux/ModulePage';
import { PageHeader } from '@/components/ux/PageHeader';
import { learningRolloutApi } from './api';
import type { TranslationKey } from '@/lib/i18n';
import { SchoolSettingsCard } from './SchoolSettingsCard';
import { PortalDeliveryFailuresButton } from '@/features/portal-access';
const labels: Record<LearningFlagKey, TranslationKey> = { learning: 'lmsRolloutPortal', invitations: 'lmsRolloutInvitations', public_portfolio: 'lmsRolloutPublicPortfolio', email: 'lmsRolloutEmail' };
const confirmationLabels: Record<LearningFlagKey, [TranslationKey,TranslationKey]> = { learning:['lmsRolloutConfirmEnable','lmsRolloutConfirmDisable'],invitations:['lmsRolloutInvitationsEnableBody','lmsRolloutInvitationsDisableBody'],public_portfolio:['lmsRolloutPublicEnableBody','lmsRolloutPublicDisableBody'],email:['lmsRolloutEmailEnableBody','lmsRolloutEmailDisableBody'] };
export default function LearningRolloutSettings() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['learning-rollout'], queryFn: learningRolloutApi.configuration });
  const [editing, setEditing] = useState<LearningFlagUpdateInput | null>(null);
  const [confirmation, setConfirmation] = useState<LearningFlagUpdateInput | null>(null);
  const mutation = useMutation({ mutationFn: learningRolloutApi.update, onSuccess: (data) => {
    client.setQueryData(['learning-rollout'], data); void client.invalidateQueries({ queryKey: ['learning-capabilities'] });
    setConfirmation(null); setEditing(null);
  } });
  const edit = (flag: LearningFlagDto) => { mutation.reset(); setEditing({ key: flag.key, enabled: flag.enabled, allGroups: flag.allGroups, groupIds: flag.groupIds,version:flag.version }); };
  return <ModulePage><PageHeader title={t('lmsRolloutConfiguration')} />
    <SchoolSettingsCard enabled={query.data?.capabilities.portalEnabled === true}/>
    <PortalDeliveryFailuresButton enabled={query.data?.capabilities.portalEnabled === true} canManageAccess={query.data?.capabilities.portalEnabled === true}/>
    {query.isPending ? <p role="status">{t('loading')}</p> : query.isError ? <div role="alert" className="space-y-3"><p>{t('lmsStaffLoadFailed')}</p><Button onClick={() => void query.refetch()}>{t('retry')}</Button></div> : <div className="grid gap-4 sm:grid-cols-2">{query.data?.flags.map(flag => <section key={flag.key} className="space-y-4 rounded-xl border bg-card p-5"><div className="flex flex-wrap items-start justify-between gap-3"><h2 className="font-semibold">{t(labels[flag.key])}</h2><Badge variant={flag.enabled ? 'default' : 'secondary'}>{t(flag.enabled ? 'lmsRolloutEnabled' : 'lmsRolloutDisabled')}</Badge></div><p className="text-sm text-muted-foreground">{flag.allGroups ? t('lmsRolloutAllGroups') : flag.groupIds.map(id => query.data?.groups.find(group => group.id === id)?.name).filter(Boolean).join(', ') || t('lmsRolloutSelectedGroups')}</p><Button variant="outline" onClick={() => edit(flag)}>{t('lmsRolloutConfiguration')}</Button></section>)}</div>}
    <Dialog open={Boolean(editing)} onOpenChange={open => { if (!open && !mutation.isPending) setEditing(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{editing ? t(labels[editing.key]) : t('lmsRolloutTitle')}</DialogTitle></DialogHeader>{editing ? <div className="space-y-4"><label className="flex items-center gap-3"><Checkbox checked={editing.enabled} onCheckedChange={checked => setEditing({ ...editing, enabled: checked === true })} />{t('lmsRolloutEnable')}</label><label className="flex items-center gap-3"><Checkbox checked={editing.allGroups} onCheckedChange={checked => setEditing({ ...editing, allGroups: checked === true })} />{t('lmsRolloutAllGroups')}</label>{!editing.allGroups ? <fieldset className="space-y-3"><legend className="mb-3 font-medium">{t('lmsRolloutSelectedGroups')}</legend>{query.data?.groups.map(group => <label key={group.id} className="flex items-center gap-3"><Checkbox checked={editing.groupIds.includes(group.id)} onCheckedChange={checked => setEditing({ ...editing, groupIds: checked ? [...editing.groupIds, group.id] : editing.groupIds.filter(id => id !== group.id) })} />{group.name}</label>)}</fieldset> : null}</div> : null}<DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>{t('cancel')}</Button><Button disabled={!editing || (editing.enabled && !editing.allGroups && !editing.groupIds.length)} onClick={() => { mutation.reset(); setConfirmation(editing); }}>{t('lmsRolloutSave')}</Button></DialogFooter></DialogContent></Dialog>
    <AlertDialog open={Boolean(confirmation)} onOpenChange={open => { if (!open && !mutation.isPending) setConfirmation(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('lmsRolloutConfirmTitle')}</AlertDialogTitle><AlertDialogDescription>{confirmation ? `${t(labels[confirmation.key])}. ${t(confirmationLabels[confirmation.key][confirmation.enabled ? 0 : 1])}` : ''}</AlertDialogDescription></AlertDialogHeader>{mutation.isError ? <p role="alert" className="text-sm text-destructive">{t('lmsStaffSaveFailed')}</p> : null}<AlertDialogFooter><AlertDialogCancel disabled={mutation.isPending}>{t('cancel')}</AlertDialogCancel><AlertDialogAction disabled={mutation.isPending} onClick={event => { event.preventDefault(); if (confirmation) mutation.mutate(confirmation); }}>{t(mutation.isPending ? 'loading' : 'lmsRolloutSave')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </ModulePage>;
}
