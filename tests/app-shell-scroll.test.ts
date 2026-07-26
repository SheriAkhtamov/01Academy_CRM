import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const layout = read('../client/src/components/Layout.tsx');
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

  it('gives dashboard pages one explicit vertical scroll owner', () => {
    expect(layout).toContain(
      "'overflow-y-auto overflow-x-clip overscroll-y-contain [scrollbar-gutter:stable]'",
    );
    expect(layout).toContain("data-app-scroll={containsOwnScrollArea ? 'contained' : 'document'}");
  });
});
