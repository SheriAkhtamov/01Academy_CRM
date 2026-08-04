import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const candidateFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
  cwd: root,
  encoding: 'utf8',
  },
).split('\0').filter(Boolean);

const forbiddenTrackedPaths = [
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)config\/app\.config\.json$/,
  /\.(?:pem|key|p12|pfx)$/,
  /(^|\/)id_(?:rsa|ed25519)(?:\.pub)?$/,
  /\.bak(?:[-.]|$)/,
];

const knownInsecureDefaults = [
  ['crm', 'password', '2026'].join('_'),
  ['Sheri', '2001'].join(''),
];

const detectors = [
  {
    id: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    id: 'github-token',
    pattern: /\bgh(?:p|o|u|s|r)_[A-Za-z0-9_]{30,}\b/,
  },
  {
    id: 'aws-access-key',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  },
  {
    id: 'slack-token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  },
  {
    id: 'openai-token',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    id: 'numeric-bot-token',
    pattern: /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/,
  },
  {
    id: 'known-insecure-default',
    pattern: new RegExp(`\\b(?:${knownInsecureDefaults.join('|')})\\b`),
  },
  {
    id: 'database-password-in-url',
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:\s/"']+:([^@\s/"']+)@/i,
    validate: (match) => {
      const password = match[1].toLowerCase();
      return ![
        'change_me',
        'change-me',
        'example',
        'placeholder',
        'password',
      ].some((placeholder) => password.includes(placeholder));
    },
  },
];

const findings = [];

for (const relativePath of candidateFiles) {
  if (
    forbiddenTrackedPaths.some((pattern) => pattern.test(relativePath))
    && !relativePath.endsWith('.env.example')
  ) {
    findings.push({ file: relativePath, line: 1, rule: 'forbidden-secret-file' });
    continue;
  }

  const absolutePath = path.join(root, relativePath);
  let stat;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    continue;
  }

  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) {
    continue;
  }

  const contents = fs.readFileSync(absolutePath);
  if (contents.includes(0)) {
    continue;
  }

  const text = contents.toString('utf8');
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const detector of detectors) {
      const match = line.match(detector.pattern);
      if (match && (!detector.validate || detector.validate(match))) {
        findings.push({
          file: relativePath,
          line: index + 1,
          rule: detector.id,
        });
      }
    }
  }
}

if (findings.length > 0) {
  console.error('Secret scan failed. Values are intentionally not printed:');
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} ${finding.rule}`);
  }
  process.exit(1);
}

console.log(`Secret scan passed (${candidateFiles.length} repository files checked).`);
