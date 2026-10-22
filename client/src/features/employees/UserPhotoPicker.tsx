import { useEffect, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { MAX_USER_PHOTO_BYTES, USER_PHOTO_MIME_TYPES, safeUserPhotoUrl } from '@shared/user-photo';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { getInitials } from '@/lib/auth';
import { useTranslation } from '@/hooks/useTranslation';
import { UserPhotoCropDialog } from './UserPhotoCropDialog';

export function UserPhotoPicker({ photo, onChange, currentPhotoUrl, fullName, disabled = false }: {
  photo: File | null; onChange: (photo: File | null) => void;
  currentPhotoUrl?: string | null; fullName?: string; disabled?: boolean;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<string>();
  const [error, setError] = useState<string>();
  const [cropFile, setCropFile] = useState<File>();
  useEffect(() => {
    if (!photo) { setPreview(undefined); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  return <div className="space-y-2">
    <p className="text-sm font-medium">{t('profilePhoto')}</p>
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      <Avatar className="size-14 shrink-0 border border-border">
        <AvatarImage src={preview ?? safeUserPhotoUrl(currentPhotoUrl)} alt={fullName || t('profilePhoto')} className="object-cover" />
        <AvatarFallback className="bg-primary/10 text-base text-primary">{getInitials(fullName ?? '') || <Camera className="size-5" />}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-2">
        <input ref={input} type="file" accept={USER_PHOTO_MIME_TYPES.join(',')} className="sr-only" tabIndex={-1} disabled={disabled} aria-label={t('profilePhoto')} onChange={(event) => {
          const file = event.target.files?.[0]; event.target.value = '';
          if (!file) return;
          if (file.size > MAX_USER_PHOTO_BYTES) { setError(t('messageFileTooLarge')); return; }
          if (!USER_PHOTO_MIME_TYPES.some((type) => type === file.type) && !(file.type === '' && /\.(jpe?g|png|webp|gif|avif)$/i.test(file.name))) {
            setError(t('profilePhotoTypeUnsupported')); return;
          }
          if (disabled) return;
          setError(undefined); setCropFile(file);
        }} />
        <div className="flex flex-wrap gap-2">
          <Button ref={chooseButton} type="button" variant="outline" size="sm" disabled={disabled} onClick={() => input.current?.click()}><Camera className="size-4" />{photo || currentPhotoUrl ? t('replaceProfilePhoto') : t('chooseProfilePhoto')}</Button>
          {photo ? <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => { setError(undefined); onChange(null); }}><X className="size-4" />{t('cancelPhotoSelection')}</Button> : null}
        </div>
        {photo ? <p className="truncate text-xs text-muted-foreground">{photo.name}</p> : null}
      </div>
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {cropFile ? <UserPhotoCropDialog
      file={cropFile}
      disabled={disabled}
      onApply={(croppedPhoto) => { onChange(croppedPhoto); setCropFile(undefined); }}
      onCancel={() => setCropFile(undefined)}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        if (chooseButton.current?.isConnected && !chooseButton.current.disabled) chooseButton.current.focus();
      }}
    /> : null}
  </div>;
}
