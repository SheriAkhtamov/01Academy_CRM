import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['client/src'];
const EXTENSIONS = new Set(['.tsx', '.jsx']);

const findings = [];

function scanFile(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNum = index + 1;

    // Rule 1: Icon buttons without aria-label, title, or visible text
    if (
      (line.includes('size="icon"') || line.includes("size='icon'")) &&
      line.includes('<Button') &&
      !line.includes('aria-label=') &&
      !line.includes('title=') &&
      !line.includes('aria-labelledby=')
    ) {
      // Check if self-closing or next lines have label
      if (line.includes('/>') || line.includes('>')) {
        findings.push(`${path}:${lineNum}: Icon-only Button missing 'aria-label' or 'title' attribute`);
      }
    }

    // Rule 2: <img> elements missing alt attribute
    if (line.includes('<img ') && !line.includes('alt=') && !line.includes('aria-hidden=')) {
      findings.push(`${path}:${lineNum}: <img> tag missing 'alt' or 'aria-hidden' attribute`);
    }

    // Rule 3: Clickable div/span with onClick but no role or tabIndex
    if (
      (line.includes('<div ') || line.includes('<span ')) &&
      line.includes('onClick=') &&
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
  console.warn(`[a11y check] Found ${findings.length} potential accessibility warning(s):`);
  findings.slice(0, 10).forEach((finding) => console.warn(`  - ${finding}`));
  if (findings.length > 10) {
    console.warn(`  ... and ${findings.length - 10} more warnings.`);
  }
} else {
  console.log('Accessibility (a11y) static check passed clean!');
}
