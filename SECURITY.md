# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately, never in a public issue or pull request:

- **GitHub:** [report a vulnerability](https://github.com/PatrolTech/agent-capabilities/security/advisories/new) from the Security tab of this repository.
- **Support bot:** WhatsApp [wa.me/34624085772](https://wa.me/34624085772) or Telegram [@patroltechbot](https://t.me/patroltechbot).
- **Email:** [info@patroltech.app](mailto:info@patroltech.app).

Include the affected version, the steps to reproduce and the impact you expect. Do not send credentials, access tokens or customer data: if a report needs them, say so and we will agree on a safe channel.

We acknowledge reports within 3 working days and keep you informed until the fix is released.

## Scope and threat model

This repository contains a stateless library that turns an agent's intent (read the rounds, propose a checkpoint…) into calls to the PatrolTech API through [`@patroltech/sdk-api`](https://github.com/PatrolTech/sdk-api), with the token of the user it acts for.

- **It grants no access by itself.** It has no credentials of its own and no database. Every request is authorized by the PatrolTech API: organization and location roles, OAuth scopes and, for MCP agents, a closed list of allowed writes (an agent can never give access to other people or touch billing). The role checks and the cross-organization guard in this package exist to give better messages; the API decides again on every call.
- **The proposal flow is not a security barrier.** Batch limits and duplicate detection protect users from model mistakes. A valid token can call the allowed endpoints directly; the API enforces the limits that matter.
- **Integrators own the `PendingActionStore`.** Bind each `contextKey` to the user and to the conversation or client session, and never share it between users: whoever holds it can see, confirm or cancel the proposals stored under it.
- **Prompt injection.** Names, incident texts and other user-written content reach the model as data inside tool results. Consumers should mark them as data, never as instructions, and keep the human confirmation of every write.
- **Tokens.** The package never stores tokens: they travel in the context of each call. `defaultHeaders` cannot override `Authorization`, every call has a timeout, and error details go to the injected logger, never to the model.

Vulnerabilities in the PatrolTech API or apps found while using this package are welcome through the same channels.

## Supported versions

Only the latest published version of `@patroltech/agent-capabilities` receives security fixes.
