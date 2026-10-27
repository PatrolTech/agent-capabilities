# PatrolTech agent capabilities

Channel-agnostic building blocks to let an AI agent **read and act on a PatrolTech account**: rounds, routes, checkpoints, guards, incidents, users, locations, access control and scans. The same catalog powers the PatrolTech chat assistant (WhatsApp and Telegram) and the [PatrolTech MCP connector](https://mcp.patroltech.online/mcp).

[![CI](https://github.com/PatrolTech/agent-capabilities/actions/workflows/ci.yml/badge.svg)](https://github.com/PatrolTech/agent-capabilities/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@patroltech/agent-capabilities)](https://www.npmjs.com/package/@patroltech/agent-capabilities)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

- **Reads** return a `ToolResult` the model can read (`{ ok, data, avisos }` or `{ ok: false, error }`).
- **Actions** never write on their own: each one _prepares_ a proposal, your app shows its summary to the user, and only after the user confirms does it _execute_.
- Built on the official SDK [`@patroltech/sdk-api`](https://github.com/PatrolTech/sdk-api), generated from the public OpenAPI contract. Every operation the catalog calls is checked against that contract in CI.
- No channel, database, logger or LLM framework inside: everything external comes in through small ports.

> **This package grants no access by itself.** Every call carries the user's token and the PatrolTech API authorizes it (organization and location roles, OAuth scopes and, for MCP agents, a closed list of allowed writes). The checks in this package only produce better messages.

## Install

```bash
npm install @patroltech/agent-capabilities zod
```

Node.js 22 or later. `zod` 4 is a peer dependency (the capabilities describe their parameters with it). The package is ESM.

## Quick start

```ts
import {
  SdkPatrolTechGateway,
  buildCatalog,
  noopLogger,
  type CapabilityContext,
} from '@patroltech/agent-capabilities';

const gateway = new SdkPatrolTechGateway({
  baseUrl: 'https://api.patroltech.online',
  logger: noopLogger, // or your own { info, warn, error }
  timeoutMs: 10_000,
});

// Build once. In the `mcp` channel only operational capabilities are offered, with neutral texts.
const { reads, actions } = buildCatalog({ gateway }, { channel: 'mcp' });

// Per call: the user's session. The token is a PatrolTech API session token
// (see the OAuth flow in @patroltech/sdk-api); `organizations` come from that session.
const org = { orgId: 'org-123', name: 'Acme Security', roleType: 'EDITOR', scope: 'organization' };
const ctx: CapabilityContext = {
  org,
  organizations: [org],
  token: apiSessionToken,
  tz: 'Europe/Madrid',
  country: 'ES',
  language: 'en',
};

const status = reads.find(({ meta }) => meta.id === 'rounds.get_status');
const result = await status?.read.call(ctx, {});
// result: { ok: true, data: ... } or { ok: false, error: '...' } (never a raw API error)
```

Each entry comes with its metadata (`meta`): a stable `id` (`rounds.get_status`), `title` and `summary` in English and Spanish, `returns` (how to read the result, for reads), `readOnly`, `destructive`, `scope` and the SDK `operationIds` it calls. MCP servers should describe tools with `meta.title`, `meta.summary` and `meta.returns`. For English tool schemas, `englishInputSchema(meta.id, params)` translates the parameter names and descriptions, `argsFromEnglish` maps the arguments back and `englishFields` translates the output fields.

### One gateway, many users

`SdkPatrolTechGateway` keeps no global state: each call builds its own SDK configuration (base URL, token, `fetch`, timeout) with `createApiClient`, so one instance can serve any number of users concurrently. Options:

| Option           | Default        | Notes                                                                                                                                 |
| ---------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`        | required       | API origin, without `/api`.                                                                                                           |
| `fetchImpl`      | global `fetch` | For tests or instrumentation.                                                                                                         |
| `timeoutMs`      | `10000`        | Per call, with `AbortSignal.timeout`.                                                                                                 |
| `logger`         | no-op          | Receives failures with their detail; the model never does.                                                                            |
| `defaultHeaders` | none           | `() => Record<string, string>`, evaluated per request (for example `X-Request-Id`). Any `Authorization` header it returns is dropped. |

API rejections surface as `PatrolTechApiError` (status, path and body). `translateBackendError(err, language, options)` turns them into a message for the user in Spanish, English or French. `callSdk(config, token, path, call)` runs any other `@patroltech/sdk-api` function the same way (per-call config, timeout, errors as `PatrolTechApiError`).

## Proposals and confirmation

Write actions follow a propose → confirm → execute flow:

1. `action.preparar(ctx, params)` resolves names to ids, checks limits and returns the parameters to store, or `{ error }` for the model.
2. Your app stores the proposal in a `PendingActionStore` and shows `action.resumen(params, { idioma, organizacion })` to the user.
3. When the user confirms, claim it with `claimForExecution` and run `action.ejecutar(ctx, params)` with the session of that moment.

Batch helpers (`reservarEnLote`, `liberarEnLote`, `aceptarEnLote`, `huellaDePropuesta`, `MAX_POR_LOTE`) cap a batch at 10 proposals and drop duplicates. They protect the user from model mistakes; they are not a security barrier (the API is).

### `PendingActionStore` and the `contextKey` rule

`PendingActionStore` is a port: implement it on your own storage (a database table, Redis, memory for a single-process server). Proposals are indexed by a `contextKey`.

**Bind the `contextKey` to the user _and_ to the conversation or client session**, for example `<userId>:<conversationId>` in a chat bot or `<userId>:<clientId>:<sessionId>` in an MCP server, and never share it between users. Whoever holds a `contextKey` can see, confirm or cancel the proposals stored under it. Also check, when executing, that the session user is still the one who proposed.

## Ports

| Port                 | What it does                                                               | Who implements it                                              |
| -------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `PatrolTechGateway`  | Every call to the PatrolTech API.                                          | `SdkPatrolTechGateway` (included) or a test double.            |
| `PendingActionStore` | Stores proposals until the user confirms them, by `contextKey`.            | You (database, Redis, memory).                                 |
| `FileSink`           | Where generated files go (checkpoint QR codes, CSV exports). One per call. | You: a chat sends them, an MCP server returns them as content. |
| `Logger`             | Traces and failures. `noopLogger` if you want none.                        | You.                                                           |

`FileSink` goes in the call context (`ctx.files`), never in the shared dependencies: a sink shared between users would send one user's files to another. File capabilities are only offered with `buildCatalog({ gateway, offerFiles: true }, …)`.

## Channels

- **`mcp`**: operational reads and the writes the PatrolTech API allows to agents. Destructive or sensitive actions (deleting a time window or a location, archiving or moving a checkpoint, anti-fraud settings, changing or removing a user's access), actions that give access to someone else (inviting a user, creating a guard) and billing links are not offered. Texts never mention plans or upgrades (`upsell: false`).
- **`bot`**: everything, for a first-party assistant where the user talks to PatrolTech directly.

Every catalog entry declares its channels; the tests check that no `mcp` capability calls an operation that grants access and that its writes are exactly the ones the API allows to agents.

## Prompt injection

Names of routes, checkpoints, locations and guards, incident texts and user names are written by people in the account and reach the model as data inside `ToolResult`. Treat them as data, never as instructions (for example, wrap tool results with a note saying so), and keep the human confirmation of every write.

## Testing

`@patroltech/agent-capabilities/testing` exports `FakePatrolTechGateway` (in-memory, with fictitious data), `RecordingFileSink` and helpers to build read contexts.

## Contract checks

- `src/catalog/public-contract.spec.ts` downloads the public contract published by [`PatrolTech/sdk-api`](https://github.com/PatrolTech/sdk-api) at the tag of the installed SDK version (`v<version>/openapi/openapi.public.json`) and checks that every `operationId` of every capability exists there and as a function of `@patroltech/sdk-api`. Offline, point `PATROLTECH_PUBLIC_CONTRACT` to a local copy of that file.
- Dependabot opens a pull request for every new SDK version; CI runs that check on it.

### Known contract gaps

Calls made with `sdkFetch` and the SDK URL builder because the contract does not declare a query parameter the API needs yet:

| operationId                   | Call                                                            | Missing in the contract                |
| ----------------------------- | --------------------------------------------------------------- | -------------------------------------- |
| `getIncidentDetail`           | `GET /api/features/incident-reporting/incidents/{id}`           | query `locationId` or `organizationId` |
| `updateIncidentStatus`        | `PATCH /api/features/incident-reporting/incidents/{id}/status`  | same                                   |
| `assignIncident`              | `PATCH /api/features/incident-reporting/incidents/{id}/assign`  | same                                   |
| `addIncidentComment`          | `POST /api/features/incident-reporting/incidents/{id}/comments` | same                                   |
| `createCheckoutSession`       | `POST /api/payments/checkout-session`                           | query `organizationId`                 |
| `createCustomerPortalSession` | `POST /api/payments/customer-portal`                            | same                                   |

Types completed by hand where the contract is loose:

| operationId                           | Gap                                                                 | Local type                                               |
| ------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------- |
| `getRouteRounds`                      | Each round is a free-form object.                                   | `RouteRoundItem`                                         |
| `getIncidentDetail`                   | `media[].type` (`PHOTO`/`VIDEO`) is not declared.                   | `IncidentDetailItem`                                     |
| `listCheckpoints`, `createCheckpoint` | `createdAt` is not declared; `fraudRules` may arrive as JSON text.  | `CheckpointItem`, `RawFraudRules`                        |
| `getLicenseInfo`, `getPaymentPrices`  | The nullable `allOf` generated by orval loses `null`.               | Read as `LicenseUsage \| null` / `PlanPricing \| null`   |
| `getLicenseInfo`                      | Whether the organization already pays a subscription is not public. | `PlanUsage.pagaSuscripcion` is always `null` (see below) |
| `createOrganizationUser`              | `meta.emailSent` (outside `data`) is not declared.                  | Defensive read of `meta`                                 |

Because the public contract does not say whether an organization already pays, the checkout link capability relies on the API: when it refuses a second subscription (`409 ALREADY_SUBSCRIBED`), the capability returns the customer portal link instead.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test            # needs network access to read the published contract
npm run build
```

Contributions are welcome through pull requests. Security issues: see [SECURITY.md](./SECURITY.md); never include credentials, tokens or customer data in issues.

## Related

- [`@patroltech/sdk-api`](https://github.com/PatrolTech/sdk-api): the TypeScript SDK and the public OpenAPI contract, with the OAuth 2.1 flow.
- [PatrolTech MCP connector](https://mcp.patroltech.online/mcp) and its client configurations in [`PatrolTech/ai-integrations`](https://github.com/PatrolTech/ai-integrations).

## About PatrolTech

PatrolTech is guard tour and security patrol software developed by Ingenieros Web SL in Madrid, Spain: QR/NFC checkpoint recording, offline patrol records, incident reports and a management dashboard. [patroltech.online](https://patroltech.online/en)

## License

[MIT](./LICENSE) © Ingenieros Web SL
