import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['client/src', 'server', 'shared'];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.css', '.html']);
const SUSPICIOUS_PATTERNS = [
  /(?:[\u0420\u0421][\u0400-\u04FF]){3,}/u,
  /\uFFFD/u,
];

const findings = [];

function scanFile(path) {
  const bytes = readFileSync(path);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    findings.push(`${path}:1: unexpected UTF-8 BOM`);
  }

  const text = bytes.toString('utf8');
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (SUSPICIOUS_PATTERNS.some((pattern) => pattern.test(line))) {
      findings.push(`${path}:${index + 1}: suspicious mojibake sequence`);
    }
  });
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (!EXTENSIONS.has(extname(fullPath))) {
      continue;
    }

    scanFile(fullPath);
  }
}

for (const root of ROOTS) {
  walk(root);
}

if (findings.length > 0) {
  console.error('Encoding check failed:');
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}

console.log('Encoding check passed');
