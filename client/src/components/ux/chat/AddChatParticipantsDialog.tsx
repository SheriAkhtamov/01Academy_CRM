import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DialogFooter, Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { EmployeeAvatar } from '@/components/ux/EmployeeIdentity';
import { useTranslation } from '@/hooks/useTranslation';
import type { ChatGroupParticipantDto } from '@shared/contracts/chat-groups';

export function AddChatParticipantsDialog({ participants, pending, error, onClose, onAdd }: {
  participants: ChatGroupParticipantDto[]; pending: boolean; error: string;
  onClose: () => void; onAdd: (ids: number[]) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const employees = useQuery<ChatGroupParticipantDto[]>({ queryKey: ['/api/users'] });
  const available = (employees.data ?? []).filter((employee) => employee.isActive !== false && !employee.isArchived
    && !participants.some((member) => member.id === employee.id));
  const visible = available.filter((employee) => employee.fullName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const ids = available.filter((employee) => selected.has(employee.id)).map((employee) => employee.id);

  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
    <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
      <DialogHeader><DialogTitle>{t('chatGroupAddParticipants')}</DialogTitle></DialogHeader>
      <Label htmlFor="chat-add-member-search">{t('searchEmployees')}</Label>
      <Input id="chat-add-member-search" value={search} onChange={(event) => setSearch(event.target.value)} disabled={pending} />
      <div className="min-h-0 space-y-1 overflow-y-auto">
        {employees.isPending ? <p>{t('loading')}</p> : null}
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
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter className="flex shrink-0 justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={pending}>{t('cancel')}</Button>
        <Button onClick={() => onAdd(ids)} disabled={pending || employees.isError || !ids.length}>{t(pending ? 'saving' : 'chatGroupAddParticipants')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
