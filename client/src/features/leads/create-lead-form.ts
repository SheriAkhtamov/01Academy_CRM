import { z } from 'zod';
import type { CreateAcademyLeadRequest } from '@shared/contracts/academy-leads';

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
  contactName: z.string().trim().min(1, 'fillRequiredFields'),
  phoneNumbers: z.array(optionalPhoneString).min(1).refine(uniquePhoneNumbers, 'duplicatePhoneInForm'),
  sourceId: z.string().min(1, 'fillRequiredFields'),
  funnelId: z.string().min(1, 'salesFunnelRequired'),
  managerId: z.string().min(1, 'fillRequiredFields'),
  comment: z.string(),
  language: z.enum(['ru', 'uz', 'en']),
});

export type CreateLeadFormValues = z.infer<typeof createLeadSchema>;

export const EMPTY_LEAD_FORM: CreateLeadFormValues = {
  contactName: '',
  phoneNumbers: [''],
  sourceId: '',
  funnelId: '',
  managerId: '',
  comment: '',
  language: 'ru',
};

export const createLeadPayload = (values: CreateLeadFormValues): CreateAcademyLeadRequest => ({
  ...values,
  phoneNumbers: compactPhoneNumbers(values.phoneNumbers),
  sourceId: Number(values.sourceId),
  funnelId: Number(values.funnelId),
  managerId: values.managerId ? Number(values.managerId) : undefined,
});
