import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { KeyRound, Link2, Loader2, Settings2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialogBody, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CompactModalSection } from '@/components/ux/CompactModalSection';
import { UnsavedChangesDialog, useUnsavedChangesGuard } from '@/components/ux/UnsavedChangesGuard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';
import { getIntegrationSettings, issueWebsiteToken, saveIntegrationSettings, type IntegrationType, type SafeIntegrationSettings } from '@/features/integrations/api';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/lib/i18n';
import { queryClient } from '@/lib/queryClient';

type Field = { name: string; label: string; secret?: boolean; required?: boolean };

const integrationFields = (t: (key: TranslationKey) => string): Record<IntegrationType, Field[]> => ({
  telegram_marketing: [
    { name: 'botToken', label: t('integrationBotToken'), secret: true },
    { name: 'accessPassword', label: t('telegramMarketingPassword'), secret: true },
  ],
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

const accessUnavailable = (error: unknown) => {
  const status = (error as { status?: number } | null)?.status;
  return status === 403 || status === 404;
};

const requiredSecrets = new Set([
  'accessPassword', 'botToken', 'appSecret', 'verifyToken', 'marketingAccessToken',
  'capiAccessToken', 'leadAccessToken', 'webhookAppSecret',
  'leadWebhookVerifyToken', 'authKey', 'webhookSecret',
]);

interface IntegrationSettingsDialogProps {
  provider: IntegrationType | null;
  siteDomain?: string | null;
  onOpenChange: (open: boolean) => void;
  onInstagramConnect: () => void;
  instagramConnectPending?: boolean;
}

export function IntegrationSettingsDialog(props: IntegrationSettingsDialogProps) {
  return props.provider ? (
    <IntegrationSettingsForm key={`${props.provider}:${props.siteDomain ?? ''}`} {...props} provider={props.provider} />
  ) : null;
}

function IntegrationSettingsForm({
  provider, siteDomain, onOpenChange, onInstagramConnect, instagramConnectPending = false,
}: Omit<IntegrationSettingsDialogProps, 'provider'> & { provider: IntegrationType }) {
  const { t } = useTranslation();
  const fields = useMemo(() => integrationFields(t), [t]);
  const titles: Record<IntegrationType, string> = {
    telegram_marketing: t('telegramMarketingIntegration'),
    telegram_tasks: t('telegramTasksIntegration'), website: t('integrationProviderWebsite'),
    instagram: t('instagramIntegration'), meta: t('metaIntegration'), onlinepbx: t('onlinePbxIntegration'),
  };
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [issuedToken, setIssuedToken] = useState('');
  const [issuedDomain, setIssuedDomain] = useState('');
  const [rotateConfirmOpen, setRotateConfirmOpen] = useState(false);
  const [additionalOpen, setAdditionalOpen] = useState(false);
  const initialized = useRef(false);
  const active = useRef(true);
  const allowed = useRef(true);
  const notified = useRef(false);
  const [revoked, setRevoked] = useState(false);
  const requestLocked = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const settings = useQuery<SafeIntegrationSettings>({
    queryKey: ['/api/academy/integrations/settings', provider],
    queryFn: () => getIntegrationSettings(provider),
  });
  const unavailable = revoked || accessUnavailable(settings.error);
  if (unavailable) allowed.current = false;
  useEffect(() => {
    if (!unavailable || notified.current) return;
    notified.current = true;
    setDraft({});
    setBaseline({});
    setIssuedToken('');
    setIssuedDomain('');
    setRotateConfirmOpen(false);
    onOpenChange(false);
  }, [unavailable, onOpenChange]);
  useEffect(() => {
    if (!allowed.current || !settings.data || initialized.current) return;
    initialized.current = true;
    const initial = Object.fromEntries(fields[provider].map((field) => [
      field.name,
      field.secret ? '' : field.name === 'domain' && provider === 'website'
        ? siteDomain ?? ''
        : String(settings.data?.[field.name] ?? ''),
    ]));
    setDraft(initial);
    setBaseline(initial);
  }, [provider, settings.data, siteDomain, fields]);

  const save = useMutation({
    mutationFn: (snapshot: Record<string, string>) => saveIntegrationSettings(provider, snapshot),
    onSuccess: async (_result, snapshot) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/academy/integrations/status'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/academy/integrations/settings', provider] }),
      ]);
      if (!active.current || !allowed.current) return;
      setBaseline(snapshot);
      setDraft(snapshot);
      toast({ title: t('integrationSaved') });
      if (provider !== 'instagram') onOpenChange(false);
    },
    onError: (error: unknown) => {
      if (accessUnavailable(error)) {
        allowed.current = false;
        setRevoked(true);
        return;
      }
      if (active.current && allowed.current) toast({ title: t('integrationSaveFailed'), variant: 'destructive' });
    },
    onSettled: () => { requestLocked.current = false; },
  });

  const issueToken = useMutation({
    mutationFn: (domain: string) => issueWebsiteToken(domain),
    onSuccess: async ({ domain, token }) => {
      await queryClient.invalidateQueries({ queryKey: ['/api/academy/integrations/status'] });
      if (!active.current || !allowed.current) return;
      setIssuedDomain(domain);
      setIssuedToken(token);
      const next = { ...draft, domain };
      setDraft(next);
      setBaseline(next);
      setRotateConfirmOpen(false);
      toast({ title: t('integrationWebsiteTokenIssued') });
    },
    onError: (error: unknown) => {
      if (accessUnavailable(error)) {
        allowed.current = false;
        setRevoked(true);
        return;
      }
      if (active.current && allowed.current) toast({ title: t('integrationSaveFailed'), variant: 'destructive' });
    },
    onSettled: () => { requestLocked.current = false; },
  });
  const pending = save.isPending || issueToken.isPending || instagramConnectPending;
  const requestWebsiteToken = () => {
    if (!allowed.current || pending || requestLocked.current) return;
    requestLocked.current = true;
    issueToken.mutate(draft.domain ?? '');
  };
  const requestSave = () => {
    if (!allowed.current || pending || requestLocked.current) return;
    requestLocked.current = true;
    save.mutate({ ...draft });
  };
  const guard = useUnsavedChangesGuard({
    open: allowed.current,
    isDirty: JSON.stringify(draft) !== JSON.stringify(baseline),
    isPending: pending,
    onOpenChange,
  });
  const safe = settings.data;
  const websiteDomain = (draft.domain ?? '').trim().toLowerCase().replace(/^https:\/\//, '').replace(/^www\./, '');
  const tokenConfiguredDomains = Array.isArray(safe?.tokenConfiguredDomains) ? safe.tokenConfiguredDomains : [];
  const websiteTokenConfigured = provider === 'website' && (
    tokenConfiguredDomains.includes(websiteDomain) || issuedDomain === websiteDomain
  );
  const connectionFields = fields[provider].filter((field) => field.required);
  const accessFields = fields[provider].filter((field) => field.secret && requiredSecrets.has(field.name));
  const additionalFields = fields[provider].filter((field) => !field.required && !accessFields.includes(field));
  const renderField = (field: Field) => (
    <div key={field.name} className="min-w-0 space-y-1.5">
      <Label htmlFor={`integration-${field.name}`}>{field.label}</Label>
      <Input
        id={`integration-${field.name}`}
        type={field.secret ? 'password' : field.name === 'usdToUzsRate' ? 'number' : 'text'}
        min={field.name === 'usdToUzsRate' ? 0 : undefined}
        step={field.name === 'usdToUzsRate' ? 'any' : undefined}
        autoComplete="off"
        value={draft[field.name] ?? ''}
        onChange={(event) => {
          if (provider === 'website' && field.name === 'domain') {
            setIssuedToken('');
            setIssuedDomain('');
          }
          setDraft((current) => ({ ...current, [field.name]: event.target.value }));
        }}
        onInvalid={(event) => {
          if (!additionalFields.includes(field)) return;
          if (!additionalOpen) event.preventDefault();
          setAdditionalOpen(true);
          const input = event.currentTarget;
          requestAnimationFrame(() => input.focus());
        }}
        required={field.required || (field.secret && requiredSecrets.has(field.name)
          && !safe?.[`${field.name}Configured`])}
      />
    </div>
  );
  if (!allowed.current) return null;
  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!requestLocked.current) guard.handleOpenChange(open); }}>
        <DialogContent aria-describedby={undefined} className="compact-modal flex max-h-[90dvh] flex-col overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="compact-modal-header">
            <DialogTitle>{titles[provider]}</DialogTitle>
          </DialogHeader>
          {settings.isLoading ? <div className="compact-modal-body"><Skeleton className="h-48 w-full" /></div> : settings.isError && !settings.data ? (
            <div className="compact-modal-body"><Button variant="outline" disabled={settings.isFetching} onClick={() => settings.refetch()}>{t('retry')}</Button></div>
          ) : (
            <form onSubmit={(event) => {
              event.preventDefault();
              if (pending) return;
              if (provider === 'website') {
                if (!websiteTokenConfigured) requestWebsiteToken();
              } else requestSave();
            }} className="flex min-h-0 flex-1 flex-col">
              <div className="compact-modal-body flex-1 space-y-3 overflow-y-auto overscroll-contain">
                {connectionFields.length ? (
                  <CompactModalSection title={t('integrationConnectionSection')} icon={Link2} tone="sky" collapsible={false} disabled={pending} contentClassName="grid gap-3 sm:grid-cols-2">
                    {connectionFields.map(renderField)}
                  </CompactModalSection>
                ) : null}
                {accessFields.length ? (
                  <CompactModalSection title={t('integrationAccessSection')} icon={KeyRound} tone="teal" collapsible={false} disabled={pending} contentClassName="grid gap-3 sm:grid-cols-2">
                    {accessFields.map(renderField)}
                  </CompactModalSection>
                ) : null}
                {additionalFields.length ? (
                  <CompactModalSection title={t('integrationAdditionalSection')} icon={Settings2} tone="violet" open={additionalOpen} onOpenChange={setAdditionalOpen} disabled={pending} contentClassName="grid gap-3 sm:grid-cols-2">
                    {additionalFields.map(renderField)}
                  </CompactModalSection>
                ) : null}
                {provider === 'website' && issuedToken ? (
                  <CompactModalSection title={t('integrationWebsiteToken')} icon={ShieldCheck} tone="teal" collapsible={false} contentClassName="space-y-2">
                    <Label htmlFor="integration-website-issued-token">{t('integrationWebsiteToken')}</Label>
                    <Input id="integration-website-issued-token" readOnly value={issuedToken} className="font-mono" />
                    <Button type="button" variant="outline" disabled={pending} onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(issuedToken);
                        toast({ title: t('integrationWebsiteTokenCopied') });
                      } catch {
                        toast({ title: t('error'), variant: 'destructive' });
                      }
                    }}>{t('integrationWebsiteCopyToken')}</Button>
                  </CompactModalSection>
                ) : null}
                {safe && ((provider === 'instagram' && (safe.callbackUrl || safe.webhookUrl)) || ((provider === 'meta' || provider === 'onlinepbx') && safe.webhookUrl)) ? (
                  <CompactModalSection title={t('integrationAddressesSection')} icon={Link2} tone="amber" contentClassName="space-y-3">
                    {provider === 'instagram' && safe.callbackUrl ? <div className="space-y-1"><p className="text-xs font-medium">{t('integrationCallbackUrl')}</p><p className="break-all select-all text-sm">{safe.callbackUrl}</p></div> : null}
                    {safe.webhookUrl ? <div className="space-y-1"><p className="text-xs font-medium">{t('integrationWebhookUrl')}</p><p className="break-all select-all text-sm">{safe.webhookUrl}</p></div> : null}
                  </CompactModalSection>
                ) : null}
              </div>
              <DialogFooter className="compact-modal-footer">
                <Button type="button" variant="outline" disabled={pending} onClick={() => { if (!requestLocked.current) guard.handleOpenChange(false); }}>{t('cancel')}</Button>
                {provider === 'instagram' && safe?.appSecretConfigured ? (
                  <Button type="button" variant="outline" disabled={pending} onClick={() => guard.requestAction(onInstagramConnect)}>{t('loginWithInstagram')}</Button>
                ) : null}
                {provider === 'website' && websiteTokenConfigured ? (
                  <Button type="button" disabled={pending} onClick={() => setRotateConfirmOpen(true)}>{t('integrationWebsiteRotateToken')}</Button>
                ) : (
                  <Button type="submit" disabled={pending}>
                    {pending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
                    {provider === 'website' ? t('integrationWebsiteCreateToken') : t('save')}
                  </Button>
                )}
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={rotateConfirmOpen} onOpenChange={(open) => { if (!pending && !requestLocked.current) setRotateConfirmOpen(open); }} pending={pending}>
        <AlertDialogContent className="compact-modal flex max-h-[90dvh] flex-col overflow-hidden p-0">
          <AlertDialogHeader data-topographic="header" className="compact-modal-header">
            <AlertDialogTitle>{t('integrationWebsiteRotateTitle')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <><AlertDialogDescription>{t('integrationWebsiteRotateDescription')}</AlertDialogDescription></>
          </AlertDialogBody>
          <AlertDialogFooter className="compact-modal-footer">
            <AlertDialogCancel disabled={pending}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={(event) => {
              event.preventDefault();
              requestWebsiteToken();
            }}>{t('integrationWebsiteRotateToken')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <UnsavedChangesDialog open={guard.confirmationOpen} onOpenChange={guard.setConfirmationOpen} onDiscard={guard.discardChanges} />
    </>
  );
}
