import { useEffect, useState } from 'react';
import type { StudentProfileStudent, StudentLearningGroup } from '@shared/contracts/student-profile';
import { createStudentStatusDraft, reconcileStudentStatusDraft, studentStatusIsDirty } from '@/lib/studentStatusDraft';
import { useTranslation } from '@/hooks/useTranslation';
import { useCeoCopy } from '@/hooks/useCeoCopy';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle } from '@/components/ui/alert';
import ConfirmDialog from '@/components/ConfirmDialog';

export type StudentGroupOption = { id: number; name: string; status: string };
export type StudentManagementProps = {
  student: StudentProfileStudent | null; groups: StudentLearningGroup[]; open: boolean;
  availableGroups?: StudentGroupOption[];
  onUpdateStatus?: (studentId: number, status: string, exitReason?: string) => Promise<unknown>;
  onAddGroup?: (studentId: number, groupId: number, isPrimary?: boolean) => Promise<unknown>;
  onRemoveGroup?: (studentId: number, groupId: number) => Promise<unknown>;
  onChanged: () => void;
};
export function useStudentManagement({ student, groups, open, availableGroups = [], onUpdateStatus, onAddGroup, onRemoveGroup, onChanged }: StudentManagementProps) {
  const { t } = useTranslation();
  const copy = useCeoCopy().student;
  const id = student?.id ?? null;
  const status = student?.status ?? 'studying';
  const exitReason = student?.exitReason ?? '';
  const [workspace, setWorkspace] = useState(() => createStudentStatusDraft({ id, status, exitReason }));
  const [saving, setSaving] = useState(false);
  const [groupPending, setGroupPending] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [removeGroupId, setRemoveGroupId] = useState<number | null>(null);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [acceptChanges, setAcceptChanges] = useState(false);
  useEffect(() => {
    const snapshot = { id, status, exitReason };
    setWorkspace((current) => open ? reconcileStudentStatusDraft(current, snapshot) : createStudentStatusDraft(snapshot));
  }, [open, id, status, exitReason]);
  useEffect(() => {
    setSelectedGroupId(''); setRemoveGroupId(null); setConfirmStatus(false); setAcceptChanges(false);
  }, [id, open]);
  const dirty = studentStatusIsDirty(workspace);
  const blocked = saving || groupPending;
  const statusLabel = (value: string) => ({ trial: t('studentStatusTrial'), studying: copy.studying, paused: copy.paused, completed: copy.completed, expelled: copy.expelled })[value] ?? value;
  const saveStatus = async () => {
    if (!id || !onUpdateStatus || saving || workspace.incoming) return;
    const saved = { id, status: workspace.status, exitReason: workspace.exitReason };
    setSaving(true);
    try {
      await onUpdateStatus(id, saved.status, saved.exitReason || undefined);
      setWorkspace((current) => ({ ...current, baseline: saved, incoming: null }));
      setConfirmStatus(false); onChanged();
    } catch { /* The parent mutation displays its error. */ } finally { setSaving(false); }
  };
  const mutateGroup = async (action: () => Promise<unknown>) => {
    if (blocked) return;
    setGroupPending(true);
    try { await action(); setSelectedGroupId(''); setRemoveGroupId(null); onChanged(); }
    catch { /* The parent mutation displays its error. */ } finally { setGroupPending(false); }
  };
  const enrolled = new Set(groups.map((group) => group.groupId));
  const available = availableGroups.filter((group) => !enrolled.has(group.id) && ['open', 'in_progress'].includes(group.status));
  const controls = <div className="space-y-4">
    {onUpdateStatus ? <section className="space-y-3 rounded-xl border p-4">
      <h3 className="text-sm font-semibold">{copy.learningStatus}</h3>
      {workspace.incoming ? <Alert><AlertTitle>{t('studentChangesDetected')}</AlertTitle><p className="mt-2 text-sm">{t('studentLatestStatus')}: {statusLabel(workspace.incoming.status)}</p><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setWorkspace((current) => current.incoming ? { ...current, baseline: current.incoming, incoming: null } : current)}>{t('studentKeepChanges')}</Button><Button size="sm" variant="outline" onClick={() => setAcceptChanges(true)}>{t('studentAcceptChanges')}</Button></div></Alert> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 space-y-1 text-xs text-muted-foreground">{copy.status}<select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" disabled={blocked} value={workspace.status} onChange={(event) => setWorkspace((current) => ({ ...current, status: event.target.value }))}>{['trial', 'studying', 'paused', 'completed', 'expelled'].map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
        {['paused', 'expelled'].includes(workspace.status) ? <label className="min-w-0 flex-1 space-y-1 text-xs text-muted-foreground">{copy.churnReason}<select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" disabled={blocked} value={workspace.exitReason} onChange={(event) => setWorkspace((current) => ({ ...current, exitReason: event.target.value }))}><option value="">{copy.chooseReason}</option>{Object.entries({ relocation: copy.relocation, price: copy.price, quality: copy.quality, schedule_conflict: copy.scheduleConflict, lost_interest: copy.lostInterest }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : null}
        <Button size="sm" className="h-10" disabled={!dirty || blocked || Boolean(workspace.incoming) || (['paused', 'expelled'].includes(workspace.status) && !workspace.exitReason)} onClick={() => {
          if (workspace.status !== status && ['paused', 'completed', 'expelled'].includes(workspace.status)) setConfirmStatus(true);
          else void saveStatus();
        }}>{saving ? copy.saving : copy.saveStatus}</Button>
      </div>
      {dirty ? <p role="status" className="text-xs text-muted-foreground">{t('unsavedChangesTitle')}</p> : null}
    </section> : null}
    {onAddGroup || onRemoveGroup ? <section className="space-y-3 rounded-xl border p-4">
      <h3 className="text-sm font-semibold">{t('studentGroups')}</h3>
      {onAddGroup && available.length > 0 ? <div className="flex flex-col gap-2 sm:flex-row"><select aria-label={t('chooseGroup')} className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm" value={selectedGroupId} disabled={blocked} onChange={(event) => setSelectedGroupId(event.target.value)}><option value="">{t('chooseGroup')}</option>{available.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><Button variant="outline" className="h-10" disabled={!selectedGroupId || blocked} onClick={() => id && void mutateGroup(() => onAddGroup(id, Number(selectedGroupId)))}>{t('addStudentToGroup')}</Button></div> : null}
      {groups.map((group) => <div key={group.groupId} className="flex flex-wrap items-center gap-2 border-t pt-3"><p className="min-w-0 flex-1 break-words text-sm">{group.groupName}</p>{group.isPrimary ? <Badge variant="secondary">{t('primaryGroup')}</Badge> : onAddGroup ? <Button size="sm" variant="ghost" disabled={blocked} onClick={() => id && void mutateGroup(() => onAddGroup(id, group.groupId, true))}>{t('makePrimaryGroup')}</Button> : null}{onRemoveGroup ? <Button size="sm" variant="ghost" disabled={blocked || (status === 'studying' && groups.length <= 1)} onClick={() => setRemoveGroupId(group.groupId)}>{t('removeFromGroup')}</Button> : null}</div>)}
    </section> : null}
  </div>;
  const confirmations = <>
    <ConfirmDialog open={removeGroupId !== null} onOpenChange={(next) => { if (!next && !blocked) setRemoveGroupId(null); }} title={t('removeFromGroupTitle')} description={t('removeFromGroupConfirm')} confirmLabel={blocked ? t('saving') : t('removeFromGroup')} variant="destructive" keepOpenOnConfirm isPending={blocked} onConfirm={() => { if (id && removeGroupId && onRemoveGroup) void mutateGroup(() => onRemoveGroup(id, removeGroupId)); }} />
    <ConfirmDialog open={confirmStatus} onOpenChange={(next) => { if (!next && !saving) setConfirmStatus(false); }} title={workspace.status === 'expelled' ? t('expelStudentTitle') : t('studentStatusChangeTitle')} description={workspace.status === 'expelled' ? t('expelStudentConfirm') : t('studentStatusChangeDescription').replace('{status}', statusLabel(workspace.status))} confirmLabel={saving ? t('saving') : copy.saveStatus} variant="destructive" keepOpenOnConfirm confirmDisabled={Boolean(workspace.incoming)} isPending={saving} onConfirm={() => void saveStatus()} />
    <ConfirmDialog open={acceptChanges} onOpenChange={setAcceptChanges} title={t('unsavedChangesTitle')} description={t('unsavedChangesDescription')} confirmLabel={t('discardChanges')} cancelLabel={t('keepEditing')} variant="destructive" onConfirm={() => { setWorkspace((current) => current.incoming ? createStudentStatusDraft(current.incoming) : current); setAcceptChanges(false); }} />
  </>;
  return { controls, confirmations, isDirty: dirty || Boolean(selectedGroupId), isPending: blocked };
}
