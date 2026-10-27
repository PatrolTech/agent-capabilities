// Smoke test of the catalog against a PatrolTech API (staging), with a read-only token.
//
// Runs every `mcp` read that needs no parameters and fails on a contract error:
// an endpoint or parameter the API does not know (400, 404, 405, 410, 415, 422)
// or a response the gateway cannot map (TypeError, SyntaxError). A 401 also
// fails: the token no longer works and nothing was checked. Other rejections
// (403 of a disabled feature, 5xx, timeouts) are warnings, unless every read
// fails: then nothing was verified and the run fails too.
//
// Output is public in Actions logs: it prints capability ids, error kinds and
// HTTP statuses only, never URLs, ids, bodies or tokens.
//
// Needs a build (`npm run build`) and:
//   STAGING_API_URL          API origin, without /api
//   STAGING_TOKEN            read-only API session token
//   STAGING_ORGANIZATION_ID  organization the token can read
import { z } from 'zod';
import { buildCatalog, SdkPatrolTechGateway } from '../dist/index.js';

const CONTRACT_STATUSES = new Set([400, 404, 405, 410, 415, 422]);
const MAPPING_ERRORS = new Set(['TypeError', 'SyntaxError']);

const { STAGING_API_URL, STAGING_TOKEN, STAGING_ORGANIZATION_ID } = process.env;
if (!STAGING_API_URL || !STAGING_TOKEN || !STAGING_ORGANIZATION_ID) {
  console.error('Set STAGING_API_URL, STAGING_TOKEN and STAGING_ORGANIZATION_ID.');
  process.exit(2);
}

/** Failures the capabilities log (`tool.execute_failed`), without their detail. */
const failures = [];
const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: (_msg, meta = {}) => {
    failures.push({
      status: typeof meta.status === 'number' ? meta.status : null,
      errorName: meta.err instanceof Error ? meta.err.name : null,
    });
  },
};

const gateway = new SdkPatrolTechGateway({ baseUrl: STAGING_API_URL, logger, timeoutMs: 20_000 });
const { reads } = buildCatalog({ gateway, logger }, { channel: 'mcp' });

const org = { orgId: STAGING_ORGANIZATION_ID, name: 'Staging', roleType: 'VIEWER' };
const ctx = {
  org,
  organizations: [org],
  token: STAGING_TOKEN,
  tz: 'Europe/Madrid',
  country: 'ES',
  language: 'en',
};

function classify({ status, errorName }) {
  if (status === 401) return 'auth';
  if (status !== null && CONTRACT_STATUSES.has(status)) return 'contract';
  if (status === null && errorName !== null && MAPPING_ERRORS.has(errorName)) return 'contract';
  return 'other';
}

let checked = 0;
let broken = 0;
let answered = 0;
for (const { meta, read } of reads) {
  if (!z.object(read.params).safeParse({}).success) {
    console.log(`skip  ${meta.id} (needs parameters)`);
    continue;
  }
  checked += 1;
  const before = failures.length;
  const result = await read.call(ctx, {});
  const failure = failures.slice(before).at(-1);
  if (!failure) {
    answered += 1;
    console.log(`${result.ok ? 'ok   ' : 'no   '} ${meta.id}`);
    continue;
  }
  const kind = classify(failure);
  const detail = failure.status ?? failure.errorName ?? 'unknown';
  if (kind === 'other') {
    console.log(`warn  ${meta.id} (${detail})`);
    console.log(`::warning::${meta.id}: ${detail}`);
  } else {
    broken += 1;
    console.log(`FAIL  ${meta.id} (${kind}: ${detail})`);
    console.log(`::error::${meta.id}: ${kind} error (${detail})`);
  }
}

console.log(
  `${checked} reads checked: ${answered} answered, ${broken} with a contract or authentication error.`
);
if (answered === 0)
  console.log('::error::No read got an answer from the API: nothing was verified.');
if (answered === 0 || broken > 0) process.exit(1);
