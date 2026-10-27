import type { ActionDefinition } from './types.js';

/**
 * Reglas de negocio de un lote de propuestas (las de UN turno, que salen juntas
 * en una sola confirmación), sacadas del colector del bot (`collectProposals`)
 * para que el bot y el servidor MCP apliquen exactamente las mismas.
 *
 * Funciones puras sobre un estado inmutable: sin BD, sin canal y sin reloj. El
 * orden de la lista y la serialización de las llamadas concurrentes son del
 * motor de cada consumidor. Uso por propuesta:
 * 1. `reservarEnLote` ANTES de preparar (cupo del lote y un borrado por confirmación);
 * 2. si preparar falla o lanza, `liberarEnLote` (un borrado no preparado no cuenta);
 * 3. si sale bien, `aceptarEnLote` (descarta la repetida).
 */

/** Máximo de acciones en una confirmación: la lista tiene que poder leerse entera antes de pulsar. */
export const MAX_POR_LOTE = 10;
export const LOTE_LLENO = 'máximo 10 por confirmación; propón el resto después';
export const UN_BORRADO_POR_LOTE =
  'Solo se puede borrar una ubicación por confirmación: propón la siguiente cuando esta esté hecha.';
export const REPETIDA =
  'Esta acción ya está propuesta en este turno con los mismos datos (la misma organización, persona, checkpoint…): no la repitas. ' +
  'Va una sola vez en la confirmación.';

/** Una propuesta ya preparada, tal como la compara el lote. */
export interface PropuestaDelLote {
  definition: Pick<ActionDefinition, 'nombre' | 'huella'>;
  orgId: string;
  params: Record<string, unknown>;
}

/** Lo que el lote lleva contado en el turno. */
export interface EstadoDelLote {
  /**
   * Huecos ya pedidos en el turno. El hueco de una propuesta rechazada
   * sigue contando para el máximo; liberarlo desordenaría la lista y, con 10 de
   * margen, no compensa.
   */
  reservas: number;
  /** Borrados de ubicación reservados o aceptados (como mucho uno). */
  borrados: number;
  /** Huellas de las propuestas aceptadas, en orden. */
  huellas: readonly string[];
}

/** El lote al empezar el turno (y tras enviarlo). */
export const LOTE_VACIO: EstadoDelLote = { reservas: 0, borrados: 0, huellas: [] };

type Decision = { ok: true; estado: EstadoDelLote } | { ok: false; error: string };

/**
 * Cada borrado de ubicación comprueba «no es la última» por separado: dos en el
 * mismo lote podrían dejar la organización sin ninguna. Uno por confirmación.
 */
const esBorrado = (nombre: string): boolean => nombre === 'delete_location';

/**
 * Misma acción, organización e identidad: la que define la acción (`huella`) o,
 * sin ella, todos los parámetros ya preparados (las claves en cualquier orden).
 */
export function huellaDePropuesta(p: PropuestaDelLote): string {
  return JSON.stringify([
    p.definition.nombre,
    p.orgId,
    p.definition.huella
      ? p.definition.huella(p.params)
      : Object.entries(p.params).sort(([a], [b]) => a.localeCompare(b)),
  ]);
}

/** Antes de preparar: ¿cabe otra propuesta de esta acción en el lote? Si cabe, la reserva. */
export function reservarEnLote(estado: EstadoDelLote, nombre: string): Decision {
  if (estado.reservas >= MAX_POR_LOTE) return { ok: false, error: LOTE_LLENO };
  if (esBorrado(nombre) && estado.borrados > 0) return { ok: false, error: UN_BORRADO_POR_LOTE };
  return {
    ok: true,
    estado: {
      ...estado,
      reservas: estado.reservas + 1,
      borrados: estado.borrados + (esBorrado(nombre) ? 1 : 0),
    },
  };
}

/**
 * La preparación de una reservada falló o lanzó: un borrado que no llega a
 * prepararse (nombre mal escrito, backend caído) no cuenta, para que el reintento
 * corregido del mismo turno se admita. Su hueco sigue contando.
 */
export function liberarEnLote(estado: EstadoDelLote, nombre: string): EstadoDelLote {
  return esBorrado(nombre) ? { ...estado, borrados: Math.max(0, estado.borrados - 1) } : estado;
}

/**
 * Tras preparar: la acepta salvo que sea la misma que otra ya aceptada (p. ej.
 * quitar un acceso dos veces haría fallar la segunda al confirmar, con la primera
 * ya hecha). Se compara lo preparado: dos formas de nombrar lo mismo son la misma.
 */
export function aceptarEnLote(estado: EstadoDelLote, propuesta: PropuestaDelLote): Decision {
  const huella = huellaDePropuesta(propuesta);
  if (estado.huellas.includes(huella)) return { ok: false, error: REPETIDA };
  return { ok: true, estado: { ...estado, huellas: [...estado.huellas, huella] } };
}
