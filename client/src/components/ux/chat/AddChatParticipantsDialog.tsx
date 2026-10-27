import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UsersRound } from 'lucide-react';
import { DialogFooter, Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { EmployeeAvatar } from '@/components/ux/EmployeeIdentity';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { useTranslation } from '@/hooks/useTranslation';
import type { ChatGroupParticipantDto } from '@shared/contracts/chat-groups';
import { OrbitSpinner } from '@/components/ui/orbit-spinner';

export function AddChatParticipantsDialog({ participants, pending, error, onClose, onAdd }: {
  participants: ChatGroupParticipantDto[]; pending: boolean; error: string;
  onClose: () => void; onAdd: (ids: number[]) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const submitting = useRef(false);
  useEffect(() => { if (!pending) submitting.current = false; }, [pending]);
  const employees = useQuery<ChatGroupParticipantDto[]>({ queryKey: ['/api/users'] });
  const available = (employees.data ?? []).filter((employee) => employee.isActive !== false && !employee.isArchived
    && !participants.some((member) => member.id === employee.id));
  const visible = available.filter((employee) => employee.fullName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const ids = available.filter((employee) => selected.has(employee.id)).map((employee) => employee.id);
  const guard = useUnsavedChangesGuard({ open: true, isDirty: selected.size > 0, isPending: pending, onOpenChange: (open) => { if (!open) onClose(); } });
  const close = (open: boolean) => { if (!submitting.current) guard.handleOpenChange(open); };

  return <>
    <Dialog open onOpenChange={close}>
      <DialogContent aria-describedby={undefined} className="compact-modal flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="compact-modal-header"><DialogTitle className="text-base leading-6">{t('chatGroupAddParticipants')}</DialogTitle></DialogHeader>
        <div className="compact-modal-body min-h-0 overflow-y-auto overscroll-contain">
          <CompactModalSection title={t('chatGroupParticipants')} icon={UsersRound} tone="teal" count={ids.length} collapsible={false} disabled={pending}>
            <div className="space-y-2">
              <Label htmlFor="chat-add-member-search">{t('searchEmployees')}</Label>
              <Input id="chat-add-member-search" value={search} onChange={(event) => setSearch(event.target.value)} disabled={pending} />
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {employees.isPending ? <p><span className="inline-flex items-center gap-2"><OrbitSpinner />{t('loading')}</span></p> : null}
                {employees.isError ? <div role="alert">{t('failedToLoadData')} <Button variant="outline" onClick={() => void employees.refetch()}>{t('retry')}</Button></div> : null}
                {visible.map((employee) => <label key={employee.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted">
                  <Checkbox aria-label={employee.fullName} checked={selected.has(employee.id)}
                    disabled={pending || (!selected.has(employee.id) && participants.length + ids.length >= 100)}
                    onCheckedChange={(checked) => setSelected((current) => {
                      const next = new Set(current); if (checked) next.add(employee.id); else next.delete(employee.id); return next;
                    })} />
                  <EmployeeAvatar interactive={false} userId={employee.id} name={employee.fullName} avatarUrl={employee.avatarUrl} className="size-8 text-xs" />
                  <span className="min-w-0 break-words text-sm">{employee.fullName}</span>
                </label>)}
                {!employees.isPending && !employees.isError && !visible.length ? <p>{t(search ? 'noSearchResults' : 'chatGroupNoAvailableEmployees')}</p> : null}
              </div>
            </div>
          </CompactModalSection>
          {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter className="compact-modal-footer">
          <Button variant="outline" onClick={() => close(false)} disabled={pending}>{t('cancel')}</Button>
          <Button loading={pending} onClick={() => {
            if (pending || submitting.current || employees.isError || !ids.length) return;
            submitting.current = true;
            onAdd(ids);
          }} disabled={pending || employees.isError || !ids.length}>{t(pending ? 'saving' : 'chatGroupAddParticipants')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
  </>;
}
