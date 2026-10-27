import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

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
import { usePortalError } from '@/features/portal-app/ui';
import { PortalApiError, portalIdentityApi, setPortalCsrf } from '@/features/portal-app/api';
import { devLog } from '@/lib/debug';
import { useLocation } from 'wouter';
import { DURATION, EASE, SPRING, TRANSITION } from '@/lib/motion';
import { StaggerGroup, StaggerItem } from '@/components/ux/motion';
import { setActivePlatformRealm } from '@/lib/platformSession';
import { isLearningModulePath, isLegacyLearningPath, isPlatformAccountPath, learningModuleBase, learningModuleForSubject, learningModuleFromPath, toLearningModuleHref } from '@shared/platform-routes';
import { resolveLoginRealm } from '@/lib/session';
import { localizeApiErrorMessage } from '@/lib/queryClient';
import { OrbitSpinner } from '@/components/ui/orbit-spinner';

export default function Login() {
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, isLoading } = useAuth();
  const { t } = useTranslation();
  const portalErrorMessage = usePortalError();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // The URL the user originally asked for (deep link or the page open when the
  // session expired): returning there instead of a blind redirect to `/`
  // keeps shared links and mid-session expiry painless.
  const [returnTo] = useState(() => {
    const href = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const next = new URLSearchParams(window.location.search).get('next');
    const target = window.location.pathname === '/login' ? (next ?? '/') : href;
    if (!target.startsWith('/') || target.startsWith('//')) return '/';
    try {
      const destination = new URL(target, window.location.origin);
      return destination.origin === window.location.origin && !destination.pathname.startsWith('/login')
        ? `${destination.pathname}${destination.search}${destination.hash}` : '/';
    } catch {
      return '/';
    }
  });
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
      const learningLogin = async () => {
        const portalSession = await portalIdentityApi.session();
        if (!mounted.current) return;
        setPortalCsrf(portalSession.csrfToken);
        const learningSession = await portalIdentityApi.login(data.login, data.password);
        if (!mounted.current) return;
        return learningSession;
      };
      const learningDestination = isLearningModulePath(returnTo) || isLegacyLearningPath(returnTo) || isPlatformAccountPath(returnTo);
      const realm = await resolveLoginRealm(data.login, data.password, learningDestination ? 'portal' : 'staff');
      if (!mounted.current) return;
      let learningSession;
      if (realm === 'portal') learningSession = await learningLogin();
      else await login(data.login, data.password);
      if (!mounted.current) return;
      if (learningSession) {
        const requestedLink = Number(new URL(returnTo, window.location.origin).searchParams.get('linkId'));
        const requestedSubject = learningSession.subjects.find((subject) => subject.linkId === requestedLink);
        const requestedModule = learningModuleFromPath(returnTo);
        const fallbackModule = learningModuleForSubject(requestedSubject ??
          learningSession.subjects.find((subject) => subject.kind === 'self') ?? learningSession.subjects[0]);
        const module = requestedModule && learningSession.subjects.some((subject) => learningModuleForSubject(subject) === requestedModule)
          ? requestedModule : fallbackModule;
        const requestedDestination = isPlatformAccountPath(returnTo) ? returnTo :
          isLearningModulePath(returnTo) || isLegacyLearningPath(returnTo) ? toLearningModuleHref(returnTo, module) : learningModuleBase(module);
        const destination = requestedDestination.split(/[?#]/, 1)[0] === '/login' ? learningModuleBase(module) : requestedDestination;
        setActivePlatformRealm('portal');
        setLocation(destination);
        return;
      }
      devLog('[LOGIN] Login successful!');
      queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
      setIsSubmitting(false);
      setActivePlatformRealm('staff');
      setLocation(isLearningModulePath(returnTo) || isLegacyLearningPath(returnTo) ? '/learning' : isPlatformAccountPath(returnTo) ? '/' : returnTo);
    } catch (err: any) {
      if (!mounted.current) return;
      if ([401, 404].includes(err?.status)) {
        setError(t('invalidCredentialsMessage'));
        setIsSubmitting(false);
        return;
      }

      if (err instanceof PortalApiError) { setError(portalErrorMessage(err, 'loginFailedMessage')); return; }
      devLog('Login error:', err);
      const errorMessage =
        err?.rawMessage && (err.rawMessage === 'invalidCredentialsMessage' || err.rawMessage === 'loginOrEmailRequired' || err.rawMessage === 'passwordRequired')
          ? t(err.rawMessage)
          : err?.message
            ? localizeApiErrorMessage(err.message, err.status ?? 0)
            : t('loginFailedMessage');
      setError(errorMessage);
      setIsSubmitting(false);
    } finally {
      if (mounted.current) setIsSubmitting(false);
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
                          autoComplete="username"
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
                          autoComplete="current-password"
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
                      <OrbitSpinner className="" />
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
