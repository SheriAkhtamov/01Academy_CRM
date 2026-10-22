import { EmployeeIdentity } from '@/components/ux/EmployeeIdentity';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { AUTH_SESSION_QUERY_KEY } from '@shared/auth';
import type { TranslationKey } from '@/lib/i18n';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import { PhoneInput } from '@/components/ux/FormattedInputs';
import {
  UnsavedChangesDialog,
  useUnsavedChangesGuard,
} from '@/components/ux/UnsavedChangesGuard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { PageHeader } from '@/components/ux/PageHeader';
import { ModulePage } from '@/components/ux/ModulePage';
import { IntegrationSettingsDialog } from '@/components/integrations/IntegrationSettingsDialog';
import { VoiceRemindersDialog } from '@/features/voice-reminders/ui/VoiceRemindersDialog';
import type { IntegrationType } from '@/features/integrations/api';
import type { MetaIntegrationState } from '@/features/marketing/meta-api';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ExternalLink,
  Globe2,
  Loader2,
  PhoneCall,
  PhoneForwarded,
  Plus,
  Plug,
  RadioTower,
  Send,
  Settings2,
  Star,
  Trash2,
  Unplug,
} from 'lucide-react';

type AcademySection = 'integrations';

interface AcademyPageProps {
  section: AcademySection;
}

interface IntegrationStatus {
  provider: string;
  siteDomain?: string | null;
  mode: string;
  connected: boolean;
  requiresReconnect?: boolean;
  accountId?: number | null;
  accountUsername?: string | null;
  externalUrl?: string | null;
  details?: MetaIntegrationState | null;
  lastLog?: {
    provider: string;
    direction?: string;
    status: string;
    errorMessage?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  } | null;
}

interface OnlinePbxManagerOption {
  id: number;
  fullName: string;
}

interface OnlinePbxManagerAssignment {
  managerId: number;
  fullName: string;
  extension: string;
  isOnline: boolean;
  isProviderEnabled: boolean;
  isRegistered: boolean;
  isTelephonyReady: boolean;
  isPrimary: boolean;
  isActivePrimary: boolean;
}

interface OnlinePbxExtensionOption {
  extension: string;
  name: string | null;
  enabled: boolean;
  registered: boolean;
}

interface OnlinePbxRoutingSettings {
  ringDelaySeconds: number;
  primaryManagerId: number | null;
  activePrimaryManagerId: number | null;
  managers: OnlinePbxManagerOption[];
  assignments: OnlinePbxManagerAssignment[];
  extensions: OnlinePbxExtensionOption[];
  forwarding: {
    enabled: boolean;
    phone: string;
  };
  synchronized?: boolean;
}

interface OnlinePbxAssignmentDraft {
  managerId: number;
  extension: string;
}

interface OnlinePbxRoutingDraft {
  primaryManagerId: number | null;
  assignments: OnlinePbxAssignmentDraft[];
  forwarding: {
    enabled: boolean;
    phone: string;
  };
}

const accessUnavailable = (error: unknown) => {
  const status = (error as { status?: number } | null)?.status;
  return status === 403 || status === 404;
};

const emptyOnlinePbxDraft: OnlinePbxRoutingDraft = {
  primaryManagerId: null,
  assignments: [],
  forwarding: { enabled: false, phone: '' },
};

const comparableOnlinePbxDraft = (draft: OnlinePbxRoutingDraft) => JSON.stringify({
  primaryManagerId: draft.primaryManagerId,
  assignments: [...draft.assignments].sort(
    (left, right) => left.managerId - right.managerId,
  ),
  forwarding: draft.forwarding,
});

const integrationCopy = (
  integration: Pick<IntegrationStatus, 'provider' | 'siteDomain'>,
  t: (key: TranslationKey) => string,
) => {
  const { provider, siteDomain } = integration;
  if (siteDomain) {
    return {
      title: siteDomain,
    };
  }
  switch (provider) {
    case 'instagram':
      return { title: t('instagramIntegration')};
    case 'website':
      return { title: t('integrationProviderWebsite')};
    case 'meta':
      return { title: t('metaIntegration')};
    case 'onlinepbx':
      return { title: t('onlinePbxIntegration')};
    case 'telegram_tasks':
      return { title: t('telegramTasksIntegration')};
    default:
      return { title: t('navIntegrations')};
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
  const routingInitialized = useRef(false);
  const routingSubmitLocked = useRef(false);
  const routingSession = useRef({ epoch: 0, allowed: true });
  const [routingDenied, setRoutingDenied] = useState(false);
  const instagramDisconnectLocked = useRef(false);
  const [voiceRemindersOpen, setVoiceRemindersOpen] = useState(false);
  const [integrationCatalogOpen, setIntegrationCatalogOpen] = useState(false);
  const [settingsProvider, setSettingsProvider] = useState<IntegrationType | null>(null);
  const [settingsSiteDomain, setSettingsSiteDomain] = useState<string | null>(null);
  const [onlinePbxRoutingDraft, setOnlinePbxRoutingDraft] =
    useState<OnlinePbxRoutingDraft>(emptyOnlinePbxDraft);
  const [newManagerId, setNewManagerId] = useState('');
  const [newExtension, setNewExtension] = useState('');
  const [removeManagerTarget, setRemoveManagerTarget] = useState<{
    managerId: number;
    fullName: string;
  } | null>(null);

  const integrations = useQuery<IntegrationStatus[]>({
    queryKey: ['/api/academy/integrations/status'],
  });
  const totalCount = integrations.data?.length ?? 0;
  const connectedCount = (integrations.data ?? []).filter((entry) => entry.connected).length;
  /*
    Whatever is broken goes first. This page exists to be checked, and an admin
    opening it wants the one integration that stopped working — not to read
    past three healthy cards to find it. Ties keep the server's order so the
    list does not reshuffle between refetches.
  */
  const orderedIntegrations = useMemo(() => (
    [...(integrations.data ?? [])].sort((a, b) => Number(a.connected) - Number(b.connected))
  ), [integrations.data]);
  const onlinePbxRouting = useQuery<OnlinePbxRoutingSettings>({
    queryKey: ['/api/telephony/routing'],
    enabled: onlinePbxSettingsOpen,
    staleTime: 0,
  });

  const routingUnavailable = routingDenied || accessUnavailable(onlinePbxRouting.error);
  if (routingUnavailable) routingSession.current.allowed = false;
  useEffect(() => {
    if (!routingUnavailable) return;
    setOnlinePbxSettingsOpen(false);
    setOnlinePbxRoutingDraft(emptyOnlinePbxDraft);
    setNewManagerId('');
    setNewExtension('');
    setRemoveManagerTarget(null);
  }, [routingUnavailable]);
  useEffect(() => () => { routingSession.current.allowed = false; }, []);

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
        variant: 'destructive',
      });
    }
    window.history.replaceState({}, document.title, window.location.pathname);
  }, [t]);

  useEffect(() => {
    if (!onlinePbxSettingsOpen) {
      routingInitialized.current = false;
      return;
    }
    if (!routingSession.current.allowed || !onlinePbxRouting.data || routingInitialized.current) return;
    routingInitialized.current = true;
    setOnlinePbxRoutingDraft({
      primaryManagerId: onlinePbxRouting.data.primaryManagerId,
      assignments: onlinePbxRouting.data.assignments.map((assignment) => ({
        managerId: assignment.managerId,
        extension: assignment.extension,
      })),
      forwarding: onlinePbxRouting.data.forwarding,
    });
    setNewManagerId('');
    setNewExtension(
      onlinePbxRouting.data.extensions.find((extension) => extension.enabled)?.extension
        ?? onlinePbxRouting.data.extensions[0]?.extension
        ?? '',
    );
  }, [onlinePbxSettingsOpen, onlinePbxRouting.data]);

  const startInstagramConnection = useMutation({
    mutationFn: () => apiRequest('POST', '/api/instagram/oauth/start'),
    onSuccess: (result) => {
      window.location.assign(result.url);
    },
    onError: (error: Error & { rawMessage?: string }) => {
      const notConfiguredCode = 'instagramIntegrationNotConfigured';
      const normalized = `${error.rawMessage ?? error.message}`.replace(/^\d+:\s*/, '').trim();
      const isNotConfigured = normalized === notConfiguredCode
        || error.message === notConfiguredCode
        || error.message === t('instagramIntegrationNotConfigured');
      toast({
        title: isNotConfigured ? t('instagramSetupRequired') : t('instagramConnectionFailed'),
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
    onSettled: () => { instagramDisconnectLocked.current = false; },
    onError: () => {
      toast({
        title: t('instagramDisconnectFailed'),
        variant: 'destructive',
      });
    },
  });

  const updateOnlinePbxRouting = useMutation({
    mutationFn: ({ settings }: { settings: OnlinePbxRoutingDraft; epoch: number }) =>
      apiRequest('PUT', '/api/telephony/routing', settings) as Promise<OnlinePbxRoutingSettings>,
    onSuccess: (settings, { epoch }) => {
      if (!routingSession.current.allowed || routingSession.current.epoch !== epoch) return;
      queryClient.setQueryData(['/api/telephony/routing'], settings);
      void queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
      setOnlinePbxRoutingDraft({
        primaryManagerId: settings.primaryManagerId,
        assignments: settings.assignments.map((assignment) => ({
          managerId: assignment.managerId,
          extension: assignment.extension,
        })),
        forwarding: settings.forwarding,
      });
      toast({
        title: t('onlinePbxRoutingSaved'),
        description: settings.synchronized === false
          ? t('onlinePbxRoutingSyncPending')
          : undefined,
        variant: settings.synchronized === false ? 'destructive' : undefined,
      });
    },
    onSettled: () => { routingSubmitLocked.current = false; },
    onError: (error: unknown, { epoch }) => {
      if (routingSession.current.epoch !== epoch || !routingSession.current.allowed) return;
      if (accessUnavailable(error)) {
        routingSession.current.allowed = false;
        setRoutingDenied(true);
        return;
      }
      toast({
        title: t('onlinePbxRoutingUpdateFailed'),
        variant: 'destructive',
      });
    },
  });
  const onlinePbxIntegration = integrations.data?.find(
    (integration) => integration.provider === 'onlinepbx',
  );
  const openIntegrationSettings = (provider: IntegrationType, siteDomain?: string | null) => {
    setIntegrationCatalogOpen(false);
    setSettingsSiteDomain(siteDomain ?? null);
    setSettingsProvider(provider);
  };
  const assignedManagerIds = useMemo(
    () => new Set(onlinePbxRoutingDraft.assignments.map((assignment) => assignment.managerId)),
    [onlinePbxRoutingDraft.assignments],
  );
  const managerById = useMemo(
    () => new Map(
      (onlinePbxRouting.data?.managers ?? []).map((manager) => [manager.id, manager]),
    ),
    [onlinePbxRouting.data?.managers],
  );
  const assignmentStatusByManagerId = useMemo(
    () => new Map(
      (onlinePbxRouting.data?.assignments ?? []).map(
        (assignment) => [assignment.managerId, assignment],
      ),
    ),
    [onlinePbxRouting.data?.assignments],
  );
  const availableManagers = useMemo(
    () => (onlinePbxRouting.data?.managers ?? []).filter(
      (manager) => !assignedManagerIds.has(manager.id),
    ),
    [assignedManagerIds, onlinePbxRouting.data?.managers],
  );
  const routingSettingsChanged = Boolean(
    onlinePbxRouting.data
    && comparableOnlinePbxDraft({
      primaryManagerId: onlinePbxRouting.data.primaryManagerId,
      assignments: onlinePbxRouting.data.assignments.map((assignment) => ({
        managerId: assignment.managerId,
        extension: assignment.extension,
      })),
      forwarding: onlinePbxRouting.data.forwarding,
    }) !== comparableOnlinePbxDraft(onlinePbxRoutingDraft)
  );

  // Closing the PBX settings with unsaved edits asks for confirmation.
  const onlinePbxGuard = useUnsavedChangesGuard({
    open: onlinePbxSettingsOpen && !routingUnavailable,
    isDirty: routingSettingsChanged || Boolean(newManagerId),
    isPending: updateOnlinePbxRouting.isPending,
    onOpenChange: setOnlinePbxSettingsOpen,
  });

  const addManagerAssignment = () => {
    const managerId = Number(newManagerId);
    if (!Number.isInteger(managerId) || !newExtension || assignedManagerIds.has(managerId)) return;
    setOnlinePbxRoutingDraft((current) => {
      const assignments = [...current.assignments, { managerId, extension: newExtension }];
      return {
        ...current,
        assignments,
        primaryManagerId: current.primaryManagerId ?? managerId,
      };
    });
    setNewManagerId('');
  };

  const removeManagerAssignment = (managerId: number) => {
    setOnlinePbxRoutingDraft((current) => {
      const assignments = current.assignments.filter(
        (assignment) => assignment.managerId !== managerId,
      );
      return {
        ...current,
        assignments,
        primaryManagerId: current.primaryManagerId === managerId
          ? assignments[0]?.managerId ?? null
          : current.primaryManagerId,
      };
    });
    setRemoveManagerTarget(null);
  };

  return (
    /*
      A list of four setting cards has no reason to own a scroll area: it built
      an inner 492px window inside a viewport-locked page, so the cards moved
      under a frozen header instead of the page simply scrolling. Document flow
      is the right shape here — the header scrolls away and the whole height is
      the list's. `pb-24` keeps the last card reachable above the floating
      telephony widget, which is fixed to the bottom-right corner. That padding
      sits on the list, not on ModulePage: ModulePage's own `lg:p-8` is a media
      query and wins over an unprefixed `pb-*` passed in, which left the last
      card 41px under the widget on a 1280px screen.
    */
    <ModulePage>
      <PageHeader
        title={t('navIntegrations')}
        titleAccessory={integrations.data ? (
          <Badge variant={connectedCount === totalCount ? 'success' : 'warning'}>
            {t('integrationsConnectedSummary')
              .replace('{connected}', String(connectedCount))
              .replace('{total}', String(totalCount))}
          </Badge>
        ) : undefined}
        titleActions={(
          <Button onClick={() => setIntegrationCatalogOpen(true)}>
            <Plus data-icon="inline-start" />
            {t('add')}
          </Button>
        )}
      />

      <div aria-label={t('navIntegrations')} className="space-y-3 pb-24">
        {integrations.isError ? (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-sm text-destructive">{t('failedToLoadData')}</p>
            <Button variant="outline" onClick={() => integrations.refetch()} disabled={integrations.isFetching}>
              {t('retry')}
            </Button>
          </div>
        ) : integrations.isLoading ? (
          Array.from({ length: 6 }).map((_, index) => (
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
        ) : orderedIntegrations.map((integration) => {
          const copy = integrationCopy(integration, t);
          const statusText = integration.requiresReconnect
            ? t('integrationStatusReconnectRequired')
            : integration.connected
              ? t('integrationStatusConnected')
              : t('integrationStatusNotConfigured');
          const lastLogTime = formatLogTime(integration.lastLog?.createdAt ?? integration.lastLog?.updatedAt, language);
          const Icon = integration.siteDomain || integration.provider === 'website'
            ? Globe2
            : integration.provider === 'instagram'
              ? Camera
              : integration.provider === 'meta'
                ? RadioTower
              : integration.provider === 'onlinepbx'
                ? PhoneCall
                : integration.provider === 'telegram_tasks'
                  ? Send
                : Plug;

          return (
            <Card
              key={`${integration.provider}:${integration.accountId ?? integration.siteDomain ?? ''}`}
            >
              <CardHeader>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle>{copy.title}</CardTitle>
                      <p className={`mt-3 text-sm ${integration.connected ? 'text-muted-foreground' : 'text-amber-700'}`}>
                        {statusText}
                      </p>
                      <div className="mt-3 inline-flex max-w-full rounded-lg border border-border/70 bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                        {integration.provider === 'telegram_tasks' && integration.accountUsername ? (
                          <span>{t('telegramTasksBotLabel')}: @{integration.accountUsername}</span>
                        ) : lastLogTime ? (
                          <span>{t('integrationLastEvent')}: {lastLogTime}</span>
                        ) : (
                          <span>{t('integrationNoEvents')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:max-w-[70%] lg:justify-end">
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
                          {startInstagramConnection.isPending
                            ? <Loader2 className="animate-spin" data-icon="inline-start" />
                            : <ExternalLink data-icon="inline-start" />}
                          {t('loginWithInstagram')}
                        </Button>
                      )
                    ) : integration.provider === 'onlinepbx' ? (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => {
                            routingSession.current = { epoch: routingSession.current.epoch + 1, allowed: true };
                            setRoutingDenied(false);
                            setOnlinePbxSettingsOpen(true);
                          }}
                          disabled={!integration.connected}
                        >
                          <Settings2 data-icon="inline-start" />
                          {t('integrationCallRouting')}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setVoiceRemindersOpen(true)}
                          disabled={!integration.connected}
                        >
                          <PhoneCall data-icon="inline-start" />
                          {t('voiceRemindersTitle')}
                        </Button>
                      </>
                    ) : integration.provider === 'telegram_tasks' && integration.externalUrl ? (
                      <Button asChild variant="outline">
                        <a href={integration.externalUrl} target="_blank" rel="noopener noreferrer">
                          <ExternalLink data-icon="inline-start" />
                          {t('telegramTasksOpenBot')}
                        </a>
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      onClick={() => openIntegrationSettings(
                        integration.siteDomain ? 'website' : integration.provider as IntegrationType,
                        integration.siteDomain,
                      )}
                    >
                      <Settings2 data-icon="inline-start" />
                      {t('integrationConfigure')}
                    </Button>
                    <Badge className="w-fit shrink-0" variant={integration.connected ? 'success' : 'warning'}>
                      {integration.connected ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5" />
                      )}
                      {integration.connected ? t('integrationConfigured') : t('integrationNeedsAttention')}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
            </Card>
          );
        })}
      </div>

      <Dialog open={integrationCatalogOpen} onOpenChange={setIntegrationCatalogOpen}>
        <DialogContent aria-describedby={undefined} className="compact-modal flex max-h-[90dvh] flex-col overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="compact-modal-header">
            <DialogTitle>{t('integrationCatalogTitle')}</DialogTitle>
          </DialogHeader>
          <div className="compact-modal-body overflow-y-auto">
          <CompactModalSection title={t('navIntegrations')} icon={Plug} tone="sky" collapsible={false} contentClassName="grid gap-2">
            {([
              ['telegram_tasks', Send], ['instagram', Camera], ['meta', RadioTower],
              ['website', Globe2], ['onlinepbx', PhoneCall],
            ] as const).map(([provider, Icon]) => (
              <Button
                key={provider}
                variant="outline"
                className="h-auto justify-start gap-3 px-4 py-3 text-left"
                onClick={() => openIntegrationSettings(provider)}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span>{integrationCopy({ provider }, t).title}</span>
              </Button>
            ))}
          </CompactModalSection>
          </div>
          <DialogFooter className="compact-modal-footer"><Button variant="outline" onClick={() => setIntegrationCatalogOpen(false)}>{t('cancel')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <IntegrationSettingsDialog
        provider={settingsProvider}
        siteDomain={settingsSiteDomain}
        onOpenChange={(open) => { if (!open) setSettingsProvider(null); }}
        onInstagramConnect={() => startInstagramConnection.mutate()}
        instagramConnectPending={startInstagramConnection.isPending}
      />

      <Dialog open={onlinePbxSettingsOpen && !routingUnavailable && routingSession.current.allowed} onOpenChange={(open) => { if (!routingSubmitLocked.current) onlinePbxGuard.handleOpenChange(open); }}>
        <DialogContent aria-describedby={undefined} className="compact-modal flex max-h-[90dvh] flex-col overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="compact-modal-header">
            <DialogTitle>{t('onlinePbxSettingsTitle')}</DialogTitle>
          </DialogHeader>

          <div className="compact-modal-body flex-1 overflow-y-auto overscroll-contain">
          {onlinePbxRouting.isLoading ? (
            <div className="flex flex-col gap-3 py-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="flex items-center gap-3 rounded-lg border p-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <Skeleton className="h-9 w-36" />
                </div>
              ))}
            </div>
          ) : onlinePbxRouting.isError && !onlinePbxRouting.data ? (
            <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{t('onlinePbxRoutingLoadFailed')}</p><Button variant="outline" disabled={onlinePbxRouting.isFetching} onClick={() => onlinePbxRouting.refetch()}>{t('retry')}</Button></div>
          ) : (
            <div className="space-y-3">
              <CompactModalSection title={t('onlinePbxManagersBlockTitle')} icon={PhoneCall} tone="sky" collapsible={false} disabled={updateOnlinePbxRouting.isPending} contentClassName="space-y-3">

                <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                  <div className="space-y-2">
                    <Label htmlFor="onlinepbx-manager">{t('onlinePbxChooseManager')}</Label>
                    <Select value={newManagerId} onValueChange={setNewManagerId} disabled={updateOnlinePbxRouting.isPending}>
                      <SelectTrigger id="onlinepbx-manager">
                        <SelectValue placeholder={t('onlinePbxChooseManager')} />
                      </SelectTrigger>
                      <SelectContent>
                        {availableManagers.map((manager) => (
                          <SelectItem key={manager.id} value={String(manager.id)} textValue={manager.fullName}>
                            <EmployeeIdentity userId={manager.id} name={manager.fullName} />
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="onlinepbx-extension">{t('onlinePbxExistingExtension')}</Label>
                    <Select value={newExtension} onValueChange={setNewExtension} disabled={updateOnlinePbxRouting.isPending}>
                      <SelectTrigger id="onlinepbx-extension">
                        <SelectValue placeholder={t('onlinePbxExistingExtension')} />
                      </SelectTrigger>
                      <SelectContent>
                        {(onlinePbxRouting.data?.extensions ?? []).map((extension) => (
                          <SelectItem
                            key={extension.extension}
                            value={extension.extension}
                            disabled={!extension.enabled}
                          >
                            {extension.extension}
                            {extension.name ? ` · ${extension.name}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    onClick={addManagerAssignment}
                    disabled={
                      !newManagerId
                      || !newExtension
                      || updateOnlinePbxRouting.isPending
                    }
                  >
                    <Plus data-icon="inline-start" />
                    {t('onlinePbxAddManager')}
                  </Button>
                </div>

                {(onlinePbxRouting.data?.extensions.length ?? 0) === 0 ? (
                  <p className="text-sm">{t('onlinePbxNoExtensionsTitle')}</p>
                ) : null}

                <div className="space-y-3">
                  {onlinePbxRoutingDraft.assignments.map((assignment) => {
                    const manager = managerById.get(assignment.managerId);
                    const status = assignmentStatusByManagerId.get(assignment.managerId);
                    const isPrimary = onlinePbxRoutingDraft.primaryManagerId === assignment.managerId;
                    return (
                      <div
                        key={assignment.managerId}
                        className="rounded-lg border bg-background p-3"
                      >
                        <div className="flex flex-col gap-4 md:flex-row md:items-center">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate font-medium">
                                <EmployeeIdentity userId={assignment.managerId} name={manager?.fullName ?? status?.fullName ?? t('unknown')} />
                              </p>
                              <Badge variant={status?.isOnline ? 'success' : 'secondary'}>
                                {status?.isOnline ? t('online') : t('offline')}
                              </Badge>
                              {isPrimary ? (
                                <Badge variant="info">{t('onlinePbxPrimaryManager')}</Badge>
                              ) : null}
                              {status && !status.isProviderEnabled ? (
                                <Badge variant="warning">
                                  {t('onlinePbxUserLicenseRequired')}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {status?.isOnline
                                ? status.isTelephonyReady
                                  ? t('onlinePbxTelephonyReady')
                                  : t('onlinePbxTelephonyNotReady')
                                : t('offline')}
                            </p>
                          </div>

                          <div className="w-full space-y-2 md:w-52">
                            <Label htmlFor={`onlinepbx-extension-${assignment.managerId}`}>
                              {t('onlinePbxExistingExtension')}
                            </Label>
                            <Select
                              disabled={updateOnlinePbxRouting.isPending}
                              value={assignment.extension}
                              onValueChange={(extension) => {
                                setOnlinePbxRoutingDraft((current) => ({
                                  ...current,
                                  assignments: current.assignments.map((item) => (
                                    item.managerId === assignment.managerId
                                      ? { ...item, extension }
                                      : item
                                  )),
                                }));
                              }}
                            >
                              <SelectTrigger id={`onlinepbx-extension-${assignment.managerId}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(onlinePbxRouting.data?.extensions ?? []).map((extension) => (
                                  <SelectItem
                                    key={extension.extension}
                                    value={extension.extension}
                                    disabled={!extension.enabled}
                                  >
                                    {extension.extension}
                                    {extension.name ? ` · ${extension.name}` : ''}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="flex items-center gap-2 md:self-end">
                            <Button
                              type="button"
                              size="sm"
                              variant={isPrimary ? 'secondary' : 'outline'}
                              onClick={() => {
                                setOnlinePbxRoutingDraft((current) => ({
                                  ...current,
                                  primaryManagerId: assignment.managerId,
                                }));
                              }}
                              disabled={isPrimary || updateOnlinePbxRouting.isPending}
                            >
                              <Star data-icon="inline-start" />
                              {t('onlinePbxMakePrimary')}
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              aria-label={t('onlinePbxRemoveManager')}
                              onClick={() => {
                                setRemoveManagerTarget({
                                  managerId: assignment.managerId,
                                  fullName: manager?.fullName ?? status?.fullName ?? '',
                                });
                              }}
                              disabled={updateOnlinePbxRouting.isPending}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {onlinePbxRoutingDraft.assignments.length === 0 ? (
                  <p className="text-sm">{t('onlinePbxNoAssignments')}</p>
                ) : null}

              </CompactModalSection>
              <CompactModalSection title={t('onlinePbxForwardingTitle')} icon={PhoneForwarded} tone="teal" defaultOpen disabled={updateOnlinePbxRouting.isPending} contentClassName="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <Label htmlFor="onlinepbx-forwarding-enabled">{t('onlinePbxForwardingEnabled')}</Label>
                    <Switch
                      id="onlinepbx-forwarding-enabled"
                      disabled={updateOnlinePbxRouting.isPending}
                      checked={onlinePbxRoutingDraft.forwarding.enabled}
                      onCheckedChange={(enabled) => {
                        setOnlinePbxRoutingDraft((current) => ({
                          ...current,
                          forwarding: { ...current.forwarding, enabled },
                        }));
                      }}
                      aria-label={t('onlinePbxForwardingEnabled')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="onlinepbx-forwarding-phone">
                      {t('onlinePbxForwardingPhone')}
                    </Label>
                    <PhoneInput
                      id="onlinepbx-forwarding-phone"
                      value={onlinePbxRoutingDraft.forwarding.phone}
                      onValueChange={(phone) => {
                        setOnlinePbxRoutingDraft((current) => ({
                          ...current,
                          forwarding: {
                            ...current.forwarding,
                            phone,
                          },
                        }));
                      }}
                    />
                  </div>
              </CompactModalSection>
            </div>
          )}
          </div>

          <DialogFooter className="compact-modal-footer">
            <Button
              type="button"
              variant="outline"
              onClick={() => { if (!routingSubmitLocked.current) onlinePbxGuard.handleOpenChange(false); }}
              disabled={updateOnlinePbxRouting.isPending}
            >
              {t('close')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!routingSession.current.allowed || updateOnlinePbxRouting.isPending || routingSubmitLocked.current) return;
                routingSubmitLocked.current = true;
                updateOnlinePbxRouting.mutate({ settings: onlinePbxRoutingDraft, epoch: routingSession.current.epoch });
              }}
              disabled={
                !onlinePbxIntegration?.connected
                || onlinePbxRouting.isLoading
                || onlinePbxRouting.isError
                || updateOnlinePbxRouting.isPending
                || !routingSettingsChanged
                || (
                  onlinePbxRoutingDraft.forwarding.enabled
                  && !onlinePbxRoutingDraft.forwarding.phone.trim()
                )
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

      <VoiceRemindersDialog open={voiceRemindersOpen} onOpenChange={setVoiceRemindersOpen} />

      <ConfirmDialog
        open={Boolean(removeManagerTarget) && !routingUnavailable}
        onOpenChange={(open) => !open && setRemoveManagerTarget(null)}
        title={t('onlinePbxRemoveManagerTitle')}
        description={removeManagerTarget
          ? `${t('onlinePbxRemoveManagerDescription')} ${removeManagerTarget.fullName}`
          : t('onlinePbxRemoveManagerDescription')}
        confirmLabel={t('onlinePbxRemoveManager')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          if (removeManagerTarget) {
            removeManagerAssignment(removeManagerTarget.managerId);
          }
        }}
        variant="destructive"
        compact
      />

      <UnsavedChangesDialog
        open={onlinePbxGuard.confirmationOpen && !routingUnavailable}
        onOpenChange={onlinePbxGuard.setConfirmationOpen}
        onDiscard={onlinePbxGuard.discardChanges}
      />

      <ConfirmDialog
        open={Boolean(instagramDisconnectTarget)}
        onOpenChange={(open) => { if (!open && !disconnectInstagram.isPending && !instagramDisconnectLocked.current) setInstagramDisconnectTarget(null); }}
        isPending={disconnectInstagram.isPending}
        keepOpenOnConfirm
        title={t('disconnectInstagramTitle')}
        description={instagramDisconnectTarget?.username
          ? `${t('disconnectInstagramDescription')} @${instagramDisconnectTarget.username}`
          : t('disconnectInstagramDescription')}
        confirmLabel={t('disconnectInstagram')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          if (instagramDisconnectTarget && !disconnectInstagram.isPending && !instagramDisconnectLocked.current) {
            instagramDisconnectLocked.current = true;
            disconnectInstagram.mutate(instagramDisconnectTarget.id);
          }
        }}
        variant="destructive"
        compact
      />
    </ModulePage>
  );
}
