import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const projectRoot = process.cwd();
const sourceRoots = ['client/src', 'server', 'shared'];
const sourceExtensions = ['.ts', '.tsx'];

const legacyLineBudgets = new Map(Object.entries({
  'client/src/components/ux/LeadDetailSheet.tsx': 2_100,
  'client/src/lib/i18n.ts': 2_500,
  'client/src/pages/academy-settings.tsx': 2_300,
  'client/src/pages/admin.tsx': 1_600,
  'client/src/pages/admin/AdminDashboardPage.tsx': 1_100,
  'client/src/pages/finance-center.tsx': 850,
  'client/src/pages/marketing-module.tsx': 950,
  'client/src/pages/sales-dashboard.tsx': 1_900,
  'client/src/pages/sales/InstagramMessagesPage.tsx': 2_850,
  'client/src/pages/teacher-module.tsx': 2_100,
  'server/modules/academy/academy-leads.ts': 1_900,
  'server/modules/academy/leads.router.ts': 2_000,
  'server/modules/academy/operations.router.ts': 1_300,
  'server/routes/telephony.routes.ts': 1_650,
  'server/routes/user.routes.ts': 1_300,
  'server/services/instagram.ts': 2_700,
  'shared/schema.ts': 1_650,
}));

const compositionBudgets = new Map(Object.entries({
  'client/src/App.tsx': 50,
  'client/src/app/AppProviders.tsx': 100,
  'server/index.ts': 30,
  'server/routes/index.ts': 80,
  'server/modules/academy/academy.router.ts': 100,
}));

const walk = (directory) => {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(absolutePath));
    } else if (sourceExtensions.includes(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }
  return files;
};

const files = sourceRoots.flatMap((root) => walk(path.join(projectRoot, root)));
const fileSet = new Set(files.map((file) => path.normalize(file)));
const failures = [];

const relativePath = (file) => path.relative(projectRoot, file).split(path.sep).join('/');
const resolveInternalImport = (fromFile, specifier) => {
  let basePath;
  if (specifier.startsWith('@/')) {
    basePath = path.join(projectRoot, 'client/src', specifier.slice(2));
  } else if (specifier.startsWith('@shared/')) {
    basePath = path.join(projectRoot, 'shared', specifier.slice('@shared/'.length));
  } else if (specifier.startsWith('.')) {
    basePath = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }

  const candidates = [
    basePath,
    ...sourceExtensions.map((extension) => `${basePath}${extension}`),
    ...sourceExtensions.map((extension) => path.join(basePath, `index${extension}`)),
  ];
  return candidates.map(path.normalize).find((candidate) => fileSet.has(candidate)) ?? null;
};

const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const graph = new Map();

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const from = relativePath(file);
  const dependencies = [];

  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    const resolved = resolveInternalImport(file, specifier);
    if (!resolved) continue;
    dependencies.push(resolved);

    const target = relativePath(resolved);
    if (from.startsWith('shared/') && (target.startsWith('client/') || target.startsWith('server/'))) {
      failures.push(`${from}: shared code must not depend on ${target}`);
    }
    if (from.startsWith('client/') && target.startsWith('server/')) {
      failures.push(`${from}: client code must not depend on ${target}`);
    }
    if (from.startsWith('server/') && target.startsWith('client/')) {
      failures.push(`${from}: server code must not depend on ${target}`);
    }
    if (
      from.startsWith('server/modules/')
      && (target.startsWith('server/app/') || target === 'server/index.ts')
    ) {
      failures.push(`${from}: domain modules must not depend on composition root ${target}`);
    }
    if (
      from.startsWith('client/src/features/')
      && (target.startsWith('client/src/pages/') || target.startsWith('client/src/app/'))
    ) {
      failures.push(`${from}: features must not depend on pages or app composition (${target})`);
    }
  }

  graph.set(file, [...new Set(dependencies)]);

  const lines = source.split(/\r?\n/).length - 1;
  const maximum = compositionBudgets.get(from)
    ?? legacyLineBudgets.get(from)
    ?? 1_200;
  if (lines > maximum) {
    failures.push(`${from}: ${lines} lines exceeds architectural budget ${maximum}`);
  }
}

const visitState = new Map();
const visitStack = [];
const cycles = new Set();

const canonicalCycle = (cycle) => {
  const items = cycle.slice(0, -1).map(relativePath);
  const rotations = items.map((_, index) => [
    ...items.slice(index),
    ...items.slice(0, index),
  ]);
  rotations.sort((left, right) => left.join('\0').localeCompare(right.join('\0')));
  return [...rotations[0], rotations[0][0]].join(' -> ');
};

const visit = (file) => {
  visitState.set(file, 1);
  visitStack.push(file);

  for (const dependency of graph.get(file) ?? []) {
    if (!visitState.has(dependency)) {
      visit(dependency);
    } else if (visitState.get(dependency) === 1) {
      const cycleStart = visitStack.indexOf(dependency);
      cycles.add(canonicalCycle([...visitStack.slice(cycleStart), dependency]));
    }
  }

  visitStack.pop();
  visitState.set(file, 2);
};

for (const file of files) {
  if (!visitState.has(file)) visit(file);
}
for (const cycle of cycles) {
  failures.push(`circular dependency: ${cycle}`);
}

if (failures.length > 0) {
  console.error('[architecture check] Failed:');
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Architecture check passed: ${files.length} source files, `
  + `${[...graph.values()].reduce((total, dependencies) => total + dependencies.length, 0)} internal dependencies.`,
);
