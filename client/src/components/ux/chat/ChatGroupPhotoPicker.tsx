import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { MAX_USER_PHOTO_BYTES, USER_PHOTO_MIME_TYPES } from '@shared/user-photo';
import { safeChatGroupPhotoUrl } from '@shared/chat-group-photo';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useTranslation } from '@/hooks/useTranslation';
import { UserPhotoCropDialog } from '@/features/employees/UserPhotoCropDialog';
import { chatGroupsApi } from '@/features/messages/chat-groups-api';
export function ChatGroupPhotoPicker({ groupId, currentPhotoUrl, photo, removed, pending, onPhoto, onRemove }: {
  groupId: number; currentPhotoUrl?: string | null; photo: File | null; removed: boolean; pending: boolean;
  onPhoto: (file: File) => void; onRemove: () => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const [preview, setPreview] = useState<string>();
  const [crop, setCrop] = useState<File>();
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!photo) { setPreview(undefined); return; }
    const url = URL.createObjectURL(photo); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  const current = removed ? undefined : safeChatGroupPhotoUrl(currentPhotoUrl, groupId);
  const hasPhoto = Boolean(photo || current);
  const disabled = pending || loading;
  const cropCurrent = async () => {
    if (photo) { setCrop(photo); return; }
    if (!current || disabled) return;
    setLoading(true); setError('');
    try { const file = await chatGroupsApi.photoFile(current); if (alive.current) setCrop(file); }
    catch { if (alive.current) setError(t('chatGroupPhotoFailed')); }
    finally { if (alive.current) setLoading(false); }
  };
  return <div className="space-y-3">
    <p className="text-sm font-medium">{t('chatGroupPhoto')}</p>
    <div className="flex flex-wrap items-center gap-4">
      <Avatar className="size-24 shrink-0"><AvatarImage src={preview ?? current} alt={t('chatGroupPhoto')} className="object-cover" />
        <AvatarFallback className="bg-primary/10 text-primary"><Camera className="size-8" /></AvatarFallback></Avatar>
      <div className="flex min-w-0 flex-1 flex-wrap gap-2">
        <Button ref={trigger} type="button" size="sm" variant="outline" disabled={disabled} onClick={() => input.current?.click()}>{t(hasPhoto ? 'chatGroupReplacePhoto' : 'chatGroupChoosePhoto')}</Button>
        {hasPhoto ? <>
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void cropCurrent()}>{t('chatGroupCropPhoto')}</Button>
          <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={disabled} onClick={() => setConfirm(true)}>{t('chatGroupRemovePhoto')}</Button>
        </> : null}
      </div>
    </div>
    <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label={t('chatGroupPhoto')} accept={USER_PHOTO_MIME_TYPES.join(',')} disabled={disabled} onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (!file || disabled) return;
      if (file.size > MAX_USER_PHOTO_BYTES) { setError(t('messageFileTooLarge')); return; }
      if (!USER_PHOTO_MIME_TYPES.some(type => type === file.type) && !(file.type === '' && /\.(jpe?g|png|webp|gif|avif)$/i.test(file.name))) { setError(t('profilePhotoTypeUnsupported')); return; }
      setError(''); setCrop(file);
    }} />
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {crop ? <UserPhotoCropDialog file={crop} titleKey="chatGroupCropPhoto" disabled={pending}
      onApply={(file) => { onPhoto(file); setCrop(undefined); }} onCancel={() => setCrop(undefined)}
      onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }} /> : null}
    <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={t('chatGroupRemovePhoto')} description={t('chatGroupRemovePhotoConfirm')}
      confirmLabel={t('delete')} variant="destructive" onConfirm={() => { setError(''); onRemove(); setConfirm(false); }} />
  </div>;
}
