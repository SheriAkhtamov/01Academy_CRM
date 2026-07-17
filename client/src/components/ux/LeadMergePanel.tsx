import { useDeferredValue, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowRightLeft, Search, UserRound } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { leadMergeErrorMessage } from '@/lib/leadMerge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

interface LeadMergeCandidate {
  id: number;
  contactName: string;
  phone?: string | null;
  phoneNumbers?: string[];
  messenger?: string | null;
  studentName?: string | null;
  statusName?: string | null;
  managerName?: string | null;
  sourceName?: string | null;
  instagramConversationCount?: number;
  studentCount?: number;
  paymentCount?: number;
  communicationCount?: number;
  taskCount?: number;
}

const primaryContact = (lead: LeadMergeCandidate) => (
  lead.phoneNumbers?.[0] || lead.phone || lead.messenger || '—'
);

function LeadCandidateCard({
  lead,
  label,
  onSelect,
}: {
  lead: LeadMergeCandidate;
  label: string;
  onSelect?: () => void;
}) {
  const content = (
    <div className="flex min-w-0 flex-1 flex-col gap-2 text-left">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">#{lead.id}</Badge>
        <span className="font-medium text-foreground">{lead.contactName}</span>
        {lead.statusName ? <Badge variant="secondary">{lead.statusName}</Badge> : null}
      </div>
      <p className="text-sm text-muted-foreground">{primaryContact(lead)}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {lead.managerName ? <span>{lead.managerName}</span> : null}
        {lead.studentName ? <span>{lead.studentName}</span> : null}
        {lead.sourceName ? <span>{lead.sourceName}</span> : null}
      </div>
    </div>
  );

  if (onSelect) {
    return (
      <Button
        type="button"
        variant="outline"
        className="h-auto w-full justify-start whitespace-normal p-4"
        onClick={onSelect}
      >
        {content}
      </Button>
    );
  }

  return (
    <Card className="border-border/70">
      <CardHeader className="p-4 pb-2">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0">{content}</CardContent>
    </Card>
  );
}

export function LeadMergePanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [firstLead, setFirstLead] = useState<LeadMergeCandidate | null>(null);
  const [secondLead, setSecondLead] = useState<LeadMergeCandidate | null>(null);
  const [searchTarget, setSearchTarget] = useState<'first' | 'second' | null>(null);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [retainedLeadId, setRetainedLeadId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (firstLead && secondLead) setRetainedLeadId(String(firstLead.id));
    else setRetainedLeadId('');
  }, [firstLead?.id, secondLead?.id]);

  const searchQuery = useQuery<LeadMergeCandidate[]>({
    queryKey: ['/api/academy/leads/merge-candidates', deferredSearch],
    queryFn: () => apiRequest(
      'GET',
      `/api/academy/leads/merge-candidates?q=${encodeURIComponent(deferredSearch)}`,
    ),
    enabled: searchTarget !== null && deferredSearch.length >= 2,
  });

  const previewQuery = useQuery<{ leads: LeadMergeCandidate[] }>({
    queryKey: ['/api/academy/leads/merge-preview', firstLead?.id, secondLead?.id],
    queryFn: () => apiRequest(
      'GET',
      `/api/academy/leads/merge-preview?firstLeadId=${firstLead!.id}&secondLeadId=${secondLead!.id}`,
    ),
    enabled: Boolean(firstLead && secondLead && firstLead.id !== secondLead.id),
  });

  const previewLeads = previewQuery.data?.leads ?? [];
  const freshFirstLead = previewLeads.find((lead) => lead.id === firstLead?.id) ?? firstLead;
  const freshSecondLead = previewLeads.find((lead) => lead.id === secondLead?.id) ?? secondLead;
  const retainedLead = retainedLeadId === String(freshFirstLead?.id) ? freshFirstLead : freshSecondLead;
  const duplicateLead = retainedLeadId === String(freshFirstLead?.id) ? freshSecondLead : freshFirstLead;
  const studentConflict = Number(freshFirstLead?.studentCount ?? 0) > 0
    && Number(freshSecondLead?.studentCount ?? 0) > 0;

  const mergeMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/academy/leads/merge', {
      retainedLeadId: Number(retainedLead?.id),
      duplicateLeadId: Number(duplicateLead?.id),
    }),
    onSuccess: async () => {
      setConfirmOpen(false);
      setFirstLead(null);
      setSecondLead(null);
      setRetainedLeadId('');
      await queryClient.invalidateQueries({ queryKey: ['/api/academy'] });
      toast({ title: t('leadMergeCompleted'), description: t('leadMergeCompletedDescription') });
    },
    onError: (error: any) => {
      setConfirmOpen(false);
      toast({
        title: t('leadMergeFailed'),
        description: leadMergeErrorMessage(t, error?.data?.error),
        variant: 'destructive',
      });
    },
  });

  const openSearch = (target: 'first' | 'second') => {
    setSearch('');
    setSearchTarget(target);
  };

  const selectLead = (lead: LeadMergeCandidate) => {
    if (searchTarget === 'first') setFirstLead(lead);
    if (searchTarget === 'second') setSecondLead(lead);
    setSearchTarget(null);
    setSearch('');
  };

  const excludedLeadId = searchTarget === 'first' ? secondLead?.id : firstLead?.id;
  const searchResults = (searchQuery.data ?? []).filter((lead) => lead.id !== excludedLeadId);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('leadMergeTitle')}</CardTitle>
          <CardDescription>{t('leadMergeDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
            {firstLead ? (
              <LeadCandidateCard lead={freshFirstLead!} label={t('leadMergeFirstLead')} />
            ) : (
              <Button type="button" variant="outline" className="h-28" onClick={() => openSearch('first')}>
                <UserRound data-icon="inline-start" />
                {t('selectFirstLeadForMerge')}
              </Button>
            )}
            <ArrowRightLeft className="mx-auto text-muted-foreground" aria-hidden />
            {secondLead ? (
              <LeadCandidateCard lead={freshSecondLead!} label={t('leadMergeSecondLead')} />
            ) : (
              <Button type="button" variant="outline" className="h-28" onClick={() => openSearch('second')}>
                <UserRound data-icon="inline-start" />
                {t('selectSecondLeadForMerge')}
              </Button>
            )}
          </div>

          {firstLead && secondLead ? (
            <div className="flex flex-col gap-4 rounded-xl border border-border bg-muted/20 p-4">
              <div className="space-y-2">
                <Label htmlFor="lead-merge-retained">{t('retainedLeadLabel')}</Label>
                <Select value={retainedLeadId} onValueChange={setRetainedLeadId}>
                  <SelectTrigger id="lead-merge-retained">
                    <SelectValue placeholder={t('chooseLeadToKeep')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={String(firstLead.id)}>#{firstLead.id} — {firstLead.contactName}</SelectItem>
                      <SelectItem value={String(secondLead.id)}>#{secondLead.id} — {secondLead.contactName}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">{t('retainedLeadHelp')}</p>
              </div>

              {previewQuery.isLoading ? <Skeleton className="h-16 w-full" /> : null}
              {previewQuery.isError ? (
                <Alert variant="destructive">
                  <AlertTitle>{t('leadMergePreviewFailed')}</AlertTitle>
                  <AlertDescription>{t('retry')}</AlertDescription>
                </Alert>
              ) : null}
              {studentConflict ? (
                <Alert variant="destructive">
                  <AlertTitle>{t('leadMergeStudentConflictTitle')}</AlertTitle>
                  <AlertDescription>{t('leadMergeStudentConflict')}</AlertDescription>
                </Alert>
              ) : null}

              {retainedLead && duplicateLead ? (
                <div className="flex flex-col gap-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">#{duplicateLead.id} {duplicateLead.contactName}</Badge>
                    <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
                    <Badge>#{retainedLead.id} {retainedLead.contactName}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{t('mergeInstagramChats')}: {Number(duplicateLead.instagramConversationCount ?? 0)}</Badge>
                    <Badge variant="outline">{t('mergePayments')}: {Number(duplicateLead.paymentCount ?? 0)}</Badge>
                    <Badge variant="outline">{t('mergeContacts')}: {Number(duplicateLead.communicationCount ?? 0)}</Badge>
                    <Badge variant="outline">{t('mergeTasks')}: {Number(duplicateLead.taskCount ?? 0)}</Badge>
                    <Badge variant="outline">{t('mergeStudents')}: {Number(duplicateLead.studentCount ?? 0)}</Badge>
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => openSearch('first')}>
                    {t('changeFirstLead')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => openSearch('second')}>
                    {t('changeSecondLead')}
                  </Button>
                </div>
                <Button
                  type="button"
                  disabled={!retainedLeadId || previewQuery.isLoading || previewQuery.isError || studentConflict}
                  onClick={() => setConfirmOpen(true)}
                >
                  <ArrowRightLeft data-icon="inline-start" />
                  {t('mergeLeads')}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={searchTarget !== null} onOpenChange={(open) => {
        if (!open) setSearchTarget(null);
      }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('selectLeadForMerge')}</DialogTitle>
            <DialogDescription>{t('selectLeadForMergeDescription')}</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
              placeholder={t('searchLeadPlaceholder')}
            />
          </div>
          <div className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
            {search.trim().length < 2 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t('leadSearchMinCharacters')}</p>
            ) : searchQuery.isLoading ? (
              <><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></>
            ) : searchQuery.isError ? (
              <Alert variant="destructive">
                <AlertTitle>{t('leadMergeSearchFailed')}</AlertTitle>
                <AlertDescription>{t('retry')}</AlertDescription>
              </Alert>
            ) : searchResults.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t('noMatchingLeads')}</p>
            ) : searchResults.map((lead) => (
              <LeadCandidateCard key={lead.id} lead={lead} label="" onSelect={() => selectLead(lead)} />
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => {
        if (!open && !mergeMutation.isPending) setConfirmOpen(false);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmLeadMergeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('confirmLeadMergeDescription')
                .replace('{duplicate}', duplicateLead?.contactName ?? '')
                .replace('{retained}', retainedLead?.contactName ?? '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mergeMutation.isPending}>{t('cancel')}</AlertDialogCancel>
            <Button type="button" disabled={mergeMutation.isPending} onClick={() => mergeMutation.mutate()}>
              {mergeMutation.isPending ? t('saving') : t('mergeLeads')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
