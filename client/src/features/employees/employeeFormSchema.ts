import { z } from 'zod';
import { ACADEMY_ACCESS_MODULES, ACADEMY_MODULES } from '@shared/academy';
import type { TranslationKey } from '@/lib/i18n';

type Translate = (key: TranslationKey) => string;

// Schema functions that use runtime translation
export const createUserSchema = (t: Translate) => z.object({
  email: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().email(t('invalidEmailAddress')).optional()
  ),
  fullName: z.string().min(1, t('fullNameRequired')),
  phone: z.string().optional(),
  dateOfBirth: z.string().optional(),
  position: z.string().optional(),
  module: z.enum(ACADEMY_MODULES),
  modules: z.array(z.enum(ACADEMY_ACCESS_MODULES)).min(1, t('selectAtLeastOneModule')),
  teacherSchoolIds: z.array(z.number().int().positive()).default([]),
  teacherAvailability: z.array(z.object({
    dayOfWeek: z.number().int().min(1).max(7),
    startTime: z.string(),
    endTime: z.string(),
    schoolId: z.number().int().positive().nullable().optional(),
  })).default([]),
  isActive: z.boolean().default(true),
});

export const createCredentialsSchema = (t: Translate) => z.object({
  email: z.string().email(t('invalidEmailAddress')),
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
}).superRefine((values, ctx) => {
  const wantsPasswordChange = Boolean(values.password || values.confirmPassword);

  if (!wantsPasswordChange) return;

  if (!values.password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['password'],
      message: t('newPasswordRequired'),
    });
  } else if (values.password.length < 12) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['password'],
      message: t('passwordTooShort'),
    });
  } else if (new TextEncoder().encode(values.password).length > 72) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['password'],
      message: t('passwordTooLong'),
    });
  }

  if (values.password !== values.confirmPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['confirmPassword'],
      message: t('passwordsDoNotMatch'),
    });
  }
});

export type UserFormValues = z.infer<ReturnType<typeof createUserSchema>>;
export type UserUpdatePayload = Partial<UserFormValues> & { leadTransferManagerId?: number };

export const defaultUserFormValues: UserFormValues = {
  email: '',
  fullName: '',
  phone: '',
  dateOfBirth: '',
  position: '',
  module: 'sales',
  modules: ['sales'],
  teacherSchoolIds: [],
  teacherAvailability: [],
  isActive: true,
};

