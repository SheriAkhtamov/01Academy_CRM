import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import type { TranslationKey } from '@/lib/i18n';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
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
  Star,
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

interface OnlinePbxManagerRoutingSetting {
  id: number;
  fullName: string;
  phone: string | null;
  extension: string | null;
  enabled: boolean;
  isOnline: boolean;
  isTelephonyReady: boolean;
  hasValidExtension: boolean;
  isPrimary: boolean;
  isActivePrimary: boolean;
}

interface OnlinePbxRoutingSettings {
  ringDelaySeconds: number;
  primaryManagerId: number | null;
  activePrimaryManagerId: number | null;
  enabledManagerIds: number[];
  managers: OnlinePbxManagerRoutingSetting[];
  synchronized?: boolean;
}

interface OnlinePbxRoutingDraft {
  primaryManagerId: number | null;
  enabledManagerIds: number[];
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
  const [onlinePbxRoutingDraft, setOnlinePbxRoutingDraft] =
    useState<OnlinePbxRoutingDraft>({ primaryManagerId: null, enabledManagerIds: [] });

  const integrations = useQuery<IntegrationStatus[]>({
    queryKey: ['/api/academy/integrations/status'],
  });
  const onlinePbxRouting = useQuery<OnlinePbxRoutingSettings>({
    queryKey: ['/api/telephony/routing'],
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
    if (!onlinePbxRouting.data) return;
    setOnlinePbxRoutingDraft({
      primaryManagerId: onlinePbxRouting.data.primaryManagerId,
      enabledManagerIds: onlinePbxRouting.data.enabledManagerIds,
    });
  }, [
    onlinePbxSettingsOpen,
    onlinePbxRouting.data?.primaryManagerId,
    onlinePbxRouting.data?.enabledManagerIds.join(','),
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

  const updateOnlinePbxRouting = useMutation({
    mutationFn: (settings: OnlinePbxRoutingDraft) =>
      apiRequest('PUT', '/api/telephony/routing', settings) as Promise<OnlinePbxRoutingSettings>,
    onSuccess: (settings) => {
      queryClient.setQueryData(['/api/telephony/routing'], settings);
      setOnlinePbxRoutingDraft({
        primaryManagerId: settings.primaryManagerId,
        enabledManagerIds: settings.enabledManagerIds,
      });
      toast({
        title: t('onlinePbxRoutingSaved'),
        description: settings.synchronized === false
          ? t('onlinePbxRoutingSyncPending')
          : t('onlinePbxRoutingSavedDescription'),
        variant: settings.synchronized === false ? 'destructive' : undefined,
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('onlinePbxRoutingUpdateFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });
  const onlinePbxIntegration = integrations.data?.find(
    (integration) => integration.provider === 'onlinepbx',
  );
  const enabledRoutingManagerIds = useMemo(
    () => new Set(onlinePbxRoutingDraft.enabledManagerIds),
    [onlinePbxRoutingDraft.enabledManagerIds],
  );
  const routingSettingsChanged = Boolean(
    onlinePbxRouting.data
    && (
      onlinePbxRouting.data.synchronized === false
      || onlinePbxRouting.data.primaryManagerId !== onlinePbxRoutingDraft.primaryManagerId
      || [...onlinePbxRouting.data.enabledManagerIds].sort((left, right) => left - right).join(',')
        !== [...onlinePbxRoutingDraft.enabledManagerIds].sort((left, right) => left - right).join(',')
    )
  );

  const setManagerCallsEnabled = (managerId: number, enabled: boolean) => {
    setOnlinePbxRoutingDraft((current) => {
      const enabledManagerIds = enabled
        ? [...new Set([...current.enabledManagerIds, managerId])]
        : current.enabledManagerIds.filter((id) => id !== managerId);
      const primaryManagerId = enabled
        ? current.primaryManagerId ?? managerId
        : current.primaryManagerId === managerId
          ? enabledManagerIds[0] ?? null
          : current.primaryManagerId;
      return { enabledManagerIds, primaryManagerId };
    });
  };

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
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('onlinePbxSettingsTitle')}</DialogTitle>
            <DialogDescription>{t('onlinePbxSettingsDescription')}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <Alert>
              <PhoneForwarded />
              <AlertTitle>{t('onlinePbxRoutingTitle')}</AlertTitle>
              <AlertDescription>
                {t('onlinePbxRoutingDescription').replace(
                  '{seconds}',
                  String(onlinePbxRouting.data?.ringDelaySeconds ?? 3),
                )}
              </AlertDescription>
            </Alert>

            {onlinePbxRouting.isLoading ? (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="flex items-center gap-3 rounded-lg border p-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-28" />
                    </div>
                    <Skeleton className="h-9 w-28" />
                    <Skeleton className="h-6 w-11 rounded-full" />
                  </div>
                ))}
              </div>
            ) : onlinePbxRouting.isError ? (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>{t('onlinePbxRoutingLoadFailed')}</AlertTitle>
                <AlertDescription>{t('onlinePbxRoutingLoadFailedDescription')}</AlertDescription>
              </Alert>
            ) : (
              <FieldSet>
                <FieldLegend className="sr-only">{t('onlinePbxManagers')}</FieldLegend>
                <ScrollArea className="max-h-[22rem] pr-3">
                  <FieldGroup className="gap-3">
                    {(onlinePbxRouting.data?.managers ?? []).map((manager) => {
                      const enabled = enabledRoutingManagerIds.has(manager.id);
                      const isPrimary = onlinePbxRoutingDraft.primaryManagerId === manager.id;
                      return (
                        <Field
                          key={manager.id}
                          orientation="responsive"
                          className="rounded-lg border p-3"
                        >
                          <FieldContent className="min-w-0">
                            <FieldTitle className="flex-wrap">
                              <span className="truncate">{manager.fullName}</span>
                              <Badge variant={manager.isOnline ? 'success' : 'secondary'}>
                                {manager.isOnline ? t('online') : t('offline')}
                              </Badge>
                              {manager.isOnline ? (
                                <Badge variant={manager.isTelephonyReady ? 'success' : 'warning'}>
                                  {manager.isTelephonyReady
                                    ? t('onlinePbxTelephonyReady')
                                    : t('onlinePbxTelephonyNotReady')}
                                </Badge>
                              ) : null}
                              {manager.isActivePrimary ? (
                                <Badge variant="info">{t('onlinePbxActivePrimary')}</Badge>
                              ) : null}
                            </FieldTitle>
                            <FieldDescription>
                              {manager.extension
                                ? `${t('extensionShort')} ${manager.extension}`
                                : t('onlinePbxExtensionPending')}
                            </FieldDescription>
                          </FieldContent>
                          <div className="flex items-center justify-between gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant={isPrimary ? 'secondary' : 'ghost'}
                              aria-pressed={isPrimary}
                              onClick={() => {
                                setOnlinePbxRoutingDraft((current) => ({
                                  ...current,
                                  primaryManagerId: manager.id,
                                }));
                              }}
                              disabled={
                                !enabled
                                || updateOnlinePbxRouting.isPending
                                || !onlinePbxIntegration?.connected
                              }
                            >
                              <Star data-icon="inline-start" />
                              {isPrimary ? t('onlinePbxPrimaryManager') : t('onlinePbxMakePrimary')}
                            </Button>
                            <Switch
                              checked={enabled}
                              onCheckedChange={(checked) => {
                                setManagerCallsEnabled(manager.id, checked);
                              }}
                              disabled={
                                updateOnlinePbxRouting.isPending
                                || !onlinePbxIntegration?.connected
                              }
                              aria-label={`${t('onlinePbxReceiveCalls')}: ${manager.fullName}`}
                            />
                          </div>
                        </Field>
                      );
                    })}
                  </FieldGroup>
                </ScrollArea>
                {(onlinePbxRouting.data?.managers.length ?? 0) === 0 ? (
                  <Alert>
                    <AlertCircle />
                    <AlertTitle>{t('onlinePbxNoManagers')}</AlertTitle>
                    <AlertDescription>{t('onlinePbxNoManagersDescription')}</AlertDescription>
                  </Alert>
                ) : null}
              </FieldSet>
            )}
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
              onClick={() => updateOnlinePbxRouting.mutate(onlinePbxRoutingDraft)}
              disabled={
                !onlinePbxIntegration?.connected
                || onlinePbxRouting.isLoading
                || onlinePbxRouting.isError
                || updateOnlinePbxRouting.isPending
                || !routingSettingsChanged
              }
            >
              {updateOnlinePbxRouting.isPending ? (
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
