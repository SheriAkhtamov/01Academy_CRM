import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { AUTH_SESSION_QUERY_KEY } from '@shared/auth';
import type { TranslationKey } from '@/lib/i18n';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { PageHeader } from '@/components/ux/PageHeader';
import { ModulePage, ModulePageBody } from '@/components/ux/ModulePage';
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
  Settings2,
  Star,
  Trash2,
  Unplug,
  Users,
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
  }, [
    onlinePbxSettingsOpen,
    onlinePbxRouting.data?.primaryManagerId,
    onlinePbxRouting.data?.assignments,
    onlinePbxRouting.data?.extensions,
    onlinePbxRouting.data?.forwarding,
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

  const updateOnlinePbxRouting = useMutation({
    mutationFn: (settings: OnlinePbxRoutingDraft) =>
      apiRequest('PUT', '/api/telephony/routing', settings) as Promise<OnlinePbxRoutingSettings>,
    onSuccess: (settings) => {
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
    <ModulePage contained>
      <PageHeader
        title={section === 'integrations' ? t('navIntegrations') : t('navIntegrations')}
        subtitle={t('academyDescription')}
        breadcrumbs={[{ label: t('navIntegrations') }]}
      />

      <ModulePageBody contained ariaLabel={t('navIntegrations')} className="space-y-3">
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
      </ModulePageBody>

      <Dialog open={onlinePbxSettingsOpen} onOpenChange={setOnlinePbxSettingsOpen}>
        <DialogContent className="overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('onlinePbxSettingsTitle')}</DialogTitle>
            <DialogDescription>{t('onlinePbxSettingsDescription')}</DialogDescription>
          </DialogHeader>

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
          ) : onlinePbxRouting.isError ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>{t('onlinePbxRoutingLoadFailed')}</AlertTitle>
              <AlertDescription>{t('onlinePbxRoutingLoadFailedDescription')}</AlertDescription>
            </Alert>
          ) : (
            <ScrollArea className="max-h-[68vh] pr-4">
              <div className="flex flex-col gap-3">
                <Alert>
                  <Users />
                  <AlertTitle>{t('onlinePbxManagersBlockTitle')}</AlertTitle>
                  <AlertDescription>
                    {t('onlinePbxRoutingDescription').replace(
                      '{seconds}',
                      String(onlinePbxRouting.data?.ringDelaySeconds ?? 3),
                    )}
                  </AlertDescription>
                </Alert>

                <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                  <div className="space-y-2">
                    <Label htmlFor="onlinepbx-manager">{t('onlinePbxChooseManager')}</Label>
                    <Select value={newManagerId} onValueChange={setNewManagerId}>
                      <SelectTrigger id="onlinepbx-manager">
                        <SelectValue placeholder={t('onlinePbxChooseManager')} />
                      </SelectTrigger>
                      <SelectContent>
                        {availableManagers.map((manager) => (
                          <SelectItem key={manager.id} value={String(manager.id)}>
                            {manager.fullName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="onlinepbx-extension">{t('onlinePbxExistingExtension')}</Label>
                    <Select value={newExtension} onValueChange={setNewExtension}>
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
                  <Alert variant="destructive">
                    <AlertCircle />
                    <AlertTitle>{t('onlinePbxNoExtensionsTitle')}</AlertTitle>
                    <AlertDescription>{t('onlinePbxNoExtensionsDescription')}</AlertDescription>
                  </Alert>
                ) : null}

                <div className="space-y-3">
                  {onlinePbxRoutingDraft.assignments.map((assignment) => {
                    const manager = managerById.get(assignment.managerId);
                    const status = assignmentStatusByManagerId.get(assignment.managerId);
                    const isPrimary = onlinePbxRoutingDraft.primaryManagerId === assignment.managerId;
                    return (
                      <div
                        key={assignment.managerId}
                        className="rounded-xl border bg-background p-4"
                      >
                        <div className="flex flex-col gap-4 md:flex-row md:items-center">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate font-medium">
                                {manager?.fullName ?? status?.fullName ?? `#${assignment.managerId}`}
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
                                : t('onlinePbxOfflineExcluded')}
                            </p>
                          </div>

                          <div className="w-full space-y-2 md:w-52">
                            <Label htmlFor={`onlinepbx-extension-${assignment.managerId}`}>
                              {t('onlinePbxExistingExtension')}
                            </Label>
                            <Select
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
                  <Alert>
                    <AlertCircle />
                    <AlertTitle>{t('onlinePbxNoAssignments')}</AlertTitle>
                    <AlertDescription>{t('onlinePbxNoAssignmentsDescription')}</AlertDescription>
                  </Alert>
                ) : null}

                <Separator className="my-2" />

                <section className="space-y-4 rounded-xl border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="flex items-center gap-2 font-semibold">
                        <PhoneForwarded className="size-4" />
                        {t('onlinePbxForwardingTitle')}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t('onlinePbxForwardingDescription')}
                      </p>
                    </div>
                    <Switch
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
                    <Input
                      id="onlinepbx-forwarding-phone"
                      type="tel"
                      inputMode="tel"
                      value={onlinePbxRoutingDraft.forwarding.phone}
                      onChange={(event) => {
                        setOnlinePbxRoutingDraft((current) => ({
                          ...current,
                          forwarding: {
                            ...current.forwarding,
                            phone: event.target.value,
                          },
                        }));
                      }}
                      placeholder="+998 90 123 45 67"
                    />
                    <p className="text-xs text-muted-foreground">
                      {onlinePbxRoutingDraft.forwarding.enabled
                        ? t('onlinePbxForwardingOnHint')
                        : t('onlinePbxForwardingOffHint')}
                    </p>
                  </div>
                </section>
              </div>
            </ScrollArea>
          )}

          <DialogFooter>
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

      <ConfirmDialog
        open={Boolean(removeManagerTarget)}
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
      />

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
    </ModulePage>
  );
}
