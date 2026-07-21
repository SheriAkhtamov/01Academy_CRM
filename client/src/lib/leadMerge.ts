import type { TranslationKey } from '@/lib/i18n';

type Translate = (key: TranslationKey) => string;

export function leadMergeErrorMessage(t: Translate, errorCode: unknown) {
  switch (errorCode) {
    case 'leadMergeRequiresDifferentLeads':
      return t('leadMergeRequiresDifferentLeads');
    case 'leadMergeLeadNotFound':
      return t('leadMergeLeadNotFound');
    case 'leadMergeActiveLeadsOnly':
      return t('leadMergeActiveLeadsOnly');
    case 'leadMergeAccessDenied':
      return t('leadMergeAccessDenied');
    case 'leadMergeIncomplete':
      return t('leadMergeIncomplete');
    case 'leadMergeSearchFailed':
      return t('leadMergeSearchFailed');
    case 'leadMergePreviewFailed':
      return t('leadMergePreviewFailed');
    default:
      return t('leadMergeFailed');
  }
}
