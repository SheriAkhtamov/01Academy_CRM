import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routes = readFileSync(
  new URL('../server/modules/academy/leads.router.ts', import.meta.url),
  'utf8',
);
const activity = readFileSync(
  new URL('../client/src/features/leads/ui/LeadActivity.tsx', import.meta.url),
  'utf8',
);

describe('lead call note history', () => {
  it('returns stored notes with their authors without moving or rewriting old data', () => {
    expect(routes).toContain('call.note, call.note_updated_at');
    expect(routes).toContain('call.note_author_id, note_author.full_name AS note_author_name');
    expect(routes).toContain('LEFT JOIN users note_author ON note_author.id = call.note_author_id');
    expect(routes).not.toContain('INSERT INTO academy_lead_comments SELECT');
    expect(activity).toContain('note: item.note');
    expect(activity).toContain("t('telephonyNote')");
  });
});
