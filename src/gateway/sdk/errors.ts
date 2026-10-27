import { ApiError } from '@patroltech/sdk-api';
import { PatrolTechApiError } from '../../domain/backend-errors.js';

/**
 * Cuerpo de una respuesta no-2xx tal como lo veía el cliente HTTP del bot: el JSON
 * parseado, o null si no lo era. El SDK solo parsea con `application/json` y deja
 * el resto como texto (un 502 de un proxy, por ejemplo); ese texto se intenta
 * leer como JSON y, si no lo es, cuenta como «sin cuerpo».
 */
function errorBody(data: unknown): unknown {
  if (typeof data !== 'string') return data ?? null;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

/**
 * `ApiError` del SDK → `PatrolTechApiError` con el status, la ruta y el cuerpo
 * completo (el `code` del 402 de límite con `limit`/`currentUsage`/`resource`/
 * `upsell`, el 451 de políticas pendientes, el 403 del gate de una App…), que es lo
 * que lee `translateBackendError`. Cualquier otro error (red, timeout) sigue igual.
 */
export function toPatrolTechApiError(err: unknown, path: string): unknown {
  if (!(err instanceof ApiError)) return err;
  return new PatrolTechApiError(err.status, path, errorBody(err.data));
}

/** ¿El backend ha respondido 404? Para las lecturas en las que «no existe» es null, no un error. */
export function isNotFound(err: unknown): boolean {
  return err instanceof PatrolTechApiError && err.status === 404;
}
