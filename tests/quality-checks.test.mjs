import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import crmA11y from '../scripts/eslint-a11y.mjs';
import { reviewMaintainability as reviewSource } from '../scripts/lib/source-maintainability.mjs';

const reviewMaintainability = (file, source) => reviewSource(file, source).map((warning) => warning.message);

const root = fileURLToPath(new URL('..', import.meta.url));
const lint = (source) => new Linter().verify(source, [{
  files: ['**/*.tsx'],
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { 'crm-a11y': crmA11y },
  rules: { 'crm-a11y/icon-button-name': 'error', 'crm-a11y/clickable-element-role': 'error' },
}], { filename: 'fixture.tsx' });

const runGuard = (script, files, args = []) => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'crm-quality-'));
  try {
    for (const directory of ['client/src/lib', 'server', 'shared', 'scripts']) {
      mkdirSync(path.join(fixture, directory), { recursive: true });
    }
    copyFileSync(path.join(root, 'scripts', script), path.join(fixture, 'scripts', script));
    if (script === 'check-architecture.mjs') {
      mkdirSync(path.join(fixture, 'scripts/lib'), { recursive: true });
      copyFileSync(path.join(root, 'scripts/lib/source-maintainability.mjs'), path.join(fixture, 'scripts/lib/source-maintainability.mjs'));
    }
    symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
    for (const [file, contents] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
      writeFileSync(path.join(fixture, file), contents);
    }
    return spawnSync(process.execPath, [path.join(fixture, 'scripts', script), ...args], {
      cwd: fixture, encoding: 'utf8',
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
};

describe('accessibility rules in ESLint', () => {
  it('catches missing names regardless of line breaks or comments', () => {
    expect(lint('<Button\n size={"icon"}\n>{/* aria-label="fake" */}<Trash /></Button>'))
      .toMatchObject([{ ruleId: 'crm-a11y/icon-button-name' }]);
    expect(lint('<Button size="icon" aria-label=""><Trash /></Button>')).toHaveLength(1);
  });

  it.each([
    '<Button size="icon" aria-label={t("delete")}><Trash /></Button>',
    '<Button size="icon" title={t("delete")}><Trash /></Button>',
    '<Button size="icon"><Trash /><span className="sr-only">{t("delete")}</span></Button>',
    '<Button size="icon" {...props}><Trash /></Button>',
  ])('accepts supported accessible names: %s', (source) => {
    expect(lint(source)).toEqual([]);
  });

  it('keeps click target semantics without treating a hidden backdrop as a button', () => {
    expect(lint('<div\n onClick={save}\n/>')).toMatchObject([{ ruleId: 'crm-a11y/clickable-element-role' }]);
    expect(lint('<div onClick={save}\n role="button" tabIndex={0}/>')).toEqual([]);
    expect(lint('<div onClick={close} aria-hidden="true"/>')).toEqual([]);
    expect(lint('<div onClick={(event) => event.stopPropagation()}/>')).toEqual([]);
    expect(lint('<div onClick={(event) => { event.stopPropagation(); save(); }}/>')).toHaveLength(1);
  });
});

describe('blocking source checks', () => {
  const dictionary = `export const translations = {
    save: { en: 'Save', ru: 'Сохранить' },
    otherSave: { en: 'Save', ru: 'Сохранить' },
    cancel: { en: 'Cancel', ru: 'Отменить' },
  };`;
  const i18n = (view, translations = dictionary) => runGuard('check-i18n.mjs', {
    'client/src/lib/i18n.ts': translations,
    'client/src/View.tsx': view,
  });

  it('reports unused and identical translations without blocking valid UI', () => {
    const result = i18n('export const View = () => <button>{t("save")}</button>;');
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('unused translation key');
    expect(result.stderr).toContain('duplicate translation values');
  });

  it.each([
    'export const View = () => <button>{t("missing")}</button>;',
    'export const View = () => <button>Save</button>;',
  ])('still blocks missing translations and hardcoded UI: %s', (view) => {
    expect(i18n(view).status).toBe(1);
  });

  it('still blocks incomplete translations and duplicate keys', () => {
    expect(i18n('', "export const translations = { save: { en: 'Save' } };").status).toBe(1);
    expect(i18n('', "export const translations = { save: { en: 'Save', ru: 'Сохранить' }, save: { en: 'Save', ru: 'Сохранить' } };").status).toBe(1);
  });

  it('keeps maintainability warnings advisory', () => {
    const large = runGuard('check-architecture.mjs', { 'client/src/large.ts': 'record();\n'.repeat(650) });
    expect(large.status).toBe(0);
    expect(large.stderr).toContain('Non-blocking maintainability warnings');
    expect(large.stdout).toContain('Architecture check passed');
  });

  it('keeps the routine report short and exposes every recommendation in verbose mode', () => {
    const files = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [
      `shared/policy${index}.ts`, 'record();\n'.repeat(650 + index * 10),
    ]));
    const compact = runGuard('check-architecture.mjs', files);
    expect(compact.status).toBe(0);
    expect(compact.stderr).toContain('12 recommendation(s) in 12 file(s)');
    expect(compact.stderr.match(/code lines/g)).toHaveLength(10);
    expect(compact.stderr.split('\n')[1]).toContain('policy11.ts');
    expect(compact.stderr).toContain('--verbose for the full report');
    const verbose = runGuard('check-architecture.mjs', files, ['--verbose']);
    expect(verbose.status).toBe(0);
    expect(verbose.stderr.match(/code lines/g)).toHaveLength(12);
    expect(verbose.stderr).not.toContain('more recommendation(s)');
  });

  it('still blocks forbidden dependencies and cycles', () => {
    expect(runGuard('check-architecture.mjs', {
      'client/src/page.ts': "import '../../server/entry';",
      'server/entry.ts': 'export {};',
    }).status).toBe(1);
    expect(runGuard('check-architecture.mjs', {
      'shared/a.ts': "import './b';",
      'shared/b.ts': "import './a';",
    }).status).toBe(1);
  });
});

describe('maintainability review signals', () => {
  it('ignores blank lines, comments, imports, types and static dictionaries', () => {
    const source = [
      '\n'.repeat(900),
      '// Documentation\n'.repeat(900),
      `/**\n${' * Documentation\n'.repeat(900)} */`,
      Array.from({ length: 900 }, (_, index) => `import { item${index} } from 'library${index}';`).join('\n'),
      `export interface Payload {\n${Array.from({ length: 900 }, (_, index) => `field${index}: string;`).join('\n')}\n}`,
      `export const translations = {\n${Array.from({ length: 900 }, (_, index) => `key${index}: { en: 'Text', ru: 'Текст' },`).join('\n')}\n} as const;`,
      'export const run = () => record();',
    ].join('\n');
    expect(reviewMaintainability('client/src/large.ts', source)).toEqual([]);
  });

  it('distinguishes comments from URLs, templates and JSX content', () => {
    const content = Array.from({ length: 850 }, (_, index) => `line ${index} // text`).join('\n');
    expect(reviewMaintainability('client/src/Text.tsx', `export const View = () => <pre>${content}</pre>;`))
      .toEqual([expect.stringContaining('code lines (ui review guideline')]);
    expect(reviewMaintainability('server/services/text.ts', `export const text = \`https://example.test\n${content}\`;`))
      .toEqual([expect.stringContaining('code lines (logic review guideline')]);
    expect(reviewMaintainability('client/src/View.tsx', `export const View = () => <div>{/*\n${'comment\n'.repeat(900)}*/}</div>;`)).toEqual([]);
  });

  it('uses shared role guidelines rather than exceptions for named legacy files', () => {
    const source = 'record();\n'.repeat(650);
    expect(reviewMaintainability('server/services/new-service.ts', source))
      .toEqual([expect.stringContaining('logic review guideline')]);
    expect(reviewMaintainability('server/services/instagram.ts', source))
      .toEqual(reviewMaintainability('server/services/new-service.ts', source)
        .map((warning) => warning.replace('new-service', 'instagram')));
    expect(reviewMaintainability('client/src/pages/View.tsx', source)).toEqual([]);
    expect(reviewMaintainability('server/modules/leads/infrastructure/repository.ts', source)).toEqual([]);
    expect(reviewMaintainability('server/modules/leads/http/router.ts', source))
      .toEqual([expect.stringContaining('http review guideline')]);
    expect(reviewMaintainability('server/modules/academy/academy.router.ts', 'record();\n'.repeat(250)))
      .toEqual([expect.stringContaining('composition review guideline')]);
  });

  it('does not impose file size warnings on contracts or database schemas', () => {
    const source = 'export const schema = factory({\n' + Array.from({ length: 1_500 }, (_, index) => `field${index}: factory.string(),`).join('\n') + '\n});';
    expect(reviewMaintainability('shared/contracts/example.ts', source)).toEqual([]);
    expect(reviewMaintainability('server/db/schema/example.ts', source)).toEqual([]);
  });

  it('counts the last line without a trailing newline and handles CRLF consistently', () => {
    const source = Array.from({ length: 601 }, () => 'record();').join('\n');
    expect(reviewMaintainability('shared/example.ts', source))
      .toEqual([expect.stringContaining('601 code lines')]);
    expect(reviewMaintainability('shared/example.ts', source.replaceAll('\n', '\r\n')))
      .toEqual(reviewMaintainability('shared/example.ts', source));
  });

  it('reports branching complexity even when a function is compressed onto one line', () => {
    const branch = 'if (condition) record();';
    const source = `export function decide() { ${branch.repeat(20)} }`;
    expect(reviewMaintainability('shared/policy.ts', source))
      .toEqual([expect.stringContaining('decide has cyclomatic complexity 21')]);
    expect(reviewMaintainability('shared/policy.ts', `export function decide() { ${branch.repeat(19)} }`)).toEqual([]);
  });

  it('assesses callbacks separately and still reviews behavior inside declaration files', () => {
    const source = `export const schema = factory(() => {\n${'if (condition) record();\n'.repeat(20)}\n});`;
    const warnings = reviewMaintainability('shared/contracts/example.ts', source);
    expect(warnings).toEqual([expect.stringContaining('<anonymous> has cyclomatic complexity 21')]);
    const parent = 'export function setup() {\n' + Array.from({ length: 30 }, (_, index) => `const callback${index} = () => { if (condition) record(); };`).join('\n') + '\n}';
    expect(reviewMaintainability('server/app/setup.ts', parent)).toEqual([]);
  });

  it('counts loops, switch cases, catches and short circuits as branches', () => {
    const source = `export const decide = () => {
      if (ready) record();
      for (;;) break;
      for (const key in values) record(key);
      for (const value of values) record(value);
      while (ready) break;
      do { record(); } while (ready);
      switch (value) { case 1: break; case 2: break; default: break; }
      try { record(); } catch { recover(); }
      return ${Array.from({ length: 12 }, () => '(ready ? ((a && b || c) ?? d) : fallback)').join(' + ')};
    };`;
    expect(reviewMaintainability('shared/policy.ts', source))
      .toEqual([expect.stringContaining('cyclomatic complexity 58')]);
  });
});
