import { useRef, useState } from 'react';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Input } from '@/components/ui/input';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { useTranslation } from '@/hooks/useTranslation';
import type { UserFormValues } from './employeeFormSchema';

const maximumEmployeePhones = 10;

interface EmployeePhoneFieldsProps {
  form: UseFormReturn<UserFormValues>;
  disabled?: boolean;
}

export function EmployeePhoneFields({ form, disabled = false }: EmployeePhoneFieldsProps) {
  const { t } = useTranslation();
  const phoneNumbers = useWatch({ control: form.control, name: 'phoneNumbers' });
  const visiblePhoneNumbers = phoneNumbers.length > 0 ? phoneNumbers : [''];
  const removedPhoneFocusRef = useRef<number | null>(null);
  const [removalIndex, setRemovalIndex] = useState<number | null>(null);
  const keyCounter = useRef(visiblePhoneNumbers.length);
  const [rowKeys, setRowKeys] = useState(() => (
    visiblePhoneNumbers.map((_, index) => `employee-phone-${index}`)
  ));

  const addPhone = () => {
    if (disabled || visiblePhoneNumbers.length >= maximumEmployeePhones) return;
    const key = `employee-phone-${keyCounter.current}`;
    keyCounter.current += 1;
    setRowKeys((current) => [...current, key]);
    form.setValue('phoneNumbers', [...visiblePhoneNumbers, ''], {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const removePhone = (index: number) => {
    if (disabled || index === 0) return;
    setRowKeys((current) => current.filter((_, phoneIndex) => phoneIndex !== index));
    form.setValue(
      'phoneNumbers',
      visiblePhoneNumbers.filter((_, phoneIndex) => phoneIndex !== index),
      { shouldDirty: true, shouldValidate: true },
    );
  };

  const requestRemovePhone = (index: number) => {
    if (disabled || index === 0) return;
    if (visiblePhoneNumbers[index]?.trim()) setRemovalIndex(index);
    else removePhone(index);
  };

  return (
    <div className="flex flex-col gap-3">
      {visiblePhoneNumbers.map((_, index) => (
        <FormField
          key={rowKeys[index] ?? `employee-phone-fallback-${index}`}
          control={form.control}
          name={`phoneNumbers.${index}`}
          render={({ field }) => (
            <FormItem>
              <FormLabel>{index === 0 ? t('phone') : `${t('phone')} ${index + 1}`}</FormLabel>
              <div className="flex gap-2">
                <FormControl>
                  <Input
                    {...field}
                    disabled={disabled}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={field.value ?? ''}
                    placeholder={t('phonePlaceholder')}
                  />
                </FormControl>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={index === 0 ? t('addPhone') : t('removePhone')}
                  disabled={disabled || (index === 0 && visiblePhoneNumbers.length >= maximumEmployeePhones)}
                  onClick={index === 0 ? addPhone : () => requestRemovePhone(index)}
                >
                  {index === 0
                    ? <Plus aria-hidden="true" />
                    : <Trash2 aria-hidden="true" />}
                </Button>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
      ))}
      <ConfirmDialog
        compact
        open={removalIndex !== null}
        onOpenChange={(open) => { if (!open) setRemovalIndex(null); }}
        title={t('leadWorkspaceRemovePhoneTitle')}
        description={removalIndex === null ? '' : visiblePhoneNumbers[removalIndex] ?? ''}
        confirmLabel={t('removePhone')}
        variant="destructive"
        confirmDisabled={disabled}
        onCloseAutoFocus={(event) => {
          const removedIndex = removedPhoneFocusRef.current;
          if (removedIndex === null) return;
          event.preventDefault();
          removedPhoneFocusRef.current = null;
          form.setFocus(`phoneNumbers.${Math.max(0, removedIndex - 1)}`);
        }}
        onConfirm={() => {
          if (removalIndex !== null && !disabled) {
            removedPhoneFocusRef.current = removalIndex;
            removePhone(removalIndex);
          }
          setRemovalIndex(null);
        }}
      />
    </div>
  );
}
