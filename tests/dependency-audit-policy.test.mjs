import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluateAudit, validateTailwindPatterns } from '../scripts/security/audit-policy.mjs';

const advisory = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
const options = {
  now: Date.parse('2026-10-03T00:00:00Z'),
  tailwindSource: 'export default { content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"] }',
};
const fixture = () => ({
  report: {
    metadata: { vulnerabilities: { high: 2, total: 2 } },
    vulnerabilities: {
      braces: { severity: 'high', nodes: ['node_modules/braces'], via: [{ url: advisory }] },
      tailwindcss: { severity: 'high', nodes: ['node_modules/tailwindcss'], via: ['braces'] },
    },
  },
  lock: { packages: {
    'node_modules/braces': { version: '3.0.3', dev: true },
    'node_modules/tailwindcss': { version: '3.4.18', dev: true },
  } },
});

describe('dependency audit policy', () => {
  it('allows only the bounded build advisory and its transitive findings', () => {
    const { report, lock } = fixture();
    expect(evaluateAudit(report, lock, options)).toMatchObject({ blocked: [], deferred: ['braces', 'tailwindcss'] });
  });
  it('blocks the advisory when any affected package enters production dependencies', () => {
    const { report, lock } = fixture();
    delete lock.packages['node_modules/braces'].dev;
    expect(evaluateAudit(report, lock, options).blocked).toEqual(['braces', 'tailwindcss']);
  });
  it('blocks new advisories even when they share the same package', () => {
    const { report, lock } = fixture();
    report.vulnerabilities.braces.via.push({ url: 'https://github.com/advisories/GHSA-other' });
    expect(evaluateAudit(report, lock, options).blocked).toEqual(['braces', 'tailwindcss']);
  });
  it('blocks unrelated development vulnerabilities', () => {
    const { report, lock } = fixture();
    report.vulnerabilities.unrelated = { severity: 'moderate', nodes: ['node_modules/unrelated'], via: [{ url: 'other' }] };
    lock.packages['node_modules/unrelated'] = { version: '1.0.0', dev: true };
    expect(evaluateAudit(report, lock, options).blocked).toEqual(['unrelated']);
  });
  it('requires review after the deadline or a different braces version', () => {
    const { report, lock } = fixture();
    expect(evaluateAudit(report, lock, { ...options, now: Date.parse('2026-11-03T00:00:00Z') }).blocked).toEqual(['braces', 'tailwindcss']);
    lock.packages['node_modules/braces'].version = '3.0.4';
    expect(evaluateAudit(report, lock, options).blocked).toEqual(['braces', 'tailwindcss']);
  });
  it('fails closed for incomplete reports and dependency cycles', () => {
    const { report, lock } = fixture();
    expect(() => evaluateAudit({ error: { code: 'ENETWORK' } }, lock, options)).toThrow();
    expect(() => evaluateAudit({}, lock, options)).toThrow();
    report.vulnerabilities.braces.via = ['tailwindcss'];
    expect(evaluateAudit(report, lock, options).blocked).toEqual(['braces', 'tailwindcss']);
  });
  it('accepts the real static content configuration', () => {
    expect(() => validateTailwindPatterns(readFileSync(new URL('../tailwind.config.ts', import.meta.url), 'utf8'))).not.toThrow();
  });
  it.each([
    'export default { content: process.env.CONTENT }',
    'export default { content: ["./client/" + input] }',
    'export default { content: ["./uploads/**/*.html"] }',
    'export default { content: ["./client/../uploads/*.html"] }',
    `export default { content: ["./client/${'{'.repeat(10)}x${'}'.repeat(10)}"] }`,
    'export default { content: ["./client/{x"] }',
  ])('rejects untrusted or deeply nested glob input: %s', (source) => {
    expect(() => validateTailwindPatterns(source)).toThrow();
  });
});
