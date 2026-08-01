import { useFormField } from '@/components/ui/form';
import { useTranslation } from '@/hooks/useTranslation';
import { translations, type TranslationKey } from '@/lib/i18n';

/**
 * Field-level validation message. Zod schemas carry translation keys as their
 * error messages so the copy stays localized without duplicating the schema.
 */
export function LocalizedFormMessage() {
  const { t } = useTranslation();
  const { error, formMessageId } = useFormField();
  if (!error?.message) return null;
  const message = String(error.message);
  const key = Object.prototype.hasOwnProperty.call(translations, message)
    ? message as TranslationKey
    : 'invalidData';

  return (
    <p id={formMessageId} className="text-sm font-medium text-destructive">
      {t(key)}
    </p>
  );
}
