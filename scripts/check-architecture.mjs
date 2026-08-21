import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const projectRoot = process.cwd();
const sourceRoots = ['client/src', 'server', 'shared'];
const sourceExtensions = ['.ts', '.tsx'];

// A line budget is a proxy for logic complexity, which a translation
// dictionary does not have: it is flat data, one line per key. Capping it only
// pressured authors into shortening user-facing text to reclaim lines, so the
// file is measured by the i18n audit (npm run check:i18n) instead.
const lineBudgetExemptions = new Set(['client/src/lib/i18n.ts']);

const legacyLineBudgets = new Map(Object.entries({
  'client/src/components/ux/LeadDetailSheet.tsx': 1_900,
  'client/src/pages/academy-settings.tsx': 2_300,
  'client/src/pages/admin.tsx': 1_600,
  'client/src/pages/admin/AdminDashboardPage.tsx': 1_100,
  'client/src/pages/finance-center.tsx': 850,
  'client/src/pages/marketing-module.tsx': 950,
  'client/src/pages/sales-dashboard.tsx': 1_800,
  'client/src/pages/sales/InstagramMessagesPage.tsx': 2_850,
  'client/src/pages/teacher-module.tsx': 2_100,
  'server/modules/academy/academy-leads.ts': 1_850,
  'server/modules/academy/leads.router.ts': 1_600,
  'server/modules/academy/operations.router.ts': 1_300,
  'server/routes/telephony.routes.ts': 1_750,
  'server/routes/user.routes.ts': 1_300,
  'server/services/instagram.ts': 2_700,
  'server/db/schema/index.ts': 1_620,
}));

const compositionBudgets = new Map(Object.entries({
  'client/src/App.tsx': 50,
  'client/src/app/AppProviders.tsx': 100,
  'server/index.ts': 30,
  'server/routes/index.ts': 80,
  'server/modules/academy/academy.router.ts': 100,
}));

// Ratchets let legacy code shrink incrementally without allowing new boundary
// leaks. Remove an entry (or lower its count) as each vertical slice migrates.
const clientTransportRatchet = new Map(Object.entries({
  'client/src/components/Header.tsx': 3,
  'client/src/components/modals/SettingsModal.tsx': 1,
  'client/src/components/ux/AdminScheduleCalendar.tsx': 1,
  'client/src/components/ux/AvailabilityCalendar.tsx': 1,
  'client/src/components/ux/CommandPalette.tsx': 1,
  'client/src/components/ux/SalesOverviewMetrics.tsx': 1,
  'client/src/components/ux/board/CreateTaskDialog.tsx': 1,
  'client/src/components/ux/board/TaskDetailSheet.tsx': 10,
  'client/src/contexts/TelephonyContext.tsx': 5,
  'client/src/pages/academy-settings.tsx': 16,
  'client/src/pages/academy.tsx': 3,
  'client/src/pages/admin-leads.tsx': 3,
  'client/src/pages/admin.tsx': 7,
  'client/src/pages/admin/AdminDashboardPage.tsx': 2,
  'client/src/pages/admin/audit.tsx': 1,
  'client/src/pages/finance-center.tsx': 11,
  'client/src/pages/marketing-module.tsx': 3,
  'client/src/pages/sales/CallJournalPage.tsx': 1,
  'client/src/pages/sales/InstagramMessagesPage.tsx': 7,
  'client/src/pages/teacher-module.tsx': 3,
}));

const serverPersistenceRatchet = new Map(Object.entries({
  'server/modules/academy/academy-analytics.ts': 2,
  'server/modules/academy/academy-core.ts': 2,
  'server/modules/academy/academy-leads.ts': 2,
  'server/modules/academy/academy-route-support.ts': 2,
  'server/modules/academy/academy-scheduling.ts': 2,
  'server/modules/academy/crud-router.ts': 2,
  'server/modules/academy/leads.router.ts': 2,
  'server/modules/academy/learning.router.ts': 2,
  'server/modules/academy/module.router.ts': 2,
  'server/modules/academy/operations.router.ts': 2,
  'server/modules/academy/resources.router.ts': 2,
  'server/routes/auth.routes.ts': 2,
  'server/routes/board.routes.ts': 2,
  'server/routes/finance.routes.ts': 1,
  'server/routes/incoming.routes.ts': 1,
  'server/routes/message.routes.ts': 1,
  'server/routes/notifications.routes.ts': 1,
  'server/routes/telephony-recording.routes.ts': 1,
  'server/routes/telephony.routes.ts': 1,
  'server/routes/user.routes.ts': 2,
}));

const countMatches = (source, pattern) => [...source.matchAll(pattern)].length;

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

  if (
    from.startsWith('client/src/pages/')
    || from.startsWith('client/src/components/')
    || from.startsWith('client/src/contexts/')
  ) {
    const transportCalls = countMatches(source, /\b(?:apiRequest|fetch)\s*\(/g);
    const allowedCalls = clientTransportRatchet.get(from) ?? 0;
    if (transportCalls > allowedCalls) {
      failures.push(
        `${from}: ${transportCalls} direct transport call(s) exceeds ratchet ${allowedCalls}; `
        + 'move network access into a feature API',
      );
    }
  }

  if (
    from.startsWith('client/src/features/')
    && /\/(?:components|ui)\//.test(from)
    && /\b(?:apiRequest|fetch)\s*\(/.test(source)
  ) {
    failures.push(`${from}: feature UI must use feature hooks instead of direct transport calls`);
  }

  const persistenceImports = [...source.matchAll(importPattern)].filter((match) => {
    const specifier = match[1] ?? match[2] ?? '';
    return /(?:^|\/)(?:db|storage)(?:\/|$)/.test(specifier);
  }).length;
  const allowedPersistenceImports = serverPersistenceRatchet.get(from) ?? 0;
  if (
    (from.startsWith('server/routes/') || from.startsWith('server/modules/'))
    && persistenceImports > allowedPersistenceImports
  ) {
    failures.push(
      `${from}: ${persistenceImports} direct persistence import(s) exceeds ratchet `
      + `${allowedPersistenceImports}; depend on an application port instead`,
    );
  }

  if (
    /server\/modules\/[^/]+\/(?:domain|application)\//.test(from)
    && /from ['"][^'"]*(?:express|\/db|\/storage|\/infrastructure)[^'"]*['"]/.test(source)
  ) {
    failures.push(`${from}: domain/application code must not depend on HTTP or infrastructure`);
  }

  if (
    /server\/modules\/[^/]+\/http\//.test(from)
    && /from ['"][^'"]*(?:\/db|\/storage)[^'"]*['"]/.test(source)
  ) {
    failures.push(`${from}: HTTP adapters must not import persistence directly`);
  }

  if (
    from.startsWith('client/')
    && /@shared\/schema/.test(source)
  ) {
    failures.push(`${from}: client code must use shared contracts, not the persistence schema`);
  }

  if (from.startsWith('shared/') && /from ['"]drizzle-(?:orm|zod)/.test(source)) {
    failures.push(`${from}: shared code must not depend on persistence libraries`);
  }

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

  if (!lineBudgetExemptions.has(from)) {
    const lines = source.split(/\r?\n/).length - 1;
    const maximum = compositionBudgets.get(from)
      ?? legacyLineBudgets.get(from)
      ?? 1_200;
    if (lines > maximum) {
      failures.push(`${from}: ${lines} lines exceeds architectural budget ${maximum}`);
    }
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
