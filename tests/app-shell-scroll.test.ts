import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const layout = read('../client/src/components/Layout.tsx');
const modulePage = read('../client/src/components/ux/ModulePage.tsx');
const tasks = read('../client/src/pages/tasks.tsx');
const styles = read('../client/src/index.css');
const cssRuleBody = (selector: string) => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`))?.[1] ?? '';
};

describe('app shell scrolling', () => {
  it('uses the same dynamic viewport unit for the document root and shell', () => {
    expect(layout).toContain('className="flex h-dvh overflow-hidden"');
    expect(cssRuleBody('body')).toContain('min-height: 100dvh;');
    expect(cssRuleBody('#root')).toContain('min-height: 100dvh;');
    expect(cssRuleBody('body')).not.toContain('min-height: 100vh;');
    expect(cssRuleBody('#root')).not.toContain('min-height: 100vh;');
  });

  /**
   * The shell nests five or six height constraints between <main> and a table
   * row. Every one of them used to be paired with a hard clip, so a single
   * collapsed height anywhere in that chain put the rest of a list permanently
   * out of reach — no scrollbar, no keyboard scroll, no way back to the rows.
   * Vertical overflow now always falls through to a real scroller.
   */
  it.each(['html', 'body', '#root'])('never height-locks %s out of scrolling', (selector) => {
    const rule = cssRuleBody(selector);
    expect(rule).not.toMatch(/overflow(-y)?:\s*hidden/);
    expect(rule).not.toMatch(/max-height:/);
  });

  it('gives every route a vertical scroll owner in the app shell', () => {
    expect(layout).toContain('overflow-y-auto overflow-x-clip overscroll-y-contain');
    expect(layout).toContain("data-app-scroll={containsOwnScrollArea ? 'contained' : 'document'}");
    // Only the reserved gutter may depend on the route — never the scroller.
    expect(layout).not.toMatch(/containsOwnScrollArea\s*\n?\s*\?\s*'overflow-hidden'/);
  });

  it('lets contained module pages spill into the shell scroller instead of clipping', () => {
    expect(modulePage).toContain("? 'flex h-full min-h-0 flex-col p-4 sm:p-5 lg:p-6");
    expect(modulePage).not.toContain('flex h-full min-h-0 flex-col overflow-hidden p-4');
    // Opting out of the page scroller must not clip the axis it opted out of.
    expect(modulePage).toContain("          : 'overflow-x-clip',");
  });

  it('keeps the task board page from clipping the columns it cannot size', () => {
    expect(tasks).toContain('className="flex h-full min-h-0 flex-col p-6 lg:p-8"');
    expect(tasks).toContain('className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col"');
  });
});
