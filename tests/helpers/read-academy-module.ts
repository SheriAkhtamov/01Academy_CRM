import { readFileSync, readdirSync } from 'node:fs';

const academyModuleUrl = new URL('../../server/modules/academy/', import.meta.url);

export const readAcademyModuleSource = () => (
  readdirSync(academyModuleUrl)
    .filter((fileName) => fileName.endsWith('.ts'))
    .sort()
    .map((fileName) => readFileSync(new URL(fileName, academyModuleUrl), 'utf8'))
    .join('\n')
);
