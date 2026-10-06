import { useTranslation } from '@/hooks/useTranslation';

export function UnreadTaskCommentDot() {
  const { t } = useTranslation();
  return <span role="img" aria-label={t('unreadTaskComment')} className="inline-block size-2 shrink-0 rounded-full bg-red-500" />;
}
