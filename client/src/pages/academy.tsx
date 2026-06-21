import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/ux/PageHeader';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  MessageCircle,
  Plus,
  RefreshCw,
  Send,
  Unplug,
} from 'lucide-react';

type AcademySection = 'integrations' | 'settings';

interface AcademyPageProps {
  section: AcademySection;
}

interface LeadSource {
  id: number;
  code: string;
  name: string;
  channel?: string | null;
  isActive?: boolean | null;
}

interface IntegrationStatus {
  provider: string;
  mode: 'live' | 'stub';
  connected: boolean;
  message: string;
  lastLog?: {
    status?: string | null;
    errorMessage?: string | null;
    updatedAt?: string | null;
    createdAt?: string | null;
  } | null;
}

interface InstagramIntegrationConfig {
  configured: boolean;
  appIdConfigured: boolean;
  appSecretConfigured: boolean;
  verifyTokenConfigured: boolean;
  apiVersion: string;
  redirectUri: string;
  webhookUrl: string;
  scopes: string[];
  webhookFields: string[];
}

interface InstagramAccount {
  id: number;
  igUserId: string;
  username: string;
  displayName?: string | null;
  profilePictureUrl?: string | null;
  tokenExpiresAt?: string | null;
  sourceId: number;
  sourceName: string;
  status: string;
  lastWebhookAt?: string | null;
  lastError?: string | null;
  conversationCount: number;
  leadCount: number;
}

const sourceSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim(),
  channel: z.string().trim(),
});

type SourceFormValues = z.infer<typeof sourceSchema>;

const sourceDefaults: SourceFormValues = {
  name: '',
  code: '',
  channel: 'custom',
};

function PageSkeleton() {
  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-40" />
        ))}
      </div>
    </div>
  );
}

export default function AcademyPage({ section }: AcademyPageProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [instagramAccountToDisconnect, setInstagramAccountToDisconnect] = useState<InstagramAccount | null>(null);

  const sourceForm = useForm<SourceFormValues>({
    resolver: zodResolver(sourceSchema),
    defaultValues: sourceDefaults,
  });

  const sourcesQuery = useQuery<LeadSource[]>({
    queryKey: ['/api/academy/sources'],
    enabled: section === 'settings',
  });

  const integrationsQuery = useQuery<IntegrationStatus[]>({
    queryKey: ['/api/academy/integrations/status'],
    enabled: section === 'integrations',
  });

  const instagramConfigQuery = useQuery<InstagramIntegrationConfig>({
    queryKey: ['/api/instagram/config'],
    enabled: section === 'integrations',
  });

  const instagramAccountsQuery = useQuery<InstagramAccount[]>({
    queryKey: ['/api/instagram/accounts'],
    enabled: section === 'integrations',
  });

  useEffect(() => {
    if (section !== 'integrations') return;
    const params = new URLSearchParams(window.location.search);
    const result = params.get('instagram');
    if (!result) return;

    if (result === 'connected') {
      toast({ title: t('instagramConnected') });
      queryClient.invalidateQueries({ queryKey: ['/api/instagram/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/academy/integrations/status'] });
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
  }, [queryClient, section, t]);

  const createSource = useMutation({
    mutationFn: (values: SourceFormValues) => apiRequest('POST', '/api/academy/sources', {
      name: values.name.trim(),
      code: values.code.trim() || `custom_${Date.now()}`,
      channel: values.channel.trim() || 'custom',
      isActive: true,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/academy/sources'] });
      sourceForm.reset(sourceDefaults);
      setSourceDialogOpen(false);
      toast({ title: t('sourceCreated') });
    },
    onError: (error: Error) => {
      toast({
        title: t('error'),
        description: error.message || t('failedToCreateResource'),
        variant: 'destructive',
      });
    },
  });

  const testIntegration = useMutation({
    mutationFn: (provider: string) =>
      apiRequest('POST', `/api/academy/integrations/${provider}/test`, { test: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/academy/integrations/status'] });
      toast({ title: t('integrationTestLogged') });
    },
    onError: (error: Error) => {
      toast({ title: t('error'), description: error.message, variant: 'destructive' });
    },
  });

  const startInstagramConnection = useMutation({
    mutationFn: () => apiRequest('POST', '/api/instagram/oauth/start'),
    onSuccess: (result) => {
      window.location.assign(result.url);
    },
    onError: (error: Error) => {
      toast({
        title: t('instagramConnectionFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const disconnectInstagram = useMutation({
    mutationFn: (accountId: number) => apiRequest('DELETE', `/api/instagram/accounts/${accountId}`),
    onSuccess: () => {
      setInstagramAccountToDisconnect(null);
      queryClient.invalidateQueries({ queryKey: ['/api/instagram/accounts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/academy/integrations/status'] });
      toast({ title: t('instagramDisconnected') });
    },
    onError: (error: Error) => {
      toast({
        title: t('instagramDisconnectFailed'),
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const sendWeeklyReport = useMutation({
    mutationFn: () =>
      apiRequest('POST', '/api/academy/reports/weekly/test', { recipient: 'leadership' }),
    onSuccess: (result) => {
      toast({
        title: t('testReportCreated'),
        description: result.preview?.split('\n')[0],
      });
    },
    onError: (error: Error) => {
      toast({ title: t('error'), description: error.message, variant: 'destructive' });
    },
  });

  const isPageLoading = section === 'integrations'
    ? integrationsQuery.isLoading || instagramConfigQuery.isLoading || instagramAccountsQuery.isLoading
    : sourcesQuery.isLoading;

  if (isPageLoading) {
    return <PageSkeleton />;
  }

  const renderError = () => (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>{t('error')}</AlertTitle>
      <AlertDescription>{t('failedToLoadData')}</AlertDescription>
    </Alert>
  );

  const renderIntegrations = () => {
    if (
      integrationsQuery.isError
      || instagramConfigQuery.isError
      || instagramAccountsQuery.isError
    ) return renderError();
    const integrations = (integrationsQuery.data ?? []).filter(
      (integration) => integration.provider !== 'instagram' && integration.provider !== 'chatplace',
    );
    const instagramConfig = instagramConfigQuery.data;
    const instagramAccounts = instagramAccountsQuery.data ?? [];

    return (
      <div className="space-y-5">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-border/70">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Camera className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <CardTitle>{t('instagramIntegration')}</CardTitle>
                  <p className="mt-1 text-sm text-slate-500">{t('instagramIntegrationDesc')}</p>
                </div>
              </div>
              <Button
                onClick={() => startInstagramConnection.mutate()}
                disabled={!instagramConfig?.configured || startInstagramConnection.isPending}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                {t('loginWithInstagram')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 p-5">
            {!instagramConfig?.configured ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t('instagramSetupRequired')}</AlertTitle>
                <AlertDescription>{t('instagramSetupRequiredDesc')}</AlertDescription>
              </Alert>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>{t('instagramApiConfigured')} · {instagramConfig.apiVersion}</span>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {[
                { label: t('instagramOAuthRedirect'), value: instagramConfig?.redirectUri },
                { label: t('instagramWebhookCallback'), value: instagramConfig?.webhookUrl },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-border/70 bg-muted/30 p-4">
                  <p className="text-xs font-medium text-slate-500">{item.label}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate text-xs text-slate-700">{item.value || t('noData')}</code>
                    {item.value ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 shrink-0 p-0"
                        onClick={() => {
                          navigator.clipboard.writeText(item.value!);
                          toast({ title: t('copiedToClipboard') });
                        }}
                        aria-label={t('copy')}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            {instagramAccounts.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center">
                <MessageCircle className="mx-auto h-9 w-9 text-slate-400" />
                <p className="mt-3 font-medium text-slate-900">{t('noInstagramAccounts')}</p>
                <p className="mt-1 text-sm text-slate-500">{t('noInstagramAccountsDesc')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {instagramAccounts.map((account) => (
                  <div key={account.id} className="rounded-xl border border-border/70 p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Camera className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-semibold text-slate-900">@{account.username}</p>
                          <Badge variant={account.status === 'connected' ? 'default' : 'secondary'}>
                            {account.status === 'connected' ? t('connected') : t('disconnected')}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {t('source')}: {account.sourceName}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span>{t('instagramDialogs')}: {account.conversationCount}</span>
                          <span>{t('navLeads')}: {account.leadCount}</span>
                          <span>
                            {t('tokenValidUntil')}: {account.tokenExpiresAt
                              ? new Date(account.tokenExpiresAt).toLocaleDateString()
                              : t('noData')}
                          </span>
                        </div>
                        {account.lastError ? (
                          <p className="mt-2 line-clamp-2 text-xs text-red-600">{account.lastError}</p>
                        ) : null}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-red-600 hover:text-red-700"
                        onClick={() => setInstagramAccountToDisconnect(account)}
                        aria-label={t('disconnectInstagram')}
                      >
                        <Unplug className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle>{t('otherIntegrations')} · {t('integrationStatus')}</CardTitle>
            <Button
              variant="outline"
              onClick={() => sendWeeklyReport.mutate()}
              disabled={sendWeeklyReport.isPending}
            >
              <Send className="mr-2 h-4 w-4" />
              {t('testWeeklyReport')}
            </Button>
          </CardHeader>
          <CardContent>
            {integrations.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500">{t('noData')}</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {integrations.map((integration) => (
                  <div
                    key={integration.provider}
                    className="rounded-xl border border-border/70 p-4 transition-shadow hover:shadow-md"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <strong className="truncate text-slate-900">{integration.provider}</strong>
                      <Badge variant={integration.connected ? 'default' : 'secondary'}>
                        {integration.connected ? t('activeBadge') : t('integrationStubMode')}
                      </Badge>
                    </div>
                    <p className="mt-2 min-h-12 text-xs leading-relaxed text-slate-500">
                      {integration.message}
                    </p>
                    {integration.lastLog?.status && (
                      <p className="mt-2 truncate text-xs text-slate-400">
                        {t('status')}: {integration.lastLog.status}
                      </p>
                    )}
                    <Button
                      className="mt-3 w-full"
                      variant="outline"
                      size="sm"
                      onClick={() => testIntegration.mutate(integration.provider)}
                      disabled={testIntegration.isPending}
                    >
                      <RefreshCw className="mr-2 h-3 w-3" />
                      {t('test')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderSourcesCard = () => {
    const sources = sourcesQuery.data ?? [];
    return (
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>{t('leadSources')}</CardTitle>
            <p className="mt-1 text-sm text-slate-500">{t('integrationLeadSourcesDesc')}</p>
          </div>
          <Button variant="outline" onClick={() => setSourceDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('addSource')}
          </Button>
        </CardHeader>
        <CardContent>
          {sources.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">{t('noData')}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {sources.map((source) => (
                <div
                  key={source.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/70 p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{source.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {source.code} • {source.channel || t('noChannel')}
                    </p>
                  </div>
                  <Badge variant={source.isActive ? 'default' : 'secondary'}>
                    {source.isActive ? t('activeBadge') : t('inactiveBadge')}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderSettings = () => {
    if (sourcesQuery.isError) return renderError();

    return (
      <div className="space-y-5">
        {renderSourcesCard()}

        <Card>
          <CardHeader>
            <CardTitle>{t('exportLabel')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {[
              { code: 'leads', label: t('navLeads') },
              { code: 'students', label: t('students') },
              { code: 'payments', label: t('navPayments') },
              { code: 'attendance', label: t('attendanceLabel') },
              { code: 'surveys', label: t('studentLessonRatings') },
              { code: 'marketing', label: t('marketingTab') },
            ].map((entity) => (
              <a
                key={entity.code}
                href={`/api/academy/exports/${entity.code}`}
                target="_blank"
                rel="noreferrer"
              >
                <Button variant="outline">
                  <Download className="mr-2 h-4 w-4" />
                  {entity.label}.csv
                </Button>
              </a>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title={section === 'integrations' ? t('navIntegrations') : t('settings')}
        subtitle={t('academyDescription')}
        breadcrumbs={[{
          label: section === 'integrations' ? t('navIntegrations') : t('settings'),
        }]}
      />

      <div className="mt-6">
        {section === 'integrations' ? renderIntegrations() : renderSettings()}
      </div>

      <Dialog
        open={sourceDialogOpen}
        onOpenChange={(open) => {
          setSourceDialogOpen(open);
          if (!open) sourceForm.reset(sourceDefaults);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('addSource')}</DialogTitle>
            <DialogDescription className="sr-only">{t('leadSources')}</DialogDescription>
          </DialogHeader>
          <Form {...sourceForm}>
            <form
              className="grid grid-cols-1 gap-3"
              onSubmit={sourceForm.handleSubmit((values) => createSource.mutate(values))}
            >
              <FormField
                control={sourceForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-slate-500">{t('sourceFormName')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={sourceForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-slate-500">{t('code')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={sourceForm.control}
                name="channel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs text-slate-500">{t('channel')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setSourceDialogOpen(false)}>
                  {t('cancel')}
                </Button>
                <Button type="submit" disabled={createSource.isPending}>
                  {createSource.isPending ? t('saving') : t('addSource')}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(instagramAccountToDisconnect)}
        onOpenChange={(open) => {
          if (!open) setInstagramAccountToDisconnect(null);
        }}
        title={t('disconnectInstagram')}
        description={t('disconnectInstagramDesc')}
        confirmLabel={t('disconnect')}
        variant="destructive"
        onConfirm={() => {
          if (instagramAccountToDisconnect) {
            disconnectInstagram.mutate(instagramAccountToDisconnect.id);
          }
        }}
      />
    </div>
  );
}
