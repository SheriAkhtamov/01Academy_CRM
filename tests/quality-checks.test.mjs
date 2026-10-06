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

const root = fileURLToPath(new URL('..', import.meta.url));
const lint = (source) => new Linter().verify(source, [{
  files: ['**/*.tsx'],
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { 'crm-a11y': crmA11y },
  rules: { 'crm-a11y/icon-button-name': 'error', 'crm-a11y/clickable-element-role': 'error' },
}], { filename: 'fixture.tsx' });

const runGuard = (script, files) => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'crm-quality-'));
  try {
    for (const directory of ['client/src/lib', 'server', 'shared', 'scripts']) {
      mkdirSync(path.join(fixture, directory), { recursive: true });
    }
    copyFileSync(path.join(root, 'scripts', script), path.join(fixture, 'scripts', script));
    symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'dir');
    for (const [file, contents] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
      writeFileSync(path.join(fixture, file), contents);
    }
    return spawnSync(process.execPath, [path.join(fixture, 'scripts', script)], {
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

  it('allows large files but still blocks forbidden dependencies and cycles', () => {
    const large = runGuard('check-architecture.mjs', { 'client/src/large.ts': '// line\n'.repeat(1201) });
    expect(large.status).toBe(0);
    expect(large.stderr).toContain('Non-blocking file size warnings');
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
