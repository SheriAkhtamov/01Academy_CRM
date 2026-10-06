import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { chatGroupsApi, chatGroupKeys } from '@/features/messages/chat-groups-api';
import type { ChatGroupDto } from '@shared/contracts/chat-groups';
import type { ConversationUserDto } from '@shared/contracts/messages';

export function CreateChatGroupDialog({ open, onOpenChange, onCreated, mode = 'group', onSelectEmployee }: {
  open: boolean; onOpenChange: (open: boolean) => void; onCreated: (group: ChatGroupDto) => void;
  mode?: 'group' | 'direct'; onSelectEmployee?: (id: number) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [error, setError] = useState('');
  const employees = useQuery<Array<ConversationUserDto & { isActive?: boolean; isArchived?: boolean }>>({ queryKey: ['/api/users'], enabled: open });
  const create = useMutation({
    mutationFn: chatGroupsApi.create,
    onSuccess: (group) => {
      client.setQueryData<ChatGroupDto[]>(chatGroupKeys.all, (current = []) => [group, ...current]);
      void client.invalidateQueries({ queryKey: chatGroupKeys.all });
      onCreated(group);
      onOpenChange(false);
      setName(''); setSearch(''); setSelected(new Set()); setError('');
      toast({ title: t('groupCreated') });
    },
    onError: (failure: Error & { rawMessage?: string }) => setError(failure.rawMessage === 'chatGroupCreateFailed' ? t('chatGroupCreateFailed') : failure.message),
  });
  const visible = (employees.data ?? []).filter((employee) => employee.id !== user?.id && employee.isActive !== false
    && !employee.isArchived && employee.fullName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <Dialog open={open} onOpenChange={(next) => { if (!create.isPending) onOpenChange(next); }}>
    <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-lg" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{t(mode === 'group' ? 'createGroup' : 'newDirectChat')}</DialogTitle></DialogHeader>
      <form className="flex min-h-0 flex-col gap-4" onSubmit={(event) => {
        event.preventDefault();
        if (mode !== 'group') return;
        if (!name.trim()) { setError(t('chatGroupNameRequired')); return; }
        if (selected.size === 0) { setError(t('chatGroupParticipantsRequired')); return; }
        setError(''); create.mutate({ name: name.trim(), participantIds: [...selected] });
      }}>
        {mode === 'group' ? <div className="space-y-2"><Label htmlFor="chat-group-name">{t('groupName')}</Label>
          <Input id="chat-group-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus disabled={create.isPending} /></div> : null}
        <div className="space-y-2"><Label htmlFor="chat-group-search">{t('chatGroupParticipants')}</Label>
          <Input id="chat-group-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('searchEmployees')} /></div>
        <div className="min-h-0 max-h-64 space-y-1 overflow-y-auto" aria-label={t('chatGroupParticipants')}>
          {employees.isLoading ? <p className="text-sm text-muted-foreground">{t('loading')}</p> : null}
          {employees.isError ? <div role="alert">{t('failedToLoadData')} <Button type="button" variant="outline" onClick={() => void employees.refetch()}>{t('retry')}</Button></div> : null}
          {visible.map((employee) => mode === 'direct'
            ? <Button key={employee.id} type="button" variant="ghost" className="w-full justify-start" onClick={() => { onSelectEmployee?.(employee.id); onOpenChange(false); }}>{employee.fullName}</Button>
            : <label key={employee.id} className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted">
            <Checkbox aria-label={employee.fullName} checked={selected.has(employee.id)} disabled={create.isPending || (!selected.has(employee.id) && selected.size >= 99)}
              onCheckedChange={(checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(employee.id); else next.delete(employee.id); return next; })} />
            <span className="min-w-0 truncate text-sm">{employee.fullName}</span>
          </label>)}
          {!employees.isLoading && !employees.isError && visible.length === 0 ? <p className="text-sm text-muted-foreground">{t('noSearchResults')}</p> : null}
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={create.isPending} onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          {mode === 'group' ? <Button type="submit" disabled={create.isPending || employees.isLoading || employees.isError}>{t(create.isPending ? 'saving' : 'createGroup')}</Button> : null}</div>
      </form>
    </DialogContent>
  </Dialog>;
}
