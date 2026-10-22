import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Copy, Eye, EyeOff, KeyRound, Pencil, WandSparkles } from 'lucide-react';
import { platformLoginHref, type LearningModule } from '@shared/platform-routes';
import { academyPortalCredentialChangeSchema, type AcademyPortalAccount, type AcademyPortalCredentialChange, type AcademyPortalCredentialResult } from '@shared/contracts/academy-portal-access';
import { useTranslation } from '@/hooks/useTranslation';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialogBody, AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { AcademyAccessStatus } from './AcademyAccessAccount';
import { academyPortalApi, academyPortalError } from '../academy-api';

type Validation = { field: 'login' | 'password'; message: string };

export function AcademyCredentialsDialog({ leadId, account, initial, module, onClose, onChanged }: {
  leadId: number; account: AcademyPortalAccount; initial?: AcademyPortalCredentialResult; module: LearningModule;
  onClose: () => void; onChanged: () => void;
}) {
  const { t } = useTranslation();
  const active = useRef(true);
  const changing = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [result, setResult] = useState<AcademyPortalCredentialResult | undefined>(initial);
  const [editing, setEditing] = useState(false);
  const [login, setLogin] = useState(account.login);
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [generateLogin, setGenerateLogin] = useState(false);
  const [generatePassword, setGeneratePassword] = useState(false);
  const [confirmation, setConfirmation] = useState<AcademyPortalCredentialChange | null>(null);
  const [notice, setNotice] = useState('');
  const [validation, setValidation] = useState<Validation | null>(null);
  const loginRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);
  const show = useMutation({
    gcTime: 0,
    mutationFn: () => academyPortalApi.show(leadId, account.id, account.version),
    onSuccess: data => { if (!active.current) return; setResult(data); setLogin(data.account.login); onChanged(); },
  });
  const change = useMutation({
    gcTime: 0,
    onSettled: () => { changing.current = false; },
    mutationFn: (command: AcademyPortalCredentialChange) => academyPortalApi.change(leadId, account.id, command),
    onSuccess: data => {
      if (!active.current) return;
      setResult(data);
      setLogin(data.account.login);
      setPassword('');
      setGenerateLogin(false);
      setGeneratePassword(false);
      setConfirmation(null);
      setEditing(false);
      setPasswordVisible(false);
      setNotice(t('academyAccessSaved'));
      onChanged();
    },
  });
  const showCredentials = show.mutate;
  useEffect(() => {
    if (!initial && !started.current) {
      started.current = true;
      showCredentials();
    }
  }, [initial, showCredentials]);
  useEffect(() => {
    if (editing) loginRef.current?.focus();
  }, [editing]);

  const current = result?.account ?? account;
  const dirty = editing && (login !== current.login || Boolean(password) || generateLogin || generatePassword);
  const pending = show.isPending || change.isPending;
  const signInLink = new URL(platformLoginHref(module), window.location.origin).href;
  const guard = useUnsavedChangesGuard({ open: true, isDirty: dirty, isPending: pending, onOpenChange: open => { if (!open) onClose(); } });
  const startEditing = (withGeneratedPassword = false) => {
    setEditing(true);
    setGeneratePassword(withGeneratedPassword);
    setPasswordVisible(false);
    setNotice('');
    setValidation(null);
  };
  const cancelEditing = () => guard.requestAction(() => {
    setEditing(false);
    setLogin(current.login);
    setPassword('');
    setGenerateLogin(false);
    setGeneratePassword(false);
    setPasswordVisible(false);
    setValidation(null);
    change.reset();
  });
  const submit = () => {
    if (!editing || pending || !dirty) return;
    setValidation(null);
    change.reset();
    const parsed = academyPortalCredentialChangeSchema.safeParse({
      version: current.version,
      ...(generateLogin ? {} : login !== current.login ? { login } : {}),
      ...(password && !generatePassword ? { password } : {}),
      generateLogin, generatePassword,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue.path[0] === 'password' ? 'password' : 'login';
      const message = field === 'login' ? t('academyAccessInvalidLogin')
        : t(issue.message === 'portalPasswordTooLong' ? 'portalPasswordTooLong' : 'portalPasswordRules');
      setValidation({ field, message });
      (field === 'password' ? passwordRef : loginRef).current?.focus();
      return;
    }
    setConfirmation(parsed.data);
  };
  const copy = async () => {
    if (!result?.password) return;
    try {
      await navigator.clipboard.writeText(`${signInLink}\n${t('portalIdentifier')}: ${result.account.login}\n${t('portalPassword')}: ${result.password}`);
      if (active.current) setNotice(t('academyAccessCredentialsCopied'));
    } catch { if (active.current) setNotice(t('copyFailed')); }
  };

  return <>
    <Dialog open onOpenChange={guard.handleOpenChange}>
      <DialogContent className="compact-modal flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="compact-modal-header">
          <DialogTitle>{t('lmsAccessAccountStep')}</DialogTitle>
          <DialogDescription>{t(module === 'parent' ? 'parentModule' : 'studentModule')}</DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); submit(); }}>
        <div className="compact-modal-body min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
        <p className="break-words text-sm font-medium">{t('academyAccessAccountTitle').replace('{name}', current.fullName)}</p>
        <CompactModalSection title={t('portalSecurityNotifications')} icon={KeyRound} tone="sky" collapsible={false} contentClassName="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <AcademyAccessStatus status={current.status} />
          {!editing && result && <Button type="button" variant="ghost" size="sm" className="h-auto min-h-10 max-w-full gap-2 whitespace-normal text-left" disabled={pending} onClick={() => startEditing()}>
            <Pencil className="size-4" aria-hidden="true" />{t('academyAccessChangeCredentials')}
          </Button>}
        </div>

          {!editing && <div className="space-y-2">
            <Label htmlFor="academy-credential-link">{t('academyAccessSignInLink')}</Label>
            <Input id="academy-credential-link" readOnly value={signInLink} className="text-sm" />
          </div>}
          <div className="space-y-2">
            <Label htmlFor="academy-credential-login">{t('portalIdentifier')}</Label>
            <Input ref={loginRef} id="academy-credential-login" autoComplete="off" autoCapitalize="none" spellCheck={false}
              value={generateLogin ? '' : login} readOnly={!editing} disabled={pending || generateLogin}
              aria-invalid={validation?.field === 'login'} aria-describedby={validation?.field === 'login' ? 'academy-credential-error' : undefined}
              onChange={event => { setLogin(event.target.value); setValidation(null); }} />
            {editing && <Button type="button" variant={generateLogin ? 'secondary' : 'outline'} className="gap-2" aria-pressed={generateLogin} disabled={pending}
              onClick={() => { setGenerateLogin(value => !value); setValidation(null); }}>
              <WandSparkles className="size-4" aria-hidden="true" />{t('academyAccessGenerateLogin')}
            </Button>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="academy-credential-password">{t(editing ? 'portalNewPassword' : 'portalPassword')}</Label>
            {(editing || result?.password) && <div className="relative">
              <Input ref={passwordRef} id="academy-credential-password" autoComplete="new-password" type={passwordVisible ? 'text' : 'password'} className="pr-11 font-mono"
                readOnly={!editing} disabled={pending || generatePassword} value={editing ? (generatePassword ? '' : password) : result?.password ?? ''}
                aria-invalid={validation?.field === 'password'} aria-describedby={validation?.field === 'password' ? 'academy-credential-error' : undefined}
                onChange={event => { setPassword(event.target.value); setValidation(null); }} />
              <Button type="button" size="icon" variant="ghost" className="absolute right-0 top-0 size-10" disabled={pending || generatePassword}
                aria-label={t(passwordVisible ? 'academyAccessHidePassword' : 'academyAccessShowPassword')} aria-pressed={passwordVisible}
                onClick={() => setPasswordVisible(value => !value)}>
                {passwordVisible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
              </Button>
            </div>}
            {editing ? <Button type="button" variant={generatePassword ? 'secondary' : 'outline'} className="gap-2" aria-pressed={generatePassword} disabled={pending}
              onClick={() => { setGeneratePassword(value => !value); setValidation(null); }}>
              <WandSparkles className="size-4" aria-hidden="true" />{t('academyAccessGeneratePassword')}
            </Button> : result && !result.password && <Button type="button" variant="outline" className="gap-2" onClick={() => startEditing(true)}>
              <WandSparkles className="size-4" aria-hidden="true" />{t('academyAccessGeneratePassword')}
            </Button>}
          </div>
          {show.isPending && <p role="status">{t('loading')}</p>}
          {(validation || show.error) && <div className="space-y-2">
            <p id="academy-credential-error" role="alert" className="text-sm text-destructive">{validation?.message || t(academyPortalError(show.error))}</p>
            {show.error && <Button type="button" variant="outline" disabled={show.isPending} onClick={() => show.mutate()}>{t('retry')}</Button>}
          </div>}
          {notice && <p role="status" className="text-sm">{notice}</p>}
        </CompactModalSection>
        </div>
          <DialogFooter className="compact-modal-footer">
            <Button type="button" variant="outline" disabled={pending} onClick={editing ? cancelEditing : () => guard.handleOpenChange(false)}>{t(editing ? 'cancel' : 'close')}</Button>
            {editing ? <Button type="submit" disabled={pending || !dirty}>{t('save')}</Button> : result?.password && (
              <Button type="button" className="gap-2" onClick={() => void copy()}><Copy className="size-4" aria-hidden="true" />{t('academyAccessCopyCredentials')}</Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <AlertDialog open={Boolean(confirmation)} onOpenChange={open => { if (!open && !change.isPending && !changing.current) setConfirmation(null); }} pending={change.isPending}>
      <AlertDialogContent className="compact-modal flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0">
        <AlertDialogHeader className="compact-modal-header">
          <AlertDialogTitle>{t('academyAccessConfirmChangeTitle')}</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogBody>
          <>
            <AlertDialogDescription className="break-words">{t(confirmation?.password || confirmation?.generatePassword ? 'academyAccessConfirmPasswordChangeBody' : 'academyAccessConfirmChangeBody').replace('{name}', current.fullName)}</AlertDialogDescription>
          {change.error && <p role="alert" className="text-sm text-destructive">{t(academyPortalError(change.error))}</p>}
          </>
        </AlertDialogBody>
        <AlertDialogFooter className="compact-modal-footer">
          <AlertDialogCancel disabled={change.isPending}>{t('cancel')}</AlertDialogCancel>
          <Button type="button" disabled={change.isPending} onClick={() => {
            if (!confirmation || change.isPending || changing.current) return;
            changing.current = true;
            change.mutate(confirmation);
          }}>{t(change.isPending ? 'loading' : 'save')}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
  </>;
}
