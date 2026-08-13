import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
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
import { DURATION, EASE, SPRING, TRANSITION } from '@/lib/motion';
import { StaggerGroup, StaggerItem } from '@/components/ux/motion';

export default function Login() {
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, isLoading } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const loginSchema = z.object({
    login: z.string().min(1, t('loginOrEmailRequired')),
    password: z.string().min(1, t('passwordRequired')),
  });

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

      {/*
        The card lifts into place while the header, each field and the submit
        button follow one at a time. It is the first thing anyone sees each
        morning and the only screen with room for a proper entrance, so the
        whole cascade is allowed to run a little longer than the in-app 400ms
        ceiling — it still finishes before the login field can be focused.
      */}
      <motion.div
        className="login-card"
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: DURATION.slowest, ease: EASE.out }}
      >
        <StaggerGroup delay={0.12} count={4}>
          <StaggerItem className="login-card__header">
            <motion.div
              className="flex justify-center mb-5"
              initial={{ opacity: 0, scale: 0.6, rotate: -8 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              transition={{ ...SPRING.bouncy, delay: 0.18 }}
            >
              <Logo size="lg" />
            </motion.div>
            <div className="login-card__title">{t('platformName')}</div>
            <div className="login-card__subtitle">{t('signInToContinue')}</div>
          </StaggerItem>

          {/*
            An error that swaps text in place is easy to miss when the user is
            retyping. Animating height as well as opacity makes the form
            physically make room for it, which is much harder to overlook.
          */}
          <AnimatePresence initial={false}>
            {error && (
              <motion.div
                className="overflow-hidden"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={TRANSITION.base}
              >
                <div className="login-card__error mb-5">
                  <p className="text-sm">{error}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <StaggerItem>
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
              </StaggerItem>

              <StaggerItem>
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
              </StaggerItem>

              <StaggerItem>
                <Button
                  type="submit"
                  className="login-card__btn"
                  disabled={isLoading || isSubmitting}
                >
                  {/* Swapping the label for a spinner in place keeps the button
                      from resizing mid-submit, which would shift the card. */}
                  {(isLoading || isSubmitting) ? (
                    <>
                      <Loader2 className="animate-spin" />
                      {t('loading')}
                    </>
                  ) : t('signIn')}
                </Button>
              </StaggerItem>
            </form>
          </Form>
        </StaggerGroup>
      </motion.div>
    </div>
  );
}
