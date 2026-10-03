import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const buildAdvisory = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
const reviewDeadline = Date.parse('2026-11-03T00:00:00Z');
const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

export const validateAuditReport = (report) => {
  if (report?.error || !report?.vulnerabilities || !report?.metadata?.vulnerabilities) {
    throw new Error('Dependency audit did not return a complete report.');
  }
};

export const validateTailwindPatterns = (source) => {
  const file = ts.createSourceFile('tailwind.config.ts', source, ts.ScriptTarget.Latest, true);
  let content;
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(file) === 'content') {
      if (content) throw new Error('Multiple Tailwind content configurations require review.');
      content = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!content || !ts.isArrayLiteralExpression(content) || content.elements.length === 0) {
    throw new Error('Tailwind content must use static, repository-owned patterns.');
  }
  for (const node of content.elements) {
    if (!ts.isStringLiteral(node)) {
      throw new Error('Dynamic Tailwind content patterns require security review.');
    }
    const pattern = node.text;
    if (!pattern.startsWith('./client/') || pattern.includes('..') || pattern.length > 256) {
      throw new Error('Tailwind content pattern is outside the permitted build scope.');
    }
    let depth = 0;
    for (const character of pattern) {
      if (character === '{') depth += 1;
      if (character === '}') depth -= 1;
      if (depth < 0 || depth > 8) throw new Error('Unsafe Tailwind brace nesting.');
    }
    if (depth !== 0) throw new Error('Unbalanced Tailwind content pattern.');
  }
};

export const evaluateAudit = (report, lock, { now = Date.now(), tailwindSource = '' } = {}) => {
  validateAuditReport(report);
  const vulnerabilities = report.vulnerabilities;
  const entries = Object.entries(vulnerabilities).filter(([, entry]) => (
    (severityRank[entry.severity] ?? Infinity) >= severityRank.moderate
  ));
  const buildOnly = (entry) => (
    Array.isArray(entry.nodes) && entry.nodes.length > 0
    && entry.nodes.every((node) => lock.packages?.[node]?.dev === true)
  );
  const coveredByBuildAdvisory = (name, ancestors = new Set()) => {
    if (ancestors.has(name)) return false;
    const entry = vulnerabilities[name];
    if (!entry || !buildOnly(entry) || !Array.isArray(entry.via) || entry.via.length === 0) return false;
    const visited = new Set([...ancestors, name]);
    return entry.via.every((via) => {
      if (typeof via === 'string') return coveredByBuildAdvisory(via, visited);
      return name === 'braces' && via.url === buildAdvisory
        && entry.nodes.every((node) => lock.packages[node].version === '3.0.3');
    });
  };
  const blocked = [];
  const deferred = [];
  let patternsValidated = false;
  for (const [name] of entries) {
    if (now < reviewDeadline && coveredByBuildAdvisory(name)) {
      if (!patternsValidated) {
        validateTailwindPatterns(tailwindSource);
        patternsValidated = true;
      }
      deferred.push(name);
    } else {
      blocked.push(name);
    }
  }
  return { blocked, deferred, advisory: buildAdvisory };
};
