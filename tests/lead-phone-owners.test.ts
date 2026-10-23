import { describe, expect, it } from 'vitest';
import { createAcademyLeadRequestSchema, updateAcademyLeadRequestSchema } from '../shared/contracts/academy-leads';
import { leadPhoneIdentity, phoneOwnerNamesFor, phoneOwnersFromRows } from '../shared/lead-phone-owners';
import { createLeadPayload, EMPTY_LEAD_FORM } from '../client/src/features/leads/create-lead-form';

describe('lead phone owners', () => {
  it('matches owners across local, international and formatted phone numbers', () => {
    for (const phone of ['90 123 45 67', '00998 90 123 45 67', '+998901234567']) {
      expect(leadPhoneIdentity(phone)).toBe('+998901234567');
    }
    expect(phoneOwnerNamesFor(['90 123 45 67', '+998901234568'], {
      '+998901234567': 'Parent',
    })).toEqual(['Parent', '']);
  });

  it('omits blank phone rows without shifting their owner names', () => {
    const payload = createLeadPayload({ ...EMPTY_LEAD_FORM,
      phoneNumbers: ['+998901234567', '', '+998901234568'],
      phoneOwnerNames: ['  Parent  ', 'Unused', 'Grandparent'],
    });
    expect(payload.phoneNumbers).toEqual(['+998901234567', '+998901234568']);
    expect(payload.phoneOwners).toEqual({ '+998901234567': 'Parent', '+998901234568': 'Grandparent' });
    expect(payload).not.toHaveProperty('phoneOwnerNames');
    expect(phoneOwnersFromRows(['+998901234567'], [''])).toEqual({ '+998901234567': '' });
  });

  it('keeps existing clients compatible and validates names in create and update requests', () => {
    expect(createAcademyLeadRequestSchema.safeParse({ contactName: 'Parent' }).success).toBe(true);
    expect(updateAcademyLeadRequestSchema.safeParse({ contactName: 'Parent' }).success).toBe(true);
    for (const schema of [createAcademyLeadRequestSchema, updateAcademyLeadRequestSchema]) {
      expect(schema.safeParse({ contactName: 'Parent', phoneOwners: { '+998901234567': '  Parent  ' } }).success).toBe(true);
      expect(schema.safeParse({ contactName: 'Parent', phoneOwners: { '+998901234567': 'x'.repeat(256) } }).success).toBe(false);
      expect(schema.safeParse({ contactName: 'Parent', phoneOwners: { '+998901234567': 42 } }).success).toBe(false);
    }
  });
});
