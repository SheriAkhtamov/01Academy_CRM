import { z } from 'zod';
import { leadLanguageSchema, type CreateAcademyLeadRequest } from '@shared/contracts/academy-leads';
import type { TranslationKey } from '@/lib/i18n';
import { phoneOwnersFromRows } from '@shared/lead-phone-owners';

export const leadRequiredFieldKeys = {
  contactName: 'contactPersonRequired',
  sourceId: 'sourceRequired',
  funnelId: 'salesFunnelRequired',
  managerId: 'leadManagerRequired',
} as const satisfies Record<string, TranslationKey>;

const optionalPhoneString = z.string().trim().refine(
  (value) => value === '' || value.length >= 7,
  'invalidData',
);

const phoneKey = (value: string | null | undefined) => String(value ?? '').replace(/\D/g, '');

export const compactPhoneNumbers = (values: string[]) => {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const trimmed = value.trim();
    const key = phoneKey(trimmed);
    if (!trimmed || !key || seen.has(key)) return [];
    seen.add(key);
    return [trimmed];
  });
};

const uniquePhoneNumbers = (values: string[]) => {
  const keys = values.map(phoneKey).filter(Boolean);
  return new Set(keys).size === keys.length;
};

export const createLeadSchema = z.object({
  contactName: z.string().trim().min(1, leadRequiredFieldKeys.contactName),
  phoneNumbers: z.array(optionalPhoneString).min(1).refine(uniquePhoneNumbers, 'duplicatePhoneInForm'),
  phoneOwnerNames: z.array(z.string().trim().max(255, 'invalidData')).optional(),
  sourceId: z.string().min(1, leadRequiredFieldKeys.sourceId),
  funnelId: z.string().min(1, leadRequiredFieldKeys.funnelId),
  managerId: z.string().min(1, leadRequiredFieldKeys.managerId),
  comment: z.string(),
  language: leadLanguageSchema,
});

export type CreateLeadFormValues = z.infer<typeof createLeadSchema>;

export const EMPTY_LEAD_FORM: CreateLeadFormValues = {
  contactName: '',
  phoneNumbers: [''],
  phoneOwnerNames: [''],
  sourceId: '',
  funnelId: '',
  managerId: '',
  comment: '',
  language: '',
};

export const createLeadPayload = (values: CreateLeadFormValues): CreateAcademyLeadRequest => {
  const { phoneOwnerNames, ...rest } = values;
  return {
    ...rest,
    phoneNumbers: compactPhoneNumbers(values.phoneNumbers),
    phoneOwners: phoneOwnersFromRows(values.phoneNumbers, phoneOwnerNames),
    sourceId: Number(values.sourceId),
    funnelId: Number(values.funnelId),
    managerId: values.managerId ? Number(values.managerId) : undefined,
  };
};
