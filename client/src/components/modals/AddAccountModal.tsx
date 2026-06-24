import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from '@/hooks/useTranslation';
import { useAccounts } from '@/hooks/useAccounts';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { UserPlus, Loader2 } from 'lucide-react';

interface AddAccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function AddAccountModal({ open, onOpenChange }: AddAccountModalProps) {
  const { t } = useTranslation();
  const { addAccount, isAdding } = useAccounts();
  const { toast } = useToast();
  const [error, setError] = useState('');

  const formSchema = z.object({
    login: z.string().min(1, t('loginOrEmailRequired')),
    password: z.string().min(1, t('passwordRequired')),
    label: z.string().optional(),
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      login: '',
      password: '',
      label: '',
    },
  });

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    setError('');
    try {
      await addAccount(data.login, data.password, data.label || undefined);
      toast({
        title: t('accountAdded'),
        description: t('accountAddedDesc'),
      });
      form.reset();
      onOpenChange(false);
    } catch (err: any) {
      const message = err?.rawMessage || err?.message || 'Failed to add account';
      setError(typeof message === 'string' ? message : 'Failed to add account');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            {t('addAccount')}
          </DialogTitle>
          <DialogDescription>
            {t('addAccountDescription')}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="login"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('loginOrEmailLabel')}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('loginOrEmailPlaceholder')}
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
              name="label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('accountLabel')} ({t('optional')})</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t('accountLabelPlaceholder')}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isAdding}
              >
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={isAdding}>
                {isAdding ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4 mr-2" />
                )}
                {t('addAccount')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
