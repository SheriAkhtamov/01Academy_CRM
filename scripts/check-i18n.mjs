import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientSrcDir = path.join(rootDir, 'client/src');
const serverDir = path.join(rootDir, 'server');
const sharedDir = path.join(rootDir, 'shared');
const i18nPath = path.join(clientSrcDir, 'lib/i18n.ts');
const ignoredDirectories = new Set(['node_modules', 'dist', '.git']);
const formatPath = (filePath) => path.relative(rootDir, filePath);
const nonLocalizedValueKeys = new Set([
  'cacLabel',
  'cplColumn',
  'emailPlaceholder',
  'fromEmailPlaceholder',
  'ltvCacLabel',
  'ltvLabel',
  'npsTab',
  'passwordMinLengthPlaceholder',
  'platformName',
  'roasLabel',
  'sessionTimeoutPlaceholder',
  'smtpHostPlaceholder',
  'smtpPortPlaceholder',
  'telegramWhatsapp',
  'uzbekLang',
]);
const hardcodedTextAllowlist = new Set(['.csv', 'Enter', 'K', 'Telegram', 'WhatsApp', 'x']);
const uiTextProperties = new Set([
  'cancelLabel',
  'description',
  'detail',
  'emptyText',
  'header',
  'label',
  'message',
  'subtitle',
  'text',
  'title',
]);
const uiTextAttributes = new Set(['alt', 'aria-label', 'placeholder', 'title']);

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
  const untranslatedEntries = [];
  const duplicateValues = [];
  const valuesToKeys = new Map();

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
          } else if (languageValue.text.trim().length === 0) {
            invalidEntries.push(`${formatPath(i18nPath)}:${getLineColumn(sourceFile, languageValue)} '${key}.${language}' must not be empty`);
          }
        }

        const englishValue = languages.get('en');
        const russianValue = languages.get('ru');
        if (ts.isStringLiteralLike(englishValue) && ts.isStringLiteralLike(russianValue)) {
          const valueSignature = JSON.stringify([englishValue.text, russianValue.text]);
          if (!valuesToKeys.has(valueSignature)) valuesToKeys.set(valueSignature, []);
          valuesToKeys.get(valueSignature).push({
            key,
            location: `${formatPath(i18nPath)}:${getLineColumn(sourceFile, property.name)}`,
          });

          if (
            /[A-Za-z]/.test(russianValue.text) &&
            !/[А-Яа-яЁё]/.test(russianValue.text) &&
            !nonLocalizedValueKeys.has(key)
          ) {
            untranslatedEntries.push(
              `${formatPath(i18nPath)}:${getLineColumn(sourceFile, russianValue)} '${key}.ru' appears untranslated: ${JSON.stringify(russianValue.text)}`,
            );
          }
          if (/[А-Яа-яЁё]/.test(englishValue.text)) {
            untranslatedEntries.push(
              `${formatPath(i18nPath)}:${getLineColumn(sourceFile, englishValue)} '${key}.en' appears untranslated: ${JSON.stringify(englishValue.text)}`,
            );
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  for (const entries of valuesToKeys.values()) {
    if (entries.length < 2) continue;
    duplicateValues.push(
      `${entries.map((entry) => entry.location).join(', ')} duplicate translation values for keys: ${entries.map((entry) => `'${entry.key}'`).join(', ')}`,
    );
  }

  return {
    keys,
    keySet,
    duplicates,
    duplicateValues,
    invalidEntries,
    untranslatedEntries,
  };
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
    const isClientFile = filePath.startsWith(clientSrcDir);

    const visit = (node) => {
      if (isClientFile && ts.isCallExpression(node) && isTranslationCall(node, sourceFile)) {
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

      if (ts.isStringLiteralLike(node) && keySet.has(node.text)) {
        const parent = node.parent;
        const propertyName = ts.isPropertyAssignment(parent)
          ? getPropertyName(parent.name)
          : null;
        const isServerTranslationKey =
          propertyName === 'translationKey' ||
          propertyName === 'rewardKey' ||
          propertyName === 'error' ||
          ts.isReturnStatement(parent) ||
          (
            ts.isNewExpression(parent) &&
            parent.expression.getText(sourceFile) === 'Error'
          );

        if (isServerTranslationKey) {
          addReference(node.text, `${relativePath}:${getLineColumn(sourceFile, node)}`);
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
  const letterPattern = /[A-Za-zА-Яа-яЁё]/;

  const isAllowedText = (value) => {
    const text = value.trim().replace(/\s+/g, ' ');
    if (!text || !letterPattern.test(text)) return true;
    if (hardcodedTextAllowlist.has(text)) return true;
    if (/^(?:https?:|mailto:|tel:|\/|@)/.test(text)) return true;
    if (/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+$/.test(text)) return true;
    return false;
  };

  const isInsideTranslationCall = (node) => {
    let current = node.parent;
    while (current && !ts.isStatement(current) && !ts.isJsxExpression(current)) {
      if (ts.isCallExpression(current) && isTranslationCall(current, current.getSourceFile())) {
        return true;
      }
      current = current.parent;
    }
    return false;
  };

  const isRenderedExpressionText = (node) => {
    let current = node;
    while (current.parent && !ts.isStatement(current.parent)) {
      const parent = current.parent;
      if (ts.isJsxExpression(parent)) {
        return !ts.isJsxAttribute(parent.parent);
      }
      if (
        ts.isParenthesizedExpression(parent) ||
        ts.isAsExpression(parent) ||
        (ts.isSatisfiesExpression && ts.isSatisfiesExpression(parent))
      ) {
        current = parent;
        continue;
      }
      if (ts.isConditionalExpression(parent)) {
        if (parent.condition === current) return false;
        current = parent;
        continue;
      }
      if (ts.isBinaryExpression(parent)) {
        const operator = parent.operatorToken.kind;
        if (
          operator !== ts.SyntaxKind.BarBarToken &&
          operator !== ts.SyntaxKind.QuestionQuestionToken &&
          operator !== ts.SyntaxKind.PlusToken
        ) {
          return false;
        }
        current = parent;
        continue;
      }
      return false;
    }
    return false;
  };

  for (const filePath of files) {
    if (filePath === i18nPath) continue;

    const sourceFile = parseSourceFile(filePath);
    const relativePath = formatPath(filePath);

    const report = (node, text) => {
      const value = String(text).trim().replace(/\s+/g, ' ');
      if (isAllowedText(value)) return;
      hardcoded.push(`${relativePath}:${getLineColumn(sourceFile, node)} hardcoded UI text ${JSON.stringify(value)}`);
    };

    const visit = (node) => {
      if (ts.isJsxText(node)) {
        report(node, node.getText(sourceFile));
      } else if (ts.isStringLiteralLike(node) && !isInsideTranslationCall(node)) {
        const parent = node.parent;
        if (ts.isJsxAttribute(parent) && uiTextAttributes.has(parent.name.text)) {
          report(node, node.text);
        } else if (ts.isPropertyAssignment(parent) && uiTextProperties.has(getPropertyName(parent.name))) {
          report(node, node.text);
        } else if (ts.isArrayLiteralExpression(parent)) {
          const declaration = parent.parent;
          if (
            ts.isVariableDeclaration(declaration) &&
            /headers?/i.test(declaration.name.getText(sourceFile))
          ) {
            report(node, node.text);
          }
        } else if (isRenderedExpressionText(node)) {
          report(node, node.text);
        } else if (cyrillicPattern.test(node.text)) {
          report(node, node.text);
        }
      } else if (ts.isTemplateExpression(node)) {
        const parent = node.parent;
        const isUiTemplate =
          isRenderedExpressionText(node) ||
          (
            ts.isPropertyAssignment(parent) &&
            uiTextProperties.has(getPropertyName(parent.name))
          );
        if (isUiTemplate) {
          report(node.head, node.head.text);
          for (const span of node.templateSpans) {
            report(span.literal, span.literal.text);
          }
        }
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
  const serverFiles = collectFiles(serverDir);
  const sharedFiles = collectFiles(sharedDir);
  const referenceAudit = collectTranslationReferences(
    [...allClientFiles, ...serverFiles, ...sharedFiles],
    translationAudit.keySet,
  );
  const duplicateObjectKeys = collectDuplicateObjectKeys(allClientFiles);
  const hardcodedClientText = collectHardcodedClientText(appFiles);
  const unused = translationAudit.keys
    .filter((key) => !referenceAudit.references.has(key))
    .map((key) => `${formatPath(i18nPath)} unused translation key '${key}'`);

  const failures = [
    ...translationAudit.invalidEntries,
    ...translationAudit.untranslatedEntries,
    ...translationAudit.duplicates,
    ...translationAudit.duplicateValues,
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
