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
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/ux/PageHeader';
import { WorkspacePage, WorkspacePageBody } from '@/components/ux/WorkspacePage';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  ExternalLink,
  Globe2,
  Plug,
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

const integrationCopy = (provider: string, t: (key: TranslationKey) => string) => {
  switch (provider) {
    case 'instagram':
      return { title: t('instagramIntegration'), description: t('instagramIntegrationDesc') };
    case 'website':
      return { title: t('integrationProviderWebsite'), description: t('integrationProviderWebsiteDesc') };
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

  const integrations = useQuery<IntegrationStatus[]>({
    queryKey: ['/api/academy/integrations/status'],
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
          const Icon = integration.provider === 'website' ? Globe2 : integration.provider === 'instagram' ? Camera : Plug;

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
