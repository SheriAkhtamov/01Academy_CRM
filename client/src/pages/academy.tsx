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
import {
  AlertCircle,
  Camera,
  Download,
  ExternalLink,
  Plus,
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

  const sourceForm = useForm<SourceFormValues>({
    resolver: zodResolver(sourceSchema),
    defaultValues: sourceDefaults,
  });

  const sourcesQuery = useQuery<LeadSource[]>({
    queryKey: ['/api/academy/sources'],
    enabled: section === 'settings',
  });

  useEffect(() => {
    if (section !== 'integrations') return;
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
  }, [section, t]);

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

  if (section === 'settings' && sourcesQuery.isLoading) {
    return <PageSkeleton />;
  }

  const renderError = () => (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>{t('error')}</AlertTitle>
      <AlertDescription>{t('failedToLoadData')}</AlertDescription>
    </Alert>
  );

  const renderIntegrations = () => (
    <Card>
      <CardHeader>
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
            disabled={startInstagramConnection.isPending}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            {t('loginWithInstagram')}
          </Button>
        </div>
      </CardHeader>
    </Card>
  );

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
    </div>
  );
}
