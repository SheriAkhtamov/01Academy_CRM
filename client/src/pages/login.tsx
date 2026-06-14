import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { AUTH_SESSION_QUERY_KEY } from '@shared/auth';
import { useTranslation } from '@/hooks/useTranslation';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import Logo from '@/components/Logo';
import { devLog } from '@/lib/debug';
import { useLocation } from 'wouter';

const loginSchema = z.object({
  login: z.string().min(1, 'loginOrEmailRequired'),
  password: z.string().min(1, 'passwordRequired'),
});

export default function Login() {
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, isLoading } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      login: '',
      password: '',
    },
  });

  const onSubmit = async (data: z.infer<typeof loginSchema>) => {
    if (isSubmitting) return;

    setIsSubmitting(true);

    try {
      setError('');
      devLog('[LOGIN] Attempting login for:', data.login);

      await login(data.login, data.password);
      devLog('[LOGIN] Login successful!');
      queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
      setIsSubmitting(false);
      setLocation('/');
    } catch (err: any) {
      if (err?.status === 401) {
        setError(t('invalidCredentialsMessage'));
        setIsSubmitting(false);
        return;
      }

      devLog('Login error:', err);
      const errorMessage =
        err?.rawMessage && (err.rawMessage === 'invalidCredentialsMessage' || err.rawMessage === 'loginOrEmailRequired' || err.rawMessage === 'passwordRequired')
          ? t(err.rawMessage)
          : (err.message || t('loginFailedMessage'));
      setError(errorMessage);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="absolute top-4 right-4 z-10">
        <LanguageSwitcher />
      </div>

      <div className="login-card">
        <div className="login-card__header">
          <div className="flex justify-center mb-5">
            <Logo size="lg" />
          </div>
          <div className="login-card__title">{t('platformName')}</div>
          <div className="login-card__subtitle">{t('signInToContinue')}</div>
        </div>

        {error && (
          <div className="login-card__error mb-5">
            <p className="text-sm">{error}</p>
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              control={form.control}
              name="login"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('loginOrEmailLabel')}</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      placeholder={t('loginOrEmailPlaceholder')}
                      {...field}
                      onChange={(event) => {
                        setError('');
                        field.onChange(event);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('password')}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={t('password')}
                      {...field}
                      onChange={(event) => {
                        setError('');
                        field.onChange(event);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              className="login-card__btn"
              disabled={isLoading || isSubmitting}
            >
              {(isLoading || isSubmitting) ? t('loading') : t('signIn')}
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
