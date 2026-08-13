import { Badge } from '@/components/ui/badge';
import { useTranslation } from '@/hooks/useTranslation';
import {
  TEACHER_TONE_CLASS,
  groupStatusLabelKey,
  groupStatusTone,
  lessonStatusLabelKey,
  lessonStatusTone,
} from '@/lib/teacherModule';
import { cn } from '@/lib/utils';

/**
 * A status the module does not know about used to be printed straight from the
 * database — `in_progress` in the middle of a Russian interface. Both badges
 * fall back to a neutral localized label instead.
 */
export function LessonStatusBadge({ status, className }: { status: string; className?: string }) {
  const { t } = useTranslation();
  const labelKey = lessonStatusLabelKey(status);

  return (
    <Badge
      variant="outline"
      className={cn(
        'shrink-0 whitespace-nowrap border text-xs font-medium',
        TEACHER_TONE_CLASS[lessonStatusTone(status)],
        className,
      )}
    >
      {labelKey ? t(labelKey) : t('statusNotSpecified')}
    </Badge>
  );
}

export function GroupStatusBadge({ status, className }: { status: string; className?: string }) {
  const { t } = useTranslation();
  const labelKey = groupStatusLabelKey(status);

  return (
    <Badge
      variant="outline"
      className={cn(
        'shrink-0 whitespace-nowrap border text-xs font-medium',
        TEACHER_TONE_CLASS[groupStatusTone(status)],
        className,
      )}
    >
      {labelKey ? t(labelKey) : t('statusNotSpecified')}
    </Badge>
  );
}
