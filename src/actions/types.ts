import type { z } from 'zod';
import type { OrganizationRef, SessionContext } from '../context.js';
import type { FixedTextLanguage } from '../domain/language.js';
import type { CambioDeCheckpoint } from '../domain/route-checkpoints.js';
import type { CapabilityDeps, CapabilityEnv } from '../deps.js';
import type { BotActionFlags, BotActionName } from './names.js';

/** Roles de la sesión y de los usuarios del panel, de menos a más. */
export const ROLES = ['VIEWER', 'EDITOR', 'ADMIN'] as const;
export type RoleType = (typeof ROLES)[number];

const ROLE_RANK: Record<RoleType, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 };

/** Un cambio de checkpoints en una ruta que hace una propuesta (para las siguientes del mismo lote). */
export interface CambioEnRuta extends CambioDeCheckpoint {
  rutaId: string;
}

/**
 * Lo que comparten las propuestas de UN turno (una sola confirmación), que se
 * preparan una tras otra en el orden de la lista.
 */
export interface TurnoDePropuestas {
  /** Una lectura del backend hecha una sola vez por turno: la misma clave da el mismo resultado. */
  leer<T>(clave: string, lectura: () => Promise<T>): Promise<T>;
  /** Los cambios que las propuestas ya aceptadas del turno hacen en esa ruta, en orden. */
  cambiosEnRuta(rutaId: string): readonly CambioDeCheckpoint[];
}

/**
 * Lo que tiene una acción al prepararse (antes de pedir la confirmación): el
 * contexto de la sesión (las horas que dice son de `tz`, los textos van en
 * `language`) más quién propone y en qué turno. El envoltorio de `actionCatalog`
 * comprueba que `org` sea una de `organizations` y usa SU entrada.
 */
export interface ActionPrepareContext extends SessionContext {
  /** Quien propone (el usuario de la sesión). Lo usan las acciones que no pueden tocarle a él (su rol). */
  user: { id: string; name: string };
  /** El turno en el que se propone; ausente si la propuesta va sola (sin lote ni lecturas compartidas). */
  turno?: TurnoDePropuestas;
}

/** Lo que tiene una acción al ejecutarse, tras la confirmación, con la sesión del momento. */
export interface ActionContext extends ActionPrepareContext {
  /** La que devolvió `preparar` (p. ej. el `identifier` del vigilante), o null. */
  idempotencyKey: string | null;
}

/** Imagen que acompaña al resultado (el QR de un checkpoint o del enlace de un vigilante). */
export interface ActionImage {
  png: Uint8Array;
  caption?: string;
}

/** Lo que recibe el cliente cuando la acción se hace. */
export interface ActionResult {
  texto: string;
  imagen?: ActionImage;
}

export type BotActionParams<S extends z.ZodRawShape> = z.infer<z.ZodObject<S>>;

/**
 * Una acción de escritura que se puede proponer y, tras la confirmación del
 * cliente, ejecutar. El modelo solo ve la tool `proponer_*`; `ejecutar` la llama
 * el motor del consumidor de forma determinista, nunca el modelo.
 *
 * `resumen`, `preparar` y `ejecutar` van con sintaxis de método a propósito:
 * así una definición con sus parámetros concretos cabe en el catálogo genérico
 * (mismo borrado de tipos que `ReadCapability`).
 */
export interface ActionDefinition<S extends z.ZodRawShape = z.ZodRawShape> {
  nombre: BotActionName;
  /** Nombre de la tool que ve el modelo. */
  tool: `proponer_${string}`;
  /** Descripción de la tool para el modelo. */
  descripcion: string;
  /** Parámetros de la tool (sin `organizacion`: la añade el motor si el usuario tiene varias). */
  params: S;
  /** Rol mínimo del usuario en la organización. */
  rolMinimo: RoleType;
  /** true = el rol tiene que ser de ORGANIZACIÓN; uno solo de ubicación no basta (crear vigilante). */
  rolDeOrganizacion?: boolean;
  /**
   * Opcional, antes de proponer: resuelve nombres a ids, comprueba límites del
   * plan, genera la clave idempotente… Devuelve los parámetros que se guardan
   * (y que verá `ejecutar`) o el error que se le devuelve al modelo, y los
   * cambios que hace en los checkpoints de rutas (los ven las siguientes del lote).
   */
  preparar?(
    ctx: ActionPrepareContext,
    params: BotActionParams<S>
  ): Promise<
    | { params: BotActionParams<S>; idempotencyKey?: string; cambiosEnRutas?: CambioEnRuta[] }
    | { error: string }
  >;
  /**
   * Opcional: la identidad de la acción para detectar la misma propuesta dos
   * veces en un lote. Hace falta cuando `preparar` deriva campos que dependen de
   * las anteriores del lote (`desactiva`, `rutas`, `orden`): sin ella se comparan
   * todos los parámetros y dos iguales parecerían distintas.
   */
  huella?(params: BotActionParams<S>): unknown;
  /**
   * Qué se va a hacer, en una o dos líneas, para la confirmación y para el aviso
   * al equipo. Determinista (sin modelo) y repitiendo organización y ubicación.
   */
  resumen(
    params: BotActionParams<S>,
    ctx: { idioma: FixedTextLanguage; organizacion: string }
  ): string;
  /**
   * Hace el cambio en el backend. Lanza `PatrolTechApiError` si el backend lo rechaza, o
   * `AccionRechazada` si es la acción quien no lo hace (una protección que al confirmar ya no se cumple).
   */
  ejecutar(ctx: ActionContext, params: BotActionParams<S>): Promise<ActionResult>;
}

/** Declara una acción conservando la inferencia de `params` en sus métodos. */
export function defineBotAction<S extends z.ZodRawShape>(d: ActionDefinition<S>): ActionDefinition {
  return d;
}

/** Lo que el motor necesita de las acciones: el catálogo y a quién están abiertas. */
export interface BotActionsConfig {
  catalog: readonly ActionDefinition[];
  flags: BotActionFlags;
  /** Minutos que vive una propuesta sin confirmar. */
  ttlMin: number;
}

/** Dependencias de `actionCatalog`: las comunes (`gateway`, `logger`, `urls`). */
export type ActionDeps = CapabilityDeps;

/** Las dependencias ya con sus valores por defecto, tal como las reciben las áreas. */
export type ActionEnv = CapabilityEnv;

/**
 * ¿Puede ese rol de la sesión hacer esta acción? El backend sigue siendo quien
 * decide (403); esto solo evita proponer lo que seguro va a rechazar. Un rol
 * desconocido o ausente cuenta como VIEWER. Sin `scope` se asume de organización (sesiones
 * anteriores al campo).
 */
export function roleAllows(
  definition: ActionDefinition,
  org: Pick<OrganizationRef, 'roleType' | 'scope'>
): boolean {
  const rank = ROLE_RANK[(org.roleType ?? '').toUpperCase() as RoleType] ?? ROLE_RANK.VIEWER;
  if (rank < ROLE_RANK[definition.rolMinimo]) return false;
  return !definition.rolDeOrganizacion || org.scope !== 'location';
}
