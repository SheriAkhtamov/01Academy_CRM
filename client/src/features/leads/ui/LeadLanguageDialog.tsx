import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LEAD_LANGUAGES, type LeadLanguage } from '@shared/lead-languages';
import { leadQueryKeys, leadsApi } from '../api';
import { invalidateLeadData } from '../queries';
import { useTranslation } from '@/hooks/useTranslation';
import { Button } from '@/components/ui/button';
import { NativeCheckbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type LanguageLead = { id: number; updatedAt?: string | null };

export function LeadLanguageDialog<TLead extends LanguageLead>({
  lead, initialLanguages, expectedUpdatedAt, onClose, onSaved, onConflict,
}: {
  lead: TLead;
  initialLanguages: LeadLanguage[];
  expectedUpdatedAt?: string | null;
  onClose: () => void;
  onSaved: (lead: TLead) => void;
  onConflict: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  const sending = useRef(false);
  const [languages, setLanguages] = useState(initialLanguages);
  const [errorMessage, setErrorMessage] = useState<'leadSaveFailed' | 'leadChangedConcurrently' | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const save = useMutation({
    mutationFn: () => leadsApi.update<TLead>(lead.id, {
      languages, language: languages[0], expectedUpdatedAt,
    }),
    onSuccess: async updated => {
      await queryClient.cancelQueries({ queryKey: leadQueryKeys.detail(updated.id) });
      if (mounted.current) {
        onSaved(updated);
        onClose();
      }
      await invalidateLeadData(queryClient, updated.id);
    },
    onError: (error: Error & { status?: number }) => {
      if (!mounted.current) return;
      setErrorMessage(error.status === 409 ? 'leadChangedConcurrently' : 'leadSaveFailed');
      if (error.status === 409) onConflict();
    },
    onSettled: () => { sending.current = false; },
  });
  return (
    <Dialog open onOpenChange={open => { if (!open && !save.isPending) onClose(); }}>
      <DialogContent className="compact-modal w-[calc(100%-2rem)] max-w-lg"
        onEscapeKeyDown={event => { if (save.isPending) event.preventDefault(); }}>
        <DialogHeader className="compact-modal-header">
          <DialogTitle>{t('selectCommunicationLanguage')}</DialogTitle>
          <DialogDescription className="sr-only">{t('communicationLanguage')}</DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-col" onSubmit={event => {
          event.preventDefault();
          if (!languages.length || sending.current) return;
          sending.current = true;
          setErrorMessage(null);
          save.mutate();
        }}>
          <div className="compact-modal-body space-y-3">
            <fieldset disabled={save.isPending} className="flex flex-wrap gap-3" aria-label={t('communicationLanguage')}>
              {LEAD_LANGUAGES.map(value => (
                <label key={value} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-background px-3 text-sm">
                  <NativeCheckbox type="checkbox" checked={languages.includes(value)} onChange={event => {
                    setErrorMessage(null);
                    setLanguages(current => LEAD_LANGUAGES.filter(item => item === value ? event.target.checked : current.includes(item)));
                  }} />
                  {t(value === 'ru' ? 'russian' : value === 'uz' ? 'uzbekLang' : 'english')}
                </label>
              ))}
            </fieldset>
            {errorMessage ? <p role="alert" className="text-sm text-destructive">{t(errorMessage)}</p> : null}
          </div>
          <DialogFooter className="compact-modal-footer">
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>{t('cancel')}</Button>
            <Button type="submit" loading={save.isPending} disabled={!languages.length || save.isPending}>{t('saveChanges')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
