import { canonicalOrganization, ORGANIZATION_NOT_RECOGNISED } from '../context.js';
import { fail, safeExecute } from '../domain/tool-result.js';
import { capabilityEnv } from '../deps.js';
import { accessReads } from './access.js';
import { checkpointReads } from './checkpoints.js';
import { fileReads } from './files.js';
import { incidentReads } from './incidents.js';
import { onboardingReads } from './onboarding.js';
import { patrollerReads } from './patrollers.js';
import { planReads } from './plan.js';
import { roundReads } from './rounds.js';
import { routeReads } from './routes.js';
import type { ReadCapability, ReadDeps, ReadEnv } from './types.js';
import { userReads } from './users.js';

export * from './types.js';
export * from './organization.js';

/**
 * Las 25 capacidades de lectura (22 sin `offerFiles`: el QR y los dos Excel solo
 * existen si el canal puede entregar ficheros, en `ctx.files` de cada llamada). Cada `call`:
 * - solo consulta si `ctx.org` es una de `ctx.organizations` (anti-fuga);
 * - nunca lanza: un error se registra en `logger` y vuelve como `{ok:false}`.
 */
export function readCapabilities(deps: ReadDeps): ReadCapability[] {
  const env: ReadEnv = { ...capabilityEnv(deps), offerFiles: deps.offerFiles ?? false };
  const { logger, urls, upsell } = env;
  const reads = [
    ...roundReads(env),
    ...routeReads(env),
    ...checkpointReads(env),
    ...patrollerReads(env),
    ...incidentReads(env),
    ...accessReads(env),
    ...userReads(env),
    ...planReads(env),
    ...onboardingReads(env),
    ...(env.offerFiles ? fileReads(env) : []),
  ];
  return reads.map((read) => ({
    ...read,
    call: (ctx, args) =>
      safeExecute(
        read.name,
        async () => {
          // La entrada de la sesión, no la copia del consumidor: su rol y ámbito son los que valen.
          const org = canonicalOrganization(ctx);
          if (!org) {
            return fail(
              ORGANIZATION_NOT_RECOGNISED,
              ctx.organizations.map((o) => o.name)
            );
          }
          return read.call({ ...ctx, org }, args);
        },
        // Una lectura no cambia nada: su fallo no dice «No se ha hecho ningún cambio».
        { logger, urls, upsell, language: ctx.language, operation: 'read' }
      ),
  }));
}
