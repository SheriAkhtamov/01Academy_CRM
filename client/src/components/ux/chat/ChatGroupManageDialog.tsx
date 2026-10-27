import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChatGroupDetailsDto } from '@shared/contracts/chat-groups';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { Camera, MessageCircle } from 'lucide-react';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
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
  const [infoOpen, setInfoOpen] = useState(true);
  const nameInput = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const dirty = name !== group.name || Boolean(photo) || (removed && Boolean(group.avatarUrl));
  const save = useMutation({ mutationFn: () => chatGroupsApi.updateProfile(group.id, { name: name.trim(), photo, removePhoto: removed }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: chatGroupKeys.all }); if (active.current) onClose(); },
    onSettled: () => { submitting.current = false; },
    onError: (failure: Error & { rawMessage?: string }) => { if (!active.current) return; const key = failure.rawMessage as TranslationKey; setError(t(errors.has(key) ? key : 'chatGroupUpdateFailed')); },
  });
  const guard = useUnsavedChangesGuard({ open: true, isDirty: dirty, isPending: save.isPending, onOpenChange: (open) => { if (!open) onClose(); } });
  return <>
    <Dialog open onOpenChange={guard.handleOpenChange}><DialogContent aria-describedby={undefined} className="compact-modal flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0 sm:max-w-lg">
      <DialogHeader className="compact-modal-header"><DialogTitle className="text-base leading-6">{t('chatGroupManage')}</DialogTitle></DialogHeader>
      <form className="flex min-h-0 flex-col" onSubmit={(event) => {
        event.preventDefault();
        if (save.isPending || submitting.current) return;
        if (!name.trim()) { setError(t('chatGroupNameRequired')); setInfoOpen(true); requestAnimationFrame(() => nameInput.current?.focus()); return; }
        setError(''); submitting.current = true; save.mutate();
      }}>
        <div className="compact-modal-body min-h-0 space-y-3 overflow-y-auto overscroll-contain">
          <CompactModalSection title={t('group')} icon={MessageCircle} tone="sky" open={infoOpen} onOpenChange={setInfoOpen} summary={name} disabled={save.isPending}>
            <div className="space-y-1.5"><Label htmlFor="chat-group-profile-name">{t('groupName')}</Label>
              <Input ref={nameInput} id="chat-group-profile-name" value={name} maxLength={80} disabled={save.isPending} onChange={(event) => setName(event.target.value)} /></div>
          </CompactModalSection>
          <CompactModalSection title={t('chatGroupPhoto')} icon={Camera} tone="violet" defaultOpen disabled={save.isPending}>
          <ChatGroupPhotoPicker groupId={group.id} currentPhotoUrl={group.avatarUrl} photo={photo} removed={removed} pending={save.isPending}
            onPhoto={(file) => { setPhoto(file); setRemoved(false); }} onRemove={() => { setPhoto(null); setRemoved(true); }} />
          </CompactModalSection>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter className="compact-modal-footer"><Button type="button" variant="outline" disabled={save.isPending} onClick={() => guard.handleOpenChange(false)}>{t('cancel')}</Button>
          <Button loading={save.isPending} type="submit" disabled={save.isPending || !dirty}>{t(save.isPending ? 'saving' : 'saveChanges')}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
  </>;
}
