import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const dataTable = read('../client/src/components/ux/DataTable.tsx');
const salesDashboard = read('../client/src/pages/sales-dashboard.tsx');
const messages = read('../client/src/pages/sales/InstagramMessagesPage.tsx');

describe('sales module layout', () => {
  it('keeps the archived lead rows scrollable inside their card', () => {
    expect(dataTable).toContain('rootClassName?: string;');
    expect(dataTable).toContain('<div className={cn(rootClassName)}>');
    expect(salesDashboard).toContain('rootClassName="flex h-full min-h-0 flex-col"');
    expect(salesDashboard).toContain('className="min-h-0 flex-1 overflow-auto overscroll-contain"');
  });

  it('gives the conversations module the remaining viewport height without duplicate header spacing', () => {
    expect(messages).toContain('<ModulePage contained className="[&>[data-page-header]]:mb-0">');
    expect(messages).toContain('className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden');
    expect(messages).not.toContain('lg:mt-6');
  });
});
