import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const checkoutStart = workflow.indexOf('          cd "$APP_DIR"');
const checkoutEnd = workflow.indexOf('          mkdir -p config', checkoutStart);
const checkout = workflow.slice(checkoutStart, checkoutEnd).replace(/^          /gm, '');
const archive = workflow.split('\n').find((line) => line.includes('git archive --format=tar'))!.trim();
const remoteHeader = workflow.split("<<'REMOTE'\n")[1].split('          APP_DIR=')[0].replace(/^          /gm, '');

function validateRemoteCommit(commit: string) {
  return execFileSync('/bin/bash', ['-e', '-u', '-o', 'pipefail', '-c',
    `${remoteHeader}\nprintf '%s' "$DEPLOY_COMMIT"`, 'deployment-fixture', commit],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

it.each(['origin/main', '', 'g'.repeat(40)])('rejects an invalid deployment revision: %j', (commit) => {
  expect(() => validateRemoteCommit(commit)).toThrow();
});

it('accepts the immutable commit supplied to the remote script', () => {
  const commit = 'a'.repeat(40);
  expect(validateRemoteCommit(commit)).toBe(commit);
});

function repositoryFixture() {
  const root = mkdtempSync(join(tmpdir(), 'academy-deploy-revision-'));
  const source = join(root, 'source');
  const deployed = join(root, 'deployed');
  const artifact = join(root, 'artifact');
  mkdirSync(source);
  mkdirSync(artifact);
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git(source, 'init', '--initial-branch=main');
  git(source, 'config', 'user.name', 'Deployment fixture');
  git(source, 'config', 'user.email', 'deployment@example.invalid');
  const commit = (content: string) => {
    writeFileSync(join(source, 'release.txt'), content);
    git(source, 'add', 'release.txt');
    git(source, 'commit', '-m', content);
    return git(source, 'rev-parse', 'HEAD');
  };
  commit('previous release');
  const tested = commit('checked release');
  git(root, 'clone', source, deployed);
  const environment = { ...process.env, APP_DIR: deployed, REPO_URL: source,
    DEPLOY_COMMIT: tested, BUILD_CONTEXT: artifact };
  const run = (script: string, extraEnvironment: Record<string, string> = {}) => execFileSync(
    '/bin/bash', ['-e', '-u', '-o', 'pipefail', '-c', script],
    { env: { ...environment, ...extraEnvironment }, encoding: 'utf8' },
  );
  return { root, source, deployed, artifact, tested, git, commit, run };
}

it('builds the checked revision even when main advances after release checkout', () => {
  const fixture = repositoryFixture();
  try {
    fixture.run(checkout);
    expect(fixture.git(fixture.deployed, 'rev-parse', 'HEAD')).toBe(fixture.tested);
    fixture.commit('new unchecked release');
    fixture.git(fixture.deployed, 'fetch', 'origin', 'main');
    expect(fixture.git(fixture.deployed, 'rev-parse', 'origin/main')).not.toBe(fixture.tested);
    fixture.run(`cd "$APP_DIR"\n${archive}`);
    expect(readFileSync(join(fixture.artifact, 'release.txt'), 'utf8')).toBe('checked release');
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

it('skips a superseded release before changing the deployed checkout or starting a build', () => {
  const fixture = repositoryFixture();
  try {
    fixture.commit('new unchecked release');
    const output = fixture.run(`${checkout}\nprintf 'BUILD_STARTED'`);
    expect(output).toContain('Skipping superseded release');
    expect(output).not.toContain('BUILD_STARTED');
    expect(fixture.git(fixture.deployed, 'rev-parse', 'HEAD')).toBe(fixture.tested);
    expect(readFileSync(join(fixture.deployed, 'release.txt'), 'utf8')).toBe('checked release');
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});
