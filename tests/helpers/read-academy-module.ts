import { readFileSync, readdirSync } from 'node:fs';

const academyModuleUrl = new URL('../../server/modules/academy/', import.meta.url);
const leadsModuleUrl = new URL('../../server/modules/leads/', import.meta.url);

const readTypeScriptTree = (directory: URL): string[] => (
  readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory);
      if (entry.isDirectory()) return readTypeScriptTree(url);
      return entry.name.endsWith('.ts') ? [readFileSync(url, 'utf8')] : [];
    })
);

export const readAcademyModuleSource = () => (
  [
    ...readTypeScriptTree(academyModuleUrl),
    ...readTypeScriptTree(leadsModuleUrl),
  ]
    .join('\n')
);
