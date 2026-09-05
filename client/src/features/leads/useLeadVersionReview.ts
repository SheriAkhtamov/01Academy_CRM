import { useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';

export function useLeadVersionReview<T>(
  refetch: () => Promise<{ data: T | undefined; error: Error | null }>,
  apply: (data: T, keepDraft: boolean) => void,
) {
  const [reviewingVersion, setReviewingVersion] = useState(false);
  const { t } = useTranslation();
  const reviewLatestVersion = async (keepDraft: boolean) => {
    setReviewingVersion(true);
    try {
      const result = await refetch();
      if (result.error || !result.data) throw result.error ?? new Error(t('failedToLoadData'));
      apply(result.data, keepDraft);
      toast({ title: t('leadVersionUpdated') });
    } catch (error) {
      toast({ title: t('failedToLoadData'), description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally { setReviewingVersion(false); }
  };
  return { reviewingVersion, reviewLatestVersion };
}
