import { canonicalOrganization, ORGANIZATION_NOT_RECOGNISED } from '../context.js';
import { AccionRechazada } from './names.js';
import type { ActionDefinition } from './types.js';

/**
 * El mismo invariante anti-fuga que las lecturas, para las escrituras: `preparar`
 * y `ejecutar` solo tocan el backend si `ctx.org` es una de `ctx.organizations`,
 * y con SU entrada de la sesión (rol y ámbito), no con la copia del consumidor.
 * - `preparar` devuelve `{ error: 'Organización no reconocida' }` (lo lee el modelo);
 * - `ejecutar` lanza `AccionRechazada` con ese texto (queda `failed` sin cambios).
 *
 * `actionCatalog` lo aplica a todas sus acciones; un consumidor que monte una
 * acción propia lo aplica igual.
 */
export function withOrganizationGuard(definition: ActionDefinition): ActionDefinition {
  return {
    ...definition,
    async preparar(ctx, params) {
      const org = canonicalOrganization(ctx);
      if (!org) return { error: ORGANIZATION_NOT_RECOGNISED };
      return definition.preparar ? definition.preparar({ ...ctx, org }, params) : { params };
    },
    async ejecutar(ctx, params) {
      const org = canonicalOrganization(ctx);
      if (!org) throw new AccionRechazada(ORGANIZATION_NOT_RECOGNISED);
      return definition.ejecutar({ ...ctx, org }, params);
    },
  };
}
