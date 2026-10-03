import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { evaluateAudit, validateAuditReport } from './security/audit-policy.mjs';

const npmAudit = (extra = []) => {
  const result = spawnSync('npm', ['audit', '--json', '--audit-level=moderate', ...extra], {
    encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error('npm audit could not run successfully.');
  }
  const report = JSON.parse(result.stdout);
  validateAuditReport(report);
  return report;
};

try {
  const production = npmAudit(['--omit=dev']);
  const runtimeFindings = Object.entries(production.vulnerabilities)
    .filter(([, finding]) => !['info', 'low'].includes(finding.severity));
  if (runtimeFindings.length) {
    throw new Error(`Production dependency audit failed: ${runtimeFindings.map(([name]) => name).join(', ')}`);
  }
  console.log('Production dependency audit passed.');
  const result = evaluateAudit(npmAudit(), JSON.parse(fs.readFileSync('package-lock.json', 'utf8')), {
    tailwindSource: fs.readFileSync('tailwind.config.ts', 'utf8'),
  });
  if (result.blocked.length) {
    throw new Error(`Dependency audit failed: ${result.blocked.join(', ')}`);
  }
  if (result.deferred.length) {
    console.warn(`Temporary build-only exception until 2026-11-03: ${result.advisory}`);
    console.warn(`Affected build packages: ${result.deferred.join(', ')}`);
  }
  console.log('Dependency audit policy passed.');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
