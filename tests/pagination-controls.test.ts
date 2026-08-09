import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const pagination = read('../client/src/components/ux/PaginationControls.tsx');
const dataTable = read('../client/src/components/ux/DataTable.tsx');
const audit = read('../client/src/pages/admin/audit.tsx');
const callJournal = read('../client/src/pages/sales/CallJournalPage.tsx');

describe('shared pagination controls', () => {
  it('owns the common layout, page-size options, labels, and arrow controls', () => {
    expect(pagination).toContain("const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;");
    expect(pagination).toContain("t('paginationRange')");
    expect(pagination).toContain("aria-label={t('paginationNavigation')}");
    expect(pagination).toContain("aria-label={t('previousPage')}");
    expect(pagination).toContain("aria-label={t('nextPage')}");
    expect(pagination).toContain('border-t border-border/70 bg-muted/10 px-4 py-3');
  });

  it('is the only pagination renderer used by tables and server-paginated journals', () => {
    for (const source of [dataTable, audit, callJournal]) {
      expect(source).toContain("import { PaginationControls } from '@/components/ux/PaginationControls';");
      expect(source).toContain('<PaginationControls');
      expect(source).not.toContain("t('previousPage')");
      expect(source).not.toContain("t('nextPage')");
    }
  });
});
