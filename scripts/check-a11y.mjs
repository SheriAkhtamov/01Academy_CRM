import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['client/src'];
const EXTENSIONS = new Set(['.tsx', '.jsx']);

const findings = [];

function scanFile(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);

  const lineNumberAt = (offset) => text.slice(0, offset).split(/\r?\n/).length;

  for (const match of text.matchAll(/<Button\b[\s\S]*?<\/Button>/g)) {
    const button = match[0];
    const openingTag = button.slice(0, button.indexOf('>') + 1);
    if (!/size\s*=\s*["']icon["']/.test(openingTag)) continue;

    const hasAccessibleName = (
      /aria-label\s*=/.test(button)
      || /aria-labelledby\s*=/.test(button)
      || /title\s*=/.test(button)
      || /className\s*=\s*["'][^"']*sr-only/.test(button)
    );
    if (!hasAccessibleName) {
      findings.push(
        `${path}:${lineNumberAt(match.index)}: Icon-only Button missing an accessible name`,
      );
    }
  }

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    // Rule 1: <img> elements missing alt attribute
    if (line.includes('<img ') && !line.includes('alt=') && !line.includes('aria-hidden=')) {
      findings.push(`${path}:${lineNum}: <img> tag missing 'alt' or 'aria-hidden' attribute`);
    }

    // Rule 2: Clickable div/span with onClick but no role or tabIndex
    if (
      (line.includes('<div ') || line.includes('<span ')) &&
      line.includes('onClick=') &&
      !line.includes('stopPropagation()') &&
      !line.includes('role=') &&
      !line.includes('tabIndex=') &&
      !line.includes('Button')
    ) {
      findings.push(`${path}:${lineNum}: Clickable div/span with onClick missing 'role="button"' or 'tabIndex'`);
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
  console.error(`[a11y check] Found ${findings.length} accessibility error(s):`);
  findings.slice(0, 10).forEach((finding) => console.error(`  - ${finding}`));
  if (findings.length > 10) {
    console.error(`  ... and ${findings.length - 10} more errors.`);
  }
  process.exit(1);
} else {
  console.log('Accessibility (a11y) static check passed clean!');
}
