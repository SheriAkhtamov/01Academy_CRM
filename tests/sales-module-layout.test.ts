import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const dataTable = read('../client/src/components/ux/DataTable.tsx');
const salesDashboard = read('../client/src/pages/sales-dashboard.tsx');
const messages = read('../client/src/pages/sales/InstagramMessagesPage.tsx');

const clientRoot = fileURLToPath(new URL('../client/src', import.meta.url));
const tsxFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith('.tsx') ? [full] : [];
  });

/**
 * `className` styles the DataTable's inner scroller, `rootClassName` its outer
 * wrapper. A scroller asking for `h-full`/`flex-1` only resolves to a real
 * height when that wrapper is itself a flex column with a definite height —
 * otherwise the height silently collapses to `auto`, the rows overflow the
 * surrounding card and neither the list nor the pagination can be reached.
 */
const heightConstrainedTables = () =>
  tsxFiles(clientRoot).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(/<DataTable\b([\s\S]*?)columns=/g)]
      .map((match) => ({
        file: relative(clientRoot, file),
        line: source.slice(0, match.index).split('\n').length,
        className: match[1].match(/className="([^"]*)"/)?.[1] ?? '',
        rootClassName: match[1].match(/rootClassName="([^"]*)"/)?.[1] ?? '',
      }))
      .filter(({ className }) => /\b(h-full|flex-1)\b/.test(className));
  });

describe('sales module layout', () => {
  it('keeps the archived lead rows scrollable inside their card', () => {
    expect(dataTable).toContain('rootClassName?: string;');
    expect(dataTable).toContain('<div className={cn(rootClassName)} aria-busy={isLoading}>');
    expect(salesDashboard).toContain('rootClassName="flex h-full min-h-0 flex-col"');
    expect(salesDashboard).toContain('className="min-h-0 flex-1 overflow-auto overscroll-contain"');
  });

  it('keeps the client roster scrollable instead of clipping it against the card', () => {
    const studentsTab = salesDashboard.slice(salesDashboard.indexOf('function StudentsTab('));
    expect(studentsTab).toContain('rootClassName="flex h-full min-h-0 flex-col"');
    expect(studentsTab).toContain('className="min-h-0 flex-1 overflow-auto overscroll-contain"');
    expect(studentsTab).not.toContain('className="h-full overflow-auto overscroll-contain"');
  });

  it('anchors every height-constrained DataTable to a flex-column root', () => {
    const tables = heightConstrainedTables();
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(
        table.rootClassName,
        `${table.file}:${table.line} constrains the DataTable scroller with "${table.className}" but its root cannot give it a height`,
      ).toMatch(/(?=.*\bflex\b)(?=.*\bh-full\b)(?=.*\bmin-h-0\b)(?=.*\bflex-col\b)/);
    }
  });

  it('gives the conversations module the remaining viewport height without duplicate header spacing', () => {
    expect(messages).toContain('<ModulePage contained className="[&>[data-page-header]]:mb-0">');
    expect(messages).toContain('className="mt-3 flex min-h-[30rem] flex-1 flex-col overflow-hidden');
    expect(messages).not.toContain('lg:mt-6');
  });
});
