import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientSrcDir = path.join(rootDir, 'client/src');
const i18nPath = path.join(clientSrcDir, 'lib/i18n.ts');
const ignoredDirectories = new Set(['node_modules', 'dist', '.git']);
const formatPath = (filePath) => path.relative(rootDir, filePath);

const unwrapExpression = (expression) => {
  let current = expression;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      (ts.isSatisfiesExpression && ts.isSatisfiesExpression(current)))
  ) {
    current = current.expression;
  }
  return current;
};

const getPropertyName = (name) => {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
};

const getLineColumn = (sourceFile, node) => {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${position.line + 1}:${position.character + 1}`;
};

const collectFiles = (directory, options = {}) => {
  const files = [];
  const walk = (currentDirectory) => {
    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      if (ignoredDirectories.has(entry.name)) continue;
      if (options.ignoreClientUi && entry.name === 'ui') continue;

      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        files.push(entryPath);
      }
    }
  };

  walk(directory);
  return files;
};

const parseSourceFile = (filePath) => {
  const source = fs.readFileSync(filePath, 'utf8');
  return ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
};

const readTranslations = () => {
  const sourceFile = parseSourceFile(i18nPath);
  const keys = [];
  const keySet = new Set();
  const duplicates = [];
  const invalidEntries = [];

  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === 'translations' && node.initializer) {
      const initializer = unwrapExpression(node.initializer);
      if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
        invalidEntries.push(`${formatPath(i18nPath)}:${getLineColumn(sourceFile, node)} translations is not an object literal`);
        return;
      }

      for (const property of initializer.properties) {
        if (!ts.isPropertyAssignment(property)) continue;

        const key = getPropertyName(property.name);
        if (!key) {
          invalidEntries.push(`${formatPath(i18nPath)}:${getLineColumn(sourceFile, property)} unsupported translation key syntax`);
          continue;
        }

        if (keySet.has(key)) {
          duplicates.push(`${formatPath(i18nPath)}:${getLineColumn(sourceFile, property.name)} duplicate translation key '${key}'`);
        }

        keySet.add(key);
        keys.push(key);

        const value = unwrapExpression(property.initializer);
        if (!value || !ts.isObjectLiteralExpression(value)) {
          invalidEntries.push(`${formatPath(i18nPath)}:${getLineColumn(sourceFile, property)} '${key}' must have en/ru values`);
          continue;
        }

        const languages = new Map();
        for (const languageProperty of value.properties) {
          if (!ts.isPropertyAssignment(languageProperty)) continue;
          const language = getPropertyName(languageProperty.name);
          if (language) languages.set(language, languageProperty.initializer);
        }

        for (const language of ['en', 'ru']) {
          const languageValue = languages.get(language);
          if (!languageValue || !ts.isStringLiteralLike(languageValue)) {
            invalidEntries.push(`${formatPath(i18nPath)}:${getLineColumn(sourceFile, property)} '${key}.${language}' must be a string`);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { keys, keySet, duplicates, invalidEntries };
};

const isTranslationCall = (callExpression, sourceFile) => {
  const expression = callExpression.expression;

  if (ts.isIdentifier(expression) && expression.text === 't') {
    return true;
  }

  if (ts.isPropertyAccessExpression(expression) && expression.name.text === 't') {
    return true;
  }

  return expression.getText(sourceFile) === 'i18n.t';
};

const collectTranslationReferences = (files, keySet) => {
  const references = new Map();
  const missing = [];

  const addReference = (key, location) => {
    if (!references.has(key)) references.set(key, []);
    references.get(key).push(location);
  };

  for (const filePath of files) {
    const sourceFile = parseSourceFile(filePath);
    const relativePath = formatPath(filePath);

    const visit = (node) => {
      if (ts.isCallExpression(node) && isTranslationCall(node, sourceFile)) {
        const firstArgument = node.arguments[0];
        if (firstArgument && ts.isStringLiteralLike(firstArgument)) {
          const key = firstArgument.text;
          const location = `${relativePath}:${getLineColumn(sourceFile, firstArgument)}`;

          if (keySet.has(key)) {
            addReference(key, location);
          } else {
            missing.push(`${location} missing translation key '${key}'`);
          }
        }
      }

      if (
        ts.isSatisfiesExpression &&
        ts.isSatisfiesExpression(node) &&
        node.type.getText(sourceFile).includes('TranslationKey')
      ) {
        const collectKeys = (candidate) => {
          if (ts.isStringLiteralLike(candidate) && keySet.has(candidate.text)) {
            addReference(candidate.text, `${relativePath}:${getLineColumn(sourceFile, candidate)}`);
          }
          ts.forEachChild(candidate, collectKeys);
        };
        collectKeys(node.expression);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return { references, missing };
};

const collectDuplicateObjectKeys = (files) => {
  const duplicates = [];

  for (const filePath of files) {
    const sourceFile = parseSourceFile(filePath);
    const relativePath = formatPath(filePath);

    const visit = (node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const seen = new Set();
        for (const property of node.properties) {
          if (
            !ts.isPropertyAssignment(property) &&
            !ts.isShorthandPropertyAssignment(property) &&
            !ts.isMethodDeclaration(property)
          ) {
            continue;
          }

          const key = getPropertyName(property.name);
          if (!key) continue;

          if (seen.has(key)) {
            duplicates.push(`${relativePath}:${getLineColumn(sourceFile, property.name)} duplicate object key '${key}'`);
          }
          seen.add(key);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return duplicates;
};

const collectHardcodedClientText = (files) => {
  const hardcoded = [];
  const cyrillicPattern = /[А-Яа-яЁё]/;
  const quotedTranslationPattern = /\{\s*t\(['"]/;

  for (const filePath of files) {
    if (filePath === i18nPath) continue;

    const sourceFile = parseSourceFile(filePath);
    const relativePath = formatPath(filePath);

    const report = (node, text) => {
      const value = String(text);
      if (cyrillicPattern.test(value) || quotedTranslationPattern.test(value)) {
        hardcoded.push(`${relativePath}:${getLineColumn(sourceFile, node)} hardcoded UI text ${JSON.stringify(value)}`);
      }
    };

    const visit = (node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        report(node, node.text);
      } else if (ts.isTemplateExpression(node)) {
        for (const span of node.templateSpans) {
          report(span.literal, span.literal.text);
        }
      } else if (ts.isJsxText(node)) {
        report(node, node.getText(sourceFile));
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return hardcoded;
};

const main = () => {
  const translationAudit = readTranslations();
  const allClientFiles = collectFiles(clientSrcDir);
  const appFiles = collectFiles(clientSrcDir, { ignoreClientUi: true });
  const referenceAudit = collectTranslationReferences(allClientFiles, translationAudit.keySet);
  const duplicateObjectKeys = collectDuplicateObjectKeys(allClientFiles);
  const hardcodedClientText = collectHardcodedClientText(appFiles);
  const unused = translationAudit.keys
    .filter((key) => !referenceAudit.references.has(key))
    .map((key) => `${formatPath(i18nPath)} unused translation key '${key}'`);

  const failures = [
    ...translationAudit.invalidEntries,
    ...translationAudit.duplicates,
    ...referenceAudit.missing,
    ...unused,
    ...duplicateObjectKeys,
    ...hardcodedClientText,
  ];

  if (failures.length > 0) {
    console.error(`i18n audit failed with ${failures.length} issue(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(`i18n audit passed: ${translationAudit.keys.length} keys, ${referenceAudit.references.size} referenced.`);
};

main();
