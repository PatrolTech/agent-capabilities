// Fails a pull request that changes what goes into the published npm package
// without raising `version` in package.json over the base branch. Without the
// bump, release.yml finds that version already on npm and publishes nothing.
//
// Usage: node scripts/check-version-bump.mjs <base-ref>
// It compares the commits of HEAD that are not in <base-ref> (`<base-ref>...HEAD`)
// and the package.json of both. No dependencies: it runs before `npm ci`.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Files that go into the tarball, or that change what the build puts there
// (tsconfig.json decides the emitted JavaScript). package.json is compared by field.
const PUBLISHED_FILES = new Set(['README.md', 'LICENSE', 'tsconfig.json']);

const SPEC_RE = /\.(spec|test)\.[cm]?[jt]sx?$/;

/**
 * package.json fields that change the published package or how consumers
 * install and load it. Not `devDependencies`, `scripts` or the metadata.
 */
export const PUBLISHED_FIELDS = [
  'dependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'optionalDependencies',
  'bundleDependencies',
  'bundledDependencies',
  'exports',
  'imports',
  'main',
  'types',
  'typings',
  'type',
  'bin',
  'files',
  'engines',
  'sideEffects',
];

/** Whether a changed path goes into the published package: `src/` without specs, README, LICENSE. */
export function isPublishedPath(path) {
  if (PUBLISHED_FILES.has(path)) {
    return true;
  }
  return path.startsWith('src/') && !SPEC_RE.test(path);
}

/** The published package.json fields that differ between base and head. */
export function changedPublishedFields(basePkg, headPkg) {
  return PUBLISHED_FIELDS.filter(
    (field) => JSON.stringify(basePkg[field]) !== JSON.stringify(headPkg[field])
  );
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(version) {
  const match = typeof version === 'string' ? SEMVER_RE.exec(version) : null;
  if (!match) {
    throw new Error(`Not a semantic version: ${JSON.stringify(version)}`);
  }
  const [, major, minor, patch, pre] = match;
  return { core: [major, minor, patch].map(Number), pre: pre ? pre.split('.') : [] };
}

function compareIdentifiers(a, b) {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) {
    return Math.sign(Number(a) - Number(b));
  }
  if (aNum !== bNum) {
    return aNum ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Semantic version order: negative if a < b, 0 if equal, positive if a > b (build metadata ignored). */
export function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (va.core[i] !== vb.core[i]) {
      return Math.sign(va.core[i] - vb.core[i]);
    }
  }
  // A pre-release goes before its release: 1.0.0-rc.1 < 1.0.0.
  if (va.pre.length === 0 || vb.pre.length === 0) {
    return Math.sign(vb.pre.length - va.pre.length);
  }
  for (let i = 0; i < Math.min(va.pre.length, vb.pre.length); i++) {
    const order = compareIdentifiers(va.pre[i], vb.pre[i]);
    if (order !== 0) {
      return order;
    }
  }
  return Math.sign(va.pre.length - vb.pre.length);
}

/**
 * The decision, without git: what changed in the pull request and the package.json
 * of the base branch and of the pull request.
 */
export function checkVersionBump({ changedFiles, basePkg, headPkg }) {
  const from = basePkg.version;
  const to = headPkg.version;
  const order = compareVersions(to, from);
  const reasons = [
    ...changedFiles.filter(isPublishedPath),
    ...changedPublishedFields(basePkg, headPkg).map((field) => `package.json: ${field}`),
  ];
  if (order < 0) {
    return { ok: false, reasons, message: `version goes down from ${from} to ${to}.` };
  }
  if (reasons.length === 0) {
    return {
      ok: true,
      reasons,
      message: 'Nothing that goes into the published package changed: no version bump needed.',
    };
  }
  if (order > 0) {
    return {
      ok: true,
      reasons,
      message: `The published package changes and version goes from ${from} to ${to}.`,
    };
  }
  return {
    ok: false,
    reasons,
    message:
      `The published package changes but version stays at ${from}: raise it in package.json ` +
      '(a patch for fixes), or release.yml will publish nothing.',
  };
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Runs the check against the repository in `cwd`; returns the exit code. */
export function main(argv, { cwd = process.cwd(), log = console.log, error = console.error } = {}) {
  const [base] = argv;
  if (!base || base.startsWith('-')) {
    error('Usage: node scripts/check-version-bump.mjs <base-ref>');
    return 2;
  }
  const changedFiles = git(['diff', '--name-only', '--no-renames', '-z', `${base}...HEAD`], cwd)
    .split('\0')
    .filter(Boolean);
  const result = checkVersionBump({
    changedFiles,
    basePkg: JSON.parse(git(['show', `${base}:package.json`], cwd)),
    headPkg: JSON.parse(git(['show', 'HEAD:package.json'], cwd)),
  });
  for (const reason of result.reasons) {
    log(`  published: ${reason}`);
  }
  if (result.ok) {
    log(result.message);
    return 0;
  }
  error(
    process.env.GITHUB_ACTIONS === 'true'
      ? `::error title=Version bump::${result.message}`
      : result.message
  );
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
