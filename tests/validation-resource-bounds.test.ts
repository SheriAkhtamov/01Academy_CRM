import { expect, it } from 'vitest';
import { bulkArchiveLeadsRequestSchema } from '../shared/contracts/academy-leads';

it('rejects oversized bulk lead requests before validating their elements', () => {
  const leadIds = Array.from({ length: 501 }, () => 1);
  Object.defineProperty(leadIds, 0, {
    get() { throw new Error('Oversized collection elements must not be read'); },
  });

  const result = bulkArchiveLeadsRequestSchema.safeParse({ reason: 'duplicate', leadIds });

  expect(result.success).toBe(false);
  if (result.success) throw new Error('Oversized request was accepted');
  expect(result.error.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'too_big', path: ['leadIds'], maximum: 500 }),
  ]));
});
