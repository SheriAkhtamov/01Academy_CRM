
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AUTH_SESSION_QUERY_KEY, type SanitizedUser } from '@shared/auth';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { formatUserModule } from '@/lib/auth';
import { hasLeadershipAccess } from '@shared/academy';
import { useToast } from '@/hooks/use-toast';
import {
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
import { Switch } from '@/components/ui/switch';
import { MotionSettingsPanel } from '@/components/ux/motion';
import { User, Mail, Briefcase, Phone, Save, KeyRound } from 'lucide-react';

const createSettingsSchema = (
  t: (key: TranslationKey) => string,
  currentEmail: string,
) => z.object({
  fullName: z.string().min(1, t('fullNameRequired')),
  email: z.string().email(t('validEmailRequired')),
  position: z.string().max(255),
  phone: z.string().optional(),
  hasReportAccess: z.boolean().optional(),
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
  hasReportAccess?: boolean;
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
  hasReportAccess: user?.hasReportAccess || false,
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
  const accessChanged = Boolean(values.hasReportAccess) !== Boolean(baseline.hasReportAccess);
  const passwordChanged = Boolean(values.newPassword || values.confirmNewPassword);

  return profileChanged || accessChanged || passwordChanged;
}

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { user, setUser } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const settingsSchema = React.useMemo(
    () => createSettingsSchema(t, user?.email ?? ''),
    [t, user?.email],
  );


  const form = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: buildSettingsValues(user),
  });
  const baselineValues = React.useMemo(() => buildSettingsValues(user), [user]);
  // Subscribing to the values, not to `formState.isDirty` — see
  // `hasSettingsChanges` for why the flag answers the wrong question here.
  const currentValues = form.watch();
  const settingsDialogGuard = useUnsavedChangesGuard({
    open,
    isDirty: hasSettingsChanges(currentValues, baselineValues),
    onOpenChange,
  });

  // Reset form when user data changes or modal opens
  React.useEffect(() => {
    if (user && open) {
      form.reset(buildSettingsValues(user));
    }
  }, [user, open, form]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: z.infer<typeof settingsSchema>) => {
      if (!user?.id) {
        throw new Error(t('authenticationRequired'));
      }

      const {
        currentPassword,
        newPassword,
        confirmNewPassword,
        ...profileData
      } = data;
      const normalizedEmail = profileData.email.trim().toLowerCase();
      const credentialsChanged = normalizedEmail !== user.email.trim().toLowerCase()
        || Boolean(newPassword || confirmNewPassword);
      const result = await apiRequest('PUT', '/api/auth/me/settings', {
        fullName: profileData.fullName.trim(),
        email: normalizedEmail,
        position: profileData.position.trim(),
        phone: profileData.phone?.trim() || null,
        hasReportAccess: profileData.hasReportAccess,
        ...(credentialsChanged ? { currentPassword, newPassword, confirmNewPassword } : {}),
      });

      return result.user ?? result;
    },
    onSuccess: (updatedUser) => {
      setUser(updatedUser);
      queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['/api/users'] });
      toast({
        title: t('success'),
        description: t('profileUpdated'),
      });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: t('error'),
        description: error.message || t('updateFailed'),
        variant: 'destructive',
      });
    },
  });

  const onSubmit = (data: z.infer<typeof settingsSchema>) => {
    updateProfileMutation.mutate(data);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={settingsDialogGuard.handleOpenChange}>
        <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {t('accountSettings')}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          {/*
            The password boxes below keep their own autocomplete hints, which
            take priority; switching the form off only stops the browser from
            volunteering address data into the profile fields.
          */}
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" autoComplete="off">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                      <Input {...field} placeholder={t('enterFullName')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Email */}
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      {t('loginLabel')}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} type="email" placeholder={t('enterEmail')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
                      <Input {...field} placeholder={t('enterPosition')} />
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

            </div>

            <div className="rounded-xl border border-border/70 p-4">
              <div className="mb-4 flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-900">{t('changePassword')}</h3>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
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
                          placeholder={t('currentPassword')}
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
                          placeholder={t('newPassword')}
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
                          placeholder={t('confirmNewPassword')}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <p className="mt-3 text-xs text-slate-500">{t('passwordChangeHint')}</p>
            </div>

            {/* Analytics Access - Only for Admins */}
            {hasLeadershipAccess(user) && (
              <FormField
                control={form.control}
                name="hasReportAccess"
                render={({ field }) => (
                  <FormItem className="flex flex-row flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">{t('reportsAccess')}</FormLabel>
                      <div className="text-sm text-slate-500">
                        {t('allowReportsAccess')}
                      </div>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}

            {/*
              Device-local, so it sits outside the save flow: the switches take
              effect the moment they are flipped and never travel to the server.
            */}
            <MotionSettingsPanel />

            {/* Current module info */}
            <div className="rounded-xl border border-border/70 bg-muted/60 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">{t('currentModule')}</h3>
              <p className="text-slate-700 font-medium">
                {formatUserModule(user?.module || 'sales', t)}
              </p>
            </div>

            {/* Form Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
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
            </div>
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
