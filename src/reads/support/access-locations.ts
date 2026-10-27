import { isFeatureDisabled, PatrolTechApiError } from '../../domain/backend-errors.js';
import { fail, type ToolResult } from '../../domain/tool-result.js';
import type { LocationRef, PatrolTechGateway } from '../../gateway/index.js';
import { isFail } from './results.js';
import { resolveNamed, UBICACION } from './resolve.js';

/** Recorrido de las ubicaciones del Control de Acceso (el backend exige una por consulta). */

export const TIPO_PARAM = { entrada: 'ENTRY', salida: 'EXIT' } as const;
// Como mucho 20 ubicaciones por consulta (dos llamadas por ubicación);
// una organización con más tiene que acotar con `ubicacion`.
const MAX_UBICACIONES_ACCESOS = 20;
const CONTROL_ACCESO_APAGADO =
  'El Control de Acceso no está activo en esta organización: no hay registros de entradas y salidas. Lo activa un Admin en el panel, en Apps → Control de Acceso.';

/** Las ubicaciones a recorrer: la pedida o todas. */
export async function ubicacionesAccesos(
  gateway: PatrolTechGateway,
  orgId: string,
  token: string,
  ubicacion: string | undefined
): Promise<{ ubicaciones: LocationRef[]; avisos: string[] } | ToolResult<never>> {
  const todas = await gateway.listLocations(orgId, token);
  if (ubicacion) {
    const r = resolveNamed(ubicacion, todas, (l) => l.name, UBICACION);
    if (isFail(r)) return r;
    return { ubicaciones: [r.item], avisos: [] };
  }
  const avisos =
    todas.length > MAX_UBICACIONES_ACCESOS
      ? [
          `La organización tiene ${todas.length} ubicaciones: solo se han consultado ${MAX_UBICACIONES_ACCESOS}. Pide la ubicación para ver las demás.`,
        ]
      : [];
  return { ubicaciones: todas.slice(0, MAX_UBICACIONES_ACCESOS), avisos };
}

/** Recorre las ubicaciones con `leer`; un 403 del gate es la App apagada y corta. Las demás caídas se cuentan. */
export async function porUbicacion<T>(
  ubicaciones: LocationRef[],
  leer: (u: LocationRef) => Promise<T>
): Promise<
  { resultados: { ubicacion: LocationRef; valor: T }[]; conError: number } | ToolResult<never>
> {
  const resultados: { ubicacion: LocationRef; valor: T }[] = [];
  let conError = 0;
  for (const u of ubicaciones) {
    try {
      resultados.push({ ubicacion: u, valor: await leer(u) });
    } catch (err) {
      if (isFeatureDisabled(err)) return fail(CONTROL_ACCESO_APAGADO);
      // Un rol solo de otra ubicación da 403 en esta: se cuenta y se sigue.
      if (err instanceof PatrolTechApiError) {
        conError += 1;
        continue;
      }
      throw err;
    }
  }
  return { resultados, conError };
}

export function avisoUbicacionesSinLeer(conError: number): string[] {
  return conError > 0
    ? [
        `${conError} ubicación(es) no se pudieron consultar (permisos o error): sus accesos faltan. No afirmes que allí no ha entrado nadie.`,
      ]
    : [];
}
