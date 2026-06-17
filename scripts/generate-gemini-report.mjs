import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUTPUT_PATH = path.join(ROOT, 'docs', 'gemini-project-report.md');
const SELF_PATH = path.join(ROOT, 'scripts', 'generate-gemini-report.mjs');
const MAX_INLINE_BYTES = 700_000;

const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'logs',
  'uploads',
  '.cache',
  '.vite',
  '.turbo',
]);

const SECRET_FILE_PATTERNS = [
  /^\.env(\..*)?$/,
  /^app\.config\.json$/,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /id_rsa/i,
  /credentials/i,
  /secret/i,
];

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.html',
  '.yml',
  '.yaml',
  '.sql',
  '.py',
  '.svg',
]);

const CODE_FILENAMES = new Set([
  '.dockerignore',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  'Dockerfile',
  '_redirects',
]);

const EXCLUDED_CODE_FILES = new Set([
  'package-lock.json',
  'migrations/meta/0000_snapshot.json',
]);

const EXCLUDED_TREE_FILES = new Set([
  '.DS_Store',
]);

const LANGUAGE_BY_EXTENSION = new Map([
  ['.ts', 'ts'],
  ['.tsx', 'tsx'],
  ['.js', 'js'],
  ['.mjs', 'js'],
  ['.cjs', 'js'],
  ['.json', 'json'],
  ['.css', 'css'],
  ['.html', 'html'],
  ['.yml', 'yaml'],
  ['.yaml', 'yaml'],
  ['.sql', 'sql'],
  ['.py', 'py'],
  ['.svg', 'svg'],
  ['.dockerignore', 'gitignore'],
  ['.gitignore', 'gitignore'],
  ['.gitattributes', 'gitattributes'],
  ['.editorconfig', 'ini'],
]);

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function relativeFromRoot(absolutePath) {
  return toPosix(path.relative(ROOT, absolutePath));
}

function isOutputOrSelf(absolutePath) {
  const resolved = path.resolve(absolutePath);
  return resolved === path.resolve(OUTPUT_PATH) || resolved === path.resolve(SELF_PATH);
}

function isSecretFile(relativePath) {
  const base = path.basename(relativePath);
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(base) || pattern.test(relativePath));
}

function isCodeFile(relativePath) {
  const base = path.basename(relativePath);
  const ext = path.extname(relativePath).toLowerCase();
  return CODE_EXTENSIONS.has(ext) || CODE_FILENAMES.has(base);
}

function walkDirectory(currentDir, entries = []) {
  const dirEntries = fs.readdirSync(currentDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of dirEntries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = relativeFromRoot(absolutePath);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      entries.push({ absolutePath, relativePath, type: 'directory' });
      walkDirectory(absolutePath, entries);
      continue;
    }

    if (!entry.isFile()) continue;
    if (isOutputOrSelf(absolutePath)) continue;
    if (EXCLUDED_TREE_FILES.has(entry.name)) continue;

    entries.push({ absolutePath, relativePath, type: 'file' });
  }

  return entries;
}

function buildTree(entries) {
  const root = new Map();

  for (const entry of entries) {
    const parts = entry.relativePath.split('/');
    let current = root;

    parts.forEach((part, index) => {
      const isLeaf = index === parts.length - 1;
      if (!current.has(part)) {
        current.set(part, isLeaf && entry.type === 'file' ? null : new Map());
      }

      const child = current.get(part);
      if (child instanceof Map) current = child;
    });
  }

  const lines = ['.'];

  function render(node, prefix = '') {
    const items = [...node.entries()].sort(([aName, aChild], [bName, bChild]) => {
      const aDir = aChild instanceof Map;
      const bDir = bChild instanceof Map;
      if (aDir !== bDir) return aDir ? -1 : 1;
      return aName.localeCompare(bName);
    });

    items.forEach(([name, child], index) => {
      const isLast = index === items.length - 1;
      const marker = isLast ? '+-- ' : '|-- ';
      lines.push(`${prefix}${marker}${name}`);

      if (child instanceof Map) {
        render(child, `${prefix}${isLast ? '    ' : '|   '}`);
      }
    });
  }

  render(root);
  return lines.join('\n');
}

function languageFor(relativePath) {
  const base = path.basename(relativePath);
  if (base === 'Dockerfile') return 'dockerfile';
  return LANGUAGE_BY_EXTENSION.get(path.extname(relativePath).toLowerCase()) ?? '';
}

function makeFence(content) {
  const matches = content.match(/`{3,}/g) ?? [];
  const length = Math.max(3, ...matches.map((match) => match.length + 1));
  return '`'.repeat(length);
}

function isInlineCodeCandidate(entry) {
  if (entry.type !== 'file') return false;
  if (EXCLUDED_CODE_FILES.has(entry.relativePath)) return false;
  if (isSecretFile(entry.relativePath)) return false;
  if (!isCodeFile(entry.relativePath)) return false;

  const size = fs.statSync(entry.absolutePath).size;
  return size <= MAX_INLINE_BYTES;
}

function architectureSection() {
  return `# 01 Academy CRM Project Report

## Architecture

01 Academy CRM is a full-stack CRM application for academy operations: marketing leads, sales pipeline, students, groups, lessons, attendance, finance, analytics, messaging, notifications, and external integrations.

- Frontend: React 18 + TypeScript + Vite in \`client/\`.
- Routing: \`wouter\`, with the main route tree and role guards in \`client/src/App.tsx\`.
- Client state/data: TanStack Query through \`client/src/lib/queryClient.ts\`.
- UI: Tailwind CSS, shadcn/Radix components in \`client/src/components/ui/\`, CRM UX components in \`client/src/components/ux/\`, global styles in \`client/src/index.css\`.
- Internationalization: translation keys are centralized in \`client/src/lib/i18n.ts\`, consumed through \`client/src/hooks/useTranslation.tsx\`.
- Backend: Express server in \`server/index.ts\`; modular API routes are registered from \`server/routes/index.ts\`.
- Auth/session: Express sessions backed by PostgreSQL; auth logic is in \`server/routes/auth.routes.ts\`, \`server/services/auth.ts\`, \`server/services/authSession.ts\`, and shared auth contracts in \`shared/auth.ts\`.
- Database: PostgreSQL with Drizzle ORM; schema is in \`shared/schema.ts\`, migrations are in \`migrations/\`, and storage/repository logic is in \`server/storage.ts\` and \`server/storage/\`.
- Realtime: WebSocket server is mounted at \`/ws\` from \`server/routes/index.ts\`; shared event types are in \`shared/websocket.ts\`.
- Integrations/background jobs: Telegram, WhatsApp, email, automations, scheduler, outbox worker, weekly report, and AI settings live in \`server/services/\`.
- Tests: Vitest/Supertest tests are in \`tests/\`.
- Deployment/config: Docker, docker-compose, GitHub Actions, deploy script, Vite, Tailwind, Drizzle, TypeScript, and Vitest config files live at the project root or in \`config/\`.`;
}

function buildReport() {
  const entries = walkDirectory(ROOT);
  const codeFiles = entries
    .filter(isInlineCodeCandidate)
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const chunks = [
    architectureSection(),
    '',
    '## Project Structure',
    '',
    '```text',
    buildTree(entries),
    '```',
    '',
    '## Code Contents',
    '',
  ];

  for (const file of codeFiles) {
    const content = fs.readFileSync(file.absolutePath, 'utf8').replace(/\s+$/u, '');
    const fence = makeFence(content);
    const language = languageFor(file.relativePath);

    chunks.push(
      `### ${file.relativePath}`,
      '',
      `${fence}${language}`,
      content,
      fence,
      '',
    );
  }

  return `${chunks.join('\n')}\n`;
}

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, buildReport(), 'utf8');

const stats = fs.statSync(OUTPUT_PATH);
console.log(`Generated ${relativeFromRoot(OUTPUT_PATH)} (${Math.round(stats.size / 1024)} KB)`);
