import type { CambioDeCheckpoint } from '../../domain/route-checkpoints.js';
import type { ActionPrepareContext, CambioEnRuta, TurnoDePropuestas } from '../types.js';

/** El turno de un lote: lecturas compartidas y los cambios ya aceptados en cada ruta. */
export interface TurnoConRegistro extends TurnoDePropuestas {
  /** Anota los cambios de una propuesta aceptada (en el orden de la lista). */
  registrar(cambios: readonly CambioEnRuta[]): void;
}

/**
 * Memo por turno, no una caché con TTL entre turnos. Techo por turno:
 * un `listRoutes` por organización y un `getRouteDetails` por ruta, compartidos
 * por todas las propuestas del lote (máx. 10). Una lectura que falla se olvida
 * para que la siguiente propuesta lo reintente.
 */
export function nuevoTurno(): TurnoConRegistro {
  const lecturas = new Map<string, Promise<unknown>>();
  const cambios = new Map<string, CambioDeCheckpoint[]>();
  return {
    leer<T>(clave: string, lectura: () => Promise<T>): Promise<T> {
      const hecha = lecturas.get(clave);
      if (hecha) return hecha as Promise<T>;
      const nueva = lectura();
      lecturas.set(clave, nueva);
      nueva.catch(() => lecturas.delete(clave));
      return nueva;
    },
    cambiosEnRuta: (rutaId) => cambios.get(rutaId) ?? [],
    registrar(nuevos) {
      for (const { rutaId, op, checkpointId } of nuevos) {
        cambios.set(rutaId, [...(cambios.get(rutaId) ?? []), { op, checkpointId }]);
      }
    },
  };
}

/** El de una propuesta suelta (sin lote): lee siempre y no hay cambios previos. */
const TURNO_SUELTO: TurnoDePropuestas = {
  leer: (_clave, lectura) => lectura(),
  cambiosEnRuta: () => [],
};

/** El turno de la propuesta, o el suelto si va sola. */
export const turnoDe = (ctx: ActionPrepareContext): TurnoDePropuestas => ctx.turno ?? TURNO_SUELTO;
