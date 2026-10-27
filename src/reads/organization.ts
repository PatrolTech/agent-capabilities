import { z } from 'zod';
import {
  canonicalOrganization,
  ORGANIZATION_NOT_RECOGNISED,
  type OrganizationRef,
} from '../context.js';
import { resolveByName } from '../domain/resolve-by-name.js';
import type { CapabilityContext } from './types.js';

/** Descripción del parámetro de organización que añade el consumidor cuando el usuario tiene varias. */
export const ORGANIZATION_PARAM_DESCRIPTION =
  'Nombre de la organización sobre la que consultar (una de las del usuario)';

/**
 * El parámetro de organización (solo con más de una). `.min(1)`: con la cadena
 * vacía se consultaba en silencio la PRIMERA organización.
 */
export const organizationParam = z.string().min(1).describe(ORGANIZATION_PARAM_DESCRIPTION);

/** Por qué no se ha podido resolver la organización, con las opciones para preguntar. */
export interface OrganizationResolutionError {
  error: string;
  opciones?: string[];
}

const NO_RECONOCIDA = ORGANIZATION_NOT_RECOGNISED;

/**
 * Resuelve la organización que nombra el usuario SOLO entre las suyas
 * (`ctx.organizations`): invariante anti-fuga entre organizaciones.
 * - con una sola organización, es esa (no se le pregunta);
 * - con varias, el nombre (o su id, o su número en la lista) tiene que casar con
 *   una sola; si falta, no casa o es ambiguo, devuelve el error para el modelo.
 */
export function resolveOrganization(
  ctx: Pick<CapabilityContext, 'organizations'>,
  requestedName?: string
): OrganizationRef | OrganizationResolutionError {
  const { organizations } = ctx;
  if (organizations.length === 1) return organizations[0];
  if (organizations.length === 0) return { error: NO_RECONOCIDA };
  const valor = requestedName ?? '';
  const match = resolveByName(valor, organizations, (o) => o.name, {
    byIndex: true,
    idOf: (o) => o.orgId,
  });
  if (match.kind === 'found') return match.item;
  const nombres = (orgs: readonly OrganizationRef[]) => orgs.map((o) => o.name);
  if (match.kind === 'ambiguous') {
    return {
      error: `ambigua: «${valor}» coincide con varios/as organizaciones; pregunta al usuario cuál de estas quiere`,
      opciones: nombres(match.matches),
    };
  }
  return { error: NO_RECONOCIDA, opciones: nombres(organizations) };
}

/** ¿Es `ctx.org` una de las organizaciones del usuario? Si no, la capacidad no consulta nada. */
export function isOrganizationInContext(
  ctx: Pick<CapabilityContext, 'org' | 'organizations'>
): boolean {
  return canonicalOrganization(ctx) !== undefined;
}
