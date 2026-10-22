import { useEffect, useState, type ReactNode } from 'react';
import { GraduationCap, Plus, Star, Trash2 } from 'lucide-react';
import type { StudentProfileStudent, StudentLearningGroup } from '@shared/contracts/student-profile';
import { createStudentStatusDraft, reconcileStudentStatusDraft, studentStatusIsDirty } from '@/lib/studentStatusDraft';
import { useTranslation } from '@/hooks/useTranslation';
import { useCeoCopy } from '@/hooks/useCeoCopy';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ConfirmDialog from '@/components/ConfirmDialog';
import { CompactModalSection } from '@/components/ux/CompactModalSection';

export type StudentGroupOption = { id: number; name: string; status: string };
export type StudentManagementProps = {
  student: StudentProfileStudent | null;
  groups: StudentLearningGroup[];
  open: boolean;
  availableGroups?: StudentGroupOption[];
  onUpdateStatus?: (studentId: number, status: string, exitReason?: string) => Promise<unknown>;
  onAddGroup?: (studentId: number, groupId: number, isPrimary?: boolean) => Promise<unknown>;
  onRemoveGroup?: (studentId: number, groupId: number) => Promise<unknown>;
  onChanged: () => void;
};

export type StudentManagementControls = {
  statusControl: ReactNode;
  groupAdditionControl: ReactNode;
  renderGroupActions: (group: StudentLearningGroup) => ReactNode;
};

export function useStudentManagement({
  student,
  groups,
  open,
  availableGroups = [],
  onUpdateStatus,
  onAddGroup,
  onRemoveGroup,
  onChanged,
}: StudentManagementProps) {
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
    setWorkspace((current) => (open ? reconcileStudentStatusDraft(current, snapshot) : createStudentStatusDraft(snapshot)));
  }, [open, id, status, exitReason]);

  useEffect(() => {
    setSelectedGroupId('');
    setRemoveGroupId(null);
    setConfirmStatus(false);
    setAcceptChanges(false);
  }, [id, open]);

  const dirty = studentStatusIsDirty(workspace);
  const blocked = saving || groupPending;
  const statusLabel = (value: string) =>
    ({
      trial: t('studentStatusTrial'),
      studying: copy.studying,
      paused: copy.paused,
      completed: copy.completed,
      expelled: copy.expelled,
    })[value] ?? value;

  const saveStatus = async () => {
    if (!id || !onUpdateStatus || saving || workspace.incoming) return;
    const saved = { id, status: workspace.status, exitReason: workspace.exitReason };
    setSaving(true);
    try {
      await onUpdateStatus(id, saved.status, saved.exitReason || undefined);
      setWorkspace((current) => ({ ...current, baseline: saved, incoming: null }));
      setConfirmStatus(false);
      onChanged();
    } catch {
      /* The parent mutation displays its error. */
    } finally {
      setSaving(false);
    }
  };

  const mutateGroup = async (action: () => Promise<unknown>) => {
    if (blocked) return;
    setGroupPending(true);
    try {
      await action();
      setSelectedGroupId('');
      setRemoveGroupId(null);
      onChanged();
    } catch {
      /* The parent mutation displays its error. */
    } finally {
      setGroupPending(false);
    }
  };

  const enrolled = new Set(groups.map((group) => group.groupId));
  const available = availableGroups.filter((group) => !enrolled.has(group.id) && ['open', 'in_progress'].includes(group.status));

  const statusControl = onUpdateStatus ? (
    <CompactModalSection
      title={copy.learningStatus}
      summary={statusLabel(workspace.status)}
      icon={GraduationCap}
      tone="violet"
      defaultOpen
      actions={dirty ? (
        <Badge variant="outline" role="status" className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground">
          {t('unsavedChangesTitle')}
        </Badge>
      ) : null}
      contentClassName="space-y-2"
    >
      {workspace.incoming ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-2 text-xs">
          <div className="min-w-0">
            <p className="font-semibold">{t('studentChangesDetected')}</p>
            <p className="text-muted-foreground">
              {t('studentLatestStatus')}: {statusLabel(workspace.incoming.status)}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() =>
                setWorkspace((current) =>
                  current.incoming ? { ...current, baseline: current.incoming, incoming: null } : current,
                )
              }
            >
              {t('studentKeepChanges')}
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setAcceptChanges(true)}>
              {t('studentAcceptChanges')}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 space-y-1 text-[11px] font-medium text-muted-foreground">
          {copy.status}
          <select
            className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            disabled={blocked}
            value={workspace.status}
            onChange={(event) => setWorkspace((current) => ({ ...current, status: event.target.value }))}
          >
            {['trial', 'studying', 'paused', 'completed', 'expelled'].map((value) => (
              <option key={value} value={value}>
                {statusLabel(value)}
              </option>
            ))}
          </select>
        </label>
        {['paused', 'expelled'].includes(workspace.status) ? (
          <label className="min-w-0 flex-1 space-y-1 text-[11px] font-medium text-muted-foreground">
            {copy.churnReason}
            <select
              className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              disabled={blocked}
              value={workspace.exitReason}
              onChange={(event) => setWorkspace((current) => ({ ...current, exitReason: event.target.value }))}
            >
              <option value="">{copy.chooseReason}</option>
              {Object.entries({
                relocation: copy.relocation,
                price: copy.price,
                quality: copy.quality,
                schedule_conflict: copy.scheduleConflict,
                lost_interest: copy.lostInterest,
              }).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Button
          size="sm"
          className="h-8 shrink-0 px-3 text-xs"
          disabled={
            !dirty ||
            blocked ||
            Boolean(workspace.incoming) ||
            (['paused', 'expelled'].includes(workspace.status) && !workspace.exitReason)
          }
          onClick={() => {
            if (workspace.status !== status && ['paused', 'completed', 'expelled'].includes(workspace.status)) {
              setConfirmStatus(true);
            } else {
              void saveStatus();
            }
          }}
        >
          {saving ? copy.saving : copy.saveStatus}
        </Button>
      </div>
    </CompactModalSection>
  ) : null;

  const groupAdditionControl =
    onAddGroup && available.length > 0 ? (
      <div className="flex items-center gap-1.5">
        <select
          aria-label={t('chooseGroup')}
          className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-48 sm:flex-none"
          value={selectedGroupId}
          disabled={blocked}
          onChange={(event) => setSelectedGroupId(event.target.value)}
        >
          <option value="">{t('chooseGroup')}</option>
          {available.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0 px-2.5 text-xs"
          disabled={!selectedGroupId || blocked}
          onClick={() => id && void mutateGroup(() => onAddGroup(id, Number(selectedGroupId)))}
        >
          <Plus className="size-3.5" data-icon="inline-start" />
          {t('addStudentToGroup')}
        </Button>
      </div>
    ) : null;

  const renderGroupActions = (group: StudentLearningGroup): ReactNode => {
    if (!onAddGroup && !onRemoveGroup) return null;
    return (
      <div className="flex flex-wrap items-center gap-1">
        {!group.isPrimary && onAddGroup ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            disabled={blocked}
            onClick={() => id && void mutateGroup(() => onAddGroup(id, group.groupId, true))}
          >
            <Star className="size-3" data-icon="inline-start" />
            {t('makePrimaryGroup')}
          </Button>
        ) : null}
        {onRemoveGroup ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive"
            disabled={blocked || (status === 'studying' && groups.length <= 1)}
            onClick={() => setRemoveGroupId(group.groupId)}
          >
            <Trash2 className="size-3" data-icon="inline-start" />
            {t('removeFromGroup')}
          </Button>
        ) : null}
      </div>
    );
  };

  const confirmations = (
    <>
      <ConfirmDialog
        open={removeGroupId !== null}
        onOpenChange={(next) => {
          if (!next && !blocked) setRemoveGroupId(null);
        }}
        title={t('removeFromGroupTitle')}
        description={t('removeFromGroupConfirm')}
        confirmLabel={blocked ? t('saving') : t('removeFromGroup')}
        variant="destructive"
        keepOpenOnConfirm
        isPending={blocked}
        onConfirm={() => {
          if (id && removeGroupId && onRemoveGroup) void mutateGroup(() => onRemoveGroup(id, removeGroupId));
        }}
      />
      <ConfirmDialog
        open={confirmStatus}
        onOpenChange={(next) => {
          if (!next && !saving) setConfirmStatus(false);
        }}
        title={workspace.status === 'expelled' ? t('expelStudentTitle') : t('studentStatusChangeTitle')}
        description={
          workspace.status === 'expelled'
            ? t('expelStudentConfirm')
            : t('studentStatusChangeDescription').replace('{status}', statusLabel(workspace.status))
        }
        confirmLabel={saving ? t('saving') : copy.saveStatus}
        variant="destructive"
        keepOpenOnConfirm
        confirmDisabled={Boolean(workspace.incoming)}
        isPending={saving}
        onConfirm={() => void saveStatus()}
      />
      <ConfirmDialog
        open={acceptChanges}
        onOpenChange={setAcceptChanges}
        title={t('unsavedChangesTitle')}
        description={t('unsavedChangesDescription')}
        confirmLabel={t('discardChanges')}
        cancelLabel={t('keepEditing')}
        variant="destructive"
        onConfirm={() => {
          setWorkspace((current) => (current.incoming ? createStudentStatusDraft(current.incoming) : current));
          setAcceptChanges(false);
        }}
      />
    </>
  );

  return {
    controls: { statusControl, groupAdditionControl, renderGroupActions },
    confirmations,
    isDirty: dirty || Boolean(selectedGroupId),
    isPending: blocked,
  };
}
