import { describe, expect, it } from 'vitest';
import { getLinkedAccountId } from '../shared/account-switching';

describe('saved-account switching links', () => {
  const administrationToSales = {
    ownerUserId: 1,
    accountUserId: 5,
  };

  it('lets the owner switch to the linked account', () => {
    expect(getLinkedAccountId(administrationToSales, 1)).toBe(5);
  });

  it('lets the linked account switch back to the owner', () => {
    expect(getLinkedAccountId(administrationToSales, 5)).toBe(1);
  });

  it('does not expose a link to an unrelated account', () => {
    expect(getLinkedAccountId(administrationToSales, 9)).toBeNull();
  });
});
