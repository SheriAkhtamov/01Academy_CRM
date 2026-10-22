
import * as React from 'react';
import { useForm, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AUTH_SESSION_QUERY_KEY, SAVED_ACCOUNTS_QUERY_KEY, type SanitizedUser } from '@shared/auth';
import { isValidStaffLogin, MAX_STAFF_LOGIN_LENGTH } from '@shared/staff-login';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { formatUserModule } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import {
  DialogFooter,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PhoneInput } from '@/components/ux/FormattedInputs';
import {
  UnsavedChangesDialog,
  useUnsavedChangesGuard,
} from '@/components/ux/UnsavedChangesGuard';
import { MotionSettingsPanel } from '@/components/ux/motion';
import { UserPhotoPicker } from '@/features/employees/UserPhotoPicker';
import { withUserPhoto } from '@/features/employees/user-photo-api';
import { User, Briefcase, Phone, Save, KeyRound, Sparkles } from 'lucide-react';
import { CompactModalSection } from '@/components/ux/CompactModalSection';

const createSettingsSchema = (
  t: (key: TranslationKey) => string,
  currentEmail: string,
) => z.object({
  fullName: z.string().min(1, t('fullNameRequired')),
  email: z.string().trim().min(1, t('loginRequired')).max(MAX_STAFF_LOGIN_LENGTH, t('fieldTooLong')).refine(isValidStaffLogin, t('invalidLogin')),
  position: z.string().max(255, t('fieldTooLong')),
  phone: z.string().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().optional(),
  confirmNewPassword: z.string().optional(),
}).superRefine((values, ctx) => {
  const wantsPasswordChange = Boolean(values.newPassword || values.confirmNewPassword);
  const loginChanged = values.email.trim().toLowerCase() !== currentEmail.trim().toLowerCase();

  if (!wantsPasswordChange && !loginChanged) return;

  if (!values.currentPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['currentPassword'],
      message: t('currentPasswordRequired'),
    });
  }

  if (wantsPasswordChange && !values.newPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['newPassword'],
      message: t('newPasswordRequired'),
    });
  } else if (values.newPassword && values.newPassword.length < 12) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['newPassword'],
      message: t('passwordTooShort'),
    });
  } else if (
    values.newPassword
    && new TextEncoder().encode(values.newPassword).length > 72
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['newPassword'],
      message: t('passwordTooLong'),
    });
  }

  if (wantsPasswordChange && values.newPassword !== values.confirmNewPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['confirmNewPassword'],
      message: t('passwordsDoNotMatch'),
    });
  }
});

type SettingsFormValues = {
  fullName: string;
  email: string;
  position: string;
  phone?: string;
  currentPassword?: string;
  newPassword?: string;
  confirmNewPassword?: string;
};

/** The form as it looks the moment it is seeded from the signed-in account. */
const buildSettingsValues = (user: SanitizedUser | null): SettingsFormValues => ({
  fullName: user?.fullName || '',
  email: user?.email || '',
  position: user?.position || '',
  phone: user?.phone || '',
  currentPassword: '',
  newPassword: '',
  confirmNewPassword: '',
});

const PROFILE_FIELDS = ['fullName', 'email', 'position', 'phone'] as const;

/**
 * Whether the form really differs from the account it was seeded with.
 *
 * react-hook-form's own `isDirty` answers a different question — "has anything
 * written to this form" — and the browser answers it for you: a password
 * manager fills the current-password box the instant the dialog opens, so
 * closing an untouched form asked whether to discard edits nobody had made.
 * Comparing values against the baseline means only a real difference counts.
 *
 * A filled current-password box on its own is deliberately not a change. It
 * does nothing without a new password or a new login beside it, and it is
 * precisely the field autofill reaches for.
 */
export function hasSettingsChanges(
  values: SettingsFormValues,
  baseline: SettingsFormValues,
): boolean {
  const profileChanged = PROFILE_FIELDS.some(
    (field) => (values[field] ?? '').trim() !== (baseline[field] ?? '').trim(),
  );
  const passwordChanged = Boolean(values.newPassword || values.confirmNewPassword);

  return profileChanged || passwordChanged;
}

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { user, setUser } = useAuth();
  const saving = React.useRef(false);
  const [photo, setPhoto] = React.useState<File | null>(null);
  const [contactsOpen, setContactsOpen] = React.useState(false);
  const [securityOpen, setSecurityOpen] = React.useState(false);
  const [animationsOpen, setAnimationsOpen] = React.useState(false);
  const session = React.useRef({ open: false, userId: user?.id, epoch: 0 });
  if (session.current.open !== open || session.current.userId !== user?.id) {
    session.current = { open, userId: user?.id, epoch: session.current.epoch + 1 };
  }
  const { t } = useTranslation();
  React.useEffect(() => { session.current.open = open; return () => { session.current.open = false; }; }, [open]);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const settingsSchema = React.useMemo(
    () => createSettingsSchema(t, user?.email ?? ''),
    [t, user?.email],
  );

  const form = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: buildSettingsValues(user),
    shouldFocusError: false,
  });
  const [baselineValues, setBaselineValues] = React.useState(() => buildSettingsValues(user));
  const seededAccount = React.useRef<{ open: boolean; userId: number | null }>({ open: false, userId: null });
  // Subscribing to the values, not to `formState.isDirty` — see
  // `hasSettingsChanges` for why the flag answers the wrong question here.
  const currentValues = form.watch();


  React.useEffect(() => {
    if (!open) {
      seededAccount.current.open = false;
      return;
    }
    if (!user) return;
    const nextBaseline = buildSettingsValues(user);
    const accountChanged = seededAccount.current.userId !== user.id;
    const newlyOpened = !seededAccount.current.open;
    seededAccount.current = { open: true, userId: user.id };
    if (newlyOpened || accountChanged) {
      form.reset(nextBaseline);
      setBaselineValues(nextBaseline);
      setPhoto(null);
      setContactsOpen(false);
      setSecurityOpen(false);
      setAnimationsOpen(false);
    } else if (!photo
      && !hasSettingsChanges(form.getValues(), baselineValues)
      && hasSettingsChanges(nextBaseline, baselineValues)) {
      form.reset(nextBaseline);
      setBaselineValues(nextBaseline);
    }
  }, [user, open, form, baselineValues, photo]);

  const updateProfileMutation = useMutation({
    mutationFn: async ({ data, accountId, email, photo: submittedPhoto, epoch }: { data: SettingsFormValues; accountId: number | undefined; email: string; photo: File | null; epoch: number }) => {
      if (!accountId) {
        throw new Error(t('authenticationRequired'));
      }

      const {
        currentPassword,
        newPassword,
        confirmNewPassword,
        ...profileData
      } = data;
      const normalizedEmail = profileData.email.trim().toLowerCase();
      const credentialsChanged = normalizedEmail !== email.trim().toLowerCase()
        || Boolean(newPassword || confirmNewPassword);
      const result = await apiRequest('PUT', '/api/auth/me/settings', withUserPhoto({
        fullName: profileData.fullName.trim(),
        email: normalizedEmail,
        position: profileData.position.trim(),
        phone: profileData.phone?.trim() || null,
        ...(credentialsChanged ? { currentPassword, newPassword, confirmNewPassword } : {}),
      }, submittedPhoto));

      return { updatedUser: result.user ?? result, epoch, accountId };
    },
    onSuccess: ({ updatedUser, epoch, accountId }) => {
      if (!session.current.open || session.current.epoch !== epoch || session.current.userId !== accountId) return;
      setPhoto(null);
      setUser(updatedUser);
      queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/users/online-status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/messages/conversations'] });
      queryClient.invalidateQueries({ queryKey: SAVED_ACCOUNTS_QUERY_KEY });
      toast({
        title: t('success'),
        description: t('profileUpdated'),
      });
      onOpenChange(false);
    },
    onSettled: () => { saving.current = false; },
    onError: (error: any, variables) => {
      if (!session.current.open || session.current.epoch !== variables.epoch || session.current.userId !== variables.accountId) return;
      toast({
        title: t('error'),
        description: error.message || t('updateFailed'),
        variant: 'destructive',
      });
    },
  });

  const settingsDialogGuard = useUnsavedChangesGuard({
    open,
    isDirty: hasSettingsChanges(currentValues, baselineValues) || Boolean(photo),
    isPending: updateProfileMutation.isPending || form.formState.isSubmitting,
    onOpenChange: (nextOpen) => { if (!nextOpen) setPhoto(null); onOpenChange(nextOpen); },
  });
  const onSubmit = (data: z.infer<typeof settingsSchema>) => {
    if (!session.current.open || saving.current || updateProfileMutation.isPending) return;
    saving.current = true;
    updateProfileMutation.mutate({ data, accountId: user?.id, email: user?.email ?? '', photo, epoch: session.current.epoch });
  };
  const onInvalid = (errors: FieldErrors<SettingsFormValues>) => {
    const first = Object.keys(errors)[0] as keyof SettingsFormValues | undefined;
    if (!first) return;
    if (first === 'phone' || first === 'position') setContactsOpen(true);
    if (['currentPassword', 'newPassword', 'confirmNewPassword'].includes(first)) setSecurityOpen(true);
    requestAnimationFrame(() => form.setFocus(first));
  };

  return (
    <>
      <Dialog open={open} onOpenChange={settingsDialogGuard.handleOpenChange}>
        <DialogContent className="compact-modal flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col overflow-hidden p-0" aria-describedby={undefined}>
        <DialogHeader className="compact-modal-header">
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {t('accountSettings')}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={event => {
            const epoch = session.current.epoch;
            void form.handleSubmit(
              data => { if (session.current.open && session.current.epoch === epoch) onSubmit(data); },
              errors => { if (session.current.open && session.current.epoch === epoch) onInvalid(errors); },
            )(event);
          }} className="flex min-h-0 flex-1 flex-col" autoComplete="off">
            <div className="compact-modal-body min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
            <CompactModalSection title={t('employeeProfileSection')} icon={User} tone="sky" collapsible={false} disabled={updateProfileMutation.isPending} contentClassName="space-y-3">
            <UserPhotoPicker photo={photo} onChange={setPhoto} currentPhotoUrl={user?.avatarUrl} fullName={currentValues.fullName} disabled={updateProfileMutation.isPending} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Full Name */}
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      {t('fullName')}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Login */}
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <KeyRound className="h-4 w-4" />
                      {t('loginLabel')}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} type="text" autoComplete="username" onChange={event => { field.onChange(event); if (event.target.value.trim().toLowerCase() !== (user?.email ?? '').trim().toLowerCase()) setSecurityOpen(true); }} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">{t('currentModule')}</span>
              <span className="font-medium">{formatUserModule(user?.module || 'sales', t)}</span>
            </div>
            </CompactModalSection>
            <CompactModalSection title={t('employeeContactsSection')} icon={Phone} tone="teal" open={contactsOpen} onOpenChange={setContactsOpen} disabled={updateProfileMutation.isPending} summary={[currentValues.position, currentValues.phone].filter(Boolean).join(' · ')} contentClassName="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Position */}
              <FormField
                control={form.control}
                name="position"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Briefcase className="h-4 w-4" />
                      {t('position')}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Phone */}
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Phone className="h-4 w-4" />
                      {t('phone')}
                    </FormLabel>
                    <FormControl>
                      <PhoneInput
                        ref={field.ref}
                        name={field.name}
                        value={field.value ?? ''}
                        onBlur={field.onBlur}
                        onValueChange={field.onChange}
                        placeholder={t('phonePlaceholder')}
                        aria-label={t('enterPhone')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

            </CompactModalSection>

            <CompactModalSection title={t('portalSecurityNotifications')} icon={KeyRound} tone="violet" open={securityOpen} onOpenChange={setSecurityOpen} disabled={updateProfileMutation.isPending}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="currentPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('currentPassword')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          autoComplete="current-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('newPassword')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          autoComplete="new-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmNewPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('confirmNewPassword')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          autoComplete="new-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CompactModalSection>

            {/* Device-local switches apply immediately, outside the profile save. */}
            <CompactModalSection title={t('interfaceAnimations')} icon={Sparkles} tone="amber" open={animationsOpen} onOpenChange={setAnimationsOpen}>
              <MotionSettingsPanel />
            </CompactModalSection>
            </div>

            <DialogFooter className="compact-modal-footer">
              <Button
                type="button"
                variant="outline"
                onClick={() => settingsDialogGuard.handleOpenChange(false)}
                disabled={updateProfileMutation.isPending}
              >
                {t('cancel')}
              </Button>
              <Button
                type="submit"
                disabled={updateProfileMutation.isPending}
              >
                {updateProfileMutation.isPending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    {t('saving')}
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    {t('saveChanges')}
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
        </DialogContent>
      </Dialog>
      <UnsavedChangesDialog
        open={settingsDialogGuard.confirmationOpen}
        onOpenChange={settingsDialogGuard.setConfirmationOpen}
        onDiscard={settingsDialogGuard.discardChanges}
      />
    </>
  );
}
