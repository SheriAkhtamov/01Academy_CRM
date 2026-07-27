import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
);
const bundlePath = path.join(root, 'dist', 'index.js');
const bundle = fs.readFileSync(bundlePath, 'utf8');
const runtimePackages = new Set([
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.optionalDependencies ?? {}),
]);
const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

const packageNameFromSpecifier = (specifier) => {
  if (specifier.startsWith('@')) {
    return specifier.split('/').slice(0, 2).join('/');
  }
  return specifier.split('/')[0];
};

const specifiers = new Set();
for (const pattern of [
  /(?:^|\n)import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
]) {
  for (const match of bundle.matchAll(pattern)) {
    specifiers.add(match[1]);
  }
}

const missingRuntimePackages = [...specifiers]
  .filter((specifier) => (
    !specifier.startsWith('.')
    && !specifier.startsWith('/')
    && !builtins.has(specifier)
  ))
  .map(packageNameFromSpecifier)
  .filter((packageName, index, values) => values.indexOf(packageName) === index)
  .filter((packageName) => !runtimePackages.has(packageName))
  .sort();

if (missingRuntimePackages.length > 0) {
  console.error(
    `Production bundle statically imports non-runtime packages: ${missingRuntimePackages.join(', ')}`,
  );
  process.exit(1);
}

console.log(
  `Production bundle dependency check passed (${specifiers.size} static imports checked).`,
);
