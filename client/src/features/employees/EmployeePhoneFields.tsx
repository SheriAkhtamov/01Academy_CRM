import { useRef, useState } from 'react';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { PhoneInput } from '@/components/ux/FormattedInputs';
import { useTranslation } from '@/hooks/useTranslation';
import type { UserFormValues } from './employeeFormSchema';

const maximumEmployeePhones = 10;

interface EmployeePhoneFieldsProps {
  form: UseFormReturn<UserFormValues>;
}

export function EmployeePhoneFields({ form }: EmployeePhoneFieldsProps) {
  const { t } = useTranslation();
  const phoneNumbers = useWatch({ control: form.control, name: 'phoneNumbers' });
  const visiblePhoneNumbers = phoneNumbers.length > 0 ? phoneNumbers : [''];
  const keyCounter = useRef(visiblePhoneNumbers.length);
  const [rowKeys, setRowKeys] = useState(() => (
    visiblePhoneNumbers.map((_, index) => `employee-phone-${index}`)
  ));

  const addPhone = () => {
    if (visiblePhoneNumbers.length >= maximumEmployeePhones) return;
    const key = `employee-phone-${keyCounter.current}`;
    keyCounter.current += 1;
    setRowKeys((current) => [...current, key]);
    form.setValue('phoneNumbers', [...visiblePhoneNumbers, ''], {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  const removePhone = (index: number) => {
    if (index === 0) return;
    setRowKeys((current) => current.filter((_, phoneIndex) => phoneIndex !== index));
    form.setValue(
      'phoneNumbers',
      visiblePhoneNumbers.filter((_, phoneIndex) => phoneIndex !== index),
      { shouldDirty: true, shouldValidate: true },
    );
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
                  <PhoneInput
                    ref={field.ref}
                    name={field.name}
                    value={field.value ?? ''}
                    onBlur={field.onBlur}
                    onValueChange={field.onChange}
                    placeholder={t('phonePlaceholder')}
                  />
                </FormControl>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={index === 0 ? t('addPhone') : t('removePhone')}
                  disabled={index === 0 && visiblePhoneNumbers.length >= maximumEmployeePhones}
                  onClick={index === 0 ? addPhone : () => removePhone(index)}
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
    </div>
  );
}
