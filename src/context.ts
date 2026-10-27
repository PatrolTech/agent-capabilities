import type { FixedTextLanguage } from './domain/language.js';

/** Referencia mínima a una organización del usuario, tal como la conocen lecturas y acciones. */
export interface OrganizationRef {
  orgId: string;
  name: string;
  /** Rol del usuario en ella según su sesión (`ADMIN`/`EDITOR`/`VIEWER`); ausente si no se conoce. */
  roleType?: string;
  /** `location` = el rol es solo de alguna ubicación, no de toda la organización. */
  scope?: 'organization' | 'location';
}

/**
 * Lo que comparten TODAS las llamadas (lecturas y acciones): la organización
 * YA resuelta (con `resolveOrganization`, solo entre `organizations`), las
 * organizaciones de la sesión, el token, la zona horaria y el país del cliente
 * (los da el consumidor: nunca se deducen aquí de un teléfono) y el idioma de
 * los textos fijos.
 */
export interface SessionContext {
  org: OrganizationRef;
  /** Todas las organizaciones del usuario según su sesión: `org` tiene que ser una de ellas. */
  organizations: OrganizationRef[];
  token: string;
  /** Zona del cliente: los rangos de fecha y las horas se calculan en SU calendario. */
  tz: string;
  /** País ISO-2 del cliente, o null si el consumidor no lo sabe. */
  country: string | null;
  language: FixedTextLanguage;
}

/** Lo que se le dice al modelo cuando la organización no es una de las del usuario. */
export const ORGANIZATION_NOT_RECOGNISED = 'Organización no reconocida';

/**
 * La entrada de la SESIÓN (`ctx.organizations`) para `ctx.org`, o `undefined`
 * si no es una de las del usuario (invariante anti-fuga). Rol y ámbito salen de
 * esa entrada, no de la copia que haya armado el consumidor en `ctx.org`.
 */
export function canonicalOrganization(
  ctx: Pick<SessionContext, 'org' | 'organizations'>
): OrganizationRef | undefined {
  return ctx.organizations.find((o) => o.orgId === ctx.org.orgId);
}
