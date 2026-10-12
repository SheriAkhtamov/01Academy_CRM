import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES } from '@shared/upload-policy';
import { MAX_ATTACHMENT_BYTES } from '@shared/board-attachments';
import { MAX_STUDENT_PROJECT_BYTES } from '@shared/contracts/student-profile';
import { PORTAL_MAX_FILE_BYTES } from '@shared/contracts/portal-resources';
import { MAX_MESSAGE_FILE_BYTES } from '@shared/contracts/messages';
import { MAX_PAYMENT_ATTACHMENT_BYTES } from '@shared/payment-attachments';
import { MAX_USER_PHOTO_BYTES } from '@shared/user-photo';
import { DEFAULT_LEARNING_SCHOOL_SETTINGS, LEARNING_ACHIEVEMENT_RULES, fixedLearningPolicy, learningSchoolSettingsSchema } from '@shared/contracts/learning-settings';
import { lmsRunUpdateSchema } from '@shared/contracts/lms';
import { selfPermissions } from '../server/modules/portal-identity/domain/access-policy';
import { requireFinanceRead } from '../server/modules/portal-resources/domain/policy';
import { MODULE_NAVIGATION } from '../client/src/lib/moduleNavigation';

describe('Fixed learning policy', () => {
  it('keeps a single 10 MiB maximum across every user upload family', () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
    expect([MAX_ATTACHMENT_BYTES, MAX_STUDENT_PROJECT_BYTES, PORTAL_MAX_FILE_BYTES, MAX_MESSAGE_FILE_BYTES, MAX_PAYMENT_ATTACHMENT_BYTES, MAX_USER_PHOTO_BYTES].every(value => value === MAX_UPLOAD_BYTES)).toBe(true);
  });
  it('ignores old expiry, file size and missing award settings while preserving course preparation', () => {
    const stored = learningSchoolSettingsSchema.parse({ ...DEFAULT_LEARNING_SCHOOL_SETTINGS, maxFileMiB: 100, materialAccessDays: 1, achievementTemplates: [], workCalendar: { start: '01:00' }, childFinanceVisible: true, crmPreparation: { defaultFormat: 'online' } });
    const policy = fixedLearningPolicy(stored);
    expect(policy.maxFileMiB).toBe(10); expect(policy.materialAccessDays).toBeNull();
    expect(policy.achievementTemplates.map(value => value.rule)).toEqual([...LEARNING_ACHIEVEMENT_RULES]);
    expect(policy).not.toHaveProperty('workCalendar'); expect(policy).not.toHaveProperty('childFinanceVisible');
    expect(policy.crmPreparation.defaultFormat).toBe('online');
    expect(MODULE_NAVIGATION.administration.items.map(item => item.id)).not.toContain('learning-settings');
  });
  it('rejects shortening material access through an old client request', () => {
    expect(lmsRunUpdateSchema.safeParse({ version: 1, accessUntil: '2030-01-01T00:00:00Z', reason: 'Old client' }).success).toBe(false);
    expect(lmsRunUpdateSchema.safeParse({ version: 1, status: 'completed', reason: 'Completed' }).success).toBe(true);
  });
  it('keeps financial records with adults and representatives even if a child link contains an old permission', () => {
    expect(selfPermissions('minor')).not.toContain('finance.read'); expect(selfPermissions('adult')).toContain('finance.read');
    expect(() => requireFinanceRead({ portalAccountId: 1, sessionId: 'fixture', studentId: 1, linkId: 1, kind: 'self', studentClassification: 'minor', permissions: ['finance.read'] })).toThrow('portalAccessDenied');
  });
});
