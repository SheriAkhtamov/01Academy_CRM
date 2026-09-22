import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';
import { getIntegrationSettings, saveIntegrationSettings, type IntegrationType, type SafeIntegrationSettings } from '@/features/integrations/api';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { queryClient } from '@/lib/queryClient';

type Field = { name: string; label: string; secret?: boolean; required?: boolean };

const integrationFields = (t: (key: TranslationKey) => string): Record<IntegrationType, Field[]> => ({
  telegram_tasks: [
    { name: 'botToken', label: t('integrationBotToken'), secret: true },
    { name: 'openRouterApiKey', label: t('integrationAgentKey'), secret: true },
    { name: 'agentModel', label: t('integrationAgentModel') },
  ],
  website: [{ name: 'domain', label: t('integrationWebsiteDomain'), required: true }],
  instagram: [
    { name: 'appId', label: t('integrationInstagramAppId'), required: true },
    { name: 'appSecret', label: t('integrationInstagramAppSecret'), secret: true },
    { name: 'verifyToken', label: t('integrationVerifyToken'), secret: true },
    { name: 'apiVersion', label: t('metaApiVersion') },
  ],
  meta: [
    { name: 'adAccountId', label: t('metaAdAccountId'), required: true },
    { name: 'businessId', label: t('integrationBusinessId') },
    { name: 'datasetId', label: t('integrationDatasetId'), required: true },
    { name: 'pageId', label: t('integrationPageId'), required: true },
    { name: 'marketingAccessToken', label: t('integrationMarketingToken'), secret: true },
    { name: 'capiAccessToken', label: t('integrationCapiToken'), secret: true },
    { name: 'leadAccessToken', label: t('integrationLeadToken'), secret: true },
    { name: 'webhookAppSecret', label: t('integrationInstagramAppSecret'), secret: true },
    { name: 'leadWebhookVerifyToken', label: t('integrationVerifyToken'), secret: true },
    { name: 'apiVersion', label: t('metaApiVersion') },
    { name: 'usdToUzsRate', label: t('integrationUsdRate') },
  ],
  onlinepbx: [
    { name: 'domain', label: t('integrationPbxDomain'), required: true },
    { name: 'authKey', label: t('integrationPbxAuthKey'), secret: true },
    { name: 'webhookSecret', label: t('integrationPbxWebhookSecret'), secret: true },
  ],
});

const requiredSecrets = new Set([
  'botToken', 'appSecret', 'verifyToken', 'marketingAccessToken',
  'capiAccessToken', 'leadAccessToken', 'webhookAppSecret',
  'leadWebhookVerifyToken', 'authKey', 'webhookSecret',
]);

export function IntegrationSettingsDialog({
  provider, siteDomain, onOpenChange, onInstagramConnect,
}: {
  provider: IntegrationType | null;
  siteDomain?: string | null;
  onOpenChange: (open: boolean) => void;
  onInstagramConnect: () => void;
}) {
  const { t } = useTranslation();
  const fields = useMemo(() => integrationFields(t), [t]);
  const titles: Record<IntegrationType, string> = {
    telegram_tasks: t('telegramTasksIntegration'), website: t('integrationProviderWebsite'),
    instagram: t('instagramIntegration'), meta: t('metaIntegration'), onlinepbx: t('onlinePbxIntegration'),
  };
  const instructions: Record<IntegrationType, string> = {
    telegram_tasks: t('integrationTelegramSteps'), website: t('integrationWebsiteSteps'),
    instagram: t('integrationInstagramSteps'), meta: t('integrationMetaSteps'), onlinepbx: t('integrationPbxSteps'),
  };
  const [draft, setDraft] = useState<Record<string, string>>({});
  const settings = useQuery<SafeIntegrationSettings>({
    queryKey: ['/api/academy/integrations/settings', provider],
    queryFn: () => getIntegrationSettings(provider!),
    enabled: Boolean(provider),
  });
  useEffect(() => {
    if (!provider || !settings.data) return;
    setDraft(Object.fromEntries(fields[provider].map((field) => [
      field.name,
      field.secret ? '' : field.name === 'domain' && provider === 'website'
        ? siteDomain ?? ''
        : String(settings.data?.[field.name] ?? ''),
    ])));
  }, [provider, settings.data, siteDomain, fields]);

  const save = useMutation({
    mutationFn: () => saveIntegrationSettings(provider!, draft),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['/api/academy/integrations/status'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/academy/integrations/settings', provider] });
      toast({ title: t('integrationSaved') });
      if (provider !== 'instagram') onOpenChange(false);
    },
    onError: (error: Error) => toast({
      title: t('integrationSaveFailed'), description: error.message, variant: 'destructive',
    }),
  });

  if (!provider) return null;
  const safe = settings.data;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{titles[provider]}</DialogTitle>
          <DialogDescription>{instructions[provider]}</DialogDescription>
        </DialogHeader>
        {settings.isLoading ? <Skeleton className="h-48 w-full" /> : settings.isError ? (
          <Button variant="outline" onClick={() => settings.refetch()}>{t('retry')}</Button>
        ) : (
          <form onSubmit={(event) => { event.preventDefault(); save.mutate(); }} className="space-y-4">
            {fields[provider].map((field) => (
              <div key={field.name} className="space-y-1.5">
                <Label htmlFor={`integration-${field.name}`}>{field.label}</Label>
                <Input
                  id={`integration-${field.name}`}
                  type={field.secret ? 'password' : field.name === 'usdToUzsRate' ? 'number' : 'text'}
                  min={field.name === 'usdToUzsRate' ? 0 : undefined}
                  step={field.name === 'usdToUzsRate' ? 'any' : undefined}
                  autoComplete="off"
                  value={draft[field.name] ?? ''}
                  onChange={(event) => setDraft((current) => ({ ...current, [field.name]: event.target.value }))}
                  placeholder={field.secret && safe?.[`${field.name}Configured`] ? t('integrationKeepSecret') : undefined}
                  required={field.required || (field.secret && requiredSecrets.has(field.name)
                    && !safe?.[`${field.name}Configured`])}
                />
              </div>
            ))}
            {provider === 'website' && safe?.endpoint ? (
              <div className="space-y-2 rounded-lg border p-3 text-sm">
                <p className="font-medium">{t('integrationWebsiteEndpoint')}</p>
                <p className="break-all select-all">{safe.endpoint}</p>
                <p className="text-muted-foreground">{t('integrationWebsiteFields')}</p>
              </div>
            ) : null}
            {provider === 'instagram' && safe ? (
              <div className="space-y-2 rounded-lg border p-3 text-sm">
                <p>{t('integrationCallbackUrl')}: <span className="break-all select-all">{safe.callbackUrl}</span></p>
                <p>{t('integrationWebhookUrl')}: <span className="break-all select-all">{safe.webhookUrl}</span></p>
              </div>
            ) : null}
            {provider === 'meta' && safe?.webhookUrl ? (
              <div className="rounded-lg border p-3 text-sm">
                {t('integrationWebhookUrl')}: <span className="break-all select-all">{safe.webhookUrl}</span>
              </div>
            ) : null}
            {provider === 'onlinepbx' && safe?.webhookUrl ? (
              <div className="space-y-2 rounded-lg border p-3 text-sm">
                <p>{t('integrationWebhookUrl')}: <span className="break-all select-all">{safe.webhookUrl}</span></p>
                <p className="text-muted-foreground">{t('integrationPbxWebhookSteps')}</p>
              </div>
            ) : null}
            <DialogFooter className="gap-2">
              {provider === 'instagram' && safe?.appSecretConfigured ? (
                <Button type="button" variant="outline" onClick={onInstagramConnect}>
                  {t('loginWithInstagram')}
                </Button>
              ) : null}
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Loader2 className="animate-spin" data-icon="inline-start" />}
                {t('save')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
