import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChatGroupDetailsDto } from '@shared/contracts/chat-groups';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { useTranslation } from '@/hooks/useTranslation';
import { chatGroupsApi, chatGroupKeys } from '@/features/messages/chat-groups-api';
import type { TranslationKey } from '@/lib/i18n';
import { ChatGroupPhotoPicker } from './ChatGroupPhotoPicker';
const errors = new Set<TranslationKey>(['resourceNotFound', 'chatGroupManagementDenied', 'messageFileTooLarge', 'profilePhotoTypeUnsupported']);
export function ChatGroupManageDialog({ group, onClose }: { group: ChatGroupDetailsDto; onClose: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [name, setName] = useState(group.name);
  const [photo, setPhoto] = useState<File | null>(null);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState('');
  const dirty = name !== group.name || Boolean(photo) || (removed && Boolean(group.avatarUrl));
  const save = useMutation({ mutationFn: () => chatGroupsApi.updateProfile(group.id, { name: name.trim(), photo, removePhoto: removed }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: chatGroupKeys.all }); onClose(); },
    onError: (failure: Error & { rawMessage?: string }) => { const key = failure.rawMessage as TranslationKey; setError(t(errors.has(key) ? key : 'chatGroupUpdateFailed')); },
  });
  const guard = useUnsavedChangesGuard({ open: true, isDirty: dirty, isPending: save.isPending, onOpenChange: (open) => { if (!open) onClose(); } });
  return <>
    <Dialog open onOpenChange={guard.handleOpenChange}><DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-lg">
      <DialogHeader><DialogTitle>{t('chatGroupManage')}</DialogTitle></DialogHeader>
      <form className="flex min-h-0 flex-col gap-5" onSubmit={(event) => {
        event.preventDefault(); if (!name.trim()) { setError(t('chatGroupNameRequired')); return; } setError(''); save.mutate();
      }}>
        <div className="min-h-0 space-y-5 overflow-y-auto">
          <ChatGroupPhotoPicker groupId={group.id} currentPhotoUrl={group.avatarUrl} photo={photo} removed={removed} pending={save.isPending}
            onPhoto={(file) => { setPhoto(file); setRemoved(false); }} onRemove={() => { setPhoto(null); setRemoved(true); }} />
          <div className="space-y-2"><Label htmlFor="chat-group-profile-name">{t('groupName')}</Label>
            <Input id="chat-group-profile-name" value={name} maxLength={80} disabled={save.isPending} onChange={(event) => setName(event.target.value)} /></div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter><Button type="button" variant="outline" disabled={save.isPending} onClick={() => guard.handleOpenChange(false)}>{t('cancel')}</Button>
          <Button type="submit" disabled={save.isPending || !dirty}>{t(save.isPending ? 'saving' : 'saveChanges')}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
  </>;
}
