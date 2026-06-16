
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AUTH_SESSION_QUERY_KEY } from '@shared/auth';
import { apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { User, Mail, Briefcase, Phone, MapPin, Save } from 'lucide-react';
import { ACADEMY_ROLE_LABELS, ACADEMY_ROLES, type AcademyRole } from '@shared/academy';

const createSettingsSchema = (t: (key: TranslationKey) => string) => z.object({
  fullName: z.string().min(1, t('fullNameRequired')),
  email: z.string().email(t('validEmailRequired')),
  position: z.string().min(1, t('positionRequired')),
  phone: z.string().optional(),
  location: z.string().optional(),
  role: z.enum(ACADEMY_ROLES),
  hasReportAccess: z.boolean().optional(),
});

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { user, setUser } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const settingsSchema = React.useMemo(() => createSettingsSchema(t), [t]);


  const form = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      fullName: user?.fullName || '',
      email: user?.email || '',
      position: user?.position || '',
      phone: user?.phone || '',
      location: '',
      role: (user?.role as AcademyRole) || 'employee',
      hasReportAccess: user?.hasReportAccess || false,
    },
  });

  // Reset form when user data changes or modal opens
  React.useEffect(() => {
    if (user && open) {
      form.reset({
        fullName: user.fullName || '',
        email: user.email || '',
        position: user.position || '',
        phone: user.phone || '',
        location: '',
        role: (user.role as AcademyRole) || 'employee',
        hasReportAccess: user.hasReportAccess || false,
      });
    }
  }, [user, open, form]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: z.infer<typeof settingsSchema>) => {
      return await apiRequest('PUT', `/api/users/${user?.id}`, data);
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

  const getRoleLabel = (role: string) => {
    return ACADEMY_ROLE_LABELS[role as AcademyRole]?.ru ?? role;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {t('accountSettings')}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
                      {t('email')}
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
                      <Input {...field} placeholder={t('enterPhone')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Location */}
              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      {t('location')}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t('enterLocation')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Role */}
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('role')}</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={user?.role !== 'admin'}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ACADEMY_ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {getRoleLabel(role)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                    {user?.role !== 'admin' && (
                      <p className="text-xs text-slate-500 mt-1">
                        {t('roleChangeAdminOnly')}
                      </p>
                    )}
                  </FormItem>
                )}
              />
            </div>

            {/* Analytics Access - Only for Admins */}
            {user?.role === 'admin' && (
              <FormField
                control={form.control}
                name="hasReportAccess"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
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

            {/* Current Role Info */}
            <div className="bg-slate-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-slate-700 mb-2">{t('currentRole')}</h3>
              <p className="text-slate-600">{getRoleLabel(user?.role || 'employee')}</p>
            </div>

            {/* Form Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={updateProfileMutation.isPending}
              >
                {t('cancel')}
              </Button>
              <Button
                type="submit"
                disabled={updateProfileMutation.isPending}
                className="bg-primary-600 hover:bg-primary-700"
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
  );
}
