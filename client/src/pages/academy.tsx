import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { TranslationKey } from '@/lib/i18n';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { PhoneInput } from '@/components/ux/FormattedInputs';
import { PageHeader } from '@/components/ux/PageHeader';
import { WorkspacePage, WorkspacePageBody } from '@/components/ux/WorkspacePage';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ExternalLink,
  Globe2,
  Loader2,
  PhoneCall,
  PhoneForwarded,
  Plug,
  Settings2,
  Unplug,
} from 'lucide-react';

type AcademySection = 'integrations';

interface AcademyPageProps {
  section: AcademySection;
}

interface IntegrationStatus {
  provider: string;
  mode: string;
  connected: boolean;
  accountId?: number | null;
  accountUsername?: string | null;
  message: string;
  lastLog?: {
    provider: string;
    direction?: string;
    status: string;
    errorMessage?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  } | null;
}

interface OnlinePbxForwardingSettings {
  enabled: boolean;
  phone: string;
}

const integrationCopy = (provider: string, t: (key: TranslationKey) => string) => {
  switch (provider) {
    case 'instagram':
      return { title: t('instagramIntegration'), description: t('instagramIntegrationDesc') };
    case 'website':
      return { title: t('integrationProviderWebsite'), description: t('integrationProviderWebsiteDesc') };
    case 'onlinepbx':
      return { title: t('onlinePbxIntegration'), description: t('onlinePbxIntegrationDesc') };
    default:
      return { title: t('navIntegrations'), description: t('adminIntegrationsDescription') };
  }
};

const formatLogTime = (value: string | null | undefined, language: string) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(language === 'ru' ? 'ru-RU' : 'en-US');
};

export default function AcademyPage({ section }: AcademyPageProps) {
  const { t, language } = useTranslation();
  const [instagramDisconnectTarget, setInstagramDisconnectTarget] = useState<{
    id: number;
    username?: string | null;
  } | null>(null);
  const [onlinePbxSettingsOpen, setOnlinePbxSettingsOpen] = useState(false);
  const [onlinePbxForwardingDraft, setOnlinePbxForwardingDraft] =
    useState<OnlinePbxForwardingSettings>({ enabled: false, phone: '' });

  const integrations = useQuery<IntegrationStatus[]>({
    queryKey: ['/api/academy/integrations/status'],
  });
  const onlinePbxForwarding = useQuery<OnlinePbxForwardingSettings>({
    queryKey: ['/api/telephony/forwarding'],
    enabled: onlinePbxSettingsOpen,
    staleTime: 0,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('instagram');
    if (!result) return;

    if (result === 'connected') {
      toast({ title: t('instagramConnected') });
    } else if (result === 'cancelled') {
      toast({ title: t('instagramConnectionCancelled') });
    } else {
      toast({
        title: t('instagramConnectionFailed'),
        description: t('instagramConnectionFailedDesc'),
        variant: 'destructive',
      });
    }
    window.history.replaceState({}, document.title, window.location.pathname);
  }, [t]);

  useEffect(() => {
    if (!onlinePbxForwarding.data) return;
    setOnlinePbxForwardingDraft(onlinePbxForwarding.data);
  }, [
    onlinePbxSettingsOpen,
    onlinePbxForwarding.data?.enabled,
    onlinePbxForwarding.data?.phone,
  ]);

  const startInstagramConnection = useMutation({
    mutationFn: () => apiRequest('POST', '/api/instagram/oauth/start'),
    onSuccess: (result) => {
      window.location.assign(result.url);
    },
    onError: (error: Error) => {
      const isNotConfigured = error.message === t('instagramIntegrationNotConfigured');
      toast({
        title: isNotConfigured ? t('instagramSetupRequired') : t('instagramConnectionFailed'),
        description: isNotConfigured ? t('instagramSetupRequiredDesc') : error.message,
        variant: 'destructive',
      });
    },
  });

  const disconnectInstagram = useMutation({
    mutationFn: (accountId: number) => apiRequest('DELETE', `/api/instagram/accounts/${accountId}`),
    onSuccess: async () => {
      setInstagramDisconnectTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['/api/academy/integrations/status'] });
      toast({ title: t('instagramAccountDisconnected') });
    },
    onError: (error: Error) => {
      toast({
        title: t('instagramDisconnectFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const testOnlinePbx = useMutation({
    mutationFn: () => apiRequest('POST', '/api/academy/integrations/onlinepbx/test'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['/api/academy/integrations/status'] });
      toast({
        title: t('onlinePbxConnectionVerified'),
        description: t('onlinePbxConnectionVerifiedDescription'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('onlinePbxConnectionFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const updateOnlinePbxForwarding = useMutation({
    mutationFn: (settings: OnlinePbxForwardingSettings) =>
      apiRequest('PUT', '/api/telephony/forwarding', settings) as Promise<OnlinePbxForwardingSettings>,
    onSuccess: (settings) => {
      queryClient.setQueryData(['/api/telephony/forwarding'], settings);
      setOnlinePbxForwardingDraft(settings);
      toast({
        title: t('onlinePbxForwardingSaved'),
        description: settings.enabled
          ? t('onlinePbxForwardingEnabled')
          : t('onlinePbxForwardingDisabled'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('onlinePbxForwardingUpdateFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });
  const onlinePbxIntegration = integrations.data?.find(
    (integration) => integration.provider === 'onlinepbx',
  );
  const forwardingPhoneIsValid =
    onlinePbxForwardingDraft.phone.replace(/\D/g, '').length === 12;
  const forwardingSettingsChanged =
    onlinePbxForwarding.data?.enabled !== onlinePbxForwardingDraft.enabled
    || onlinePbxForwarding.data?.phone !== onlinePbxForwardingDraft.phone;

  return (
    <WorkspacePage contained>
      <PageHeader
        title={section === 'integrations' ? t('navIntegrations') : t('navIntegrations')}
        subtitle={t('academyDescription')}
        breadcrumbs={[{ label: t('navIntegrations') }]}
      />

      <WorkspacePageBody contained ariaLabel={t('navIntegrations')} className="space-y-3">
        {integrations.isLoading ? (
          Array.from({ length: 2 }).map((_, index) => (
            <Card key={index}>
              <CardHeader>
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-5 w-40" />
                      <Skeleton className="h-4 w-full max-w-xl" />
                    </div>
                  </div>
                  <Skeleton className="h-9 w-28 rounded-md" />
                </div>
              </CardHeader>
            </Card>
          ))
        ) : (integrations.data ?? []).map((integration) => {
          const copy = integrationCopy(integration.provider, t);
          const lastLogTime = formatLogTime(integration.lastLog?.createdAt ?? integration.lastLog?.updatedAt, language);
          const Icon = integration.provider === 'website'
            ? Globe2
            : integration.provider === 'instagram'
              ? Camera
              : integration.provider === 'onlinepbx'
                ? PhoneCall
                : Plug;

          return (
            <Card
              key={integration.provider}
              className={integration.connected ? 'border-emerald-200 bg-emerald-50/40' : ''}
            >
              <CardHeader>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle>{copy.title}</CardTitle>
                      <CardDescription className="mt-1">{copy.description}</CardDescription>
                      <p className="mt-3 text-sm text-muted-foreground">{integration.message}</p>
                      <div className="mt-3 inline-flex rounded-lg border border-border/70 bg-background px-3 py-2 text-xs text-muted-foreground">
                        {lastLogTime ? (
                          <span>{t('integrationLastEvent')}: {lastLogTime}</span>
                        ) : (
                          <span>{t('integrationNoEvents')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center lg:justify-end">
                    {integration.provider === 'instagram' ? (
                      integration.connected ? (
                        <Button
                          variant="outline"
                          onClick={() => {
                            if (integration.accountId) {
                              setInstagramDisconnectTarget({
                                id: integration.accountId,
                                username: integration.accountUsername,
                              });
                            }
                          }}
                          disabled={!integration.accountId || disconnectInstagram.isPending}
                        >
                          <Unplug data-icon="inline-start" />
                          {t('disconnectInstagram')}
                        </Button>
                      ) : (
                        <Button
                          onClick={() => startInstagramConnection.mutate()}
                          disabled={startInstagramConnection.isPending}
                        >
                          <ExternalLink data-icon="inline-start" />
                          {t('loginWithInstagram')}
                        </Button>
                      )
                    ) : integration.provider === 'onlinepbx' ? (
                      <Button
                        variant="outline"
                        onClick={() => setOnlinePbxSettingsOpen(true)}
                        disabled={!integration.connected}
                      >
                        <Settings2 data-icon="inline-start" />
                        {t('settings')}
                      </Button>
                    ) : null}
                    <Badge variant={integration.connected ? 'success' : 'warning'}>
                      {integration.connected ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5" />
                      )}
                      {integration.connected ? t('active') : t('inactive')}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
            </Card>
          );
        })}
      </WorkspacePageBody>

      <Dialog open={onlinePbxSettingsOpen} onOpenChange={setOnlinePbxSettingsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('onlinePbxSettingsTitle')}</DialogTitle>
            <DialogDescription>{t('onlinePbxSettingsDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <PhoneForwarded className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{t('onlinePbxForwarding')}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {t('onlinePbxForwardingDescription')}
                    </p>
                  </div>
                </div>
                {onlinePbxForwarding.isLoading ? (
                  <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <Switch
                    checked={onlinePbxForwardingDraft.enabled}
                    onCheckedChange={(enabled) => {
                      setOnlinePbxForwardingDraft((current) => ({ ...current, enabled }));
                    }}
                    disabled={
                      onlinePbxForwarding.isError
                      || updateOnlinePbxForwarding.isPending
                      || !onlinePbxIntegration?.connected
                    }
                    aria-label={t('onlinePbxForwarding')}
                  />
                )}
              </div>

              <div className="mt-4 space-y-2 border-t border-border/70 pt-4">
                <label
                  className="text-sm font-medium text-foreground"
                  htmlFor="online-pbx-forwarding-phone"
                >
                  {t('onlinePbxForwardingPhone')}
                </label>
                <PhoneInput
                  id="online-pbx-forwarding-phone"
                  value={onlinePbxForwardingDraft.phone}
                  onValueChange={(phone) => {
                    setOnlinePbxForwardingDraft((current) => ({ ...current, phone }));
                  }}
                  disabled={
                    onlinePbxForwarding.isLoading
                    || onlinePbxForwarding.isError
                    || updateOnlinePbxForwarding.isPending
                    || !onlinePbxIntegration?.connected
                  }
                  aria-invalid={
                    Boolean(onlinePbxForwardingDraft.phone) && !forwardingPhoneIsValid
                  }
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  {t('onlinePbxForwardingPhoneHint')}
                </p>
              </div>
            </div>

            {onlinePbxForwarding.isError ? (
              <div className="flex items-start gap-2 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{t('onlinePbxForwardingLoadFailed')}</span>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => testOnlinePbx.mutate()}
              disabled={!onlinePbxIntegration?.connected || testOnlinePbx.isPending}
            >
              {testOnlinePbx.isPending ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : (
                <PhoneCall data-icon="inline-start" />
              )}
              {t('onlinePbxTestConnection')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOnlinePbxSettingsOpen(false)}
            >
              {t('close')}
            </Button>
            <Button
              type="button"
              onClick={() => updateOnlinePbxForwarding.mutate(onlinePbxForwardingDraft)}
              disabled={
                !onlinePbxIntegration?.connected
                || onlinePbxForwarding.isLoading
                || onlinePbxForwarding.isError
                || updateOnlinePbxForwarding.isPending
                || !forwardingPhoneIsValid
                || !forwardingSettingsChanged
              }
            >
              {updateOnlinePbxForwarding.isPending ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : null}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(instagramDisconnectTarget)}
        onOpenChange={(open) => !open && setInstagramDisconnectTarget(null)}
        title={t('disconnectInstagramTitle')}
        description={instagramDisconnectTarget?.username
          ? `${t('disconnectInstagramDescription')} @${instagramDisconnectTarget.username}`
          : t('disconnectInstagramDescription')}
        confirmLabel={t('disconnectInstagram')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          if (instagramDisconnectTarget) {
            disconnectInstagram.mutate(instagramDisconnectTarget.id);
          }
        }}
        variant="destructive"
      />
    </WorkspacePage>
  );
}
