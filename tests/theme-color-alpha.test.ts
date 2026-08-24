import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = readFileSync(new URL('../tailwind.config.ts', import.meta.url), 'utf8');

/** The `colors: { … }` object, matched by brace depth rather than by regex. */
const colorsBlock = () => {
  const start = config.indexOf('      colors: {');
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  let index = config.indexOf('{', start);
  for (; index < config.length; index += 1) {
    if (config[index] === '{') depth += 1;
    else if (config[index] === '}') {
      depth -= 1;
      if (depth === 0) return config.slice(start, index + 1);
    }
  }
  throw new Error('colors block is unbalanced');
};

describe('theme colours carry an alpha channel', () => {
  /*
    Every theme colour is a CSS variable holding a whole colour — `hsl(…)`,
    `#fff`, or another variable — not the bare channel triplet Tailwind expects.
    Tailwind cannot slice alpha out of a value it cannot parse, and instead of
    failing it emits *nothing*: `bg-card/95`, `bg-muted/40` and
    `bg-background/85` produced no rule at all. That left the sidebar drawer,
    the board columns and the sticky header with no background whatsoever —
    invisible on a desktop, where those panels sit on a page of the same
    colour, and glaring on a phone, where the drawer is `fixed` above the page
    and the whole screen showed through the navigation.

    79 of the 86 colour/opacity utilities in the client were dead this way.
  */
  it('routes every theme colour through the alpha-aware helper', () => {
    const bareVariables = [...colorsBlock().matchAll(/"var\((--[a-z0-9-]+)\)"/g)]
      .map((match) => match[1]);

    expect(
      bareVariables,
      'a bare var() colour silently drops every /opacity utility built on it',
    ).toEqual([]);
  });

  it('defines the helper as a color-mix over <alpha-value>', () => {
    expect(config).toContain('const themeColor = (variable: string) =>');
    // `<alpha-value>` is the placeholder Tailwind substitutes — 1 when no
    // modifier is given, which resolves back to the untouched colour.
    expect(config).toContain('calc(<alpha-value> * 100%), transparent)');
  });

  it('leaves shadows alone — they are not colours', () => {
    const shadows = config.slice(config.indexOf('boxShadow'), config.indexOf('      colors: {'));
    expect(shadows).toContain('var(--shadow-');
    expect(shadows).not.toContain('themeColor(');
  });
});
