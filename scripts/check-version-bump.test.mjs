import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  changedPublishedFields,
  checkVersionBump,
  compareVersions,
  isPublishedPath,
} from './check-version-bump.mjs';

const SCRIPT = fileURLToPath(new URL('./check-version-bump.mjs', import.meta.url));

const BASE_PKG = {
  name: '@patroltech/agent-capabilities',
  version: '0.2.2',
  type: 'module',
  exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
  files: ['dist'],
  scripts: { test: 'vitest run' },
  dependencies: { '@patroltech/sdk-api': '^1.2.0', qrcode: '^1.5.4' },
  peerDependencies: { zod: '^4.0.0' },
  devDependencies: { vitest: '5.0.5', eslint: '9.39.5' },
};

const pkg = (over = {}) => ({ ...BASE_PKG, ...over });

describe('isPublishedPath', () => {
  it('src without specs, README, LICENSE and tsconfig.json go into the package', () => {
    for (const path of [
      'src/domain/csv.ts',
      'src/testing/FakePatrolTechGateway.ts',
      'README.md',
      'LICENSE',
      'tsconfig.json',
    ]) {
      assert.equal(isPublishedPath(path), true, path);
    }
  });

  it('specs, tests, CI, scripts, the lockfile and internal docs do not', () => {
    for (const path of [
      'src/domain/csv.spec.ts',
      'src/reads/files.test.ts',
      '.github/workflows/ci.yml',
      '.github/dependabot.yml',
      'scripts/check-version-bump.mjs',
      'package-lock.json',
      'SECURITY.md',
      'docs/README.md',
      'vitest.config.ts',
      'tsconfig.spec.json',
      'eslint.config.js',
    ]) {
      assert.equal(isPublishedPath(path), false, path);
    }
  });
});

describe('changedPublishedFields', () => {
  it('ignores devDependencies, scripts and metadata', () => {
    const head = pkg({
      devDependencies: { vitest: '5.1.0', eslint: '9.39.5' },
      scripts: { test: 'vitest run --coverage' },
      description: 'Other text',
    });
    assert.deepEqual(changedPublishedFields(BASE_PKG, head), []);
  });

  it('sees dependencies, peer dependencies and exports', () => {
    const head = pkg({
      dependencies: { '@patroltech/sdk-api': '^1.3.0', qrcode: '^1.5.4' },
      peerDependencies: { zod: '^4.1.0' },
      exports: { '.': './dist/index.js' },
    });
    assert.deepEqual(changedPublishedFields(BASE_PKG, head), [
      'dependencies',
      'peerDependencies',
      'exports',
    ]);
  });

  it('sees a field that appears or disappears', () => {
    assert.deepEqual(changedPublishedFields(BASE_PKG, pkg({ bin: { x: './dist/x.js' } })), ['bin']);
    const withoutPeers = pkg();
    delete withoutPeers.peerDependencies;
    assert.deepEqual(changedPublishedFields(BASE_PKG, withoutPeers), ['peerDependencies']);
  });
});

describe('compareVersions', () => {
  it('orders by major, minor and patch numerically', () => {
    assert.ok(compareVersions('0.2.3', '0.2.2') > 0);
    assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
    assert.ok(compareVersions('1.0.0', '0.99.99') > 0);
    assert.equal(compareVersions('0.2.2', '0.2.2'), 0);
    assert.ok(compareVersions('0.2.1', '0.2.2') < 0);
  });

  it('puts a pre-release before its release and orders pre-releases', () => {
    assert.ok(compareVersions('1.0.0-rc.1', '1.0.0') < 0);
    assert.ok(compareVersions('1.0.0-rc.2', '1.0.0-rc.1') > 0);
    assert.ok(compareVersions('1.0.0-rc.10', '1.0.0-rc.9') > 0);
    assert.ok(compareVersions('1.0.0-beta', '1.0.0-alpha.1') > 0);
    assert.ok(compareVersions('1.0.0-alpha.1', '1.0.0-alpha') > 0);
    assert.ok(compareVersions('1.0.0-1', '1.0.0-alpha') < 0);
    assert.equal(compareVersions('1.0.0+build.1', '1.0.0'), 0);
  });

  it('rejects what is not a semantic version', () => {
    assert.throws(() => compareVersions('1.2', '1.2.0'), /Not a semantic version/);
    assert.throws(() => compareVersions(undefined, '1.2.0'), /Not a semantic version/);
  });
});

describe('checkVersionBump, by kind of pull request', () => {
  it('code: fails without a bump and passes with one', () => {
    const changedFiles = ['src/domain/csv.ts', 'src/domain/csv.spec.ts'];
    const same = checkVersionBump({ changedFiles, basePkg: BASE_PKG, headPkg: BASE_PKG });
    assert.equal(same.ok, false);
    assert.deepEqual(same.reasons, ['src/domain/csv.ts']);
    assert.match(same.message, /stays at 0\.2\.2/);
    const bumped = checkVersionBump({
      changedFiles: [...changedFiles, 'package.json'],
      basePkg: BASE_PKG,
      headPkg: pkg({ version: '0.2.3' }),
    });
    assert.equal(bumped.ok, true);
  });

  it('tests, CI and internal docs only: passes without a bump', () => {
    const result = checkVersionBump({
      changedFiles: ['src/reads/files.spec.ts', '.github/workflows/ci.yml', 'SECURITY.md'],
      basePkg: BASE_PKG,
      headPkg: BASE_PKG,
    });
    assert.deepEqual(result, {
      ok: true,
      reasons: [],
      message: 'Nothing that goes into the published package changed: no version bump needed.',
    });
  });

  it('Dependabot devDependencies: passes without a bump', () => {
    const result = checkVersionBump({
      changedFiles: ['package.json', 'package-lock.json'],
      basePkg: BASE_PKG,
      headPkg: pkg({ devDependencies: { vitest: '5.1.0', eslint: '9.40.0' } }),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.reasons, []);
  });

  it('Dependabot dependencies in package.json: fails without a bump and passes with one', () => {
    const dependencies = { '@patroltech/sdk-api': '^1.3.0', qrcode: '^1.5.4' };
    const same = checkVersionBump({
      changedFiles: ['package.json', 'package-lock.json'],
      basePkg: BASE_PKG,
      headPkg: pkg({ dependencies }),
    });
    assert.equal(same.ok, false);
    assert.deepEqual(same.reasons, ['package.json: dependencies']);
    const bumped = checkVersionBump({
      changedFiles: ['package.json', 'package-lock.json'],
      basePkg: BASE_PKG,
      headPkg: pkg({ dependencies, version: '0.2.3' }),
    });
    assert.equal(bumped.ok, true);
  });

  it('a dependency moved only in the lockfile: passes, the tarball does not change', () => {
    const result = checkVersionBump({
      changedFiles: ['package-lock.json'],
      basePkg: BASE_PKG,
      headPkg: BASE_PKG,
    });
    assert.equal(result.ok, true);
  });

  it('README or LICENSE: fails without a bump', () => {
    for (const file of ['README.md', 'LICENSE']) {
      const result = checkVersionBump({
        changedFiles: [file],
        basePkg: BASE_PKG,
        headPkg: BASE_PKG,
      });
      assert.equal(result.ok, false, file);
    }
  });

  it('a version that goes down fails even if nothing published changed', () => {
    const result = checkVersionBump({
      changedFiles: ['package.json'],
      basePkg: BASE_PKG,
      headPkg: pkg({ version: '0.2.1' }),
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /goes down from 0\.2\.2 to 0\.2\.1/);
  });
});

// The script as CI runs it, against a real repository.
describe('check-version-bump.mjs on a git repository', () => {
  let repo;

  const git = (...args) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: repo, encoding: 'utf8' }
    );

  const write = (path, content) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    const text = typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`;
    writeFileSync(join(repo, path), text);
  };

  const run = (args = ['base']) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_ACTIONS: 'false' },
    });

  const branch = (name, changes) => {
    git('checkout', '-q', '-b', name, 'base');
    for (const [path, content] of Object.entries(changes)) {
      write(path, content);
    }
    git('add', '-A');
    git('commit', '-q', '-m', name);
    return run();
  };

  before(() => {
    repo = mkdtempSync(join(tmpdir(), 'check-version-bump-'));
    git('init', '-q', '-b', 'main');
    write('package.json', BASE_PKG);
    write('src/index.ts', 'export const a = 1;\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    git('branch', 'base');
  });

  after(() => rmSync(repo, { recursive: true, force: true }));

  it('code without a bump: exit 1 and says why', () => {
    const result = branch('code', { 'src/index.ts': 'export const a = 2;\n' });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /published: src\/index\.ts/);
    assert.match(result.stderr, /stays at 0\.2\.2/);
  });

  it('code with a bump: exit 0', () => {
    const result = branch('code-bumped', {
      'src/index.ts': 'export const a = 2;\n',
      'package.json': pkg({ version: '0.2.3' }),
    });
    assert.equal(result.status, 0, result.stderr);
  });

  it('a renamed source file counts as a change to the package', () => {
    git('checkout', '-q', '-b', 'rename', 'base');
    git('mv', 'src/index.ts', 'src/main.ts');
    git('commit', '-q', '-m', 'rename');
    const result = run();
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /published: src\/index\.ts/);
    assert.match(result.stdout, /published: src\/main\.ts/);
  });

  it('only what the pull request adds counts, not what the base branch did since', () => {
    git('checkout', '-q', '-b', 'moved-base', 'base');
    write('src/index.ts', 'export const a = 3;\n');
    git('commit', '-q', '-am', 'main moves on');
    git('checkout', '-q', '-b', 'tests-on-old-base', 'base');
    write('src/index.spec.ts', 'test\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'tests');
    const result = run(['moved-base']);
    assert.equal(result.status, 0, result.stderr);
  });

  it('tests only: exit 0', () => {
    const result = branch('tests', { 'src/index.spec.ts': 'test\n' });
    assert.equal(result.status, 0, result.stderr);
  });

  it('devDependencies only: exit 0', () => {
    const result = branch('dev-deps', {
      'package.json': pkg({ devDependencies: { vitest: '5.1.0', eslint: '9.39.5' } }),
      'package-lock.json': '{}\n',
    });
    assert.equal(result.status, 0, result.stderr);
  });

  it('dependencies without a bump: exit 1', () => {
    const result = branch('deps', {
      'package.json': pkg({ dependencies: { '@patroltech/sdk-api': '^1.3.0', qrcode: '^1.5.4' } }),
    });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /published: package\.json: dependencies/);
  });

  it('without a base ref, or with an option instead of one: exit 2', () => {
    for (const args of [[], ['--output=x']]) {
      const result = run(args);
      assert.equal(result.status, 2, String(args));
      assert.match(result.stderr, /Usage/);
    }
  });
});
