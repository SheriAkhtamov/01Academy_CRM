import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { platformLoginHref, type LearningModule } from '@shared/platform-routes';
import { academyPortalCredentialChangeSchema, type AcademyPortalAccount, type AcademyPortalCredentialChange, type AcademyPortalCredentialResult } from '@shared/contracts/academy-portal-access';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { academyPortalApi, academyPortalError } from '../academy-api';

export function AcademyCredentialsDialog({ leadId, account, initial, module, onClose, onChanged }: {
  leadId: number; account: AcademyPortalAccount; initial?: AcademyPortalCredentialResult; module: LearningModule;
  onClose: () => void; onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [result, setResult] = useState<AcademyPortalCredentialResult | undefined>(initial);
  const [editing, setEditing] = useState(false);
  const [login, setLogin] = useState(account.login);
  const [password, setPassword] = useState('');
  const [generateLogin, setGenerateLogin] = useState(false);
  const [generatePassword, setGeneratePassword] = useState(false);
  const [confirmation, setConfirmation] = useState<AcademyPortalCredentialChange | null>(null);
  const [notice, setNotice] = useState('');
  const [validation, setValidation] = useState('');
  const started = useRef(false);
  const show = useMutation({ gcTime: 0, mutationFn: () => academyPortalApi.show(leadId, account.id, account.version), onSuccess: data => { setResult(data); setLogin(data.account.login); onChanged(); } });
  const change = useMutation({ gcTime: 0, mutationFn: (command: AcademyPortalCredentialChange) => academyPortalApi.change(leadId, account.id, command), onSuccess: data => {
    setResult(data); setLogin(data.account.login); setPassword(''); setGenerateLogin(false); setGeneratePassword(false); setConfirmation(null); setEditing(false); setNotice(t('academyAccessSaved')); onChanged();
  } });
  useEffect(() => { if (!initial && !started.current) { started.current = true; show.mutate(); } }, [initial, show]);
  const current = result?.account ?? account;
  const dirty = editing && (login !== current.login || Boolean(password) || generateLogin || generatePassword);
  const pending = show.isPending || change.isPending;
  const guard = useUnsavedChangesGuard({ open: true, isDirty: dirty, isPending: pending, onOpenChange: open => { if (!open) onClose(); } });
  const submit = () => {
    setValidation(''); change.reset();
    const parsed = academyPortalCredentialChangeSchema.safeParse({ version: current.version,
      ...(generateLogin ? {} : login !== current.login ? { login } : {}),
      ...(password && !generatePassword ? { password } : {}), generateLogin, generatePassword });
    if (!parsed.success) { setValidation(t(password ? 'portalPasswordRules' : 'portalInvalidData')); return; }
    setConfirmation(parsed.data);
  };
  const copy = async () => {
    if (!result?.password) return;
    try {
      await navigator.clipboard.writeText(`${new URL(platformLoginHref(module), window.location.origin).href}\n${t('portalIdentifier')}: ${result.account.login}\n${t('portalPassword')}: ${result.password}`);
      setNotice(t('academyAccessCredentialsCopied'));
    } catch { setNotice(t('copyFailed')); }
  };
  return <>
    <Dialog open onOpenChange={guard.handleOpenChange}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>{t('academyAccessAccountTitle').replace('{name}', current.fullName)}</DialogTitle><DialogDescription>{current.fullName}</DialogDescription></DialogHeader>
      <form className="space-y-5" onSubmit={event => { event.preventDefault(); submit(); }}>
        <div className="space-y-2"><Label htmlFor="academy-credential-login">{t('portalIdentifier')}</Label><Input id="academy-credential-login" autoComplete="off" value={generateLogin ? '' : login} readOnly={!editing} disabled={pending || generateLogin} onChange={event => setLogin(event.target.value)} />
          {editing && <Button type="button" variant={generateLogin ? 'secondary' : 'outline'} disabled={pending} onClick={() => setGenerateLogin(value => !value)}>{t('academyAccessGenerateLogin')}</Button>}
        </div>
        <div className="space-y-2"><Label htmlFor="academy-credential-password">{t(editing ? 'portalNewPassword' : 'portalPassword')}</Label>
          {(editing || result?.password) && <Input id="academy-credential-password" autoComplete="new-password" type={editing ? 'password' : 'text'} readOnly={!editing} disabled={pending || generatePassword} value={editing ? password : result?.password ?? ''} onChange={event => setPassword(event.target.value)} />}
          {editing ? <Button type="button" variant={generatePassword ? 'secondary' : 'outline'} disabled={pending} onClick={() => setGeneratePassword(value => !value)}>{t('academyAccessGeneratePassword')}</Button> : result && !result.password && <Button type="button" variant="outline" onClick={() => { setEditing(true); setGeneratePassword(true); }}>{t('academyAccessGeneratePassword')}</Button>}
        </div>
        {show.isPending && <p role="status">{t('loading')}</p>}
        {(validation || show.error || change.error) && <p role="alert" className="text-sm text-destructive">{validation || t(academyPortalError(show.error || change.error))}</p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        <DialogFooter className="flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={() => guard.handleOpenChange(false)}>{t('close')}</Button>
          {editing ? <Button type="submit" disabled={pending || !dirty}>{t('save')}</Button> : <>
            {result?.password && <Button type="button" variant="outline" onClick={() => void copy()}>{t('academyAccessCopyCredentials')}</Button>}
            <Button type="button" disabled={pending} onClick={() => { setEditing(true); setNotice(''); }}>{t('academyAccessChangeCredentials')}</Button>
          </>}
        </DialogFooter>
      </form>
    </DialogContent></Dialog>
    <AlertDialog open={Boolean(confirmation)} onOpenChange={open => { if (!open && !change.isPending) setConfirmation(null); }}><AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>{t('academyAccessConfirmChangeTitle')}</AlertDialogTitle><AlertDialogDescription>{t(confirmation?.password || confirmation?.generatePassword ? 'academyAccessConfirmPasswordChangeBody' : 'academyAccessConfirmChangeBody').replace('{name}', current.fullName)}</AlertDialogDescription></AlertDialogHeader>
      {change.error && <p role="alert" className="text-sm text-destructive">{t(academyPortalError(change.error))}</p>}
      <AlertDialogFooter><AlertDialogCancel disabled={change.isPending}>{t('cancel')}</AlertDialogCancel><Button type="button" disabled={change.isPending} onClick={() => { if (confirmation) change.mutate(confirmation); }}>{t(change.isPending ? 'loading' : 'save')}</Button></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
  </>;
}
