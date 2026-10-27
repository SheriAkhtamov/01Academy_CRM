import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from '@/hooks/useTranslation';
import { useAccounts } from '@/hooks/useAccounts';
import { useToast } from '@/hooks/use-toast';
import { localizeApiErrorMessage } from '@/lib/queryClient';
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
import { UserPlus, KeyRound } from 'lucide-react';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { OrbitSpinner } from '@/components/ui/orbit-spinner';

interface AddAccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AddAccountModal({ open, onOpenChange }: AddAccountModalProps) {
  const { t } = useTranslation();
  const { addAccount, isAdding } = useAccounts();
  const { toast } = useToast();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const session = useRef({ open, epoch: 0 });
  if (session.current.open !== open) session.current = { open, epoch: session.current.epoch + 1 };
  useEffect(() => { session.current.open = open; return () => { session.current.open = false; }; }, [open]);

  const formSchema = z.object({
    login: z.string().min(1, t('loginOrEmailRequired')),
    password: z.string().min(1, t('passwordRequired')),
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      login: '',
      password: '',
    },
  });

  const pending = isAdding || submitting || form.formState.isSubmitting;

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    if (inFlight.current || !open) return;
    inFlight.current = true;
    setSubmitting(true);
    const epoch = session.current.epoch;
    setError('');
    try {
      await addAccount(data.login, data.password);
      if (!session.current.open || session.current.epoch !== epoch) return;
      toast({
        title: t('accountAdded'),
      });
      form.reset();
      onOpenChange(false);
    } catch (err: any) {
      if (!session.current.open || session.current.epoch !== epoch) return;
      const message = typeof err?.message === 'string' && err.message.trim()
        ? localizeApiErrorMessage(err.message, err.status ?? 0)
        : t('addAccountFailed');
      setError(message);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const values = form.watch();
  const guard = useUnsavedChangesGuard({
    open,
    isDirty: Boolean(values.login || values.password),
    isPending: pending,
    onOpenChange: (next) => {
      if (!next) { form.reset(); setError(''); }
      onOpenChange(next);
    },
  });
  useEffect(() => {
    if (!open) { form.reset(); setError(''); }
  }, [open, form]);

  return (
    <>
    <Dialog open={open} onOpenChange={guard.handleOpenChange}>
      <DialogContent aria-describedby={undefined} className="compact-modal flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="compact-modal-header">
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            {t('addAccount')}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={event => {
            const epoch = session.current.epoch;
            void form.handleSubmit(data => {
              if (session.current.open && session.current.epoch === epoch) return onSubmit(data);
            })(event);
          }} className="flex min-h-0 flex-1 flex-col">
            <div className="compact-modal-body min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
            <CompactModalSection title={t('portalSecurityNotifications')} icon={KeyRound} tone="sky" collapsible={false} disabled={pending} contentClassName="space-y-3">
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <FormField
              control={form.control}
              name="login"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('loginOrEmailLabel')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoComplete="username"
                      onChange={(e) => {
                        setError('');
                        field.onChange(e);
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
                      autoComplete="current-password"
                      {...field}
                      onChange={(e) => {
                        setError('');
                        field.onChange(e);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            </CompactModalSection>
            </div>
            <DialogFooter className="compact-modal-footer">
              <Button
                type="button"
                variant="outline"
                onClick={() => guard.handleOpenChange(false)}
                disabled={pending}
              >
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <OrbitSpinner className="h-4 w-4 mr-2" />
                ) : (
                  <UserPlus className="h-4 w-4 mr-2" />
                )}
                {t('addAccount')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
    <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
    </>
  );
}
