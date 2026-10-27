import { EmployeeIdentity } from '@/components/ux/EmployeeIdentity';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, UsersRound } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { chatGroupsApi, chatGroupKeys } from '@/features/messages/chat-groups-api';
import type { ChatGroupDto } from '@shared/contracts/chat-groups';
import type { ConversationUserDto } from '@shared/contracts/messages';
import type { TranslationKey } from '@/lib/i18n';
import { OrbitSpinner } from '@/components/ui/orbit-spinner';

const createErrors = new Set<TranslationKey>(['chatGroupNameRequired', 'chatGroupParticipantsRequired', 'chatGroupParticipantsUnavailable', 'chatGroupParticipantsLimit']);

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
  const [infoOpen, setInfoOpen] = useState(true);
  const [participantsOpen, setParticipantsOpen] = useState(true);
  const nameInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const dialogSession = useRef(0);
  const visibleSession = useRef(open);
  const employees = useQuery<Array<ConversationUserDto & { isActive?: boolean; isArchived?: boolean }>>({ queryKey: ['/api/users'], enabled: open });
  const create = useMutation({
    mutationFn: (input: { name: string; participantIds: number[]; session: number }) => chatGroupsApi.create({ name: input.name, participantIds: input.participantIds }),
    onSuccess: (group, input) => {
      client.setQueryData<ChatGroupDto[]>(chatGroupKeys.all, (current = []) => [group, ...current]);
      void client.invalidateQueries({ queryKey: chatGroupKeys.all });
      if (!visibleSession.current || input.session !== dialogSession.current) return;
      onCreated(group);
      onOpenChange(false);
      toast({ title: t('groupCreated') });
    },
    onError: (failure: Error & { rawMessage?: string }, input) => {
      if (!visibleSession.current || input.session !== dialogSession.current) return;
      const key = failure.rawMessage as TranslationKey;
      setError(t(createErrors.has(key) ? key : 'chatGroupCreateFailed'));
    },
    onSettled: () => { submitting.current = false; },
  });
  useEffect(() => {
    dialogSession.current += 1;
    visibleSession.current = open;
    if (open) return;
    setName('');
    setSearch('');
    setSelected(new Set());
    setError('');
    setInfoOpen(true);
    setParticipantsOpen(true);
  }, [open]);
  const guard = useUnsavedChangesGuard({ open, isDirty: Boolean(name || selected.size), isPending: create.isPending, onOpenChange });
  const close = (next: boolean) => { if (!submitting.current) guard.handleOpenChange(next); };
  const available = (employees.data ?? []).filter((employee) => employee.id !== user?.id && employee.isActive !== false && !employee.isArchived);
  const visible = available.filter((employee) => employee.fullName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const selectedIds = available.filter((employee) => selected.has(employee.id)).map((employee) => employee.id);
  const focusInvalid = (section: 'info' | 'participants') => {
    if (section === 'info') setInfoOpen(true); else setParticipantsOpen(true);
    requestAnimationFrame(() => (section === 'info' ? nameInput : searchInput).current?.focus());
  };
  return <>
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="compact-modal flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0 sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader className="compact-modal-header"><DialogTitle className="text-base leading-6">{t(mode === 'group' ? 'createGroup' : 'newDirectChat')}</DialogTitle></DialogHeader>
        <form className="flex min-h-0 flex-col" onSubmit={(event) => {
          event.preventDefault();
          if (mode !== 'group' || create.isPending || submitting.current) return;
          if (!name.trim()) { setError(t('chatGroupNameRequired')); focusInvalid('info'); return; }
          if (selectedIds.length === 0) { setError(t('chatGroupParticipantsRequired')); focusInvalid('participants'); return; }
          setError('');
          submitting.current = true;
          create.mutate({ name: name.trim(), participantIds: selectedIds, session: dialogSession.current });
        }}>
          <div className="compact-modal-body min-h-0 space-y-3 overflow-y-auto overscroll-contain">
            {mode === 'group' ? <CompactModalSection title={t('group')} icon={MessageCircle} tone="sky" open={infoOpen} onOpenChange={setInfoOpen} summary={name} sectionId="chat-group-info" disabled={create.isPending}>
              <div className="space-y-1.5"><Label htmlFor="chat-group-name">{t('groupName')}</Label>
                <Input ref={nameInput} id="chat-group-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus disabled={create.isPending} /></div>
            </CompactModalSection> : null}
            <CompactModalSection title={t(mode === 'group' ? 'chatGroupParticipants' : 'employees')} icon={UsersRound} tone="teal" open={participantsOpen} onOpenChange={setParticipantsOpen} count={mode === 'group' ? selectedIds.length : undefined} collapsible={mode === 'group'} sectionId="chat-participants" disabled={create.isPending}>
              <div className="space-y-2">
                <Label htmlFor="chat-group-search">{t('searchEmployees')}</Label>
                <Input ref={searchInput} id="chat-group-search" value={search} onChange={(event) => setSearch(event.target.value)} disabled={create.isPending} />
                <div className="max-h-64 space-y-1 overflow-y-auto" aria-label={t('chatGroupParticipants')}>
                  {employees.isLoading ? <p className="text-sm text-muted-foreground"><span className="inline-flex items-center gap-2"><OrbitSpinner />{t('loading')}</span></p> : null}
                  {employees.isError ? <div role="alert">{t('failedToLoadData')} <Button type="button" variant="outline" onClick={() => void employees.refetch()}>{t('retry')}</Button></div> : null}
                  {visible.map((employee) => mode === 'direct'
                    ? <Button key={employee.id} type="button" variant="ghost" className="h-auto w-full justify-start py-2" onClick={() => guard.requestAction(() => { onSelectEmployee?.(employee.id); onOpenChange(false); })}><EmployeeIdentity interactive={false} userId={employee.id} name={employee.fullName} avatarUrl={employee.avatarUrl} avatarClassName="size-8" wrapName /></Button>
                    : <label key={employee.id} className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted">
                      <Checkbox aria-label={employee.fullName} checked={selected.has(employee.id)} disabled={create.isPending || (!selected.has(employee.id) && selectedIds.length >= 99)}
                        onCheckedChange={(checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(employee.id); else next.delete(employee.id); return next; })} />
                      <EmployeeIdentity interactive={false} userId={employee.id} name={employee.fullName} avatarUrl={employee.avatarUrl} className="min-w-0 text-sm" avatarClassName="size-8" wrapName />
                    </label>)}
                  {!employees.isLoading && !employees.isError && visible.length === 0 ? <p className="text-sm text-muted-foreground">{t('noSearchResults')}</p> : null}
                </div>
              </div>
            </CompactModalSection>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter className="compact-modal-footer"><Button type="button" variant="outline" disabled={create.isPending} onClick={() => close(false)}>{t('cancel')}</Button>
            {mode === 'group' ? <Button loading={create.isPending || employees.isLoading} type="submit" disabled={create.isPending || employees.isLoading || employees.isError}>{t(create.isPending ? 'saving' : 'createGroup')}</Button> : null}</DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
  </>;
}
