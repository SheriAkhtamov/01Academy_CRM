import { useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ux/PageHeader';
import {
  Camera,
  ExternalLink,
} from 'lucide-react';

type AcademySection = 'integrations';

interface AcademyPageProps {
  section: AcademySection;
}

export default function AcademyPage({ section }: AcademyPageProps) {
  const { t } = useTranslation();

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

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader
        title={section === 'integrations' ? t('navIntegrations') : t('navIntegrations')}
        subtitle={t('academyDescription')}
        breadcrumbs={[{ label: t('navIntegrations') }]}
      />

      <div className="mt-6">
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
      </div>
    </div>
  );
}
